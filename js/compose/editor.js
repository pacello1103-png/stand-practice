// Compose: write music with the Apple Pencil. Hover to see where the note will land (it shows
// faintly before you touch), touch to write, slide up or down to change the pitch, lift to
// place it. A floating palette holds durations, accidentals, articulations, dynamics, text,
// clefs, keys, times and barlines. Instruments, sound, capture, layout and export live in the
// top bar.
import * as M from './model.js';
import { INST, INSTRUMENTS, FAMILIES, ENSEMBLES, STAFF_SIZES, defaultStaffSize } from './instruments.js';
import { layoutScore, drawPage, hitTest, timeAtX, xAtTime, drawGhost, HEAD_W, DYNAMICS, GL, clearMetrics, glyph, text, textWidth, gm, drawClef, drawKey, drawTime, drawBarline, drawRepeatStart, drawLine, TEXT_FONT } from './engrave.js';
import { ScorePlayer, applyScoreSound, renderAudio } from './playback.js';
import { toMusicXML, toMXL, toPartsZip, readMusicFile } from './musicxml.js';
import { sampler, SOUND_LABELS, ROOM_LABELS, DEFAULT_MIX } from '../sampler.js';
import { db, uid, getSetting, setSetting } from '../db.js';
import { loadMusicFont } from '../ink.js';
import { unlock } from '../audio.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let D = {};          // services from the app: toast, showPanel, hidePanel, shareBlob, refreshLibrary, addPdfToLibrary, pickRegion, recognise
const C = {
  id: null, fileId: null, score: null, lay: null, zoom: 1, pages: [], hits: [],
  tool: { dur: 4, dots: 0, rest: false, tup: false, tupN: 3, head: null, acc: null, chord: false },
  mode: 'write', finger: false, sel: new Set(), selBars: null, undo: [], redo: [],
  tab: 'notes', placing: null, hover: null, clip: null, saveT: 0,
};
const player = new ScorePlayer();
export const composeState = C;

// =====================================================================
// Opening, creating and saving
// =====================================================================
export function initCompose(deps) {
  D = deps;
  window.__compose = C; window.__composeRelayout = () => relayout(); window.__composeTest = { applySig: (k, v, st, m, to) => applySig(k, v, st, m, to), readTextBoxes: (r, c) => readTextBoxes(r, c), placeCaptureTexts: (r, a) => placeCaptureTexts(r, a), commitWrite, midiStep, pasteCapture: (st, m) => pasteCapture(st, m), moveSemis, moveNotes, selectBars: (a, b, m0, m1) => selectBars(a, b, m0, m1), transpose, transposeToKey, setDuration, renderTab: () => renderTab(), makePdf: (w) => makePdf(w), tapSelect: (x, y, a) => tapSelect(x, y, a), syncSelBar: () => syncSelBar() };
  // the compose tour starts with the first touch on the editor, not when the panel opens
  const composeEl = document.getElementById('compose');
  // The compose tour starts on the first real tap or stroke. It listens for the click (in the capture
  // phase, so the tap's own action still runs first) rather than the pointerdown, because the tour's
  // overlay would otherwise swallow the very tap that started it.
  if (composeEl) composeEl.addEventListener('click', () => D.workStarted && D.workStarted('compose'), { capture: true, once: true });
  wireTop(); buildTabs(); wirePalette(); wireInput(); wirePanels(); wireKeys();
  getSetting('composeClip', null).then((c) => { if (c) C.clip = c; });
  getSetting('composeUI', null).then((u) => { if (u) { C.zoom = u.zoom || 1; if (u.pal) { C.palAnchor = u.pal.anchor || null; placePalette(u.pal.x, u.pal.y, !u.pal.anchor); } if (u.folded) $('#cpPal').classList.add('folded'); } });
}
export async function openComposition(id) {
  const meta = await db.get('scores', id);
  const file = meta && await db.get('files', meta.fileId);
  if (!file || !file.data) { D.toast('This score could not be opened.'); return; }
  C.id = id; C.fileId = meta.fileId; C.score = M.migrateScore(file.data);
  C.undo = []; C.redo = []; C.sel.clear(); C.selBars = null; C.capDoubt = null; syncUndo();
  meta.opened = Date.now(); db.put('scores', meta);
  await show();
}
async function show() {
  await loadMusicFont(); await document.fonts.load('100px Bravura').catch(() => {}); clearMetrics();
  buildTabs();   // drawn with the music font, so only once it is ready
  D.hidePanel();
  $('#library').hidden = true; $('#score').hidden = true; $('#compose').hidden = false; document.body.classList.remove('at-home');
  $('#cpTitle').textContent = C.score.title || 'Untitled';
  setMode(C.mode);
  relayout(true);
  renderTab();
  keepPaletteInView();
  hint(window.matchMedia('(hover: hover)').matches ? 'Choose a note value, then write with the Pencil or click on the staff.' : 'Choose a note value, then write with the Apple Pencil. Your finger scrolls; turn on finger writing in the palette if you have no Pencil.', 5200);
}
export async function createComposition(opts) {
  const score = M.newScore(opts);
  const fileId = uid(), id = uid();
  await db.put('files', { id: fileId, kind: 'comp', data: score });
  await db.put('scores', { id, fileId, kind: 'comp', title: score.title, composer: score.composer, pages: 1, added: Date.now(), opened: Date.now(), lastPage: 0, seconds: 0, thumb: null });
  await openComposition(id);
  saveSoon(true);
}
async function closeCompose() {
  player.stop(); syncPlay();
  await save(true);
  $('#compose').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home');
  C.score = null; C.lay = null;
  $('#cpPages').textContent = ''; C.pages = [];
  D.refreshLibrary();
}
function saveSoon(thumb) { clearTimeout(C.saveT); C.saveT = setTimeout(() => save(thumb), 900); }
async function save(thumb) {
  clearTimeout(C.saveT);
  if (!C.score || !C.id) return;
  await db.put('files', { id: C.fileId, kind: 'comp', data: C.score });
  const meta = await db.get('scores', C.id);
  if (!meta) return;
  meta.title = C.score.title || 'Untitled'; meta.composer = C.score.composer || ''; meta.pages = C.lay ? C.lay.pages.length : 1;
  if (thumb && C.lay) meta.thumb = await thumbOf();
  await db.put('scores', meta);
}
async function thumbOf() {
  const c = document.createElement('canvas'); const k = 360 / C.lay.W;
  c.width = 360; c.height = Math.round(C.lay.H * k);
  const g = c.getContext('2d'); g.scale(k, k); drawPage(g, C.lay, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.82));
}

// ---------- undo ----------
function edit(fn, opts = {}) {
  // (an edit inside another is part of it: one step to undo)
  if (C.inEdit) return fn();
  const before = JSON.stringify(C.score);
  let r; C.inEdit = true; try { r = fn(); } finally { C.inEdit = false; }
  if (r === false) { if (JSON.stringify(C.score) !== before) { C.score = JSON.parse(before); relayout(); } return; }
  checkDoubt();
  C.undo.push(before); if (C.undo.length > 150) C.undo.shift(); C.redo = [];
  if (!opts.keepSel) pruneSel();
  relayout();
  syncSelBar(); saveSoon(); syncUndo();
  // the palette shows what is now on (except while typing words, which keeps its field)
  if (C.tab !== 'text') renderTab();
  return r;
}
// a captured bar marked to check, once changed, has been checked
function checkDoubt() {
  if (!C.capDoubt) return;
  const st = M.allStaves(C.score).find((x) => x.id === C.capDoubt.stId);
  for (const [mm, snap] of [...C.capDoubt.bars]) if (!st || JSON.stringify(st.bars[mm]) !== snap) C.capDoubt.bars.delete(mm);
  if (!C.capDoubt.bars.size) C.capDoubt = null;
}
function syncUndo() { for (const id of ['#cpPalUndo', '#cpUndo']) { const b = $(id); if (b) b.disabled = !C.undo.length; } for (const id of ['#cpPalRedo', '#cpRedo']) { const b = $(id); if (b) b.disabled = !C.redo.length; } }
function undo() { if (!C.undo.length) return; C.redo.push(JSON.stringify(C.score)); C.score = JSON.parse(C.undo.pop()); checkDoubt(); pruneSel(); relayout(); syncSelBar(); renderTab(); saveSoon(); syncUndo(); }
function redo() { if (!C.redo.length) return; C.undo.push(JSON.stringify(C.score)); C.score = JSON.parse(C.redo.pop()); checkDoubt(); pruneSel(); relayout(); syncSelBar(); renderTab(); saveSoon(); syncUndo(); }
function pruneSel() { for (const id of [...C.sel]) if (!M.findEvent(C.score, id)) C.sel.delete(id); if (C.selBars) { const all = M.allStaves(C.score); const st = all.find((s) => s.id === C.selBars.stId); if (!st) { C.selBars = null; return; } const sts = (C.selBars.stIds || [C.selBars.stId]).map((id) => all.find((s) => s.id === id)).filter(Boolean); C.selBars = { ...C.selBars, st, sts, from: Math.min(C.selBars.from, C.score.measures.length - 1), to: Math.min(C.selBars.to, C.score.measures.length - 1) }; } }

// =====================================================================
// Pages on screen
// =====================================================================
function pxPerSp() {
  const cw = $('#cpScroll').clientWidth;
  // on a wide screen the page sits beside the palette
  const wide = cw >= 1050 && !$('#cpPal').classList.contains('folded');
  $('#compose').classList.toggle('cp-wide', wide);
  $('#compose').classList.toggle('pal-right', !!(C.palAnchor && C.palAnchor.side === 'right'));
  const avail = wide ? Math.min(cw - 380, 1000) : Math.min(cw - 48, 1100);
  return (avail / C.lay.W) * C.zoom;
}
// Pages are drawn only while they are on screen (or close to it), so long scores and big zooms
// stay within the memory iPadOS gives canvases. Pages further away keep only their hit map.
const MAX_PAGE_PX = 12e6;
let scratch = null;
function pageDpr(p) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = parseFloat(p.pg.style.width), h = parseFloat(p.pg.style.height);
  return Math.min(dpr, Math.sqrt(MAX_PAGE_PX / Math.max(1, w * h)));
}
function pageVisible(p) {
  const sc = $('#cpScroll').getBoundingClientRect(), r = p.pg.getBoundingClientRect();
  const m = sc.height * 0.75;
  return r.bottom > sc.top - m && r.top < sc.bottom + m;
}
function paintPage(i) {
  const p = C.pages[i];
  const opts = { selection: C.sel, selBars: C.selBars, selInk: '#2b6fd6', selColor: 'rgba(43,111,214,0.12)', ranges: true, doubt: C.capDoubt };
  if (pageVisible(p)) {
    const w = parseFloat(p.pg.style.width), h = parseFloat(p.pg.style.height), dpr = pageDpr(p);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (p.art.width !== bw || p.art.height !== bh) { p.art.width = bw; p.art.height = bh; }
    const g = p.art.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    g.setTransform(p.k * dpr, 0, 0, p.k * dpr, 0, 0);
    C.hits[i] = drawPage(g, C.lay, i, opts);
    p.painted = true;
  } else {
    if (!scratch) { scratch = document.createElement('canvas'); scratch.width = scratch.height = 1; }
    const g = scratch.getContext('2d'); g.setTransform(0.01, 0, 0, 0.01, 0, 0);
    C.hits[i] = drawPage(g, C.lay, i, opts);
    if (p.art.width > 1) { p.art.width = 1; p.art.height = 1; }
    p.painted = false;
  }
}
function paintVisible() {
  if (!C.score || !C.lay) return;
  C.pages.forEach((p, i) => { const v = pageVisible(p); if (v && !p.painted) paintPage(i); else if (!v && p.painted) { p.art.width = 1; p.art.height = 1; p.painted = false; if (p.over.width > 1) { p.over.width = 1; p.over.height = 1; } } });
}
let paintRaf = 0;
function paintSoon() { if (paintRaf) return; paintRaf = requestAnimationFrame(() => { paintRaf = 0; paintVisible(); }); }
function relayout(scrollTop) {
  if (!C.score) return;
  C.lay = layoutScore(C.score);
  const box = $('#cpPages');
  const k = pxPerSp();
  while (C.pages.length < C.lay.pages.length) {
    const pg = el('div', 'cp-page'); const art = el('canvas', 'cp-art'); const over = el('canvas', 'cp-over');
    art.width = art.height = 1; over.width = over.height = 1;
    const no = el('span', 'cp-pageno num');
    pg.append(art, over, no); box.append(pg);
    C.pages.push({ pg, art, over, no });
  }
  while (C.pages.length > C.lay.pages.length) { const p = C.pages.pop(); p.art.width = p.art.height = 0; p.over.width = p.over.height = 0; p.pg.remove(); }
  C.hits = [];
  C.pages.forEach((p, i) => {
    const w = Math.round(C.lay.W * k), h = Math.round(C.lay.H * k);
    p.pg.style.width = w + 'px'; p.pg.style.height = h + 'px';
    p.no.textContent = i + 1;
    p.k = k;
  });
  if (scrollTop) $('#cpScroll').scrollTop = 0;
  C.pages.forEach((p, i) => { paintPage(i); clearOver(p); });
  $('#cpZoomVal').textContent = Math.round(C.zoom * 100) + '%';
  $('#cpInfo').textContent = `${C.score.measures.length} bars · ${C.lay.pages.length} ${C.lay.pages.length === 1 ? 'page' : 'pages'}`;
  drawHover();
}
function clearOver(p) { if (p.over.width <= 1) return; const g = p.over.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, p.over.width, p.over.height); }
function overCtx(i) {
  // one page at a time carries a full size overlay (the ghost note, the play line)
  C.pages.forEach((q, j) => { if (j !== i && q.over.width > 1) { q.over.width = 1; q.over.height = 1; } });
  const p = C.pages[i];
  const w = parseFloat(p.pg.style.width), h = parseFloat(p.pg.style.height), dpr = pageDpr(p);
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (p.over.width !== bw || p.over.height !== bh) { p.over.width = bw; p.over.height = bh; }
  if (!p.painted) paintPage(i);
  const g = p.over.getContext('2d'); g.setTransform(p.k * dpr, 0, 0, p.k * dpr, 0, 0); return g;
}
function setZoom(z, keepPoint) {
  const sc = $('#cpScroll');
  const old = C.zoom; C.zoom = clamp(z, 0.4, 3);
  const fx = keepPoint ? keepPoint.x : sc.clientWidth / 2, fy = keepPoint ? keepPoint.y : sc.clientHeight / 2;
  const cx = sc.scrollLeft + fx, cy = sc.scrollTop + fy;
  relayout();
  const f = C.zoom / old;
  sc.scrollLeft = cx * f - fx; sc.scrollTop = cy * f - fy;
  setSetting('composeUI', { ...(uiState()), zoom: C.zoom });
}
function uiState() { const p = $('#cpPal'); return { zoom: C.zoom, pal: { x: p.offsetLeft, y: p.offsetTop, anchor: C.palAnchor || null }, folded: p.classList.contains('folded') }; }
let resizeT;
const onTurn = () => { if ($('#compose').hidden) return; keepPaletteInView(); clearTimeout(resizeT); resizeT = setTimeout(() => { keepPaletteInView(); if (C.score) relayout(); }, 150); };
window.addEventListener('resize', onTurn);
window.addEventListener('orientationchange', () => setTimeout(onTurn, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onTurn);

// =====================================================================
// Pointer: hover ghost, writing, sliding the pitch, selecting
// =====================================================================
function pageAt(clientX, clientY) {
  for (let i = 0; i < C.pages.length; i++) {
    const r = C.pages[i].pg.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return { i, r, x: (clientX - r.left) / C.pages[i].k, y: (clientY - r.top) / C.pages[i].k };
  }
  return null;
}
// tuplets: n notes in the time of m ("3:2" triplet, "5:4" quintuplet, "2:3" duplet in 6/8 ...)
const TUP_OF = { 2: 3, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 8: 6, 9: 8, 10: 8, 11: 8 };
const tupN = () => (C.tool.tup === true ? 3 : +C.tool.tup || 0);
const tupObj = (base) => { const n = tupN(); return n ? { n, m: TUP_OF[n] || 2, base } : null; };
const DUR_TICKS = () => { let d = M.baseTicks(C.tool.dur) * (2 - Math.pow(0.5, C.tool.dots)); const tp = tupObj(C.tool.dur); if (tp) d = (d * tp.m) / tp.n; return Math.round(d); };
function targetAt(clientX, clientY) {
  const pa = pageAt(clientX, clientY); if (!pa || !C.hits[pa.i]) return null;
  const h = hitTest(C.hits[pa.i], pa.x, pa.y); if (!h || !h.meas.onsets) return null;
  const time = M.timeAt(C.score, h.meas.m);
  const beat = M.WHOLE / time[1];
  // a tuplet can start on any place of its plain note value (not only on the beat)
  const grid = tupN() ? M.baseTicks(C.tool.dur) : Math.min(DUR_TICKS(), beat * (time[1] === 8 ? 3 : 1));
  const t = timeAtX(h.meas, pa.x, grid);
  return { page: pa.i, staff: h.staff, meas: h.meas, t, p: clamp(h.p, -16, 26), x: pa.x, y: pa.y };
}
function noteFromTarget(tg) {
  const st = tg.staff.st, inst = tg.staff.inst, m = tg.meas.m;
  const clef = M.clefAtPos(C.score, st, m, tg.t || 0);
  if (inst.unpitched) return { s: M.CLEFS[clef].bottom + tg.p, a: 0, perc: inst.unpitched };
  const step = M.CLEFS[clef].bottom + tg.p;
  const concert = C.score.layout.concert !== false;
  const key = concert ? M.keyAt(C.score, m) : M.writtenKey(M.keyAt(C.score, m), inst);
  const a = C.tool.acc !== null ? C.tool.acc : M.keyAlter(key, step);
  const n = { s: step, a };
  return concert ? n : M.toConcert(n, inst);
}
function midiOfNote(n, inst) { return inst.unpitched ? (n.perc || inst.unpitched) : M.midiOf(n.s, n.a); }
function soundOf(part) { return part.sound || (INST[part.inst] || INST.piano).sound; }
let lastPreview = 0;
function preview(tg) {
  const n = noteFromTarget(tg); const part = tg.staff.part;
  const midi = midiOfNote(n, tg.staff.inst);
  if (midi === C.lastPreviewMidi && performance.now() - lastPreview < 400) return;
  C.lastPreviewMidi = midi; lastPreview = performance.now();
  unlock();
  sampler.preview(soundOf(part), midi, 0.62, Math.min(0.9, (DUR_TICKS() / 480) * 0.45), part.mix || undefined);
}
function drawHover() {
  C.pages.forEach(clearOver);
  // the selected marking: a soft blue box around it
  if (C.markSel && C.score) {
    C.hits.forEach((hit, i) => {
      const list = C.markSel.kind === 'span' ? ((hit && hit.spans) || []).filter((h) => h.id === C.markSel.id) : ((hit && hit.marks) || []).filter((h) => h.id === C.markSel.id && h.name === C.markSel.name);
      for (const h of list) {
        const g = overCtx(i); g.save(); g.fillStyle = 'rgba(43,111,214,0.18)'; g.strokeStyle = 'rgba(43,111,214,0.9)'; g.lineWidth = 0.15;
        g.beginPath(); g.roundRect ? g.roundRect(h.x0 - 0.4, h.y0 - 0.4, h.x1 - h.x0 + 0.8, h.y1 - h.y0 + 0.8, 0.5) : g.rect(h.x0 - 0.4, h.y0 - 0.4, h.x1 - h.x0 + 0.8, h.y1 - h.y0 + 0.8); g.fill(); g.stroke(); g.restore();
      }
    });
  }
  const tg = C.placing ? C.placing.tg : C.hover;
  if (!tg || C.mode !== 'write' || !C.score) return;
  const g = overCtx(tg.page);
  const x = xAtTime(tg.meas, tg.t);
  const color = C.placing ? css('--accent') : 'rgba(43,111,214,0.42)';
  if (C.tool.rest) {
    g.save(); g.fillStyle = color; glyph(g, GL.rest[C.tool.dur], x, tg.staff.y + 2); g.restore();
  } else {
    const n = noteFromTarget(tg);
    const concert = C.score.layout.concert !== false;
    const shown = concert ? n : M.toWritten(n, tg.staff.inst);
    const key = concert ? M.keyAt(C.score, tg.meas.m) : M.writtenKey(M.keyAt(C.score, tg.meas.m), tg.staff.inst);
    const acc = shown.a !== M.keyAlter(key, shown.s) || C.tool.acc !== null ? shown.a : null;
    drawGhost(g, x, tg.staff.y, tg.p, C.tool.dur, acc, color);
    if (C.placing) {
      // the name of the note, so a slide up or down is easy to follow
      g.save(); g.fillStyle = color;
      text(g, M.noteName(n.s, n.a), x + HEAD_W + 1, tg.staff.y + 4 - tg.p / 2 - 1.4, 1.7, '-apple-system, sans-serif', '600'); g.restore();
    }
  }
  // the bar being written into
  g.save(); g.fillStyle = 'rgba(43,111,214,0.06)'; g.fillRect(tg.meas.x0, tg.staff.y - 1, tg.meas.x1 - tg.meas.x0, 6); g.restore();
}
function canWrite(e) { return C.mode === 'write' && (e.pointerType === 'pen' || e.pointerType === 'mouse' || C.finger); }

function wireInput() {
  const box = $('#cpPages');
  $('#cpScroll').addEventListener('scroll', paintSoon, { passive: true });
  box.addEventListener('pointermove', (e) => {
    if (C.placing && C.placing.id === e.pointerId) { movePlacing(e); return; }
    if (C.drag && C.drag.id === e.pointerId) { moveDrag(e); return; }
    if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && e.buttons === 0 && C.mode === 'write') {
      C.hover = targetAt(e.clientX, e.clientY);
      drawHover();
    }
  });
  box.addEventListener('pointerleave', () => { if (!C.placing) { C.hover = null; drawHover(); } });
  box.addEventListener('touchmove', (e) => { if (C.lpDrag) e.preventDefault(); }, { passive: false });
  box.addEventListener('pointerdown', (e) => {
    if (!C.score) return;
    if (e.pointerType === 'touch' && !C.finger && C.mode !== 'select') { touchDown(e); return; }
    // in Select mode a finger scrolls and taps; held still for a moment, it selects by dragging
    if (e.pointerType === 'touch' && C.mode === 'select') { selectTouchDown(e); return; }
    if (canWrite(e)) {
      // the pen right on a marking (an accent, a trill, a dynamic): it is selected, not written over
      const pm = pageAt(e.clientX, e.clientY); let mk = pm && markAt(pm, 0);
      if (mk && ['tie', 'barline', 'repstart', 'lyric'].includes(mk.kind)) mk = null;
      if (mk) { e.preventDefault(); C.sel.clear(); C.selBars = null; C.markSel = mk; relayout(); syncSelBar(); drawHover(); return; }
      const tg = targetAt(e.clientX, e.clientY); if (!tg) return;
      e.preventDefault();
      try { box.setPointerCapture(e.pointerId); } catch {}
      C.placing = { id: e.pointerId, tg, y0: e.clientY, p0: tg.p, x0: e.clientX };
      if (!C.tool.rest) preview(tg);
      drawHover();
      return;
    }
    // select mode: tap a note, or drag across bars
    const pa = pageAt(e.clientX, e.clientY); if (!pa) return;
    e.preventDefault();
    try { box.setPointerCapture(e.pointerId); } catch {}
    const sn = noteAt(pa);
    // a slur or a hairpin (away from the notes): drag it up or down
    const sp = !sn && spanAtPoint(pa);
    if (sp) {
      // grabbed near an end: that end moves (any way); in the middle: a slur gets taller or flatter,
      // a hairpin moves up or down
      const hb = C.spanHit, w = Math.max(0.1, hb.x1 - hb.x0), f = (pa.x - hb.x0) / w;
      const zone = !['slur', 'hairpin'].includes(sp.kind) ? 'none' : w > 3 && f < 0.22 ? 'a' : w > 3 && f > 0.78 ? 'b' : 'mid';
      C.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, span: sp, zone, orig: { off: sp.off, ax: sp.ax, ay: sp.ay, bx: sp.bx, by: sp.by, hd: sp.hd }, k: C.pages[pa.i].k };
      return;
    }
    C.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, start: hitBar(pa), moved: false, note: sn && !sn.rest ? sn : null };
  });
  const up = (e) => {
    if (C.placing && C.placing.id === e.pointerId) { const pl = C.placing; C.placing = null; if (e.type !== 'pointercancel') commitWrite(pl.tg); drawHover(); return; }
    if (C.drag && C.drag.id === e.pointerId) { endDrag(e); }
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  // pinch to zoom with two fingers
  const sc = $('#cpScroll');
  const touches = new Map(); let pinch = null;
  sc.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches; const r = sc.getBoundingClientRect();
      pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: C.zoom, cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, s: 1, dx: 0, dy: 0, r };
      $('#cpPages').style.willChange = 'transform';
      e.preventDefault();
    }
  }, { passive: false });
  sc.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      const [a, b] = e.touches;
      // the page follows both fingers: it grows around them and moves with them, like a photo
      pinch.s = clamp(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d0, 0.4 / pinch.z0, 3 / pinch.z0);
      pinch.dx = (a.clientX + b.clientX) / 2 - pinch.r.left - pinch.cx; pinch.dy = (a.clientY + b.clientY) / 2 - pinch.r.top - pinch.cy;
      $('#cpPages').style.transformOrigin = `${sc.scrollLeft + pinch.cx}px ${sc.scrollTop + pinch.cy}px`;
      $('#cpPages').style.transform = `translate(${pinch.dx}px, ${pinch.dy}px) scale(${pinch.s})`;
      e.preventDefault();
    } else if (C.finger && C.mode === 'write' && e.touches.length === 1) e.preventDefault();
  }, { passive: false });
  sc.addEventListener('touchend', () => {
    if (pinch) {
      const p = pinch; pinch = null; $('#cpPages').style.transform = ''; $('#cpPages').style.willChange = '';
      if (Math.abs(p.s - 1) > 0.03) setZoom(p.z0 * p.s, { x: p.cx, y: p.cy });
      sc.scrollLeft -= p.dx; sc.scrollTop -= p.dy;
    }
  });
  // a trackpad pinch (or ctrl + wheel) zooms around the pointer
  let wheelT = 0, wz = null;
  sc.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = sc.getBoundingClientRect();
    if (!wz) wz = { z: C.zoom, x: e.clientX - r.left, y: e.clientY - r.top };
    wz.z = clamp(wz.z * Math.exp(-e.deltaY * 0.01), 0.4, 3);
    clearTimeout(wheelT); wheelT = setTimeout(() => { const w = wz; wz = null; setZoom(w.z, { x: w.x, y: w.y }); }, 90);
  }, { passive: false });
  void touches;
}
// A finger tap selects a note (or a bar) in either mode; finger drags scroll the page.
function selectTouchDown(e) {
  const t0 = performance.now(), x0 = e.clientX, y0 = e.clientY, id = e.pointerId;
  let started = false;
  const timer = setTimeout(() => {
    const pa = pageAt(x0, y0); if (!pa) return;
    started = true; C.lpDrag = true;
    const sn = noteAt(pa);
    try { $('#cpPages').setPointerCapture(id); } catch {}
    C.drag = { id, x0, y0, start: hitBar(pa), moved: true, note: sn && !sn.rest ? sn : null };
    // the bar (or note) under the finger is chosen at once, so you see where the drag starts
    if (C.drag.note) { C.sel.clear(); C.selBars = null; C.sel.add(C.drag.note.id); }
    else if (C.drag.start) selectBars(C.drag.start.staff.st, C.drag.start.staff.st, C.drag.start.m, C.drag.start.m);
    relayout(); syncSelBar();
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  }, 380);
  const move = (ev) => { if (ev.pointerId !== id || started) return; if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) { clearTimeout(timer); off(); } };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    clearTimeout(timer); off();
    if (started) { C.lpDrag = false; return; }
    if (ev.type === 'pointerup' && performance.now() - t0 < 450 && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 10) tapSelect(ev.clientX, ev.clientY, false);
  };
  const off = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function touchDown(e) {
  const t0 = performance.now(), x0 = e.clientX, y0 = e.clientY;
  const upOnce = (ev) => {
    window.removeEventListener('pointerup', upOnce);
    if (ev.pointerId !== e.pointerId) return;
    if (performance.now() - t0 > 450 || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) return;
    tapSelect(ev.clientX, ev.clientY, false);
  };
  window.addEventListener('pointerup', upOnce);
}
function movePlacing(e) {
  const pl = C.placing;
  const k = C.pages[pl.tg.page].k;
  // slide up or down to change the pitch (half a space per step); sideways keeps the time
  const dp = Math.round(-(e.clientY - pl.y0) / (k * 0.5));
  const p = clamp(pl.p0 + dp, -18, 28);
  let tg = pl.tg;
  if (Math.abs(e.clientX - pl.x0) > k * 2.2) { const t2 = targetAt(e.clientX, pl.y0 + (e.clientY - pl.y0) * 0); if (t2 && t2.staff === tg.staff) tg = { ...t2, p }; }
  if (p !== tg.p || tg !== pl.tg) { pl.tg = { ...tg, p }; if (!C.tool.rest) preview(pl.tg); drawHover(); }
}
function hitBar(pa) {
  const h = hitTest(C.hits[pa.i], pa.x, pa.y); if (!h) return null;
  return { page: pa.i, staff: h.staff, m: h.meas.m, x: pa.x, y: pa.y, meas: h.meas };
}
// the slur or hairpin under a point of a page
function spanAtPoint(pa) {
  const hit = C.hits[pa.i]; if (!hit || !hit.spans) return null;
  let best = null, bd = 1e9;
  for (const h of hit.spans) {
    if (pa.x < h.x0 - 0.3 || pa.x > h.x1 + 0.3 || pa.y < h.y0 - 0.3 || pa.y > h.y1 + 0.3) continue;
    const d = Math.abs(pa.y - (h.y0 + h.y1) / 2);
    if (d < bd) { bd = d; best = h; }
  }
  const sp = best ? (C.score.spans || []).find((q) => q.id === best.id) || null : null;
  if (sp) C.spanHit = best;
  return sp;
}
function moveDrag(e) {
  const d = C.drag;
  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) d.moved = true;
  if (d.span) {
    if (!d.moved || d.zone === 'none') return;
    // follows the pen, in steps of a quarter space, and never further than 8 spaces
    const q4 = (v) => clamp(Math.round(v * 4) / 4, -8, 8), o = d.orig, dx = (e.clientX - d.x0) / d.k, dy = (e.clientY - d.y0) / d.k;
    const sp = d.span;
    if (d.zone === 'a') { sp.ax = q4((o.ax || 0) + dx); if (sp.kind === 'slur') sp.ay = q4((o.ay || 0) + dy); }
    else if (d.zone === 'b') { sp.bx = q4((o.bx || 0) + dx); if (sp.kind === 'slur') sp.by = q4((o.by || 0) + dy); }
    else if (sp.kind === 'slur') { const above = (C.spanHit && C.spanHit.above) !== false; sp.hd = clamp(Math.round(((o.hd || 0) + (above ? -dy : dy)) * 4) / 4, -1.5, 6); }
    else sp.off = q4((o.off || 0) + dy);
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; relayout(); });
    return;
  }
  if (d.moved && d.note) {
    const pa = pageAt(e.clientX, e.clientY); if (!pa) return;
    const n2 = noteAt(pa);
    if (n2 && n2.id !== d.last && selectNoteRange(d.note.id, n2.id)) { d.last = n2.id; relayout(); syncSelBar(); }
    return;
  }
  if (d.moved && d.start) {
    const pa = pageAt(e.clientX, e.clientY); if (!pa) return;
    const b = hitBar(pa); if (!b) return;
    selectBars(d.start.staff.st, b.staff.st, d.start.m, b.m);
    relayout(); syncSelBar();
  }
}
function endDrag(e) {
  const d = C.drag; C.drag = null;
  if (d.span) {
    if (d.raf) cancelAnimationFrame(d.raf);
    if (!d.moved || d.zone === 'none') { C.sel.clear(); C.selBars = null; C.markSel = { id: d.span.id, kind: 'span', name: d.span.kind }; relayout(); syncSelBar(); drawHover(); return; }
    const keys = ['off', 'ax', 'ay', 'bx', 'by', 'hd'];
    const fin = {}; for (const k of keys) { fin[k] = d.span[k]; if (d.orig[k] === undefined) delete d.span[k]; else d.span[k] = d.orig[k]; }
    edit(() => { const q = (C.score.spans || []).find((x) => x.id === d.span.id); if (q) for (const k of keys) { if (fin[k]) q[k] = fin[k]; else delete q[k]; } }, { keepSel: true });
    hint(d.zone === 'mid' ? (d.span.kind === 'slur' ? 'Taller or flatter. Drag an end to move it; undo to put it back.' : 'Moved. Drag an end to make it longer or shorter.') : 'End moved. Drag the middle to change the curve; undo to put it back.', 2200);
    return;
  }
  if (!d.moved) tapSelect(e.clientX, e.clientY, e.shiftKey);
  else if (d.note) renderTab();
}
// the nearest note head or rest under a point of a page
function noteAt(pa) {
  const hit = C.hits[pa.i]; if (!hit) return null;
  let best = null, bd = 1e9;
  for (const ev of hit.events) {
    const dx = pa.x - (ev.x + HEAD_W / 2);
    if (Math.abs(dx) > 1.6) continue;
    let dy;
    if (ev.rest || !ev.notes.length) dy = Math.abs(pa.y - (ev.y + 2)) * 0.6;
    else dy = Math.min(...ev.notes.map((n) => Math.abs(pa.y - n.y)));
    if (dy > 2.4) continue;
    const dd = Math.abs(dx) + dy;
    if (dd < bd) { bd = dd; best = ev; }
  }
  return best;
}
// Select every note from one to another on the same staff (and voice): for slurs, hairpins,
// copying a phrase, changing many notes at once.
function selectNoteRange(idA, idB) {
  const fa = M.findEvent(C.score, idA), fb = M.findEvent(C.score, idB);
  if (!fa || !fb) return false;
  if ((fa.st.base || fa.st) !== (fb.st.base || fb.st) || (fa.voice || 1) !== (fb.voice || 1)) return false;
  let [x, y] = fa.m < fb.m || (fa.m === fb.m && fa.pos <= fb.pos) ? [fa, fb] : [fb, fa];
  C.sel.clear(); C.selBars = null;
  let cur = { m: x.m, i: x.i, ev: x.ev }; let guard = 0;
  while (cur && guard++ < 4000) {
    C.sel.add(cur.ev.id);
    if (cur.ev.id === y.ev.id) break;
    cur = M.nextEvent(C.score, x.st, cur.m, cur.i);
  }
  return true;
}
function markAt(pa, pad = 0.35) {
  const hit = C.hits[pa.i]; if (!hit || !hit.marks) return null;
  let best = null, bd = 1e9;
  for (const h of hit.marks) {
    if (pa.x < h.x0 - pad || pa.x > h.x1 + pad || pa.y < h.y0 - pad || pa.y > h.y1 + pad) continue;
    const d = Math.hypot(pa.x - (h.x0 + h.x1) / 2, pa.y - (h.y0 + h.y1) / 2);
    if (d < bd) { bd = d; best = h; }
  }
  if (!best) return null;
  const { x0, x1, y0, y1, ...o } = best;
  return { ...o, page: pa.i };
}
function tapSelect(cx, cy, add) {
  const pa = pageAt(cx, cy); if (!pa) { clearSel(); return; }
  // a marking tapped on its own (staccato, accent, trill, fermata, a dynamic, words): it is selected
  let mk = !C.extend && markAt(pa);
  // (a tie or a word under a note head: the note comes first)
  if (mk && (mk.kind === 'tie' || mk.kind === 'barline') && noteAt(pa)) mk = null;
  // a slur, hairpin or any line over notes (8va, pedal, trill, endings…): chosen with a tap too
  if (!mk && !C.extend && !noteAt(pa)) { const sp = spanAtPoint(pa); if (sp) mk = { id: sp.id, kind: 'span', name: sp.kind, page: pa.i }; }
  if (mk) {
    const same = C.markSel && C.markSel.id === mk.id && C.markSel.name === mk.name;
    C.sel.clear(); C.selBars = null; C.markSel = same ? null : mk;
    relayout(); syncSelBar(); drawHover();
    return;
  }
  C.markSel = null;
  let best = noteAt(pa);
  if (best && C.extend && C.selBars) best = null;
  // "Select more" with notes: the tap selects everything from the first selected note to here
  if (best && C.extend && C.sel.size && !C.selBars) {
    const first = selEvents()[0];
    if (first && selectNoteRange(first.ev.id, best.id)) { relayout(); syncSelBar(); renderTab(); return; }
  }
  // a bar rest stands for the whole bar: select the bar
  if (best) { const f = M.findEvent(C.score, best.id); if (f && f.ev.rest && (f.ev.full || f.st.bars[f.m].length === 1)) best = null; }
  if (best) {
    // the one selected note tapped again: nothing is selected any more
    if (!add && !C.extend && !C.selBars && C.sel.size === 1 && C.sel.has(best.id)) { clearSel(); return; }
    if (!add) { C.sel.clear(); C.selBars = null; }
    if (C.sel.has(best.id) && add) C.sel.delete(best.id); else C.sel.add(best.id);
    const f = M.findEvent(C.score, best.id);
    if (f && f.ev.notes && !f.ev.rest) { unlock(); for (const n of f.ev.notes) sampler.preview(soundOf(f.part), midiOfNote(n, f.inst), 0.55, 0.5, f.part.mix || undefined); }
    relayout(); syncSelBar(); renderTab();
    return;
  }
  const b = hitBar(pa);
  if (b && pa.x > b.meas.x0 && pa.x < b.meas.x1) {
    // tapping a bar that is already blue takes it out again (from either end of the selection)
    const sb = C.selBars;
    if (sb && selStaves().includes(b.staff.st) && b.m >= sb.from && b.m <= sb.to && (b.m === sb.from || b.m === sb.to)) {
      if (sb.from === sb.to) { clearSel(); return; }
      C.selBars = { ...sb, from: b.m === sb.from ? sb.from + 1 : sb.from, to: b.m === sb.to ? sb.to - 1 : sb.to };
      relayout(); syncSelBar(); renderTab();
      return;
    }
    if ((add || C.extend) && C.selBars) {
      const sts = selStaves(); const all = M.allStaves(C.score);
      const idx = [...sts, b.staff.st].map((x) => all.indexOf(x));
      selectBars(all[Math.min(...idx)], all[Math.max(...idx)], Math.min(C.selBars.from, b.m), Math.max(C.selBars.to, b.m));
    } else { C.extend = false; selectBars(b.staff.st, b.staff.st, b.m, b.m); }
    relayout(); syncSelBar(); renderTab();
    return;
  }
  clearSel();
}
function clearSel() { C.extend = false; if (C.markSel) { C.markSel = null; syncSelBar(); drawHover(); } if (!C.sel.size && !C.selBars) return; C.sel.clear(); C.selBars = null; relayout(); syncSelBar(); renderTab(); }

