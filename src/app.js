import { serializeObjectsToSvg, objectsForBackground, pathForRings } from './serializer.js';
import { svgToPngBlob } from './png-export.js';

const $ = (s) => document.querySelector(s);
const drop = $('#drop');
const input = $('#file');
const sourceCanvas = $('#sourceCanvas');
const svgPreview = $('#svgPreview');
const emptyPreview = $('#emptyPreview');
const runBtn = $('#runBtn');
const downloadBtn = $('#downloadBtn');
const downloadPngBtn = $('#downloadPngBtn');
const copyBtn = $('#copyBtn');
const progress = $('#progress');
const progressText = $('#progressText');
const status = $('#status');
const paletteEl = $('#palette');
const statsEl = $('#stats');
const objectSelect = $('#objectSelect');
const editorEmpty = $('#editorEmpty');
const editorFields = $('#editorFields');
const objectIdEl = $('#objectId');
const objectTypeEl = $('#objectType');
const objectPointsEl = $('#objectPoints');
const objectClusterEl = $('#objectCluster');
const objectFill = $('#objectFill');
const deleteObjectBtn = $('#deleteObjectBtn');
const resetEditsBtn = $('#resetEditsBtn');
const clustersRange = $('#clusters');
const clustersNumber = $('#clustersNumber');
const detectText = $('#detectText');
const ocrLanguage = $('#ocrLanguage');
const compareStage = $('.compare-stage');
const previewModes = document.querySelectorAll('.preview-modes button');
const backgroundMode = $('#backgroundMode');
const backgroundColor = $('#backgroundColor');
const pngScale = $('#pngScale');

let currentFile = null;
let currentSVG = '';
let currentObjects = [];
let originalObjects = [];
let selectedObjectId = null;
let currentPrecision = 2;
let currentVectorSize = { width: 0, height: 0 };
let originalSize = { width: 0, height: 0 };
let busy = false;

function outputOptions() { return { backgroundMode: backgroundMode.value, backgroundColor: backgroundColor.value }; }
function visibleObjects() { return objectsForBackground(currentObjects, backgroundMode.value); }

function syncBackground() { backgroundColor.disabled = busy || backgroundMode.value !== 'custom'; }
function updateBackground() {
  syncBackground();
  if (currentSVG) {
    if (!visibleObjects().some(o => o.id === selectedObjectId)) selectedObjectId = visibleObjects()[0]?.id || null;
    renderPreview();
  }
}
backgroundMode.addEventListener('change', updateBackground);
backgroundColor.addEventListener('input', updateBackground);
syncBackground();
pngScale.addEventListener('change', updatePngSize);

function updatePngSize() {
  $('#pngSize').textContent = currentVectorSize.width
    ? `${Math.round(currentVectorSize.width * Number(pngScale.value))} × ${Math.round(currentVectorSize.height * Number(pngScale.value))} px · background: ${backgroundMode.options[backgroundMode.selectedIndex].text}`
    : 'Uses the edited SVG and output background';
}

function syncTextDetection() {
  ocrLanguage.disabled = busy || !detectText.checked;
  $('#ocrMode').textContent = detectText.checked
    ? 'Experimental OCR · downloads recognition assets when you vectorize'
    : 'Geometry only · no text recognition downloads';
}
detectText.addEventListener('change', syncTextDetection);
syncTextDetection();

function setBusy(value) {
  busy = value;
  document.querySelectorAll('.controls input, .controls select, #browseBtn').forEach(el => { el.disabled = value; });
  syncTextDetection();
  syncBackground();
  runBtn.disabled = value || !currentFile;
  downloadBtn.disabled = value || !currentSVG;
  downloadPngBtn.disabled = value || !currentSVG;
  pngScale.disabled = value || !currentSVG;
  copyBtn.disabled = value || !currentSVG;
  resetEditsBtn.disabled = value || !currentSVG;
  objectSelect.disabled = value || !visibleObjects().length;
  editorFields.inert = value;
  paletteEl.inert = value;
  svgPreview.inert = value;
  previewModes.forEach(button => { button.disabled = value || !currentSVG; });
  $('#compare').disabled = value || !currentSVG || compareStage.dataset.view !== 'compare';
  drop.setAttribute('aria-disabled', String(value));
  $('.workspace').setAttribute('aria-busy', String(value));
}

