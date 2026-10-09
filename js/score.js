// Score documents (PDF, photos, manuscript paper), page rendering, reading the title and
// composer from a PDF, and finding a clean gap between systems for half-page turns.
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { loadMusicFont } from './ink.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const PDF_OPTS = {
  cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
};

// ---------- manuscript paper ----------
export const PAPERS = {
  treble: { label: 'Treble clef', staves: [['g']], systems: 12 },
  bass: { label: 'Bass clef', staves: [['f']], systems: 12 },
  alto: { label: 'Alto clef', staves: [['alto']], systems: 12 },
  tenor: { label: 'Tenor clef', staves: [['tenor']], systems: 12 },
  piano: { label: 'Piano (grand staff)', staves: [['g', 'f']], systems: 6, brace: true },
  cellopiano: { label: 'Cello and piano', staves: [['f', 'g', 'f']], systems: 4, brace: true, bracket: true },
  violinpiano: { label: 'Violin and piano', staves: [['g', 'g', 'f']], systems: 4, brace: true, bracket: true },
  duo: { label: 'Two staves (duet)', staves: [['g', 'f']], systems: 6, bracket: true },
  blank: { label: 'Blank staves', staves: [[null]], systems: 12 },
  wide: { label: 'Large staves (teaching)', staves: [[null]], systems: 8, space: 10 },
};
const PAPER_W = 595, PAPER_H = 842;
const CLEF = { g: ['', 3], f: ['', 1], alto: ['', 2], tenor: ['', 1] }; // glyph, line index from top (0..4)

function drawPaper(ctx, tpl, pageIndex, w, h) {
  const def = PAPERS[tpl] || PAPERS.treble;
  const k = w / PAPER_W;
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.scale(k, k);
  const sp = def.space || 7.2;               // staff space in points
  const left = 54, right = PAPER_W - 46;
  const top = pageIndex === 0 ? 120 : 58, bottom = PAPER_H - 50;
  const nStaff = def.staves[0].length;
  const staffH = sp * 4;
  const innerGap = sp * 5.2;                 // between staves of one system
  const sysH = nStaff * staffH + (nStaff - 1) * innerGap;
  const minGap = nStaff > 1 ? sp * 7 : sp * 4.5;
  const avail = bottom - top;
  const nSys = Math.max(1, Math.min(def.systems, Math.floor((avail + minGap) / (sysH + minGap))));
  const gap = nSys > 1 ? (avail - nSys * sysH) / (nSys - 1) : 0;
  ctx.strokeStyle = '#1b1d22'; ctx.fillStyle = '#1b1d22'; ctx.lineWidth = 0.75;
  for (let s = 0; s < nSys; s++) {
    const y0 = top + s * (sysH + gap);
    const sysTop = y0, sysBot = y0 + sysH;
    def.staves[0].forEach((clef, j) => {
      const sy = y0 + j * (staffH + innerGap);
      ctx.beginPath();
      for (let l = 0; l < 5; l++) { ctx.moveTo(left, sy + l * sp); ctx.lineTo(right, sy + l * sp); }
      ctx.stroke();
      if (clef && CLEF[clef]) {
        const [g, line] = CLEF[clef];
        ctx.font = `${sp * 4}px Bravura`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.fillText(g, left + sp * 0.9, sy + line * sp);
      }
    });
    // system barline at the left, and the final barline
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(left, sysTop); ctx.lineTo(left, sysBot); ctx.moveTo(right, sysTop); ctx.lineTo(right, sysBot); ctx.stroke();
    ctx.lineWidth = 0.75;
    if (def.brace && nStaff >= 2) {
      const bTop = y0 + (nStaff - 2) * (staffH + innerGap);
      const bh = 2 * staffH + innerGap;
      ctx.save(); ctx.font = `${bh}px Bravura`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
      ctx.fillText('', left - 3, bTop + bh); ctx.restore();
    }
    if (def.bracket && nStaff >= 2 && !def.brace) {
      ctx.save(); ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(left - 5, sysTop - 2); ctx.lineTo(left - 5, sysBot + 2); ctx.stroke(); ctx.restore();
    }
  }
  ctx.restore();
}

// ---------- documents ----------
export async function openDocument(file) {
  if (file.kind === 'paper') {
    await loadMusicFont();
    const pages = file.pages || 1;
    return {
      pages, sizes: Array.from({ length: pages }, () => [PAPER_W, PAPER_H]), paper: true,
      async render(i, canvas, w, h) { canvas.width = Math.round(w); canvas.height = Math.round(h); drawPaper(canvas.getContext('2d'), file.template, i, canvas.width, canvas.height); },
      destroy() {},
    };
  }
  if (file.kind === 'pdf') {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(file.data.slice(0)), ...PDF_OPTS }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      sizes.push([vp.width, vp.height]);
    }
    return {
      pages: pdf.numPages, sizes, pdf,
      async render(i, canvas, w, h) {
        const page = await pdf.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: w / vp1.width });
        canvas.width = Math.round(w); canvas.height = Math.round(h);
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' }).promise;
      },
      destroy() { pdf.destroy(); },
    };
  }
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

