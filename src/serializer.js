const clampPrecision = precision => Math.max(0, Math.min(4, Number(precision) || 0));

function fmt(value, precision) {
  const p = Math.pow(10, clampPrecision(precision));
  const n = Math.round(Number(value) * p) / p;
  return Number.isFinite(n) ? String(n) : '0';
}

export function escapeXml(value) {
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
  const group = object.groupId ? ` data-group="${escapeXml(object.groupId)}"` : '';
  const role = object.semanticRole ? ` data-role="${escapeXml(object.semanticRole)}"` : '';
  return `id="${escapeXml(object.id)}" data-object-id="${escapeXml(object.id)}" data-cluster="${cluster}"${group}${role} fill="${escapeXml(object.fill || '#000000')}"${opacity < 0.995 ? ` opacity="${fmt(opacity, 3)}"` : ''}`;
}

export function objectMarkup(object, precision = 2) {
  const common = commonAttributes(object);
  if (object.type === 'circle') {
    return `<circle ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" r="${fmt(object.r, precision)}"/>`;
  }
  if (object.type === 'ellipse') {
    return `<ellipse ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" rx="${fmt(object.rx, precision)}" ry="${fmt(object.ry, precision)}"/>`;
  }
  if (object.type === 'rect' || object.type === 'roundedRect') {
    const rx = object.type === 'roundedRect' ? Math.max(0, Number(object.rx || 0)) : 0;
    return `<rect ${common} x="${fmt(object.x, precision)}" y="${fmt(object.y, precision)}" width="${fmt(object.width, precision)}" height="${fmt(object.height, precision)}"${rx > 0 ? ` rx="${fmt(rx, precision)}" ry="${fmt(object.ry ?? rx, precision)}"` : ''}/>`;
  }
  if (object.type === 'line') {
    const stroke = escapeXml(object.stroke || object.fill || '#000000');
    const width = fmt(object.strokeWidth || 1, precision);
    return `<line id="${escapeXml(object.id)}" data-object-id="${escapeXml(object.id)}" x1="${fmt(object.x1, precision)}" y1="${fmt(object.y1, precision)}" x2="${fmt(object.x2, precision)}" y2="${fmt(object.y2, precision)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
  }
  if (object.type === 'path' && object.pathData) {
    return `<path ${common} d="${object.pathData}"/>`;
  }
  if (object.type === 'text') {
    const family = escapeXml(object.fontFamily || 'Arial');
    const size = fmt(object.fontSize || 16, precision);
    const weight = Math.max(100, Math.min(900, Math.round(Number(object.fontWeight || 400) / 100) * 100));
    const textLength = Number(object.textLength) > 0 ? ` textLength="${fmt(object.textLength, precision)}" lengthAdjust="${escapeXml(object.lengthAdjust || 'spacingAndGlyphs')}"` : '';
    const spacing = Number.isFinite(Number(object.letterSpacing)) && Number(object.letterSpacing) !== 0 ? ` letter-spacing="${fmt(object.letterSpacing, precision)}"` : '';
    return `<text ${common} x="${fmt(object.x, precision)}" y="${fmt(object.y, precision)}" font-family="${family}" font-size="${size}" font-weight="${weight}"${textLength}${spacing}>${escapeXml(object.text)}</text>`;
  }
  if (object.rings?.length > 1) {
    return `<path ${common} d="${pathForRings(object.rings, precision)}" fill-rule="evenodd"/>`;
  }
  return `<polygon ${common} points="${pointsAttribute(object.rings?.[0] || object.points || [], precision)}"/>`;
}

function groupedMarkup(objects, precision) {
  const groups = new Map();
  for (const object of objects) {
    const key = object.groupId || '__root__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  }
  const chunks = [];
  for (const [groupId, items] of groups) {
    if (groupId === '__root__') {
      chunks.push(...items.map(object => `  ${objectMarkup(object, precision)}`));
      continue;
    }
    chunks.push(`  <g id="${escapeXml(groupId)}" data-semantic-group="${escapeXml(groupId)}">`);
    chunks.push(...items.map(object => `    ${objectMarkup(object, precision)}`));
    chunks.push('  </g>');
  }
  return chunks.join('\n');
}

export function serializeObjectsToSvg(objects, width, height, precision = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width, precision)} ${fmt(height, precision)}" width="${fmt(width, precision)}" height="${fmt(height, precision)}">\n${groupedMarkup(objects, precision)}\n</svg>`;
}
