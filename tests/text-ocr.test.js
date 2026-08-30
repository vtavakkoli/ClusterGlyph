import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeObjectsToSvg } from '../src/serializer.js';
import { normalizeOcrWords, createTextObjects, maskDetectedText } from '../src/ocr.js';

test('serializes OCR output as native SVG text', () => {
  const svg = serializeObjectsToSvg([{
    id: 'text-001', cluster: -1, type: 'text', text: 'R&D < Lab', x: 12.5, y: 30,
    fontFamily: 'Arial', fontSize: 18, fontWeight: 700, fill: '#123456', opacity: 1
  }], 100, 60, 1);
  assert.match(svg, /<text /);
  assert.match(svg, /font-family="Arial"/);
  assert.match(svg, /font-size="18"/);
  assert.match(svg, />R&amp;D &lt; Lab<\/text>/);
});

test('filters low-confidence OCR words', () => {
  const words = normalizeOcrWords({ words: [
    { text: 'keep', confidence: 91, bbox: { x0: 1, y0: 1, x1: 20, y1: 10 } },
    { text: 'drop', confidence: 20, bbox: { x0: 1, y0: 12, x1: 20, y1: 20 } }
  ]}, 55);
  assert.deepEqual(words.map(word => word.text), ['keep']);
});

test('creates positioned editable text objects at original image scale', () => {
  const width = 20, height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  for (let y = 2; y < 8; y++) for (let x = 3; x < 12; x++) {
    const p = (y * width + x) * 4;
    data[p] = 10; data[p + 1] = 20; data[p + 2] = 30;
  }
  const words = [{ text: 'Hi', confidence: 96, bbox: { x0: 2, y0: 1, x1: 13, y1: 9 } }];
  const objects = createTextObjects(words, { width, height, data }, {
    originalWidth: 200,
    originalHeight: 100,
    measureText: (text, family, size) => text.length * size * 0.5
  });
  assert.equal(objects.length, 1);
  assert.equal(objects[0].type, 'text');
  assert.equal(objects[0].x, 20);
  assert.ok(objects[0].fontSize > 0);
  assert.match(objects[0].fill, /^#[0-9a-f]{6}$/i);
});

test('text masking keeps the same raster dimensions', () => {
  const width = 6, height = 4;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const masked = maskDetectedText({ width, height, data }, [
    { text: 'A', confidence: 99, bbox: { x0: 1, y0: 1, x1: 5, y1: 3 } }
  ]);
  assert.equal(masked.width, width);
  assert.equal(masked.height, height);
  assert.equal(masked.data.length, data.length);
});