function setPreviewMode(mode) {
  compareStage.dataset.view = mode;
  previewModes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === mode)));
  $('#compare').disabled = busy || !currentSVG || mode !== 'compare';
}
previewModes.forEach(button => button.addEventListener('click', () => setPreviewMode(button.dataset.view)));

const bindings = [
  ['maxDim', 'maxDimValue', v => `${v}px`],
  ['simplify', 'simplifyValue', v => Number(v).toFixed(1)],
  ['minArea', 'minAreaValue', v => `${v}px²`],
  ['shapeTolerance', 'shapeToleranceValue', v => Number(v).toFixed(2)]
];
for (const [id, out, format] of bindings) {
  const el = $(`#${id}`), label = $(`#${out}`);
  const update = () => label.textContent = format(el.value);
  el.addEventListener('input', update); update();
}

function syncClusters(value) {
  const v = Math.max(1, Math.min(32, Math.round(Number(value) || 1)));
  clustersRange.value = v;
  clustersNumber.value = v;
  $('#clustersValue').textContent = `${v} colors`;
}
clustersRange.addEventListener('input', e => syncClusters(e.target.value));
clustersNumber.addEventListener('input', e => syncClusters(e.target.value));
syncClusters(clustersRange.value);

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function setProgress(value, text) {
  progress.value = Math.round(value * 100);
  progressText.textContent = text;
}

function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }

function resetOutput() {
  currentSVG = '';
  currentVectorSize = { width: 0, height: 0 };
  currentObjects = [];
  originalObjects = [];
  selectedObjectId = null;
  svgPreview.innerHTML = '';
  emptyPreview.hidden = false;
  downloadBtn.disabled = true;
  downloadPngBtn.disabled = true;
  pngScale.disabled = true;
  updatePngSize();
  copyBtn.disabled = true;
  paletteEl.innerHTML = '';
  statsEl.innerHTML = '<span class="muted">Vectorize an image to see optimization statistics.</span>';
  objectSelect.innerHTML = '<option value="">No objects yet</option>';
  editorEmpty.hidden = false;
  editorFields.hidden = true;
  resetEditsBtn.disabled = true;
  objectSelect.disabled = true;
  previewModes.forEach(button => { button.disabled = true; });
  setPreviewMode('original');
}

async function drawSource(file, maxDim) {
  const bitmap = await createImageBitmap(file);
  try {
    originalSize = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    sourceCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
    sourceCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, sourceCanvas.width, sourceCanvas.height);
  } finally {
    bitmap.close();
  }
}

async function loadFile(file) {
  if (!file || busy) return;
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)) {
    status.textContent = 'Choose a supported image such as PNG, JPG, or WebP.';
    return;
  }
  setBusy(true);
  status.textContent = 'Opening image…';
  try {
    await drawSource(file, Number($('#maxDim').value));
    currentFile = file;
    resetOutput();
    $('#fileMeta').textContent = `${file.name} · ${originalSize.width}×${originalSize.height} · ${humanBytes(file.size)}`;
    status.textContent = 'Ready to vectorize';
    setProgress(0, 'Ready');
  } catch (error) {
    status.textContent = 'Could not open this image. Try a valid PNG, JPG, or WebP file.';
    console.warn('Image loading failed:', error);
  } finally {
    input.value = ''; // Allow selecting the same file again after an error.
    setBusy(false);
  }
}

function options() {
  return {
    clusters: Number(clustersNumber.value),
    simplify: Number($('#simplify').value),
    minArea: Number($('#minArea').value),
    shapeTolerance: Number($('#shapeTolerance').value),
    detectGeometry: $('#detectGeometry').checked,
    cleanEdges: $('#cleanEdges').checked,
    closeGaps: $('#closeGaps').checked,
    smoothContours: $('#smoothContours').checked,
    precision: Number($('#precision').value),
    originalWidth: originalSize.width,
    originalHeight: originalSize.height
  };
}

function objectPointCount(object) {
  if (object.type === 'text') return 0;
  if (object.type !== 'polygon') return 1;
  return (object.rings || []).reduce((sum, ring) => sum + ring.length, 0);
}

