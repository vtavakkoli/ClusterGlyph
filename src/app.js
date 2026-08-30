import { serializeObjectsToSvg } from './vectorizer.js';

const $ = (s) => document.querySelector(s);
const drop = $('#drop');
const input = $('#file');
const sourceCanvas = $('#sourceCanvas');
const svgPreview = $('#svgPreview');
const emptyPreview = $('#emptyPreview');
const runBtn = $('#runBtn');
const downloadBtn = $('#downloadBtn');
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

let currentFile = null;
let currentSVG = '';
let currentObjects = [];
let originalObjects = [];
let selectedObjectId = null;
let currentPrecision = 2;
let currentVectorSize = { width: 0, height: 0 };
let originalSize = { width: 0, height: 0 };

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

function syncClusters(value, source) {
  const v = Math.max(1, Math.min(32, Math.round(Number(value) || 1)));
  if (source !== clustersRange) clustersRange.value = v;
  if (source !== clustersNumber) clustersNumber.value = v;
  $('#clustersValue').textContent = `${v} colors`;
}
clustersRange.addEventListener('input', e => syncClusters(e.target.value, clustersRange));
clustersNumber.addEventListener('input', e => syncClusters(e.target.value, clustersNumber));
syncClusters(clustersRange.value);

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setProgress(value, text) {
  progress.value = Math.round(value * 100);
  progressText.textContent = text;
}

function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }

function resetOutput() {
  currentSVG = '';
  currentObjects = [];
  originalObjects = [];
  selectedObjectId = null;
  svgPreview.innerHTML = '';
  emptyPreview.hidden = false;
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  paletteEl.innerHTML = '';
  statsEl.innerHTML = '<span class="muted">Vectorize an image to see optimization statistics.</span>';
  objectSelect.innerHTML = '<option value="">No objects yet</option>';
  editorEmpty.hidden = false;
  editorFields.hidden = true;
  resetEditsBtn.disabled = true;
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  currentFile = file;
  resetOutput();
  const bitmap = await createImageBitmap(file);
  originalSize = { width: bitmap.width, height: bitmap.height };
  const max = Number($('#maxDim').value);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  sourceCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
  sourceCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.drawImage(bitmap, 0, 0, sourceCanvas.width, sourceCanvas.height);
  bitmap.close();
  $('#fileMeta').textContent = `${file.name} · ${originalSize.width}×${originalSize.height} · ${humanBytes(file.size)}`;
  runBtn.disabled = false;
  status.textContent = 'Ready to vectorize';
  setProgress(0, 'Ready');
}

function options() {
  return {
    clusters: Number(clustersNumber.value),
    simplify: Number($('#simplify').value),
    minArea: Number($('#minArea').value),
    shapeTolerance: Number($('#shapeTolerance').value),
    detectGeometry: $('#detectGeometry').checked,
    precision: Number($('#precision').value),
    originalWidth: originalSize.width,
    originalHeight: originalSize.height
  };
}

function objectPointCount(object) {
  if (object.type !== 'polygon') return 1;
  return (object.rings || []).reduce((sum, ring) => sum + ring.length, 0);
}

function updateExportSvg() {
  currentSVG = serializeObjectsToSvg(currentObjects, currentVectorSize.width, currentVectorSize.height, currentPrecision);
  const bytes = new TextEncoder().encode(currentSVG).length;
  const svgSize = $('#svgSizeValue');
  if (svgSize) svgSize.textContent = humanBytes(bytes);
}

function renderObjectOptions() {
  const previous = selectedObjectId;
  objectSelect.innerHTML = currentObjects.length
    ? currentObjects.map((o, i) => `<option value="${o.id}">${i + 1}. ${o.id} · ${o.type} · cluster ${o.cluster + 1}</option>`).join('')
    : '<option value="">No objects</option>';
  if (previous && currentObjects.some(o => o.id === previous)) objectSelect.value = previous;
}

