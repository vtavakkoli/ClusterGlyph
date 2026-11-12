// Keep OCR assets out of the normal geometry-only workflow.
export const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let pendingLoad = null;

export function loadTesseract() {
  if (globalThis.Tesseract?.recognize) return Promise.resolve(globalThis.Tesseract);
  if (pendingLoad) return pendingLoad;
  if (typeof document === 'undefined') return Promise.reject(new Error('Text detection requires a browser.'));

  pendingLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT_URL;
    script.async = true;
    const cleanup = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const fail = () => {
      cleanup();
      script.remove();
      reject(new Error('Could not load experimental text detection. Check your connection or turn it off.'));
    };
    const timer = setTimeout(fail, 30000);
    script.onerror = fail;
    script.onload = () => {
      if (!globalThis.Tesseract?.recognize) return fail();
      cleanup();
      resolve(globalThis.Tesseract);
    };
    document.head.append(script);
  }).catch(error => {
    pendingLoad = null; // Allow a later opt-in run to retry a failed download.
    throw error;
  });
  return pendingLoad;
}
