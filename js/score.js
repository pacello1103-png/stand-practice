// Score documents (PDF, photos, manuscript paper), page rendering, reading the title and
// composer from a PDF, and finding a clean gap between systems for half-page turns.
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { loadMusicFont } from './ink.js';
import { paintCover } from './covers.js';
import { pixGet, pixPut, pixHas } from './pixcache.js';
import { db } from './db.js';
import { drawNotebookPage, drawCover, PAGE_W as NB_W, PAGE_H as NB_H } from './notebook.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
// drawn pages kept as pictures: up to this size, and only those slower than this to draw (ms)
const PIX_MAX = 7e6, PIX_SLOW = 120;
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
  tab: { label: 'Guitar tab', staves: [['tab']], systems: 10, lines: 6, space: 8 },
  lined: { label: 'Lined', kind: 'lined' },
  dots: { label: 'Dot grid', kind: 'dots' },
  grid: { label: 'Squared', kind: 'grid' },
  plain: { label: 'Plain', kind: 'plain' },
};
const PAPER_W = 595, PAPER_H = 842;
const CLEF = { g: ['', 3], f: ['', 1], alto: ['', 2], tenor: ['', 1] }; // glyph, line index from top (0..4)

function drawPaper(ctx, tpl, pageIndex, w, h) {
  const def = PAPERS[tpl] || PAPERS.treble;
  const k = w / PAPER_W;
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.scale(k, k);
  if (def.kind) {
    const step = 22, x0 = 40, x1 = PAPER_W - 40, y0 = 60, y1 = PAPER_H - 40;
    if (def.kind === 'lined') {
      ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let y = y0 + step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
      ctx.strokeStyle = '#e7a3a3'; ctx.beginPath(); ctx.moveTo(x0 + 34, y0); ctx.lineTo(x0 + 34, y1); ctx.stroke();
    } else if (def.kind === 'grid') {
      ctx.strokeStyle = '#d3d9e6'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let y = y0; y <= y1 + 0.1; y += step / 1.5) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      for (let x = x0; x <= x1 + 0.1; x += step / 1.5) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      ctx.stroke();
    } else if (def.kind === 'dots') {
      ctx.fillStyle = '#9aa5ba';
      for (let y = y0; y <= y1 + 0.1; y += step / 1.5) for (let x = x0; x <= x1 + 0.1; x += step / 1.5) { ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
    return;
  }
  const sp = def.space || 7.2;               // staff space in points
  const left = 54, right = PAPER_W - 46;
  const top = pageIndex === 0 ? 120 : 58, bottom = PAPER_H - 50;
  const nStaff = def.staves[0].length;
  const staffH = sp * ((def.lines || 5) - 1);
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
      const nl = def.lines || 5;
      for (let l = 0; l < nl; l++) { ctx.moveTo(left, sy + l * sp); ctx.lineTo(right, sy + l * sp); }
      ctx.stroke();
      if (clef === 'tab') {
        ctx.save(); ctx.font = `700 ${sp * 1.25}px "Helvetica Neue", Arial, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ['T', 'A', 'B'].forEach((ch, q) => ctx.fillText(ch, left + sp * 0.7, sy + sp * (1 + q * 1.5))); ctx.restore();
      } else if (clef && CLEF[clef]) {
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
// What identifies a file's pages, so their sizes can be kept and opening needn't measure every page.
export function sizesKey(file) {
  if (!file) return '';
  if (file.rot && Object.keys(file.rot).length) return sizesKey({ ...file, rot: null });   // (the sizes kept are those before turning)
  if (file.more && file.more.length) return sizesKey({ ...file, more: null }) + '+' + file.more.join(',');
  if (file.kind === 'pdf') return 'pdf:' + (file.data ? file.data.byteLength : 0);
  if (Array.isArray(file.data)) return 'img:' + file.data.length + ':' + file.data.map((b) => b && b.size).join(',');
  return '';
}
// A score with pages added from other files (file.more: the ids of those files, kept apart so the
// score's own file is never written again): one document, its own pages first.
export async function openDocument(file, known) {
  const d = await openJoined(file, known);
  return file && file.rot && Object.keys(file.rot).length ? rotateDoc(d, file.rot) : d;
}
// Pages turned a quarter (or half) round: rot = { page: 90 | 180 | 270 } (clockwise)
export function rotateDoc(doc, rot) {
  const deg = (i) => ((+rot[i] || 0) % 360 + 360) % 360;
  return {
    ...doc,
    rawSizes: doc.sizes,
    sizes: doc.sizes.map((s, i) => (deg(i) % 180 ? [s[1], s[0]] : s)),
    render: async (i, canvas, w, h, opts) => {
      const a = deg(i); if (!a) return doc.render(i, canvas, w, h, opts);
      const tmp = document.createElement('canvas'), side = a % 180;
      await doc.render(i, tmp, side ? h : w, side ? w : h, opts);
      canvas.width = Math.round(w); canvas.height = Math.round(h);
      const g = canvas.getContext('2d');
      g.translate(canvas.width / 2, canvas.height / 2); g.rotate((a * Math.PI) / 180);
      g.drawImage(tmp, -tmp.width / 2, -tmp.height / 2);
      tmp.width = tmp.height = 0;
    },
    pixHas: (i, w, h) => (deg(i) || !doc.pixHas ? Promise.resolve(true) : doc.pixHas(i, w, h)),
    destroy: () => doc.destroy(),
  };
}
async function openJoined(file, known) {
  if (file && file.more && file.more.length) {
    const own = await openDocumentOne({ ...file, more: null }, known && known.v && known.k === sizesKey(file) ? { k: sizesKey({ ...file, more: null }), v: known.v, prefix: true } : null);
    const parts = [own], kinds = [file.kind];
    for (const id of file.more) { const f = await db.get('files', id).catch(() => null); if (f) { try { parts.push(await openDocumentOne(f)); kinds.push(f.kind); } catch (e) { console.warn(e); } } }
    const at = []; parts.forEach((d, k) => { for (let i = 0; i < d.pages; i++) at.push([k, i]); });
    return {
      kindOf: (i) => kinds[at[i][0]] || file.kind,
      pages: at.length, sizes: parts.flatMap((d) => d.sizes), pdf: own.pdf, ownPages: own.pages,
      render(i, canvas, w, h, opts) { const [k, j] = at[i]; return parts[k].render(j, canvas, w, h, opts); },
      pixHas: (i, w, h) => { const [k, j] = at[i]; return parts[k].pixHas ? parts[k].pixHas(j, w, h) : Promise.resolve(true); },
      destroy() { for (const d of parts) try { d.destroy(); } catch {} },
    };
  }
  return openDocumentOne(file, known);
}
async function openDocumentOne(file, known) {
  const useKnown = (n) => (known && known.k && known.k === sizesKey(file) && Array.isArray(known.v) && (known.v.length === n || (known.prefix && known.v.length > n)) ? known.v.slice(0, n).map((x) => [x[0], x[1]]) : null);
  if (file.kind === 'paper') {
    await loadMusicFont();
    const cover = file.cover ? 1 : 0;
    const pages = (file.pages || 1) + cover;
    return {
      pages, sizes: Array.from({ length: pages }, (_, i) => (file.pagesLand && file.pagesLand[i - cover] ? [NB_H, NB_W] : [NB_W, NB_H])), paper: true, cover: !!cover,
      async render(i, canvas, w, h) {
        canvas.width = Math.round(w); canvas.height = Math.round(h);
        const g = canvas.getContext('2d');
        if (cover && i === 0) await paintCover(g, file, canvas.width, canvas.height);
        else drawNotebookPage(g, file, i - cover, canvas.width, canvas.height);
      },
      destroy() {},
    };
  }
  if (file.kind === 'pdf') {
    const fid = file.id ? `${file.id}:${file.data.byteLength}` : null;
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(file.data.slice(0)), ...PDF_OPTS }).promise;
    // all pages are asked for at once (one after another took a long time on long scores)
    const sizes = useKnown(pdf.numPages) || await Promise.all(Array.from({ length: pdf.numPages }, (_, k) => pdf.getPage(k + 1).then((p) => { const vp = p.getViewport({ scale: 1 }); return [vp.width, vp.height]; })));
    // PDF.js keeps everything it read for a page (its pictures above all: a scanned page holds
    // tens of MB) until told to let go. Only the last few pages drawn keep theirs; the others
    // are cleaned up, or a long score (the Pages panel draws every page) runs the iPhone out
    // of memory and Stand is closed by iOS.
    const live = [], drawing = new Map();
    const done = (i, page) => {
      drawing.set(i, (drawing.get(i) || 1) - 1);
      const at = live.indexOf(i); if (at >= 0) live.splice(at, 1); live.push(i);
      while (live.length > 4) {
        const old = live.shift();
        if (drawing.get(old) > 0) { live.push(old); break; }
        pdf.getPage(old + 1).then((pg) => { if (!(drawing.get(old) > 0)) pg.cleanup(); }).catch(() => {});
      }
    };
    return {
      pages: pdf.numPages, sizes, pdf,
      async render(i, canvas, w, h, opts = {}) {
        const W = Math.round(w), H = Math.round(h);
        // a page drawn slowly before is shown from its picture at once
        const key = fid && W * H <= PIX_MAX ? `${fid}|${i}|${W}x${H}` : null;
        if (key) {
          const b = await pixGet(key);
          if (b) {
            try {
              const bmp = await createImageBitmap(b);
              canvas.width = W; canvas.height = H;
              const g = canvas.getContext('2d', { alpha: false });
              g.drawImage(bmp, 0, 0, W, H); if (bmp.close) bmp.close();
              return;
            } catch { /* drawn again below */ }
          }
        }
        const t0 = performance.now();
        drawing.set(i, (drawing.get(i) || 0) + 1);
        let page = null;
        try {
        page = await pdf.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: w / vp1.width });
        canvas.width = W; canvas.height = H;
        const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' });
        // a drawing no longer wanted (the page was turned past) stops at once
        if (opts.ctl) { if (opts.ctl.aborted) task.cancel(); else opts.ctl.fns.push(() => task.cancel()); }
        await task.promise;
        // only pages that were slow to draw are kept (quick vector pages are drawn sharp each time)
        if (key && (opts.keep || performance.now() - t0 > PIX_SLOW)) canvas.toBlob((b) => pixPut(key, b, fid), 'image/jpeg', 0.9);
        } finally { done(i, page); }
      },
      pixHas: (i, w, h) => { const W = Math.round(w), H = Math.round(h); return fid && W * H <= PIX_MAX ? pixHas(`${fid}|${i}|${W}x${H}`) : Promise.resolve(true); },
      destroy() { pdf.destroy(); },
    };
  }
  // Photos and scans: decode only the pages being shown (a few at a time), so a long scan
  // never holds every full-size photo in memory.
  let sizes = useKnown(file.data.length);
  if (!sizes) { sizes = []; for (const blob of file.data) { const b = await createImageBitmap(blob); sizes.push([b.width, b.height]); if (b.close) b.close(); } }
  // A few decoded pages are kept; one is only closed when no drawing is still using it (closing
  // a picture in use left pages or thumbnails blank now and then).
  const lru = new Map();
  const drop = (e) => { e.gone = true; if (!e.uses) e.p.then((b) => b.close && b.close(), () => {}); };
  const take = (i) => {
    let e = lru.get(i);
    if (e) { lru.delete(i); lru.set(i, e); }
    else {
      e = { p: createImageBitmap(file.data[i]), uses: 0, gone: false };
      lru.set(i, e);
      while (lru.size > 3) { const [k, old] = lru.entries().next().value; lru.delete(k); drop(old); }
    }
    e.uses++;
    return e;
  };
  const give = (e) => { e.uses--; if (e.gone && !e.uses) e.p.then((b) => b.close && b.close(), () => {}); };
  return {
    pages: sizes.length, sizes,
    async render(i, canvas, w, h) {
      const e = take(i);
      try {
        const bmp = await e.p;
        canvas.width = Math.round(w); canvas.height = Math.round(h);
        const c = canvas.getContext('2d', { alpha: false });
        c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
        c.imageSmoothingQuality = 'high';
        c.drawImage(bmp, 0, 0, w, h);
      } finally { give(e); }
    },
    destroy() { for (const e of lru.values()) drop(e); lru.clear(); },
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
// lines that are never the title: tempo marks, an instrument on its own, editors and arrangers
const TEMPO = /^\(?\s*(tempo|allegr\w*|andant\w*|adagi\w*|moderato|presto|prestissimo|largo|larghetto|lento|vivace|vivo|grave|maestoso|sostenuto|cantabile|con moto|tranquillo|animato|risoluto|scherzando|rubato|a tempo)\b[^]{0,40}$/i;
const NOT_TITLE = /^(((solo\s+)?(violoncello|cello|violino|violin|viola|contrabass\w*|double bass|kontrabass|flute|flauto|fl[oö]te|oboe|clarinet\w*|klarinette|fagott\w*|bassoon|horn|corno|trumpet|tromba|trombone|piano|pianoforte|klavier|organ|orgel|soprano|alto|tenor|bass|basso|voice|guitar|gitarre|harp|arpa)(\s+(i{1,3}|\d|solo|principale|and piano|e pianoforte|und klavier|et piano))?\s*\.?)|(edited|edition|ed\.|herausgegeben|hrsg|revised|revidiert|arr\.?|arranged|arrangement|bearbeitet|bearb\.|transcri\w+|fingered|fingering|fingersatz|doigt\w*)\b.*)$/i;
const looksLikeName = (s) => /^(\p{Lu}[\p{L}'’.-]*\s+){0,3}\p{Lu}[\p{L}'’-]+$/u.test(s) && !/\d/.test(s) && s.length < 36;
const GENERIC = /^(sonat[ae]n?|sonatin[ae]|suite|concert[oe]?|konzert|etude|étude|studie|study|caprice|capriccio|fantasi[ae]|fantaisie|nocturne|prelude|prélude|präludium|romance|romanze|serenade|sérénade|variations?|variationen|partita|trio|quartet|quartett|duo|rondo|scherzo|menuet|minuet|waltz|valse|walzer|march|marsch|marche|élégie|elegie|elegy|air|aria|lied|song|dance|danse|tanz)$/i;
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
      let topLines = lines.filter((l) => l.y < l.H * 0.42 && !JUNK.test(l.text) && !NOT_TITLE.test(l.text) && /\p{L}{2}/u.test(l.text) && l.text.length < 90);
      // a tempo mark is not the title, unless it is clearly the biggest words on the page ("Allegro appassionato")
      { const mx = Math.max(0, ...topLines.map((l) => l.size)); topLines = topLines.filter((l) => !TEMPO.test(l.text) || l.size >= mx * 0.98 && topLines.filter((o) => o.size >= mx * 0.8).length === 1); }
      // the biggest line is sometimes the composer's name: that is the composer, and the title is the next
      const nameOnly = (l) => { const c = findComposer(l.text, composers); return c && l.text.length < 40 && fold(l.text).split(' ').length <= 4 ? c : null; };
      if (topLines.length) {
        const sizes = topLines.map((l) => l.size).sort((a, b) => a - b);
        const median = sizes[sizes.length >> 1];
        const bySize = [...topLines].sort((a, b) => b.size - a.size || a.y - b.y);
        let big = bySize[0];
        const nc = nameOnly(big);
        if (nc) { out.composer = nc.n; topLines = topLines.filter((l) => l !== big); big = bySize.find((l) => topLines.includes(l) && !nameOnly(l)); }
        if (big && (big.size >= median * 1.15 || topLines.length <= 3 || nc)) {
          out.title = titleCase(big.text);
          // "Sonata" alone: the line under it says which ("No. 2 in G minor, Op. 5")
          const nearBelow = (l) => l !== big && l.y > big.y && l.y - big.y < big.size * 3 && l.size >= big.size * 0.45 && l.text.length < 60 && !nameOnly(l);
          const next = topLines.find((l) => nearBelow(l) && (GENERIC.test(big.text.trim()) || /(op\.?\s*\d|no\.?\s*\d|nr\.?\s*\d|bwv|hob|k\.\s*\d|kv|d\.\s*\d|in [a-h](\s|$|-|♭|♯)|in [a-h] (major|minor|dur|moll)|en [a-z]+ (majeur|mineur)|for |pour |für |per )/i.test(l.text)));
          if (next) out.title += (GENERIC.test(big.text.trim()) && !/^[,(]/.test(next.text) ? ' ' : ', ') + titleCase(next.text);
          // a word above it that belongs to the title ("Six Suites" / "for Cello Solo" are fine; "Sonata" over "No. 1" too)
          const above = topLines.find((l) => l !== big && l.y < big.y && big.y - l.y < big.size * 2 && l.size >= big.size * 0.7 && GENERIC.test(l.text.trim()));
          if (above && !out.title.toLowerCase().includes(above.text.toLowerCase())) out.title = titleCase(above.text) + ' ' + out.title;
        }
      }
      const pdfTitle = meta && meta.info && meta.info.Title;
      if (!out.title && pdfTitle && !/untitled|microsoft|\.pdf|\.mus|sibelius|finale/i.test(pdfTitle)) out.title = tidy(pdfTitle);
      const allTop = lines.filter((l) => l.y < l.H * 0.5).map((l) => l.text).join('  ');
      const c = findComposer(allTop, composers) || findComposer((meta && meta.info && meta.info.Author) || '', composers);
      if (c) out.composer = c.n;
      else {
        // a name on the right above the music ("Carl Davidoff (1838-1889)"), but only if it looks like a name
        if (!out.composer) for (const l of lines) {
          if (!(l.y < l.H * 0.42 && l.x > l.W * 0.45) || JUNK.test(l.text) || NOT_TITLE.test(l.text) || TEMPO.test(l.text) || out.title.includes(l.text)) continue;
          const nm = tidy(l.text.replace(/\(.*?\)|\d{4}\s*[-–]\s*\d{0,4}|^(music by|composed by|komponiert von|von|by|de|par|di)\s+/gi, ''));
          if (looksLikeName(nm)) { out.composer = titleCase(nm); break; }
        }
      }
    } catch (e) { console.warn('read info', e); }
  }
  if (!out.composer) { const c = findComposer(fileName.replace(/[_-]+/g, ' '), composers); if (c) out.composer = c.n; }
  // a title that is only a composer's name, a number or a generic word is no title
  if (out.title && (findComposer(out.title, composers) && fold(out.title).split(' ').length <= 3 || !/\p{L}{3}/u.test(out.title))) out.title = '';
  if (out.title.length > 80) out.title = out.title.slice(0, 80).replace(/\s+\S*$/, '') + '…';
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

// ---------- page order (deleted pages are hidden, never destroyed) ----------
// A page can also be cut into pieces (cuts: heights 0..1 where it is cut); each piece shows as
// its own page. Markings stay with the original page, so nothing is lost.
export function mapDoc(doc, map, cuts, glue) {
  const order = (map || [...Array(doc.pages).keys()]).filter((i) => i >= 0 && i < doc.pages);
  const pieces = [];
  for (const o of order) {
    const ys = [0, ...((cuts && cuts[o]) || []).filter((y) => y > 0.02 && y < 0.98).sort((a, b) => a - b), 1];
    for (let k = 0; k < ys.length - 1; k++) pieces.push({ o, box: ys.length > 2 ? { x: 0, y: ys[k], w: 1, h: ys[k + 1] - ys[k] } : null });
  }
  // lines glued from the next page onto the end of this one, so a turn falls where it should
  let glued = false;
  if (glue) {
    for (let i = 0; i + 1 < pieces.length; i++) {
      const p = pieces[i], q = pieces[i + 1], g = glue[p.o];
      if (!g || p.box || q.box || q.o !== g.next || !(g.cut > 0.03 && g.cut < 0.97)) continue;
      p.parts = [{ o: p.o, y0: 0, y1: Math.min(1, Math.max(0.2, g.end || 1)) }, { o: q.o, y0: g.top || 0, y1: g.cut }];
      q.box = { x: 0, y: g.cut, w: 1, h: 1 - g.cut };
      glued = true;
    }
  }
  if (!map && !glued && !pieces.some((p) => p.box)) return { ...doc, orig: (i) => i, piece: () => null, composite: () => false };
  const sizeOf = (p) => {
    if (!p.parts) return doc.sizes[p.o];
    const [w0] = doc.sizes[p.parts[0].o];
    let h = 0; for (const q of p.parts) { const [pw, ph] = doc.sizes[q.o]; h += (q.y1 - q.y0) * ph * (w0 / pw); }
    return [w0, h];
  };
  return {
    ...doc,
    pages: pieces.length,
    sizes: pieces.map(sizeOf),
    render: async (i, canvas, w, h, opts) => {
      const p = pieces[i];
      if (!p.parts) return doc.render(p.o, canvas, w, h, opts);
      // draw each part one under the other at the width of the page
      canvas.width = Math.round(w); canvas.height = Math.round(h);
      const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      const [W0, H0] = sizeOf(p); const k = canvas.width / W0;
      let y = 0;
      for (const q of p.parts) {
        const [pw, ph] = doc.sizes[q.o];
        const tmp = document.createElement('canvas');
        const tw = canvas.width, th = Math.round(tw * ph / pw);
        await doc.render(q.o, tmp, tw, th);
        const sy = q.y0 * tmp.height, sh = (q.y1 - q.y0) * tmp.height;
        g.drawImage(tmp, 0, sy, tmp.width, sh, 0, y, canvas.width, sh * (canvas.width / tmp.width));
        y += sh * (canvas.width / tmp.width);
        tmp.width = tmp.height = 0;
      }
      void H0; void k;
    },
    pixHas: (i, w, h) => (pieces[i].parts || !doc.pixHas ? Promise.resolve(true) : doc.pixHas(pieces[i].o, w, h)),
    orig: (i) => pieces[i].o,
    piece: (i) => pieces[i].box,
    composite: (i) => !!pieces[i].parts,
    gluedFrom: (i) => (pieces[i].parts ? pieces[i].parts[1].o : null),
    destroy: () => doc.destroy(),
    base: doc,
  };
}

// Blank rows across the width of a page (0..1), for cutting between systems.
export function pageGaps(canvas) {
  const rows = 500;
  const prof = inkProfile(canvas, rows);
  const gaps = [];
  let start = -1;
  for (let y = 0; y <= rows; y++) {
    const blank = y < rows && prof[y] < 0.01;
    if (blank && start < 0) start = y;
    if (!blank && start >= 0) { if (y - start >= 3) gaps.push({ mid: (start + y - 1) / 2 / rows, len: (y - start) / rows }); start = -1; }
  }
  return gaps;
}
// Places where both pages are blank, for half-page turns that stay between the systems.
export function commonGaps(curCanvas, nextCanvas) {
  const rows = 400;
  const a = inkProfile(curCanvas, rows), b = inkProfile(nextCanvas, rows);
  const out = [];
  let start = -1;
  for (let y = 0; y <= rows; y++) {
    const blank = y < rows && a[y] < 0.012 && b[y] < 0.012;
    if (blank && start < 0) start = y;
    if (!blank && start >= 0) { if (y - start >= 2) out.push({ mid: (start + y - 1) / 2 / rows, len: (y - start) / rows }); start = -1; }
  }
  return out.filter((g) => g.mid > 0.08 && g.mid < 0.92);
}

// ---------- trim white margins ----------
// Returns the box (0..1) that holds the printed content, with a little air around it.
export function contentBox(canvas) {
  const w = 220, h = Math.max(1, Math.round((220 * canvas.height) / canvas.width));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const rowInk = new Uint16Array(h), colInk = new Uint16Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] < 600) { rowInk[y]++; colInk[x]++; }
  }
  // ignore specks: a row/column counts only with a few dark pixels
  const firstRow = rowInk.findIndex((v) => v > 1), lastRow = h - 1 - [...rowInk].reverse().findIndex((v) => v > 1);
  const firstCol = colInk.findIndex((v) => v > 1), lastCol = w - 1 - [...colInk].reverse().findIndex((v) => v > 1);
  if (firstRow < 0 || firstCol < 0) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = 0.018;
  const x0 = Math.max(0, firstCol / w - pad), x1 = Math.min(1, (lastCol + 1) / w + pad);
  const y0 = Math.max(0, firstRow / h - pad), y1 = Math.min(1, (lastRow + 1) / h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function unionBox(a, b) {
  if (!a) return b; if (!b) return a;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
