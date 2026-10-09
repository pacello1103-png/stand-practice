// Score documents (PDF or images), page rendering with a small cache, and Apple Pencil markings.
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { db } from './db.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const PDF_OPTS = {
  cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
};

// ---------- documents ----------
export async function openDocument(file) {
  if (file.kind === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(file.data.slice(0)), ...PDF_OPTS }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      sizes.push([vp.width, vp.height]);
    }
    return {
      pages: pdf.numPages, sizes,
      async render(i, canvas, w, h) {
        const page = await pdf.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: w / vp1.width });
        canvas.width = Math.round(w); canvas.height = Math.round(h);
        const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' });
        await task.promise;
      },
      destroy() { pdf.destroy(); },
    };
  }
  // images
  const bitmaps = [];
  for (const blob of file.data) bitmaps.push(await createImageBitmap(blob));
  return {
    pages: bitmaps.length, sizes: bitmaps.map((b) => [b.width, b.height]),
    async render(i, canvas, w, h) {
      canvas.width = Math.round(w); canvas.height = Math.round(h);
      const c = canvas.getContext('2d', { alpha: false });
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      c.imageSmoothingQuality = 'high';
      c.drawImage(bitmaps[i], 0, 0, w, h);
    },
    destroy() { bitmaps.forEach((b) => b.close && b.close()); },
  };
}

export async function makeThumb(doc) {
  const [pw, ph] = doc.sizes[0];
  const w = 360, h = Math.round((w * ph) / pw);
  const c = document.createElement('canvas');
  await doc.render(0, c, w, h);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.82));
}

// ---------- ink ----------
const inkKey = (scoreId, page) => scoreId + ':' + page;

function drawStroke(ctx, s, W, H) {
  const pts = s.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color;
  const base = (s.tool === 'hl' ? 0.018 : 0.0028) * W;
  if (s.tool === 'hl') { ctx.globalAlpha = 0.32; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
  if (pts.length === 1) {
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(pts[0][0] * W, pts[0][1] * H, base * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
  }
  if (s.tool === 'hl') {
    ctx.lineWidth = base; ctx.beginPath(); ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
    ctx.stroke();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      ctx.lineWidth = base * (0.55 + 0.9 * ((p0[2] + p1[2]) / 2));
      ctx.beginPath(); ctx.moveTo(p0[0] * W, p0[1] * H); ctx.lineTo(p1[0] * W, p1[1] * H); ctx.stroke();
    }
  }
  ctx.restore();
}

export class InkLayer {
  constructor(canvas, scoreId, page) {
    this.canvas = canvas; this.scoreId = scoreId; this.page = page;
    this.strokes = []; this.loaded = false;
  }
  async load() {
    const rec = await db.get('ink', inkKey(this.scoreId, this.page)).catch(() => null);
    this.strokes = rec ? rec.strokes : [];
    this.loaded = true;
    this.redraw();
  }
  save() { return db.put('ink', { key: inkKey(this.scoreId, this.page), strokes: this.strokes }).catch(() => {}); }
  redraw() {
    const c = this.canvas, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of this.strokes) drawStroke(ctx, s, c.width, c.height);
  }
  drawLive(s) {
    if (s.tool === 'hl') { this.redraw(); drawStroke(this.canvas.getContext('2d'), s, this.canvas.width, this.canvas.height); return; }
    drawStroke(this.canvas.getContext('2d'), { ...s, pts: s.pts.slice(-2) }, this.canvas.width, this.canvas.height);
  }
  eraseAt(x, y, r) {
    const before = this.strokes.length;
    this.strokes = this.strokes.filter((s) => !s.pts.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 < r * r));
    if (this.strokes.length !== before) { this.redraw(); return true; }
    return false;
  }
}
