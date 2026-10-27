// The face model in its own thread: the page (turning, drawing, listening) never waits for it.
// In: { init: base } once, then { frame: ImageBitmap, t }. Out: { ready, delegate } | { error } |
// { t, ms, lm: the few landmarks the eyes need, M: head pose matrix, bl, br: blinks } | { t, none }.
/* global importScripts, exports */
self.exports = {};
let lm = null, busy = false;
const KEEP = [33, 133, 159, 145, 263, 362, 386, 374, 468, 473, 1, 152, 10];
self.onmessage = async (e) => {
  const d = e.data;
  if (d.init) {
    try {
      importScripts(d.init + 'vision_bundle_classic.js');
      const mp = self.exports;
      const fileset = { wasmLoaderPath: d.init + 'wasm/vision_wasm_internal.js', wasmBinaryPath: d.init + 'wasm/vision_wasm_internal.wasm' };
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: d.init + 'face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
      // (on the processor: the graphics stay free for the page, and frames in a thread of their own
      // are read the same everywhere)
      const delegate = d.gpu ? 'GPU' : 'CPU';
      lm = await mp.FaceLandmarker.createFromOptions(fileset, opts(delegate));
      self.postMessage({ ready: true, delegate });
    } catch (err) { self.postMessage({ error: String((err && err.message) || err) }); }
    return;
  }
  if (d.frame) {
    if (!lm || busy) { d.frame.close && d.frame.close(); return; }
    busy = true;
    const t0 = performance.now();
    let r = null;
    try { r = lm.detectForVideo(d.frame, d.t); } catch (err) { r = null; }
    d.frame.close && d.frame.close();
    const ms = performance.now() - t0;
    busy = false;
    const L = r && r.faceLandmarks && r.faceLandmarks[0];
    if (!L || L.length < 478) { self.postMessage({ t: d.t, ms, none: true }); return; }
    const pts = {}; for (const k of KEEP) pts[k] = { x: L[k].x, y: L[k].y };
    const M = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0] ? Array.from(r.facialTransformationMatrixes[0].data) : null;
    let bl = 0, br = 0; const look = {};
    const bs = r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories;
    if (bs) for (const c of bs) { if (c.categoryName === 'eyeBlinkLeft') bl = c.score; else if (c.categoryName === 'eyeBlinkRight') br = c.score; else if (c.categoryName.startsWith('eyeLook')) look[c.categoryName] = c.score; }
    self.postMessage({ t: d.t, ms, pts, M, bl, br, look });
  }
};