const KEEP_MARKS = ['art', 'dyn', 'txt', 'txtStyle', 'fing', 'lyric', 'chord', 'stem'];
// Write the note (or rest) the pen just placed.
function commitWrite(tg) {
  const st = M.voiceView(tg.staff.st, C.tool.voice || 1, C.score), m = tg.meas.m, pos = tg.t;
  const time = M.timeAt(C.score, m);
  let newId = null;
  edit(() => {
    const bar = st.bars[m];
    const starts = M.eventStarts(bar, time);
    let idx = starts.indexOf(pos);
    // inside a tuplet the places fall between ticks: take the tuplet note nearest to the pen
    if (idx < 0 && tupN()) { let best = -1, bd = 1e9; starts.forEach((s0, k) => { const dd = Math.abs(s0 - pos); if (bar[k].tup && dd < bd && dd <= M.evTicks(bar[k]) / 2) { bd = dd; best = k; } }); idx = best; }
    const at = idx >= 0 ? bar[idx] : null;
    if (C.tool.rest) {
      const ev = { id: M.newId(), rest: true, keep: true, t: C.tool.dur, dots: C.tool.dots };
      if (at) for (const k of ['dyn', 'txt', 'txtStyle', 'fing', 'chord']) if (at[k]) ev[k] = M.clone(at[k]);
      if (tupN()) ev.tup = { ...tupObj(C.tool.dur), ...(at && at.tup && at.tup.i !== undefined ? { i: at.tup.i } : {}) };
      if (at && at.tup && tupN() && M.evTicks(at) === M.evTicks(ev)) bar[idx] = ev; else M.writeEvent(C.score, st, m, pos, ev);
      newId = ev.id; return;
    }
    const n = noteFromTarget(tg);
    // add to a chord: with Chord on (without it, writing on top of a note changes the note)
    if (at && at.notes && !at.rest && C.tool.chord) {
      if (!at.notes.some((q) => q.s === n.s)) { at.notes.push(n); at.notes.sort((a, b) => a.s - b.s); }
      newId = at.id; return;
    }
    const ev = { id: M.newId(), t: C.tool.dur, dots: C.tool.dots, notes: [n] };
    if (C.tool.head) ev.head = C.tool.head;
    // writing over a note keeps what was written on it: lyrics, chord symbols, dynamics,
    // articulations and words stay when the note (or rest) changes
    if (at && at !== ev) for (const k of KEEP_MARKS) if (at[k] !== undefined && at[k] !== null && !(Array.isArray(at[k]) && !at[k].length)) { if (k === 'art' && at.rest) continue; ev[k] = M.clone(at[k]); }
    if (tupN()) {
      const tp = tupObj(C.tool.dur);
      ev.tup = tp;
      if (at && at.tup && at.tup.n === tp.n && (at.tup.base || at.t) === C.tool.dur) { ev.tup = { ...tp, i: at.tup.i }; bar[idx] = { ...ev }; newId = ev.id; return; }
      // a new group: this note and tuplet rests fill the time of m notes
      const span = Math.round((M.baseTicks(C.tool.dur) * (2 - Math.pow(0.5, C.tool.dots || 0))) * tp.m);
      const slot = span / tp.n;
      const btot = M.barTicks(time);
      if (span > btot) { hint('This tuplet is longer than the bar. Choose a shorter note value.'); return false; }
      // the group starts where the note is written (on any place of the plain note value)
      const unit = M.baseTicks(C.tool.dur);
      let gpos = Math.round(pos / unit) * unit; if (gpos + span > btot) gpos = Math.floor((btot - span) / unit) * unit;
      if (gpos < 0) gpos = 0;
      // it may not cut through another tuplet
      { let p1 = 0; for (const e of bar) { const l = M.ticksOf(e, time); if (e.tup && p1 < gpos + span && p1 + l > gpos && (p1 < gpos || p1 + l > gpos + span)) { hint('This would cut through another tuplet. Write it after that one, or delete it first.', 3200); return false; } p1 += l; } }
      const offset = Math.max(0, Math.min(tp.n - 1, Math.round((pos - gpos) / slot)));
      ev.tup = { ...tp, i: offset };
      const group = Array.from({ length: tp.n }, (_, i) => (i === offset ? ev : { id: M.newId(), rest: true, keep: true, t: C.tool.dur, dots: C.tool.dots || 0, tup: { ...tp, i } }));
      // clear the span first (as plain rests), then put the slots in their place
      let p0 = gpos;
      for (const pc of M.decompose(gpos, span, time, true)) { M.writeEvent(C.score, st, m, p0, { id: M.newId(), rest: true, keep: true, t: pc.t, dots: pc.dots }); p0 += pc.ticks; }
      const b2 = st.bars[m]; const s2 = M.eventStarts(b2, time); const i2 = s2.indexOf(gpos);
      if (i2 < 0) { newId = null; return false; }
      let k = i2, acc = 0; while (k < b2.length && acc < span) { acc += M.ticksOf(b2[k], time); k++; }
      if (acc !== span) { newId = null; return false; }
      b2.splice(i2, k - i2, ...group);
      newId = ev.id; return;
    }
    M.writeEvent(C.score, st, m, pos, ev);
    newId = ev.id;
  });
  C.sel.clear(); if (newId) C.sel.add(newId); C.selBars = null;
  if (C.tool.acc !== null && !C.tool.accSticky) { C.tool.acc = null; renderTab(); }
  relayout(); syncSelBar();
  // a gentle word when the note is out of the instrument's range (it shows in red)
  const inst = tg.staff.inst;
  if (!C.tool.rest && inst && inst.range && !inst.unpitched) {
    const f = M.findEvent(C.score, newId);
    const md = f && f.ev.notes ? Math.min(...f.ev.notes.map((q) => M.midiOf(q.s, q.a))) : null, mx = f && f.ev.notes ? Math.max(...f.ev.notes.map((q) => M.midiOf(q.s, q.a))) : null;
    const name = (x) => ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][x % 12] + (Math.floor(x / 12) - 1);
    if (md !== null && md < inst.range[0]) hint(`Too low for the ${inst.name.toLowerCase()}: its lowest note is ${name(inst.range[0])}.`, 3200);
    else if (mx !== null && mx > inst.range[1]) hint(`Too high for the ${inst.name.toLowerCase()}: its range goes up to ${name(inst.range[1])}.`, 3200);
  }
}

