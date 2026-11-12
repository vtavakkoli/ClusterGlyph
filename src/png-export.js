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

// Rasterize the export SVG, never the preview with selection outlines/handles.
export async function svgToPngBlob(svg, width, height, scale = 1) {
  const dimensions = pngDimensions(width, height, scale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not render the SVG as PNG.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('PNG export is unavailable in this browser.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create the PNG file. Try a smaller export scale.'));
    }, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
