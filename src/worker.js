import { vectorizeImage } from './vectorizer.js';

self.onmessage = (event) => {
  try {
    const { width, height, buffer, options } = event.data;
    const imageData = { width, height, data: new Uint8ClampedArray(buffer) };
    const result = vectorizeImage(imageData, options, (value, stage) => {
      self.postMessage({ type: 'progress', value, stage });
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
