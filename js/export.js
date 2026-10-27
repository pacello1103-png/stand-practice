// Export a score as a PDF, with or without the markings. Original PDF pages are copied as
// vectors, so the music stays sharp; markings are laid on top as a transparent image.
import { drawItem, loadItems, loadMusicFont, setPaperColor, preloadAssets, preloadMasks } from './ink.js';

let lib = null;
async function pdfLib() { if (!lib) lib = await import('../vendor/pdf-lib.mjs'); return lib; }

// print quality: markings at 300 dpi over the original pages, and pages made into a picture
// (photos, turned pages) at about 300 dpi for A4 (a little less on an iPhone, for its memory)
const PHONE = typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent);
const INK_K = 300 / 72, FLAT_LONG = PHONE ? 2600 : 3500;
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
  await preloadMasks(items);
  await preloadAssets(items);
}

const inkKeyOf = (doc, i) => (doc.composite && doc.composite(i) ? `${doc.orig(i)}+${doc.gluedFrom(i)}` : doc.orig(i));
const kindOf = (doc, file, o) => { const b = doc.base || doc; return b.kindOf ? b.kindOf(o) : file.kind; };

export async function exportPdf({ score, file, doc, withInk, onProgress, boxOf, only }) {
  const { PDFDocument } = await pdfLib();
  setPaperColor('#ffffff');
  await loadMusicFont();
  const out = await PDFDocument.create();
  out.setTitle(score.title || 'Score');
  if (score.composer) out.setAuthor(score.composer);
  out.setCreator('Stand');
  let src = null;
  if (file.kind === 'pdf') src = await PDFDocument.load(file.data.slice(0), { ignoreEncryption: true });
  // (only some pages: a notebook page made from a layout, say)
  const list = Array.isArray(only) && only.length ? only.filter((i) => i >= 0 && i < doc.pages) : [...Array(doc.pages).keys()];
  const n = list.length;
  for (let li = 0; li < n; li++) {
    const i = list[li];
    onProgress && onProgress(li / n);
    const orig = doc.orig(i);
    const items = withInk ? (await loadItems(score.id + ':' + inkKeyOf(doc, i))).filter((s) => s.t !== 'passage' && s.t !== 'note') : [];
    if (items.length) await settleMasks(items);
    let page = null, W, H;
    const bx = boxOf ? boxOf(i) : null;
    const cropped = bx && !(bx.x < 0.002 && bx.y < 0.002 && bx.w > 0.998 && bx.h > 0.998);
    if (src && orig < src.getPageCount() && !(score.rot && score.rot[orig]) && !(doc.composite && doc.composite(i))) {   // (pages added from other files, pages turned and pages joined with the next are drawn below)
      const sp = src.getPage(orig);
      const rot = (sp.getRotation().angle || 0) % 360;
      if (rot === 0) {
        const [copied] = await out.copyPages(src, [orig]);
        page = out.addPage(copied);
        ({ width: W, height: H } = page.getSize());
        const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, width: W, height: H };
        if (items.length) {
          const ik = Math.min(INK_K, Math.sqrt((PHONE ? 6e6 : 10e6) / Math.max(1, box.width * box.height)));   // (a very big page stays within the iPad's memory)
          const png = await inkPng(items, Math.round(box.width * ik), Math.round(box.height * ik));
          if (png) { const im = await out.embedPng(png); page.drawImage(im, { x: box.x, y: box.y, width: box.width, height: box.height }); }
        }
        if (cropped) {
          // show only the cropped part (or this piece of a cut page)
          const X = box.x + bx.x * box.width, Y = box.y + (1 - bx.y - bx.h) * box.height, Wc = bx.w * box.width, Hc = bx.h * box.height;
          page.setMediaBox(X, Y, Wc, Hc); page.setCropBox(X, Y, Wc, Hc);
        }
        continue;
      }
    }
    // Photos, manuscript paper and rotated PDF pages: flatten to one image per page.
    const [pw, ph] = doc.sizes[i];
    const scale = Math.min(4, FLAT_LONG / Math.max(pw, ph));
    const cw = Math.round(pw * scale), ch = Math.round(ph * scale);
    const c = document.createElement('canvas');
    await doc.render(i, c, cw, ch);
    const g = c.getContext('2d');
    for (const s of items) drawItem(g, s, c.width, c.height, false);
    let cc = c, fw = 1, fh = 1;
    if (cropped) {
      cc = document.createElement('canvas'); cc.width = Math.round(c.width * bx.w); cc.height = Math.round(c.height * bx.h);
      cc.getContext('2d').drawImage(c, Math.round(bx.x * c.width), Math.round(bx.y * c.height), cc.width, cc.height, 0, 0, cc.width, cc.height);
      fw = bx.w; fh = bx.h;
    }
    const jpg = await canvasToBytes(cc, 'image/jpeg', 0.92);
    c.width = c.height = 0; cc.width = cc.height = 0;
    const im = await out.embedJpg(jpg);
    const pics = kindOf(doc, file, orig) === 'images';
    const ptW = (pics ? 595 : pw) * fw, ptH = (pics ? (595 * ph) / pw : ph) * fh;
    page = out.addPage([ptW, ptH]);
    page.drawImage(im, { x: 0, y: 0, width: ptW, height: ptH });
  }
  onProgress && onProgress(1);
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// One page as a picture (JPEG), with or without the markings: { blob }
export async function exportPicture({ score, doc, i, withInk, box, long = 2400 }) {
  setPaperColor('#ffffff');
  await loadMusicFont();
  const [pw, ph] = doc.sizes[i];
  const k = long / Math.max(pw, ph);
  const W = Math.round(pw * k), H = Math.round(ph * k);
  const c = document.createElement('canvas');
  await doc.render(i, c, W, H);
  const g = c.getContext('2d');
  if (withInk) {
    const items = (await loadItems(score.id + ':' + inkKeyOf(doc, i))).filter((s) => s.t !== 'passage' && s.t !== 'note');
    if (items.length) { await preloadAssets(items); await settleMasks(items); for (const s of items) drawItem(g, s, c.width, c.height, false); }
  }
  let out = c;
  if (box && !(box.x < 0.002 && box.y < 0.002 && box.w > 0.998 && box.h > 0.998)) {
    out = document.createElement('canvas'); out.width = Math.round(W * box.w); out.height = Math.round(H * box.h);
    out.getContext('2d').drawImage(c, Math.round(box.x * W), Math.round(box.y * H), out.width, out.height, 0, 0, out.width, out.height);
  }
  // white under everything (a JPEG has no see-through)
  const f = document.createElement('canvas'); f.width = out.width; f.height = out.height;
  const fg = f.getContext('2d'); fg.fillStyle = '#fff'; fg.fillRect(0, 0, f.width, f.height); fg.drawImage(out, 0, 0);
  const blob = await new Promise((res) => f.toBlob(res, 'image/jpeg', 0.92));
  c.width = c.height = 0; if (out !== c) out.width = out.height = 0; f.width = f.height = 0;
  return blob;
}
