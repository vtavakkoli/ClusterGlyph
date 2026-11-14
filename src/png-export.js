import { serializeObjectsToSvg } from './serializer.js';

export function pngDimensions(width, height, scale = 1) {
  if (![width, height, scale].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('PNG dimensions and scale must be positive numbers.');
  }
  const dimensions = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  if (dimensions.width > 16384 || dimensions.height > 16384 || dimensions.width * dimensions.height > 32000000) {
    throw new Error('PNG is too large. Choose a smaller export scale (maximum 32 megapixels).');
  }
  return dimensions;
}

async function rasterizeSvg(svg, width, height) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.style.colorScheme = 'only light';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not render the SVG as PNG.'));
      image.src = url;
    });
    // An offscreen surface has no page theme. Keep the DOM fallback color-neutral too.
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    if (canvas.style) canvas.style.colorScheme = 'only light';
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!ctx) throw new Error('PNG export is unavailable in this browser.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Some mobile force-dark modes ignore author opt-outs even inside SVG images.
// Check actual pixels with the same renderer so we never silently export gray
// instead of white/black (or change saturated colors).
async function checkRendererColors() {
  const colors = ['#ffffff', '#000000', '#0066ff', '#ff0000'];
  const objects = colors.map((fill, i) => ({
    id: `probe-${i}`, type: 'polygon', fill,
    rings: [[[i * 4, 0], [i * 4 + 4, 0], [i * 4 + 4, 4], [i * 4, 4]]]
  }));
  const { ctx } = await rasterizeSvg(serializeObjectsToSvg(objects, 16, 4), 16, 4);
  for (let i = 0; i < colors.length; i++) {
    const actual = ctx.getImageData(i * 4 + 2, 2, 1, 1).data;
    const expected = [...colors[i].match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16)), 255];
    if (expected.some((value, channel) => Math.abs(value - actual[channel]) > 2)) {
      throw new Error('Your browser is changing image colors. Turn off forced dark mode for web pages, reload, and try again. You can also download SVG.');
    }
  }
}

// Rasterize the export SVG, never the preview with selection outlines/handles.
export async function svgToPngBlob(svg, width, height, scale = 1) {
  const dimensions = pngDimensions(width, height, scale);
  await checkRendererColors();
  const { canvas } = await rasterizeSvg(svg, dimensions.width, dimensions.height);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error('Could not create the PNG file. Try a smaller export scale.'));
  }, 'image/png'));
}