function updateExportSvg() {
  currentSVG = serializeObjectsToSvg(currentObjects, currentVectorSize.width, currentVectorSize.height, currentPrecision, outputOptions());
  updatePngSize();
  const bytes = new TextEncoder().encode(currentSVG).length;
  const svgSize = $('#svgSizeValue');
  if (svgSize) svgSize.textContent = humanBytes(bytes);
  const objectCount = $('#objectCountValue');
  const textCount = $('#textCountValue');
  const visible = visibleObjects();
  if (objectCount) objectCount.textContent = visible.length;
  if (textCount) textCount.textContent = visible.filter(object => object.type === 'text').length;
  for (const type of ['polygon', 'circle', 'ellipse']) {
    const count = $(`#${type}CountValue`);
    if (count) count.textContent = visible.filter(o => o.type === type).length;
  }
  const points = $('#pointCountValue'), reduction = $('#reductionValue');
  const before = visible.reduce((sum, object) => sum + (object.rawPoints || 0), 0);
  const after = visible.reduce((sum, object) => sum + objectPointCount(object), 0);
  if (points) points.textContent = `${before.toLocaleString()} → ${after.toLocaleString()}`;
  if (reduction) reduction.textContent = `${before ? Math.max(0, (1 - after / before) * 100).toFixed(1) : '0.0'}%`;
  return bytes;
}

function objectLabel(object, index) {
  if (object.type === 'text') return `${index + 1}. ${object.id} · text · “${object.text}”`;
  return `${index + 1}. ${object.id} · ${object.type} · cluster ${object.cluster + 1}`;
}

function renderObjectOptions() {
  const previous = selectedObjectId;
  const visible = visibleObjects();
  objectSelect.innerHTML = visible.length
    ? '<option value="">Select an object</option>' + visible.map((o, i) => `<option value="${escapeHtml(o.id)}">${escapeHtml(objectLabel(o, i))}</option>`).join('')
    : '<option value="">No objects</option>';
  objectSelect.disabled = busy || !visible.length;
  if (previous && visible.some(o => o.id === previous)) objectSelect.value = previous;
}

function renderEditor() {
  const object = visibleObjects().find(o => o.id === selectedObjectId);
  editorEmpty.hidden = Boolean(object);
  editorFields.hidden = !object;
  if (!object) return;
  objectIdEl.textContent = object.id;
  objectTypeEl.textContent = object.type === 'text' ? `text · ${Math.round(object.confidence || 0)}% OCR` : object.type;
  objectPointsEl.textContent = object.type === 'text' ? `${Number(object.fontSize || 0).toFixed(1)}px` : String(objectPointCount(object));
  objectClusterEl.textContent = object.type === 'text' ? object.fontFamily || 'OCR' : String(object.cluster + 1);
  objectFill.value = object.fill;
}

function decoratePreview() {
  const svg = svgPreview.querySelector('svg');
  if (!svg) return;
  svg.classList.add('editable-svg');
  svg.querySelectorAll('[data-object-id]').forEach(el => {
    el.classList.toggle('selected-object', el.dataset.objectId === selectedObjectId);
    el.addEventListener('click', e => {
      e.stopPropagation();
      selectObject(el.dataset.objectId);
    });
  });
  svg.addEventListener('click', () => selectObject(null));
  if (!selectedObjectId) return;
  const object = currentObjects.find(o => o.id === selectedObjectId);
  if (!object || object.type !== 'polygon') return;

  const ns = 'http://www.w3.org/2000/svg';
  const handles = document.createElementNS(ns, 'g');
  handles.setAttribute('class', 'vertex-handles');
  (object.rings || []).forEach((ring, ringIndex) => ring.forEach(([x, y], pointIndex) => {
    const handle = document.createElementNS(ns, 'circle');
    handle.setAttribute('cx', x);
    handle.setAttribute('cy', y);
    handle.setAttribute('r', Math.max(currentVectorSize.width, currentVectorSize.height) / 220);
    handle.dataset.ring = ringIndex;
    handle.dataset.point = pointIndex;
    handle.addEventListener('pointerdown', startVertexDrag);
    handles.appendChild(handle);
  }));
  svg.appendChild(handles);
}

function renderPreview() {
  updateExportSvg();
  svgPreview.innerHTML = currentSVG;
  emptyPreview.hidden = visibleObjects().length > 0;
  emptyPreview.textContent = 'No foreground objects. Try Original background or different tracing settings.';
  decoratePreview();
  renderObjectOptions();
  renderEditor();
}

