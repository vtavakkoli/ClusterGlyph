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

function pathForRings(rings, precision) {
  return rings.map(ring => {
    if (!ring.length) return '';
    const parts = [`M${fmt(ring[0][0], precision)} ${fmt(ring[0][1], precision)}`];
    for (let i = 1; i < ring.length; i++) parts.push(`L${fmt(ring[i][0], precision)} ${fmt(ring[i][1], precision)}`);
    parts.push('Z');
    return parts.join('');
  }).join('');
}

function commonAttributes(object) {
  const opacity = Number(object.opacity ?? 1);
  const cluster = Number.isFinite(Number(object.cluster)) ? Number(object.cluster) : -1;
  return `id="${escapeXml(object.id)}" data-object-id="${escapeXml(object.id)}" data-cluster="${cluster}" fill="${escapeXml(object.fill || '#000000')}"${opacity < 0.995 ? ` opacity="${fmt(opacity, 3)}"` : ''}`;
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
  if (object.rings?.length > 1) {
    return `<path ${common} d="${pathForRings(object.rings, precision)}" fill-rule="evenodd"/>`;
  }
  return `<polygon ${common} points="${pointsAttribute(object.rings?.[0] || object.points || [], precision)}"/>`;
}

export function serializeObjectsToSvg(objects, width, height, precision = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width, precision)} ${fmt(height, precision)}" width="${fmt(width, precision)}" height="${fmt(height, precision)}">\n${objects.map(object => `  ${objectMarkup(object, precision)}`).join('\n')}\n</svg>`;
}
