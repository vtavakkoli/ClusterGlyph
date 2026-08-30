const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function polygonPerimeter(points) {
  let p = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function boundsOfPoints(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

export function detectRectPrimitive(points, tolerance = 0.08) {
  if (!points || points.length < 4) return null;
  const b = boundsOfPoints(points);
  if (b.width < 3 || b.height < 3) return null;
  const boxArea = b.width * b.height;
  const area = Math.abs(polygonArea(points));
  const fillRatio = area / Math.max(1, boxArea);
  const scale = Math.max(1, Math.min(b.width, b.height));
  let sideDistance = 0;
  for (const [x, y] of points) {
    sideDistance += Math.min(
      Math.abs(x - b.minX), Math.abs(x - b.maxX),
      Math.abs(y - b.minY), Math.abs(y - b.maxY)
    ) / scale;
  }
  sideDistance /= points.length;

  const strict = Math.max(0.018, tolerance * 0.45);
  if (fillRatio >= 0.965 && sideDistance <= strict) {
    return { type: 'rect', x: b.minX, y: b.minY, width: b.width, height: b.height, rx: 0, score: 1 - fillRatio + sideDistance };
  }

  // Rounded UI cards occupy most of their axis-aligned bounding box, but the
  // corner arc pulls a subset of contour points away from the four box sides.
  if (fillRatio >= 0.74 && sideDistance <= Math.max(0.075, tolerance * 1.35)) {
    const missing = clamp(1 - fillRatio, 0.01, 0.24);
    const radius = clamp(scale * Math.sqrt(missing) * 0.72, 2, scale * 0.28);
    return { type: 'roundedRect', x: b.minX, y: b.minY, width: b.width, height: b.height, rx: radius, score: missing + sideDistance };
  }
  return null;
}

export function detectRoundPrimitive(points, tolerance = 0.08) {
  if (!points || points.length < 6) return null;
  const b = boundsOfPoints(points);
  const rx = b.width / 2, ry = b.height / 2;
  if (rx < 2 || ry < 2) return null;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const area = Math.abs(polygonArea(points));
  const perimeter = polygonPerimeter(points);
  const circularity = perimeter > 0 ? 4 * Math.PI * area / (perimeter * perimeter) : 0;

  let ellipseError = 0;
  const radii = [];
  for (const [x, y] of points) {
    const normalizedRadius = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    ellipseError += Math.abs(normalizedRadius - 1);
    radii.push(Math.hypot(x - cx, y - cy));
  }
  ellipseError /= points.length;
  const meanRadius = radii.reduce((a, b2) => a + b2, 0) / radii.length;
  const radiusVariance = radii.reduce((s, r) => s + (r - meanRadius) ** 2, 0) / radii.length;
  const radiusCv = Math.sqrt(radiusVariance) / Math.max(1e-6, meanRadius);
  const aspectDelta = Math.abs(rx - ry) / Math.max(rx, ry);

  // Circularity + radius variance deliberately accepts low-sided polygons
  // (hexagons/octagons) when they are clearly raster approximations of circles.
  if (
    aspectDelta <= Math.max(0.16, tolerance * 2.2) &&
    ellipseError <= Math.max(0.105, tolerance * 1.45) &&
    radiusCv <= Math.max(0.105, tolerance * 1.55) &&
    circularity >= 0.73
  ) {
    return { type: 'circle', cx, cy, r: (rx + ry) / 2, error: ellipseError, circularity, radiusCv };
  }

  if (ellipseError <= Math.max(0.11, tolerance * 1.6) && circularity >= 0.56 && aspectDelta <= 0.72) {
    return { type: 'ellipse', cx, cy, rx, ry, error: ellipseError, circularity, radiusCv };
  }
  return null;
}

function turnAngle(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const vx = c[0] - b[0], vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (!lu || !lv) return 0;
  const dot = clamp((ux * vx + uy * vy) / (lu * lv), -1, 1);
  return Math.acos(dot);
}

export function shouldUseBezier(points) {
  if (!points || points.length < 8) return false;
  const angles = points.map((p, i) => turnAngle(points[(i - 1 + points.length) % points.length], p, points[(i + 1) % points.length]));
  const sharp = angles.filter(a => a > 0.95).length / angles.length;
  const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
  return sharp <= 0.18 && mean <= 0.58;
}

function fmt(n) {
  const v = Math.round(n * 1000) / 1000;
  return Number.isInteger(v) ? String(v) : String(v);
}

export function catmullRomClosedPath(points, tension = 1) {
  if (!points || points.length < 3) return '';
  const t = clamp(tension, 0.25, 1.5);
  const n = points.length;
  const parts = [`M${fmt(points[0][0])} ${fmt(points[0][1])}`];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) * t / 6, p1[1] + (p2[1] - p0[1]) * t / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t / 6, p2[1] - (p3[1] - p1[1]) * t / 6];
    parts.push(`C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`);
  }
  parts.push('Z');
  return parts.join('');
}

