const DEFAULT_FONTS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New'
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function boxOf(item) {
  const b = item?.bbox || item?.boundingBox || {};
  const x0 = Number(b.x0 ?? b.left ?? 0);
  const y0 = Number(b.y0 ?? b.top ?? 0);
  const x1 = Number(b.x1 ?? b.right ?? x0);
  const y1 = Number(b.y1 ?? b.bottom ?? y0);
  return { x0, y0, x1, y1 };
}

function unionBoxes(boxes) {
  return {
    x0: Math.min(...boxes.map(b => b.x0)),
    y0: Math.min(...boxes.map(b => b.y0)),
    x1: Math.max(...boxes.map(b => b.x1)),
    y1: Math.max(...boxes.map(b => b.y1))
  };
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

function fallbackLines(words) {
  if (!words.length) return [];
  const sorted = words.slice().sort((a, b) => ((a.bbox.y0 + a.bbox.y1) / 2) - ((b.bbox.y0 + b.bbox.y1) / 2) || a.bbox.x0 - b.bbox.x0);
  const heights = sorted.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const groups = [];
  for (const word of sorted) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    let group = groups.find(g => Math.abs(g.cy - cy) <= medianHeight * 0.52);
    if (!group) {
      group = { cy, words: [] };
      groups.push(group);
    }
    group.words.push(word);
    group.cy = group.words.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / group.words.length;
  }
  return groups
    .sort((a, b) => a.cy - b.cy)
    .map((group, index) => {
      const lineWords = group.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return {
        text: lineWords.map(w => w.text).join(' '),
        confidence: lineWords.reduce((s, w) => s + w.confidence, 0) / lineWords.length,
        bbox: unionBoxes(lineWords.map(w => w.bbox)),
        words: lineWords,
        blockIndex: index,
        paragraphIndex: 0,
        lineIndex: 0,
        groupId: `text-block-${String(index + 1).padStart(2, '0')}`
      };
    });
}

export function normalizeOcrLines(data, minConfidence = 55) {
  const lines = [];
  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  blocks.forEach((block, blockIndex) => {
    (block.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      (paragraph.lines || []).forEach((line, lineIndex) => {
        const words = (line.words || [])
          .map(word => ({ text: String(word?.text || '').trim(), confidence: Number(word?.confidence ?? word?.conf ?? 0), bbox: boxOf(word) }))
          .filter(word => word.text && word.confidence >= minConfidence);
        if (!words.length) return;
        const bbox = line?.bbox ? boxOf(line) : unionBoxes(words.map(w => w.bbox));
        const confidence = words.reduce((s, w) => s + w.confidence, 0) / words.length;
        const text = String(line?.text || words.map(w => w.text).join(' ')).trim();
        if (!text || bbox.x1 - bbox.x0 < 2 || bbox.y1 - bbox.y0 < 2) return;
        lines.push({
          text,
          confidence,
          bbox,
          words,
          blockIndex,
          paragraphIndex,
          lineIndex,
          groupId: `text-block-${String(blockIndex + 1).padStart(2, '0')}`
        });
      });
    });
  });
  if (lines.length) return lines;
  return fallbackLines(normalizeOcrWords(data, minConfidence));
}

export function scaleOcrDetections(items, sx, sy) {
  return items.map(item => ({
    ...item,
    bbox: {
      x0: item.bbox.x0 * sx,
      y0: item.bbox.y0 * sy,
      x1: item.bbox.x1 * sx,
      y1: item.bbox.y1 * sy
    },
    words: item.words?.map(word => ({
      ...word,
      bbox: {
        x0: word.bbox.x0 * sx,
        y0: word.bbox.y0 * sy,
        x1: word.bbox.x1 * sx,
        y1: word.bbox.y1 * sy
      }
    }))
  }));
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
  const pad = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) * 0.12));
  const border = [];
  const pixels = [];

  for (let y = Math.max(0, y0 - pad); y < Math.min(height, y1 + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x < Math.min(width, x1 + pad); x++) {
      const px = pixelAt(imageData, x, y);
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (inside) pixels.push(px);
      else border.push(px);
    }
  }

  const background = dominantColor(border.length ? border : pixels);
  const ranked = pixels
    .filter(px => px[3] >= 16)
    .map(px => ({ px, d: colorDistanceSq(px, background) }))
    .sort((a, b) => b.d - a.d);
  const take = Math.max(1, Math.round(ranked.length * 0.24));
  const foreground = dominantColor(ranked.slice(0, take).map(v => v.px));
  const threshold = Math.max(650, colorDistanceSq(background, foreground) * 0.12);
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

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return null;
}

