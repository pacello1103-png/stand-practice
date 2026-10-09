import { db, getSetting, setSetting, uid } from './db.js';
import { getCtx, unlock, micErrorText } from './audio.js';
import { Metronome, makeTapper, tempoMarking, meterInfo } from './metronome.js';
import { Tuner, Drone, NOTE_NAMES } from './tuner.js';
import { Recorder, Player, computePeaks, peakOf, ROOMS } from './recorder.js';
import { openDocument, makeThumb, InkLayer } from './score.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s, tenths) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0')); };
const fmtMinutes = (sec) => { const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

let toastTimer;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

// Any first tap wakes the audio engine (iOS requirement).
let unlocked = false;
document.addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; unlock(); } else getCtx(); }, { capture: true });

// =====================================================================
// Settings
// =====================================================================
const S = {
  ref: 442, twoUp: true, paper: 'white', countIn: true, clickWhileRec: false,
  room: 'studio', wet: 0.18, autoLevel: true, sort: 'recent', flash: false,
  metro: null, drone: null,
};
async function loadSettings() { const saved = await getSetting('settings', {}); Object.assign(S, saved || {}); }
let saveT; function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => setSetting('settings', S), 300); }

// =====================================================================
// Panels
// =====================================================================
let openPanel = null;
function showPanel(name) {
  if (openPanel === name) { hidePanel(); return; }
  hidePanel();
  const p = $('#panel-' + name); if (!p) return;
  p.hidden = false; openPanel = name;
  $$(`[data-panel="${name}"]`).forEach((b) => b.classList.add('on'));
  if (name === 'takes') refreshTakes();
  if (name === 'metronome') drawRamp();
  if (name === 'settings') fillScoreSettings();
}
function hidePanel() {
  if (!openPanel) return;
  $('#panel-' + openPanel).hidden = true;
  $$(`[data-panel="${openPanel}"]`).forEach((b) => b.classList.remove('on'));
  if (openPanel === 'settings') saveScoreMeta();
  openPanel = null;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-panel]'); if (b) { showPanel(b.dataset.panel); return; }
  if (e.target.closest('[data-close]')) hidePanel();
});
// Tapping outside an open panel closes it (and that tap does nothing else);
// toolbar buttons and status pills stay usable.
document.addEventListener('pointerdown', (e) => {
  swallowClick = false;
  if (!openPanel) return;
  if (e.target.closest('.panel, .topbar, .dock, .lib-tools, .inkbar, .toast')) return;
  e.stopPropagation(); swallowClick = true; hidePanel();
}, { capture: true });
let swallowClick = false;
document.addEventListener('pointerup', (e) => { if (swallowClick) { e.stopPropagation(); } }, { capture: true });
document.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, { capture: true });

// =====================================================================
// Library
// =====================================================================
let scores = [];
const thumbURLs = new Map();