// =====================================================================
// Selection helpers and actions
// =====================================================================
function selEvents() { return [...C.sel].map((id) => M.findEvent(C.score, id)).filter(Boolean).sort((a, b) => a.m - b.m || a.pos - b.pos); }
// the staves a bar selection covers, top to bottom
function selStaves() { if (!C.selBars) return []; return C.selBars.sts && C.selBars.sts.length ? C.selBars.sts : [C.selBars.st]; }
function staveRange(a, b) { const all = M.allStaves(C.score); let i = all.indexOf(a), j = all.indexOf(b); if (i < 0 || j < 0) return [a]; if (i > j) [i, j] = [j, i]; return all.slice(i, j + 1); }
function selectBars(stA, stB, m0, m1) {
  const sts = staveRange(stA, stB);
  C.sel.clear();
  C.selBars = { st: sts[0], stId: sts[0].id, sts, stIds: sts.map((x) => x.id), from: Math.min(m0, m1), to: Math.max(m0, m1) };
}
function targetBar() {
  if (C.selBars) return C.selBars.from;
  const s = selEvents(); if (s.length) return s[0].m;
  return null;
}
// the notes of the selection: the selected notes, or everything in the selected bars (both voices)
function selNoteEvents() {
  if (C.selBars) {
    const out = [];
    for (const st0 of selStaves()) {
      const info = M.staffInfo(C.score).find((x) => x.st === st0 || x.st.id === (st0.id || st0)); if (!info) continue;
      for (let m = C.selBars.from; m <= C.selBars.to; m++) for (const v of [1, 2]) {
        const vst = M.voiceView(info.st, v, C.score); const bar = (v === 2 ? info.st.v2 : info.st.bars) || []; if (!bar[m]) continue;
        for (const ev of bar[m]) if (ev.notes && !ev.rest) out.push({ ev, st: vst, m, part: info.part, inst: info.inst });
      }
    }
    return out;
  }
  return selEvents().filter((f) => f.ev.notes && !f.ev.rest);
}
// up or down by semitones, spelled in the key (sharps going up, flats going down when it is not a note of the key)
function semiNote(n, d, key) {
  const midi = M.midiOf(n.s, n.a) + d;
  const pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1;
  const cands = [];
  for (let sc = 0; sc < 7; sc++) for (const a of [0, 1, -1]) {
    if ((((M.STEP_SEMI[sc] + a) % 12) + 12) % 12 !== pc) continue;
    let o = oct; const raw = M.STEP_SEMI[sc] + a; if (raw < 0) o += 1; if (raw > 11) o -= 1;
    cands.push({ s: o * 7 + sc, a });
  }
  const sc = (c) => (M.keyAlter(key, c.s) === c.a ? 0 : 10) + (c.a === 0 ? 0 : c.a === (d > 0 ? 1 : -1) ? 1 : 3);
  cands.sort((x, y) => sc(x) - sc(y));
  return { ...n, ...cands[0] };
}
function moveSemis(d) {
  const evs = selNoteEvents(); if (!evs.length) { hint('Select notes or bars first.'); return; }
  edit(() => { for (const f of evs) { const key = M.keyAt(C.score, f.m); f.ev.notes = f.ev.notes.map((n) => (n.perc ? n : semiNote(n, d, key))).sort((a, b) => a.s - b.s); } }, { keepSel: true });
  const f = evs[0]; unlock(); for (const n of f.ev.notes) sampler.preview(soundOf(f.part), midiOfNote(n, f.inst), 0.55, 0.45, f.part.mix || undefined);
}
function moveNotes(steps, chromatic) {
  const evs = selNoteEvents(); if (!evs.length) { hint('Select notes or bars first.'); return; }
  edit(() => {
    for (const f of evs) {
      const concert = C.score.layout.concert !== false;
      const key = M.keyAt(C.score, f.m);
      f.ev.notes = f.ev.notes.map((n) => {
        if (chromatic || n.perc) return n;
        const s = n.s + steps;
        // moving by a step keeps the key; moving by an octave keeps the accidental
        const a = Math.abs(steps) === 7 ? n.a : (concert ? M.keyAlter(key, s) : M.keyAlter(key, s));
        return { ...n, s, a };
      }).sort((a, b) => a.s - b.s);
    }
  }, { keepSel: true });
  const f = evs[0]; unlock(); for (const n of f.ev.notes) sampler.preview(soundOf(f.part), midiOfNote(n, f.inst), 0.55, 0.45, f.part.mix || undefined);
}
function setAcc(a) {
  const evs = selEvents().filter((f) => f.ev.notes && !f.ev.rest);
  if (!evs.length) { C.tool.acc = C.tool.acc === a ? null : a; renderTab(); hint(C.tool.acc === null ? 'Accidental off.' : 'The next note you write gets this accidental.'); return; }
  edit(() => { for (const f of evs) f.ev.notes = f.ev.notes.map((n) => ({ ...n, a })); }, { keepSel: true });
}
// ---- transposing
// by an interval: steps (letters) and semitones, both signed
function transpose(steps, semis, keyTo = null) {
  const evs = selEvents();
  const bars = C.selBars ? { from: C.selBars.from, to: C.selBars.to, sts: selStaves() } : null;
  const whole = !evs.length && !bars;
  const S = C.score;
  const f = M.fifthsOfInterval(steps, semis);
  // keys of more than six sharps or flats are written the simpler way (C♯ major becomes D♭), unless asked for
  const norm = (k) => (k > 6 ? k - 12 : k < -6 ? k + 12 : k);
  const info = M.staffInfo(S);
  const instOf = (st) => (info.find((x) => x.st === (st.base || st)) || {}).inst || {};
  // the key signatures move with the music when the whole score is transposed, or bars of every staff
  const allSt = M.allStaves(S);
  const keysMove = whole || (bars && allSt.every((st) => bars.sts.includes(st)));
  const k0 = whole ? 0 : bars ? bars.from : 0, k1 = whole ? S.measures.length - 1 : bars ? bars.to : -1;
  const respell = new Set();   // bars whose key was written the other way round (F♯ ↔ G♭): notes follow it
  edit(() => {
    if (keysMove) {
      const after = k1 + 1 < S.measures.length ? M.keyAt(S, k1 + 1) : null;
      const startKey = M.keyAt(S, k0);
      if (S.measures[k0].key === undefined || S.measures[k0].key === null) S.measures[k0].key = startKey;
      for (let m = k0; m <= k1; m++) {
        const ms = S.measures[m];
        if (ms.key === undefined || ms.key === null) continue;
        const raw = ms.key + f;
        ms.key = keyTo !== null && m === k0 ? keyTo : norm(raw);
        if (ms.key !== raw) for (let q = m; q <= k1; q++) { if (q > m && S.measures[q].key !== undefined && S.measures[q].key !== null) break; respell.add(q); }
      }
      // after the transposed bars the music goes back to its own key
      if (after !== null && (S.measures[k1 + 1].key === undefined || S.measures[k1 + 1].key === null) && M.keyAt(S, k1 + 1) !== after) S.measures[k1 + 1].key = after;
    }
    const tp = (n, m) => {
      if (!n || n.perc) return n;
      const midi = M.midiOf(n.s, n.a) + semis;
      let s2 = n.s + steps, a2 = midi - M.midiOf(s2, 0);
      if (Math.abs(a2) > 1 || respell.has(m)) { const sp = M.spell(midi, M.keyAt(S, m)); s2 = sp.s; a2 = sp.a; }
      return { ...n, s: s2, a: a2 };
    };
    const doEv = (ev, m, st) => {
      if (instOf(st).unpitched || ev.rest) return;
      if (ev.notes) ev.notes = ev.notes.map((n) => tp(n, m)).sort((x, y) => x.s - y.s);
      if (ev.grace) ev.grace = { ...ev.grace, ...tp({ s: ev.grace.s, a: ev.grace.a || 0 }, m) };
    };
    if (evs.length) { for (const x of evs) doEv(x.ev, x.m, x.st); return; }
    const sts = whole ? allSt : bars.sts;
    const m0 = whole ? 0 : bars.from, m1 = whole ? S.measures.length - 1 : bars.to;
    for (const st of sts) for (let m = m0; m <= m1; m++) {
      for (const ev of st.bars[m] || []) doEv(ev, m, st);
      if (st.v2 && st.v2[m]) for (const ev of st.v2[m]) doEv(ev, m, st);
    }
  }, { keepSel: true });
  const nm = { 1: 'a semitone', 2: 'a tone', 3: 'a minor 3rd', 4: 'a major 3rd', 5: 'a 4th', 6: 'a tritone', 7: 'a 5th', 8: 'a minor 6th', 9: 'a major 6th', 10: 'a minor 7th', 11: 'a major 7th', 12: 'an octave' }[Math.abs(semis)] || Math.abs(semis) + ' semitones';
  hint(`Transposed ${semis > 0 ? 'up' : 'down'} ${nm}.`, 1800);
  renderTab();
}
// open the palette at Transpose (from the selection bar)
function openTranspose() {
  C.tab = 'clef'; $('#cpPal').classList.remove('folded'); renderTab();
  const l = [...document.querySelectorAll('#cpPal .cp-lab')].find((x) => x.textContent.startsWith('Transpose'));
  if (l) l.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
// to another key: the nearer way (up or down)
function transposeToKey(from, to) {
  const tonic = (f) => ({ pc: (((f * 7) % 12) + 12) % 12, st: (((f * 4) % 7) + 7) % 7 });
  const a = tonic(from), b = tonic(to);
  let semis = (b.pc - a.pc + 12) % 12, steps = (b.st - a.st + 7) % 7;
  if (semis > 6 || (semis === 6 && steps > 3)) { semis -= 12; steps -= 7; }
  if (!semis && !steps) { hint('That is the key it is in now.'); return; }
  transpose(steps, semis, to);
}
function setDuration(t) {
  C.tool.dur = t; C.tool.rest = C.tool.rest && true;
  const evs = selEvents();
  if (evs.length && C.mode === 'select') {
    edit(() => {
      // (one after another, each found again where it is now: a longer note written first takes
      // the place of the next ones, which are then gone)
      for (const f of evs.slice().sort((a, b) => a.m - b.m || a.pos - b.pos)) {
        const bar = f.st.bars[f.m] || [], i = bar.findIndex((e) => e.id === f.ev.id);
        if (i < 0) continue;
        const time = M.timeAt(C.score, f.m); let pos = 0; for (let k = 0; k < i; k++) pos += M.ticksOf(bar[k], time);
        const ev = { ...M.clone(bar[i]), t, dots: C.tool.dots, full: false };
        if (tupN()) ev.tup = tupObj(t); else delete ev.tup;
        M.writeEvent(C.score, f.st, f.m, pos, ev);
      }
    }, { keepSel: true });
  }
  renderTab();
}
function toggleArt(a) {
  const evs = selEvents(); if (!evs.length) { hint('Select notes first (tap them), then choose the articulation.'); return; }
  const on = !evs.every((f) => (f.ev.art || []).includes(a));
  edit(() => { for (const f of evs) { const s = new Set(f.ev.art || []); if (on) s.add(a); else s.delete(a); f.ev.art = [...s]; } }, { keepSel: true });
}
function setDyn(d) {
  const evs = selEvents(); if (!evs.length) { hint('Select a note first, then the dynamic.'); return; }
  edit(() => { const f = evs[0]; f.ev.dyn = f.ev.dyn === d ? null : d; }, { keepSel: true });
}
// The place of the next note (skipping rests) after a place on a staff, with its event.
function nextNoteAt(st, at, withRests) {
  const f = (() => { const bar = st.bars[at.m] || []; const starts = M.eventStarts(bar, M.timeAt(C.score, at.m)); let i = -1; starts.forEach((p, k) => { if (p <= at.pos) i = k; }); return i >= 0 ? { m: at.m, i } : null; })();
  if (!f) return null;
  let nx = M.nextEvent(C.score, st, f.m, f.i), guard = 0;
  while (nx && !withRests && nx.ev.rest && guard++ < 256) nx = M.nextEvent(C.score, st, nx.m, nx.i);
  if (!nx) return null;
  return { m: nx.m, pos: M.eventStarts(st.bars[nx.m], M.timeAt(C.score, nx.m))[nx.i], ev: nx.ev };
}
// Slurs and hairpins: with several notes selected, over all of them (across bars and lines);
// with one note, to the next note, and each tap again stretches it one note further.
function lineOver(kind, dir) {
  const all = selEvents();
  const evs = kind === 'slur' ? all.filter((f) => !f.ev.rest) : all;
  if (!evs.length) { hint(kind === 'slur' ? 'Select the notes the slur goes over (drag across them in Select mode), or tap the first note.' : 'Select the notes the hairpin goes under, or tap the note where it starts.'); return; }
  const a = evs[0], z = evs[evs.length - 1];
  const st = a.st.base || a.st, v = a.voice || 1;
  const A = { m: a.m, pos: a.pos };
  const multi = evs.length > 1 && (z.st.base || z.st) === st;
  let msg = '';
  edit(() => {
    const spans = C.score.spans = C.score.spans || [];
    const same = (q) => q.kind === kind && q.st === st.id && (q.v || 1) === v;
    const existing = spans.find((q) => same(q) && q.a.m === A.m && q.a.pos === A.pos);
    if (multi) {
      const B = { m: z.m, pos: z.pos };
      if (existing && existing.b.m === B.m && existing.b.pos === B.pos && (kind !== 'hairpin' || existing.dir === dir)) { spans.splice(spans.indexOf(existing), 1); msg = kind === 'slur' ? 'Slur removed.' : 'Hairpin removed.'; return; }
      // a new line replaces the ones it would cross
      for (let i = spans.length - 1; i >= 0; i--) { const q = spans[i]; if (same(q) && !(before(q.b, A) || before(B, q.a)) && (kind === 'hairpin' || (q.a.m === A.m && q.a.pos === A.pos))) spans.splice(i, 1); }
      spans.push({ id: M.newId(), kind, st: st.id, v, a: A, b: B, ...(dir ? { dir } : {}) });
      msg = kind === 'slur' ? `Slur over ${evs.length} notes.` : `${dir === '<' ? 'Crescendo' : 'Diminuendo'} over ${evs.length} notes.`;
      return;
    }
    if (existing && (kind !== 'hairpin' || existing.dir === dir)) {
      // tap again: one note further
      const nx = nextNoteAt(M.voiceView(st, v, C.score), existing.b, kind === 'hairpin');
      if (!nx) { msg = 'That is the last note.'; return false; }
      existing.b = { m: nx.m, pos: nx.pos };
      C.sel.add(nx.ev.id);
      msg = 'Longer by one note. Tap again to go further.';
      return;
    }
    if (existing) { existing.dir = dir; msg = dir === '<' ? 'Now a crescendo.' : 'Now a diminuendo.'; return; }
    let B = A;
    if (kind === 'slur') { const nx = nextNoteAt(M.voiceView(st, v, C.score), A, false); if (!nx) { msg = 'A slur needs a note after this one.'; return false; } B = { m: nx.m, pos: nx.pos }; C.sel.add(nx.ev.id); }
    for (let i = spans.length - 1; i >= 0; i--) { const q = spans[i]; if (same(q) && kind === 'hairpin' && !(before(q.b, A) || before(B, q.a))) spans.splice(i, 1); }
    spans.push({ id: M.newId(), kind, st: st.id, v, a: A, b: B, ...(dir ? { dir } : {}) });
    msg = 'Tap again to stretch it over the next note too.';
  }, { keepSel: true });
  if (msg) hint(msg, 2600);
  relayout(); syncSelBar();
}
const before = (a, b) => a.m < b.m || (a.m === b.m && a.pos < b.pos);
function setHairpin(kind) { lineOver('hairpin', kind); }
function setSlur() { lineOver('slur'); }
// End a hairpin at the selected note.
function endHairpinHere() {
  const f = selEvents()[0]; if (!f) { hint('Select the note where the hairpin should end.'); return; }
  const st = f.st.base || f.st, v = f.voice || 1;
  const at = { m: f.m, pos: f.pos };
  const sp = (C.score.spans || []).filter((q) => q.kind === 'hairpin' && q.st === st.id && (q.v || 1) === v && !before(at, q.a)).sort((x, y) => (before(x.a, y.a) ? 1 : -1))[0];
  if (!sp) { hint('There is no hairpin before this note.'); return; }
  edit(() => { sp.b = at; }, { keepSel: true });
}
// Turn each selected stem the other way from how it is drawn now (a beamed group turns together).
function flipStems() {
  const evs = selEvents().filter((f) => f.ev.notes && !f.ev.rest);
  if (!evs.length) { hint('Select notes first, then flip their stems.'); return; }
  const shownUp = (id) => { for (const h of C.hits) if (h) { const q = h.events.find((x) => x.id === id); if (q) return q.up; } return null; };
  edit(() => {
    for (const f of evs) {
      const up = shownUp(f.ev.id);
      const want = up === null ? (f.ev.stem === 'up' ? 'down' : 'up') : (up ? 'down' : 'up');
      f.ev.stem = want;
      // the other notes of its beam follow, so the group really turns
      const bar = f.st.bars[f.m];
      for (const ev of bar) if (ev !== f.ev && ev.notes && !ev.rest && ev.t >= 8 && ev.stem && ev.stem !== want && sameBeat(bar, ev, f.ev, M.timeAt(C.score, f.m))) ev.stem = want;
    }
  }, { keepSel: true });
}
function sameBeat(bar, a, b, time) {
  const starts = M.eventStarts(bar, time); const ia = bar.indexOf(a), ib = bar.indexOf(b);
  const unit = time[1] === 8 && time[0] % 3 === 0 ? (M.WHOLE / 8) * 3 : time[1] === 8 ? (M.WHOLE / 8) * (time[0] <= 4 ? time[0] : 2) : time[1] === 2 ? M.WHOLE / 4 : M.WHOLE / time[1];
  return Math.floor(starts[ia] / unit) === Math.floor(starts[ib] / unit);
}
function setTie() {
  const evs = selEvents().filter((f) => f.ev.notes && !f.ev.rest); if (!evs.length) { hint('Select a note to tie to the next one.'); return; }
  edit(() => {
    for (const f of evs) {
      const on = !f.ev.notes.every((n) => n.tie);
      f.ev.notes.forEach((n) => { n.tie = on; });
      // a tie needs the same note next: write it if the next event is a rest
      const nx = M.nextEvent(C.score, f.st, f.m, f.i);
      if (on && nx && nx.ev.rest && !nx.ev.full) nx.ev.notes = f.ev.notes.map((n) => ({ ...n, tie: false })), nx.ev.rest = false, delete nx.ev.keep;
    }
  }, { keepSel: true });
}
function setText(txt) {
  const evs = selEvents(); if (!evs.length) { hint('Select a note, then add the words.'); return; }
  edit(() => { evs[0].ev.txt = txt || null; }, { keepSel: true });
}
function deleteSel() {
  if (C.markSel) { deleteMark(C.markSel); return; }
  if (C.selBars) { clearBars(); return; }
  const evs = selEvents(); if (!evs.length) return;
  edit(() => { for (const f of evs) M.clearEvent(C.score, f.st, f.m, f.ev.id); });
  C.sel.clear(); relayout(); syncSelBar();
}
// Empty: the bars keep their time and key, and everything else in them goes: notes, rests'
// markings, second voices, slurs and every line over the notes, clef changes; with every staff
// chosen also the tempo marks, rehearsal marks, repeats, endings and D.C. signs
function clearBars() {
  const b = C.selBars; if (!b) return;
  const S = C.score, sts = selStaves(), ids = new Set(sts.map((x) => x.id));
  const allSt = sts.length >= M.allStaves(S).length;
  edit(() => {
    for (const st of sts) {
      // (the clef after the emptied bars stays what it was)
      const after = b.to + 1 < S.measures.length ? M.clefAt(st, b.to + 1) : null;
      for (let m = b.from; m <= b.to; m++) {
        st.bars[m] = M.restBar(M.timeAt(S, m));
        if (st.v2 && st.v2[m]) st.v2[m] = M.restBar(M.timeAt(S, m));
        if (st.clefs && m > 0 && st.clefs[m] !== undefined) { const c = { ...st.clefs }; delete c[m]; st.clefs = c; }
      }
      if (after !== null && M.clefAt(st, b.to + 1) !== after) st.clefs = { ...(st.clefs || {}), [b.to + 1]: after };
    }
    const inside = (q) => !(q.b.m < b.from || q.a.m > b.to);
    S.spans = (S.spans || []).filter((q) => !(inside(q) && (ids.has(q.st) || (q.kind === 'volta' && allSt))));
    if (allSt) for (let m = b.from; m <= b.to; m++) {
      const ms = S.measures[m];
      for (const k of ['rehearsal', 'mark', 'jump', 'start']) delete ms[k];
      if (ms.bar && !(ms.bar === 'final' && m === S.measures.length - 1)) delete ms.bar;
      if (ms.tempo) { if (m === 0) ms.tempo = { ...ms.tempo, text: '' }; else delete ms.tempo; }
    }
  }, { keepSel: true });
  hint(allSt ? 'Emptied: notes, markings, lines, tempo and repeats. The time and key stay.' : 'Emptied: notes, markings and lines. The time and key stay.', 2600);
}
// copy: a passage of events from one staff
function copySel() {
  let clip = null;
  if (C.selBars) {
    const lanes = selStaves().map((st) => collect(st, C.selBars.from, 0, C.selBars.to, Infinity));
    clip = { events: lanes[0], lanes: lanes.length > 1 ? lanes : undefined, from: 'bars', n: C.selBars.to - C.selBars.from + 1 };
  }
  else {
    const evs = selEvents(); if (!evs.length) return;
    const a = evs[0], b = evs[evs.length - 1];
    if (a.st !== b.st) { D.toast('Copy notes from one staff at a time.'); return; }
    clip = { events: collect(a.st, a.m, a.pos, b.m, b.pos), from: 'notes' };
  }
  C.clip = clip; setSetting('composeClip', clip);
  D.toast(clip.from === 'bars' ? `Copied ${clip.n} ${clip.n === 1 ? 'bar' : 'bars'}.` : `Copied ${clip.events.length} ${clip.events.length === 1 ? 'note' : 'notes'}.`, 1800);
}
function collect(st, m0, p0, m1, p1) {
  const out = [];
  for (let m = m0; m <= m1; m++) {
    const time = M.timeAt(C.score, m); let p = 0;
    for (const ev of st.bars[m]) {
      const len = M.ticksOf(ev, time);
      if ((m > m0 || p >= p0) && (m < m1 || p <= p1)) {
        const c = M.clone(ev);
        if (c.full) { const v = M.valueOf(len); c.full = false; if (v) { c.t = v.t; c.dots = v.dots; } c.len = len; }
        out.push(c);
      }
      p += len;
    }
  }
  return out;
}
export function pasteClip(clip, at) {
  if (!clip || !clip.events.length) return;
  if (clip.lanes && clip.lanes.length > 1 && !at) {
    // several staves: each goes into the next staff down from the selected one
    const all = M.allStaves(C.score);
    const st0 = C.selBars ? C.selBars.st : (selEvents()[0] || {}).st; const m0 = C.selBars ? C.selBars.from : (selEvents()[0] || {}).m;
    if (!st0) { D.toast('Select a bar where the music goes.'); return; }
    const i0 = all.indexOf(st0);
    edit(() => { clip.lanes.forEach((events, k) => { const st = all[i0 + k]; if (st) pasteClip({ events }, { st, m: m0, pos: 0, quiet: true }); }); });
    D.toast('Pasted.', 1400); return;
  }
  let st, m, pos;
  if (at) ({ st, m, pos } = at);
  else if (C.selBars) { st = C.selBars.st; m = C.selBars.from; pos = 0; }
  else { const e = selEvents()[0]; if (!e) { D.toast('Select a bar or a note where the music goes.'); return; } st = e.st; m = e.m; pos = e.pos; }
  edit(() => {
    for (const src of clip.events) {
      const ev = { ...M.clone(src), id: M.newId() };
      delete ev.len;
      let len = M.evTicks(ev);
      if (src.len && src.full !== true && !M.valueOf(src.len)) {
        // a whole-bar rest of an odd time: paste as rests of that length
        len = src.len;
      }
      if (m >= C.score.measures.length) M.addBars(C.score, 1);
      const time = M.timeAt(C.score, m);
      if (ev.tup) {
        // triplets go in as they are, into the bar
        const bar = st.bars[m]; const starts = M.eventStarts(bar, time); const i = starts.indexOf(pos);
        if (i >= 0) { M.writeEvent(C.score, st, m, pos, { id: M.newId(), rest: true, keep: true, t: 64, dots: 0 }); }
        const b2 = st.bars[m]; const s2 = M.eventStarts(b2, time); const j = s2.indexOf(pos);
        if (j >= 0) b2.splice(j, 1, ev);
        st.bars[m] = M.tidyBar(b2, time);
      } else M.writeEvent(C.score, st, m, pos, ev);
      pos += len;
      while (pos >= M.barTicks(M.timeAt(C.score, m))) { pos -= M.barTicks(M.timeAt(C.score, m)); m++; }
    }
  });
  if (!(at && at.quiet)) D.toast('Pasted.', 1400);
}
function insertBars(n, after) {
  const at = C.selBars ? (after ? C.selBars.to + 1 : C.selBars.from) : targetBar() === null ? null : targetBar() + (after ? 1 : 0);
  const where = at === null ? C.score.measures.length : at;
  edit(() => M.addBars(C.score, n, where));
  if (C.selBars && !after) { C.selBars.from += n; C.selBars.to += n; relayout(); syncSelBar(); }
  hint(n === 1 ? `A bar was added ${after ? 'after' : 'before'} the selection.` : `${n} bars were added.`, 1800);
}
function deleteBars() {
  const b = C.selBars; if (!b) { hint('Select the bars to delete (tap a bar in Select mode, drag for more).'); return; }
  if (b.to - b.from + 1 >= C.score.measures.length) { D.toast('A score keeps at least one bar.'); return; }
  edit(() => M.deleteBars(C.score, b.from, b.to - b.from + 1));
  C.selBars = null; relayout(); syncSelBar();
}

// ---------- the bar under the toolbar for what is selected ----------
function syncSelBar() {
  const bar = $('#cpSel'); bar.textContent = '';
  document.querySelector('.cp-sel-more')?.remove();
  // As much as fits on one line without sliding, the most used first; what does not fit goes
  // under More.
  const sheet = el('div', 'cp-sel-more'); sheet.hidden = !C.moreOpen;
  const closeMore = () => { sheet.hidden = true; C.moreOpen = false; moreBtn.classList.remove('on'); };
  const btn = (label, fn, ic, cls) => { const b = el('button', cls || ''); if (ic) b.append(icon(ic)); if (label) b.append(document.createTextNode(label)); b.addEventListener('click', (e) => { e.stopPropagation(); if (b.parentElement === sheet && !b.classList.contains('keep')) closeMore(); fn(); }); bar.append(b); return b; };
  const placeMore = () => { if (sheet.hidden) return; const r = bar.getBoundingClientRect(); sheet.style.left = Math.max(8, Math.min(r.right - 300, innerWidth - 308)) + 'px'; sheet.style.top = (r.bottom + 6) + 'px'; };
  const moreBtn = el('button', 'more'); moreBtn.append(document.createTextNode('More ▾'));
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); sheet.hidden = !sheet.hidden; C.moreOpen = !sheet.hidden; moreBtn.classList.toggle('on', !sheet.hidden); placeMore(); });
  const finish = () => {
    bar.hidden = false; bar.append(moreBtn); bar.after(sheet);
    placeSelBar(bar);
    // move the last buttons into More until the line fits
    const movable = () => [...bar.children].filter((x) => x.tagName === 'BUTTON' && x !== moreBtn && !x.classList.contains('danger'));
    let guard = 0;
    while (bar.scrollWidth > bar.clientWidth + 1 && guard++ < 40) { const l = movable(); if (!l.length) break; sheet.prepend(l[l.length - 1]); }
    moreBtn.hidden = !sheet.children.length; moreBtn.classList.toggle('on', !!C.moreOpen && !moreBtn.hidden);
    if (moreBtn.hidden) { sheet.hidden = true; C.moreOpen = false; }
    placeSelBar(bar); placeMore();
  };
  if (C.markSel && SCORE_MARKS[C.markSel.kind]) {
    const mk = C.markSel, info = SCORE_MARKS[mk.kind];
    bar.append(el('span', 'what', info.label(mk) + (mk.m !== undefined ? ` · bar ${mk.m + 1}` : '')));
    const why = info.cannot && info.cannot(mk);
    if (!why) btn('Delete', () => deleteMark(mk), 'i-trash', 'danger');
    if (info.change) btn(info.changeLabel || 'Change…', () => info.change(mk), 'i-pen');
    if (why) bar.append(el('span', 'what soft', why));
    finish(); return;
  }
  if (C.markSel) {
    const mk = C.markSel, f = mk.kind === 'span' ? null : M.findEvent(C.score, mk.id);
    if (mk.kind !== 'span' && !f) { C.markSel = null; bar.hidden = true; return; }
    const label = mk.kind === 'tie' ? 'Tie' : mk.kind === 'chord' ? 'Chord ' + mk.name : mk.kind === 'lyric' ? 'Lyric “' + mk.name + '”' : mk.kind === 'evclef' ? (M.CLEFS[mk.name] ? M.CLEFS[mk.name].name : 'Clef') + ' clef' : mk.kind === 'dyn' ? 'Dynamic ' + mk.name : mk.kind === 'txt' ? 'Words' : mk.kind === 'fing' ? 'Fingering ' + mk.name : mk.kind === 'span' ? (mk.name === 'hairpin' ? 'Hairpin' : MARK_NAME[mk.name] || mk.name) : (MARK_NAME[mk.name] || mk.name);
    bar.append(el('span', 'what', f ? `${label} · bar ${f.m + 1}` : label));
    btn('Delete', () => deleteMark(mk), 'i-trash', 'danger');
    if (mk.kind === 'span' && ['slur', 'hairpin'].includes(mk.name)) btn('Reset shape', () => { edit(() => { const q = (C.score.spans || []).find((x) => x.id === mk.id); if (q) for (const k of ['off', 'ax', 'ay', 'bx', 'by', 'hd']) delete q[k]; }); drawHover(); });
    else if (mk.kind !== 'span') btn('Select the note', () => { C.markSel = null; C.sel.clear(); C.sel.add(mk.id); relayout(); syncSelBar(); drawHover(); renderTab(); });
    finish(); return;
  }
  if (C.selBars) {
    const sts = selStaves();
    const part = M.staffInfo(C.score).find((x) => x.st === C.selBars.st);
    const who = sts.length > 1 ? `${sts.length} staves` : part ? part.part.name : '';
    bar.append(el('span', 'what', (C.selBars.from === C.selBars.to ? `Bar ${C.selBars.from + 1}` : `Bars ${C.selBars.from + 1}–${C.selBars.to + 1}`) + (who ? ' · ' + who : '')));
    btn('Delete', deleteBars, 'i-trash', 'danger');
    btn('Copy', copySel, 'i-copy'); btn('Paste', () => pasteClip(C.clip), 'i-paste');
    btn('Play', () => togglePlay(C.selBars.from), 'i-play');
    const more = btn('Select more', () => { C.extend = !C.extend; more.classList.toggle('on', C.extend); hint(C.extend ? 'Tap more bars or staves to add them.' : 'Taps select one bar again.', 2200); }, 'i-plus');
    more.classList.toggle('on', !!C.extend);
    btn('▲', () => moveSemis(1), null, 'keep'); btn('▼', () => moveSemis(-1), null, 'keep');
    btn('Bar before', () => insertBars(1, false)); btn('Bar after', () => insertBars(1, true));
    btn('Empty', clearBars);
    btn('8va ▲', () => moveNotes(7), null, 'keep'); btn('8va ▼', () => moveNotes(-7), null, 'keep');
    btn('Transpose…', openTranspose);
    finish(); return;
  }
  const evs = selEvents();
  if (!evs.length) { bar.hidden = true; C.moreOpen = false; return; }
  const f = evs[0];
  const what = f.ev.rest ? 'Rest' : f.ev.notes.map((n) => M.noteName(n.s, n.a)).join(' ');
  bar.append(el('span', 'what', evs.length > 1 ? `${evs.length} selected` : `${what} · bar ${f.m + 1}`));
  btn(f.ev.rest ? 'Clear' : 'Delete', deleteSel, 'i-trash', 'danger');
  const pitched = evs.some((x) => !x.ev.rest);
  if (pitched) { btn('▲', () => moveSemis(1), null, 'keep'); btn('▼', () => moveSemis(-1), null, 'keep'); }
  btn('Copy', copySel, 'i-copy'); btn('Paste', () => pasteClip(C.clip), 'i-paste');
  const moreN = btn('Select more', () => { C.extend = !C.extend; moreN.classList.toggle('on', C.extend); hint(C.extend ? 'Tap the last note: everything up to it is selected. (Or drag from note to note in Select mode.)' : 'Taps select one note again.', 3000); }, 'i-plus');
  moreN.classList.toggle('on', !!C.extend);
  if (pitched) { btn('8va ▲', () => moveNotes(7), null, 'keep'); btn('8va ▼', () => moveNotes(-7), null, 'keep'); btn('Transpose…', openTranspose); }
  if (evs.some((x) => x.ev.grace)) { btn('Grace ▲', () => graceStep(1), null, 'keep'); btn('Grace ▼', () => graceStep(-1), null, 'keep'); }
  finish();
}
// Things of the score itself, tapped on their own: clefs, key and time signatures, tempo, rehearsal
// marks, repeats and special barlines, segno and coda, D.C. and the like. Each can be deleted (or,
// where the score needs one, changed).
const lastSet = (m, has) => { for (let i = m; i >= 0; i--) if (has(i)) return i; return 0; };
const staffById = (id) => M.allStaves(C.score).find((x) => x.id === id);
function changeAt(mk, tab) {
  const st = (mk.st && staffById(mk.st)) || M.allStaves(C.score)[0];
  C.markSel = null; C.sel.clear(); selectBars(st, st, mk.m, mk.m);
  C.tab = tab; $('#cpPal').classList.remove('folded'); relayout(); syncSelBar(); renderTab(); drawHover();
  hint(tab === 'clef' ? 'Choose the new one in the palette.' : 'Change it in the palette.', 2200);
}
const KEY_LABEL = (k) => (KEY_NAMES[+k + 7] || '').split(' / ')[0];
const SCORE_MARKS = {
  clef: {
    label: (mk) => (M.CLEFS[mk.name] ? M.CLEFS[mk.name].name : 'Clef') + ' clef',
    cannot: (mk) => { const st = staffById(mk.st); if (!st) return ''; const d = lastSet(mk.m, (i) => st.clefs && st.clefs[i] !== undefined && i > 0); return d === 0 && !(st.clefs && st.clefs[mk.m] !== undefined) && M.clefAt(st, mk.m) === st.clef ? 'The first clef can be changed, not deleted.' : ''; },
    del: (mk) => {
      const st = staffById(mk.st); if (!st) return;
      if (st.clefs && st.clefs[mk.m] !== undefined && mk.m > 0) { const c = { ...st.clefs }; delete c[mk.m]; st.clefs = c; return 'Clef change deleted.'; }
      const d = lastSet(mk.m, (i) => i > 0 && st.clefs && st.clefs[i] !== undefined);
      if (d > 0) { const c = { ...st.clefs }; delete c[d]; st.clefs = c; return `The clef change in bar ${d + 1} was deleted.`; }
      if (mk.m > 0) { st.clefs = { ...(st.clefs || {}), [mk.m]: M.clefEnd(st, mk.m - 1) }; return 'Clef change deleted.'; }
    },
    change: (mk) => changeAt(mk, 'clef'),
  },
  key: {
    label: (mk) => 'Key signature ' + KEY_LABEL(mk.name),
    cannot: (mk) => { const d = lastSet(mk.m, (i) => C.score.measures[i].key !== undefined && C.score.measures[i].key !== null); return d === 0 && !C.score.measures[0].key ? 'No key signature to delete.' : ''; },
    del: (mk) => {
      const S = C.score, d = lastSet(mk.m, (i) => S.measures[i].key !== undefined && S.measures[i].key !== null);
      if (d === 0) { S.measures[0].key = 0; return 'Key signature deleted: C major, A minor.'; }
      delete S.measures[d].key; return `The key change in bar ${d + 1} was deleted.`;
    },
    change: (mk) => changeAt(mk, 'clef'),
  },
  time: {
    label: (mk) => 'Time signature ' + mk.name,
    cannot: (mk) => (lastSet(mk.m, (i) => !!C.score.measures[i].time) === 0 ? 'The first time signature can be changed, not deleted.' : ''),
    del: (mk) => {
      const S = C.score, d = lastSet(mk.m, (i) => !!S.measures[i].time); if (d === 0) return;
      M.setTime(S, d, M.timeAt(S, d - 1)); delete S.measures[d].time; delete S.measures[d].timeSym;
      return `The time change in bar ${d + 1} was deleted.`;
    },
    change: (mk) => changeAt(mk, 'clef'),
  },
  tempo: {
    label: (mk) => 'Tempo ' + mk.name,
    del: (mk) => { const ms = C.score.measures[mk.m]; if (mk.m === 0) ms.tempo = { ...(ms.tempo || {}), text: '', show: false }; else delete ms.tempo; },
    change: (mk) => changeAt(mk, 'text'),
  },
  rehearsal: { label: (mk) => 'Rehearsal mark ' + mk.name, del: (mk) => { delete C.score.measures[mk.m].rehearsal; } },
  mmark: { label: (mk) => (mk.name === 'segno' ? 'Segno' : 'Coda'), del: (mk) => { delete C.score.measures[mk.m].mark; } },
  jump: { label: (mk) => mk.name, del: (mk) => { delete C.score.measures[mk.m].jump; } },
  barline: { label: (mk) => ({ double: 'Double barline', repeat: 'End repeat', final: 'Final barline' }[mk.name] || 'Barline'), del: (mk) => { delete C.score.measures[mk.m].bar; } },
  repstart: { label: () => 'Start repeat', del: (mk) => { delete C.score.measures[mk.m].start; } },
};
// Names of the markings (a marking tapped on its own shows its name in the bar, with Delete)
const MARK_NAME = { stacc: 'Staccato', stacciss: 'Staccatissimo', ten: 'Tenuto', acc: 'Accent', marc: 'Marcato', ferm: 'Fermata', fermS: 'Short fermata', fermL: 'Long fermata',
  down: 'Down bow', up: 'Up bow', harm: 'Harmonic', stopped: 'Stopped', open: 'Open', snap: 'Snap pizzicato', trill: 'Trill', mord: 'Mordent', prall: 'Short trill', turn: 'Turn', turnInv: 'Inverted turn',
  caes: 'Caesura', breath: 'Breath', slur: 'Slur', hairpin: 'Hairpin', cresc: 'cresc.', dim: 'dim.', rit: 'rit.', accel: 'accel.', '8va': '8va', '15ma': '15ma', '8vb': '8vb', '15mb': '15mb', ped: 'Pedal', gliss: 'Glissando', tr: 'Trill line', volta: 'Ending' };
