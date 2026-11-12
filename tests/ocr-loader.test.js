import test from 'node:test';
import assert from 'node:assert/strict';

function browserStub(t) {
  for (const name of ['document', 'Tesseract']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  delete globalThis.Tesseract;
  const scripts = [];
  globalThis.document = {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append: script => scripts.push(script) }
  };
  return scripts;
}

function isolatedLoader(t) {
  return import(`../src/ocr-loader.js?test=${encodeURIComponent(t.name)}`);
}

test('OCR module import does not request recognition assets', async t => {
  const scripts = browserStub(t);
  await isolatedLoader(t);
  assert.equal(scripts.length, 0);
});

test('concurrent OCR requests share one bundle download and reuse the engine', async t => {
  const scripts = browserStub(t);
  const { loadTesseract, TESSERACT_URL } = await isolatedLoader(t);
  const first = loadTesseract();
  const second = loadTesseract();
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, TESSERACT_URL);
  const engine = { recognize() {} };
  globalThis.Tesseract = engine;
  scripts[0].onload();
  assert.equal(await first, engine);
  assert.equal(await loadTesseract(), engine);
  assert.equal(scripts.length, 1);
});

test('a failed bundle download is removed and a later run can retry', async t => {
  const scripts = browserStub(t);
  const { loadTesseract } = await isolatedLoader(t);
  const first = loadTesseract();
  scripts[0].onerror();
  await assert.rejects(first, /Could not load experimental text detection/);
  assert.equal(scripts[0].removed, true);
  const retry = loadTesseract();
  assert.equal(scripts.length, 2);
  const engine = { recognize() {} };
  globalThis.Tesseract = engine;
  scripts[1].onload();
  assert.equal(await retry, engine);
});

test('an invalid downloaded bundle is rejected instead of treated as ready', async t => {
  const scripts = browserStub(t);
  const { loadTesseract } = await isolatedLoader(t);
  const pending = loadTesseract();
  scripts[0].onload();
  await assert.rejects(pending, /Could not load experimental text detection/);
  assert.equal(scripts[0].removed, true);
});

test('a stalled bundle download times out so geometry tracing can continue', async t => {
  const scripts = browserStub(t);
  const { loadTesseract } = await isolatedLoader(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejection = assert.rejects(loadTesseract(), /Could not load experimental text detection/);
  t.mock.timers.tick(30000);
  await rejection;
  assert.equal(scripts[0].removed, true);
});
