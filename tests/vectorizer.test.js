import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyClosedPolygon, detectRoundShape, vectorizeImage, serializeObjectsToSvg } from '../src/vectorizer.js';

test('simplifies a rectangle contour to four corners', () => {
  const pts = [[0,0],[1,0],[2,0],[3,0],[3,1],[3,2],[3,3],[2,3],[1,3],[0,3],[0,2],[0,1]];
  const out = simplifyClosedPolygon(pts, 0.1);
  assert.equal(out.length, 4);
});

test('detects a circle-like contour', () => {
  const pts = Array.from({length: 64}, (_, i) => {
    const a = i / 64 * Math.PI * 2;
    return [50 + Math.cos(a) * 20, 50 + Math.sin(a) * 20];
  });
  const shape = detectRoundShape(pts, 0.02);
  assert.equal(shape.type, 'circle');
});

test('respects requested cluster count and creates separate connected objects', () => {
  const width = 9, height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const redObject = x < 3 || x >= 6;
    data[i] = redObject ? 240 : 20;
    data[i + 1] = redObject ? 30 : 120;
    data[i + 2] = redObject ? 30 : 240;
    data[i + 3] = 255;
  }
  const result = vectorizeImage({width, height, data}, {clusters: 2, minArea: 1, simplify: 0.2, detectGeometry: false});
  assert.equal(result.stats.requestedClusters, 2);
  assert.equal(result.stats.clusters, 2);
  assert.equal(result.objects.length, 3);
  assert.deepEqual(result.objects.map(o => o.id), ['object-001', 'object-002', 'object-003']);
});

test('exports simple connected regions as editable polygon elements', () => {
  const width = 6, height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    data[i] = x < 3 ? 245 : 30;
    data[i + 1] = x < 3 ? 40 : 150;
    data[i + 2] = x < 3 ? 40 : 230;
    data[i + 3] = 255;
  }
  const result = vectorizeImage({width, height, data}, {clusters: 2, minArea: 1, simplify: 0.2, detectGeometry: false});
  assert.match(result.svg, /<polygon id="object-001"/);
  assert.match(result.svg, /data-cluster="/);
  assert.ok(result.objects.every(o => o.type === 'polygon'));
});

test('serializes edited object geometry back into SVG', () => {
  const objects = [{ id: 'object-001', cluster: 0, type: 'polygon', fill: '#ff0000', opacity: 1, rings: [[[0,0],[10,0],[10,10],[0,10]]] }];
  objects[0].rings[0][1] = [12, 1];
  const svg = serializeObjectsToSvg(objects, 20, 20, 1);
  assert.match(svg, /12,1/);
  assert.match(svg, /id="object-001"/);
});
