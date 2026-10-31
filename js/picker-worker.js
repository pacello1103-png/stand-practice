// The lines of music on a page, found in a thread of their own for Capture: turning the page
// never waits for them. In: { id, page: ImageBitmap }. Out: { id, lines } or { id, error }.
// (the reader makes its working pictures with document.createElement('canvas'): here they are
// OffscreenCanvases)
self.document = { createElement: () => new OffscreenCanvas(1, 1) };
let omr = null, lib = null;
self.onmessage = async (e) => {
  const { id, page, light } = e.data || {};
  try {
    omr = omr || await import('./omr.js');
    lib = lib || await import('./picker-lines.js');
    // (light: only the staves and their systems, for Play; Capture reads everything)
    const A = await omr.analyse(page, false, false, light ? { stavesOnly: true } : {});
    self.postMessage({ id, lines: lib.linesOf(A) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  } finally { try { page && page.close && page.close(); } catch {} }
};