function deleteMark(mk) {
  if (SCORE_MARKS[mk.kind]) {
    let msg = '';
    edit(() => { msg = SCORE_MARKS[mk.kind].del(mk) || ''; });
    C.markSel = null; relayout(); syncSelBar(); drawHover();
    hint(msg || 'Deleted. Undo brings it back.', 1800);
    return;
  }
  edit(() => {
    if (mk.kind === 'span') { C.score.spans = (C.score.spans || []).filter((q) => q.id !== mk.id); return; }
    const f = M.findEvent(C.score, mk.id); if (!f) return;
    if (mk.kind === 'art') f.ev.art = (f.ev.art || []).filter((a) => a !== mk.name);
    else if (mk.kind === 'dyn') f.ev.dyn = null;
    else if (mk.kind === 'txt') f.ev.txt = null;
    else if (mk.kind === 'fing') delete f.ev.fing;
    else if (mk.kind === 'tie') for (const n of f.ev.notes || []) n.tie = false;
    else if (mk.kind === 'chord') delete f.ev.chord;
    else if (mk.kind === 'lyric') delete f.ev.lyric;
    else if (mk.kind === 'evclef') delete f.ev.clef;
  });
  C.markSel = null; relayout(); syncSelBar(); drawHover();
  hint('Deleted. Undo brings it back.', 1500);
}
// the selection bar never covers the palette: it moves to the free space beside it
function placeSelBar(bar) {
  bar.style.left = ''; bar.style.transform = ''; bar.style.maxWidth = '';
  const pal = $('#cpPal'); if (!pal || bar.hidden) return;
  const p = pal.getBoundingClientRect(), b = bar.getBoundingClientRect(), W = window.innerWidth;
  if (!p.width || b.left >= p.right + 8 || b.right <= p.left - 8 || b.bottom < p.top || b.top > p.bottom) return;
  // room to the right of the palette, or to its left
  const rightRoom = W - p.right - 20, leftRoom = p.left - 20;
  if (rightRoom >= leftRoom) { bar.style.transform = 'none'; bar.style.left = (p.right + 12) + 'px'; bar.style.maxWidth = rightRoom + 'px'; }
  else { bar.style.transform = 'none'; bar.style.left = Math.max(8, p.left - 12 - Math.min(b.width, leftRoom)) + 'px'; bar.style.maxWidth = leftRoom + 'px'; }
}

