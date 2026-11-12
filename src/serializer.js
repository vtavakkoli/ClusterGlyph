const clampPrecision = precision => Math.max(0, Math.min(4, Number(precision) || 0));

function fmt(value, precision) {
  const p = Math.pow(10, clampPrecision(precision));
  const n = Math.round(Number(value) * p) / p;
  return Number.isFinite(n) ? String(n) : '0';
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pointsAttribute(points, precision) {
  return points.map(([x, y]) => `${fmt(x, precision)},${fmt(y, precision)}`).join(' ');
}

export function pathForRings(rings, precision = 2, smoothing = 0) {
  return rings.map(ring => {
    if (!ring.length) return '';
    if (smoothing > 0 && ring.length >= 3) {
      const corners = ring.map(([x, y], i) => {
        const previous = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length];
        const a = Math.hypot(previous[0] - x, previous[1] - y), b = Math.hypot(next[0] - x, next[1] - y);
        const turn = a && b ? Math.acos(Math.max(-1, Math.min(1, ((x - previous[0]) * (next[0] - x) + (y - previous[1]) * (next[1] - y)) / (a * b)))) : 0;
        // Keep real corners. Round short raster steps and shallow curve segments.
        const sharp = turn > Math.PI * 5 / 12;
        const cut = sharp && Math.min(a, b) > smoothing * 2 ? 0
          : sharp ? Math.min(smoothing, a * 0.45, b * 0.45) : Math.min(a, b) * 0.45;
        return { point: [x, y], entry: [x + (previous[0] - x) * cut / (a || 1), y + (previous[1] - y) * cut / (a || 1)], exit: [x + (next[0] - x) * cut / (b || 1), y + (next[1] - y) * cut / (b || 1)], cut };
      });
      const xy = point => `${fmt(point[0], precision)} ${fmt(point[1], precision)}`;
      return `M${xy(corners.at(-1).exit)}` + corners.map(corner => `L${xy(corner.entry)}${corner.cut ? `Q${xy(corner.point)} ${xy(corner.exit)}` : ''}`).join('') + 'Z';
    }
    const parts = [`M${fmt(ring[0][0], precision)} ${fmt(ring[0][1], precision)}`];
    for (let i = 1; i < ring.length; i++) parts.push(`L${fmt(ring[i][0], precision)} ${fmt(ring[i][1], precision)}`);
    parts.push('Z');
    return parts.join('');
  }).join('');
}

function commonAttributes(object) {
  const opacity = Number(object.opacity ?? 1);
  const cluster = Number.isFinite(Number(object.cluster)) ? Number(object.cluster) : -1;
  const fill = escapeXml(object.fill || '#000000');
  const seam = Number(object.seamWidth) > 0 && object.type !== 'text'
    ? ` stroke="${fill}" stroke-width="${fmt(object.seamWidth, 3)}" stroke-linejoin="round" paint-order="stroke fill"` : '';
  return `id="${escapeXml(object.id)}" data-object-id="${escapeXml(object.id)}" data-cluster="${cluster}" fill="${fill}"${opacity < 0.995 ? ` opacity="${fmt(opacity, 3)}"` : ''}${seam}`;
}

export function objectMarkup(object, precision = 2) {
  const common = commonAttributes(object);
  if (object.type === 'circle') {
    return `<circle ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" r="${fmt(object.r, precision)}"/>`;
  }
  if (object.type === 'ellipse') {
    return `<ellipse ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" rx="${fmt(object.rx, precision)}" ry="${fmt(object.ry, precision)}"/>`;
  }
  if (object.type === 'text') {
    const family = escapeXml(object.fontFamily || 'Arial');
    const size = fmt(object.fontSize || 16, precision);
    const weight = Math.max(100, Math.min(900, Math.round(Number(object.fontWeight || 400) / 100) * 100));
    return `<text ${common} x="${fmt(object.x, precision)}" y="${fmt(object.y, precision)}" font-family="${family}" font-size="${size}" font-weight="${weight}">${escapeXml(object.text)}</text>`;
  }
  if (object.rings?.length) {
    const path = pathForRings(object.rings, precision, object.curveSmoothing || 0);
    if (object.rings.length > 1 || path.includes('Q')) return `<path ${common} d="${path}" fill-rule="evenodd"/>`;
  }
  return `<polygon ${common} points="${pointsAttribute(object.rings?.[0] || object.points || [], precision)}"/>`;
}

export function objectsForBackground(objects, backgroundMode = 'original') {
  return backgroundMode === 'transparent' || backgroundMode === 'custom'
    ? objects.filter(object => !object.isBackground) : objects;
}

export function serializeObjectsToSvg(objects, width, height, precision = 2, { backgroundMode = 'original', backgroundColor = '#18212a' } = {}) {
  const visible = objectsForBackground(objects, backgroundMode);
  const color = /^#[a-f\d]{6}$/i.test(backgroundColor) ? backgroundColor : '#18212a';
  const background = backgroundMode === 'custom'
    ? `  <rect id="canvas-background" width="${fmt(width, precision)}" height="${fmt(height, precision)}" fill="${color}"/>\n` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width, precision)} ${fmt(height, precision)}" width="${fmt(width, precision)}" height="${fmt(height, precision)}">\n${background}${visible.map(object => `  ${objectMarkup(object, precision)}`).join('\n')}\n</svg>`;
}