async function refreshLibrary() {
  scores = await db.all('scores').catch(() => []);
  renderGrid();
  renderToday();
}
function renderGrid() {
  const q = $('#searchInput').value.trim().toLowerCase();
  let list = scores.filter((s) => !q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
  const by = S.sort;
  list.sort((a, b) => by === 'title' ? a.title.localeCompare(b.title)
    : by === 'composer' ? (a.composer || '~').localeCompare(b.composer || '~') || a.title.localeCompare(b.title)
    : (b.opened || b.added) - (a.opened || a.added));
  const grid = $('#grid');
  grid.textContent = '';
  $('#emptyLib').hidden = scores.length > 0;
  $('.lib-bar').hidden = scores.length === 0;
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'card';
    const th = document.createElement('div'); th.className = 'thumb';
    if (s.thumb) {
      if (!thumbURLs.has(s.id)) thumbURLs.set(s.id, URL.createObjectURL(s.thumb));
      th.style.backgroundImage = `url(${thumbURLs.get(s.id)})`;
    }
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = s.pages + (s.pages === 1 ? ' page' : ' pages');
    th.append(badge);
    const t = document.createElement('div'); t.className = 'ttl'; t.textContent = s.title;
    const c = document.createElement('div'); c.className = 'cmp'; c.textContent = s.composer || (s.seconds ? fmtMinutes(s.seconds) + ' practised' : 'Not practised yet');
    b.append(th, t, c);
    b.addEventListener('click', () => openScore(s.id));
    grid.append(b);
  }
}
async function renderToday() {
  const log = (await getSetting('log', {})) || {};
  const today = log[dayKey()] || 0;
  let week = 0; const d = new Date();
  for (let i = 0; i < 7; i++) { week += log[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  $('#todayStat').textContent = today < 60 && week < 60 ? 'No practice logged today'
    : `Today ${fmtMinutes(today)} · last 7 days ${fmtMinutes(week)}`;
}
$('#searchInput').addEventListener('input', renderGrid);
$$('#sortSeg button').forEach((b) => b.addEventListener('click', () => {
  S.sort = b.dataset.sort; saveSettings();
  $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderGrid();
}));

function niceTitle(name) {
  return name.replace(/\.(pdf|jpe?g|png|heic|webp)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
$('#importInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  let added = 0;
  toast(files.length > 1 ? `Importing ${files.length} files…` : 'Importing…', 8000);
  for (const f of pdfs) {
    try {
      const data = await f.arrayBuffer();
      const file = { id: uid(), kind: 'pdf', data };
      const doc = await openDocument(file);
      const thumb = await makeThumb(doc);
      const score = { id: uid(), fileId: file.id, title: niceTitle(f.name), composer: '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb };
      doc.destroy();
      await db.put('files', file); await db.put('scores', score); added++;
    } catch (err) { console.error(err); toast(`Could not open ${f.name}. Is it a valid PDF?`); }
  }
  if (imgs.length) {
    // All selected photos become one score, in the order chosen.
    try {
      const file = { id: uid(), kind: 'images', data: imgs };
      const doc = await openDocument(file);
      const thumb = await makeThumb(doc);
      const score = { id: uid(), fileId: file.id, title: niceTitle(imgs[0].name), composer: '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb };
      doc.destroy();
      await db.put('files', file); await db.put('scores', score); added++;
    } catch (err) { console.error(err); toast('Those photos could not be read.'); }
  }
  await refreshLibrary();
  if (added) toast(added === 1 ? 'Score added' : `${added} scores added`);
});

// =====================================================================
// Score viewer
// =====================================================================
const V = { score: null, doc: null, page: 0, spread: 1, cache: new Map(), layers: [], inking: false, tool: 'pen', color: '#1b1d22', undo: [] };
const stage = $('#stage');
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }

async function openScore(id) {
  const score = await db.get('scores', id);
  const file = await db.get('files', score.fileId);
  if (!file) { toast('This score’s file is missing.'); return; }
  V.score = score; V.cache.clear(); V.undo = [];
  try { V.doc = await openDocument(file); } catch (e) { console.error(e); toast('The score could not be opened.'); return; }
  V.page = clamp(score.lastPage || 0, 0, V.doc.pages - 1);
  score.opened = Date.now(); db.put('scores', score);
  $('#library').hidden = true; $('#score').hidden = false;
  $('#score').dataset.paper = S.paper;
  $('#scoreTitle').textContent = score.title;
  $('#pageRange').max = V.doc.pages; $('#pageScrub').hidden = V.doc.pages < 3;
  if (score.metro) applyMetroSettings(score.metro);
  showChrome(true);
  await layout();
  keepAwake();
  startPracticeClock();
  chromeTimer = setTimeout(() => showChrome(false), 2500);
}
async function closeScore() {
  stopPracticeClock();
  setInking(false);
  hidePanel();
  if (V.score) { V.score.lastPage = V.page; await db.put('scores', V.score); }
  if (V.doc) V.doc.destroy();
  V.doc = null; V.score = null; V.cache.clear(); stage.textContent = '';
  $('#score').hidden = true; $('#library').hidden = false;
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
  refreshLibrary();
}
$('#backBtn').addEventListener('click', closeScore);

function spreadSize() {
  const r = stage.getBoundingClientRect();
  return S.twoUp && r.width > r.height * 1.05 && V.doc && V.doc.pages > 1 ? 2 : 1;
}
function pageBox(indices) {
  const r = stage.getBoundingClientRect();
  const pad = 6, gap = indices.length > 1 ? 2 : 0;
  const ratios = indices.map((i) => V.doc.sizes[i][0] / V.doc.sizes[i][1]);
  const sum = ratios.reduce((a, b) => a + b, 0);
  const h = Math.min(r.height - pad * 2, (r.width - pad * 2 - gap) / sum);
  return ratios.map((q) => [Math.floor(h * q), Math.floor(h)]);
}
function renderPage(i, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let pw = w * dpr, ph = h * dpr;
  const maxPx = 14e6; if (pw * ph > maxPx) { const k = Math.sqrt(maxPx / (pw * ph)); pw *= k; ph *= k; }
  const key = i + '|' + Math.round(pw) + 'x' + Math.round(ph);
  if (V.cache.has(key)) { const v = V.cache.get(key); V.cache.delete(key); V.cache.set(key, v); return v; }
  const canvas = document.createElement('canvas'); canvas.className = 'art';
  const p = V.doc.render(i, canvas, pw, ph).then(() => canvas);
  V.cache.set(key, p);
  while (V.cache.size > 10) V.cache.delete(V.cache.keys().next().value);
  return p;
}
let layoutToken = 0;
async function layout(fade) {
  if (!V.doc) return;
  const token = ++layoutToken;
  V.spread = spreadSize();
  const idx = [V.page]; if (V.spread === 2 && V.page + 1 < V.doc.pages) idx.push(V.page + 1);
  const boxes = pageBox(idx);
  const canvases = await Promise.all(idx.map((i, k) => renderPage(i, boxes[k][0], boxes[k][1])));
  if (token !== layoutToken) return;
  const spread = document.createElement('div'); spread.className = 'spread';
  V.layers = [];
  idx.forEach((i, k) => {
    const pg = document.createElement('div'); pg.className = 'pg';
    pg.style.width = boxes[k][0] + 'px'; pg.style.height = boxes[k][1] + 'px';
    const art = canvases[k];
    const ink = document.createElement('canvas'); ink.className = 'ink';
    ink.width = art.width; ink.height = art.height;
    pg.append(art, ink);
    spread.append(pg);
    const layer = new InkLayer(ink, V.score.id, i);
    layer.load();
    V.layers.push(layer);
    attachInk(ink, layer);
  });
  stage.textContent = '';
  stage.append(spread);
  if (fade && !matchMedia('(prefers-reduced-motion: reduce)').matches) { spread.classList.add('fade'); requestAnimationFrame(() => requestAnimationFrame(() => spread.classList.remove('fade'))); }
  const last = idx[idx.length - 1] + 1;
  $('#pageLabel').textContent = (idx.length > 1 ? `${idx[0] + 1}–${last}` : `${idx[0] + 1}`) + ' / ' + V.doc.pages;
  $('#pageRange').value = V.page + 1;
  // warm the cache for the next and previous spreads
  setTimeout(() => {
    if (token !== layoutToken || !V.doc) return;
    for (const start of [V.page + V.spread, V.page - V.spread]) {
      if (start < 0 || start >= V.doc.pages) continue;
      const ids = [start]; if (V.spread === 2 && start + 1 < V.doc.pages) ids.push(start + 1);
      pageBox(ids).forEach((b, k) => renderPage(ids[k], b[0], b[1]));
    }
  }, 60);
}
function turn(dir) {
  if (!V.doc) return;
  const step = V.spread;
  const next = clamp(V.page + dir * step, 0, Math.max(0, V.doc.pages - 1));
  if (next === V.page) return;
  V.page = next;
  V.score.lastPage = next;
  layout(true);
}
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (V.doc) { V.cache.clear(); layout(); } }, 150); });
$('#pageRange').addEventListener('input', (e) => { V.page = clamp(+e.target.value - 1, 0, V.doc.pages - 1); layout(); });