function renderEditor() {
  const object = currentObjects.find(o => o.id === selectedObjectId);
  editorEmpty.hidden = Boolean(object);
  editorFields.hidden = !object;
  if (!object) return;
  objectIdEl.textContent = object.id;
  objectTypeEl.textContent = object.type;
  objectPointsEl.textContent = String(objectPointCount(object));
  objectClusterEl.textContent = String(object.cluster + 1);
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
  emptyPreview.hidden = currentObjects.length > 0;
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
      const d = object.rings.map(ring => ring.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('') + 'Z').join('');
      shape.setAttribute('d', d);
    }
  };
  const up = e => {
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    updateExportSvg();
    renderEditor();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}

function renderResult(result) {
  currentVectorSize = { width: result.width, height: result.height };
  currentPrecision = result.precision;
  currentObjects = deepCopy(result.objects);
  originalObjects = deepCopy(result.objects);
  selectedObjectId = currentObjects[0]?.id || null;
  renderPreview();
  downloadBtn.disabled = false;
  copyBtn.disabled = false;
  resetEditsBtn.disabled = false;
  paletteEl.innerHTML = result.palette.map((p, i) => `<button class="swatch" data-cluster="${i}" title="Cluster ${i + 1}: ${p.color}" style="--swatch:${p.color}"></button>`).join('');
  const s = result.stats;
  const items = [
    ['Clusters', `${s.clusters}/${s.requestedClusters}`], ['Objects', s.shapes], ['Polygons', s.polygons], ['Circles', s.circles], ['Ellipses', s.ellipses],
    ['Points', `${s.pointsBefore.toLocaleString()} → ${s.pointsAfter.toLocaleString()}`],
    ['Reduction', `${Math.max(0, s.reduction * 100).toFixed(1)}%`], ['SVG size', humanBytes(s.svgBytes), 'svgSizeValue']
  ];
  statsEl.innerHTML = items.map(([k, v, id]) => `<div class="stat"><span>${k}</span><strong${id ? ` id="${id}"` : ''}>${v}</strong></div>`).join('');
  status.textContent = 'Vectorization complete — select a shape to edit';
}

async function vectorize() {
  if (!currentFile) return;
  runBtn.disabled = true;
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  setProgress(0.02, 'Preparing image');
  status.textContent = 'Processing locally in your browser…';

  await loadFile(currentFile);
  runBtn.disabled = true;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const worker = new Worker('./src/worker.js', { type: 'module' });

  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'progress') setProgress(msg.value, msg.stage);
    if (msg.type === 'result') {
      renderResult(msg.result);
      setProgress(1, 'Done');
      runBtn.disabled = false;
      worker.terminate();
    }
    if (msg.type === 'error') {
      status.textContent = `Error: ${msg.message}`;
      runBtn.disabled = false;
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    status.textContent = `Worker error: ${e.message}`;
    runBtn.disabled = false;
    worker.terminate();
  };
  worker.postMessage({ width: img.width, height: img.height, buffer: img.data.buffer, options: options() }, [img.data.buffer]);
}

function downloadSVG() {
  updateExportSvg();
  const blob = new Blob([currentSVG], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentFile?.name || 'image').replace(/\.[^.]+$/, '') + '.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function copySVG() {
  updateExportSvg();
  await navigator.clipboard.writeText(currentSVG);
  const old = copyBtn.textContent;
  copyBtn.textContent = 'Copied';
  setTimeout(() => copyBtn.textContent = old, 1200);
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
  selectedObjectId = currentObjects[0]?.id || null;
  renderPreview();
});
resetEditsBtn.addEventListener('click', () => {
  currentObjects = deepCopy(originalObjects);
  selectedObjectId = currentObjects[0]?.id || null;
  renderPreview();
});

input.addEventListener('change', () => loadFile(input.files[0]));
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
runBtn.addEventListener('click', vectorize);
downloadBtn.addEventListener('click', downloadSVG);
copyBtn.addEventListener('click', copySVG);
$('#browseBtn').addEventListener('click', () => input.click());

$('#compare').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--split', `${e.target.value}%`);
});
