const DEFAULT_FONTS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New'
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function boxOf(word) {
  const b = word?.bbox || word?.boundingBox || {};
  const x0 = Number(b.x0 ?? b.left ?? 0);
  const y0 = Number(b.y0 ?? b.top ?? 0);
  const x1 = Number(b.x1 ?? b.right ?? x0);
  const y1 = Number(b.y1 ?? b.bottom ?? y0);
  return { x0, y0, x1, y1 };
}

function flattenWords(data) {
  if (Array.isArray(data?.words)) return data.words;
  const out = [];
  for (const block of data?.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) out.push(...(line.words || []));
    }
  }
  return out;
}

export function normalizeOcrWords(data, minConfidence = 55) {
  return flattenWords(data)
    .map(word => {
      const text = String(word?.text || '').trim();
      const confidence = Number(word?.confidence ?? word?.conf ?? 0);
      const bbox = boxOf(word);
      return { text, confidence, bbox };
    })
    .filter(word => word.text && word.confidence >= minConfidence && word.bbox.x1 - word.bbox.x0 >= 2 && word.bbox.y1 - word.bbox.y0 >= 2);
}

function rgbHex(rgb) {
  return `#${rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function colorDistanceSq(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function quantKey(r, g, b) { return `${r >> 4},${g >> 4},${b >> 4}`; }
function binCenter(key) { return key.split(',').map(v => Number(v) * 16 + 7.5); }

function pixelAt(imageData, x, y) {
  const p = (y * imageData.width + x) * 4;
  return [imageData.data[p], imageData.data[p + 1], imageData.data[p + 2], imageData.data[p + 3]];
}

function dominantColor(samples) {
  if (!samples.length) return [255, 255, 255];
  const bins = new Map();
  for (const [r, g, b, a = 255] of samples) {
    if (a < 16) continue;
    const key = quantKey(r, g, b);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  let best = null, count = -1;
  for (const [key, n] of bins) {
    if (n > count) { best = key; count = n; }
  }
  return best ? binCenter(best) : [255, 255, 255];
}

export function estimateWordColors(imageData, bbox) {
  const { width, height } = imageData;
  const x0 = clamp(Math.floor(bbox.x0), 0, width - 1);
  const y0 = clamp(Math.floor(bbox.y0), 0, height - 1);
  const x1 = clamp(Math.ceil(bbox.x1), x0 + 1, width);
  const y1 = clamp(Math.ceil(bbox.y1), y0 + 1, height);
  const border = [];
  const pixels = [];

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const px = pixelAt(imageData, x, y);
      pixels.push(px);
      if (x <= x0 + 1 || x >= x1 - 2 || y <= y0 + 1 || y >= y1 - 2) border.push(px);
    }
  }

  const background = dominantColor(border.length ? border : pixels);
  const ranked = pixels
    .filter(px => px[3] >= 16)
    .map(px => ({ px, d: colorDistanceSq(px, background) }))
    .sort((a, b) => b.d - a.d);
  const take = Math.max(1, Math.round(ranked.length * 0.28));
  const foreground = dominantColor(ranked.slice(0, take).map(v => v.px));
  const threshold = Math.max(900, colorDistanceSq(background, foreground) * 0.18);
  const foregroundCount = ranked.filter(v => v.d >= threshold).length;
  const inkRatio = ranked.length ? foregroundCount / ranked.length : 0;

  return {
    foreground,
    background,
    fill: rgbHex(foreground),
    backgroundFill: rgbHex(background),
    inkRatio
  };
}

function defaultMeasure(text, family, size, weight) {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return text.length * size * 0.56;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${size}px "${family}"`;
  return ctx.measureText(text).width;
}

export function fitTextStyle(text, bbox, { fonts = DEFAULT_FONTS, measureText = defaultMeasure, inkRatio = 0.18 } = {}) {
  const targetWidth = Math.max(2, bbox.x1 - bbox.x0);
  const targetHeight = Math.max(2, bbox.y1 - bbox.y0);
  const weight = inkRatio > 0.31 ? 700 : inkRatio > 0.24 ? 600 : 400;
  let best = null;

  for (const family of fonts) {
    const probe = Math.max(8, targetHeight);
    const measured = Math.max(1, measureText(text, family, probe, weight));
    const widthSize = probe * targetWidth / measured;
    const size = clamp(Math.min(widthSize, targetHeight * 1.18), targetHeight * 0.72, targetHeight * 1.24);
    const fittedWidth = measureText(text, family, size, weight);
    const widthError = Math.abs(fittedWidth - targetWidth) / targetWidth;
    const heightPenalty = Math.abs(size - targetHeight) / targetHeight * 0.15;
    const score = widthError + heightPenalty;
    if (!best || score < best.score) best = { family, size, weight, score };
  }

  return best || { family: 'Arial', size: targetHeight, weight, score: 1 };
}

export function createTextObjects(words, imageData, {
  originalWidth = imageData.width,
  originalHeight = imageData.height,
  measureText,
  fonts = DEFAULT_FONTS
} = {}) {
  const sx = originalWidth / imageData.width;
  const sy = originalHeight / imageData.height;

  return words.map((word, index) => {
    const colors = estimateWordColors(imageData, word.bbox);
    const style = fitTextStyle(word.text, word.bbox, { fonts, measureText, inkRatio: colors.inkRatio });
    return {
      id: `text-${String(index + 1).padStart(3, '0')}`,
      cluster: -1,
      type: 'text',
      text: word.text,
      x: word.bbox.x0 * sx,
      y: (word.bbox.y1 - Math.max(0.5, style.size * 0.06)) * sy,
      fontFamily: style.family,
      fontSize: style.size * sy,
      fontWeight: style.weight,
      fill: colors.fill,
      opacity: 1,
      confidence: word.confidence,
      sourceBounds: [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1]
    };
  });
}

export function maskDetectedText(imageData, words) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data);

  for (const word of words) {
    const { foreground, background } = estimateWordColors(imageData, word.bbox);
    const x0 = clamp(Math.floor(word.bbox.x0) - 1, 0, width - 1);
    const y0 = clamp(Math.floor(word.bbox.y0) - 1, 0, height - 1);
    const x1 = clamp(Math.ceil(word.bbox.x1) + 1, x0 + 1, width);
    const y1 = clamp(Math.ceil(word.bbox.y1) + 1, y0 + 1, height);
    const separation = Math.max(1200, colorDistanceSq(background, foreground));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = (y * width + x) * 4;
        if (out[p + 3] < 16) continue;
        const rgb = [out[p], out[p + 1], out[p + 2]];
        const db = colorDistanceSq(rgb, background);
        const df = colorDistanceSq(rgb, foreground);
        if (db > separation * 0.08 && df <= db * 1.35) {
          out[p] = Math.round(background[0]);
          out[p + 1] = Math.round(background[1]);
          out[p + 2] = Math.round(background[2]);
        }
      }
    }
  }

  return { width, height, data: out };
}

export async function recognizeText(source, { language = 'eng', minConfidence = 55, onProgress = () => {} } = {}) {
  const Tesseract = globalThis.Tesseract;
  if (!Tesseract?.recognize) throw new Error('Tesseract.js is unavailable. Check the network connection or disable text detection.');
  const result = await Tesseract.recognize(source, language, {
    logger: message => onProgress(clamp(Number(message?.progress ?? 0), 0, 1), String(message?.status || 'Recognizing text'))
  });
  const words = normalizeOcrWords(result?.data || {}, minConfidence);
  return { words, data: result?.data || {} };
}

export { DEFAULT_FONTS };