let chromeTimer;
function showChrome(on) { clearTimeout(chromeTimer); $('#score').classList.toggle('chrome-off', !on); }
// taps and swipes on the page
let down = null;
stage.addEventListener('pointerdown', (e) => { if (V.inking && e.target.classList.contains('ink')) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
stage.addEventListener('pointerup', (e) => {
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y; const d = down; down = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { turn(dx < 0 ? 1 : -1); return; }
  if (Math.hypot(dx, dy) > 12 || performance.now() - d.t > 600) return;
  const w = window.innerWidth;
  if (e.clientX > w * 0.68) turn(1);
  else if (e.clientX < w * 0.32) turn(-1);
  else showChrome($('#score').classList.contains('chrome-off'));
});
document.addEventListener('keydown', (e) => {
  if ($('#score').hidden || e.target.matches('input, select, textarea')) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); turn(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
});

// ---------- ink ----------
let penSeen = false;
function setInking(on) {
  V.inking = on;
  $('#inkbar').hidden = !on; $('#inkBtn').classList.toggle('on', on);
  stage.classList.toggle('inking', on);
  if (on) showChrome(true);
}
$('#inkBtn').addEventListener('click', () => setInking(!V.inking));
$('#inkDone').addEventListener('click', () => setInking(false));
$$('.ink-tool[data-tool]').forEach((b) => b.addEventListener('click', () => { V.tool = b.dataset.tool; $$('.ink-tool[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }));
$$('.swatch').forEach((b) => b.addEventListener('click', () => {
  V.color = b.dataset.color; $$('.swatch').forEach((x) => x.classList.toggle('on', x === b));
  if (V.tool === 'eraser') $('.ink-tool[data-tool="pen"]').click();
}));
$('#inkUndo').addEventListener('click', () => {
  const u = V.undo.pop(); if (!u) return;
  u.layer.strokes = u.strokes; u.layer.redraw(); u.layer.save();
});
function attachInk(canvas, layer) {
  let stroke = null, erasing = false, snap = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!V.inking) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return; // palm rejection once a Pencil is used
    e.preventDefault(); e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    snap = layer.strokes.slice();
    if (V.tool === 'eraser') { erasing = true; const p = pos(e); layer.eraseAt(p[0], p[1], 0.02); return; }
    stroke = { tool: V.tool, color: V.tool === 'hl' ? (V.color === '#1b1d22' ? '#f2c200' : V.color) : V.color, pts: [pos(e)] };
    layer.drawLive(stroke);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stroke && !erasing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = pos(ev);
      if (erasing) { layer.eraseAt(p[0], p[1], 0.02); continue; }
      const last = stroke.pts[stroke.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0012) continue;
      if (stroke.tool === 'hl') p[1] = stroke.pts[0][1] + (p[1] - stroke.pts[0][1]) * 0.15; // keep highlights level
      stroke.pts.push(p); layer.drawLive(stroke);
    }
  });
  const end = () => {
    if (erasing) { erasing = false; if (snap.length !== layer.strokes.length) { V.undo.push({ layer, strokes: snap }); layer.save(); } return; }
    if (!stroke) return;
    stroke.pts = stroke.pts.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4), +p[2].toFixed(2)]);
    layer.strokes.push(stroke); stroke = null;
    V.undo.push({ layer, strokes: snap }); if (V.undo.length > 60) V.undo.shift();
    layer.redraw(); layer.save();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// ---------- score settings ----------
function fillScoreSettings() {
  if (!V.score) return;
  $('#metaTitle').value = V.score.title; $('#metaComposer').value = V.score.composer || '';
  $('#twoUp').checked = S.twoUp; $('#countIn').checked = S.countIn; $('#clickWhileRec').checked = S.clickWhileRec;
  $$('#paperSeg button').forEach((b) => b.classList.toggle('on', b.dataset.paper === S.paper));
  db.byIndex('takes', 'score', V.score.id).then((t) => {
    const stats = $('#scoreStats'); stats.textContent = '';
    for (const [v, l] of [[fmtMinutes(V.score.seconds || 0), 'practised'], [t.length, t.length === 1 ? 'recording' : 'recordings'], [V.doc ? V.doc.pages : V.score.pages, 'pages']]) {
      const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = l; d.append(b, s); stats.append(d);
    }
  });
  $('#delScoreConfirm').hidden = true;
}
function saveScoreMeta() {
  if (!V.score) return;
  const t = $('#metaTitle').value.trim(); if (t) V.score.title = t;
  V.score.composer = $('#metaComposer').value.trim();
  $('#scoreTitle').textContent = V.score.title;
  db.put('scores', V.score);
}
$('#metaTitle').addEventListener('change', saveScoreMeta);
$('#metaComposer').addEventListener('change', saveScoreMeta);
$('#twoUp').addEventListener('change', (e) => { S.twoUp = e.target.checked; saveSettings(); V.cache.clear(); layout(); });
$('#countIn').addEventListener('change', (e) => { S.countIn = e.target.checked; saveSettings(); });
$('#clickWhileRec').addEventListener('change', (e) => { S.clickWhileRec = e.target.checked; saveSettings(); });
$$('#paperSeg button').forEach((b) => b.addEventListener('click', () => {
  S.paper = b.dataset.paper; saveSettings(); $('#score').dataset.paper = S.paper;
  $$('#paperSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('#delScore').addEventListener('click', () => { $('#delScoreConfirm').hidden = false; });
$('#delScoreNo').addEventListener('click', () => { $('#delScoreConfirm').hidden = true; });
$('#delScoreYes').addEventListener('click', async () => {
  const s = V.score; if (!s) return;
  const takes = await db.byIndex('takes', 'score', s.id);
  for (const t of takes) { await db.del('takes', t.id); await db.del('files', 'audio:' + t.id); }
  const inkKeys = (await db.keys('ink')).filter((k) => String(k).startsWith(s.id + ':'));
  for (const k of inkKeys) await db.del('ink', k);
  await db.del('files', s.fileId);
  hidePanel();
  V.score = null;
  if (V.doc) V.doc.destroy(); V.doc = null;
  await db.del('scores', s.id);
  thumbURLs.delete(s.id);
  stopPracticeClock();
  $('#score').hidden = true; $('#library').hidden = false; stage.textContent = '';
  refreshLibrary();
  toast('Score removed');
});

// ---------- practice clock ----------
let clockT = null, lastTick = 0;
function startPracticeClock() { stopPracticeClock(); lastTick = Date.now(); clockT = setInterval(tickPractice, 15000); }
function stopPracticeClock() { if (clockT) { tickPractice(); clearInterval(clockT); clockT = null; } }
async function tickPractice() {
  const now = Date.now(); const dt = Math.min(60, (now - lastTick) / 1000); lastTick = now;
  if (!V.score || document.visibilityState !== 'visible' || dt <= 0) return;
  V.score.seconds = (V.score.seconds || 0) + dt;
  db.put('scores', V.score);
  const log = (await getSetting('log', {})) || {};
  log[dayKey()] = (log[dayKey()] || 0) + dt;
  setSetting('log', log);
}
document.addEventListener('visibilitychange', () => {
  lastTick = Date.now();
  if (document.visibilityState === 'visible' && V.doc) keepAwake();
});

// =====================================================================
// Metronome UI
// =====================================================================
const metro = new Metronome();
function metroSnapshot() { return { bpm: metro.bpm, meter: $('#meterSel').value, accents: metro.accents.slice(), subdiv: metro.subdiv, sound: metro.sound, volume: metro.volume, ramp: { ...metro.ramp }, gap: { ...metro.gap } }; }
let metroSaveT;
function persistMetro() {
  clearTimeout(metroSaveT);
  metroSaveT = setTimeout(() => {
    S.metro = metroSnapshot(); saveSettings();
    if (V.score) { V.score.metro = { bpm: metro.bpm, meter: $('#meterSel').value, accents: metro.accents.slice(), subdiv: metro.subdiv }; db.put('scores', V.score); }
  }, 400);
}
function applyMetroSettings(m) {
  if (!m) return;
  if (m.meter) { $('#meterSel').value = m.meter; metro.beats = meterInfo(m.meter).beats; }
  if (m.accents && m.accents.length === metro.beats) metro.accents = m.accents.slice(); else metro.accents = meterInfo($('#meterSel').value).accents;
  if (m.subdiv) metro.subdiv = m.subdiv;
  if (m.sound) metro.sound = m.sound;
  if (m.volume !== undefined) metro.volume = m.volume;
  if (m.ramp) Object.assign(metro.ramp, m.ramp);
  if (m.gap) Object.assign(metro.gap, m.gap);
  setBpm(m.bpm || metro.bpm, true);
  syncMetroUI();
}
function syncMetroUI() {
  $('#subSel').value = metro.subdiv; $('#soundSel').value = metro.sound; $('#metroVol').value = metro.volume;
  const r = metro.ramp;
  $('#rampOn').checked = r.on; $('#rampFrom').value = r.from; $('#rampTo').value = r.to; $('#rampBars').value = r.bars;
  $('#rampStep').value = r.step; $('#rampEvery').value = r.every; $('#rampRepeat').checked = r.repeat;
  $$('#rampMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === r.mode));
  $$('.smooth-only').forEach((el) => (el.hidden = r.mode !== 'smooth'));
  $$('.step-only').forEach((el) => (el.hidden = r.mode !== 'step'));
  $('#rampBody').hidden = !r.on;
  $('#gapOn').checked = metro.gap.on; $('#gapPlay').value = metro.gap.play; $('#gapMute').value = metro.gap.mute; $('#gapBody').hidden = !metro.gap.on;
  $('#flashOn').checked = S.flash;
  renderBeatDots(); updateRampSummary(); drawRamp();
}
function setBpm(v, quiet) {
  v = clamp(Math.round(v), 20, 280);
  metro.bpm = v;
  showBpm(v);
  $('#bpmRange').value = v;
  if (!quiet) persistMetro();
}
function showBpm(v) {
  $('#bpmVal').textContent = Math.round(v);
  $('#bpmMark').textContent = tempoMarking(v);
  $('#metroPillBpm').textContent = Math.round(v);
}
function renderBeatDots() {
  const box = $('#beatDots'); box.textContent = '';
  for (let i = 0; i < metro.beats; i++) {
    const b = document.createElement('button'); b.className = 'beat'; b.dataset.acc = metro.accents[i] ?? 1;
    b.setAttribute('aria-label', `Beat ${i + 1}`);
    b.addEventListener('click', () => {
      const cur = metro.accents[i] ?? 1; metro.accents[i] = cur === 2 ? 1 : cur === 1 ? 0 : 2;
      b.dataset.acc = metro.accents[i]; persistMetro();
    });
    box.append(b);
  }
}
let holdT;
function holdRepeat(btn, fn) {
  const stop = () => { clearTimeout(holdT); clearInterval(holdT); };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); holdT = setTimeout(() => { holdT = setInterval(fn, 70); }, 380); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
}
holdRepeat($('#bpmUp'), () => { if (metro.ramp.on && metro.running) return; setBpm(metro.bpm + 1); });
holdRepeat($('#bpmDown'), () => { if (metro.ramp.on && metro.running) return; setBpm(metro.bpm - 1); });
$('#bpmRange').addEventListener('input', (e) => setBpm(+e.target.value));
$('#tapBtn').addEventListener('pointerdown', makeTapper((v) => setBpm(v)));
$('#meterSel').addEventListener('change', (e) => { const m = meterInfo(e.target.value); metro.beats = m.beats; metro.accents = m.accents.slice(); renderBeatDots(); drawRamp(); persistMetro(); });
$('#subSel').addEventListener('change', (e) => { metro.subdiv = +e.target.value; persistMetro(); });
$('#soundSel').addEventListener('change', (e) => { metro.sound = e.target.value; persistMetro(); if (!metro.running) previewClick(); });
$('#metroVol').addEventListener('input', (e) => { metro.setVolume(+e.target.value); persistMetro(); });
$('#flashOn').addEventListener('change', (e) => { S.flash = e.target.checked; saveSettings(); });
function previewClick() { metro._ensureBuffers(); metro._play(getCtx().currentTime + 0.01, 0); }

function readRamp() {
  const r = metro.ramp;
  r.from = clamp(+$('#rampFrom').value || 60, 20, 280);
  r.to = clamp(+$('#rampTo').value || 100, 20, 280);
  r.bars = clamp(+$('#rampBars').value || 16, 1, 400);
  r.step = clamp(+$('#rampStep').value || 4, 1, 40);
  r.every = clamp(+$('#rampEvery').value || 4, 1, 64);
  r.repeat = $('#rampRepeat').checked;
  updateRampSummary(); drawRamp(); persistMetro();
}
['#rampFrom', '#rampTo', '#rampBars', '#rampStep', '#rampEvery'].forEach((s) => $(s).addEventListener('change', readRamp));
$('#rampRepeat').addEventListener('change', readRamp);
$('#rampOn').addEventListener('change', (e) => {
  metro.ramp.on = e.target.checked; $('#rampBody').hidden = !e.target.checked;
  if (e.target.checked && !metro.running) { $('#rampFrom').value = metro.bpm; readRamp(); }
  updateRampSummary(); persistMetro();
  if (metro.running) startMetro();
});
$$('#rampMode button').forEach((b) => b.addEventListener('click', () => {
  metro.ramp.mode = b.dataset.mode;
  $$('#rampMode button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.smooth-only').forEach((el) => (el.hidden = metro.ramp.mode !== 'smooth'));
  $$('.step-only').forEach((el) => (el.hidden = metro.ramp.mode !== 'step'));
  readRamp();
}));
function updateRampSummary() {
  const r = metro.ramp;
  if (!r.on) { $('#rampSummary').textContent = 'Gradually change tempo while you play'; return; }
  const dir = r.to >= r.from ? 'up' : 'down';
  $('#rampSummary').textContent = r.mode === 'smooth'
    ? `${r.from} → ${r.to} BPM, a little ${dir === 'up' ? 'faster' : 'slower'} every beat over ${r.bars} bars`
    : `${r.from} → ${r.to} BPM, ${dir === 'up' ? '+' : '−'}${r.step} every ${r.every} bar${r.every > 1 ? 's' : ''}`;
}
function drawRamp(progressBeat) {
  const c = $('#rampCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1; const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim();
  const r = metro.ramp;
  const totalBars = r.mode === 'smooth' ? r.bars : (Math.ceil(Math.abs(r.to - r.from) / r.step) + 1) * r.every;
  const beats = Math.max(1, totalBars * metro.beats);
  const lo = Math.min(r.from, r.to) - 4, hi = Math.max(r.from, r.to) + 4;
  const X = (b) => 6 + (b / beats) * (W - 12), Y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 26);
  g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(6, H - 14); g.lineTo(W - 6, H - 14); g.stroke();
  const pts = []; const saved = r.repeat; r.repeat = false;
  for (let b = 0; b <= beats; b += Math.max(1, beats / 200)) pts.push([X(b), Y(metro._tempoAt(Math.floor(b)))]);
  r.repeat = saved;
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineTo(W - 6, H - 14); g.lineTo(6, H - 14); g.closePath();
  g.fillStyle = accent; g.globalAlpha = 0.12; g.fill(); g.globalAlpha = 1;
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = accent; g.lineWidth = 2; g.stroke();
  g.fillStyle = muted; g.font = '600 10px ui-rounded, -apple-system, sans-serif';
  g.fillText(r.from, 6, Y(r.from) - 5); const tw = g.measureText(String(r.to)).width; g.fillText(r.to, W - 6 - tw, Y(r.to) - 5);
  g.fillText('bar 1', 6, H - 2); const ew = g.measureText('bar ' + totalBars).width; g.fillText('bar ' + totalBars, W - 6 - ew, H - 2);
  if (progressBeat !== undefined) {
    const b = r.repeat ? progressBeat % beats : Math.min(progressBeat, beats);
    g.beginPath(); g.arc(X(b), Y(metro._tempoAt(progressBeat)), 4.5, 0, Math.PI * 2); g.fillStyle = accent; g.fill();
  }
}

let beatTotal = 0;
metro.onBeat = (ev) => {
  const dots = $$('#beatDots .beat');
  dots.forEach((d, i) => d.classList.toggle('hit', i === ev.beat));
  const led = $('#metroLed'); led.classList.add('hit'); led.classList.toggle('acc', ev.acc === 2);
  setTimeout(() => { led.classList.remove('hit'); dots.forEach((d) => d.classList.remove('hit')); }, 110);
  if (ev.countIn) { $('#recNote').textContent = `Count-in ${ev.beat + 1}`; }
  if (!ev.countIn) { beatTotal++; showBpm(ev.bpm); if (metro.ramp.on && openPanel === 'metronome') drawRamp(beatTotal); }
  if (S.flash && ev.beat === 0 && !ev.muted) { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
};
metro.onStop = () => { updateMetroButtons(); showBpm(metro.bpm); };
function startMetro(opts) {
  unlock();
  beatTotal = -1;
  const t = metro.start(opts);
  updateMetroButtons();
  return t;
}
function stopMetro() { metro.stop(); }
function updateMetroButtons() {
  const on = metro.running;
  const b = $('#metroToggle'); b.innerHTML = on ? '<svg><use href="#i-stop"/></svg><span>Stop</span>' : '<svg><use href="#i-play"/></svg><span>Start</span>';
  $('#metroPill').hidden = !on;
  if (!on) $$('#beatDots .beat').forEach((d) => d.classList.remove('hit'));
}
$('#metroToggle').addEventListener('click', () => (metro.running ? stopMetro() : startMetro()));
$('#metroPillStop').addEventListener('click', stopMetro);

// =====================================================================
// Tuner & drone UI
// =====================================================================
const tuner = new Tuner();
const drone = new Drone();
(function buildDial() {
  const g = $('#dialTicks'); let s = '';
  for (let c = -50; c <= 50; c += 5) {
    const a = (c / 50) * 55 * Math.PI / 180;
    const major = c % 25 === 0, r1 = 128, r2 = major ? 112 : 119;
    const x1 = 150 + r1 * Math.sin(a), y1 = 160 - r1 * Math.cos(a), x2 = 150 + r2 * Math.sin(a), y2 = 160 - r2 * Math.cos(a);
    s += `<line class="tk${major ? ' major' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    if (major && c !== 0) { const xt = 150 + 142 * Math.sin(a), yt = 160 - 142 * Math.cos(a); s += `<text x="${xt.toFixed(1)}" y="${(yt + 4).toFixed(1)}" text-anchor="middle">${c > 0 ? '+' : ''}${c}</text>`; }
  }
  g.innerHTML = s;
  $('.dial .zone').setAttribute('y', '20');
})();
function showRef() { $('#refVal').textContent = S.ref + ' Hz'; tuner.ref = S.ref; drone.ref = S.ref; drone.refresh(); }
holdRepeat($('#refUp'), () => { S.ref = clamp(S.ref + 1, 400, 466); showRef(); saveSettings(); });
holdRepeat($('#refDown'), () => { S.ref = clamp(S.ref - 1, 400, 466); showRef(); saveSettings(); });
tuner.onReading = (r) => {
  const face = $('#tunerFace');
  if (!r) { face.classList.add('idle'); face.classList.remove('intune'); $('#tCents').textContent = 'Play a note'; $('#tHz').innerHTML = '&nbsp;'; return; }
  face.classList.remove('idle');
  const c = r.cents;
  $('#tNote').textContent = r.name; $('#tOct').textContent = r.octave;
  $('#tCents').textContent = Math.abs(c) < 2 ? 'In tune' : (c > 0 ? '+' : '−') + Math.abs(c).toFixed(0) + ' cents ' + (c > 0 ? 'sharp' : 'flat');
  $('#tHz').textContent = r.freq.toFixed(1) + ' Hz';
  $('#needle').style.transform = `rotate(${clamp(c, -50, 50) / 50 * 55}deg)`;
  face.classList.toggle('intune', Math.abs(c) < 3);
};
async function toggleTuner() {
  const b = $('#tunerToggle');
  if (tuner.running) { tuner.stop(); b.innerHTML = '<svg><use href="#i-mic"/></svg><span>Start tuner</span>'; b.classList.add('primary'); tuner.onReading(null); return; }
  try {
    await tuner.start();
    b.innerHTML = '<svg><use href="#i-stop"/></svg><span>Stop tuner</span>'; b.classList.remove('primary');
    $('#micHint').textContent = 'Listening. Nothing leaves this device.';
  } catch (e) { $('#micHint').textContent = micErrorText(e); }
}
$('#tunerToggle').addEventListener('click', toggleTuner);
$$('#tunerTabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tunerTabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('#tab-tune').hidden = b.dataset.tab !== 'tune'; $('#tab-drone').hidden = b.dataset.tab !== 'drone';
}));
(function buildNotes() {
  const box = $('#droneNotes');
  NOTE_NAMES.forEach((n, i) => {
    const b = document.createElement('button'); b.textContent = n; b.dataset.pc = i;
    b.addEventListener('click', () => { drone.pc = i; syncDrone(); drone.refresh(); persistDrone(); });
    box.append(b);
  });
})();
function syncDrone() {
  $$('#droneNotes button').forEach((b) => b.classList.toggle('on', +b.dataset.pc === drone.pc));
  $('#droneOct').value = drone.octave; $('#droneSound').value = drone.sound;
  $('#droneFifth').checked = drone.fifth; $('#droneOctave').checked = drone.lowOct; $('#droneVol').value = drone.volume;
  $('#dronePillNote').textContent = drone.label();
  const b = $('#droneToggle');
  b.innerHTML = drone.running ? '<svg><use href="#i-stop"/></svg><span>Stop drone</span>' : '<svg><use href="#i-play"/></svg><span>Start drone</span>';
  b.classList.toggle('primary', !drone.running);
  $('#dronePill').hidden = !drone.running;
}
function persistDrone() { S.drone = { pc: drone.pc, octave: drone.octave, sound: drone.sound, fifth: drone.fifth, lowOct: drone.lowOct, volume: drone.volume }; saveSettings(); }
$('#droneOct').addEventListener('change', (e) => { drone.octave = +e.target.value; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneSound').addEventListener('change', (e) => { drone.sound = e.target.value; drone.refresh(); persistDrone(); });
$('#droneFifth').addEventListener('change', (e) => { drone.fifth = e.target.checked; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneOctave').addEventListener('change', (e) => { drone.lowOct = e.target.checked; drone.refresh(); persistDrone(); });
$('#droneVol').addEventListener('input', (e) => { drone.setVolume(+e.target.value); persistDrone(); });
$('#droneToggle').addEventListener('click', () => { unlock(); drone.running ? drone.stop() : drone.start(); syncDrone(); });
$('#dronePillStop').addEventListener('click', () => { drone.stop(); syncDrone(); });

// =====================================================================
// Recording
// =====================================================================
const recorder = new Recorder();
let recState = null; // {startAt, metroByUs, raf}
async function startRecording() {
  unlock();
  hidePanel();
  if (player.playing) player.pause();
  try { await recorder.prepare(); } catch (e) { toast(micErrorText(e), 5000); return; }
  if (tuner.running) toggleTuner();
  const ctx = getCtx();
  let startAt = 0, metroByUs = false;
  if (S.countIn && !metro.running) {
    const keep = S.clickWhileRec;
    const t0 = startMetro({ countInBars: 1, stopAfterCountIn: !keep, onCountInDone: () => { $('#recNote').textContent = keep ? 'Click on' : ''; } });
    startAt = t0 + metro.beats * 60 / metro.countInBpm;
    metroByUs = true;
    $('#recNote').textContent = 'Count-in';
  } else if (S.clickWhileRec && !metro.running) {
    startMetro(); metroByUs = true;
    $('#recNote').textContent = 'Click on';
  } else $('#recNote').textContent = '';
  recorder.start(startAt);
  recState = { startAt: startAt || ctx.currentTime, metroByUs, page: V.page };
  $('#recPill').hidden = false; $('#recBtn').classList.add('on');
  const meter = $('#recMeter'), mg = meter.getContext('2d');
  let level = 0;
  recorder.onLevel = (p) => { level = Math.max(p, level * 0.92); };
  const cs = getComputedStyle(document.documentElement);
  const loop = () => {
    if (!recState) return;
    const t = ctx.currentTime - recState.startAt;
    $('#recTime').textContent = t < 0 ? '–' + Math.ceil(-t) : fmtTime(t);
    const W = meter.width, H = meter.height;
    mg.clearRect(0, 0, W, H);
    mg.fillStyle = cs.getPropertyValue('--sunk'); mg.fillRect(0, 0, W, H);
    const db = 20 * Math.log10(level + 1e-6); const x = clamp((db + 60) / 60, 0, 1) * W;
    mg.fillStyle = level > 0.95 ? cs.getPropertyValue('--rec') : level > 0.6 ? cs.getPropertyValue('--warn') : cs.getPropertyValue('--good');
    mg.fillRect(0, 0, x, H);
    recState.raf = requestAnimationFrame(loop);
  };
  loop();
}
async function stopRecording() {
  if (!recState) return;
  const st = recState; recState = null;
  cancelAnimationFrame(st.raf);
  if (st.metroByUs && metro.running) stopMetro();
  $('#recPill').hidden = true; $('#recBtn').classList.remove('on');
  const { data, sr } = await recorder.stop();
  if (data.length < sr * 0.4) { toast('That was too short to keep.'); return; }
  const existing = V.score ? await db.byIndex('takes', 'score', V.score.id) : [];
  const take = {
    id: uid(), scoreId: V.score ? V.score.id : null, page: st.page, name: 'Take ' + (existing.length + 1),
    created: Date.now(), sr, dur: data.length / sr, peaks: computePeaks(data), peak: peakOf(data), fav: false,
  };
  await db.put('files', { id: 'audio:' + take.id, data });
  await db.put('takes', take);
  takesScope = V.score ? 'score' : 'all';
  showPanel('takes');
  await selectTake(take.id);
}
$('#recBtn').addEventListener('click', () => (recState ? stopRecording() : startRecording()));
$('#recStop').addEventListener('click', stopRecording);

// =====================================================================
// Takes & player
// =====================================================================
const player = new Player();
let takesScope = 'score', currentTake = null;
player.room = S.room; player.wet = S.wet; player.autoLevel = S.autoLevel;
$$('#takesScope button').forEach((b) => b.addEventListener('click', () => { takesScope = b.dataset.scope; refreshTakes(); }));

async function refreshTakes() {
  if (!V.score && takesScope === 'score') takesScope = 'all';
  $$('#takesScope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === takesScope));
  $('#takesScope button[data-scope="score"]').hidden = !V.score;
  let takes = takesScope === 'score' && V.score ? await db.byIndex('takes', 'score', V.score.id) : await db.all('takes');
  takes.sort((a, b) => (b.fav - a.fav) || (b.created - a.created));
  const titles = new Map(scores.map((s) => [s.id, s.title])); if (V.score) titles.set(V.score.id, V.score.title);
  const ul = $('#takeList'); ul.textContent = '';
  $('#takesEmpty').hidden = takes.length > 0;
  const cs = getComputedStyle(document.documentElement);
  for (const t of takes) {
    const li = document.createElement('li'); li.className = 'take' + (currentTake && currentTake.id === t.id ? ' on' : '');
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 56;
    drawMini(cv, t.peaks, cs.getPropertyValue('--muted'));
    const main = document.createElement('div'); main.className = 'tk-main';
    const nm = document.createElement('div'); nm.className = 'tk-name';
    if (t.fav) nm.innerHTML = '<svg><use href="#i-star"/></svg>';
    nm.append(document.createTextNode(t.name));
    const sub = document.createElement('div'); sub.className = 'tk-sub';
    const when = new Date(t.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    sub.textContent = (takesScope === 'all' && t.scoreId ? (titles.get(t.scoreId) || 'Score') + ' · ' : '') + (t.scoreId ? 'p. ' + (t.page + 1) + ' · ' : '') + when;
    main.append(nm, sub);
    const dur = document.createElement('span'); dur.className = 'tk-dur num'; dur.textContent = fmtTime(t.dur);
    li.append(cv, main, dur);
    li.addEventListener('click', () => selectTake(t.id));
    ul.append(li);
  }
}
function drawMini(cv, peaks, color) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.fillStyle = color;
  const n = 40, step = peaks.length / n; let max = 0.0001; for (const p of peaks) max = Math.max(max, p);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) m = Math.max(m, peaks[j]); const h = Math.max(2, (m / max) * H); g.fillRect(i * (W / n) + 1, (H - h) / 2, W / n - 2, h); }
}
async function selectTake(id) {
  const t = await db.get('takes', id); const f = await db.get('files', 'audio:' + id);
  if (!t || !f) { toast('That recording could not be loaded.'); return; }
  t.data = f.data;
  currentTake = t;
  player.load(t);
  $('#player').hidden = false; $('#delConfirm').hidden = true;
  $('#takeName').value = t.name;
  const sc = t.scoreId ? (scores.find((s) => s.id === t.scoreId) || V.score) : null;
  $('#takeMeta').textContent = (sc ? sc.title + ' · p. ' + (t.page + 1) + ' · ' : '') + new Date(t.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('#takeFav').classList.toggle('on', !!t.fav);
  syncPlayerControls();
  refreshTakes();
  requestAnimationFrame(drawWave);
}
function syncPlayerControls() {
  const sp = Math.round(player.rate * 100);
  $('#speedVal').textContent = sp + '%'; $('#speedRange').value = sp;
  $$('#speedChips button').forEach((b) => b.classList.toggle('on', Math.round(+b.dataset.speed * 100) === sp));
  $$('#revRoom button').forEach((b) => b.classList.toggle('on', b.dataset.room === player.room));
  $('#revAmt').value = Math.round(player.wet * 100); $('#revAmt').disabled = player.room === 'dry';
  $('#revVal').textContent = player.room === 'dry' ? 'Off' : ROOMS[player.room].label + ' · ' + Math.round(player.wet * 100) + '%';
  $('#autoLevel').checked = player.autoLevel;
}
player.onState = () => {
  const p = $('#playBtn'); p.innerHTML = player.playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>';
  p.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  $('#loopBtn').classList.toggle('on', player.loop);
  $('#tLoop').textContent = player.loop && player.b > player.a ? `Looping ${fmtTime(player.a, true)} – ${fmtTime(player.b, true)}` : 'Drag on the waveform to loop a passage';
  $('#tDur').textContent = fmtTime(player.duration, true);
  if (player.playing) animateWave(); else drawWave();
};
player.onBusy = (on) => { $('#waveBusy').hidden = !on; };
$('#playBtn').addEventListener('click', () => { unlock(); player.playing ? player.pause() : player.play(); });
$('#loopBtn').addEventListener('click', () => {
  if (player.loop) player.setLoop(false);
  else if (player.b > player.a) player.setLoop(true);
  else player.setLoop(true, 0, player.duration);
});
const setSpeed = (v) => { player.setRate(v); syncPlayerControls(); };
$$('#speedChips button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('#speedRange').addEventListener('change', (e) => setSpeed(+e.target.value / 100));
$('#speedRange').addEventListener('input', (e) => { $('#speedVal').textContent = e.target.value + '%'; });
$$('#revRoom button').forEach((b) => b.addEventListener('click', () => { player.setRoom(b.dataset.room); S.room = player.room; saveSettings(); syncPlayerControls(); }));
$('#revAmt').addEventListener('input', (e) => { player.setWet(+e.target.value / 100); S.wet = player.wet; saveSettings(); syncPlayerControls(); });
$('#autoLevel').addEventListener('change', (e) => { player.setAutoLevel(e.target.checked); S.autoLevel = player.autoLevel; saveSettings(); });
$('#takeName').addEventListener('change', async (e) => {
  if (!currentTake) return; const t = await db.get('takes', currentTake.id); t.name = e.target.value.trim() || t.name; currentTake.name = t.name; await db.put('takes', t); refreshTakes();
});
$('#takeFav').addEventListener('click', async () => {
  if (!currentTake) return; const t = await db.get('takes', currentTake.id); t.fav = !t.fav; currentTake.fav = t.fav; await db.put('takes', t);
  $('#takeFav').classList.toggle('on', t.fav); refreshTakes();
});
$('#delTake').addEventListener('click', () => { $('#delConfirm').hidden = false; });
$('#delNo').addEventListener('click', () => { $('#delConfirm').hidden = true; });
$('#delYes').addEventListener('click', async () => {
  if (!currentTake) return;
  player.stop();
  await db.del('takes', currentTake.id); await db.del('files', 'audio:' + currentTake.id);
  currentTake = null; $('#player').hidden = true; refreshTakes(); toast('Recording deleted');
});
async function exportTake() {
  if (!currentTake) return;
  const btn = $('#exportBtn'); btn.disabled = true; toast('Preparing the file…', 10000);
  try {
    const blob = await player.exportWav();
    const name = (currentTake.name || 'Take').replace(/[\\/:*?"<>|]+/g, '') + (player.rate !== 1 ? ` (${Math.round(player.rate * 100)}%)` : '') + '.wav';
    const file = new File([blob], name, { type: 'audio/wav' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      $('#toast').hidden = true;
      await navigator.share({ files: [file], title: name }).catch(() => {});
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000); toast('Saved ' + name);
    }
  } catch (e) { console.error(e); toast('The export failed. Try a shorter loop.'); }
  btn.disabled = false;
}
$('#exportBtn').addEventListener('click', exportTake);
$('#shareBtn').addEventListener('click', exportTake);

// waveform
const wave = $('#wave');
let waveRaf = 0;
function animateWave() { cancelAnimationFrame(waveRaf); const f = () => { drawWave(); if (player.playing) waveRaf = requestAnimationFrame(f); }; f(); }
function drawWave() {
  if (!currentTake || wave.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = wave.clientWidth, H = wave.clientHeight;
  if (wave.width !== Math.round(W * dpr)) { wave.width = Math.round(W * dpr); wave.height = Math.round(H * dpr); }
  const g = wave.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent').trim(), muted = cs.getPropertyValue('--muted').trim(), ink = cs.getPropertyValue('--ink').trim();
  const dur = player.duration || 1, pos = player.currentPos();
  const peaks = currentTake.peaks; let max = 0.0001; for (const p of peaks) max = Math.max(max, p);
  if (player.b > player.a) {
    const xa = (player.a / dur) * W, xb = (player.b / dur) * W;
    g.fillStyle = accent; g.globalAlpha = player.loop ? 0.16 : 0.08; g.fillRect(xa, 0, xb - xa, H); g.globalAlpha = 1;
    g.fillStyle = accent; g.fillRect(xa - 1, 0, 2, H); g.fillRect(xb - 1, 0, 2, H);
  }
  const bars = Math.floor(W / 3), px = pos / dur * W;
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / bars) * peaks.length));
    let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j]);
    const h = Math.max(1.5, Math.pow(m / max, 0.8) * (H - 16));
    g.fillStyle = i * 3 < px ? accent : muted; g.globalAlpha = i * 3 < px ? 1 : 0.55;
    g.fillRect(i * 3, (H - h) / 2, 2, h);
  }
  g.globalAlpha = 1; g.fillStyle = ink; g.fillRect(px - 1, 4, 2, H - 8);
  $('#tPos').textContent = fmtTime(pos, true);
}
let wdown = null;
wave.addEventListener('pointerdown', (e) => {
  if (!currentTake) return;
  wave.setPointerCapture(e.pointerId);
  const r = wave.getBoundingClientRect(); const t = ((e.clientX - r.left) / r.width) * player.duration;
  wdown = { x: e.clientX, t, sel: false };
});
wave.addEventListener('pointermove', (e) => {
  if (!wdown) return;
  if (Math.abs(e.clientX - wdown.x) > 8) wdown.sel = true;
  if (wdown.sel) {
    const r = wave.getBoundingClientRect(); const t = clamp(((e.clientX - r.left) / r.width) * player.duration, 0, player.duration);
    player.a = Math.min(wdown.t, t); player.b = Math.max(wdown.t, t); drawWave();
  }
});
wave.addEventListener('pointerup', () => {
  if (!wdown) return; const d = wdown; wdown = null;
  if (d.sel && player.b - player.a > 0.25) { player.setLoop(true, player.a, player.b); }
  else { if (d.sel) { player.a = player.b = 0; } player.seek(d.t); }
});
window.addEventListener('resize', () => requestAnimationFrame(drawWave));

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  await loadSettings();
  player.room = S.room; player.wet = S.wet; player.autoLevel = S.autoLevel;
  if (S.metro) applyMetroSettings(S.metro); else { applyMetroSettings({ bpm: 80, meter: '4' }); }
  if (S.drone) Object.assign(drone, S.drone);
  showRef(); syncDrone(); syncPlayerControls();
  $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === S.sort));
  await refreshLibrary();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
