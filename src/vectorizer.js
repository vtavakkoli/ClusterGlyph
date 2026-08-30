const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R <= 0.04045 ? R / 12.92 : Math.pow((R + 0.055) / 1.055, 2.4);
  G = G <= 0.04045 ? G / 12.92 : Math.pow((G + 0.055) / 1.055, 2.4);
  B = B <= 0.04045 ? B / 12.92 : Math.pow((B + 0.055) / 1.055, 2.4);

  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function dist3(a, b) {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
}

function hex(r, g, b) {
  return `#${[r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function samplePixels(data, maxSamples = 24000) {
  const n = data.length / 4;
  const step = Math.max(1, Math.ceil(n / maxSamples));
  const samples = [];
  for (let i = 0; i < n; i += step) {
    const p = i * 4;
    if (data[p + 3] < 8) continue;
    samples.push({ rgb: [data[p], data[p + 1], data[p + 2]], lab: rgbToLab(data[p], data[p + 1], data[p + 2]) });
  }
  return samples;
}

export function clusterColors(data, k = 8, iterations = 10) {
  const samples = samplePixels(data);
  if (!samples.length) return { centroids: [], labels: new Int16Array(data.length / 4), palette: [] };
  k = clamp(Math.round(k), 1, Math.min(32, samples.length));
  const centroids = [samples[Math.floor(samples.length / 2)].lab.slice()];
  while (centroids.length < k) {
    let best = samples[0], bestD = -1;
    for (const s of samples) {
      let d = Infinity;
      for (const c of centroids) d = Math.min(d, dist3(s.lab, c));
      if (d > bestD) { bestD = d; best = s; }
    }
    centroids.push(best.lab.slice());
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist3(s.lab, centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      const sum = sums[best];
      sum[0] += s.lab[0]; sum[1] += s.lab[1]; sum[2] += s.lab[2]; sum[3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3]) centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }

  const n = data.length / 4;
  const labels = new Int16Array(n);
  labels.fill(-1);
  const rgbSums = Array.from({ length: k }, () => [0, 0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (data[p + 3] < 8) continue;
    const lab = rgbToLab(data[p], data[p + 1], data[p + 2]);
    let best = 0, bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist3(lab, centroids[c]);
      if (d < bestD) { bestD = d; best = c; }
    }
    labels[i] = best;
    const s = rgbSums[best];
    s[0] += data[p]; s[1] += data[p + 1]; s[2] += data[p + 2]; s[3] += data[p + 3]; s[4]++;
  }
  const palette = rgbSums.map(s => s[4] ? ({
    color: hex(s[0] / s[4], s[1] / s[4], s[2] / s[4]),
    alpha: s[3] / s[4] / 255,
    count: s[4]
  }) : ({ color: '#000000', alpha: 0, count: 0 }));
  return { centroids, labels, palette };
}

export function findComponents(labels, width, height, minArea) {
  const n = labels.length;
  const visited = new Uint8Array(n);
  const componentMap = new Int32Array(n);
  componentMap.fill(-1);
  const queue = new Int32Array(n);
  const components = [];
  let componentId = 0;

  for (let start = 0; start < n; start++) {
    if (visited[start] || labels[start] < 0) continue;
    const label = labels[start];
    let head = 0, tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels = [];
    let minX = width, minY = height, maxX = 0, maxY = 0;

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % width, y = (idx / width) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const candidates = [idx - 1, idx + 1, idx - width, idx + width];
      for (let d = 0; d < 4; d++) {
        const ni = candidates[d];
        if (ni < 0 || ni >= n || visited[ni] || labels[ni] !== label) continue;
        if ((d === 0 && x === 0) || (d === 1 && x === width - 1)) continue;
        visited[ni] = 1;
        queue[tail++] = ni;
      }
    }

    if (pixels.length >= minArea) {
      for (const idx of pixels) componentMap[idx] = componentId;
      components.push({ id: componentId, label, area: pixels.length, minX, minY, maxX, maxY });
      componentId++;
    }
  }
  return { components, componentMap };
}

function pointKey(x, y) { return `${x},${y}`; }

function buildContours(component, componentMap, width, height) {
  const edges = [];
  const { id, minX, minY, maxX, maxY } = component;
  const isOwn = (x, y) => x >= 0 && y >= 0 && x < width && y < height && componentMap[y * width + x] === id;
  const add = (x1, y1, x2, y2, dir) => edges.push({ x1, y1, x2, y2, dir, used: false });

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isOwn(x, y)) continue;
      if (!isOwn(x, y - 1)) add(x, y, x + 1, y, 0);
      if (!isOwn(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
      if (!isOwn(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
      if (!isOwn(x - 1, y)) add(x, y + 1, x, y, 3);
    }
  }

  const outgoing = new Map();
  edges.forEach((e, i) => {
    const k = pointKey(e.x1, e.y1);
    if (!outgoing.has(k)) outgoing.set(k, []);
    outgoing.get(k).push(i);
  });

  const loops = [];
  const turnRank = (from, to) => {
    const turn = (to - from + 4) % 4;
    return turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
  };

  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const first = edges[i];
    const loop = [[first.x1, first.y1]];
    let current = i;
    let guard = 0;
    while (guard++ < edges.length + 8) {
      const e = edges[current];
      if (e.used) break;
      e.used = true;
      loop.push([e.x2, e.y2]);
      if (e.x2 === first.x1 && e.y2 === first.y1) break;
      const candidates = (outgoing.get(pointKey(e.x2, e.y2)) || []).filter(j => !edges[j].used);
      if (!candidates.length) break;
      candidates.sort((a, b) => turnRank(e.dir, edges[a].dir) - turnRank(e.dir, edges[b].dir));
      current = candidates[0];
    }
    if (loop.length >= 4) {
      if (loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]) loop.pop();
      loops.push(loop);
    }
  }
  return loops;
}

function perpendicularDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return Math.hypot(p[0] - x, p[1] - y);
}

function rdpOpen(points, epsilon) {
  if (points.length <= 2) return points.slice();
  let maxD = -1, index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; index = i; }
  }
  if (maxD <= epsilon) return [points[0], points[points.length - 1]];
  const left = rdpOpen(points.slice(0, index + 1), epsilon);
  const right = rdpOpen(points.slice(index), epsilon);
  return left.slice(0, -1).concat(right);
}

function removeCollinear(points) {
  if (points.length < 4) return points.slice();
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[(i - 1 + points.length) % points.length];
    const b = points[i];
    const c = points[(i + 1) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  return out.length >= 3 ? out : points.slice();
}

export function simplifyClosedPolygon(points, epsilon = 1.5) {
  if (points.length <= 4 || epsilon <= 0) return removeCollinear(points);
  const pts = removeCollinear(points);
  if (pts.length <= 4) return pts;
  let ia = 0, ib = 1, best = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
      const d = dx * dx + dy * dy;
      if (d > best) { best = d; ia = i; ib = j; }
    }
  }
  const arc = (start, end) => {
    const arr = [pts[start]];
    let i = start;
    while (i !== end) { i = (i + 1) % pts.length; arr.push(pts[i]); }
    return arr;
  };
  const a = rdpOpen(arc(ia, ib), epsilon);
  const b = rdpOpen(arc(ib, ia), epsilon);
  const merged = a.slice(0, -1).concat(b.slice(0, -1));
  return removeCollinear(merged);
}

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function detectRoundShape(points, tolerance = 0.08) {
  if (points.length < 8) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
  if (rx < 2 || ry < 2) return null;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let err = 0;
  for (const [x, y] of points) {
    const nr = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    err += Math.abs(nr - 1);
  }
  err /= points.length;
  if (err > tolerance) return null;
  const aspectDelta = Math.abs(rx - ry) / Math.max(rx, ry);
  return aspectDelta <= tolerance * 1.15
    ? { type: 'circle', cx, cy, r: (rx + ry) / 2, error: err }
    : { type: 'ellipse', cx, cy, rx, ry, error: err };
}

function fmt(v, precision) {
  const p = Math.pow(10, precision);
  const n = Math.round(v * p) / p;
  return Number.isInteger(n) ? String(n) : String(n);
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

function objectMarkup(object, precision = 2) {
  const common = `id="${object.id}" data-object-id="${object.id}" data-cluster="${object.cluster}" fill="${object.fill}"${object.opacity < 0.995 ? ` opacity="${fmt(object.opacity, 3)}"` : ''}`;
  if (object.type === 'circle') {
    return `<circle ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" r="${fmt(object.r, precision)}"/>`;
  }
  if (object.type === 'ellipse') {
    return `<ellipse ${common} cx="${fmt(object.cx, precision)}" cy="${fmt(object.cy, precision)}" rx="${fmt(object.rx, precision)}" ry="${fmt(object.ry, precision)}"/>`;
  }
  if (object.rings?.length > 1) {
    return `<path ${common} d="${pathForRings(object.rings, precision)}" fill-rule="evenodd"/>`;
  }
  return `<polygon ${common} points="${pointsAttribute(object.rings?.[0] || object.points || [], precision)}"/>`;
}