export function smoothClusterLabels(labels, width, height, passes = 1) {
  let current = new Int16Array(labels);
  const iterations = clamp(Math.round(passes), 0, 3);
  const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (let pass = 0; pass < iterations; pass++) {
    const next = new Int16Array(current);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const own = current[idx];
        if (own < 0) continue;
        const counts = new Map();
        for (const off of offsets) {
          const label = current[idx + off];
          if (label >= 0) counts.set(label, (counts.get(label) || 0) + 1);
        }
        let majority = own, majorityCount = counts.get(own) || 0;
        for (const [label, count] of counts) {
          if (count > majorityCount) { majority = label; majorityCount = count; }
        }
        const ownCount = counts.get(own) || 0;
        if (majority !== own && majorityCount >= 5 && ownCount <= 2) next[idx] = majority;
      }
    }
    current = next;
  }
  return current;
}

export function objectBounds(object) {
  if (object.bounds) return object.bounds;
  if (object.type === 'circle') return [object.cx - object.r, object.cy - object.r, object.cx + object.r, object.cy + object.r];
  if (object.type === 'ellipse') return [object.cx - object.rx, object.cy - object.ry, object.cx + object.rx, object.cy + object.ry];
  if (object.type === 'rect' || object.type === 'roundedRect') return [object.x, object.y, object.x + object.width, object.y + object.height];
  const rings = object.rings || [];
  const pts = rings.flat();
  if (!pts.length) return object.sourceBounds || [0, 0, 0, 0];
  const b = boundsOfPoints(pts);
  return [b.minX, b.minY, b.maxX, b.maxY];
}

export function assignSemanticGroups(objects, width, height) {
  const imageArea = Math.max(1, width * height);
  const containers = objects
    .filter(o => o.type === 'rect' || o.type === 'roundedRect')
    .map(o => ({ object: o, bounds: objectBounds(o) }))
    .filter(({ bounds }) => {
      const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
      return w * h >= imageArea * 0.055 && w >= width * 0.2 && h >= height * 0.1;
    })
    .sort((a, b) => ((a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1])) - ((b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1])));

  containers.forEach(({ object }, index) => {
    object.groupId = `panel-${String(index + 1).padStart(2, '0')}`;
    object.semanticRole = 'container';
  });

  for (const object of objects) {
    if (object.semanticRole === 'container') continue;
    const b = objectBounds(object);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const parent = containers.find(({ bounds }) => cx >= bounds[0] && cx <= bounds[2] && cy >= bounds[1] && cy <= bounds[3]);
    if (parent) {
      object.groupId = parent.object.groupId;
      object.semanticRole = object.semanticRole || 'panel-content';
    } else {
      object.groupId = object.groupId || 'artwork';
      object.semanticRole = object.semanticRole || 'artwork';
    }
  }
  return objects;
}
