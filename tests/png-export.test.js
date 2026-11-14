import test from 'node:test';
import assert from 'node:assert/strict';
import { pngDimensions, svgToPngBlob } from '../src/png-export.js';

function mockRenderer(t, { fallback = false, rewrite = false } = {}) {
  const surfaces = [], images = [], revoked = [];
  const colors = [[255, 255, 255, 255], [0, 0, 0, 255], [0, 102, 255, 255], [255, 0, 0, 255]];
  class Surface {
    constructor(width, height) { this.width = width; this.height = height; surfaces.push(this); }
    getContext(type, options) {
      this.contextOptions = options;
      return {
        drawImage() {},
        getImageData(x) { return { data: new Uint8ClampedArray(rewrite ? [178, 178, 178, 255] : colors[Math.floor(x / 4)]) }; }
      };
    }
    convertToBlob({ type }) { return Promise.resolve(new Blob(['PNG'], { type })); }
  }
  class RasterImage {
    constructor() { this.style = {}; images.push(this); }
    set src(value) { queueMicrotask(() => this.onload()); }
  }
  const replacements = {
    Image: RasterImage,
    OffscreenCanvas: fallback ? undefined : Surface,
    document: { createElement() {
      const surface = new Surface();
      surface.style = {};
      surface.convertToBlob = undefined;
      surface.toBlob = (callback, type) => callback(new Blob(['PNG'], { type }));
      return surface;
    } }
  };
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  let urls = 0;
  t.mock.method(URL, 'createObjectURL', () => `blob:color-test-${++urls}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  return { surfaces, images, revoked };
}

test('PNG export uses original vector dimensions and the requested scale', () => {
  assert.deepEqual(pngDimensions(1672, 941, 2), { width: 3344, height: 1882 });
  assert.deepEqual(pngDimensions(1, 1), { width: 1, height: 1 });
});

test('PNG export rejects invalid or excessive canvas sizes before rendering', () => {
  for (const args of [[0, 10], [10, Infinity], [10, 10, 0], [10, 10, NaN]]) assert.throws(() => pngDimensions(...args), /positive numbers/);
  assert.throws(() => pngDimensions(4000, 3000, 2), /too large/);
  assert.throws(() => pngDimensions(17000, 1), /too large/);
});

for (const fallback of [false, true]) test(`PNG export checks colors and preserves scale using the ${fallback ? 'DOM fallback' : 'offscreen renderer'}`, async t => {
  const { surfaces, images, revoked } = mockRenderer(t, { fallback });
  const png = await svgToPngBlob('<svg/>', 40, 20, 2);
  assert.equal(png.type, 'image/png');
  assert.deepEqual(surfaces.map(s => [s.width, s.height]), [[16, 4], [80, 40]]);
  assert.ok(surfaces.every(s => s.contextOptions.colorSpace === 'srgb'));
  assert.ok(images.every(image => image.style.colorScheme === 'only light'));
  assert.equal(revoked.length, 2);
});

test('PNG export rejects a renderer that changes white to gray and releases its image URL', async t => {
  const { surfaces, revoked } = mockRenderer(t, { rewrite: true });
  await assert.rejects(svgToPngBlob('<svg/>', 40, 20), /browser is changing image colors/);
  assert.equal(surfaces.length, 1, 'the corrupt renderer must not render the requested export');
  assert.equal(revoked.length, 1);
});

