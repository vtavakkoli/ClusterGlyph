import test from 'node:test';
import assert from 'node:assert/strict';
import { vectorizeImage, simplifyClosedPolygon, cleanColorLabels } from '../src/vectorizer.js';
import { objectsForBackground, serializeObjectsToSvg, pathForRings } from '../src/serializer.js';

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const area = points => Math.abs(points.reduce((sum, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length];
  return sum + x * ny - nx * y;
}, 0) / 2);

test('smooths shallow contour turns while preserving sharp rectangle corners', () => {
  const curve = [[0, 0], [5, 0], [8, 1], [10, 4], [10, 10], [0, 10]];
  assert.match(pathForRings([curve], 2, 0.7), /Q/);
  const rectangle = { id: 'box', type: 'polygon', fill: '#123456', curveSmoothing: 0.7, rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]] };
  assert.match(serializeObjectsToSvg([rectangle], 10, 10), /<polygon /);
  assert.doesNotMatch(serializeObjectsToSvg([rectangle], 10, 10), /Q/);
});

test('merges tiny color regions without leaving a hole in the painted area', () => {
  const raster = image(7, 7, (x, y) => x === 3 && y === 3 ? [0, 255, 0, 255] : [255, 0, 0, 255]);
  const result = vectorizeImage(raster, { clusters: 2, minArea: 3, simplify: 0, detectGeometry: false, cleanEdges: false });
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].area, 49);
  assert.equal(result.objects[0].rings.length, 1);
  assert.equal(area(result.objects[0].rings[0]), 49);
  assert.equal(result.stats.mergedPixels, 1);
});

test('fully transparent input produces an empty SVG instead of a black region', () => {
  const result = vectorizeImage(image(8, 8, () => [0, 0, 0, 0]));
  assert.equal(result.objects.length, 0);
  assert.equal(result.palette.length, 0);
  assert.doesNotMatch(result.svg, /<(polygon|path|circle|ellipse) /);
});

test('keeps isolated foreground details on transparency when there is no neighbor to merge into', () => {
  const result = vectorizeImage(image(7, 7, (x, y) => x === 3 && y === 3 ? [255, 0, 0, 255] : [0, 0, 0, 0]), { minArea: 8 });
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].area, 1);
  assert.equal(result.objects[0].isBackground, false);
});

test('aggressive simplification preserves a narrow bent line and its area', () => {
  const line = [[0, 0], [8, 0], [8, 1], [1, 1], [1, 8], [0, 8]];
  const simplified = simplifyClosedPolygon(line, 6);
  assert.ok(simplified.length >= 3);
  assert.ok(Math.abs(area(simplified) / area(line) - 1) <= 0.12);
});

test('color cleanup removes similar-color speckles and retains a contrasting thin line', () => {
  const palette = [{ color: '#102030' }, { color: '#142434' }, { color: '#ffffff' }];
  const speckle = new Int16Array(25);
  speckle[12] = 1;
  assert.equal(cleanColorLabels(speckle, 5, 5, palette)[12], 0);
  const line = new Int16Array(25).fill(2);
  for (let y = 0; y < 5; y++) line[y * 5 + 2] = 0;
  assert.deepEqual(cleanColorLabels(line, 5, 5, palette), line);
});

test('removes an edge-connected colored background and preserves enclosed white foreground', () => {
  const raster = image(21, 21, (x, y) => {
    if (x >= 9 && x <= 11 && y >= 9 && y <= 11) return [255, 255, 255, 255];
    if (x >= 5 && x <= 15 && y >= 5 && y <= 15) return [10, 30, 130, 255];
    return [240, 190, 150, 255];
  });
  const result = vectorizeImage(raster, { clusters: 3, minArea: 1, simplify: 0, detectGeometry: false });
  const visible = objectsForBackground(result.objects, 'transparent');
  assert.equal(result.objects.filter(o => o.isBackground).length, 1);
  assert.equal(visible.length, 2);
  assert.ok(visible.some(o => o.fill === '#ffffff'));
  const transparent = serializeObjectsToSvg(result.objects, 21, 21, 2, { backgroundMode: 'transparent' });
  assert.doesNotMatch(transparent, /fill="#f0be96"/);
  assert.match(transparent, /fill="#ffffff"/);
  const custom = serializeObjectsToSvg(result.objects, 21, 21, 2, { backgroundMode: 'custom', backgroundColor: '#334455' });
  assert.match(custom, /<rect id="canvas-background"[^>]*fill="#334455"/);
  assert.match(custom, /fill="#ffffff"/);
});

test('palette entries retain the cluster IDs used by objects after noise merging', () => {
  const raster = image(8, 4, (x, y) => {
    if (x === 1 && y === 1) return [0, 255, 0, 255];
    return x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255];
  });
  const result = vectorizeImage(raster, { clusters: 3, minArea: 2, cleanEdges: false });
  for (const object of result.objects) assert.equal(result.palette.find(p => p.cluster === object.cluster)?.color, object.fill);
});
