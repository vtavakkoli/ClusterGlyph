import test from 'node:test';
import assert from 'node:assert/strict';
import { pngDimensions } from '../src/png-export.js';

test('PNG export uses original vector dimensions and the requested scale', () => {
  assert.deepEqual(pngDimensions(1672, 941, 2), { width: 3344, height: 1882 });
  assert.deepEqual(pngDimensions(1, 1), { width: 1, height: 1 });
});

test('PNG export rejects invalid or excessive canvas sizes before rendering', () => {
  for (const args of [[0, 10], [10, Infinity], [10, 10, 0], [10, 10, NaN]]) assert.throws(() => pngDimensions(...args), /positive numbers/);
  assert.throws(() => pngDimensions(4000, 3000, 2), /too large/);
  assert.throws(() => pngDimensions(17000, 1), /too large/);
});