// =====================================================================
// Palette
// =====================================================================
// ---- drawn icons: every symbol is drawn with the engraving font and centred on its real shape,
// so the palette looks the same on every iPad
const CLEF_GLYPH = { treble: '', bass: '', alto: '', tenor: '', treble8: '', bass8: '', perc: '' };
const NOTE_GLYPH = { 1: '', 2: '', 4: '', 8: '', 16: '', 32: '' };
function inkOf(on) { return on ? (css('--accent-ink') || '#fff') : (css('--ink') || '#16181d'); }
function drawIcon(draw, w, h, on, k = 6.6) {
  const c = document.createElement('canvas');
  const d = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
  c.width = Math.round(w * d); c.height = Math.round(h * d); c.style.width = w + 'px'; c.style.height = h + 'px';
  const g = c.getContext('2d');
  g.scale(d * k, d * k);
  g.fillStyle = g.strokeStyle = inkOf(on); g.lineCap = 'butt';
  draw(g, w / k, h / k);
  return c;
}
function gC(g, gl, W, H, size = 4, dy = 0) {
  // a glyph centred by its ink box
  const m = gm(gl), k = size / 4;
  const x = W / 2 - ((m.l + m.r) / 2) * k, y = H / 2 + ((m.a - m.d) / 2) * k + dy;
  glyph(g, gl, x, y, size);
}
function staff5(g, x0, x1, y0) { for (let i = 0; i < 5; i++) drawLine(g, x0, y0 + i, x1, y0 + i, 0.11); }
const mbtn = (label, title, on, fn, opts = {}) => {
  const b = el('button', 'cp-b' + (on ? ' on' : '') + (opts.cls ? ' ' + opts.cls : ''));
  if (opts.draw) b.append(drawIcon(opts.draw, opts.w || 40, opts.h || 32, on, opts.k));
  else if (opts.svg) b.append(icon(opts.svg));
  else if (opts.glyph) b.append(drawIcon((g, W, H) => gC(g, opts.glyph, W, H, opts.size || 4, opts.dy || 0), opts.w || 40, opts.h || 32, on));
  else b.append(el('span', opts.textCls ?? 'tx', label));
  if (opts.small) b.append(el('small', '', opts.small));
  b.setAttribute('aria-label', title); b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
};
// a card: a little picture with its name under it, like a pro palette
const card = (title, on, fn, draw, opts = {}) => {
  const b = el('button', 'cp-card' + (on ? ' on' : '') + (opts.cls ? ' ' + opts.cls : ''));
  b.append(drawIcon(draw, opts.w || 84, opts.h || 36, on, opts.k || 5.2));
  b.append(el('span', '', title));
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
};
const TABS = [
  { k: 'notes', title: 'Notes', draw: (g, W, H) => gC(g, NOTE_GLYPH[4], W, H, 3.4) },
  { k: 'art', title: 'Articulations', draw: (g, W, H) => gC(g, GL.art.acc[0], W, H, 4) },
  { k: 'dyn', title: 'Dynamics', draw: (g, W, H) => gC(g, GL.dyn.m + GL.dyn.f, W, H, 3.6) },
  { k: 'lines', title: 'Lines', draw: (g, W, H) => { g.lineWidth = 0.18; g.beginPath(); g.moveTo(W * 0.22, H * 0.4); g.lineTo(W * 0.78, H * 0.28); g.moveTo(W * 0.22, H * 0.4); g.lineTo(W * 0.78, H * 0.52); g.stroke(); g.beginPath(); g.moveTo(W * 0.18, H * 0.78); g.quadraticCurveTo(W / 2, H * 0.6, W * 0.82, H * 0.78); g.stroke(); } },
  { k: 'orn', title: 'Ornaments', draw: (g, W, H) => gC(g, GL.orn.tr, W, H, 3.6) },
  { k: 'text', title: 'Text and tempo', draw: (g, W, H) => { text(g, 'Aa', W / 2 - 1.15, H / 2 + 0.6, 2.0, '-apple-system, sans-serif', '600'); } },
  { k: 'clef', title: 'Clef, key, time and transpose', draw: (g, W, H) => gC(g, CLEF_GLYPH.treble, W, H, 2.6) },
  { k: 'bars', title: 'Bars and repeats', draw: (g, W, H) => { const y = H / 2 - 2 * 0.55; for (let i = 0; i < 5; i++) drawLine(g, W * 0.18, y + i * 0.55, W * 0.82, y + i * 0.55, 0.1); g.fillRect(W * 0.62, y, 0.28, 2.2); drawLine(g, W * 0.54, y, W * 0.54, y + 2.2, 0.1); } },
];
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { clearMetrics(); if (C.score && !$('#compose').hidden) { buildTabs(); renderTab(); relayout(); } });
function buildTabs() {
  const box = $('#cpPalTabs'); box.textContent = '';
  for (const t of TABS) {
    const on = t.k === C.tab;
    const b = el('button', 'cp-tab' + (on ? ' on' : '')); b.dataset.tab = t.k; b.setAttribute('aria-label', t.title); b.title = t.title;
    b.append(drawIcon(t.draw, 28, 26, false, 6.2));
    b.addEventListener('click', () => { C.tab = t.k; $('#cpPal').classList.remove('folded'); renderTab(); });
    box.append(b);
  }
}
// ---- lines over several notes
function selRange() {
  // the first and last selected place, on one staff
  if (C.selBars) {
    const st = C.selBars.st; const last = st.bars[C.selBars.to] || [];
    const time = M.timeAt(C.score, C.selBars.to); let p = 0, lp = 0; for (const ev of last) { lp = p; p += M.ticksOf(ev, time); }
    return { st, a: { m: C.selBars.from, pos: 0 }, b: { m: C.selBars.to, pos: lp } };
  }
  const evs = selEvents(); if (!evs.length) return null;
  const f = evs[0], l = evs[evs.length - 1];
  return { st: f.st, a: { m: f.m, pos: f.pos }, b: { m: l.m, pos: l.pos }, single: evs.length === 1, first: f };
}
function addSpan(kind, extra = {}) {
  const r = selRange();
  if (!r) { hint('Select the notes or bars the line goes over, then choose it.'); return; }
  edit(() => {
    const spans = C.score.spans = C.score.spans || [];
    let b = r.b;
    if (r.single && (kind === 'gliss' || kind === 'rit' || kind === 'accel' || kind === 'cresc' || kind === 'dim' || kind === 'ped')) {
      const nx = M.nextEvent(C.score, r.first.st, r.first.m, r.first.i); if (nx) b = { m: nx.m, pos: nx.pos ?? 0 };
    }
    if (kind === 'volta') { const v = { id: M.newId(), kind, a: { m: r.a.m, pos: 0 }, b: { m: r.b.m, pos: 0 }, ...extra }; const i = spans.findIndex((q) => q.kind === 'volta' && q.a.m === v.a.m); if (i >= 0) spans.splice(i, 1); else spans.push(v); return; }
    const same = spans.findIndex((q) => q.kind === kind && q.st === r.st.id && q.a.m === r.a.m && q.a.pos === r.a.pos);
    if (same >= 0) { spans.splice(same, 1); return; }
    spans.push({ id: M.newId(), kind, st: r.st.id, a: r.a, b, ...extra });
  }, { keepSel: true });
}
// A 1st, 2nd or 3rd ending over the selected bars. The 1st ending also gets the end repeat it needs.
function addEnding(n) {
  const r = selRange();
  if (!r) { hint('Select the bar (or bars) of the ending first.'); return; }
  edit(() => {
    const spans = C.score.spans = C.score.spans || [];
    const a = r.a.m, b = r.b.m;
    const old = spans.find((q) => q.kind === 'volta' && q.a.m === a);
    for (let i = spans.length - 1; i >= 0; i--) { const q = spans[i]; if (q.kind === 'volta' && !(q.b.m < a || q.a.m > b)) spans.splice(i, 1); }
    if (old && (old.n || 1) === n && old.b.m === b) return;   // tapped again: gone
    spans.push({ id: M.newId(), kind: 'volta', a: { m: a, pos: 0 }, b: { m: b, pos: 0 }, n, ...(n === 1 ? {} : { closed: false }) });
    if (n === 1 && C.score.measures[b].bar !== 'repeat') C.score.measures[b].bar = 'repeat';
    if (n >= 2 && a > 0 && !spans.some((q) => q.kind === 'volta' && q.b.m === a - 1)) hint('Tip: put the 1st ending on the bar(s) just before this one.', 3200);
  }, { keepSel: true });
  renderTab();
}
function removeSpans() {
  const r = selRange(); if (!r) { hint('Select where the lines are.'); return; }
  edit(() => { C.score.spans = (C.score.spans || []).filter((q) => !((q.st === r.st.id || q.kind === 'volta') && !(q.b.m < r.a.m || q.a.m > r.b.m))); }, { keepSel: true });
}
function setGrace(dir, slash) {
  const evs = selEvents().filter((f) => f.ev.notes && !f.ev.rest);
  if (!evs.length) { hint('Select a note, then add a grace note.'); return; }
  edit(() => {
    for (const f of evs) {
      if (!dir) { delete f.ev.grace; continue; }
      const ns = f.ev.notes.map((n) => n.s);
      const sStep = dir > 0 ? Math.max(...ns) + 1 : Math.min(...ns) - 1;
      const same = f.ev.grace && f.ev.grace.dir === dir && (f.ev.grace.slash !== false) === slash;
      if (same) delete f.ev.grace;
      else f.ev.grace = { s: sStep, a: M.keyAlter(M.keyAt(C.score, f.m), sStep), dir, ...(slash ? {} : { slash: false }) };
    }
  }, { keepSel: true });
}
// Move a grace note up or down (by step, keeping the key), or give it an accidental.
function graceStep(d) {
  const evs = selEvents().filter((f) => f.ev.grace);
  if (!evs.length) { hint('Select a note that has a grace note.'); return; }
  edit(() => { for (const f of evs) { const g = f.ev.grace; g.s += d; g.a = M.keyAlter(M.keyAt(C.score, f.m), g.s); delete g.acc; g.dir = g.s >= Math.max(...f.ev.notes.map((n) => n.s)) ? 1 : -1; } }, { keepSel: true });
  const f = evs[0]; unlock(); sampler.preview(soundOf(f.part), M.midiOf(f.ev.grace.s, f.ev.grace.a || 0), 0.55, 0.3, f.part.mix || undefined);
}
function graceAcc(a) {
  const evs = selEvents().filter((f) => f.ev.grace);
  if (!evs.length) { hint('Select a note that has a grace note.'); return; }
  edit(() => { for (const f of evs) { const g = f.ev.grace; if (g.acc === a) { delete g.acc; g.a = M.keyAlter(M.keyAt(C.score, f.m), g.s); } else { g.a = a; g.acc = a; } } }, { keepSel: true });
  const f = evs[0]; unlock(); sampler.preview(soundOf(f.part), M.midiOf(f.ev.grace.s, f.ev.grace.a || 0), 0.55, 0.3, f.part.mix || undefined);
}
// Note heads: for the whole chord, or (harmonics) only its top note.
function setHead(head, topOnly) {
  const evs = selEvents().filter((f) => f.ev.notes && !f.ev.rest);
  if (!evs.length) {
    // nothing selected: the next notes you write get this head (tap again for normal heads)
    C.tool.head = C.tool.head === head ? null : head; renderTab();
    hint(C.tool.head ? 'The next notes you write get this note head.' : 'Normal note heads again.'); return;
  }
  const isOn = evs.every((f) => (topOnly ? f.ev.notes[f.ev.notes.length - 1].head : (f.ev.head || null)) === head);
  edit(() => {
    for (const f of evs) {
      if (topOnly) { const ns = f.ev.notes.slice().sort((a, b) => a.s - b.s); const top = ns[ns.length - 1]; if (isOn) delete top.head; else top.head = head; continue; }
      f.ev.notes.forEach((n) => { delete n.head; });
      if (isOn || !head) delete f.ev.head; else f.ev.head = head;
    }
  }, { keepSel: true });
}
// A clef, key or time from bar m (to bar 'to' only, when given: the score goes back afterwards).
function applySig(kind, val, st, m, to) {
  const S = C.score, after = to !== null && to !== undefined ? to + 1 : null, hasAfter = after !== null && after < S.measures.length;
  // a clef for one note in the middle of a bar: the clef changes there, and holds on after it
  if (kind === 'clef' && !C.selBars && C.sel.size === 1) {
    const f = selEvents()[0];
    if (f && f.pos > 0 && f.voice !== 2 && (f.st === st || f.st.id === st.id)) {
      edit(() => {
        const before = M.clefAtPos(S, f.st, f.m, f.pos - 1), endOld = M.clefEnd(f.st, f.m);
        if (val === before) delete f.ev.clef; else f.ev.clef = val;
        const endNew = M.clefEnd(f.st, f.m), nx = f.m + 1;
        if (nx < S.measures.length && endNew !== endOld && M.clefAt(f.st, nx) === endOld) {
          f.st.clefs = { ...(f.st.clefs || {}), [nx]: endNew };
        }
      }, { keepSel: true });
      return;
    }
  }
  edit(() => {
    if (kind === 'clef') {
      const old = M.clefAt(st, hasAfter ? after : m);
      if (hasAfter && !(st.clefs && st.clefs[after]) && old !== val) st.clefs = { ...(st.clefs || {}), [after]: old };
      if (m === 0) st.clef = val; else { st.clefs = { ...(st.clefs || {}) }; st.clefs[m] = val; if (M.clefAt(st, m - 1) === val) delete st.clefs[m]; }
    } else if (kind === 'key') {
      const old = M.keyAt(S, hasAfter ? after : m);
      if (hasAfter && (S.measures[after].key === undefined || S.measures[after].key === null) && old !== val) S.measures[after].key = old;
      S.measures[m].key = val;
      if (m > 0 && M.keyAt(S, m - 1) === val) delete S.measures[m].key;
    } else {
      const old = M.timeAt(S, hasAfter ? after : m);
      if (hasAfter && !S.measures[after].time && (old[0] !== val.t[0] || old[1] !== val.t[1])) M.setTime(S, after, old);
      M.setTime(S, m, val.t); S.measures[m].timeSym = val.sym || undefined;
    }
  }, { keepSel: true });
  renderTab();
  const where = hasAfter ? `bars ${m + 1}–${to + 1}` : `bar ${m + 1} on`;
  hint(`${kind === 'clef' ? 'Clef' : kind === 'key' ? 'Key' : 'Time'} changed for ${where}.`, 2200);
}
function setBarMark(key, val) {
  const m = targetBar(); if (m === null) { hint('Select a bar first.'); return; }
  edit(() => { const ms = C.score.measures[m]; ms[key] = ms[key] === val ? undefined : val; }, { keepSel: true });
}
function setTextStyled(txt, style) {
  const evs = selEvents(); if (!evs.length) { hint('Select a note, then add the words.'); return; }
  edit(() => { const ev = evs[0].ev; if (ev.txt === txt && (ev.txtStyle || 'expr') === style) { ev.txt = null; ev.txtStyle = null; } else { ev.txt = txt; ev.txtStyle = style; } }, { keepSel: true });
}
function renderTab() {
  $$('#cpPalTabs .cp-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === C.tab));
  if (!TABS.some((x) => x.k === C.tab)) C.tab = 'notes';
  const t = TABS.find((x) => x.k === C.tab) || TABS[0];
  $('#cpPalTitle').textContent = t.title;
  const body = $('#cpPalBody'); body.textContent = '';
  const grid = (cls) => { const g = el('div', 'cp-grid' + (cls ? ' ' + cls : '')); body.append(g); return g; };
  const cards = (cls) => { const g = el('div', 'cp-cards' + (cls ? ' ' + cls : '')); body.append(g); return g; };
  const lab = (s) => body.append(el('div', 'cp-lab', s));
  const T = C.tool;
  const evs = selEvents();
  const hasArt = (a) => evs.length > 0 && evs.every((f) => (f.ev.art || []).includes(a));
  if (C.tab === 'notes') {
    const vs = el('div', 'seg full cp-voices');
    for (const [v, l] of [[1, 'Voice 1 (stems up)'], [2, 'Voice 2 (stems down)']]) {
      const b = el('button', (T.voice || 1) === v ? 'on' : '', l.split(' (')[0]); b.title = l;
      b.addEventListener('click', () => { T.voice = v; renderTab(); hint(v === 2 ? 'Voice 2: a second line of music on the same staff, stems down.' : 'Voice 1: the main line.'); });
      vs.append(b);
    }
    body.append(vs);
    const g = grid();
    for (const [d, name] of [[1, 'Whole'], [2, 'Half'], [4, 'Quarter'], [8, 'Eighth'], [16, '16th'], [32, '32nd']]) {
      const on = T.dur === d;
      g.append(mbtn('', name + ' note', on, () => setDuration(d), { draw: (gg, W, H) => gC(gg, T.rest ? GL.rest[d] : NOTE_GLYPH[d], W, H, 3.6), w: 40, h: 34 }));
    }
    const g2 = grid();
    g2.append(mbtn('', 'Dotted', T.dots === 1, () => { T.dots = T.dots ? 0 : 1; setDuration(T.dur); }, { draw: (gg, W, H) => { gC(gg, NOTE_GLYPH[4], W - 1.2, H, 3.2); glyph(gg, GL.dot, W / 2 + 0.7, H / 2 + 0.75, 3.2); }, small: 'dot' }));
    g2.append(mbtn('', 'Rest', T.rest, () => { T.rest = !T.rest; renderTab(); }, { draw: (gg, W, H) => gC(gg, GL.rest[4], W, H, 3.4, -0.4), small: 'rest' }));
    g2.append(mbtn('', 'Triplet', tupN() === 3, () => { T.tup = tupN() === 3 ? 0 : 3; setDuration(T.dur); }, { draw: (gg, W, H) => gC(gg, GL.tuplet(3), W, H, 3.4, -0.5), small: 'triplet' }));
    g2.append(mbtn('Chord', 'Add notes to a chord', T.chord, () => { T.chord = !T.chord; renderTab(); hint(T.chord ? 'Write on an existing note to add to its chord.' : 'Writing replaces what is there.'); }, { draw: (gg, W, H) => { const x = W / 2 - 0.6; for (const dy of [-1, 0, 1]) glyph(gg, GL.noteBlack, x, H / 2 + 0.5 + dy, 3.2); }, small: 'chord' }));
    g2.append(mbtn('', 'Write with your finger', C.finger, () => { C.finger = !C.finger; $('#compose').classList.toggle('finger', C.finger); renderTab(); hint(C.finger ? 'Your finger writes. Two fingers scroll and zoom.' : 'Your finger scrolls; the Pencil writes.'); }, { svg: 'i-finger' }));
    lab('Tuplets');
    const gtu = grid('five');
    for (const [n, name] of [[2, 'Duplet (2 in the time of 3)'], [3, 'Triplet (3 in the time of 2)'], [4, 'Quadruplet (4 in the time of 3)'], [5, 'Quintuplet (5 in the time of 4)'], [6, 'Sextuplet (6 in the time of 4)'], [7, 'Septuplet (7 in the time of 4)'], [8, 'Octuplet (8 in the time of 6)'], [9, 'Nonuplet (9 in the time of 8)'], [10, 'Decuplet (10 in the time of 8)'], [11, 'Undecuplet (11 in the time of 8)']]) {
      gtu.append(mbtn('', name, tupN() === n, () => { T.tup = tupN() === n ? 0 : n; setDuration(T.dur); hint(T.tup ? name + '. Choose the note value, then write the notes.' : 'Tuplet off.', 2200); }, { draw: (gg, W, H) => gC(gg, GL.tuplet(n), W, H, 3.4, -0.5), small: 'tuplet ' + n }));
    }
    lab('Accidentals');
    const ga = grid('five');
    for (const [a, name] of [[-2, 'Double flat'], [-1, 'Flat'], [0, 'Natural'], [1, 'Sharp'], [2, 'Double sharp']]) ga.append(mbtn('', name, T.acc === a, () => setAcc(a), { glyph: GL.acc[a], size: a === 2 ? 4 : 3.6 }));
    lab('Selected notes');
    const arc = (gg, W, H, up) => { gg.beginPath(); const y = H * (up ? 0.62 : 0.38), h = up ? -1.3 : 1.3; gg.moveTo(W * 0.18, y); gg.bezierCurveTo(W * 0.35, y + h, W * 0.65, y + h, W * 0.82, y); gg.bezierCurveTo(W * 0.65, y + h * 0.72, W * 0.35, y + h * 0.72, W * 0.18, y); gg.fill(); };
    const gt = grid('four');
    gt.append(mbtn('', 'Tie', false, setTie, { draw: (gg, W, H) => { glyph(gg, GL.noteBlack, W * 0.16, H * 0.66, 3); glyph(gg, GL.noteBlack, W * 0.66, H * 0.66, 3); arc(gg, W, H * 1.2, false); }, small: 'tie' }));
    gt.append(mbtn('', 'Slur', false, setSlur, { draw: (gg, W, H) => arc(gg, W, H, true), small: 'slur' }));
    gt.append(mbtn('', 'Flip stem', false, flipStems, { draw: (gg, W, H) => { gg.save(); gg.translate(W / 2, H / 2); gg.rotate(Math.PI); gg.translate(-W / 2, -H / 2); gC(gg, NOTE_GLYPH[4], W, H, 3.2); gg.restore(); }, small: 'flip stem' }));
    gt.append(mbtn('', 'Delete', false, deleteSel, { svg: 'i-trash' }));
    const g3 = grid('four');
    g3.append(mbtn('', 'Up a semitone', false, () => moveSemis(1), { svg: 'i-up', textCls: '' }));
    g3.append(mbtn('', 'Down a semitone', false, () => moveSemis(-1), { svg: 'i-down' }));
    g3.append(mbtn('', 'Up an octave', false, () => moveNotes(7), { draw: (gg, W, H) => gC(gg, GL.ott['8va'], W, H, 3.4), small: 'octave up' }));
    g3.append(mbtn('', 'Down an octave', false, () => moveNotes(-7), { draw: (gg, W, H) => gC(gg, GL.ott['8vb'], W, H, 3.4), small: 'octave down' }));
    lab('Note heads');
    const gh = grid('four');
    const curHead = evs.length ? (evs[0].ev.notes ? (evs[0].ev.head || null) : undefined) : (C.tool.head || null);
    const headIcon = (gl, paren) => (gg, W, H) => { gC(gg, gl, W, H, 4.6); if (paren) { const m = gm(gl); glyph(gg, GL.parenL, W / 2 - 1.25, H / 2 + 0.5, 3.6); glyph(gg, GL.parenR, W / 2 + 0.7, H / 2 + 0.5, 3.6); void m; } };
    for (const [h, name, gl] of [[null, 'Normal', GL.noteBlack], ['x', 'Cross', GL.heads.x[2]], ['diamond', 'Diamond', GL.heads.diamond[2]], ['slash', 'Slash', GL.heads.slash[2]],
      ['tri', 'Triangle', GL.heads.tri[2]], ['square', 'Square', GL.heads.square[2]], ['circlex', 'Circle cross', GL.heads.circlex[2]], ['ghost', 'Ghost note', GL.noteBlack]]) {
      gh.append(mbtn('', h === 'ghost' ? 'Ghost note' : name + ' note head', curHead === h, () => setHead(h), { draw: headIcon(gl, h === 'ghost'), small: name.toLowerCase() }));
    }
    const gh2 = grid('two');
    gh2.append(mbtn('Harmonic', 'Harmonic: diamond on the top note of the chord (artificial harmonic)', !!(evs[0] && evs[0].ev.notes && evs[0].ev.notes.length > 1 && evs[0].ev.notes[evs[0].ev.notes.length - 1].head === 'harm'), () => setHead('harm', true), { draw: (gg, W, H) => { glyph(gg, GL.noteBlack, W / 2 - 0.6, H / 2 + 1.1, 3.4); glyph(gg, GL.heads.harm[2], W / 2 - 0.6, H / 2 - 0.6, 3.4); }, small: 'top note ◇' }));
  } else if (C.tab === 'art') {
    const g = grid();
    for (const [a, name] of [['stacc', 'Staccato'], ['stacciss', 'Staccatissimo'], ['ten', 'Tenuto'], ['acc', 'Accent'], ['marc', 'Marcato'], ['ferm', 'Fermata'],
      ['down', 'Down bow'], ['up', 'Up bow'], ['harm', 'Harmonic'], ['stopped', 'Stopped'], ['open', 'Open'], ['snap', 'Snap pizzicato']]) {
      const gl = { stopped: GL.orn.stopped, open: GL.orn.open, snap: GL.orn.snapA }[a] || GL.art[a][0];
      g.append(mbtn('', name, hasArt(a), () => toggleArt(a), { glyph: gl, size: a === 'ferm' ? 3.6 : 4.2 }));
    }
    lab('Tremolo and arpeggio');
    const g2 = grid('five');
    for (const [a, name] of [['trem', 'Tremolo, 1 stroke'], ['trem2', 'Tremolo, 2 strokes'], ['trem3', 'Tremolo, 3 strokes']]) g2.append(mbtn('', name, hasArt(a), () => toggleArt(a), { draw: (gg, W, H) => { const gl = a === 'trem' ? GL.art.trem[0] : GL.orn[a]; gC(gg, NOTE_GLYPH[4], W, H, 3.2); const m = gm(gl); glyph(gg, gl, W / 2 + 0.05 - (m.l + m.r) / 2 * 0.8, H / 2 - 0.4, 3.2); } }));
    g2.append(mbtn('', 'Arpeggio', hasArt('arp'), () => toggleArt('arp'), { draw: (gg, W, H) => { gg.save(); gg.translate(W / 2 - 0.3, H / 2 + 1.6); gg.rotate(-Math.PI / 2); for (let x = 0; x < 3.2; x += gm(GL.orn.arp).r || 0.8) glyph(gg, GL.orn.arp, x, 0.4, 3.4); gg.restore(); } }));
    g2.append(mbtn('', 'Breath', hasArt('breath'), () => toggleArt('breath'), { glyph: GL.art.breath[0], size: 4.4 }));
  } else if (C.tab === 'dyn') {
    const cur = evs[0];
    const g = grid('five');
    for (const d of ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp']) g.append(mbtn('', d, cur && cur.ev.dyn === d, () => setDyn(d), { glyph: d.split('').map((c) => GL.dyn[c]).join(''), size: d.length > 2 ? 3.2 : 3.8 }));
    lab('Hairpins');
    const cg = cards('three');
    const pin = (gg, W, H, open) => { gg.lineWidth = 0.14; gg.beginPath(); const x0 = W * 0.18, x1 = W * 0.82, y = H / 2; if (open) { gg.moveTo(x1, y - 1); gg.lineTo(x0, y); gg.lineTo(x1, y + 1); } else { gg.moveTo(x0, y - 1); gg.lineTo(x1, y); gg.lineTo(x0, y + 1); } gg.stroke(); };
    const hpHere = cur ? M.spanStartingAt(C.score, 'hairpin', (cur.st.base || cur.st).id, cur.voice || 1, { m: cur.m, pos: cur.pos }) : null;
    cg.append(card('Crescendo', !!hpHere && hpHere.dir === '<', () => setHairpin('<'), (gg, W, H) => pin(gg, W, H, true)));
    cg.append(card('Diminuendo', !!hpHere && hpHere.dir === '>', () => setHairpin('>'), (gg, W, H) => pin(gg, W, H, false)));
    cg.append(card('End here', false, endHairpinHere, (gg, W, H) => { gg.lineWidth = 0.14; gg.beginPath(); gg.moveTo(W * 0.15, H / 2 - 0.9); gg.lineTo(W * 0.6, H / 2); gg.lineTo(W * 0.15, H / 2 + 0.9); gg.stroke(); drawLine(gg, W * 0.72, H / 2 - 1.3, W * 0.72, H / 2 + 1.3, 0.14); }));
    body.append(el('p', 'hint', 'Drag across notes in Select mode (or use Select more) and the hairpin goes under all of them, across bars and lines. With one note selected, each tap stretches it one note further.'));
  } else if (C.tab === 'lines') {
    const has = (kind) => { const r = selRange(); return !!r && (C.score.spans || []).some((q) => q.kind === kind && (q.st === r.st.id || kind === 'volta') && q.a.m === r.a.m); };
    const cg = cards('three');
    const LK = { k: 6.6 };
    const dash = (gg, x0, x1, y) => { gg.save(); gg.lineWidth = 0.12; gg.setLineDash([0.5, 0.45]); gg.beginPath(); gg.moveTo(x0, y); gg.lineTo(x1, y); gg.stroke(); gg.restore(); };
    cg.append(card('Trill', has('trill'), () => addSpan('trill'), (gg, W, H) => { glyph(gg, GL.orn.tr, W * 0.08, H / 2 + 0.7, 3.4); for (let x = W * 0.08 + 2.0; x < W * 0.92; x += gm(GL.orn.wiggle).r || 0.8) glyph(gg, GL.orn.wiggle, x, H / 2 + 0.2, 3.4); }, LK));
    for (const [k, name] of [['8va', 'Octave up'], ['8vb', 'Octave down'], ['15ma', 'Two octaves up']]) cg.append(card(name, has(k), () => addSpan(k), (gg, W, H) => { const up = k !== '8vb'; glyph(gg, GL.ott[k], W * 0.08, H / 2 + 0.8, 3.0); dash(gg, W * 0.08 + (k === '15ma' ? 3.0 : 2.3), W * 0.9, H / 2 - 0.1); drawLine(gg, W * 0.9, H / 2 - 0.1, W * 0.9, H / 2 + (up ? 1 : -1), 0.12); }, LK));
    cg.append(card('Pedal', has('ped'), () => addSpan('ped'), (gg, W, H) => { glyph(gg, GL.ped, W * 0.06, H / 2 + 0.8, 3.0); gg.lineWidth = 0.12; gg.beginPath(); gg.moveTo(W * 0.06 + 3.1, H / 2 + 0.7); gg.lineTo(W * 0.92, H / 2 + 0.7); gg.lineTo(W * 0.92, H / 2 - 0.6); gg.stroke(); }, LK));
    cg.append(card('Pedal ✱', false, () => addSpan('ped', { line: false }), (gg, W, H) => { glyph(gg, GL.ped, W * 0.08, H / 2 + 0.8, 3.0); glyph(gg, GL.pedUp, W * 0.74, H / 2 + 0.8, 3.0); }, LK));
    cg.append(card('1st ending', false, () => addEnding(1), (gg, W, H) => { gg.lineWidth = 0.12; gg.beginPath(); gg.moveTo(W * 0.1, H * 0.85); gg.lineTo(W * 0.1, H * 0.25); gg.lineTo(W * 0.9, H * 0.25); gg.lineTo(W * 0.9, H * 0.85); gg.stroke(); text(gg, '1.', W * 0.1 + 0.4, H * 0.25 + 1.6, 1.6); }, LK));
    cg.append(card('2nd ending', false, () => addEnding(2), (gg, W, H) => { gg.lineWidth = 0.12; gg.beginPath(); gg.moveTo(W * 0.1, H * 0.85); gg.lineTo(W * 0.1, H * 0.25); gg.lineTo(W * 0.9, H * 0.25); gg.stroke(); text(gg, '2.', W * 0.1 + 0.4, H * 0.25 + 1.6, 1.6); }, LK));
    cg.append(card('Glissando', has('gliss'), () => addSpan('gliss'), (gg, W, H) => { glyph(gg, GL.noteBlack, W * 0.1, H * 0.75, 3.0); glyph(gg, GL.noteBlack, W * 0.78, H * 0.35, 3.0); drawLine(gg, W * 0.1 + 1.2, H * 0.72, W * 0.78 - 0.2, H * 0.36, 0.12); }, LK));
    for (const [k, word] of [['rit', 'rit.'], ['accel', 'accel.'], ['cresc', 'cresc.'], ['dim', 'dim.']]) cg.append(card(word.replace('.', '.') + ' – –', has(k), () => addSpan(k), (gg, W, H) => { text(gg, word, W * 0.06, H / 2 + 0.6, 1.9, TEXT_FONT, 'italic'); dash(gg, W * 0.06 + textWidth(gg, word, 1.9, TEXT_FONT, 'italic') + 0.4, W * 0.94, H / 2 + 0.1); }, LK));
    const g2 = grid('three');
    g2.append(mbtn('Remove', 'Remove the lines on the selection', false, removeSpans, { textCls: '', small: 'lines here' }, LK));
    body.append(el('p', 'hint', 'Select the notes (or bars) first; the line goes from the first to the last. Endings go over the selected bars.'));
  } else if (C.tab === 'orn') {
    const g = grid('five');
    for (const [a, name, gl] of [['trill', 'Trill', GL.orn.tr], ['mord', 'Mordent', GL.orn.mord], ['prall', 'Short trill', GL.orn.prall], ['turn', 'Turn', GL.orn.turn], ['turnInv', 'Inverted turn', GL.orn.turnInv],
      ['ferm', 'Fermata', GL.art.ferm[0]], ['fermS', 'Short fermata', GL.orn.fermSA], ['fermL', 'Long fermata', GL.orn.fermLA], ['caes', 'Caesura', GL.orn.caes], ['breath', 'Breath', GL.art.breath[0]]]) {
      g.append(mbtn('', name, hasArt(a), () => toggleArt(a), { glyph: gl, size: 4 }));
    }
    lab('Grace notes');
    const gg4 = grid('four');
    const graceIcon = (dy, slash) => (gg, W, H) => {
      const k = 0.64, x = W / 2 - 2.0, y = H / 2 + 1.2 - dy * 0.5, sx = x + 1.18 * k - 0.05, top = y - 2.7;
      glyph(gg, GL.noteBlack, x, y, 4 * k); drawLine(gg, sx, y - 0.1, sx, top, 0.1); glyph(gg, GL.flagUp[8], sx - 0.05, top, 4 * k);
      if (slash) drawLine(gg, sx - 0.65, top + 1.55, sx + 0.95, top + 0.35, 0.11);
      glyph(gg, GL.noteBlack, W / 2 + 0.4, H / 2 + 1.2, 3.4); drawLine(gg, W / 2 + 0.4 + 1.18 * 0.85 - 0.05, H / 2 + 1.1, W / 2 + 0.4 + 1.18 * 0.85 - 0.05, H / 2 - 1.8, 0.11);
    };
    const curGrace = evs[0] && evs[0].ev.grace;
    gg4.append(mbtn('', 'Grace note above', !!curGrace && curGrace.dir === 1 && curGrace.slash !== false, () => setGrace(1, true), { draw: graceIcon(1, true), small: 'above' }));
    gg4.append(mbtn('', 'Grace note below', !!curGrace && curGrace.dir === -1, () => setGrace(-1, true), { draw: graceIcon(-1, true), small: 'below' }));
    gg4.append(mbtn('', 'Appoggiatura', !!curGrace && curGrace.slash === false, () => setGrace(1, false), { draw: graceIcon(1, false), small: 'appoggiatura' }));
    gg4.append(mbtn('', 'No grace note', false, () => setGrace(0), { svg: 'i-trash', small: 'remove' }));
    if (curGrace) {
      lab('Grace note: ' + M.noteName(curGrace.s, curGrace.a || 0));
      const gg5 = grid('five');
      gg5.append(mbtn('', 'Grace note up a step', false, () => graceStep(1), { svg: 'i-up', small: 'up' }));
      gg5.append(mbtn('', 'Grace note down a step', false, () => graceStep(-1), { svg: 'i-down', small: 'down' }));
      for (const [a, name] of [[-1, 'Flat'], [0, 'Natural'], [1, 'Sharp']]) gg5.append(mbtn('', 'Grace note ' + name.toLowerCase(), curGrace.acc === a, () => graceAcc(a), { glyph: GL.acc[a], size: 3.6 }));
    }
    lab('Signs on the bar');
    const m = targetBar();
    const cg = cards('three');
    const ms = m === null ? {} : C.score.measures[m] || {};
    cg.append(card('Segno', ms.mark === 'segno', () => setBarMark('mark', 'segno'), (gg, W, H) => gC(gg, GL.segno, W, H, 3.4)));
    cg.append(card('Coda', ms.mark === 'coda', () => setBarMark('mark', 'coda'), (gg, W, H) => gC(gg, GL.coda, W, H, 3.4)));
    for (const [k, t2] of [['tocoda', 'To Coda'], ['fine', 'Fine'], ['dcfine', 'D.C. al Fine'], ['dscoda', 'D.S. al Coda'], ['dsfine', 'D.S. al Fine'], ['dc', 'D.C.'], ['ds', 'D.S.']]) {
      cg.append(card(t2, ms.jump === k, () => setBarMark('jump', k), (gg, W, H) => { const w = textWidth(gg, t2, 2.1, TEXT_FONT, 'italic'); text(gg, t2, W / 2 - w / 2, H / 2 + 0.7, 2.1, TEXT_FONT, 'italic'); }, { k: 6.4 }));
    }
    body.append(el('p', 'hint', 'Ornaments go on the selected notes. Signs go on the selected bar; they are followed when the score plays.'));
  } else if (C.tab === 'text') {
    // lyrics and chord symbols: type, press Return, and the next note is ready
    const entry = (label, key, ph) => {
      const row = el('div', 'cp-row');
      const inp = el('input'); inp.placeholder = ph; inp.setAttribute('aria-label', label); inp.autocapitalize = 'off'; inp.spellcheck = false;
      if (evs[0] && evs[0].ev[key]) inp.value = evs[0].ev[key];
      const go = el('button', 'btn small primary', 'Next ›');
      const put = () => {
        const cur = selEvents()[0]; if (!cur) { hint('Select the first note, then type.'); return; }
        const v = inp.value.trim();
        edit(() => { if (v) cur.ev[key] = v; else delete cur.ev[key]; }, { keepSel: true });
        let nx = M.nextEvent(C.score, cur.st, cur.m, cur.i);
        let guard = 0; while (nx && nx.ev.rest && guard++ < 64) nx = M.nextEvent(C.score, cur.st, nx.m, nx.i);
        if (nx) { C.sel.clear(); C.sel.add(nx.ev.id); relayout(); syncSelBar(); }
        inp.value = nx && nx.ev[key] ? nx.ev[key] : '';
        inp.focus();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || (key === 'lyric' && e.key === ' ')) { e.preventDefault(); put(); } else if (key === 'lyric' && e.key === '-') { e.preventDefault(); inp.value = inp.value.replace(/-$/, '') + '-'; put(); } });
      go.addEventListener('click', put);
      row.append(inp, go); body.append(row);
    };
    lab('Lyrics');
    entry('Lyrics', 'lyric', 'Syllable, then space or -');
    lab('Chord symbols');
    entry('Chord symbol', 'chord', 'C, Am7, F#m7b5, G/B…');
    const m = targetBar() ?? 0;
    const tempo = M.tempoAt(C.score, m);
    const cur = evs[0] && evs[0].ev;
    lab('Fingering on the selected note');
    {
      const fr = el('div', 'cp-row cp-fing');
      for (const d of ['0', '1', '2', '3', '4', '5']) {
        const b = el('button', 'btn small' + (cur && cur.fing === d ? ' on' : ''), d);
        b.addEventListener('click', () => { const sel = selEvents().filter((f) => !f.ev.rest); if (!sel.length) { hint('Select a note first, then its finger.'); return; } edit(() => { for (const f of sel) { if (f.ev.fing === d) delete f.ev.fing; else f.ev.fing = d; } }, { keepSel: true }); renderTab(); });
        fr.append(b);
      }
      body.append(fr);
    }
    lab('Words on the selected note');
    const cg = cards('three');
    const tcard = (title, word, style, font, weight, box) => cg.append(card(title, !!cur && cur.txt === word && (cur.txtStyle || 'expr') === style, () => setTextStyled(word, style), (gg, W, H) => { const w = textWidth(gg, word, 2.2, font, weight); text(gg, word, W / 2 - w / 2, H / 2 + 0.7, 2.2, font, weight); if (box) { gg.lineWidth = 0.12; gg.strokeRect(W / 2 - w / 2 - 0.5, H / 2 - 1.5, w + 1.0, 2.7); } }, { k: 6.4 }));
    tcard('Expression', 'espress.', 'expr', TEXT_FONT, 'italic');
    tcard('Technique', 'pizz.', 'tech', TEXT_FONT, '');
    tcard('Boxed text', 'Solo', 'box', TEXT_FONT, '', true);
    for (const w of ['dolce', 'cantabile', 'legato', 'arco', 'a tempo', 'con sord.', 'senza sord.', 'sul pont.', 'sul tasto']) tcard(w, w, ['arco', 'con sord.', 'senza sord.', 'sul pont.', 'sul tasto'].includes(w) ? 'tech' : 'expr', TEXT_FONT, ['arco', 'con sord.', 'senza sord.', 'sul pont.', 'sul tasto'].includes(w) ? '' : 'italic');
    const row2 = el('div', 'cp-row');
    const tx = el('input'); tx.placeholder = 'Your own words';
    const st = el('select'); for (const [v, l] of [['expr', 'Expression'], ['tech', 'Technique'], ['box', 'Boxed']]) { const o = el('option', '', l); o.value = v; st.append(o); }
    const add = el('button', 'btn small', 'Add');
    add.addEventListener('click', () => { if (tx.value.trim()) setTextStyled(tx.value.trim(), st.value); tx.value = ''; });
    row2.append(tx, st, add); body.append(row2);
    lab('Tempo in bar ' + (m + 1));
    const row = el('div', 'cp-row');
    const bpm = el('input', 'num'); bpm.type = 'number'; bpm.inputMode = 'numeric'; bpm.min = 20; bpm.max = 300; bpm.value = tempo.bpm;
    const word = el('input'); word.placeholder = 'Allegro, Andante…'; word.value = C.score.measures[m].tempo ? C.score.measures[m].tempo.text || '' : '';
    const setT = el('button', 'btn small primary', 'Set');
    setT.addEventListener('click', () => edit(() => { C.score.measures[m].tempo = { bpm: clamp(+bpm.value || 96, 20, 300), beat: tempo.beat || 4, text: word.value.trim() }; }, { keepSel: true }));
    row.append(bpm, word, setT); body.append(row);
    const tg = cards('two');
    for (const [w, b] of [['Largo', 50], ['Adagio', 66], ['Andante', 80], ['Moderato', 100], ['Allegretto', 112], ['Allegro', 132], ['Vivace', 156], ['Presto', 180]]) {
      tg.append(card(w, !!C.score.measures[m].tempo && C.score.measures[m].tempo.text === w, () => edit(() => { C.score.measures[m].tempo = { bpm: b, beat: 4, text: w }; }, { keepSel: true }), (gg, W, H) => {
        const tw = textWidth(gg, w, 1.8, TEXT_FONT, '700'); const total = tw + 4.6; let x = W / 2 - total / 2; text(gg, w, x, H / 2 + 0.6, 1.8, TEXT_FONT, '700'); x += tw + 0.5; glyph(gg, GL.quarterUp, x, H / 2 + 0.6, 2.6); text(gg, '= ' + b, x + 1.2, H / 2 + 0.6, 1.8);
      }, { w: 120 }));
    }
    const g3 = grid('three');
    g3.append(mbtn('Mark', 'Rehearsal mark', !!C.score.measures[m].rehearsal, () => {
      edit(() => { const used = C.score.measures.filter((x) => x.rehearsal).length; const ms = C.score.measures[m]; ms.rehearsal = ms.rehearsal ? null : String.fromCharCode(65 + (used % 26)); }, { keepSel: true });
    }, { draw: (gg, W, H) => { gg.lineWidth = 0.13; gg.strokeRect(W / 2 - 1.1, H / 2 - 1.3, 2.2, 2.4); text(gg, 'A', W / 2 - 0.65, H / 2 + 0.75, 1.9, TEXT_FONT, '700'); }, small: 'rehearsal' }));
    g3.append(mbtn('No text', 'Remove the words', false, () => setText(null), { textCls: '', small: 'remove' }));
  } else if (C.tab === 'clef') {
    const sel0 = evs[0];
    const st = C.selBars ? C.selBars.st : sel0 ? sel0.st : M.allStaves(C.score)[0];
    // where the change starts: the selected bar (or bar 1); a selection of several bars can have it
    // only for those bars
    const range = C.selBars && C.selBars.to > C.selBars.from ? [C.selBars.from, C.selBars.to] : null;
    if (C.sigFor !== (C.selBars ? `${C.selBars.from}-${C.selBars.to}` : sel0 ? 'e' + sel0.m : '')) { C.sigFor = C.selBars ? `${C.selBars.from}-${C.selBars.to}` : sel0 ? 'e' + sel0.m : ''; C.sigBar = targetBar() ?? 0; C.sigOnly = false; }
    const m = Math.min(C.score.measures.length - 1, C.sigBar ?? 0);
    const step = el('div', 'cp-row cp-sigbar');
    const minus = el('button', 'btn small', '−'), plus = el('button', 'btn small', '+');
    const lbl = el('span', 'cp-sigtext', C.sigOnly && range ? `Bars ${range[0] + 1}–${range[1] + 1} only` : `From bar ${m + 1}`);
    minus.addEventListener('click', () => { C.sigOnly = false; C.sigBar = Math.max(0, m - 1); renderTab(); });
    plus.addEventListener('click', () => { C.sigOnly = false; C.sigBar = Math.min(C.score.measures.length - 1, m + 1); renderTab(); });
    minus.setAttribute('aria-label', 'Earlier bar'); plus.setAttribute('aria-label', 'Later bar');
    step.append(minus, lbl, plus); body.append(step);
    if (range) {
      const seg = el('div', 'seg full');
      for (const [v, t] of [[false, 'From here on'], [true, `Only bars ${range[0] + 1}–${range[1] + 1}`]]) { const b = el('button', C.sigOnly === v ? 'on' : '', t); b.addEventListener('click', () => { C.sigOnly = v; if (v) C.sigBar = range[0]; renderTab(); }); seg.append(b); }
      body.append(seg);
    }
    if (!C.selBars && !sel0) body.append(el('p', 'hint', 'Tap a bar (Select mode) to make the change start there, in the middle of a line.'));
    lab('Clef');
    const cg = cards('three');
    for (const [c, name] of [['treble', 'Treble'], ['bass', 'Bass'], ['alto', 'Alto'], ['tenor', 'Tenor'], ['treble8', 'Treble 8vb'], ['bass8', 'Bass 8vb'], ['treble8va', 'Treble 8va'], ['bass8va', 'Bass 8va'], ['soprano', 'Soprano'], ['mezzo', 'Mezzo'], ['baritoneC', 'Baritone C'], ['baritoneF', 'Baritone F'], ['frenchviolin', 'French violin'], ['perc', 'Percussion']]) {
      if (!M.CLEFS[c]) continue;
      cg.append(card(name, M.clefAt(st, m) === c, () => applySig('clef', c, st, m, C.sigOnly && range ? range[1] : null), (gg, W, H) => { const y = H / 2 - 2; staff5(gg, 1, W - 1, y); drawClef(gg, c, W / 2 - 1.3, y); }, { k: 5.2 }));
    }
    lab('Key');
    const k = M.keyAt(C.score, m);
    const kg = cards('three');
    const KEYS = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
    const MINOR = ['a♭', 'e♭', 'b♭', 'f', 'c', 'g', 'd', 'a', 'e', 'b', 'f♯', 'c♯', 'g♯', 'd♯', 'a♯'];
    for (let f = -7; f <= 7; f++) kg.append(card(`${KEYS[f + 7]} / ${MINOR[f + 7]}`, k === f, () => applySig('key', f, st, m, C.sigOnly && range ? range[1] : null), (gg, W, H) => { const y = H / 2 - 2; staff5(gg, 1, W - 1, y); drawClef(gg, 'treble', 1.4, y, 3.4); drawKey(gg, f, 'treble', 4.6, y); }, { k: 5.2 }));
    lab('Time');
    const g3 = grid('four');
    const curT = M.timeAt(C.score, m);
    for (const [n, d, sym] of [[2, 4], [3, 4], [4, 4], [4, 4, 'common'], [2, 2], [2, 2, 'cut'], [3, 8], [6, 8], [9, 8], [12, 8], [5, 4], [7, 8]]) {
      const on = curT[0] === n && curT[1] === d && (C.score.measures[m].timeSym || null) === (sym || null);
      g3.append(mbtn('', sym || `${n}/${d}`, on, () => applySig('time', { t: [n, d], sym }, st, m, C.sigOnly && range ? range[1] : null), { draw: (gg, W, H) => { const y = H / 2 - 2; drawTime(gg, [n, d], W / 2 - (n >= 10 ? 1.6 : 0.85), y, sym); }, k: 4.4, h: 40 }));
    }
    // ---- transpose: the selected notes, the selected bars, or the whole score (with its key)
    const scope = selEvents().length ? 'the selected notes' : C.selBars ? `bars ${C.selBars.from + 1}–${C.selBars.to + 1}` : 'the whole score';
    lab('Transpose ' + scope);
    // one clear row per interval: its name, then up and down
    const list = el('div', 'tp-list');
    for (const [name, sym, st2, se] of [['Semitone', '½', 1, 1], ['Tone', '1', 1, 2], ['Minor third', 'm3', 2, 3], ['Major third', 'M3', 2, 4], ['Perfect fourth', '4', 3, 5], ['Tritone', 'TT', 3, 6], ['Perfect fifth', '5', 4, 7], ['Minor sixth', 'm6', 5, 8], ['Major sixth', 'M6', 5, 9], ['Minor seventh', 'm7', 6, 10], ['Major seventh', 'M7', 6, 11], ['Octave', '8', 7, 12]]) {
      const row = el('div', 'tp-row');
      row.append(el('span', 'tp-sym', sym), el('span', 'tp-name', name));
      for (const [d, arrow] of [[1, '▲'], [-1, '▼']]) {
        const b = el('button', 'tp-go', arrow); b.title = `Transpose ${d > 0 ? 'up' : 'down'} ${name === 'Octave' ? 'an' : 'a'} ${name.toLowerCase()}`; b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => transpose(st2 * d, se * d));
        row.append(b);
      }
      list.append(row);
    }
    body.append(list);
    const kr = el('div', 'cp-row');
    const ksel = el('select', 'cp-select');
    const KEYN = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
    const kNow = M.keyAt(C.score, C.selBars ? C.selBars.from : (selEvents()[0] || { m: 0 }).m);
    ksel.append(el('option', '', 'To the key of…'));
    for (let f = -7; f <= 7; f++) { const o = el('option', '', `${KEYN[f + 7]} major / ${MINOR[f + 7]} minor`); o.value = f; if (f === kNow) o.textContent += ' (now)'; ksel.append(o); }
    ksel.addEventListener('change', () => { if (ksel.value === '' || isNaN(+ksel.value)) return; transposeToKey(kNow, +ksel.value); });
    kr.append(ksel); body.append(kr);
    body.append(el('p', 'hint', 'Notes keep their spelling in the new key. The whole score, or bars of every instrument, take the new key signature too, and the music after them goes back to its own key. Transposing instruments (clarinet, horn…) stay correct.'));
  } else if (C.tab === 'bars') {
    const m = targetBar();
    const g = grid('three');
    g.append(mbtn('+1', 'Add a bar at the end', false, () => edit(() => M.addBars(C.score, 1)), { textCls: '', small: 'at the end' }));
    g.append(mbtn('Before', 'Insert a bar before the selection', false, () => { if (m === null) { hint('Select a bar first.'); return; } insertBars(1, false); }, { textCls: '', small: 'insert bar' }));
    g.append(mbtn('After', 'Insert a bar after the selection', false, () => { if (m === null) { hint('Select a bar first.'); return; } insertBars(1, true); }, { textCls: '', small: 'insert bar' }));
    lab('Barline at the end of bar ' + (m === null ? '…' : m + 1));
    const cg = cards('three');
    const setBar = (type) => { if (m === null) { hint('Select a bar first.'); return; } edit(() => { const ms = C.score.measures[m]; if (type === 'start') ms.start = ms.start === 'repeat' ? undefined : 'repeat'; else ms.bar = ms.bar === type ? undefined : type; }, { keepSel: true }); };
    const ms = m === null ? {} : C.score.measures[m];
    const bl = (type) => (gg, W, H) => { const y = H / 2 - 2; const sts = [{ y, pi: 0, inst: { fam: 'x' } }]; staff5(gg, 1, W - 1, y); if (type === 'start') drawRepeatStart(gg, W / 2 - 0.6, sts); else drawBarline(gg, type, W / 2 + 0.6, sts); };
    cg.append(card('Normal', !ms.bar, () => setBar('single'), bl('single'), { k: 5.2 }));
    cg.append(card('Double', ms.bar === 'double', () => setBar('double'), bl('double'), { k: 5.2 }));
    cg.append(card('Final', ms.bar === 'final', () => setBar('final'), bl('final'), { k: 5.2 }));
    cg.append(card('Start repeat', ms.start === 'repeat', () => setBar('start'), bl('start'), { k: 5.2 }));
    cg.append(card('End repeat', ms.bar === 'repeat', () => setBar('repeat'), bl('repeat'), { k: 5.2 }));
    lab('First and second endings');
    const eg = cards('three');
    const voltaHere = m === null ? null : (C.score.spans || []).find((q) => q.kind === 'volta' && m >= q.a.m && m <= q.b.m);
    const endIcon = (n, closed) => (gg, W, H) => { gg.lineWidth = 0.12; gg.beginPath(); gg.moveTo(W * 0.1, H * 0.85); gg.lineTo(W * 0.1, H * 0.25); gg.lineTo(W * 0.9, H * 0.25); if (closed) gg.lineTo(W * 0.9, H * 0.85); gg.stroke(); text(gg, n + '.', W * 0.1 + 0.4, H * 0.25 + 1.6, 1.6); };
    eg.append(card('1st ending', !!voltaHere && (voltaHere.n || 1) === 1, () => addEnding(1), endIcon(1, true), { k: 6.6 }));
    eg.append(card('2nd ending', !!voltaHere && voltaHere.n === 2, () => addEnding(2), endIcon(2, false), { k: 6.6 }));
    eg.append(card('3rd ending', !!voltaHere && voltaHere.n === 3, () => addEnding(3), endIcon(3, false), { k: 6.6 }));
    body.append(el('p', 'hint', 'Select the bar (or bars) of the ending, then choose it. A 1st ending gets its repeat barline by itself.'));
    const g3 = grid('three');
    g3.append(mbtn('Delete', 'Delete the selected bars', false, deleteBars, { textCls: '', small: 'bars' }));
    g3.append(mbtn('Clear', 'Empty the selected bars', false, clearBars, { textCls: '', small: 'bars' }));
    g3.append(mbtn('Copy', 'Copy', false, copySel, { textCls: '' }));
    body.append(el('p', 'hint', 'In Select mode, tap a bar; drag across bars and staves to select more.'));
  }
}
function wirePalette() {
  // drag the palette by its head
  const head = $('#cpPalHead'), pal = $('#cpPal');
  let d = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    try { head.setPointerCapture(e.pointerId); } catch {} d = { dx: e.clientX - pal.offsetLeft, dy: e.clientY - pal.offsetTop };
  });
  head.addEventListener('pointermove', (e) => { if (!d) return; placePalette(e.clientX - d.dx, e.clientY - d.dy); });
  head.addEventListener('pointerup', () => {
    if (!d) return; d = null; setSetting('composeUI', uiState());
    // the page makes room on whichever side the palette now sits
    if ($('#compose').classList.contains('cp-wide') && $('#compose').classList.contains('pal-right') !== (C.palAnchor && C.palAnchor.side === 'right')) relayout();
  });
  $('#cpPalFold').addEventListener('click', () => { pal.classList.toggle('folded'); setSetting('composeUI', uiState()); relayout(); });
  $$('#cpMode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
}
// The palette remembers which side of the screen it sits on, so turning the iPad keeps it in view
// on the same side instead of leaving it off the edge.
function placePalette(x, y, remember = true) {
  const pal = $('#cpPal');
  const W = window.innerWidth, H = window.innerHeight, w = pal.offsetWidth || 300, h = pal.offsetHeight || 60;
  const nx = clamp(x, 6, Math.max(6, W - w - 6)), ny = clamp(y, 60, Math.max(60, H - Math.min(h, H * 0.5) - 6));
  pal.style.left = nx + 'px'; pal.style.top = ny + 'px';
  if (remember) C.palAnchor = { side: nx + w / 2 > W / 2 ? 'right' : 'left', gap: nx + w / 2 > W / 2 ? W - (nx + w) : nx, yf: ny / H };
}
function keepPaletteInView() {
  const pal = $('#cpPal'); if (!pal || !pal.offsetWidth) return;
  const a = C.palAnchor, W = window.innerWidth, H = window.innerHeight, w = pal.offsetWidth;
  if (!a) { placePalette(pal.offsetLeft, pal.offsetTop, false); return; }
  placePalette(a.side === 'right' ? W - w - a.gap : a.gap, a.yf * H, false);
}
function setMode(mode) {
  C.mode = mode;
  $$('#cpMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#compose').classList.toggle('writing', mode === 'write');
  $('#compose').classList.toggle('selecting', mode === 'select');
  C.hover = null; drawHover();
  if (mode === 'select') hint('Tap a note or a bar to select it. Swipe to move around; hold your finger still a moment, then drag, to select several bars or notes (the Pencil drags straight away).', 5200);
}
let hintT;
function hint(msg, ms = 3200) { const h = $('#cpHint'); h.textContent = msg; h.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => { h.hidden = true; }, ms); }