export function serializeObjectsToSvg(objects, width, height, precision = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width, precision)} ${fmt(height, precision)}" width="${fmt(width, precision)}" height="${fmt(height, precision)}">\n${objects.map(o => `  ${objectMarkup(o, precision)}`).join('\n')}\n</svg>`;
}

export function vectorizeImage(imageData, options = {}, progress = () => {}) {
  const width = imageData.width, height = imageData.height, data = imageData.data;
  const clusters = clamp(Math.round(options.clusters ?? 8), 1, 32);
  const minArea = Math.max(1, options.minArea ?? 8);
  const epsilon = Math.max(0, options.simplify ?? 1.5);
  const detectGeometry = options.detectGeometry !== false;
  const shapeTolerance = clamp(options.shapeTolerance ?? 0.08, 0.01, 0.3);
  const originalWidth = options.originalWidth ?? width;
  const originalHeight = options.originalHeight ?? height;
  const precision = clamp(options.precision ?? 2, 0, 4);
  const sx = originalWidth / width, sy = originalHeight / height;

  progress(0.05, `Clustering into ${clusters} colors`);
  const clustered = clusterColors(data, clusters, options.clusterIterations ?? 9);
  progress(0.35, 'Finding connected objects');
  const { components, componentMap } = findComponents(clustered.labels, width, height, minArea);

  const objects = [];
  let pointsBefore = 0, pointsAfter = 0, circles = 0, ellipses = 0, compoundObjects = 0;
  const sorted = components.sort((a, b) => b.area - a.area);
  sorted.forEach((component, idx) => {
    const rawLoops = buildContours(component, componentMap, width, height)
      .filter(loop => Math.abs(polygonArea(loop)) >= 1)
      .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    if (!rawLoops.length) return;
    pointsBefore += rawLoops.reduce((s, l) => s + l.length, 0);

    const palette = clustered.palette[component.label] || { color: '#000000', alpha: 1 };
    const id = `object-${String(objects.length + 1).padStart(3, '0')}`;
    const base = {
      id,
      cluster: component.label,
      fill: palette.color,
      opacity: palette.alpha,
      area: component.area,
      sourceBounds: [component.minX, component.minY, component.maxX, component.maxY]
    };

    let round = null;
    if (detectGeometry && rawLoops.length === 1) round = detectRoundShape(rawLoops[0], shapeTolerance);
    if (round?.type === 'circle') {
      circles++;
      pointsAfter += 1;
      objects.push({ ...base, type: 'circle', cx: round.cx * sx, cy: round.cy * sy, r: round.r * (sx + sy) / 2 });
    } else if (round?.type === 'ellipse') {
      ellipses++;
      pointsAfter += 1;
      objects.push({ ...base, type: 'ellipse', cx: round.cx * sx, cy: round.cy * sy, rx: round.rx * sx, ry: round.ry * sy });
    } else {
      const rings = rawLoops.map(loop => simplifyClosedPolygon(loop, epsilon).map(([x, y]) => [x * sx, y * sy]));
      if (rings.length > 1) compoundObjects++;
      pointsAfter += rings.reduce((s, l) => s + l.length, 0);
      objects.push({ ...base, type: 'polygon', rings });
    }
    if (idx % 5 === 0) progress(0.4 + 0.5 * (idx + 1) / Math.max(1, sorted.length), 'Tracing editable objects');
  });

  progress(0.95, 'Serializing editable SVG');
  const svg = serializeObjectsToSvg(objects, originalWidth, originalHeight, precision);
  progress(1, 'Done');
  return {
    svg,
    width: originalWidth,
    height: originalHeight,
    precision,
    objects,
    palette: clustered.palette.filter(p => p.count > 0),
    stats: {
      requestedClusters: clusters,
      clusters: clustered.palette.filter(p => p.count > 0).length,
      components: components.length,
      shapes: objects.length,
      polygons: objects.filter(o => o.type === 'polygon').length,
      compoundObjects,
      circles,
      ellipses,
      pointsBefore,
      pointsAfter,
      reduction: pointsBefore ? 1 - pointsAfter / pointsBefore : 0,
      svgBytes: new TextEncoder().encode(svg).length
    }
  };
}
