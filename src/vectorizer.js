import { serializeObjectsToSvg } from './serializer.js';
export { serializeObjectsToSvg } from './serializer.js';

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
  if (!samples.length) return { centroids: [], labels: new Int16Array(data.length / 4).fill(-1), palette: [] };
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

// Suppress low-contrast color speckles without blurring contrasting thin strokes.
export function cleanColorLabels(labels, width, height, palette) {
  const colors = palette.map(p => rgbToLab(...p.color.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16))));
  const out = new Int16Array(labels);
  const counts = new Uint8Array(palette.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, label = labels[i];
    if (label < 0) continue;
    counts.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const neighbor = labels[i + dy * width + dx];
      if (neighbor >= 0) counts[neighbor]++;
    }
    if (counts[label] > 2) continue;
    let best = label;
    for (let c = 0; c < counts.length; c++) if (counts[c] > counts[best]) best = c;
    if (counts[best] >= 5 && dist3(colors[label], colors[best]) < 16 * 16) out[i] = best;
  }
  return out;
}

// Merge noise into an adjacent color instead of leaving unpainted holes.
// Isolated details on a transparent raster are retained when no neighbor exists.
export function mergeSmallRegions(labels, width, height, palette, minArea) {
  if (minArea <= 1) return { labels, mergedPixels: 0 };
  const { components, componentMap } = findComponents(labels, width, height, 1);
  const parent = Int32Array.from(components, c => c.id);
  const areas = Float64Array.from(components, c => c.area);
  const adjacency = components.map(() => new Map());
  const colors = palette.map(p => rgbToLab(...p.color.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16))));
  const root = id => {
    while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
    return id;
  };
  const connect = (a, b) => {
    if (a < 0 || b < 0 || a === b) return;
    adjacency[a].set(b, (adjacency[a].get(b) || 0) + 1);
    adjacency[b].set(a, (adjacency[b].get(a) || 0) + 1);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x + 1 < width) connect(componentMap[i], componentMap[i + 1]);
    if (y + 1 < height) connect(componentMap[i], componentMap[i + width]);
  }
  for (const component of [...components].sort((a, b) => a.area - b.area)) {
    const from = root(component.id);
    if (from !== component.id || areas[from] >= minArea) continue;
    let to = -1, bestScore = Infinity;
    for (const [neighbor, sharedEdges] of adjacency[from]) {
      const candidate = root(neighbor);
      if (candidate === from) continue;
      const distance = dist3(colors[components[from].label], colors[components[candidate].label]);
      const score = distance / (1 + Math.log2(1 + sharedEdges));
      if (score < bestScore) { bestScore = score; to = candidate; }
    }
    if (to < 0) continue;
    parent[from] = to;
    areas[to] += areas[from];
    for (const [neighbor, sharedEdges] of adjacency[from]) {
      const other = root(neighbor);
      if (other === to) continue;
      adjacency[to].set(other, (adjacency[to].get(other) || 0) + sharedEdges);
      adjacency[other].delete(from);
      adjacency[other].set(to, (adjacency[other].get(to) || 0) + sharedEdges);
    }
    adjacency[to].delete(from);
    adjacency[from].clear();
  }
  const out = new Int16Array(labels);
  let mergedPixels = 0;
  for (let i = 0; i < out.length; i++) {
    if (componentMap[i] < 0) continue;
    out[i] = components[root(componentMap[i])].label;
    if (out[i] !== labels[i]) mergedPixels++;
  }
  return { labels: out, mergedPixels };
}