// =====================================================================
// Top bar
// =====================================================================
function wireTop() {
  $('#cpBack').addEventListener('click', closeCompose);
  $('#cpUndo').addEventListener('click', undo);
  $('#cpRedo').addEventListener('click', redo);
  $('#cpPalUndo').addEventListener('click', (e) => { e.stopPropagation(); undo(); });
  $('#cpPalRedo').addEventListener('click', (e) => { e.stopPropagation(); redo(); });
  $('#cpPlay').addEventListener('click', () => togglePlay());
  $('#cpZoomIn').addEventListener('click', () => setZoom(C.zoom * 1.2));
  $('#cpZoomOut').addEventListener('click', () => setZoom(C.zoom / 1.2));
  $('#cpTitle').addEventListener('click', () => D.showPanel('cplayout'));
  player.onTick = ({ mark }) => { if (mark) showPlayhead(mark); };
  player.onEnd = () => { syncPlay(); C.pages.forEach(clearOver); };
}
async function togglePlay(from) {
  if (player.playing || player.loading) { player.stop(); syncPlay(); C.pages.forEach(clearOver); return; }
  unlock();
  const start = from ?? targetBar() ?? 0;
  $('#cpPlay').classList.add('on'); $('#cpPlay').querySelector('span').textContent = 'Loading';
  await player.play(C.score, { from: start });
  syncPlay();
}
function syncPlay() {
  const on = player.playing;
  const b = $('#cpPlay'); b.classList.toggle('on', on);
  b.innerHTML = on ? '<svg><use href="#i-stop"/></svg><span>Stop</span>' : '<svg><use href="#i-play"/></svg><span>Play</span>';
}
let lastMark = null;
function showPlayhead(mark) {
  if (lastMark && lastMark.m === mark.m && lastMark.pos === mark.pos) return;
  lastMark = mark;
  C.pages.forEach(clearOver);
  for (let i = 0; i < C.hits.length; i++) {
    const h = C.hits[i]; if (!h) continue;
    const staves = h.staves.filter((s) => s.measures.some((mm) => mm.m === mark.m || (mm.end !== undefined && mark.m >= mm.m && mark.m <= mm.end)));
    if (!staves.length) continue;
    const mm = staves[0].measures.find((q) => q.m === mark.m) || staves[0].measures.find((q) => mark.m >= q.m && mark.m <= (q.end ?? q.m));
    const x = mm.onsets ? xAtTime(mm, mark.pos) : mm.x0;
    const g = overCtx(i);
    g.save(); g.fillStyle = 'rgba(30,142,85,0.18)'; g.fillRect(x - 0.6, staves[0].y - 2, 2.6, staves[staves.length - 1].y + 6 - staves[0].y);
    g.fillStyle = 'rgba(30,142,85,0.9)'; g.fillRect(x - 0.1, staves[0].y - 2, 0.25, staves[staves.length - 1].y + 6 - staves[0].y); g.restore();
    // keep the playing line on screen
    const sc = $('#cpScroll'), pr = C.pages[i].pg.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    const yTop = pr.top + staves[0].y * C.pages[i].k, yBot = pr.top + (staves[staves.length - 1].y + 6) * C.pages[i].k;
    if (yTop < sr.top + 80 || yBot > sr.bottom - 40) sc.scrollBy({ top: yTop - sr.top - 110, behavior: 'smooth' });
    break;
  }
}

// =====================================================================
// Keyboard (a hardware keyboard on the iPad)
// =====================================================================
// ---------- a MIDI keyboard (USB or Bluetooth), where the system lets the page use it ----------
// Select a note or rest to start; each key played writes the chosen note value there and moves on.
// Keys pressed together make a chord.
const MIDI_IN = { chord: [], t: 0, timer: 0, access: null };
function midiStep(notes) {
  if ($('#compose').hidden || !C.score) return;
  const f = selEvents()[0];
  if (!f) { hint('Select the note or rest to start from, then play.', 2200); return; }
  const key = M.keyAt(C.score, f.m);
  let newId = null;
  edit(() => {
    const ev = { id: M.newId(), t: C.tool.dur, dots: C.tool.dots, notes: [...new Set(notes)].sort((a, b) => a - b).map((m) => { const sp = M.spell(m, key); return { s: sp.s, a: sp.a }; }) };
    for (const k2 of KEEP_MARKS) if (f.ev[k2] !== undefined && f.ev[k2] !== null && !(k2 === 'art' && f.ev.rest)) ev[k2] = M.clone(f.ev[k2]);
    M.writeEvent(C.score, f.st, f.m, f.pos, ev);
    // the next place: right after what was just written
    const g = M.findEvent(C.score, ev.id); if (!g) return;
    const nx = M.nextEvent(C.score, g.st, g.m, g.i);
    newId = nx ? nx.ev.id : ev.id;
  });
  if (newId) { C.sel.clear(); C.sel.add(newId); relayout(); syncSelBar(); }
}
async function wireMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    const acc = await navigator.requestMIDIAccess(); MIDI_IN.access = acc;
    const hook = () => { for (const inp of acc.inputs.values()) inp.onmidimessage = (e) => {
      const [st, note, vel] = e.data; const cmd = st & 0xf0;
      if (cmd === 0x90 && vel > 0) {
        try { unlock(); const f = selEvents()[0]; sampler.preview(f ? soundOf(f.part) : 'piano', note, Math.min(1, vel / 110), 0.5); } catch {}
        MIDI_IN.chord.push(note); clearTimeout(MIDI_IN.timer);
        MIDI_IN.timer = setTimeout(() => { const ns = MIDI_IN.chord; MIDI_IN.chord = []; midiStep(ns); }, 70);
      }
    }; };
    hook(); acc.onstatechange = hook;
  } catch { /* no MIDI here */ }
}
function wireKeys() {
  wireMidi();
  document.addEventListener('keydown', (e) => {
    if ($('#compose').hidden || e.target.matches('input, select, textarea')) return;
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'c') { e.preventDefault(); copySel(); return; }
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'v') { e.preventDefault(); pasteClip(C.clip); return; }
    if (k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); deleteSel(); return; }
    if (k === 'Escape') { clearSel(); return; }
    if ((k === 'ArrowRight' || k === 'ArrowLeft') && C.sel.size) {
      e.preventDefault();
      const evs = selEvents(); const f = k === 'ArrowRight' ? evs[evs.length - 1] : evs[0];
      const nx = k === 'ArrowRight' ? M.nextEvent(C.score, f.st, f.m, f.i) : M.prevEvent(C.score, f.st, f.m, f.i);
      if (!nx) return;
      if (e.shiftKey) C.sel.add(nx.ev.id); else { C.sel.clear(); C.sel.add(nx.ev.id); }
      relayout(); syncSelBar(); renderTab(); return;
    }
    // arrows: a semitone; with ⌘ an octave; with ⇧ a step of the scale
    if (k === 'ArrowUp') { e.preventDefault(); if (e.metaKey || e.ctrlKey) moveNotes(7); else if (e.shiftKey) moveNotes(1); else moveSemis(1); return; }
    if (k === 'ArrowDown') { e.preventDefault(); if (e.metaKey || e.ctrlKey) moveNotes(-7); else if (e.shiftKey) moveNotes(-1); else moveSemis(-1); return; }
    const durKey = { 1: 64, 2: 32, 3: 16, 4: 8, 5: 4, 6: 2, 7: 1 }[k];   // the Sibelius keypad
    if (durKey && durKey <= 32) { setDuration(durKey); return; }
    if (k === '.') { C.tool.dots = C.tool.dots ? 0 : 1; setDuration(C.tool.dur); return; }
    // letters write after the selected note
    const L = 'cdefgab'.indexOf(k.toLowerCase());
    if (L >= 0 && !e.metaKey && !e.ctrlKey) {
      const f = selEvents().pop(); if (!f) return;
      const time = M.timeAt(C.score, f.m);
      let m = f.m, pos = f.pos + M.ticksOf(f.ev, time);
      if (pos >= M.barTicks(time)) { m++; pos = 0; if (m >= C.score.measures.length) edit(() => M.addBars(C.score, 1)); }
      const ref = f.ev.notes && f.ev.notes.length ? f.ev.notes[0].s : M.CLEFS[M.clefAt(f.st, f.m)].bottom + 4;
      // the nearest letter to the previous note
      let s = Math.floor(ref / 7) * 7 + L; if (s - ref > 3) s -= 7; if (ref - s > 3) s += 7;
      const n = { s, a: M.keyAlter(M.keyAt(C.score, m), s) };
      let id = null;
      edit(() => { const ev = { id: M.newId(), t: C.tool.dur, dots: C.tool.dots, notes: [n] }; M.writeEvent(C.score, f.st, m, pos, ev); id = ev.id; });
      C.sel.clear(); C.sel.add(id); relayout(); syncSelBar();
      unlock(); sampler.preview(soundOf(f.part), M.midiOf(n.s, n.a), 0.6, 0.4, f.part.mix || undefined);
    }
  });
}