function selectObject(id) {
  selectedObjectId = id;
  if (id) objectSelect.value = id;
  renderPreview();
}

function svgPointFromEvent(svg, event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function startVertexDrag(event) {
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const svg = handle.ownerSVGElement;
  const object = currentObjects.find(o => o.id === selectedObjectId);
  if (!object) return;
  const ringIndex = Number(handle.dataset.ring);
  const pointIndex = Number(handle.dataset.point);
  handle.setPointerCapture(event.pointerId);

  const move = e => {
    const p = svgPointFromEvent(svg, e);
    const x = Math.max(0, Math.min(currentVectorSize.width, p.x));
    const y = Math.max(0, Math.min(currentVectorSize.height, p.y));
    object.rings[ringIndex][pointIndex] = [x, y];
    handle.setAttribute('cx', x);
    handle.setAttribute('cy', y);
    const shape = svg.querySelector(`[data-object-id="${object.id}"]`);
    if (object.rings.length === 1 && shape?.tagName.toLowerCase() === 'polygon') {
      shape.setAttribute('points', object.rings[0].map(([px, py]) => `${px},${py}`).join(' '));
    } else if (shape) {
      const d = pathForRings(object.rings, currentPrecision, object.curveSmoothing || 0);
      shape.setAttribute('d', d);
    }
  };
  const up = e => {
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    renderPreview();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

function renderResult(result, { textObjects = [], ocrWarning = '', useOcr = false } = {}) {
  currentVectorSize = { width: result.width, height: result.height };
  currentPrecision = result.precision;
  currentObjects = deepCopy([...result.objects, ...textObjects]);
  originalObjects = deepCopy(currentObjects);
  selectedObjectId = visibleObjects()[0]?.id || null;
  renderPreview();
  setPreviewMode('compare');
  paletteEl.innerHTML = result.palette.map(p => `<button type="button" class="swatch" data-cluster="${p.cluster}" aria-label="Select an object in cluster ${p.cluster + 1}, ${p.color}" title="Cluster ${p.cluster + 1}: ${p.color}" style="--swatch:${p.color}"></button>`).join('');
  const s = result.stats;
  const outputBytes = new TextEncoder().encode(currentSVG).length;
  const items = [
    ['Clusters', `${s.clusters}/${s.requestedClusters}`], ['Objects', currentObjects.length, 'objectCountValue'], ['Text', textObjects.length, 'textCountValue'], ['Polygons', s.polygons, 'polygonCountValue'], ['Circles', s.circles, 'circleCountValue'], ['Ellipses', s.ellipses, 'ellipseCountValue'],
    ['Points', `${s.pointsBefore.toLocaleString()} → ${s.pointsAfter.toLocaleString()}`, 'pointCountValue'],
    ['Reduction', `${Math.max(0, s.reduction * 100).toFixed(1)}%`, 'reductionValue'], ['SVG size', humanBytes(outputBytes), 'svgSizeValue']
  ];
  statsEl.innerHTML = items.map(([k, v, id]) => `<div class="stat"><span>${k}</span><strong${id ? ` id="${id}"` : ''}>${v}</strong></div>`).join('');
  updateExportSvg();
  status.textContent = ocrWarning ? `Complete · ${ocrWarning}`
    : useOcr ? textObjects.length ? 'Complete · review experimental text recovery' : 'Complete · no confident text found'
    : 'Complete · geometry only';
}

function traceRaster(raster, settings, base) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => {
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') setProgress(base + msg.value * (1 - base), msg.stage);
      if (msg.type === 'result') finish(null, msg.result);
      if (msg.type === 'error') finish(new Error(msg.message));
    };
    worker.onerror = e => finish(new Error(e.message || 'Could not start the tracing worker.'));
    worker.onmessageerror = () => finish(new Error('Could not read the tracing result.'));
    try {
      worker.postMessage({ width: raster.width, height: raster.height, buffer: raster.data.buffer, options: settings }, [raster.data.buffer]);
    } catch (error) {
      finish(error);
    }
  });
}

