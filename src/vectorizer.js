import { serializeObjectsToSvg } from './serializer.js';
import {
  polygonArea,
  detectRectPrimitive,
  detectRoundPrimitive,
  shouldUseBezier,
  catmullRomClosedPath,
  smoothClusterLabels,
  assignSemanticGroups
} from './reconstruction.js';

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

export function detectRoundShape(points, tolerance = 0.08) {
  return detectRoundPrimitive(points, tolerance);
}

function detectLineComponent(component, sx, sy) {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  const short = Math.min(width, height), long = Math.max(width, height);
  if (short > 5 || long / Math.max(1, short) < 5 || component.area < long * 0.6) return null;
  if (width >= height) {
    return {
      type: 'line',
      x1: component.minX * sx,
      y1: ((component.minY + component.maxY + 1) / 2) * sy,
      x2: (component.maxX + 1) * sx,
      y2: ((component.minY + component.maxY + 1) / 2) * sy,
      strokeWidth: height * sy
    };
  }
  return {
    type: 'line',
    x1: ((component.minX + component.maxX + 1) / 2) * sx,
    y1: component.minY * sy,
    x2: ((component.minX + component.maxX + 1) / 2) * sx,
    y2: (component.maxY + 1) * sy,
    strokeWidth: width * sx
  };
}

export function vectorizeImage(imageData, options = {}, progress = () => {}) {
  const width = imageData.width, height = imageData.height, data = imageData.data;
  const clusters = clamp(Math.round(options.clusters ?? 8), 1, 32);
  const minArea = Math.max(1, options.minArea ?? 8);
  const epsilon = Math.max(0, options.simplify ?? 1.5);
  const detectGeometry = options.detectGeometry !== false;
  const detectRectangles = options.detectRectangles !== false;
  const fitCurves = options.fitCurves !== false;
  const edgeCleanup = clamp(Math.round(options.edgeCleanup ?? 1), 0, 3);
  const shapeTolerance = clamp(options.shapeTolerance ?? 0.08, 0.01, 0.3);
  const originalWidth = options.originalWidth ?? width;
  const originalHeight = options.originalHeight ?? height;
  const precision = clamp(options.precision ?? 2, 0, 4);
  const sx = originalWidth / width, sy = originalHeight / height;

  progress(0.05, `Clustering into ${clusters} colors`);
  const clustered = clusterColors(data, clusters, options.clusterIterations ?? 9);
  const labels = edgeCleanup ? smoothClusterLabels(clustered.labels, width, height, edgeCleanup) : clustered.labels;
  progress(0.3, edgeCleanup ? 'Merging anti-aliased edge fragments' : 'Finding connected objects');
  const { components, componentMap } = findComponents(labels, width, height, minArea);

  const objects = [];
  let pointsBefore = 0, pointsAfter = 0;
  let circles = 0, ellipses = 0, rectangles = 0, roundedRects = 0, lines = 0, paths = 0, compoundObjects = 0;
  const sorted = components.sort((a, b) => b.area - a.area);
  sorted.forEach((component, idx) => {
    const rawLoops = buildContours(component, componentMap, width, height)
      .filter(loop => Math.abs(polygonArea(loop)) >= 1)
      .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    if (!rawLoops.length) return;
    pointsBefore += rawLoops.reduce((s, l) => s + l.length, 0);

    const palette = clustered.palette[component.label] || { color: '#000000', alpha: 1 };
    const id = `object-${String(objects.length + 1).padStart(3, '0')}`;
    const bounds = [component.minX * sx, component.minY * sy, (component.maxX + 1) * sx, (component.maxY + 1) * sy];
    const base = {
      id,
      cluster: component.label,
      fill: palette.color,
      opacity: palette.alpha,
      area: component.area,
      sourceBounds: [component.minX, component.minY, component.maxX, component.maxY],
      bounds
    };

    const line = detectGeometry ? detectLineComponent(component, sx, sy) : null;
    if (line) {
      lines++;
      pointsAfter += 2;
      objects.push({ ...base, ...line, stroke: palette.color, semanticRole: 'line' });
    } else {
      const rect = detectGeometry && detectRectangles && rawLoops.length === 1 ? detectRectPrimitive(rawLoops[0], shapeTolerance) : null;
      const round = detectGeometry && !rect && rawLoops.length === 1 ? detectRoundPrimitive(rawLoops[0], shapeTolerance) : null;
      if (rect?.type === 'rect') {
        rectangles++;
        pointsAfter += 1;
        objects.push({ ...base, type: 'rect', x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy, semanticRole: 'rectangle' });
      } else if (rect?.type === 'roundedRect') {
        roundedRects++;
        pointsAfter += 1;
        objects.push({ ...base, type: 'roundedRect', x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy, rx: rect.rx * (sx + sy) / 2, semanticRole: 'rounded-rectangle' });
      } else if (round?.type === 'circle') {
        circles++;
        pointsAfter += 1;
        objects.push({ ...base, type: 'circle', cx: round.cx * sx, cy: round.cy * sy, r: round.r * (sx + sy) / 2, semanticRole: 'circle' });
      } else if (round?.type === 'ellipse') {
        ellipses++;
        pointsAfter += 1;
        objects.push({ ...base, type: 'ellipse', cx: round.cx * sx, cy: round.cy * sy, rx: round.rx * sx, ry: round.ry * sy, semanticRole: 'ellipse' });
      } else {
        const rings = rawLoops.map(loop => simplifyClosedPolygon(loop, epsilon).map(([x, y]) => [x * sx, y * sy]));
        if (rings.length > 1) compoundObjects++;
        const mainRing = rings[0] || [];
        if (fitCurves && rings.length === 1 && mainRing.length >= 8 && shouldUseBezier(mainRing)) {
          paths++;
          pointsAfter += mainRing.length;
          objects.push({ ...base, type: 'path', pathData: catmullRomClosedPath(mainRing), rings, semanticRole: 'smooth-path' });
        } else {
          pointsAfter += rings.reduce((s, l) => s + l.length, 0);
          objects.push({ ...base, type: 'polygon', rings, semanticRole: rings.length > 1 ? 'compound-shape' : 'polygon' });
        }
      }
    }
    if (idx % 5 === 0) progress(0.36 + 0.55 * (idx + 1) / Math.max(1, sorted.length), 'Reconstructing semantic SVG primitives');
  });

  assignSemanticGroups(objects, originalWidth, originalHeight);
  progress(0.95, 'Serializing semantic SVG');
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
      rectangles,
      roundedRects,
      lines,
      paths,
      pointsBefore,
      pointsAfter,
      reduction: pointsBefore ? 1 - pointsAfter / pointsBefore : 0,
      svgBytes: new TextEncoder().encode(svg).length
    }
  };
}