function defaultMeasure(text, family, size, weight) {
  const canvas = makeCanvas(32, 32);
  if (!canvas) return text.length * size * 0.56;
  const ctx = canvas.getContext('2d');
  ctx.font = `${weight} ${size}px "${family}"`;
  return ctx.measureText(text).width;
}

function sourceInkMask(imageData, bbox, colors) {
  const x0 = clamp(Math.floor(bbox.x0), 0, imageData.width - 1);
  const y0 = clamp(Math.floor(bbox.y0), 0, imageData.height - 1);
  const x1 = clamp(Math.ceil(bbox.x1), x0 + 1, imageData.width);
  const y1 = clamp(Math.ceil(bbox.y1), y0 + 1, imageData.height);
  const width = x1 - x0, height = y1 - y0;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = pixelAt(imageData, x0 + x, y0 + y);
      const db = colorDistanceSq(px, colors.background);
      const df = colorDistanceSq(px, colors.foreground);
      mask[y * width + x] = px[3] >= 16 && db > 250 && df < db * 1.25 ? 1 : 0;
    }
  }
  return { mask, width, height };
}

function renderInkMask(text, family, size, weight, width, height) {
  const canvas = makeCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${weight} ${size}px "${family}"`;
  const measured = Math.max(1, ctx.measureText(text).width);
  const scaleX = width / measured;
  ctx.save();
  ctx.scale(scaleX, 1);
  ctx.fillText(text, 0, Math.min(height - 1, height * 0.88), measured);
  ctx.restore();
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 72 ? 1 : 0;
  return mask;
}

function maskIoU(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) intersection++;
  }
  return union ? intersection / union : 0;
}

export function fitTextStyle(text, bbox, {
  fonts = DEFAULT_FONTS,
  measureText = defaultMeasure,
  inkRatio = 0.18,
  imageData = null,
  colors = null
} = {}) {
  const targetWidth = Math.max(2, bbox.x1 - bbox.x0);
  const targetHeight = Math.max(2, bbox.y1 - bbox.y0);
  const inferredWeight = inkRatio > 0.31 ? 700 : inkRatio > 0.24 ? 600 : 400;
  const weights = [...new Set([inferredWeight, 400, 600, 700, 800])];
  const sourceMask = imageData && colors ? sourceInkMask(imageData, bbox, colors) : null;
  let best = null;

  for (const family of fonts) {
    for (const weight of weights) {
      const probe = Math.max(8, targetHeight);
      const measured = Math.max(1, measureText(text, family, probe, weight));
      const widthSize = probe * targetWidth / measured;
      const baseSize = clamp(Math.min(widthSize, targetHeight * 1.2), targetHeight * 0.68, targetHeight * 1.24);
      const factors = sourceMask ? [0.86, 0.94, 1, 1.06, 1.13] : [1];
      for (const factor of factors) {
        const size = baseSize * factor;
        const fittedWidth = measureText(text, family, size, weight);
        const widthError = Math.abs(fittedWidth - targetWidth) / targetWidth;
        const heightPenalty = Math.abs(size - targetHeight) / targetHeight * 0.12;
        let pixelPenalty = 0;
        if (sourceMask) {
          const candidateMask = renderInkMask(text, family, size, weight, sourceMask.width, sourceMask.height);
          pixelPenalty = 1 - maskIoU(sourceMask.mask, candidateMask);
        }
        const weightPenalty = Math.abs(weight - inferredWeight) / 4000;
        const score = pixelPenalty * 0.72 + widthError * 0.2 + heightPenalty + weightPenalty;
        if (!best || score < best.score) best = { family, size, weight, score, pixelScore: sourceMask ? 1 - pixelPenalty : null };
      }
    }
  }

  return best || { family: 'Arial', size: targetHeight, weight: inferredWeight, score: 1, pixelScore: null };
}

export function createTextObjects(items, imageData, {
  originalWidth = imageData.width,
  originalHeight = imageData.height,
  measureText,
  fonts = DEFAULT_FONTS
} = {}) {
  const sx = originalWidth / imageData.width;
  const sy = originalHeight / imageData.height;

  return items.map((item, index) => {
    const colors = estimateWordColors(imageData, item.bbox);
    const style = fitTextStyle(item.text, item.bbox, { fonts, measureText, inkRatio: colors.inkRatio, imageData, colors });
    const targetWidth = Math.max(2, item.bbox.x1 - item.bbox.x0);
    const baselineInset = Math.max(0.5, style.size * 0.07);
    return {
      id: `text-${String(index + 1).padStart(3, '0')}`,
      cluster: -1,
      type: 'text',
      text: item.text,
      x: item.bbox.x0 * sx,
      y: (item.bbox.y1 - baselineInset) * sy,
      fontFamily: style.family,
      fontSize: style.size * sy,
      fontWeight: style.weight,
      textLength: targetWidth * sx,
      lengthAdjust: 'spacingAndGlyphs',
      letterSpacing: 0,
      fill: colors.fill,
      opacity: 1,
      confidence: item.confidence,
      fontMatchScore: style.pixelScore,
      groupId: item.groupId || `text-block-${String(index + 1).padStart(2, '0')}`,
      semanticRole: 'text-line',
      sourceBounds: [item.bbox.x0, item.bbox.y0, item.bbox.x1, item.bbox.y1],
      bounds: [item.bbox.x0 * sx, item.bbox.y0 * sy, item.bbox.x1 * sx, item.bbox.y1 * sy]
    };
  });
}

function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + 1) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) out[ny * width + nx] = 1;
        }
      }
    }
  }
  return out;
}

export function maskDetectedText(imageData, items, { dilation = 2 } = {}) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data);

  for (const item of items) {
    const colors = estimateWordColors(imageData, item.bbox);
    const pad = Math.max(2, dilation + 1);
    const x0 = clamp(Math.floor(item.bbox.x0) - pad, 0, width - 1);
    const y0 = clamp(Math.floor(item.bbox.y0) - pad, 0, height - 1);
    const x1 = clamp(Math.ceil(item.bbox.x1) + pad, x0 + 1, width);
    const y1 = clamp(Math.ceil(item.bbox.y1) + pad, y0 + 1, height);
    const rw = x1 - x0, rh = y1 - y0;
    const local = new Uint8Array(rw * rh);
    const separation = Math.max(700, colorDistanceSq(colors.background, colors.foreground));

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const px = pixelAt(imageData, x0 + x, y0 + y);
        if (px[3] < 16) continue;
        const db = colorDistanceSq(px, colors.background);
        const df = colorDistanceSq(px, colors.foreground);
        if (db > separation * 0.045 && df <= db * 1.45) local[y * rw + x] = 1;
      }
    }

    const expanded = dilateMask(local, rw, rh, Math.max(0, Math.round(dilation)));
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (!expanded[y * rw + x]) continue;
        const p = ((y0 + y) * width + (x0 + x)) * 4;
        out[p] = Math.round(colors.background[0]);
        out[p + 1] = Math.round(colors.background[1]);
        out[p + 2] = Math.round(colors.background[2]);
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
  const data = result?.data || {};
  const words = normalizeOcrWords(data, minConfidence);
  const lines = normalizeOcrLines(data, minConfidence);
  return { words, lines, data };
}

export { DEFAULT_FONTS };
