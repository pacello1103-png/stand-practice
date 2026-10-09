// Export a score as a PDF, with or without the markings. Original PDF pages are copied as
// vectors, so the music stays sharp; markings are laid on top as a transparent image.
import { drawItem, loadItems, loadMusicFont, setPaperColor } from './ink.js';

let lib = null;
async function pdfLib() { if (!lib) lib = await import('../vendor/pdf-lib.mjs'); return lib; }

const canvasToBytes = (c, type, q) => new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), type, q));

async function inkPng(items, wPx, hPx) {
  if (!items.length) return null;
  const c = document.createElement('canvas'); c.width = wPx; c.height = hPx;
  const g = c.getContext('2d');
  for (const s of items) drawItem(g, s, wPx, hPx, false);
  const bytes = await canvasToBytes(c, 'image/png');
  c.width = c.height = 0;
  return bytes;
}

// waitMasks: whiteout masks are images that decode asynchronously.
async function settleMasks(items) {
  const srcs = items.filter((s) => s.t === 'mask').map((s) => s.d);
  await Promise.all(srcs.map((src) => new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = src; })));
}

export async function exportPdf({ score, file, doc, withInk, onProgress }) {
  const { PDFDocument } = await pdfLib();
  setPaperColor('#ffffff');
  await loadMusicFont();
  const out = await PDFDocument.create();
  out.setTitle(score.title || 'Score');
  if (score.composer) out.setAuthor(score.composer);
  out.setCreator('Stand');
  let src = null;
  if (file.kind === 'pdf') src = await PDFDocument.load(file.data.slice(0), { ignoreEncryption: true });
  const n = doc.pages;
  for (let i = 0; i < n; i++) {
    onProgress && onProgress(i / n);
    const orig = doc.orig(i);
    const items = withInk ? await loadItems(score.id + ':' + orig) : [];
    if (items.length) await settleMasks(items);
    let page = null, W, H;
    if (src) {
      const sp = src.getPage(orig);
      const rot = (sp.getRotation().angle || 0) % 360;
      if (rot === 0) {
        const [copied] = await out.copyPages(src, [orig]);
        page = out.addPage(copied);
        ({ width: W, height: H } = page.getSize());
        const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, width: W, height: H };
        if (items.length) {
          const png = await inkPng(items, Math.round(box.width * 3), Math.round(box.height * 3));
          if (png) { const im = await out.embedPng(png); page.drawImage(im, { x: box.x, y: box.y, width: box.width, height: box.height }); }
        }
        continue;
      }
    }
    // Photos, manuscript paper and rotated PDF pages: flatten to one image per page.
    const [pw, ph] = doc.sizes[i];
    const scale = Math.min(3, 2400 / Math.max(pw, ph));
    const cw = Math.round(pw * scale), ch = Math.round(ph * scale);
    const c = document.createElement('canvas');
    await doc.render(i, c, cw, ch);
    const g = c.getContext('2d');
    for (const s of items) drawItem(g, s, c.width, c.height, false);
    const jpg = await canvasToBytes(c, 'image/jpeg', 0.9);
    c.width = c.height = 0;
    const im = await out.embedJpg(jpg);
    const ptW = file.kind === 'images' ? 595 : pw, ptH = file.kind === 'images' ? (595 * ph) / pw : ph;
    page = out.addPage([ptW, ptH]);
    page.drawImage(im, { x: 0, y: 0, width: ptW, height: ptH });
  }
  onProgress && onProgress(1);
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