// ---------- reading title and composer ----------
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const JUNK = /(©|copyright|imslp|public domain|edition|verlag|publish|printed|all rights|\bpage\b|^\d+$|www\.|http|plate|stich|lith)/i;
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '').trim();
const titleCase = (s) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s);

function findComposer(text, composers) {
  const f = ' ' + fold(text) + ' ';
  let best = null, score = 0;
  for (const c of composers) for (const k of c.k) {
    if (k.length < 4 || !f.includes(' ' + k + ' ')) continue;
    let sc = k.length + c.p * 3;
    for (const g of c.g) if (f.includes(' ' + g + ' ')) sc += 5;
    if (sc > score) { score = sc; best = c; }
  }
  return best;
}

export async function readScoreInfo(doc, fileName, composers) {
  const out = { title: '', composer: '' };
  let lines = [];
  if (doc.pdf) {
    try {
      const meta = await doc.pdf.getMetadata().catch(() => null);
      const page = await doc.pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({
        s: it.str, x: it.transform[4], y: vp.height - it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
      }));
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      for (const it of items) {
        const L = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2.5, it.size * 0.35));
        if (L) { L.parts.push(it); L.size = Math.max(L.size, it.size); }
        else lines.push({ y: it.y, size: it.size, parts: [it] });
      }
      lines = lines.map((l) => {
        l.parts.sort((a, b) => a.x - b.x);
        let text = '', lastX = -1e9;
        for (const p of l.parts) { text += (text && p.x - lastX > p.size * 0.25 ? ' ' : '') + p.s; lastX = p.x + p.s.length * p.size * 0.5; }
        return { text: tidy(text), y: l.y, size: l.size, x: l.parts[0].x, right: l.parts[l.parts.length - 1].x, H: vp.height, W: vp.width };
      }).filter((l) => l.text.length > 1);
      const topLines = lines.filter((l) => l.y < l.H * 0.42 && !JUNK.test(l.text) && /\p{L}{2}/u.test(l.text));
      if (topLines.length) {
        const sizes = topLines.map((l) => l.size).sort((a, b) => a - b);
        const median = sizes[sizes.length >> 1];
        const big = [...topLines].sort((a, b) => b.size - a.size)[0];
        if (big.size >= median * 1.15 || topLines.length <= 3) {
          out.title = titleCase(big.text);
          const next = topLines.find((l) => l !== big && l.y > big.y && l.y - big.y < big.size * 3 && l.size >= big.size * 0.45 &&
            /(op\.?|no\.?|bwv|k\.|in [a-g]|for |pour |für |sonat|concert|suite|\d)/i.test(l.text) && l.text.length < 60);
          if (next) out.title += ', ' + titleCase(next.text);
        }
      }
      const pdfTitle = meta && meta.info && meta.info.Title;
      if (!out.title && pdfTitle && !/untitled|microsoft|\.pdf|\.mus|sibelius|finale/i.test(pdfTitle)) out.title = tidy(pdfTitle);
      const allTop = lines.filter((l) => l.y < l.H * 0.5).map((l) => l.text).join('  ');
      const c = findComposer(allTop, composers) || findComposer((meta && meta.info && meta.info.Author) || '', composers);
      if (c) out.composer = c.n;
      else {
        const right = lines.find((l) => l.y < l.H * 0.42 && l.x > l.W * 0.5 && /\p{Lu}\p{Ll}+/u.test(l.text) && !JUNK.test(l.text) && l.text !== out.title && l.text.length < 40);
        if (right) out.composer = tidy(right.text.replace(/\(.*?\)|\d{4}\s*[-–]\s*\d{4}|^(music by|composed by|von|by|de)\s+/gi, ''));
      }
    } catch (e) { console.warn('read info', e); }
  }
  if (!out.composer) { const c = findComposer(fileName.replace(/[_-]+/g, ' '), composers); if (c) out.composer = c.n; }
  return out;
}

// ---------- half-page turn: find a gap between systems ----------
function inkProfile(canvas, rows) {
  const w = 160, h = rows;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const prof = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 8; x < w - 8; x++) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 560) dark++; }
    prof[y] = dark / (w - 16);
  }
  return prof;
}
// Returns a split position (0..1) where both pages are blank across the width, near the middle.
export function findSplit(curCanvas, nextCanvas) {
  try {
    const rows = 400;
    const a = inkProfile(curCanvas, rows), b = inkProfile(nextCanvas, rows);
    let best = null;
    let runStart = -1;
    for (let y = Math.floor(rows * 0.28); y <= Math.ceil(rows * 0.72); y++) {
      const blank = a[y] < 0.012 && b[y] < 0.012;
      if (blank && runStart < 0) runStart = y;
      if ((!blank || y === Math.ceil(rows * 0.72)) && runStart >= 0) {
        const end = blank ? y : y - 1, len = end - runStart + 1, mid = (runStart + end) / 2;
        const score = len - Math.abs(mid - rows / 2) * 0.35;
        if (len >= 3 && (!best || score > best.score)) best = { score, mid };
        runStart = -1;
      }
    }
    return best ? best.mid / rows : 0.5;
  } catch { return 0.5; }
}
