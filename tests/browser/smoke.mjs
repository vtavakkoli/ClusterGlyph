import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifacts = path.join(root, 'test-results/browser');
await fs.mkdir(artifacts, { recursive: true });
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const data = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream' });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const external = [];
  const ocrModules = [];
  let responseMode = 'success';
  page.on('request', request => {
    if (/\/src\/ocr/.test(request.url())) ocrModules.push(request.url());
    if (/^https?:/.test(request.url()) && !request.url().startsWith(baseUrl)) external.push(request.url());
  });
  await page.route('**/*', async route => {
    if (route.request().url().startsWith(baseUrl) || /^(blob|data):/.test(route.request().url())) return route.continue();
    if (responseMode === 'fail') return route.abort('failed');
    if (!route.request().url().includes('tesseract.min.js')) return route.abort('failed');
    await route.fulfill({ contentType: 'text/javascript', body: `
      globalThis.Tesseract = { recognize: async (source, language, options) => {
        options.logger({progress: 0.5, status: 'Recognizing test words'});
        await new Promise(resolve => setTimeout(resolve, 150));
        return {data: {words: [{text: 'Test & <label>', confidence: 99, bbox: {x0: 10, y0: 10, x1: 70, y1: 30}}]}};
      }};` });
  });
  const ready = () => page.waitForFunction(() => !document.querySelector('#runBtn').disabled);
  const done = () => page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Complete') && document.querySelector('.workspace').getAttribute('aria-busy') === 'false');
  const makeImage = async (width, height) => {
    const png = await page.evaluate(([w, h]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#087e8b'; ctx.fillRect(w * 0.1, h * 0.1, w * 0.3, h * 0.6);
      ctx.fillStyle = '#ee6c4d'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.5, h * 0.24, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#18212a'; ctx.font = `bold ${h * 0.14}px Arial`; ctx.fillText('GLYPH', w * 0.1, h * 0.92);
      return c.toDataURL('image/png').split(',')[1];
    }, [width, height]);
    return { name: `fixture-${width}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  };
  async function checkAlignment() {
    const delta = await page.evaluate(() => {
      const canvas = document.querySelector('#sourceCanvas');
      const rect = canvas.getBoundingClientRect();
      const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height);
      const expected = { x: rect.x + (rect.width - canvas.width * fit) / 2, y: rect.y + (rect.height - canvas.height * fit) / 2 };
      const svg = document.querySelector('#svgPreview svg');
      const actual = new DOMPoint(0, 0).matrixTransform(svg.getScreenCTM());
      return Math.hypot(expected.x - actual.x, expected.y - actual.y);
    });
    assert.ok(delta < 1.5, `Preview alignment delta: ${delta}`);
  }
  async function pngExport() {
    const downloadEvent = page.waitForEvent('download');
    await page.click('#downloadPngBtn');
    const downloaded = await downloadEvent;
    assert.match(downloaded.suggestedFilename(), /\.png$/);
    const data = await fs.readFile(await downloaded.path());
    assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const pixels = await page.evaluate(async encoded => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let recolored = 0, transparent = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i] === 18 && rgba[i + 1] === 52 && rgba[i + 2] === 86 && rgba[i + 3] === 255) recolored++;
        if (!rgba[i + 3]) transparent++;
      }
      return { width: canvas.width, height: canvas.height, corner: [...rgba.subarray(0, 4)], recolored, transparent };
    }, data.toString('base64'));
    await page.waitForFunction(() => !document.querySelector('#downloadPngBtn').disabled);
    return pixels;
  }
  try {
    await page.goto(baseUrl);
    assert.equal(await page.isChecked('#detectText'), false);
    assert.equal(await page.isDisabled('#ocrLanguage'), true);
    assert.equal(await page.inputValue('#backgroundMode'), 'transparent');
    assert.equal(await page.isDisabled('#backgroundColor'), true);
    assert.equal(external.length, 0);
    assert.equal(ocrModules.length, 0);
    console.log('PASS: OCR is off on startup; no OCR library or module downloads');

    await page.setInputFiles('#file', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Could not open'));
    assert.equal(await page.isDisabled('#runBtn'), true);
    assert.equal(await page.isDisabled('#browseBtn'), false);
    const image = await makeImage(1200, 600);
    await page.setInputFiles('#file', image);
    await ready();
    await page.fill('#clustersNumber', '4');
    await page.click('#runBtn');
    await done();
    assert.match(await page.textContent('#status'), /geometry only/);
    assert.equal(await page.locator('#svgPreview text').count(), 0);
    assert.equal(external.length, 0);
    assert.equal(ocrModules.length, 0);
    assert.equal(await page.isVisible('#emptyPreview'), false);
    await checkAlignment();
    console.log('PASS: invalid input recovery, geometry-only vectorization and aligned preview');

    await page.click('button[data-view="vector"]');
    assert.equal(await page.isDisabled('#compare'), true);
    const objectCount = Number(await page.textContent('#objectCountValue'));
    await page.evaluate(() => { const c = document.querySelector('#objectFill'); c.value = '#123456'; c.dispatchEvent(new Event('input', {bubbles: true})); });
    const downloadEvent = page.waitForEvent('download');
    await page.click('#downloadBtn');
    const downloaded = await downloadEvent;
    const svg = await fs.readFile(await downloaded.path(), 'utf8');
    assert.match(svg, /fill="#123456"/);
    assert.doesNotMatch(svg, /vertex-handles|selected-object/);
    await page.click('#deleteObjectBtn');
    assert.equal(Number(await page.textContent('#objectCountValue')), objectCount - 1);
    await page.click('#resetEditsBtn');
    assert.equal(Number(await page.textContent('#objectCountValue')), objectCount);

    await page.evaluate(() => { const c = document.querySelector('#objectFill'); c.value = '#123456'; c.dispatchEvent(new Event('input', {bubbles: true})); });
    await page.selectOption('#pngScale', '2');
    const transparentPng = await pngExport();
    assert.deepEqual([transparentPng.width, transparentPng.height], [2400, 1200]);
    assert.equal(transparentPng.corner[3], 0);
    assert.ok(transparentPng.recolored > 100, 'PNG must include the current vector edits');
    await page.selectOption('#pngScale', '1');
    await page.selectOption('#backgroundMode', 'custom');
    await page.evaluate(() => { const c = document.querySelector('#backgroundColor'); c.value = '#334455'; c.dispatchEvent(new Event('input', {bubbles: true})); });
    assert.equal(await page.isDisabled('#backgroundColor'), false);
    const customPng = await pngExport();
    assert.deepEqual(customPng.corner, [51, 68, 85, 255]);
    assert.equal(customPng.transparent, 0);
    await page.selectOption('#backgroundMode', 'original');
    const originalPng = await pngExport();
    assert.deepEqual(originalPng.corner, [255, 255, 255, 255]);
    assert.equal(originalPng.transparent, 0);
    await page.selectOption('#backgroundMode', 'transparent');
    await page.click('#resetEditsBtn');
    console.log('PASS: PNG export preserves vector edits, transparency, scale, and custom/original backgrounds');

    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
    await page.click('#copyBtn');
    assert.match(await page.textContent('#status'), /Clipboard unavailable/);
    console.log('PASS: full SVG view, recolor, clean export, delete/reset and clipboard failure');

    await page.check('#detectText');
    assert.equal(await page.isDisabled('#ocrLanguage'), false);
    assert.equal(external.length, 0);
    await page.selectOption('#ocrLanguage', 'eng+deu');
    const locked = await page.evaluate(() => {
      const run = document.querySelector('#runBtn');
      run.click();
      run.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return ['#runBtn', '#file', '#detectText', '#ocrLanguage'].every(selector => document.querySelector(selector).disabled);
    });
    assert.equal(locked, true);
    await done();
    assert.match(await page.textContent('#status'), /review experimental text recovery/);
    assert.equal(await page.locator('#svgPreview text').count(), 1);
    console.log('OCR request check:', JSON.stringify({ requests: external, text: await page.locator('#svgPreview text').textContent() }));
    assert.equal(await page.locator('#svgPreview text').textContent(), 'Test & <label>');
    assert.equal(external.length, 1);
    await page.uncheck('#detectText');
    await page.click('#runBtn');
    await done();
    assert.equal(await page.locator('#svgPreview text').count(), 0);
    assert.equal(external.length, 1);
    assert.match(await page.textContent('#status'), /geometry only/);
    console.log('PASS: checkbox alone does not download; opt-in text export and opt-out work');

    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `Page overflow at ${width}px: ${overflow}`);
    }
    await page.setViewportSize({width: 390, height: 1000});
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
    await checkAlignment();
    console.log('PASS: responsive layout at 1440, 1024, 768, 390 and 320 pixels');

    await page.setViewportSize({width: 1440, height: 1100});
    await page.evaluate(() => { globalThis.NativeWorker = Worker; globalThis.Worker = class { constructor() { throw Error('Simulated worker failure'); } }; });
    await page.click('#runBtn');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Simulated worker failure'));
    await ready();
    assert.equal(await page.isDisabled('#browseBtn'), false);
    assert.equal(await page.isDisabled('#downloadBtn'), false);
    await page.evaluate(() => { globalThis.Worker = globalThis.NativeWorker; });
    console.log('PASS: worker startup failure restores controls and previous export');

    await page.reload();
    responseMode = 'fail';
    await page.setInputFiles('#file', await makeImage(96, 64));
    await ready();
    await page.check('#detectText');
    await page.click('#runBtn');
    await done();
    assert.match(await page.textContent('#status'), /text detection failed; geometry only/);
    assert.equal(await page.locator('#svgPreview text').count(), 0);
    await checkAlignment();
    responseMode = 'success';
    await page.click('#runBtn');
    await done();
    assert.match(await page.textContent('#status'), /review experimental text recovery/);
    console.log('PASS: failed OCR downloads fall back to geometry, then retry successfully');
    assert.deepEqual(errors, []);
    console.log('PASS: no unhandled browser errors');
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
