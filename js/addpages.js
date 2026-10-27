// Pages from another file (a PDF, photos or pictures) added to a score or a notebook: a score keeps
// them as files of their own after its pages (a PDF stays a PDF, so the music stays sharp); a
// notebook takes each as a page with the picture on it.
import { openDocument } from './score.js';

const isPdf = (f) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '');
const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|gif|webp|tiff?)$/i.test(f.name || '');
export const usableFiles = (files) => [...files].filter((f) => isPdf(f) || isImage(f));

const toBlob = (c, type = 'image/jpeg', q = 0.9) => new Promise((res) => c.toBlob(res, type, q));
// any picture as a JPEG or PNG the PDF maker can take (HEIC and others go through a canvas)
async function plainPicture(f) {
  // drawn once through a picture element, which turns a photo the way the camera was held (the
  // turn kept in the photo's data is not followed everywhere), at most 3000 pixels on the long
  // side (a camera's full picture takes a lot of the iPad's memory)
  const url = URL.createObjectURL(f);
  try {
    const im = new Image(); im.decoding = 'async';
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('That picture could not be opened.')); im.src = url; });
    const w0 = im.naturalWidth, h0 = im.naturalHeight, k = Math.min(1, 3000 / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    const b = await toBlob(c); c.width = c.height = 0; return b;
  } finally { URL.revokeObjectURL(url); }
}
// every page of a PDF as a picture (for a score of photos, a notebook, or a PDF that cannot be copied)
async function pdfPictures(f, onPage) {
  const doc = await openDocument({ kind: 'pdf', data: await f.arrayBuffer() });
  const out = [];
  try {
    for (let i = 0; i < doc.pages; i++) {
      const [pw, ph] = doc.sizes[i], k = 2000 / Math.max(pw, ph);
      const c = document.createElement('canvas');
      await doc.render(i, c, pw * k, ph * k);
      out.push(await toBlob(c)); c.width = c.height = 0;
      if (onPage) onPage();
    }
  } finally { doc.destroy(); }
  return out;
}
// all the files as a list of pictures, in order
export async function filesAsPictures(files, onPage) {
  const out = [];
  for (const f of files) {
    if (isPdf(f)) out.push(...await pdfPictures(f, onPage));
    else { out.push(await plainPicture(f)); if (onPage) onPage(); }
  }
  return out;
}