// =====================================================================
// Panels: new score, instruments, sound, layout, export, capture
// =====================================================================
const NEW = { insts: ['piano'], ens: 'piano' };
const KEY_NAMES = ['C♭ major / A♭ minor', 'G♭ major / E♭ minor', 'D♭ major / B♭ minor', 'A♭ major / F minor', 'E♭ major / C minor', 'B♭ major / G minor', 'F major / D minor', 'C major / A minor', 'G major / E minor', 'D major / B minor', 'A major / F♯ minor', 'E major / C♯ minor', 'B major / G♯ minor', 'F♯ major / D♯ minor', 'C♯ major / A♯ minor'];
const TIMES = [['4/4', [4, 4]], ['3/4', [3, 4]], ['2/4', [2, 4]], ['2/2', [2, 2]], ['6/8', [6, 8]], ['3/8', [3, 8]], ['9/8', [9, 8]], ['12/8', [12, 8]], ['5/4', [5, 4]], ['7/8', [7, 8]], ['5/8', [5, 8]]];
function wirePanels() {
  // ---- new score
  const keySel = $('#cnKey'); KEY_NAMES.forEach((n, i) => { const o = el('option', '', n); o.value = i - 7; keySel.append(o); }); keySel.value = 0;
  // the key of the music read, and the key to put it in: always the major and its relative minor
  const keyLabel = (i) => KEY_NAMES[i].replace(' / ', ' · ');
  const capKey = $('#capKey'); KEY_NAMES.forEach((n, i) => { const o = el('option', '', keyLabel(i)); o.value = i - 7; capKey.append(o); }); capKey.value = 0;
  const capTo = $('#capTo'); KEY_NAMES.forEach((n, i) => { const o = el('option', '', keyLabel(i)); o.value = i - 7; capTo.append(o); }); capTo.value = '';
  syncCapTo();
  const timeSel = $('#cnTime'); TIMES.forEach(([n]) => { const o = el('option', '', n); o.value = n; timeSel.append(o); });
  const staffSel = $('#cnStaff'); staffSel.append(Object.assign(el('option', '', 'Automatic'), { value: '' }));
  STAFF_SIZES.forEach((s) => { const o = el('option', '', `${s.mm} mm · ${s.use}`); o.value = s.mm; staffSel.append(o); });
  // categories on the left, pages of each ensemble in the middle, the chosen one large on the right
  const cats = $('#nsCats');
  const order = ['Solo', 'Duos', 'Chamber', 'Voices', 'Orchestra', 'Band', 'Custom'];
  for (const g of order) {
    const b = el('button', '', g === 'Custom' ? 'Your own' : g); b.dataset.cat = g;
    b.addEventListener('click', () => { NEW.cat = g; renderGallery(); });
    cats.append(b);
  }
  $('#cnOpenGallery').addEventListener('click', () => openNewScore());
  // closing the instrument list while choosing for a new score goes back to the new score
  $('#panel-cpinst [data-close]').addEventListener('click', () => { if (C.addFor === 'new') { $('#newScore').hidden = false; renderNew(); } });
  $('#nsCancel').addEventListener('click', () => { $('#newScore').hidden = true; });
  for (const id of ['#cnKey', '#cnTime', '#cnTitle', '#cnComposer', '#cnBars', '#cnPage', '#cnStaff']) $(id).addEventListener(id === '#cnTitle' || id === '#cnComposer' || id === '#cnBars' ? 'input' : 'change', () => previewSoon());
  $('#cnAddInst').addEventListener('click', () => { $('#newScore').hidden = true; NEW.reopen = true; D.showPanel('cpinst'); C.addFor = 'new'; renderInstPanel(); });
  $('#cnCreate').addEventListener('click', async () => {
    if (!NEW.insts.length) { D.toast('Choose at least one instrument.'); return; }
    const t = TIMES.find(([n]) => n === $('#cnTime').value)[1];
    const nStaves = NEW.insts.reduce((a, i) => a + INST[i].clefs.length, 0);
    const opts = { title: $('#cnTitle').value.trim() || 'Untitled', composer: $('#cnComposer').value.trim(), insts: NEW.insts, time: t, key: +$('#cnKey').value,
      bpm: clamp(+$('#cnTempo').value || 96, 20, 300), bars: clamp(+$('#cnBars').value || NEW.fill || 32, 1, 999), page: $('#cnPage').value };
    D.hidePanel(); $('#newScore').hidden = true;
    await createComposition(opts);
    if ($('#cnStaff').value) { C.score.layout.staffMm = +$('#cnStaff').value; relayout(); } else C.score.layout.staffMm = defaultStaffSize(nStaves);
    if (t[0] === 4 && t[1] === 4) C.score.measures[0].timeSym = undefined;
    relayout(); saveSoon(true);
    $('#cnTitle').value = ''; $('#cnComposer').value = '';
  });
  $('#cnImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const score = await readMusicFile(f);
      const fileId = uid(), id = uid();
      await db.put('files', { id: fileId, kind: 'comp', data: score });
      await db.put('scores', { id, fileId, kind: 'comp', title: score.title, composer: score.composer, pages: 1, added: Date.now(), opened: Date.now(), lastPage: 0, seconds: 0, thumb: null });
      D.hidePanel(); await openComposition(id); saveSoon(true);
      D.toast(`Opened ${score.parts.length} ${score.parts.length === 1 ? 'part' : 'parts'}, ${score.measures.length} bars.`);
    } catch (err) { console.error(err); D.toast(err.message || 'That file could not be read.', 4000); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-panel]'); if (!b) return;
    const p = b.dataset.panel;
    if (p === 'compose') renderList();
    if (p === 'cpinst') { C.addFor = 'score'; renderInstPanel(); }
    if (p === 'cpmix') renderMixer();
    if (p === 'cplayout') renderLayout();
    if (p === 'cpexport') renderExport();
    if (p === 'cpcapture') { /* fresh each time */ }
  });
  // ---- layout
  $('#lyTitle').addEventListener('change', (e) => edit(() => { C.score.title = e.target.value.trim() || 'Untitled'; $('#cpTitle').textContent = C.score.title; }, { keepSel: true }));
  $('#lySubtitle').addEventListener('change', (e) => edit(() => { C.score.subtitle = e.target.value.trim(); }, { keepSel: true }));
  $('#lyComposer').addEventListener('change', (e) => edit(() => { C.score.composer = e.target.value.trim(); }, { keepSel: true }));
  $('#lyPage').addEventListener('change', (e) => edit(() => { C.score.layout.page = e.target.value; }, { keepSel: true }));
  $('#lyOrient').addEventListener('change', (e) => edit(() => { C.score.layout.landscape = e.target.value === '1'; }, { keepSel: true }));
  $('#lyConcert').addEventListener('change', (e) => edit(() => { C.score.layout.concert = e.target.checked; }, { keepSel: true }));
  $('#lyHide').addEventListener('change', (e) => edit(() => { C.score.layout.hideEmpty = e.target.checked; }, { keepSel: true }));
  $('#lyAdd4').addEventListener('click', () => edit(() => M.addBars(C.score, 4)));
  $('#lyAdd16').addEventListener('click', () => edit(() => M.addBars(C.score, 16)));
  // ---- sound
  for (const [k, v] of Object.entries(ROOM_LABELS)) {
    const b = el('button', '', v.replace('Concert hall', 'Hall').replace('Chamber hall', 'Chamber')); b.dataset.room = k;
    b.addEventListener('click', () => { C.score.sound.room = k; sampler.setRoom(k); renderMixer(); saveSoon(); });
    $('#mxRoom').append(b);
  }
  $('#mxRoomMix').addEventListener('input', (e) => { C.score.sound.roomMix = +e.target.value / 100; sampler.live().setRoomMix(C.score.sound.roomMix); $('#mxRoomVal').textContent = e.target.value + '%'; saveSoon(); });
  $('#mxTuning').addEventListener('change', (e) => { C.score.sound.tuning = +e.target.value; sampler.tuning = C.score.sound.tuning; saveSoon(); });
  $$('#mxStyle button').forEach((b) => b.addEventListener('click', () => { C.score.sound.style = b.dataset.style; C.score.sound.human = b.dataset.style !== 'straight'; renderMixer(); saveSoon(); }));
  $('#mxAdvBtn').addEventListener('click', () => { C.mixAdv = !C.mixAdv; renderMixer(); });
  // ---- export
  $('#exScorePdf').addEventListener('click', () => exportPdf());
  $('#exPartsPdf').addEventListener('click', () => exportPdf('all'));
  $('#exConcertPdf').addEventListener('click', () => exportPdf(undefined, { concert: true }));
  $('#exMxl').addEventListener('click', async () => { D.hidePanel(); D.shareBlob(await toMXL(C.score), fileName('.mxl')); });
  $('#exMxlParts').addEventListener('click', async () => {
    D.hidePanel(); D.toast('Making the parts…', 20000);
    try { const z = await toPartsZip(C.score, C.score.title || 'Score'); $('#toast').hidden = true; D.shareBlob(z, fileName('.zip', ' (MusicXML parts)')); }
    catch (err) { console.error(err); D.toast('The parts could not be made.'); }
  });
  $('#exXml').addEventListener('click', () => { D.hidePanel(); D.shareBlob(new Blob([toMusicXML(C.score)], { type: 'application/vnd.recordare.musicxml+xml' }), fileName('.musicxml')); });
  $('#exWav').addEventListener('click', async () => {
    D.hidePanel(); D.toast('Recording the score…', 120000);
    try { const blob = await renderAudio(C.score, (f) => { $('#toast').textContent = `Recording the score… ${Math.round(f * 100)}%`; }); $('#toast').hidden = true; D.shareBlob(blob, fileName('.wav')); }
    catch (err) { console.error(err); D.toast('The audio could not be made.'); }
  });
  $('#exToLib').addEventListener('click', async () => {
    D.hidePanel(); D.toast('Making the PDF…', 60000);
    const blob = await makePdf();
    await D.addPdfToLibrary(await blob.arrayBuffer(), fileName('.pdf'), { title: C.score.title, composer: C.score.composer });
    D.toast('On your stand now, in My scores.', 3000);
  });
  // ---- capture
  $('#capLib').addEventListener('click', () => startCapture('library'));
  $('#capPhoto').addEventListener('click', () => $('#capFile').click());
  $('#capFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) startCapture('file', f); });
  $('#capPaste').addEventListener('click', () => {
    if (!C.capture) return; const clip = captureClip(); C.clip = clip;
    const st = M.allStaves(C.score).find((x) => x.id === $('#capInto').value) || C.score.parts[0].staves[0];
    const m = clamp((+$('#capBar').value || 1) - 1, 0, C.score.measures.length);
    D.hidePanel();
    if ($('#capSig').checked) pasteCapture(st, m);
    else {
      // an empty score takes the key of the music
      const empty = M.allStaves(C.score).every((x) => x.bars.every((b) => b.every((e) => e.rest)));
      if (empty && m === 0 && C.score.measures[0].key !== capOutKey()) edit(() => { C.score.measures[0].key = capOutKey(); });
      pasteClip(clip, { st, m, pos: 0 });
    }
    C.sel.clear(); C.selBars = { st, stId: st.id, from: m, to: Math.min(C.score.measures.length - 1, m + Math.max(0, captureBars() - 1)), staffK: 0 };
    relayout(); syncSelBar();
  });
  $('#capInto').addEventListener('change', () => { $('#capBar').value = nextFreeBar($('#capInto').value) + 1; });
  $('#capStaff').addEventListener('change', async () => {
    if (!C.captureCanvas) return;
    $('#capInfo').textContent = 'Reading…';
    const res = await D.recognise(C.captureCanvas, { staff: +$('#capStaff').value });
    if (res && res.notes.length) { C.capture = { ...res, clef: res.clef || 'treble', clef0: res.clef || 'treble', key: res.key || 0 }; showCaptureSig(); readTextBoxes(res, C.captureCanvas).then((answers) => { if (C.capture && C.capture.bars === res.bars) { placeCaptureTexts(C.capture, answers); drawCapture(); } }); }
    drawCapture();
  });
  $('#capCopy').addEventListener('click', () => { if (!C.capture) return; C.clip = captureClip(); setSetting('composeClip', C.clip); D.toast('Copied. Select a bar and tap Paste.', 2500); });
  $('#capClef').addEventListener('change', () => { if (C.capture) { C.capture.clef = $('#capClef').value; drawCapture(); } });
  $('#capKey').addEventListener('change', () => { syncCapTo(); if (C.capture) { C.capture.key = +$('#capKey').value; drawCapture(); } });
  $('#capTo').addEventListener('change', () => { if (C.capture) drawCapture(); });
  $('#capTime').addEventListener('change', () => { if (C.capture) { C.capture.time = $('#capTime').value.split('/').map(Number); drawCapture(); } });
}
function renderNew() {
  $$('#cnGroups button').forEach((b) => b.classList.toggle('on', b.dataset.ens === NEW.ens));
  const box = $('#cnChosen'); box.textContent = '';
  NEW.insts.forEach((id, i) => {
    const s = el('span', '', INST[id].name);
    const x = el('button'); x.append(icon('i-close')); x.setAttribute('aria-label', 'Remove ' + INST[id].name);
    x.addEventListener('click', () => { NEW.insts.splice(i, 1); NEW.ens = null; renderNew(); });
    s.append(x); box.append(s);
  });
  const n = NEW.insts.reduce((a, i) => a + INST[i].clefs.length, 0);
  $('#cnCount').textContent = NEW.insts.length ? `${NEW.insts.length} ${NEW.insts.length === 1 ? 'instrument' : 'instruments'} · ${n} ${n === 1 ? 'staff' : 'staves'}` : 'No instruments yet';
  $$('#cnGroups .ns-card').forEach((b) => b.classList.toggle('on', b.dataset.ens === NEW.ens));
  previewSoon();
}
// ---- the new-score gallery
const ENS_CAT = (e) => e.group === 'Start' ? 'Custom' : e.group;
function openNewScore() {
  D.hidePanel();
  if (!NEW.cat) NEW.cat = 'Solo';
  $('#newScore').hidden = false;
  renderGallery(); renderNew();
}
// a score as it would be made now, with as many bars as fill the first page
function sampleScore(insts, { key = 0, time = [4, 4], title = '', composer = '', page = 'A4', staffMm = 0, bars = 0 } = {}) {
  const nStaves = insts.reduce((a, i) => a + INST[i].clefs.length, 0);
  const make = (n) => {
    const sc = M.newScore({ title: title || 'Untitled', composer, insts, time, key, bars: n, page });
    sc.layout.staffMm = staffMm || defaultStaffSize(nStaves);
    if (time[0] === 4 && time[1] === 4) sc.measures[0].timeSym = undefined;
    return sc;
  };
  if (bars) { const sc = make(bars); return { score: sc, lay: layoutScore(sc), bars }; }
  // lay out plenty of bars and count those that land on page one
  const big = make(120), lay = layoutScore(big);
  let n = 0; for (const sy of lay.pages[0].systems) for (const mm of sy.measures) n = Math.max(n, mm.end + 1);
  n = Math.max(1, n);
  const sc = make(n);
  return { score: sc, lay: layoutScore(sc), bars: n };
}
function paintSheet(c, lay, cssW) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssW * dpr), k = w / lay.W;
  c.width = w; c.height = Math.round(lay.H * k);
  const g = c.getContext('2d'); g.scale(k, k); drawPage(g, lay, 0);
}
const thumbs = new Map();
async function renderGallery() {
  $$('#nsCats button').forEach((b) => b.classList.toggle('on', b.dataset.cat === NEW.cat));
  const box = $('#cnGroups'); box.textContent = '';
  await loadMusicFont(); await document.fonts.load('100px Bravura').catch(() => {});
  const list = ENSEMBLES.filter((e) => ENS_CAT(e) === NEW.cat);
  const cards = [];
  for (const e of list) {
    const b = el('button', 'ns-card' + (e.insts.length ? '' : ' custom')); b.dataset.ens = e.id;
    const c = el('canvas');
    b.append(c, el('span', '', e.insts.length ? e.name : 'Choose instruments'));
    const n = e.insts.reduce((a, i) => a + INST[i].clefs.length, 0);
    b.append(el('small', '', e.insts.length ? (e.insts.length === 1 ? `${n} ${n === 1 ? 'staff' : 'staves'}` : `${e.insts.length} instruments`) : 'Start empty, add your own'));
    b.addEventListener('click', () => {
      NEW.ens = e.id; NEW.insts = e.insts.slice();
      renderNew();
      if (!e.insts.length) $('#cnAddInst').click();
    });
    box.append(b); cards.push([c, e]);
  }
  renderNew();
  // draw the little pages one at a time so the sheet opens at once
  for (const [c, e] of cards) {
    await new Promise((r) => requestAnimationFrame(r));
    if (!c.isConnected) return;
    if (!e.insts.length) { paintBlank(c); continue; }
    let t = thumbs.get(e.id);
    if (!t) { t = sampleScore(e.insts, { title: e.name }); thumbs.set(e.id, t); }
    paintSheet(c, t.lay, 170);
  }
}
function paintBlank(c) {
  c.width = 340; c.height = 481; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 340, 481);
  g.strokeStyle = '#c8ccd4'; g.lineWidth = 4; g.setLineDash([14, 10]); g.strokeRect(70, 140, 200, 200);
  g.setLineDash([]); g.lineWidth = 8; g.beginPath(); g.moveTo(170, 200); g.lineTo(170, 280); g.moveTo(130, 240); g.lineTo(210, 240); g.stroke();
}
let previewT = 0;
function previewSoon() { clearTimeout(previewT); previewT = setTimeout(previewNew, 120); }
function previewNew() {
  const c = $('#nsPreview'); if (!c || $('#newScore').hidden) return;
  if (!NEW.insts.length) { paintBlank(c); NEW.fill = 0; return; }
  const t = TIMES.find(([n]) => n === $('#cnTime').value);
  const s = sampleScore(NEW.insts, { key: +$('#cnKey').value, time: t ? t[1] : [4, 4], title: $('#cnTitle').value.trim(), composer: $('#cnComposer').value.trim(),
    page: $('#cnPage').value, staffMm: +$('#cnStaff').value || 0, bars: clamp(+$('#cnBars').value || 0, 0, 999) });
  NEW.fill = s.bars;
  paintSheet(c, s.lay, 300);
  $('#cnBars').placeholder = `${s.bars} (fills the page)`;
}
async function renderList() {
  const all = (await db.all('scores')).filter((s) => s.kind === 'comp').sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  const ul = $('#cnList'); ul.textContent = '';
  $('#cnEmpty').hidden = all.length > 0;
  for (const s of all) {
    const li = el('li'); const go = el('button', 'go', s.title || 'Untitled');
    go.addEventListener('click', () => openComposition(s.id));
    li.append(go, el('span', 'num', new Date(s.opened || s.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
    ul.append(li);
  }
}
let instFam = 'str';
function renderInstPanel() {
  const ul = $('#cpParts'); ul.textContent = '';
  const forNew = C.addFor === 'new';
  $('#cpParts').hidden = forNew;
  if (!forNew && C.score) {
    C.score.parts.forEach((p, i) => {
      const li = el('li');
      const name = el('input'); name.value = p.name; name.setAttribute('aria-label', 'Name');
      name.addEventListener('change', () => edit(() => { p.name = name.value.trim() || p.name; }, { keepSel: true }));
      const abbr = el('input'); abbr.value = p.abbr; abbr.style.maxWidth = '76px'; abbr.style.fontWeight = '500'; abbr.setAttribute('aria-label', 'Short name');
      abbr.addEventListener('change', () => edit(() => { p.abbr = abbr.value.trim() || p.abbr; }, { keepSel: true }));
      const upB = el('button', 'icon-btn small'); upB.append(document.createTextNode('↑')); upB.disabled = i === 0;
      upB.addEventListener('click', () => { edit(() => { const [x] = C.score.parts.splice(i, 1); C.score.parts.splice(i - 1, 0, x); }); renderInstPanel(); });
      const dnB = el('button', 'icon-btn small'); dnB.append(document.createTextNode('↓')); dnB.disabled = i === C.score.parts.length - 1;
      dnB.addEventListener('click', () => { edit(() => { const [x] = C.score.parts.splice(i, 1); C.score.parts.splice(i + 1, 0, x); }); renderInstPanel(); });
      const del = el('button', 'icon-btn small'); del.append(icon('i-trash')); del.setAttribute('aria-label', 'Remove ' + p.name);
      del.addEventListener('click', () => {
        if (C.score.parts.length <= 1) { D.toast('A score needs at least one instrument.'); return; }
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.style.color = 'var(--rec)'; D.toast('Tap again to remove ' + p.name + ' and its music.', 2500); return; }
        edit(() => M.removePart(C.score, p.id)); renderInstPanel();
      });
      li.append(name, abbr, upB, dnB, del); ul.append(li);
    });
  }
  const fams = $('#cpFams'); fams.textContent = '';
  for (const [k, label] of FAMILIES) {
    const b = el('button', k === instFam ? 'on' : '', label.replace('Harp and guitars', 'Guitars'));
    b.addEventListener('click', () => { instFam = k; renderInstPanel(); });
    fams.append(b);
  }
  const grid = $('#cpInstGrid'); grid.textContent = '';
  for (const inst of INSTRUMENTS.filter((i) => i.fam === instFam)) {
    const b = el('button'); b.append(el('span', '', inst.name), icon('i-plus'));
    b.addEventListener('click', () => {
      if (C.addFor === 'new') { NEW.insts.push(inst.id); NEW.ens = null; D.toast(inst.name + ' added.', 1200); D.hidePanel(); $('#newScore').hidden = false; renderNew(); return; }
      edit(() => M.addPart(C.score, inst.id));
      renderInstPanel(); D.toast(inst.name + ' added.', 1200);
    });
    grid.append(b);
  }
}
function renderMixer() {
  if (!C.score) return;
  const snd = C.score.sound = C.score.sound || { room: 'hall', roomMix: 1, tuning: 440 };
  $$('#mxRoom button').forEach((b) => b.classList.toggle('on', b.dataset.room === (snd.room || 'hall')));
  $('#mxRoomMix').value = Math.round((snd.roomMix ?? 1) * 100); $('#mxRoomVal').textContent = Math.round((snd.roomMix ?? 1) * 100) + '%';
  $('#mxTuning').value = String(snd.tuning || 440);
  $$('#mxStyle button').forEach((b) => b.classList.toggle('on', b.dataset.style === (snd.style || 'expressive')));
  $('#mxAdv').hidden = !C.mixAdv; $('#mxAdvBtn').textContent = C.mixAdv ? 'Fewer settings' : 'More settings';
  sampler.live(); applyScoreSound(sampler, C.score);
  const box = $('#cpMixer'); box.textContent = '';
  const anySolo = () => C.score.parts.some((p) => p.mix && p.mix.solo);
  for (const p of C.score.parts) {
    p.mix = p.mix || DEFAULT_MIX();
    const mix = p.mix;
    const ch = el('div', 'mx-ch');
    const top = el('div', 'mx-top'); top.append(el('strong', '', p.name));
    const sel = el('select'); sel.setAttribute('aria-label', 'Sound');
    for (const [k, v] of Object.entries(SOUND_LABELS)) { const o = el('option', '', v); o.value = k; sel.append(o); }
    sel.value = soundOf(p);
    sel.addEventListener('change', () => { p.sound = sel.value; applyScoreSound(sampler, C.score); saveSoon(); unlock(); sampler.preview(p.sound, 60, 0.6, 0.8, mix); });
    const applyOne = (q) => { const c = sampler.channels.get(q.id); if (c) sampler.applyMix(c, q.mix || DEFAULT_MIX(), anySolo()); };
    const apply = () => { applyOne(p); saveSoon(); };
    const mB = el('button', 'ms m' + (mix.mute ? ' on' : ''), 'M'); mB.setAttribute('aria-label', 'Mute');
    const sB = el('button', 'ms s' + (mix.solo ? ' on' : ''), 'S'); sB.setAttribute('aria-label', 'Solo');
    mB.addEventListener('click', () => { mix.mute = !mix.mute; mB.classList.toggle('on', mix.mute); apply(); });
    sB.addEventListener('click', () => { mix.solo = !mix.solo; sB.classList.toggle('on', mix.solo); for (const q of C.score.parts) applyOne(q); saveSoon(); });
    top.append(sel, mB, sB); ch.append(top);
    const row = (label, key, min, max, fmt, step = 1, toVal = (v) => v / 100, fromVal = (v) => v * 100) => {
      const r = el('label', 'mx-row'); r.append(el('span', '', label));
      const inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = Math.round(fromVal(mix[key] ?? (key === 'pan' ? 0 : key === 'vol' ? 0.8 : key === 'bright' ? 0.5 : key === 'release' ? 1 : key === 'reverb' ? 0.35 : 0)));
      const v = el('span', 'num', fmt(mix[key]));
      inp.addEventListener('input', () => { mix[key] = toVal(+inp.value); v.textContent = fmt(mix[key]); apply(); });
      r.append(inp, v); return r;
    };
    ch.append(row('Volume', 'vol', 0, 100, (x) => Math.round((x ?? 0.8) * 100)));
    if (C.mixAdv) {
      ch.append(row('Pan', 'pan', -100, 100, (x) => { const q = Math.round((x ?? 0) * 100); return q === 0 ? 'C' : (q < 0 ? 'L' : 'R') + Math.abs(q); }));
      ch.append(row('Warmth', 'low', -100, 100, (x) => { const q = Math.round((x || 0) * 12); return (q > 0 ? '+' : '') + q + ' dB'; }));
      ch.append(row('Brightness', 'bright', 0, 100, (x) => Math.round((x ?? 0.5) * 100)));
      ch.append(row('Room', 'reverb', 0, 100, (x) => Math.round((x ?? 0.35) * 100)));
      const test = el('button', 'mx-more', 'Hear it'); test.addEventListener('click', () => { unlock(); const inst = INST[p.inst]; const mid = Math.round((inst.range[0] + inst.range[1]) / 2); sampler.preview(soundOf(p), mid, 0.65, 1.2, mix); });
      ch.append(test);
    }
    const tone = null;
    box.append(ch);
    void tone;
  }
}
function renderLayout() {
  if (!C.score) return;
  $('#lyTitle').value = C.score.title || ''; $('#lySubtitle').value = C.score.subtitle || ''; $('#lyComposer').value = C.score.composer || '';
  $('#lyPage').value = C.score.layout.page || 'A4'; $('#lyOrient').value = C.score.layout.landscape ? '1' : '0';
  $('#lyConcert').checked = C.score.layout.concert !== false; $('#lyHide').checked = !!C.score.layout.hideEmpty;
  const box = $('#lyStaff'); box.textContent = '';
  for (const s of STAFF_SIZES) {
    const b = el('button', Math.abs(s.mm - C.score.layout.staffMm) < 0.01 ? 'on' : '');
    b.append(el('b', '', s.mm + ' mm'), el('span', '', s.use));
    b.addEventListener('click', () => { edit(() => { C.score.layout.staffMm = s.mm; }, { keepSel: true }); renderLayout(); });
    box.append(b);
  }
  $('#lyStaffVal').textContent = C.score.layout.staffMm + ' mm';
}
function renderExport() {
  const box = $('#exPartList'); box.textContent = '';
  if (C.score.parts.length < 2) return;
  C.score.parts.forEach((p, i) => { const b = el('button', '', p.name); b.addEventListener('click', () => exportPdf(i)); box.append(b); });
}
const fileName = (ext, extra = '') => ((C.score.title || 'Score') + extra).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) + ext;

// ---------- PDF ----------
// Every export is in the key each player reads: transposing instruments (clarinet, horn,
// saxophones, euphonium in treble clef…) are written in their own key. Only "Score in concert
// pitch" shows them as they sound.
async function makePdf(which, { concert = false } = {}) {
  const { PDFDocument } = await import('../../vendor/pdf-lib.mjs');
  const pdf = await PDFDocument.create();
  pdf.setTitle(C.score.title || 'Score'); if (C.score.composer) pdf.setAuthor(C.score.composer); pdf.setCreator('Stand');
  const layouts = [];
  if (which === undefined) layouts.push(layoutScore(C.score, { concert }));
  else {
    const list = which === 'all' ? C.score.parts.map((_, i) => i) : [which];
    for (const pi of list) layouts.push(layoutScore(C.score, { partIndex: pi, multiRests: true, staffMm: 7.0, hideEmpty: false }));
  }
  for (const lay of layouts) {
    const ptW = (lay.W * lay.spMm) / 25.4 * 72, ptH = (lay.H * lay.spMm) / 25.4 * 72;
    const pxW = Math.round((lay.W * lay.spMm) / 25.4 * 300);   // 300 dpi
    const k = pxW / lay.W;
    for (let i = 0; i < lay.pages.length; i++) {
      const c = document.createElement('canvas'); c.width = pxW; c.height = Math.round(lay.H * k);
      const g = c.getContext('2d'); g.scale(k, k); drawPage(g, lay, i);
      const bytes = await new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
      c.width = c.height = 0;
      const im = await pdf.embedPng(bytes);
      const page = pdf.addPage([ptW, ptH]);
      page.drawImage(im, { x: 0, y: 0, width: ptW, height: ptH });
    }
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
async function exportPdf(which, opts) {
  D.hidePanel(); D.toast('Making the PDF…', 60000);
  try {
    const blob = await makePdf(which, opts);
    $('#toast').hidden = true;
    const extra = which === undefined ? '' : which === 'all' ? ' (parts)' : ' - ' + C.score.parts[which].name;
    await D.shareBlob(blob, fileName('.pdf', extra));
  } catch (err) { console.error(err); D.toast('The PDF could not be made.'); }
}

// ---------- capture: draw around music, Stand reads it ----------
// ---- words in the captured music (tempo, expressions), read by the device's own text reader
const CAP_WORDS = ['Lent', 'Lento', 'Largo', 'Larghetto', 'Grave', 'Adagio', 'Andante', 'Andantino', 'Moderato', 'Allegretto', 'Allegro', 'Vivace', 'Presto', 'Maestoso', 'Animato', 'Calmato', 'Tempo', 'a tempo', 'Tempo I', 'rit.', 'ritard.', 'ritardando', 'rall.', 'rallentando', 'accel.', 'accelerando', 'cresc.', 'crescendo', 'dim.', 'diminuendo', 'decresc.', 'dolce', 'dolcissimo', 'espressivo', 'espress.', 'cantabile', 'cant.', 'legato', 'molto', 'poco', 'più', 'meno', 'sostenuto', 'ten.', 'sempre', 'subito', 'sonore', 'vibrant', 'pizz.', 'arco', 'sul ponticello', 'sul tasto', 'con sord.', 'senza sord.', 'marcato', 'leggiero', 'recitativo', 'ad lib', 'molto legato', 'Moderato', 'Lento', 'rubato', 'morendo', 'smorzando', 'perdendosi', 'con moto', 'agitato', 'tranquillo', 'grazioso', 'scherzando'];
const TEMPO_RE = /^(lent|lento|largo|larghetto|grave|adagio|andante|andantino|moderato|allegretto|allegro|vivace|presto|maestoso|animato|calmato|tempo|a tempo|tempo i|rubato|con moto|recitativo|molto accel|più mosso|meno mosso)\b/i;
function readTextBoxes(res, canvas) {
  const N = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standRecognize;
  if (!N || !res || !res.texts || !res.texts.length || !canvas) return Promise.resolve([]);
  return new Promise((resolve) => {
    const out = res.texts.map(() => null);
    let left = res.texts.length;
    const done = () => { window.__capTextDone = null; clearTimeout(t); resolve(out); };
    const t = setTimeout(done, 5000);
    window.__capTextDone = (id, text) => { const k = +String(id).slice(4); if (k >= 0 && k < out.length && out[k] === null) { out[k] = text; if (--left <= 0) done(); } };
    res.texts.forEach((b, k) => {
      const pad = 6, w = Math.max(4, Math.round(b.x1 - b.x0 + pad * 2)), h = Math.max(4, Math.round(b.y1 - b.y0 + pad * 2));
      const sc = Math.min(4, Math.max(1, 64 / h));
      const c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high';
      g.drawImage(canvas, b.x0 - pad, b.y0 - pad, w, h, 0, 0, c.width, c.height);
      try { N.postMessage({ id: 'cap:' + k, png: c.toDataURL('image/png').split(',')[1], words: CAP_WORDS }); } catch { out[k] = ''; left--; }
    });
    if (left <= 0) done();
  });
}
// The words read become tempo marks (above the line, at the start of a bar: Lent, Allegro, ♩ = 78)
// or expressions under or over the note they stand by (dolce, cresc.)
function placeCaptureTexts(res, answers) {
  if (!answers || !answers.length) return;
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  res.texts.forEach((b, k) => {
    let txt = clean(answers[k]);
    if (!txt || txt.length < 2 || !/[A-Za-zÀ-ÿ=]/.test(txt)) return;
    // the bars of its line, and the note it stands by (the first one from its start)
    const idx = res.bars.map((_, i) => i).filter((i) => res.barSys[i] === b.sys);
    let best = null;
    // (the note nearest the start of the words; one just after it is preferred over one before)
    for (const i of idx) res.bars[i].forEach((n, j) => { if (n.x === undefined || n.rest) return; const d = n.x - b.x0; const score = d >= 0 ? d : -d * 1.6; if (!best || score < best.score) best = { i, j, score }; });
    if (!best) return;
    const bpm = /=\s*(\d{2,3})/.exec(txt);
    const tempoWord = TEMPO_RE.test(txt);
    if (b.above && (bpm || tempoWord)) {
      const word = clean(txt.replace(/[♩♪J]?\s*=\s*\d{2,3}/, ''));
      res.bars[best.i].tempo = { ...(res.bars[best.i].tempo || {}), ...(bpm ? { bpm: +bpm[1] } : {}), ...(word ? { text: word } : {}) };
      return;
    }
    const n = res.bars[best.i][best.j];
    if (!b.above) n.txtBelow = true;
    // a dynamic beside the words (p dolcissimo) is the note's dynamic, not part of the text
    const toks = txt.split(' ');
    // (one already read on a note close by is not read twice)
    const near = res.bars[best.i].concat(res.bars[best.i - 1] || []);
    while (toks.length > 1 && DYNAMICS.includes(toks[0])) { const d = toks.shift(); if (!n.dyn && !near.some((q) => q.dyn === d)) n.dyn = d; }
    while (toks.length > 1 && DYNAMICS.includes(toks[toks.length - 1])) toks.pop();
    txt = toks.join(' ');
    if (DYNAMICS.includes(txt)) { if (!n.dyn) n.dyn = txt; return; }
    n.txt = n.txt ? n.txt + ' ' + txt : txt;
  });
}
async function startCapture(src, file) {
  D.hidePanel();
  const region = await D.pickRegion(src, file, { title: 'Choose the lines to write out' });
  if (!region) return;
  D.showPanel('cpcapture');
  $('#capResult').hidden = false; $('#capInfo').textContent = 'Reading…';
  try {
    const res = await D.recognise(region.canvas, { lines: 'all' });
    C.captureCanvas = null;
    if (!res || !res.notes.length) { $('#capInfo').textContent = 'No notes found. Try a cleaner part of the page, drawn a little wider than the staff.'; C.capture = null; drawCapture(); return; }
    C.capture = { ...res, clef: res.clef || 'treble', clef0: res.clef || 'treble', key: res.key || 0 };
    C.captureCanvas = region.canvas;
    // the words (tempo, expressions), when the device can read text
    readTextBoxes(res, region.canvas).then((answers) => { if (C.capture && C.capture.bars === res.bars) { placeCaptureTexts(C.capture, answers); drawCapture(); } });
    showCaptureSig();
    const per = res.analysis && res.analysis.systems.length ? Math.max(...res.analysis.systems.map((q) => q.length)) : 1;
    $('#capStaffRow').hidden = per < 2;
    const cs = $('#capStaff'); cs.textContent = '';
    for (let i = 0; i < per; i++) { const o = el('option', '', i === 0 ? 'Top staff' : i === per - 1 ? 'Bottom staff' : `Staff ${i + 1}`); o.value = i; cs.append(o); }
    fillCaptureTargets();
    drawCapture();
  } catch (err) { console.error(err); $('#capInfo').textContent = 'That could not be read.'; }
}
// "Transpose to": first "keep it" (in the key the music is in), then every other key
function syncCapTo() {
  const k = +$('#capKey').value, to = $('#capTo');
  const keep = to.querySelector('option[value=""]'); if (keep) keep.textContent = 'Keep it in ' + KEY_NAMES[k + 7].replace(' / ', ' · ');
  for (const o of to.options) if (o.value !== '') o.hidden = o.disabled = +o.value === k;   // (the iPad's list ignores hidden: disabled too)
  if (to.value !== '' && +to.value === k) to.value = '';
}
function showCaptureSig() {
  const cap = C.capture;
  if (!cap.time) cap.time = [4, 4];
  $('#capClef').value = cap.clef; $('#capKey').value = cap.key; $('#capTo').value = ''; syncCapTo();
  const tv = cap.time.join('/'), sel = $('#capTime');
  if (![...sel.options].some((o) => o.value === tv)) { const o = el('option', '', tv); o.value = tv; sel.append(o); }
  sel.value = tv;
}
// The captured bars as events, bar by bar, in the clef and key that were read (or chosen).
// The key the captured music is written in: the one in the picture, or the one chosen in
// "Transpose to". With another key, every note moves with it (C major → D major: a C becomes a D).
function capOutKey() { const v = $('#capTo') ? $('#capTo').value : ''; return v === '' || isNaN(+v) ? C.capture.key : +v; }
function capInterval() {
  const from = C.capture.key, to = capOutKey();
  if (from === to) return null;
  const tonic = (f) => ({ pc: (((f * 7) % 12) + 12) % 12, st: (((f * 4) % 7) + 7) % 7 });
  const a = tonic(from), b = tonic(to);
  let semis = (b.pc - a.pc + 12) % 12, steps = (b.st - a.st + 7) % 7;
  if (semis > 6 || (semis === 6 && steps > 3)) { semis -= 12; steps -= 7; }
  return { steps, semis, to };
}
function captureBarEvents(inst) {
  const cap = C.capture;
  // each note in the clef in force where it stands (a clef may change along the music); the first
  // clef is the one chosen in the panel
  const clef0 = cap.clef0 || cap.clef;
  const bottomOf = (n) => M.CLEFS[n.clef && n.clef !== clef0 ? n.clef : cap.clef].bottom;
  const iv = capInterval();
  const move = (w) => {
    if (!iv) return w;
    const midi = M.midiOf(w.s, w.a) + iv.semis;
    let s2 = w.s + iv.steps, a2 = midi - M.midiOf(s2, 0);
    if (Math.abs(a2) > 1) { const sp = M.spell(midi, iv.to); s2 = sp.s; a2 = sp.a; }
    return { ...w, s: s2, a: a2 };
  };
  const concert = C.score.layout.concert !== false;
  let last = cap.bars.length - 1; while (last > 0 && cap.bars[last].every((n) => n.rest)) last--;
  // the key in force in each bar (a key may change along the music)
  let keyNow = cap.key;
  const keys = cap.bars.map((_, i) => { const ch = cap.changes && cap.changes[i]; if (i > 0 && ch && ch.key !== undefined) keyNow = ch.key; return keyNow; });
  const out = cap.bars.slice(0, last + 1).map((bar, bi) => bar.map((n) => {
    if (n.rest) return n.full ? { full: true } : { id: M.newId(), rest: true, t: n.t || 4, dots: n.dots || 0, ...(n.tup ? { tup: { n: n.tup.n || 3, m: n.tup.m || 2, base: n.tup.base || n.t || 4 } } : {}) };
    const bottom = bottomOf(n), keyB = keys[bi];
    const ecl = n.clef && n.clef !== clef0 ? n.clef : cap.clef;
    // (under an octave line the notes sound an octave from where they are written: the score keeps
    // the sounding pitch and draws them under its own octave line)
    const ott = n.ott ? n.ott * 7 : 0;
    const notes = n.ps.map((p) => {
      const s = bottom + p + ott;
      const w = move({ s, a: n.acc && n.acc[p] !== undefined ? n.acc[p] : M.keyAlter(keyB, s) });
      if (n.ties && n.ties.includes(p)) w.tie = true;
      // what is printed for a transposing instrument is its written pitch
      return !concert && inst ? { ...M.toConcert(w, inst), ...(w.tie ? { tie: true } : {}) } : w;
    });
    const ev = { id: M.newId(), t: n.t || 4, dots: n.dots || 0, notes, _ec: ecl };
    // a grace note before it
    if (n.grace && n.grace.p !== undefined) {
      const gs = bottom + n.grace.p, gw = move({ s: gs, a: n.grace.acc !== undefined ? n.grace.acc : M.keyAlter(keyB, gs) });
      const g2 = !concert && inst ? M.toConcert(gw, inst) : gw;
      ev.grace = { s: g2.s, a: g2.a, dir: g2.s >= Math.max(...notes.map((q) => q.s)) ? 1 : -1 };
    }
    // what the reader saw around the note: triplets, articulations, ornaments, slurs
    if (n.tup) ev.tup = { n: n.tup.n || 3, m: n.tup.m || 2, base: n.tup.base || n.t || 4, ...(n.tup.base && n.tup.base !== n.t ? {} : { i: n.tup.i }) };
    const arts = (n.art || []).filter((a) => ['stacc', 'acc', 'ten', 'marc', 'ferm', 'trill', 'mord', 'prall', 'turn', 'up', 'down', 'breath', 'harm'].includes(a));
    if (arts.length) ev.art = arts;
    if (n.slurStart) ev._slurA = true;
    if (n.slurEnd) ev._slurB = true;
    // dynamics, fingering and hairpins
    if (n.dyn && DYNAMICS.includes(n.dyn)) ev.dyn = n.dyn;
    if (n.txt) { ev.txt = n.txt; ev.txtStyle = /^[a-zà-ÿ]/.test(n.txt) ? 'expr' : 'tech'; if (n.txtBelow) ev.txtBelow = true; }
    if (n.fing) ev.fing = String(n.fing);
    if (n.hp && n.hp.start) ev._hpA = n.hp.start;
    if (n.hpEnd) ev._hpB = true;
    if (n.ott) ev._ott = n.ott;
    return ev;
  }));
  // a clef that changes in the middle of a bar goes on the first note in the new clef (the bars
  // start in the clef read at their start)
  let run = cap.clef;
  out.forEach((evs, bi) => {
    const ch = cap.changes && cap.changes[bi];
    if (bi > 0 && ch && ch.clef) run = ch.clef !== clef0 ? ch.clef : cap.clef;
    for (const ev of evs) {
      if (!ev._ec) continue;
      if (ev._ec !== run) { ev.clef = ev._ec; run = ev._ec; }
      delete ev._ec;
    }
  });
  return out;
}
// Paste captured music bar for bar. With "clef, key and time" on, those bars take the music's own
// time signature, key and clef, and the score goes back to what it was after them.
function pasteCapture(st, m) {
  const cap = C.capture, S = C.score;
  const info = M.staffInfo(S).find((x) => x.st === st);
  const inst = info ? info.inst : null;
  const bars = captureBarEvents(inst);
  if (!bars.length) return;
  const n = bars.length;
  const concert = S.layout.concert !== false;
  // the key of the music, as the score keeps it (sounding pitch)
  const keyOut = capOutKey();
  let keyC = keyOut;
  if (!concert && inst) for (let f = -7; f <= 7; f++) if (M.writtenKey(f, inst) === keyOut) { keyC = f; break; }
  const time = cap.time || M.timeAt(S, m);
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
  edit(() => {
    if (S.measures.length < m + n) M.addBars(S, m + n - S.measures.length);
    const after = m + n, hasAfter = after < S.measures.length;
    const oldTime = M.timeAt(S, hasAfter ? after : m), oldKey = M.keyAt(S, hasAfter ? after : m), oldClef = M.clefAt(st, hasAfter ? after : m);
    // the bars after go back to the score's own time, key and clef (as they are at the end of the
    // pasted music, after any changes in it)
    let endTime = time, endKey = keyC, endClef = cap.clef;
    for (let i = 1; i < n; i++) { const ch = cap.changes && cap.changes[i]; if (!ch) continue; if (ch.time) endTime = ch.time; if (ch.key !== undefined) endKey = null; if (ch.clef) endClef = ch.clef; }
    if (hasAfter) {
      if (!S.measures[after].time && !same(oldTime, endTime)) M.setTime(S, after, oldTime);
      if ((S.measures[after].key === undefined || S.measures[after].key === null) && oldKey !== endKey) S.measures[after].key = oldKey;
      if (!(st.clefs && st.clefs[after]) && oldClef !== endClef) st.clefs = { ...(st.clefs || {}), [after]: oldClef };
    }
    if (!same(M.timeAt(S, m), time)) M.setTime(S, m, time);
    if (M.keyAt(S, m) !== keyC) S.measures[m].key = keyC;
    if (M.clefAt(st, m) !== cap.clef) {
      st.clefs = { ...(st.clefs || {}) };
      if (m === 0) { st.clef = cap.clef; delete st.clefs[0]; } else st.clefs[m] = cap.clef;
    }
    // the changes read along the music: time, key (moved with the transposition) and clef
    const iv = capInterval(), shiftKey = (k) => { if (!iv) return k; const f = M.fifthsOfInterval(iv.steps, iv.semis); let k2 = k + f; while (k2 > 7) k2 -= 12; while (k2 < -7) k2 += 12; return k2; };
    for (let i = 1; i < n; i++) {
      const ch = cap.changes && cap.changes[i]; if (!ch) continue;
      const mm = m + i;
      if (ch.time && !same(M.timeAt(S, mm), ch.time)) M.setTime(S, mm, ch.time);
      if (ch.key !== undefined) { let k = shiftKey(ch.key); if (!concert && inst) for (let f = -7; f <= 7; f++) if (M.writtenKey(f, inst) === k) { k = f; break; } if (M.keyAt(S, mm) !== k) S.measures[mm].key = k; }
      if (ch.clef && M.clefAt(st, mm) !== ch.clef) st.clefs = { ...(st.clefs || {}), [mm]: ch.clef };
    }
    // the notes, bar for bar
    const slurPts = [], hpPts = [], ottPts = [];
    bars.forEach((evs, i) => {
      const mm = m + i, tm = M.timeAt(S, mm), total = M.barTicks(tm);
      st.bars[mm] = M.restBar(tm);
      if (evs.length === 1 && evs[0].full) return;
      const sum = evs.reduce((a, e) => a + M.evTicks(e), 0);
      // a short first bar is an upbeat: it ends with the bar
      let pos = i === 0 && sum < total ? total - sum : 0;
      for (const ev of evs) {
        if (ev.full) continue;
        const len = M.evTicks(ev);
        if (pos + len > total + 1) break;
        if (ev._slurB) slurPts.push({ b: true, m: mm, pos });
        if (ev._slurA) slurPts.push({ a: true, m: mm, pos });
        if (ev._hpB) hpPts.push({ b: true, m: mm, pos });
        if (ev._hpA) hpPts.push({ a: ev._hpA, m: mm, pos });
        ottPts.push({ o: ev._ott || 0, m: mm, pos, rest: !!ev.rest });
        delete ev._slurA; delete ev._slurB; delete ev._hpA; delete ev._hpB; delete ev._ott;
        M.writeEvent(S, st, mm, pos, ev);
        pos += len;
      }
    });
    // a clef changed in the middle of a bar holds in the bars after it (as far as the pasted music
    // goes; the score's own clef comes back after it, as set above)
    for (let i = 0; i + 1 < n; i++) {
      const mm = m + i, end = M.clefEnd(st, mm);
      if (M.clefAt(st, mm + 1) !== end && !(cap.changes && cap.changes[i + 1] && cap.changes[i + 1].clef)) st.clefs = { ...(st.clefs || {}), [mm + 1]: end };
    }
    if (hasAfter) { const end = M.clefEnd(st, m + n - 1); if (!(st.clefs && st.clefs[after] !== undefined) && end !== oldClef) st.clefs = { ...(st.clefs || {}), [after]: oldClef }; }
    // tempo marks read with the music
    cap.bars.forEach((b, i) => { if (b.tempo && m + i < S.measures.length) { const t0 = M.tempoAt(S, m + i); S.measures[m + i].tempo = { bpm: b.tempo.bpm || t0.bpm || 96, beat: t0.beat || 4, text: b.tempo.text || '' }; } });
    // the slurs that were read, as lines over the notes (the old ones in these bars go)
    S.spans = (S.spans || []).filter((q) => !(q.kind === 'slur' && q.st === st.id && q.a.m >= m && q.b.m <= m + n - 1));
    let open = null;
    for (const q of slurPts) {
      if (q.a) open = q;
      if (q.b && open && (q.m > open.m || (q.m === open.m && q.pos > open.pos))) { S.spans.push({ id: M.newId(), kind: 'slur', st: st.id, v: 1, a: { m: open.m, pos: open.pos }, b: { m: q.m, pos: q.pos } }); open = null; }
    }
    // octave lines, over the notes read under them (rests between them stay under the line)
    S.spans = S.spans.filter((q) => !(['8va', '8vb'].includes(q.kind) && q.st === st.id && q.a.m >= m && q.b.m <= m + n - 1));
    let ottRun = null;
    const ottClose = () => { if (ottRun) S.spans.push({ id: M.newId(), kind: ottRun.o > 0 ? '8va' : '8vb', st: st.id, a: ottRun.a, b: ottRun.b }); ottRun = null; };
    for (const q of ottPts) {
      if (q.rest) continue;
      if (ottRun && q.o !== ottRun.o) ottClose();
      if (q.o && !ottRun) ottRun = { o: q.o, a: { m: q.m, pos: q.pos }, b: { m: q.m, pos: q.pos } };
      else if (q.o) ottRun.b = { m: q.m, pos: q.pos };
    }
    ottClose();
    // hairpins, from the note where each opens (or closes) to the note it reaches
    S.spans = S.spans.filter((q) => !(q.kind === 'hairpin' && q.st === st.id && q.a.m >= m && q.b.m <= m + n - 1));
    let hpOpen = null;
    for (const q of hpPts) {
      if (q.a) hpOpen = q;
      if (q.b && hpOpen && (q.m > hpOpen.m || (q.m === hpOpen.m && q.pos >= hpOpen.pos))) { S.spans.push({ id: M.newId(), kind: 'hairpin', st: st.id, v: 1, dir: hpOpen.a, a: { m: hpOpen.m, pos: hpOpen.pos }, b: { m: q.m, pos: q.pos } }); hpOpen = null; }
    }
  });
  // the bars the reader was unsure of stay marked until they are changed (or another capture)
  const doubtful = new Map();
  (cap.doubt || []).forEach((d, i) => { if (d && i < n && m + i < S.measures.length) doubtful.set(m + i, JSON.stringify(st.bars[m + i])); });
  C.capDoubt = doubtful.size ? { stId: st.id, bars: doubtful } : null;
  C.sel.clear(); C.selBars = { st, stId: st.id, from: m, to: Math.min(S.measures.length - 1, m + n - 1), staffK: 0 };
  relayout(); syncSelBar();
  const check = doubtful.size ? ` ${doubtful.size} ${doubtful.size === 1 ? 'bar is' : 'bars are'} marked in orange to check.` : '';
  D.toast(`${n} ${n === 1 ? 'bar' : 'bars'} pasted in ${time.join('/')}, ${KEY_NAMES[keyC + 7].split(' / ')[0]}.${check}`, check ? 4200 : 2600);
}
function nextFreeBar(stId) {
  const st = M.allStaves(C.score).find((x) => x.id === stId) || C.score.parts[0].staves[0];
  let m = st.bars.length - 1; while (m >= 0 && st.bars[m].every((e) => e.rest)) m--;
  return m + 1;
}
function captureBars() { let n = C.capture.bars.length; while (n > 1 && C.capture.bars[n - 1].every((x) => x.rest)) n--; return n; }
function fillCaptureTargets() {
  const sel = $('#capInto'); sel.textContent = '';
  for (const p of C.score.parts) p.staves.forEach((st, i) => { const o = el('option', '', p.staves.length > 1 ? `${p.name} (${i === 0 ? 'upper' : 'lower'})` : p.name); o.value = st.id; sel.append(o); });
  const f = selEvents()[0];
  const st = C.selBars ? C.selBars.st : f ? f.st : C.score.parts[0].staves[0];
  sel.value = st.id;
  $('#capBar').max = C.score.measures.length + 1;
  $('#capBar').value = (C.selBars ? C.selBars.from : f ? f.m : nextFreeBar(st.id)) + 1;
}
function captureClip() {
  // the notes from the picture as one run of events (for Copy, or pasting into the score's own bars)
  const total = M.barTicks(C.capture.time || [4, 4]);
  const events = [];
  for (const bar of captureBarEvents(null)) for (const e of bar) {
    if (e.full) { const v = M.valueOf ? M.valueOf(total) : null; events.push(v ? { id: M.newId(), rest: true, t: v.t, dots: v.dots } : { id: M.newId(), rest: true, t: 1, dots: 0, len: total }); }
    else events.push(e);
  }
  return { events, from: 'capture' };
}
function drawCapture() {
  const c = $('#capPreview');
  if (!C.capture) { c.width = 10; c.height = 10; return; }
  const cap = C.capture, time = cap.time || [4, 4];
  const bars = captureBarEvents(null);
  const s = M.newScore({ title: '', insts: ['violin'], bars: Math.max(1, bars.length), time, key: capOutKey() });
  s.layout = { page: 'A4', landscape: false, staffMm: 13, concert: true };
  const st = s.parts[0].staves[0]; st.clef = cap.clef;
  const total = M.barTicks(time);
  bars.forEach((evs, i) => {
    if (evs.length === 1 && evs[0].full) return;
    const sum = evs.reduce((a, e) => a + M.evTicks(e), 0);
    let pos = i === 0 && sum < total ? total - sum : 0;
    for (const ev of evs) { if (ev.full) continue; const len = M.evTicks(ev); if (pos + len > total + 1) break; M.writeEvent(s, st, i, pos, M.clone(ev)); pos += len; }
  });
  delete s.measures[s.measures.length - 1].bar;
  const lay = layoutScore(s);
  const sys = lay.pages[0].systems;
  const used = sys.length ? sys[sys.length - 1].top + sys[sys.length - 1].height + 4 : 20;
  const W = c.clientWidth || 400, k = W / lay.W, dpr = 2;
  c.width = W * dpr; c.height = Math.round(Math.min(used + 2, lay.H) * k * dpr);
  c.style.height = Math.round(c.height / dpr) + 'px';
  const g = c.getContext('2d'); g.scale(k * dpr, k * dpr); g.translate(0, -lay.margin.t + 2);
  drawPage(g, lay, 0);
  const notes = bars.flat().filter((e) => e.notes).length;
  $('#capInfo').textContent = `${notes} notes · ${bars.length} ${bars.length === 1 ? 'bar' : 'bars'}`;
}
export { closeCompose };