function backgroundComponents(labels, componentMap, width, height, palette) {
  const counts = new Uint32Array(palette.length);
  const border = new Set();
  for (let x = 0; x < width; x++) { border.add(x); border.add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { border.add(y * width); border.add(y * width + width - 1); }
  let opaque = 0, best = -1;
  for (const i of border) if (labels[i] >= 0) {
    opaque++;
    const label = labels[i];
    counts[label]++;
    if (best < 0 || counts[label] > counts[best]) best = label;
  }
  if (best < 0 || counts[best] < opaque * 0.2) return new Set();
  const colors = palette.map(p => rgbToLab(...p.color.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16))));
  const allowed = colors.map(color => dist3(color, colors[best]) <= 12 * 12);
  const seen = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let head = 0, tail = 0;
  const visit = i => {
    if (!seen[i] && labels[i] >= 0 && allowed[labels[i]]) { seen[i] = 1; queue[tail++] = i; }
  };
  for (const i of border) visit(i);
  const ids = new Set();
  while (head < tail) {
    const i = queue[head++], x = i % width;
    ids.add(componentMap[i]);
    if (x > 0) visit(i - 1);
    if (x + 1 < width) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < labels.length) visit(i + width);
  }
  return ids;
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
  const farthest = origin => {
    let index = 0, distance = -1;
    pts.forEach((p, i) => {
      const d = (p[0] - pts[origin][0]) ** 2 + (p[1] - pts[origin][1]) ** 2;
      if (d > distance) { distance = d; index = i; }
    });
    return index;
  };
  const ia = farthest(0), ib = farthest(ia);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  epsilon = Math.min(epsilon, (maxX - minX) / 4, (maxY - minY) / 4);
  const arc = (start, end) => {
    const arr = [pts[start]];
    let i = start;
    while (i !== end) { i = (i + 1) % pts.length; arr.push(pts[i]); }
    return arr;
  };
  const originalArea = polygonArea(pts);
  for (let attempt = 0; attempt < 5; attempt++, epsilon /= 2) {
    const a = rdpOpen(arc(ia, ib), epsilon);
    const b = rdpOpen(arc(ib, ia), epsilon);
    const merged = removeCollinear(a.slice(0, -1).concat(b.slice(0, -1)));
    const area = polygonArea(merged);
    if (merged.length >= 3 && area * originalArea > 0 && Math.abs(area / originalArea - 1) <= 0.12) return merged;
  }
  return pts;
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
  let err = 0, maxError = 0;
  for (const [x, y] of points) {
    const nr = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    err += Math.abs(nr - 1);
    maxError = Math.max(maxError, Math.abs(nr - 1));
  }
  err /= points.length;
  const areaRatio = Math.abs(polygonArea(points)) / (Math.PI * rx * ry);
  if (err > tolerance || maxError > tolerance * 3 || Math.abs(areaRatio - 1) > 0.12) return null;
  const aspectDelta = Math.abs(rx - ry) / Math.max(rx, ry);
  return aspectDelta <= tolerance * 1.15
    ? { type: 'circle', cx, cy, r: (rx + ry) / 2, error: err }
    : { type: 'ellipse', cx, cy, rx, ry, error: err };
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
  progress(0.3, 'Cleaning color regions');
  const cleaned = options.cleanEdges === false ? clustered.labels : cleanColorLabels(clustered.labels, width, height, clustered.palette);
  const merged = mergeSmallRegions(cleaned, width, height, clustered.palette, minArea);
  clustered.labels = merged.labels;
  clustered.palette.forEach(p => { p.count = 0; });
  for (const label of clustered.labels) if (label >= 0) clustered.palette[label].count++;
  progress(0.35, 'Finding connected objects');
  const { components, componentMap } = findComponents(clustered.labels, width, height, 1);
  const backgroundIds = backgroundComponents(clustered.labels, componentMap, width, height, clustered.palette);

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
      rawPoints: rawLoops.reduce((sum, loop) => sum + loop.length, 0),
      isBackground: backgroundIds.has(component.id),
      seamWidth: options.closeGaps === false ? 0 : 0.7 * Math.max(sx, sy),
      curveSmoothing: options.smoothContours === false ? 0 : 0.7 * Math.max(sx, sy),
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
  const svg = serializeObjectsToSvg(objects, originalWidth, originalHeight, precision, options);
  progress(1, 'Done');
  return {
    svg,
    width: originalWidth,
    height: originalHeight,
    precision,
    objects,
    palette: clustered.palette.map((p, cluster) => ({ ...p, cluster })).filter(p => p.count > 0),
    stats: {
      requestedClusters: clusters,
      clusters: clustered.palette.filter(p => p.count > 0).length,
      components: components.length,
      mergedPixels: merged.mergedPixels,
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
