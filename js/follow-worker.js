// Pages read for the page follower in a thread of their own (see follow-read.js): the score, the
// drawing and the listening never wait for the music reader. In: { id, page: ImageBitmap }.
// Out: { id, r } or { id, error }.
// (the reader makes its working pictures with document.createElement('canvas'): here they are
// OffscreenCanvases)
self.document = { createElement: () => new OffscreenCanvas(1, 1) };
let reader = null;
self.onmessage = async (e) => {
  const { id, page } = e.data || {};
  try {
    reader = reader || await import('./follow-read.js');
    const r = await reader.readPage(page);
    self.postMessage({ id, r });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  } finally { try { page && page.close && page.close(); } catch {} }
};
