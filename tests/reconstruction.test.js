import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRectPrimitive, detectRoundPrimitive, smoothClusterLabels, catmullRomClosedPath } from '../src/reconstruction.js';
import { vectorizeImage } from '../src/vectorizer.js';
import { serializeObjectsToSvg } from '../src/serializer.js';
import { normalizeOcrLines } from '../src/ocr.js';

test('detects axis-aligned rectangles as native rect primitives', () => {
  const points = [[0,0],[20,0],[20,10],[0,10]];
  const rect = detectRectPrimitive(points, 0.08);
  assert.equal(rect.type, 'rect');
  assert.equal(rect.width, 20);
  assert.equal(rect.height, 10);
});

test('snaps a hexagonal raster approximation to a circle', () => {
  const points = Array.from({ length: 6 }, (_, i) => {
    const a = i / 6 * Math.PI * 2;
    return [50 + Math.cos(a) * 20, 50 + Math.sin(a) * 20];
  });
  const round = detectRoundPrimitive(points, 0.08);
  assert.equal(round.type, 'circle');
});

test('anti-alias cleanup replaces isolated cluster labels with neighborhood majority', () => {
  const width = 5, height = 5;
  const labels = new Int16Array(width * height).fill(1);
  labels[12] = 2;
  const cleaned = smoothClusterLabels(labels, width, height, 1);
  assert.equal(cleaned[12], 1);
});

test('Catmull-Rom conversion emits cubic SVG path commands', () => {
  const d = catmullRomClosedPath([[0,0],[10,0],[12,8],[5,12],[0,8]]);
  assert.match(d, /^M/);
  assert.match(d, /C/);
  assert.match(d, /Z$/);
});

test('vectorizer reconstructs a filled raster card as a native rectangle', () => {
  const width = 12, height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 20; data[i + 1] = 80; data[i + 2] = 180; data[i + 3] = 255;
  }
  const result = vectorizeImage({ width, height, data }, {
    clusters: 1,
    minArea: 1,
    simplify: 0.2,
    detectGeometry: true,
    detectRectangles: true,
    edgeCleanup: 0
  });
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].type, 'rect');
  assert.equal(result.stats.rectangles, 1);
});

test('serializer preserves text width fitting and semantic SVG groups', () => {
  const svg = serializeObjectsToSvg([{
    id: 'text-001', cluster: -1, type: 'text', text: 'Semantic SVG', x: 10, y: 30,
    fontFamily: 'Arial', fontSize: 20, fontWeight: 700, textLength: 120,
    lengthAdjust: 'spacingAndGlyphs', fill: '#111111', opacity: 1,
    groupId: 'text-block-01', semanticRole: 'text-line'
  }], 200, 100, 1);
  assert.match(svg, /<g id="text-block-01"/);
  assert.match(svg, /textLength="120"/);
  assert.match(svg, /lengthAdjust="spacingAndGlyphs"/);
});

test('OCR hierarchy reconstructs one object per detected line instead of per word', () => {
  const lines = normalizeOcrLines({ blocks: [{ paragraphs: [{ lines: [{
    text: 'One consistent line',
    bbox: { x0: 10, y0: 5, x1: 180, y1: 30 },
    words: [
      { text: 'One', confidence: 95, bbox: { x0: 10, y0: 5, x1: 42, y1: 30 } },
      { text: 'consistent', confidence: 94, bbox: { x0: 48, y0: 5, x1: 120, y1: 30 } },
      { text: 'line', confidence: 96, bbox: { x0: 128, y0: 5, x1: 180, y1: 30 } }
    ]
  }] }] }] }, 55);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'One consistent line');
  assert.equal(lines[0].groupId, 'text-block-01');
});
