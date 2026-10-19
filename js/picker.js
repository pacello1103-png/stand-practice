// Choose music from a score: pick a score from the library (or a photo / PDF), turn to the page,
// and draw a loop around the part you want, like the Select tool in Markings. Returns the
// picture of that part at a good resolution, and where it came from.
import { db } from './db.js';
import { openDocument, mapDoc } from './score.js';
import { analyse } from './omr.js';
import { cleanPhoto } from './review.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const PK = { picks: new Map(), doc: null, page: 0, resolve: null, box: null, pts: null, thumbs: [], lines: null, sel: [], trim: null, linesCache: new Map() };

export function pickRegion(src, file, opts = {}) {
  return new Promise(async (resolve) => {
    PK.resolve = resolve; PK.box = null; PK.opts = opts; PK.picks = new Map();
    $('#picker').hidden = false; $('#pkDone').disabled = true;
    $('#pkTitle').textContent = opts.title || 'Choose the music';
    if (src === 'file' && file) { await openFile(file); return; }
    if (src && src.scoreId) { await openLibraryScore(src.scoreId, src.page || 0); return; }
    showLibrary();
  });
}
function finish(result) {
  $('#picker').hidden = true;
  for (const u of PK.thumbs) URL.revokeObjectURL(u); PK.thumbs = [];
  if (PK.doc && PK.ownDoc) try { PK.doc.destroy(); } catch {}
  PK.doc = null;
  const r = PK.resolve; PK.resolve = null; if (r) r(result);
}
async function showLibrary() {
  $('#pkLib').hidden = false; $('#pkStage').hidden = true; $('#pkBar').hidden = true; $('#pkDone').hidden = true;
  $('#pkSub').textContent = 'Choose a score';
  const box = $('#pkLib'); box.textContent = '';
  const list = (await db.all('scores')).filter((s) => s.kind !== 'comp').sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  // a photo or a PDF from Files works too
  const fb = el('button', 'card pk-file');
  const ft = el('div', 'thumb pk-file-tile'); ft.innerHTML = '<svg><use href="#i-image"/></svg>';
  fb.append(ft, el('div', 'ttl', 'Photo or file'), el('div', 'cmp', 'An image or a PDF'));
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf,.pdf'; inp.hidden = true;
  inp.addEventListener('change', () => { const f = inp.files[0]; if (f) openFile(f); });
  fb.addEventListener('click', () => inp.click());
  box.append(fb, inp);
  if (!list.length) box.append(el('p', 'hint', 'Your library is empty. Import a score first, or choose a photo.'));
  for (const s of list) {
    const b = el('button', 'card');
    const th = el('div', 'thumb');
    if (s.thumb) { const u = URL.createObjectURL(s.thumb); PK.thumbs.push(u); th.style.backgroundImage = `url(${u})`; }
    b.append(th, el('div', 'ttl', s.title), el('div', 'cmp', s.composer || ''));
    b.addEventListener('click', () => openLibraryScore(s.id, s.lastPage || 0));
    box.append(b);
  }
}
async function openLibraryScore(id, page) {
  const score = await db.get('scores', id);
  const file = score && await db.get('files', score.fileId);
  if (!file) return;
  const base = await openDocument(file);
  PK.picks = new Map();
  PK.doc = mapDoc(base, score.pageMap); PK.ownDoc = true; PK.source = { scoreId: id, title: score.title };
  PK.page = Math.min(page, PK.doc.pages - 1);
  await showPage();
}
async function openFile(f) {
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  // a photo of a page: find the page and take the perspective out first (the reader straightens
  // small tilts itself, and does that better on the untouched picture)
  let img = f;
  if (!isPdf) { try { const r = await cleanPhoto(f, { maxSide: 3000, look: 'none', straight: false }); if (r.found) img = await new Promise((res) => r.canvas.toBlob(res, 'image/jpeg', 0.92)); } catch (err) { console.warn(err); } }
  const base = await openDocument(isPdf ? { kind: 'pdf', data: await f.arrayBuffer() } : { kind: 'images', data: [img] });
  PK.picks = new Map();
  PK.doc = mapDoc(base, null); PK.ownDoc = true; PK.source = { file: f.name };
  PK.page = 0;
  await showPage();
}
async function showPage() {
  $('#pkLib').hidden = true; $('#pkStage').hidden = false; $('#pkBar').hidden = false; $('#pkDone').hidden = false;
  $('#pkSub').textContent = (PK.source.title || PK.source.file || '') ;
  $('#pkPageNo').textContent = `Page ${PK.page + 1} of ${PK.doc.pages}`;
  $('#pkPrev').disabled = PK.page === 0; $('#pkNext').disabled = PK.page >= PK.doc.pages - 1;
  // what was chosen on this page before (several pages can be chosen, one after another)
  const was = PK.picks.get(PK.page);
  PK.box = null; PK.sel = was ? was.sel.slice() : []; PK.trim = was ? { ...was.trim } : null; PK.lines = null; $('#pkHandleL').hidden = $('#pkHandleR').hidden = true;
  syncDone();
  const stage = $('#pkStage'), r = stage.getBoundingClientRect();
  const [pw, ph] = PK.doc.sizes[PK.page];
  const k = Math.min((r.width - 28) / pw, (r.height - 28) / ph);
  const w = Math.round(pw * k), h = Math.round(ph * k);
  const pg = $('#pkPage'); pg.style.width = w + 'px'; pg.style.height = h + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const c = $('#pkCanvas'); await PK.doc.render(PK.page, c, w * dpr, h * dpr);
  const d = $('#pkDraw'); d.width = w * dpr; d.height = h * dpr;
  drawSel();
  findLines();
}
// ---------- the lines of music on the page ----------
async function findLines() {
  const key = PK.doc.id + ':' + PK.page + ':' + (PK.source.scoreId || PK.source.file || '');
  const page = PK.page;
  if (PK.linesCache.has(key)) { PK.lines = PK.linesCache.get(key); drawSel(); return; }
  $('#pkFinding').hidden = false;
  try {
    const [pw, ph] = PK.doc.sizes[page];
    const sc = Math.min(3, Math.max(1, 1700 / pw));
    const c = document.createElement('canvas');
    await PK.doc.render(page, c, pw * sc, ph * sc);
    const A = await analyse(c);
    c.width = c.height = 0;
    if (PK.page !== page || !PK.doc) return;
    const lines = [];
    const W = A.w, H = A.h;
    for (const sys of A.systems || []) {
      const sts = sys.map((i) => A.staves[i]);
      const s0 = sts[0], sp = s0.sp;
      const top = Math.min(...sts.map((q) => q.top)), bot = Math.max(...sts.map((q) => q.bottom));
      const x0 = Math.max(0, Math.min(...sts.map((q) => q.x0)) - sp * 0.6), x1 = Math.min(W, Math.max(...sts.map((q) => q.x1)) + sp * 0.6);
      const heads = s0.heads || [];
      const firstHead = heads.length ? Math.min(...heads.map((q) => q.x)) : s0.x0 + sp * 5;
      const headEnd = Math.max(s0.x0 + sp * 2.5, firstHead - sp * 1.0);
      const bars = (s0.bars || []).map((b) => b.x).filter((x) => x > headEnd + sp && x < s0.x1 - sp * 1.2).sort((a, b) => a - b);
      lines.push({ y0: top - sp * 4.2, y1: bot + sp * 4.2, top, bot, x0, x1, headEnd, cuts: [headEnd, ...bars, s0.x1], W, H, sp });
    }
    // neighbouring lines share the white space between them
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) lines[i].y0 = Math.max(lines[i].y0, (lines[i - 1].bot + lines[i].top) / 2);
      if (i < lines.length - 1) lines[i].y1 = Math.min(lines[i].y1, (lines[i].bot + lines[i + 1].top) / 2);
    }
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      lines[i] = { y0: Math.max(0, L.y0) / H, y1: Math.min(H, L.y1) / H, x0: L.x0 / W, x1: L.x1 / W, cuts: L.cuts.map((x) => x / W) };
    }
    PK.linesCache.set(key, lines);
    PK.lines = lines;
  } catch (err) { console.error(err); PK.lines = []; }
  $('#pkFinding').hidden = true;
  if (PK.lines && !PK.lines.length) $('#pkHint').textContent = 'Draw a loop around the music you want.';
  $('#pkAll').hidden = !(PK.lines && PK.lines.length);
  drawSel(); drawTray();
}
// remember this page's choice, and whether there is anything to use
function savePick() {
  if (PK.sel.length && PK.trim) PK.picks.set(PK.page, { sel: PK.sel.slice(), trim: { ...PK.trim } }); else PK.picks.delete(PK.page);
  syncDone();
}
function syncDone() {
  $('#pkDone').disabled = !PK.box && !PK.picks.size;
  $('#pkClear').hidden = !PK.box && !PK.picks.size;
}
// the bar of a line under a point (0 = the first bar)
function barIdx(L, fx) { let j = 0; for (let k = 0; k < L.cuts.length - 1; k++) if (fx >= L.cuts[k]) j = k; return j; }
// the nearest line to a height (when the finger slides between lines)
function nearLine(fy) { let best = -1, bd = 1e9; (PK.lines || []).forEach((L, i) => { const d = fy < L.y0 ? L.y0 - fy : fy > L.y1 ? fy - L.y1 : 0; if (d < bd) { bd = d; best = i; } }); return best; }
// from one bar to another, across lines
function selectRange(i1, j1, i2, j2) {
  if (i2 < i1 || (i2 === i1 && j2 < j1)) [i1, j1, i2, j2] = [i2, j2, i1, j1];
  PK.sel = []; for (let i = i1; i <= i2; i++) PK.sel.push(i);
  PK.trim = { a: j1, b: j2 + 1 };
  PK.box = null;
  drawSel(); drawTray();
}
function lineAt(fx, fy) { return (PK.lines || []).findIndex((L) => fy >= L.y0 && fy <= L.y1 && fx >= L.x0 - 0.02 && fx <= L.x1 + 0.02); }
function toggleLine(i) {
  const k = PK.sel.indexOf(i);
  if (k >= 0) PK.sel.splice(k, 1); else PK.sel.push(i);
  PK.sel.sort((a, b) => a - b);
  PK.box = null; PK.trim = null;
  if (PK.sel.length) { const last = PK.lines[PK.sel[PK.sel.length - 1]]; PK.trim = { a: 0, b: last.cuts.length - 1 }; }
  savePick();
  drawSel(); drawTray();
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// The chosen lines get a blue box; its two ends can be pulled in, bar by bar.
const TRAY = {};
function drawTray() {
  const hl = $('#pkHandleL'), hr = $('#pkHandleR');
  const others = [...PK.picks.keys()].filter((p) => p !== PK.page);
  const elsewhere = others.length ? ` Also chosen: ${others.length === 1 ? 'page' : 'pages'} ${others.map((p) => p + 1).join(', ')}.` : '';
  if (!PK.sel.length || !PK.lines) { hl.hidden = hr.hidden = true; $('#pkHint').textContent = (PK.lines && PK.lines.length ? 'Tap a line, or slide from the first bar to the last.' : 'Draw a loop around the music you want.') + elsewhere; return; }
  const first = PK.lines[PK.sel[0]], last = PK.lines[PK.sel[PK.sel.length - 1]];
  const place = (h, L, f) => { h.hidden = false; h.style.left = (f * 100) + '%'; h.style.top = ((L.y0 + 0.004) * 100) + '%'; h.style.height = ((L.y1 - L.y0 - 0.008) * 100) + '%'; };
  place(hl, first, first.cuts[PK.trim.a]);
  place(hr, last, last.cuts[PK.trim.b]);
  const nb = barsChosen();
  $('#pkHint').textContent = `${nb} ${nb === 1 ? 'bar' : 'bars'} on this page — pull the ends to change.` + (elsewhere || (PK.page < PK.doc.pages - 1 ? ' Turn the page to add more.' : ''));
}
function barsChosen() {
  let n = 0;
  PK.sel.forEach((i, k) => { const L = PK.lines[i]; const a = k === 0 ? PK.trim.a : 0, b = k === PK.sel.length - 1 ? PK.trim.b : L.cuts.length - 1; n += Math.max(0, b - a); });
  return n;
}
function wireTray() {
  for (const [id, end] of [['#pkHandleL', 'a'], ['#pkHandleR', 'b']]) {
    const h = $(id);
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); try { h.setPointerCapture(e.pointerId); } catch {}
      const move = (ev) => {
        const L = PK.lines[end === 'a' ? PK.sel[0] : PK.sel[PK.sel.length - 1]];
        const r = $('#pkDraw').getBoundingClientRect();
        const fx = (ev.clientX - r.left) / r.width;
        let best = 0, bd = 1e9;
        L.cuts.forEach((f, j) => { const d = Math.abs(f - fx); if (d < bd) { bd = d; best = j; } });
        const single = PK.sel.length === 1;
        if (end === 'a') PK.trim.a = Math.max(0, Math.min(best, single ? PK.trim.b - 1 : L.cuts.length - 2));
        else PK.trim.b = Math.min(L.cuts.length - 1, Math.max(best, single ? PK.trim.a + 1 : 1));
        savePick(); drawSel(); drawTray();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  }
}
// the chosen lines as one picture: each line with its clef and key, trimmed to the chosen bars
async function linesOut() {
  savePick();
  const pages = [...PK.picks.keys()].sort((x, y) => x - y);
  const parts = [];
  let outScale = 0;
  for (const page of pages) {
    const pick = PK.picks.get(page);
    const key = PK.doc.id + ':' + page + ':' + (PK.source.scoreId || PK.source.file || '');
    const lines = page === PK.page ? PK.lines : PK.linesCache.get(key);
    if (!lines) continue;
    const [pw, ph] = PK.doc.sizes[page];
    const scale = outScale ? outScale * (PK.doc.sizes[pages[0]][0] / pw) : Math.min(4, Math.max(1.6, 2600 / pw));
    if (!outScale) outScale = scale;
    const full = document.createElement('canvas');
    await PK.doc.render(page, full, pw * scale, ph * scale);
    const W = full.width, H = full.height;
    pick.sel.forEach((i, k) => {
      const L = lines[i];
      const a = k === 0 ? pick.trim.a : 0, b = k === pick.sel.length - 1 ? pick.trim.b : L.cuts.length - 1;
      const y0 = Math.floor(L.y0 * H), y1 = Math.ceil(L.y1 * H);
      const pieces = [];
      const pad = 0.004 * W;
      if (a > 0) pieces.push([L.x0 * W, L.cuts[0] * W]);       // keep the clef and key of the line
      const xa = a > 0 ? L.cuts[a] * W + pad * 0.6 : L.x0 * W;   // just past the barline, so the join is not read as one
      const xb = b < L.cuts.length - 1 ? L.cuts[b] * W + pad : L.x1 * W;
      pieces.push([xa, xb]);
      // each piece is copied now, so the page can be let go
      const cv = pieces.map(([x0, x1]) => { const w = Math.max(1, Math.round(x1 - x0)), h = y1 - y0; const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(full, Math.round(x0), y0, w, h, 0, 0, w, h); return c; });
      parts.push({ h: y1 - y0, cv, gap: Math.round(0.01 * H) });
    });
    full.width = full.height = 0;
  }
  const outW = Math.ceil(Math.max(...parts.map((p) => p.cv.reduce((s, c) => s + c.width, 0)))) + 20;
  const outH = parts.reduce((s, p) => s + p.h + p.gap, 0);
  const c = document.createElement('canvas'); c.width = outW; c.height = outH;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, outW, outH);
  let y = 0;
  for (const p of parts) {
    let x = 10;
    for (const piece of p.cv) { g.drawImage(piece, x, y); x += piece.width; piece.width = piece.height = 0; }
    y += p.h + p.gap;
  }
  return c;
}
function drawSel() {
  const d = $('#pkDraw'), g = d.getContext('2d');
  g.clearRect(0, 0, d.width, d.height);
  const W = d.width, H = d.height;
  // the lines: a faint outline on each, the chosen ones tinted
  if (PK.lines && !PK.pts) {
    PK.lines.forEach((L, i) => {
      const k = PK.sel.indexOf(i), on = k >= 0;
      let xa = L.x0, xb = L.x1;
      if (on && PK.trim) {
        if (k === 0 && PK.trim.a > 0) xa = L.cuts[PK.trim.a];
        if (k === PK.sel.length - 1 && PK.trim.b < L.cuts.length - 1) xb = L.cuts[PK.trim.b];
      }
      const y = L.y0 * H, h = (L.y1 - L.y0) * H, r = Math.min(18, h * 0.18);
      g.setLineDash([]);
      if (on) {
        // the bars left out stay visible but pale
        g.fillStyle = 'rgba(255,255,255,0.6)';
        if (xa > L.x0) g.fillRect(L.x0 * W, y, (xa - L.x0) * W, h);
        if (xb < L.x1) g.fillRect(xb * W, y, (L.x1 - xb) * W, h);
        rr(g, xa * W, y + 2, (xb - xa) * W, h - 4, r);
        g.fillStyle = 'rgba(43,111,214,0.12)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(43,111,214,0.9)'; g.stroke();
      } else { rr(g, L.x0 * W, y + 2, (L.x1 - L.x0) * W, h - 4, r); g.lineWidth = 1.5; g.strokeStyle = 'rgba(43,111,214,0.22)'; g.stroke(); }
    });
  }
  g.lineWidth = 2; g.setLineDash([8, 6]); g.strokeStyle = css('--accent-text') || '#1F3A8F'; g.fillStyle = 'rgba(43,111,214,0.10)';
  if (PK.pts && PK.pts.length > 1) {
    g.beginPath(); PK.pts.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.closePath(); g.fill(); g.stroke();
  } else if (PK.box) {
    const b = PK.box;
    g.fillStyle = 'rgba(10,14,30,0.28)';
    g.fillRect(0, 0, W, b.y0 * H); g.fillRect(0, b.y1 * H, W, H - b.y1 * H); g.fillRect(0, b.y0 * H, b.x0 * W, (b.y1 - b.y0) * H); g.fillRect(b.x1 * W, b.y0 * H, W - b.x1 * W, (b.y1 - b.y0) * H);
    g.strokeRect(b.x0 * W, b.y0 * H, (b.x1 - b.x0) * W, (b.y1 - b.y0) * H);
  }
}
async function cropOut() {
  const b = PK.box;
  const [pw, ph] = PK.doc.sizes[PK.page];
  // render the page big enough that the staff lines are about 14-20 px apart
  const scale = Math.min(4, Math.max(1.6, 2600 / pw));
  const full = document.createElement('canvas');
  await PK.doc.render(PK.page, full, pw * scale, ph * scale);
  const x = Math.floor(b.x0 * full.width), y = Math.floor(b.y0 * full.height);
  const w = Math.max(8, Math.ceil((b.x1 - b.x0) * full.width)), h = Math.max(8, Math.ceil((b.y1 - b.y0) * full.height));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(full, x, y, w, h, 0, 0, w, h);
  full.width = full.height = 0;
  return c;
}
(function wire() {
  if (!$('#picker')) return;
  $('#pkCancel').addEventListener('click', () => { if (!$('#pkStage').hidden && PK.opts && PK.opts.canGoBack !== false && !PK.direct) { showLibrary(); return; } finish(null); });
  $('#pkPrev').addEventListener('click', () => { if (PK.page > 0) { PK.page--; showPage(); } });
  $('#pkNext').addEventListener('click', () => { if (PK.page < PK.doc.pages - 1) { PK.page++; showPage(); } });
  $('#pkDone').addEventListener('click', async () => {
    savePick();
    if ((!PK.box && !PK.picks.size) || !PK.doc) return;
    $('#pkDone').disabled = true;
    if (!PK.box && PK.picks.size) { const pages = [...PK.picks.keys()].sort((x, y) => x - y); const canvas = await linesOut(); finish({ canvas, box: null, lines: PK.picks.get(pages[0]).sel.slice(), page: pages[0], pages, source: PK.source }); return; }
    const canvas = await cropOut();
    finish({ canvas, box: { ...PK.box }, page: PK.page, source: PK.source });
  });
  const d = $('#pkDraw');
  let drawing = null;
  const rel = (e) => { const r = d.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  d.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { d.setPointerCapture(e.pointerId); } catch {}
    const [fx, fy] = rel(e);
    drawing = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    // starting on a line of music: slide from bar to bar. Anywhere else: draw a loop.
    const i = PK.lines && PK.lines.length ? lineAt(fx, fy) : -1;
    if (i >= 0) drawing.range = { i, j: barIdx(PK.lines[i], fx) };
    PK.pts = [[fx, fy]];
  });
  d.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    if (!drawing.moved && Math.hypot(e.clientX - drawing.x, e.clientY - drawing.y) < 10) return;
    if (drawing.range) {
      drawing.moved = true; PK.pts = null;
      const [fx, fy] = rel(e); const i = nearLine(fy);
      if (i >= 0) selectRange(drawing.range.i, drawing.range.j, i, barIdx(PK.lines[i], fx));
      return;
    }
    if (!drawing.moved) { drawing.moved = true; PK.box = null; PK.sel = []; PK.trim = null; PK.picks.clear(); syncDone(); drawTray(); }
    const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || []; for (const ev of (list.length ? list : [e])) PK.pts.push(rel(ev)); drawSel();
  });
  const end = (e) => {
    if (!drawing) return;
    const tap = !drawing.moved, range = drawing.range; drawing = null;
    if (range && !tap) { PK.pts = null; savePick(); drawSel(); drawTray(); return; }
    const pts = PK.pts; PK.pts = null;
    if (!pts) { drawSel(); return; }
    if (tap) { const [fx, fy] = pts[0]; const i = lineAt(fx, fy); if (i >= 0) toggleLine(i); else drawSel(); return; }
    if (!pts || pts.length < 2) { drawSel(); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (box.x1 - box.x0 < 0.04 || box.y1 - box.y0 < 0.015) { PK.box = null; drawSel(); return; }
    PK.box = box; syncDone(); drawSel();
  };
  $('#pkAll').addEventListener('click', () => { if (!PK.lines || !PK.lines.length) return; PK.box = null; selectRange(0, 0, PK.lines.length - 1, PK.lines[PK.lines.length - 1].cuts.length - 2); savePick(); drawTray(); });
  $('#pkClear').addEventListener('click', () => { PK.picks.clear(); PK.sel = []; PK.trim = null; PK.box = null; syncDone(); drawSel(); drawTray(); });
  wireTray();
  d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
  d.style.touchAction = 'none';
})();
export const _pk = PK;
export const _tray = TRAY;