async function vectorize() {
  if (!currentFile || busy) return;
  const useOcr = detectText.checked;
  const language = ocrLanguage.value;
  const settings = options();
  setBusy(true);
  setProgress(0.02, 'Preparing image');
  status.textContent = 'Processing locally in your browser…';
  try {
    await drawSource(currentFile, Number($('#maxDim').value));
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    let raster = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
    let textObjects = [];
    let ocrWarning = '';
    if (useOcr) {
      try {
        status.textContent = 'Running experimental text detection…';
        const { recognizeText, createTextObjects, maskDetectedText } = await import('./ocr.js');
        const recognized = await recognizeText(sourceCanvas, {
          language,
          minConfidence: 55,
          onProgress: (value, stage) => setProgress(0.04 + value * 0.28, stage)
        });
        const recoveredText = createTextObjects(recognized.words, raster, {
          originalWidth: originalSize.width,
          originalHeight: originalSize.height
        });
        // Commit text and masking together so a failed OCR stage cannot duplicate letters.
        const maskedRaster = maskDetectedText(raster, recognized.words);
        textObjects = recoveredText;
        raster = maskedRaster;
        setProgress(0.32, textObjects.length ? `Recovered ${textObjects.length} text objects` : 'No confident text found');
      } catch (error) {
        ocrWarning = 'text detection failed; geometry only';
        console.warn('Experimental text detection failed:', error);
        setProgress(0.32, 'Text recovery skipped');
      }
    }
    status.textContent = 'Tracing vector shapes…';
    const result = await traceRaster(raster, settings, useOcr ? 0.32 : 0.02);
    renderResult(result, { textObjects, ocrWarning, useOcr });
    setProgress(1, ocrWarning ? 'Done · text recovery skipped' : 'Done');
  } catch (error) {
    status.textContent = `Could not vectorize: ${error.message || 'please try again'}`;
    progressText.textContent = 'Conversion failed · try again';
  } finally {
    setBusy(false);
  }
}

function downloadBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFile?.name || 'image').replace(/\.[^.]+$/, '') + extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function downloadSVG() {
  updateExportSvg();
  downloadBlob(new Blob([currentSVG], { type: 'image/svg+xml' }), '.svg');
}

async function downloadPNG() {
  if (busy || !currentSVG) return;
  updateExportSvg();
  const scale = Number(pngScale.value);
  setBusy(true);
  downloadPngBtn.textContent = 'Rendering PNG…';
  status.textContent = 'Rendering PNG locally…';
  try {
    const blob = await svgToPngBlob(currentSVG, currentVectorSize.width, currentVectorSize.height, scale);
    downloadBlob(blob, '.png');
    status.textContent = 'PNG exported with the current edits and background';
  } catch (error) {
    status.textContent = `Could not export PNG: ${error.message}`;
  } finally {
    downloadPngBtn.textContent = 'Download PNG';
    setBusy(false);
  }
}

async function copySVG() {
  updateExportSvg();
  try {
    await navigator.clipboard.writeText(currentSVG);
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.textContent = 'Copy SVG'; }, 1200);
  } catch {
    status.textContent = 'Clipboard unavailable. Use Download SVG to save your result.';
  }
}

objectSelect.addEventListener('change', e => selectObject(e.target.value || null));
objectFill.addEventListener('input', e => {
  const object = currentObjects.find(o => o.id === selectedObjectId);
  if (!object) return;
  object.fill = e.target.value;
  renderPreview();
});
deleteObjectBtn.addEventListener('click', () => {
  if (!selectedObjectId) return;
  currentObjects = currentObjects.filter(o => o.id !== selectedObjectId);
  selectedObjectId = visibleObjects()[0]?.id || null;
  renderPreview();
});
resetEditsBtn.addEventListener('click', () => {
  currentObjects = deepCopy(originalObjects);
  selectedObjectId = visibleObjects()[0]?.id || null;
  renderPreview();
});
paletteEl.addEventListener('click', e => {
  const swatch = e.target.closest('[data-cluster]');
  if (!swatch) return;
  const object = visibleObjects().find(o => o.cluster === Number(swatch.dataset.cluster));
  if (object) {
    selectObject(object.id);
    setPreviewMode('vector');
  }
});

input.addEventListener('change', () => loadFile(input.files[0]));
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
runBtn.addEventListener('click', vectorize);
downloadBtn.addEventListener('click', downloadSVG);
downloadPngBtn.addEventListener('click', downloadPNG);
copyBtn.addEventListener('click', copySVG);
$('#browseBtn').addEventListener('click', () => input.click());

$('#compare').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--split', `${e.target.value}%`);
});
