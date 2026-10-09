import { db, getSetting, setSetting, uid } from './db.js';
import { getCtx, unlock, micErrorText } from './audio.js';
import { Metronome, makeTapper, tempoMarking, meterInfo } from './metronome.js';
import { Tuner, Drone, freqToNote, playHarmonics, stopHarmonics, playRefTone } from './tuner.js';
import { NOTE_NAMES, SYSTEMS, INSTRUMENTS, stringTargets, etFreq, midiName } from './temperament.js';
import { ScalePlayer, SCALE_TYPES } from './scales.js';
import { Recorder, Player, computePeaks, peakOf, ROOMS } from './recorder.js';
import { VideoRecorder, decodeVideoAudio, videoThumb } from './video.js';
import { openDocument, makeThumb, InkLayer } from './score.js';
import { searchWorks, workFiles, rankFiles, splitTitle, fileUrl, workUrl } from './imslp.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s, tenths) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0')); };
const fmtMinutes = (sec) => { const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };

let toastTimer;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

// Any first tap wakes the audio engine (iOS requirement).
let unlocked = false;
document.addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; unlock(); } else getCtx(); }, { capture: true });

// =====================================================================
// Settings
// =====================================================================
const S = {
  ref: 442, twoUp: true, halfTurn: false, paper: 'white', countIn: true, clickWhileRec: false, cam: 'user',
  room: 'studio', wet: 0.18, autoLevel: true, sort: 'recent', flash: false,
  instrument: 'cello', system: 'equal', key: 0, pureFifths: true,
  metro: null, drone: null, scale: null, hometab: 'mine',
};
async function loadSettings() { const saved = await getSetting('settings', {}); Object.assign(S, saved || {}); }
let saveT; function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => setSetting('settings', S), 300); }

// =====================================================================
// Panels
// =====================================================================
let openPanel = null;
function showPanel(name, tab) {
  if (openPanel === name && !tab) { hidePanel(); return; }
  hidePanel();
  const p = $('#panel-' + name); if (!p) return;
  p.hidden = false; openPanel = name;
  $$(`[data-panel="${name}"]`).forEach((b) => { if (!b.dataset.tab || b.dataset.tab === tab) b.classList.add('on'); });
  if (name === 'tuner') setTunerTab(tab || currentTunerTab);
  if (name === 'takes') refreshTakes();
  if (name === 'metronome') drawRamp();
  if (name === 'settings') fillScoreSettings();
  if (name === 'scales') renderScaleStrip();
}
function hidePanel() {
  if (!openPanel) return;
  $('#panel-' + openPanel).hidden = true;
  $$('[data-panel].on').forEach((b) => b.classList.remove('on'));
  if (openPanel === 'settings') saveScoreMeta();
  openPanel = null;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-panel]'); if (b) { showPanel(b.dataset.panel, b.dataset.tab); return; }
  if (e.target.closest('[data-close]')) hidePanel();
  const g = e.target.closest('[data-goto]'); if (g) setHomeTab(g.dataset.goto);
});
// Tapping outside an open panel closes it, and that tap does nothing else.
let swallowClick = false;
document.addEventListener('pointerdown', (e) => {
  swallowClick = false;
  if (!openPanel) return;
  if (e.target.closest('.panel, .topbar, .dock, .tiles, .inkbar, .toast, .cam')) return;
  e.stopPropagation(); swallowClick = true; hidePanel();
}, { capture: true });
document.addEventListener('pointerup', (e) => { if (swallowClick) e.stopPropagation(); }, { capture: true });
document.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, { capture: true });

// =====================================================================
// Home
// =====================================================================
function setHomeTab(t) {
  S.hometab = t; saveSettings();
  $$('#homeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.hometab === t));
  $('#tab-mine').hidden = t !== 'mine'; $('#tab-find').hidden = t !== 'find';
  if (t === 'find') setTimeout(() => { if (!$('#findInput').value) $('#findInput').focus({ preventScroll: true }); }, 50);
}
$$('#homeTabs button').forEach((b) => b.addEventListener('click', () => setHomeTab(b.dataset.hometab)));

let scores = [];
const thumbURLs = new Map();
async function refreshLibrary() {
  scores = await db.all('scores').catch(() => []);
  renderGrid();
  renderToday();
}
function renderGrid() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const list = scores.filter((s) => !q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q));
  const by = S.sort;
  list.sort((a, b) => by === 'title' ? a.title.localeCompare(b.title)
    : by === 'composer' ? (a.composer || '~').localeCompare(b.composer || '~') || a.title.localeCompare(b.title)
      : (b.opened || b.added) - (a.opened || a.added));
  const grid = $('#grid'); grid.textContent = '';
  $('#emptyLib').hidden = scores.length > 0;
  $('.lib-bar').hidden = scores.length === 0;
  for (const s of list) {
    const b = el('button', 'card');
    const th = el('div', 'thumb');
    if (s.thumb) {
      if (!thumbURLs.has(s.id)) thumbURLs.set(s.id, URL.createObjectURL(s.thumb));
      th.style.backgroundImage = `url(${thumbURLs.get(s.id)})`;
    }
    th.append(el('span', 'badge', s.pages + (s.pages === 1 ? ' page' : ' pages')));
    b.append(th, el('div', 'ttl', s.title), el('div', 'cmp', s.composer || (s.seconds > 59 ? fmtMinutes(s.seconds) + ' practised' : 'Not practised yet')));
    b.addEventListener('click', () => openScore(s.id));
    grid.append(b);
  }
}
async function renderToday() {
  const log = (await getSetting('log', {})) || {};
  const today = log[dayKey()] || 0;
  let week = 0; const d = new Date();
  for (let i = 0; i < 7; i++) { week += log[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  $('#todayStat').textContent = today < 60 && week < 60 ? 'No practice logged yet today' : `Today ${fmtMinutes(today)} · last 7 days ${fmtMinutes(week)}`;
}
$('#searchInput').addEventListener('input', renderGrid);
$$('#sortSeg button').forEach((b) => b.addEventListener('click', () => {
  S.sort = b.dataset.sort; saveSettings();
  $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderGrid();
}));

function niceTitle(name) {
  return name.replace(/\.(pdf|jpe?g|png|heic|webp)$/i, '').replace(/^IMSLP\d+-/, '').replace(/^PMLP\d+-/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
// Files downloaded from IMSLP through Stand get their real title and composer.
async function imslpMetaFor(name) {
  const picks = (await getSetting('imslpPicks', {})) || {};
  const idx = (name.match(/IMSLP(\d+)/g) || []).map((m) => m.slice(5));
  for (const i of idx) if (picks[i]) return picks[i];
  const base = name.replace(/\.pdf$/i, '');
  for (const p of Object.values(picks)) if (p.file && base.includes(p.file.replace(/\.pdf$/i, '').replace(/ /g, '_'))) return p;
  return null;
}
$('#importInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  let added = 0;
  toast(files.length > 1 ? `Importing ${files.length} files…` : 'Importing…', 10000);
  for (const f of pdfs) {
    try {
      const data = await f.arrayBuffer();
      const file = { id: uid(), kind: 'pdf', data };
      const doc = await openDocument(file);
      const thumb = await makeThumb(doc);
      const meta = await imslpMetaFor(f.name);
      const score = { id: uid(), fileId: file.id, title: meta ? meta.title : niceTitle(f.name), composer: meta ? meta.composer : '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb, source: meta ? 'IMSLP' : '' };
      doc.destroy();
      await db.put('files', file); await db.put('scores', score); added++;
    } catch (err) { console.error(err); toast(`Could not open ${f.name}. Is it a PDF?`); }
  }
  if (imgs.length) {
    try {
      const file = { id: uid(), kind: 'images', data: imgs };
      const doc = await openDocument(file);
      const thumb = await makeThumb(doc);
      const score = { id: uid(), fileId: file.id, title: niceTitle(imgs[0].name), composer: '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb };
      doc.destroy();
      await db.put('files', file); await db.put('scores', score); added++;
    } catch (err) { console.error(err); toast('Those photos could not be read.'); }
  }
  setHomeTab('mine');
  await refreshLibrary();
  if (added) toast(added === 1 ? 'Score added to your stand' : `${added} scores added`);
});

// =====================================================================
// Find on IMSLP
// =====================================================================
const EXAMPLES = {
  cello: ['Elgar cello concerto', 'Bach cello suites', 'Fauré élégie', 'Popper Hungarian rhapsody', 'Saint-Saëns swan', 'Brahms cello sonata 1'],
  violin: ['Bach partita 2', 'Mendelssohn violin concerto', 'Kreutzer etudes', 'Bruch violin concerto 1', 'Massenet méditation'],
  viola: ['Brahms viola sonata', 'Bach cello suites viola', 'Stamitz viola concerto', 'Hindemith viola'],
  bass: ['Bottesini concerto', 'Dragonetti concerto', 'Simandl'],
  flute: ['Mozart flute concerto G', 'Fauré fantaisie', 'Bach flute sonata', 'Andersen etudes', 'Doppler fantaisie pastorale'],
  default: ['Bach cello suites', 'Mozart sonata', 'Chopin nocturne', 'Schubert ave maria', 'Debussy clair de lune'],
};
function fillInstrumentSelects() {
  for (const sel of [$('#instSel'), $('#tunerInst')]) {
    sel.textContent = '';
    for (const [k, v] of Object.entries(INSTRUMENTS)) { const o = el('option', '', v.label); o.value = k; sel.append(o); }
    sel.value = S.instrument;
  }
}
function setInstrument(k) {
  S.instrument = k; saveSettings();
  $('#instSel').value = k; $('#tunerInst').value = k;
  renderExamples(); updateTunerSetup();
  if (currentWork) renderWork(currentWork);
}
$('#instSel').addEventListener('change', (e) => setInstrument(e.target.value));
$('#tunerInst').addEventListener('change', (e) => setInstrument(e.target.value));
function renderExamples() {
  const box = $('#findExamples'); box.textContent = '';
  for (const q of EXAMPLES[S.instrument] || EXAMPLES.default) {
    const b = el('button', '', q);
    b.addEventListener('click', () => { $('#findInput').value = q; runSearch(); });
    box.append(b);
  }
}
let searchToken = 0;
async function runSearch() {
  const q = $('#findInput').value.trim();
  if (!q) return;
  $('#findInput').blur();
  const token = ++searchToken;
  $('#workView').hidden = true; $('#findList').hidden = false; $('#findIntro').hidden = true;
  const st = $('#findStatus'); st.hidden = false; st.textContent = 'Searching IMSLP…';
  $('#workList').textContent = '';
  try {
    const res = await searchWorks(q);
    if (token !== searchToken) return;
    const list = res.results;
    if (!list.length) { st.textContent = 'Nothing found. Try the composer’s surname and one word of the title, for example “Fauré élégie”.'; return; }
    st.textContent = res.browse ? `All ${list.length} works by ${res.composer.n} on IMSLP` : (res.composer ? `Works by ${res.composer.n}` : 'Results from IMSLP');
    renderWorkList(list, res.browse ? 80 : 30);
  } catch (e) {
    console.error(e);
    if (token === searchToken) st.textContent = 'IMSLP did not answer. Check the internet connection and try again.';
  }
}
function renderWorkList(list, limit) {
  const ul = $('#workList'); ul.textContent = '';
  list.slice(0, limit).forEach((r) => {
    const { work, composer } = splitTitle(r.title);
    const li = el('li'); const b = el('button');
    const main = el('div', 'w-main'); main.append(el('div', 'w-title', work), el('div', 'w-comp', composer));
    const chev = icon('i-back'); chev.classList.add('chev');
    b.append(main, chev);
    b.addEventListener('click', () => openWork(r.title));
    li.append(b); ul.append(li);
  });
  if (list.length > limit) {
    const li = el('li'); const b = el('button', ''); b.append(el('div', 'w-main', `Show all ${list.length}`));
    b.addEventListener('click', () => renderWorkList(list, list.length)); li.append(b); ul.append(li);
  }
}
$('#findForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });

let currentWork = null;
async function openWork(title) {
  $('#findList').hidden = true; $('#workView').hidden = false;
  const { work, composer } = splitTitle(title);
  $('#workTitle').textContent = work; $('#workComposer').textContent = composer;
  $('#workOpen').href = workUrl(title);
  $('#workPicks').textContent = ''; $('#workGroups').textContent = '';
  const st = $('#workStatus'); st.hidden = false; st.textContent = 'Reading the editions on IMSLP…';
  $('#library').scrollTo({ top: 0 });
  currentWork = null;
  try {
    const data = await workFiles(title);
    currentWork = data;
    const sp = splitTitle(data.title);
    $('#workTitle').textContent = sp.work; $('#workComposer').textContent = sp.composer;
    renderWork(data);
  } catch (e) {
    console.error(e);
    st.textContent = 'This piece could not be loaded from IMSLP. Try again, or open the IMSLP page.';
  }
}
$('#workBack').addEventListener('click', () => { $('#workView').hidden = true; $('#findList').hidden = false; currentWork = null; });

function fileMeta(f) {
  const bits = [];
  if (f.heading && f.group !== 'Full scores' && f.heading.length < 70) bits.push(f.heading);
  bits.push(f.downloads.toLocaleString() + ' downloads');
  if (f.pages) bits.push(f.pages + (f.pages === 1 ? ' page' : ' pages'));
  const src = f.arranger ? 'arr. ' + f.arranger : (f.editor && !/first edition|unknown/i.test(f.editor) ? 'ed. ' + f.editor : '');
  if (src) bits.push(src);
  if (f.publisher) bits.push(f.publisher.slice(0, 60));
  return bits.join(' · ');
}
function downloadLink(f, big) {
  const a = el('a', big ? 'btn primary' : 'icon-btn');
  a.href = fileUrl(f.index); a.target = '_blank'; a.rel = 'noopener';
  a.append(icon('i-download'));
  if (big) a.append(el('span', '', 'Download'));
  else a.setAttribute('aria-label', 'Download ' + f.label);
  a.addEventListener('click', () => rememberPick(f));
  return a;
}
async function rememberPick(f) {
  const picks = (await getSetting('imslpPicks', {})) || {};
  const sp = splitTitle(currentWork.title);
  const part = f.label && !/^complete score$/i.test(f.label) ? ' · ' + f.label : '';
  picks[f.index] = { title: sp.work + part, composer: sp.composer, file: f.file, at: Date.now() };
  const keys = Object.keys(picks); if (keys.length > 200) delete picks[keys[0]];
  await setSetting('imslpPicks', picks);
  toast('Accept IMSLP’s terms on their page to download. Then come back and tap Import score.', 6000);
}
function renderWork(data) {
  const inst = INSTRUMENTS[S.instrument];
  const { picks, groups, mostDownloaded } = rankFiles(data.files, inst.words);
  const st = $('#workStatus');
  if (!data.files.length) { st.hidden = false; st.textContent = 'IMSLP has no PDF scores for this page. It may hold only recordings, or the work is still under copyright.'; return; }
  st.hidden = true;
  const pk = $('#workPicks'); pk.textContent = '';
  const whyText = { mine: `Best for ${inst.label.toLowerCase()}`, score: 'Most downloaded full score', top: 'Most downloaded overall' };
  picks.forEach((p, i) => {
    const c = el('div', 'pick' + (i === 0 ? ' best' : ''));
    const why = el('div', 'why'); why.append(icon('i-star'), document.createTextNode(whyText[p.why])); c.append(why);
    c.append(el('div', 'pl', p.f.label), el('div', 'pm', fileMeta(p.f)));
    c.append(downloadLink(p.f, true));
    pk.append(c);
  });
  const gbox = $('#workGroups'); gbox.textContent = '';
  for (const g of ['Parts', 'Full scores', 'Arrangements', 'Vocal scores', 'Other']) {
    const list = groups[g]; if (!list) continue;
    const sec = el('section', 'fgroup');
    sec.append(el('h3', '', `${g} · ${list.length}`));
    const ul = el('ul', 'flist');
    const draw = (n) => {
      ul.textContent = '';
      list.slice(0, n).forEach((f) => {
        const li = el('li'); const main = el('div', 'f-main');
        const lab = el('div', 'f-label', f.label);
        if (f.mine) lab.append(el('span', 'tag', 'For ' + inst.label.toLowerCase()));
        if (f.index === mostDownloaded) lab.append(el('span', 'tag top', 'Most downloaded'));
        if (/non-pd|copyright/i.test(f.copyright) && !/public domain/i.test(f.copyright)) lab.append(el('span', 'tag', 'Check copyright'));
        main.append(lab, el('div', 'f-meta', fileMeta(f)));
        li.append(main, downloadLink(f, false));
        ul.append(li);
      });
    };
    draw(6);
    sec.append(ul);
    if (list.length > 6) {
      const more = el('button', 'btn small more-btn', `Show all ${list.length}`);
      more.addEventListener('click', () => { draw(list.length); more.remove(); });
      sec.append(more);
    }
    gbox.append(sec);
  }
}

// =====================================================================
// Score viewer
// =====================================================================
const V = { score: null, doc: null, page: 0, spread: 1, half: false, cache: new Map(), layers: [], inking: false, tool: 'pen', color: '#1b1d22', undo: [] };
const stage = $('#stage');
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }

async function openScore(id) {
  const score = await db.get('scores', id);
  const file = score && await db.get('files', score.fileId);
  if (!file) { toast('This score’s file is missing.'); return; }
  V.score = score; V.cache.clear(); V.undo = []; V.half = false;
  try { V.doc = await openDocument(file); } catch (e) { console.error(e); toast('The score could not be opened.'); return; }
  V.page = clamp(score.lastPage || 0, 0, V.doc.pages - 1);
  score.opened = Date.now(); db.put('scores', score);
  hidePanel();
  $('#library').hidden = true; $('#score').hidden = false; document.body.classList.remove('at-home');
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
  $('#score').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home');
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
  const canvas = el('canvas', 'art');
  const p = V.doc.render(i, canvas, pw, ph).then(() => canvas);
  V.cache.set(key, p);
  while (V.cache.size > 12) V.cache.delete(V.cache.keys().next().value);
  return p;
}
let layoutToken = 0;
async function layout(fade) {
  if (!V.doc) return;
  const token = ++layoutToken;
  V.spread = spreadSize();
  if (V.spread === 2) V.half = false;
  const spread = el('div', 'spread');
  V.layers = [];
  let label;
  if (V.half && V.page + 1 < V.doc.pages) {
    const [box] = pageBox([V.page]);
    const [cur, next] = await Promise.all([renderPage(V.page, box[0], box[1]), renderPage(V.page + 1, box[0], box[1])]);
    if (token !== layoutToken) return;
    const pg = el('div', 'pg'); pg.style.width = box[0] + 'px'; pg.style.height = box[1] + 'px';
    cur.className = 'art bottom-half'; next.className = 'art top-half';
    pg.append(cur, next, el('div', 'half-line'));
    spread.append(pg);
    label = `${V.page + 2} top · ${V.page + 1} bottom`;
  } else {
    V.half = false;
    const idx = [V.page]; if (V.spread === 2 && V.page + 1 < V.doc.pages) idx.push(V.page + 1);
    const boxes = pageBox(idx);
    const canvases = await Promise.all(idx.map((i, k) => renderPage(i, boxes[k][0], boxes[k][1])));
    if (token !== layoutToken) return;
    idx.forEach((i, k) => {
      const pg = el('div', 'pg'); pg.style.width = boxes[k][0] + 'px'; pg.style.height = boxes[k][1] + 'px';
      const art = canvases[k]; art.className = 'art';
      const ink = el('canvas', 'ink'); ink.width = art.width; ink.height = art.height;
      pg.append(art, ink); spread.append(pg);
      const layer = new InkLayer(ink, V.score.id, i); layer.load(); V.layers.push(layer); attachInk(ink, layer);
    });
    label = idx.length > 1 ? `${idx[0] + 1}–${idx[1] + 1}` : `${idx[0] + 1}`;
  }
  stage.textContent = '';
  stage.append(spread);
  if (fade && !matchMedia('(prefers-reduced-motion: reduce)').matches) { spread.classList.add('fade'); requestAnimationFrame(() => requestAnimationFrame(() => spread.classList.remove('fade'))); }
  $('#pageLabel').textContent = label + ' / ' + V.doc.pages;
  $('#pageRange').value = V.page + 1;
  setTimeout(() => {
    if (token !== layoutToken || !V.doc) return;
    for (const start of [V.page + V.spread, V.page - V.spread, V.page + 1]) {
      if (start < 0 || start >= V.doc.pages) continue;
      const ids = [start]; if (V.spread === 2 && start + 1 < V.doc.pages) ids.push(start + 1);
      pageBox(ids).forEach((b, k) => renderPage(ids[k], b[0], b[1]));
    }
  }, 60);
}
function turn(dir) {
  if (!V.doc) return;
  if (S.halfTurn && V.spread === 1) {
    if (dir > 0) {
      if (!V.half && V.page + 1 < V.doc.pages) { V.half = true; layout(true); return; }
      if (V.half) { V.half = false; V.page++; V.score.lastPage = V.page; layout(true); return; }
      return;
    }
    if (V.half) { V.half = false; layout(true); return; }
  }
  const next = clamp(V.page + dir * V.spread, 0, Math.max(0, V.doc.pages - 1));
  if (next === V.page) return;
  V.page = next; V.half = false; V.score.lastPage = next;
  layout(true);
}
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (V.doc) { V.cache.clear(); layout(); } }, 150); });
$('#pageRange').addEventListener('input', (e) => { V.page = clamp(+e.target.value - 1, 0, V.doc.pages - 1); V.half = false; layout(); });

let chromeTimer;
function showChrome(on) { clearTimeout(chromeTimer); $('#score').classList.toggle('chrome-off', !on); }
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
  if (on && V.half) { V.half = false; layout(); }
  V.inking = on;
  $('#inkbar').hidden = !on; $('#inkBtn').classList.toggle('on', on);
  stage.classList.toggle('inking', on);
  if (on) { showChrome(true); hidePanel(); }
}
$('#inkBtn').addEventListener('click', () => setInking(!V.inking));
$('#inkDone').addEventListener('click', () => setInking(false));
$$('.ink-tool[data-tool]').forEach((b) => b.addEventListener('click', () => { V.tool = b.dataset.tool; $$('.ink-tool[data-tool]').forEach((x) => x.classList.toggle('on', x === b)); }));
$$('.swatch').forEach((b) => b.addEventListener('click', () => {
  V.color = b.dataset.color; $$('.swatch').forEach((x) => x.classList.toggle('on', x === b));
  if (V.tool === 'eraser') $('.ink-tool[data-tool="pen"]').click();
}));
$('#inkUndo').addEventListener('click', () => { const u = V.undo.pop(); if (!u) return; u.layer.strokes = u.strokes; u.layer.redraw(); u.layer.save(); });
function attachInk(canvas, layer) {
  let stroke = null, erasing = false, snap = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!V.inking) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (penSeen && e.pointerType === 'touch') return;
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
      if (stroke.tool === 'hl') p[1] = stroke.pts[0][1] + (p[1] - stroke.pts[0][1]) * 0.15;
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
  $('#twoUp').checked = S.twoUp; $('#halfTurn').checked = S.halfTurn;
  $$('#paperSeg button').forEach((b) => b.classList.toggle('on', b.dataset.paper === S.paper));
  db.byIndex('takes', 'score', V.score.id).then((t) => {
    const stats = $('#scoreStats'); stats.textContent = '';
    for (const [v, l] of [[fmtMinutes(V.score.seconds || 0), 'practised'], [t.length, t.length === 1 ? 'recording' : 'recordings'], [V.doc ? V.doc.pages : V.score.pages, 'pages']]) {
      const d = el('div', 'stat'); d.append(el('b', '', String(v)), el('span', '', l)); stats.append(d);
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
$('#halfTurn').addEventListener('change', (e) => { S.halfTurn = e.target.checked; saveSettings(); if (!S.halfTurn && V.half) { V.half = false; layout(); } });
$$('#paperSeg button').forEach((b) => b.addEventListener('click', () => {
  S.paper = b.dataset.paper; saveSettings(); $('#score').dataset.paper = S.paper;
  $$('#paperSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('#delScore').addEventListener('click', () => { $('#delScoreConfirm').hidden = false; });
$('#delScoreNo').addEventListener('click', () => { $('#delScoreConfirm').hidden = true; });
$('#delScoreYes').addEventListener('click', async () => {
  const s = V.score; if (!s) return;
  const takes = await db.byIndex('takes', 'score', s.id);
  for (const t of takes) await deleteTakeData(t.id);
  const inkKeys = (await db.keys('ink')).filter((k) => String(k).startsWith(s.id + ':'));
  for (const k of inkKeys) await db.del('ink', k);
  await db.del('files', s.fileId);
  hidePanel(); stopPracticeClock();
  V.score = null; if (V.doc) V.doc.destroy(); V.doc = null;
  await db.del('scores', s.id);
  thumbURLs.delete(s.id);
  $('#score').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home'); stage.textContent = '';
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
document.addEventListener('visibilitychange', () => { lastTick = Date.now(); if (document.visibilityState === 'visible' && V.doc) keepAwake(); });

// =====================================================================
// Metronome
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
  metro.accents = m.accents && m.accents.length === metro.beats ? m.accents.slice() : meterInfo($('#meterSel').value).accents;
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
  $$('.smooth-only').forEach((x) => (x.hidden = r.mode !== 'smooth'));
  $$('.step-only').forEach((x) => (x.hidden = r.mode !== 'step'));
  $('#rampBody').hidden = !r.on;
  $('#gapOn').checked = metro.gap.on; $('#gapPlay').value = metro.gap.play; $('#gapMute').value = metro.gap.mute; $('#gapBody').hidden = !metro.gap.on;
  $('#flashOn').checked = S.flash;
  renderBeatDots(); updateRampSummary(); drawRamp();
}
function setBpm(v, quiet) {
  v = clamp(Math.round(v), 20, 280);
  metro.bpm = v; showBpm(v); $('#bpmRange').value = v;
  if (!quiet) persistMetro();
}
function showBpm(v) { $('#bpmVal').textContent = Math.round(v); $('#bpmMark').textContent = tempoMarking(v); $('#metroPillBpm').textContent = Math.round(v); }
function renderBeatDots() {
  const box = $('#beatDots'); box.textContent = '';
  for (let i = 0; i < metro.beats; i++) {
    const b = el('button', 'beat'); b.dataset.acc = metro.accents[i] ?? 1;
    b.setAttribute('aria-label', `Beat ${i + 1}`);
    b.addEventListener('click', () => { const cur = metro.accents[i] ?? 1; metro.accents[i] = cur === 2 ? 1 : cur === 1 ? 0 : 2; b.dataset.acc = metro.accents[i]; persistMetro(); });
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
$('#soundSel').addEventListener('change', (e) => { metro.sound = e.target.value; persistMetro(); if (!metro.running) { metro._ensureBuffers(); metro._play(getCtx().currentTime + 0.01, 0); } });
$('#metroVol').addEventListener('input', (e) => { metro.setVolume(+e.target.value); persistMetro(); });
$('#flashOn').addEventListener('change', (e) => { S.flash = e.target.checked; saveSettings(); });
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
$('#gapOn').addEventListener('change', (e) => { metro.gap.on = e.target.checked; $('#gapBody').hidden = !e.target.checked; persistMetro(); });
$('#gapPlay').addEventListener('change', (e) => { metro.gap.play = clamp(+e.target.value || 2, 1, 16); persistMetro(); });
$('#gapMute').addEventListener('change', (e) => { metro.gap.mute = clamp(+e.target.value || 2, 1, 16); persistMetro(); });
$$('#rampMode button').forEach((b) => b.addEventListener('click', () => {
  metro.ramp.mode = b.dataset.mode;
  $$('#rampMode button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.smooth-only').forEach((x) => (x.hidden = metro.ramp.mode !== 'smooth'));
  $$('.step-only').forEach((x) => (x.hidden = metro.ramp.mode !== 'step'));
  readRamp();
}));
function updateRampSummary() {
  const r = metro.ramp;
  if (!r.on) { $('#rampSummary').textContent = 'Gradually change tempo while you play'; return; }
  const up = r.to >= r.from;
  $('#rampSummary').textContent = r.mode === 'smooth'
    ? `${r.from} → ${r.to} BPM, a little ${up ? 'faster' : 'slower'} every beat over ${r.bars} bars`
    : `${r.from} → ${r.to} BPM, ${up ? '+' : '−'}${r.step} every ${r.every} bar${r.every > 1 ? 's' : ''}`;
}
function drawRamp(progressBeat) {
  const c = $('#rampCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1; const W = c.clientWidth, H = c.clientHeight;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const accent = css('--accent-text'), muted = css('--muted'), line = css('--line');
  const r = metro.ramp;
  const totalBars = r.mode === 'smooth' ? r.bars : (Math.ceil(Math.abs(r.to - r.from) / r.step) + 1) * r.every;
  const beats = Math.max(1, totalBars * metro.beats);
  const lo = Math.min(r.from, r.to) - 4, hi = Math.max(r.from, r.to) + 4;
  const X = (b) => 6 + (b / beats) * (W - 12), Y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 26);
  g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(6, H - 14); g.lineTo(W - 6, H - 14); g.stroke();
  const pts = []; const saved = r.repeat; r.repeat = false;
  for (let b = 0; b <= beats; b += Math.max(1, beats / 200)) pts.push([X(b), Y(metro._tempoAt(Math.floor(b)))]);
  r.repeat = saved;
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(W - 6, H - 14); g.lineTo(6, H - 14); g.closePath();
  g.fillStyle = accent; g.globalAlpha = 0.12; g.fill(); g.globalAlpha = 1;
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = accent; g.lineWidth = 2; g.stroke();
  g.fillStyle = muted; g.font = '600 10px ui-rounded, -apple-system, sans-serif';
  g.fillText(r.from, 6, Y(r.from) - 5); const tw = g.measureText(String(r.to)).width; g.fillText(r.to, W - 6 - tw, Y(r.to) - 5);
  g.fillText('bar 1', 6, H - 2); const ew = g.measureText('bar ' + totalBars).width; g.fillText('bar ' + totalBars, W - 6 - ew, H - 2);
  if (progressBeat !== undefined && progressBeat >= 0) {
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
  if (ev.countIn) $('#recNote').textContent = `Count-in ${ev.beat + 1}`;
  else { beatTotal++; showBpm(ev.bpm); if (metro.ramp.on && openPanel === 'metronome') drawRamp(beatTotal); }
  if (S.flash && ev.beat === 0 && !ev.muted) { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
};
metro.onStop = () => { updateMetroButtons(); showBpm(metro.bpm); };
function startMetro(opts) { unlock(); beatTotal = -1; const t = metro.start(opts); updateMetroButtons(); return t; }
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
// Tuner
// =====================================================================
const tuner = new Tuner();
const drone = new Drone();
let currentTunerTab = 'tune';
function setTunerTab(t) {
  currentTunerTab = t;
  $$('#tunerTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
  $('#tab-tune').hidden = t !== 'tune'; $('#tab-harm').hidden = t !== 'harm'; $('#tab-drone').hidden = t !== 'drone';
  if (t === 'harm') requestAnimationFrame(drawHarmonics);
  if (t === 'tune') requestAnimationFrame(drawTrace);
}
$$('#tunerTabs button').forEach((b) => b.addEventListener('click', () => setTunerTab(b.dataset.tab)));

(function buildDial() {
  const g = $('#dialTicks'); let s = '';
  for (let c = -50; c <= 50; c += 5) {
    const a = (c / 50) * 55 * Math.PI / 180;
    const major = c % 25 === 0, r1 = 128, r2 = major ? 112 : 119;
    s += `<line class="tk${major ? ' major' : ''}" x1="${(150 + r1 * Math.sin(a)).toFixed(1)}" y1="${(160 - r1 * Math.cos(a)).toFixed(1)}" x2="${(150 + r2 * Math.sin(a)).toFixed(1)}" y2="${(160 - r2 * Math.cos(a)).toFixed(1)}"/>`;
    if (major && c !== 0) s += `<text x="${(150 + 142 * Math.sin(a)).toFixed(1)}" y="${(164 - 142 * Math.cos(a)).toFixed(1)}" text-anchor="middle">${c > 0 ? '+' : ''}${c}</text>`;
  }
  g.innerHTML = s;
})();
function fillKeySelects() {
  for (const sel of [$('#keySel')]) { sel.textContent = ''; NOTE_NAMES.forEach((n, i) => { const o = el('option', '', n); o.value = i; sel.append(o); }); }
  $('#keySel').value = S.key; $('#sysSel').value = S.system;
}
function updateTunerSetup() {
  tuner.ref = S.ref; tuner.key = S.key; tuner.system = S.system;
  drone.ref = S.ref; drone.refresh();
  scale.ref = S.ref;
  $('#refVal').textContent = S.ref + ' Hz';
  $('#keyField').hidden = S.system === 'equal';
  const inst = INSTRUMENTS[S.instrument];
  $('#fifthsRow').hidden = !(inst.strings && inst.fifths);
  const targets = stringTargets(S.instrument, S.ref, S.pureFifths && inst.fifths);
  tuner.strings = targets;
  const row = $('#stringRow'); row.textContent = '';
  for (const t of targets) {
    const b = el('button'); b.dataset.label = t.label;
    b.append(document.createTextNode(t.name), el('small', '', t.label));
    b.setAttribute('aria-label', `Play ${t.label} string`);
    b.addEventListener('click', () => { unlock(); playRefTone(t.freq); });
    row.append(b);
  }
}
holdRepeat($('#refUp'), () => { S.ref = clamp(S.ref + 1, 400, 466); updateTunerSetup(); saveSettings(); });
holdRepeat($('#refDown'), () => { S.ref = clamp(S.ref - 1, 400, 466); updateTunerSetup(); saveSettings(); });
$('#sysSel').addEventListener('change', (e) => { S.system = e.target.value; saveSettings(); updateTunerSetup(); });
$('#keySel').addEventListener('change', (e) => { S.key = +e.target.value; saveSettings(); updateTunerSetup(); });
$('#pureFifths').addEventListener('change', (e) => { S.pureFifths = e.target.checked; saveSettings(); updateTunerSetup(); });

let lastReading = null;
tuner.onReading = (r) => {
  lastReading = r;
  const face = $('#tunerFace');
  $$('#stringRow button').forEach((b) => { const near = r && r.string === b.dataset.label; b.classList.toggle('near', near); b.classList.toggle('ok', near && Math.abs(r.cents) < 3); });
  if (H.follow) followHarmonics(r);
  if (openPanel === 'tuner' && currentTunerTab === 'tune') drawTrace();
  if (!r) { face.classList.add('idle'); face.classList.remove('intune'); $('#tCents').textContent = tuner.running ? 'Listening… play a note' : 'Tap Start, then play a note'; $('#tHz').innerHTML = '&nbsp;'; return; }
  face.classList.remove('idle');
  const c = r.cents;
  $('#tNote').textContent = r.name; $('#tOct').textContent = r.octave;
  $('#tCents').textContent = Math.abs(c) < 3 ? '✓ In tune' : (c > 0 ? '+' : '−') + Math.abs(c).toFixed(0) + ' cents ' + (c > 0 ? 'sharp' : 'flat');
  let sub = r.freq.toFixed(1) + ' Hz';
  if (r.string) sub += ` · ${r.string} string${S.pureFifths && INSTRUMENTS[S.instrument].fifths ? ', pure fifths' : ''}`;
  else if (S.system !== 'equal' && Math.abs(r.offset) > 0.5) sub += ` · ${SYSTEMS[S.system].label} ${r.offset > 0 ? '+' : '−'}${Math.abs(r.offset).toFixed(0)}¢ in ${NOTE_NAMES[S.key]}`;
  $('#tHz').textContent = sub;
  $('#needle').style.transform = `rotate(${clamp(c, -50, 50) / 50 * 55}deg)`;
  face.classList.toggle('intune', Math.abs(c) < 3);
};
function drawTrace() {
  const c = $('#traceCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const good = css('--good'), accent = css('--accent-text'), muted = css('--muted');
  const span = 8000, now = performance.now();
  const Y = (cents) => H / 2 - (clamp(cents, -50, 50) / 50) * (H / 2 - 8);
  g.fillStyle = good; g.globalAlpha = 0.14; g.fillRect(0, Y(5), W, Y(-5) - Y(5)); g.globalAlpha = 1;
  g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = muted; g.font = '600 10px ui-rounded, -apple-system, sans-serif'; g.fillText('+50', 6, 12); g.fillText('−50', 6, H - 4);
  const pts = tuner.trace.filter((p) => now - p.t < span);
  g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round';
  let prev = null;
  for (const p of pts) {
    const x = W - ((now - p.t) / span) * W, y = Y(p.cents);
    if (prev && p.t - prev.t < 250 && p.name === prev.name) {
      g.strokeStyle = Math.abs(p.cents) < 5 ? good : accent;
      g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x, y); g.stroke();
    }
    prev = { ...p, x, y };
  }
  if (!pts.length) { g.fillStyle = muted; g.font = '500 12px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('Your intonation over the last 8 seconds appears here', W / 2, H / 2 - 8); g.textAlign = 'start'; }
}
setInterval(() => { if (tuner.running && openPanel === 'tuner' && currentTunerTab === 'tune') drawTrace(); }, 120);
async function startTuner() {
  try {
    await tuner.start();
    $('#micHint').textContent = 'Listening. Nothing leaves this device.';
    updateTunerButtons();
    return true;
  } catch (e) { $('#micHint').textContent = micErrorText(e); toast(micErrorText(e), 5000); return false; }
}
function stopTuner() { tuner.stop(); tuner.onReading(null); H.follow = false; updateTunerButtons(); }
function updateTunerButtons() {
  const b = $('#tunerToggle');
  b.innerHTML = tuner.running ? '<svg><use href="#i-stop"/></svg><span>Stop tuner</span>' : '<svg><use href="#i-mic"/></svg><span>Start tuner</span>';
  b.classList.toggle('primary', !tuner.running);
  const h = $('#hListen');
  h.innerHTML = H.follow ? '<svg><use href="#i-stop"/></svg><span>Stop listening</span>' : '<svg><use href="#i-mic"/></svg><span>Use the note I play</span>';
  h.classList.toggle('primary', H.follow);
}
$('#tunerToggle').addEventListener('click', () => (tuner.running ? stopTuner() : startTuner()));

// ---------- harmonics ----------
const H = { midi: 36, f0: 0, follow: false, profile: null, lit: 0, count: 8 };
function fillHarmonicSelects() {
  const sel = $('#hPc'); sel.textContent = '';
  NOTE_NAMES.forEach((n, i) => { const o = el('option', '', n); o.value = i; sel.append(o); });
}
function setHarmonicNote(midi) {
  H.midi = midi; H.f0 = etFreq(midi, S.ref); H.profile = null;
  $('#hPc').value = ((midi % 12) + 12) % 12; $('#hOctSel').value = Math.floor(midi / 12) - 1;
  $('#hNote').textContent = NOTE_NAMES[((midi % 12) + 12) % 12]; $('#hOct').textContent = Math.floor(midi / 12) - 1;
  $('#hSrc').textContent = 'Chosen note · ' + H.f0.toFixed(1) + ' Hz';
  drawHarmonics();
}
$('#hPc').addEventListener('change', () => setHarmonicNote(12 * (+$('#hOctSel').value + 1) + +$('#hPc').value));
$('#hOctSel').addEventListener('change', () => setHarmonicNote(12 * (+$('#hOctSel').value + 1) + +$('#hPc').value));
$('#hCount').addEventListener('change', (e) => { H.count = +e.target.value; drawHarmonics(); });
let harmT = 0;
function followHarmonics(r) {
  if (!r) return;
  const now = performance.now(); if (now - harmT < 120) return; harmT = now;
  H.f0 = r.freq; H.midi = r.midi;
  H.profile = tuner.harmonics(H.count);
  $('#hNote').textContent = r.name; $('#hOct').textContent = r.octave;
  $('#hSrc').textContent = 'You are playing · ' + r.freq.toFixed(1) + ' Hz';
  if (openPanel === 'tuner' && currentTunerTab === 'harm') drawHarmonics();
}
$('#hListen').addEventListener('click', async () => {
  if (H.follow) { H.follow = false; updateTunerButtons(); return; }
  stopHarmonics();
  if (!tuner.running && !(await startTuner())) return;
  H.follow = true; updateTunerButtons();
  $('#hSrc').textContent = 'Listening… play and hold a note';
});
let harmGeom = null;
function drawHarmonics() {
  const c = $('#harmCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth, Hh = c.clientHeight;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const accent = css('--accent'), accentT = css('--accent-text'), muted = css('--muted'), ink = css('--ink'), good = css('--good'), warn = css('--warn');
  const n = H.count, pad = 8, gap = 4, bw = (W - pad * 2 - gap * (n - 1)) / n;
  const top = H.profile ? 10 : 24, base = Hh - 50;
  harmGeom = { pad, gap, bw, n };
  for (let k = 1; k <= n; k++) {
    const x = pad + (k - 1) * (bw + gap);
    let level;
    if (H.profile) level = (H.profile[k - 1] + 60) / 60; else level = Math.pow(1 / k, 0.7);
    const h = Math.max(3, level * (base - top));
    const lit = H.lit === k || (H.lit === -1);
    g.fillStyle = lit ? accentT : accent; g.globalAlpha = H.profile ? 0.95 : 0.45;
    if (lit) g.globalAlpha = 1;
    g.beginPath(); g.roundRect ? g.roundRect(x, base - h, bw, h, 4) : g.rect(x, base - h, bw, h); g.fill();
    g.globalAlpha = 1;
    const semis = 12 * Math.log2(k), m = H.midi + Math.round(semis);
    const nn = { name: NOTE_NAMES[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1, cents: 100 * (semis - Math.round(semis)) };
    g.textAlign = 'center';
    g.fillStyle = ink; g.font = `600 ${bw < 26 ? 10 : 12}px ui-rounded, -apple-system, sans-serif`;
    g.fillText(nn.name + nn.octave, x + bw / 2, base + 16);
    const cents = Math.round(nn.cents);
    g.fillStyle = Math.abs(cents) >= 10 ? warn : muted; g.font = `600 ${bw < 26 ? 9 : 11}px ui-rounded, -apple-system, sans-serif`;
    g.fillText(cents === 0 ? '0' : (cents > 0 ? '+' : '−') + Math.abs(cents), x + bw / 2, base + 31);
    g.fillStyle = muted; g.font = '500 9px -apple-system, sans-serif';
    g.fillText(k === 1 ? 'note' : k + '×', x + bw / 2, base + 44);
  }
  g.textAlign = 'start';
  if (!H.profile) { g.fillStyle = muted; g.font = '500 11px -apple-system, sans-serif'; g.fillText('Typical strengths. Play the note to see your own.', pad, 12); }
  void good;
}
$('#harmCanvas').addEventListener('click', (e) => {
  if (!harmGeom) return;
  const r = e.currentTarget.getBoundingClientRect();
  const k = Math.floor((e.clientX - r.left - harmGeom.pad) / (harmGeom.bw + harmGeom.gap)) + 1;
  if (k < 1 || k > harmGeom.n) return;
  H.follow = false; updateTunerButtons(); unlock();
  playHarmonics(H.f0, { mode: 'one', h: k });
  lightHarmonic(k, 2000);
});
let litT;
function lightHarmonic(k, ms) { H.lit = k; drawHarmonics(); clearTimeout(litT); litT = setTimeout(() => { H.lit = 0; drawHarmonics(); }, ms); }
$('#hSeries').addEventListener('click', () => {
  H.follow = false; updateTunerButtons(); unlock();
  const p = playHarmonics(H.f0, { mode: 'series', count: H.count });
  for (let k = 1; k <= H.count; k++) setTimeout(() => { H.lit = k; drawHarmonics(); }, (p.start - getCtx().currentTime + (k - 1) * p.step) * 1000);
  clearTimeout(litT); litT = setTimeout(() => { H.lit = 0; drawHarmonics(); }, p.total * 1000);
});
$('#hChord').addEventListener('click', () => {
  H.follow = false; updateTunerButtons(); unlock();
  const p = playHarmonics(H.f0, { mode: 'chord', count: H.count });
  lightHarmonic(-1, p.total * 1000);
});

// ---------- drone ----------
(function buildDroneNotes() {
  const box = $('#droneNotes');
  NOTE_NAMES.forEach((n, i) => {
    const b = el('button', '', n); b.dataset.pc = i;
    b.addEventListener('click', () => { drone.pc = i; syncDrone(); drone.refresh(); persistDrone(); });
    box.append(b);
  });
})();
function syncDrone() {
  $$('#droneNotes button').forEach((b) => b.classList.toggle('on', +b.dataset.pc === drone.pc));
  $('#droneOct').value = drone.octave; $('#droneSound').value = drone.sound;
  $('#droneOctave').checked = drone.lowOct; $('#droneVol').value = drone.volume;
  const chord = drone.third ? (drone.minor ? 'minor' : 'major') : drone.fifth ? 'fifth' : 'root';
  $$('#droneChord button').forEach((b) => b.classList.toggle('on', b.dataset.chord === chord));
  $('#dronePillNote').textContent = drone.label();
  const b = $('#droneToggle');
  b.innerHTML = drone.running ? '<svg><use href="#i-stop"/></svg><span>Stop drone</span>' : '<svg><use href="#i-play"/></svg><span>Start drone</span>';
  b.classList.toggle('primary', !drone.running);
  $('#dronePill').hidden = !drone.running;
}
function persistDrone() { S.drone = { pc: drone.pc, octave: drone.octave, sound: drone.sound, fifth: drone.fifth, third: drone.third, minor: drone.minor, lowOct: drone.lowOct, volume: drone.volume }; saveSettings(); }
$('#droneOct').addEventListener('change', (e) => { drone.octave = +e.target.value; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneSound').addEventListener('change', (e) => { drone.sound = e.target.value; drone.refresh(); persistDrone(); });
$$('#droneChord button').forEach((b) => b.addEventListener('click', () => {
  const c = b.dataset.chord;
  drone.fifth = c !== 'root'; drone.third = c === 'major' || c === 'minor'; drone.minor = c === 'minor';
  drone.refresh(); syncDrone(); persistDrone();
}));
$('#droneOctave').addEventListener('change', (e) => { drone.lowOct = e.target.checked; drone.refresh(); persistDrone(); });
$('#droneVol').addEventListener('input', (e) => { drone.setVolume(+e.target.value); persistDrone(); });
$('#droneToggle').addEventListener('click', () => { unlock(); drone.running ? drone.stop() : drone.start(); syncDrone(); });
$('#dronePillStop').addEventListener('click', () => { drone.stop(); syncDrone(); });

// =====================================================================
// Scales
// =====================================================================
const scale = new ScalePlayer();
const DEFAULT_OCT = { cello: 2, violin: 3, viola: 3, bass: 1, guitar: 2, flute: 4, clarinet: 3, oboe: 4, piano: 4, voice: 3, other: 3 };
(function buildScaleUI() {
  const keys = $('#scaleKeys');
  NOTE_NAMES.forEach((n, i) => { const b = el('button', '', n); b.dataset.pc = i; b.addEventListener('click', () => { scale.tonic = i; scaleChanged(); }); keys.append(b); });
  const t = $('#scaleType');
  for (const [k, v] of Object.entries(SCALE_TYPES)) { const o = el('option', '', v.label); o.value = k; t.append(o); }
})();
function fillScaleOctaves() {
  const sel = $('#scaleOct'); sel.textContent = '';
  for (let o = 0; o <= 6; o++) { const opt = el('option', '', NOTE_NAMES[scale.tonic] + o); opt.value = o; sel.append(opt); }
  sel.value = scale.octave;
}
function syncScaleUI() {
  $$('#scaleKeys button').forEach((b) => b.classList.toggle('on', +b.dataset.pc === scale.tonic));
  $('#scaleType').value = scale.type; fillScaleOctaves();
  $('#scaleOcts').value = scale.octaves; $('#scaleDir').value = scale.direction; $('#scaleSys').value = scale.system;
  $('#scaleBpm').value = scale.bpm; $('#scaleBpmVal').textContent = scale.bpm + ' BPM';
  $('#scalePer').value = scale.perBeat; $('#scaleSound').value = scale.sound; $('#scaleVol').value = scale.volume;
  $('#scaleDrone').checked = scale.drone; $('#scaleClick').checked = scale.click; $('#scaleRepeat').checked = scale.repeat;
  $('#scaleTitle').textContent = scale.title();
  $('#scalePillNote').textContent = scale.title();
  renderScaleStrip();
}
function persistScale() {
  S.scale = { tonic: scale.tonic, octave: scale.octave, octaves: scale.octaves, type: scale.type, direction: scale.direction, system: scale.system, bpm: scale.bpm, perBeat: scale.perBeat, sound: scale.sound, volume: scale.volume, drone: scale.drone, click: scale.click, repeat: scale.repeat };
  saveSettings();
}
function scaleChanged(restart = true) {
  syncScaleUI(); persistScale();
  if (restart && scale.playing) scale.start();
}
function renderScaleStrip() {
  const box = $('#scaleStrip'); if (!box) return; box.textContent = '';
  const seen = new Set();
  for (const m of scale.notes()) {
    if (seen.has(m)) continue; seen.add(m);
    const s = el('span'); s.dataset.midi = m;
    s.append(document.createTextNode(NOTE_NAMES[((m % 12) + 12) % 12]));
    const c = Math.round(scale.cents(m));
    s.append(el('small', '', scale.system === 'equal' ? String(Math.floor(m / 12) - 1) : (c === 0 ? '0' : (c > 0 ? '+' : '−') + Math.abs(c))));
    box.append(s);
  }
}
$('#scaleType').addEventListener('change', (e) => { scale.type = e.target.value; scaleChanged(); });
$('#scaleOct').addEventListener('change', (e) => { scale.octave = +e.target.value; scaleChanged(); });
$('#scaleOcts').addEventListener('change', (e) => { scale.octaves = +e.target.value; scaleChanged(); });
$('#scaleDir').addEventListener('change', (e) => { scale.direction = e.target.value; scaleChanged(); });
$('#scaleSys').addEventListener('change', (e) => { scale.system = e.target.value; scaleChanged(); });
$('#scaleBpm').addEventListener('input', (e) => { scale.bpm = +e.target.value; $('#scaleBpmVal').textContent = scale.bpm + ' BPM'; persistScale(); });
$('#scalePer').addEventListener('change', (e) => { scale.perBeat = +e.target.value; persistScale(); });
$('#scaleSound').addEventListener('change', (e) => { scale.sound = e.target.value; scaleChanged(); });
$('#scaleVol').addEventListener('input', (e) => { scale.setVolume(+e.target.value); persistScale(); });
$('#scaleDrone').addEventListener('change', (e) => { scale.drone = e.target.checked; scaleChanged(); });
$('#scaleClick').addEventListener('change', (e) => { scale.click = e.target.checked; persistScale(); });
$('#scaleRepeat').addEventListener('change', (e) => { scale.repeat = e.target.checked; persistScale(); });
scale.onNote = (ev) => {
  const name = midiName(ev.midi);
  $('#scaleNote').textContent = name;
  const c = Math.round(scale.cents(ev.midi));
  $('#scaleCents').textContent = scale.system === 'equal' ? '' : (c === 0 ? '±0¢' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢');
  $('#scalePillNote').textContent = name;
  $$('#scaleStrip span').forEach((s) => s.classList.toggle('on', +s.dataset.midi === ev.midi));
};
scale.onEnd = () => updateScaleButtons();
function updateScaleButtons() {
  const b = $('#scaleToggle');
  b.innerHTML = scale.playing ? '<svg><use href="#i-stop"/></svg><span>Stop</span>' : '<svg><use href="#i-play"/></svg><span>Play scale</span>';
  b.classList.toggle('primary', !scale.playing);
  $('#scalePill').hidden = !scale.playing;
  if (!scale.playing) { $$('#scaleStrip span').forEach((s) => s.classList.remove('on')); $('#scaleNote').textContent = '–'; $('#scaleCents').textContent = ''; $('#scalePillNote').textContent = scale.title(); }
}
$('#scaleToggle').addEventListener('click', () => { unlock(); if (scale.playing) scale.stop(); else { scale.ref = S.ref; scale.start(); } updateScaleButtons(); });
$('#scalePillStop').addEventListener('click', () => { scale.stop(); updateScaleButtons(); });

// =====================================================================
// Recording (audio and video)
// =====================================================================
const recorder = new Recorder();
const vrec = new VideoRecorder();
let recState = null;
$('#countIn').addEventListener('change', (e) => { S.countIn = e.target.checked; saveSettings(); });
$('#clickWhileRec').addEventListener('change', (e) => { S.clickWhileRec = e.target.checked; saveSettings(); });
$$('#camSeg button').forEach((b) => b.addEventListener('click', () => { S.cam = b.dataset.cam; saveSettings(); $$('#camSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
$('#recAudio').addEventListener('click', () => startRecording('audio'));
$('#recVideo').addEventListener('click', () => startRecording('video'));
$('#recBtn').addEventListener('click', () => (recState ? stopRecording() : showPanel('record')));
$('#recStop').addEventListener('click', stopRecording);

function setupCountIn() {
  let startAt = 0, metroByUs = false;
  const ctx = getCtx();
  if (S.countIn && !metro.running) {
    const keep = S.clickWhileRec;
    const t0 = startMetro({ countInBars: 1, stopAfterCountIn: !keep, onCountInDone: () => { $('#recNote').textContent = keep ? 'Click on' : ''; } });
    startAt = t0 + metro.beats * 60 / metro.countInBpm;
    metroByUs = true;
    $('#recNote').textContent = 'Count-in';
  } else if (S.clickWhileRec && !metro.running) { startMetro(); metroByUs = true; $('#recNote').textContent = 'Click on'; }
  else $('#recNote').textContent = '';
  return { startAt: startAt || ctx.currentTime, delayed: !!startAt, metroByUs };
}

async function startRecording(kind) {
  unlock(); hidePanel();
  if (player.playing) player.pause();
  if (scale.playing) { scale.stop(); updateScaleButtons(); }
  if (tuner.running) stopTuner();
  const ctx = getCtx();
  let meterSrc = null;
  if (kind === 'video') {
    try { await vrec.open(S.cam); } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Camera access is off. Allow it in Settings › Safari › Camera and Microphone.' : 'The camera could not start.', 5000); return; }
    const cam = $('#cam'); cam.hidden = false; cam.classList.toggle('mirror', S.cam === 'user');
    $('#camVideo').srcObject = vrec.stream; $('#camVideo').play().catch(() => {});
    meterSrc = ctx.createMediaStreamSource(vrec.stream);
  } else {
    try { await recorder.prepare(); } catch (e) { toast(micErrorText(e), 5000); return; }
  }
  const ci = setupCountIn();
  recState = { kind, ...ci, page: V.score ? V.page : 0, scoreId: V.score ? V.score.id : null, meterSrc };
  if (kind === 'video') {
    const wait = Math.max(0, (ci.startAt - ctx.currentTime) * 1000);
    recState.startTimer = setTimeout(() => { if (recState) vrec.start(); }, wait);
  } else {
    recorder.start(ci.delayed ? ci.startAt : 0);
  }
  $('#recPill').hidden = false; $('#recBtn').classList.add('live'); $('#recBtnLabel').textContent = 'Stop';
  // level meter
  let level = 0;
  if (kind === 'video') {
    const an = ctx.createAnalyser(); an.fftSize = 1024; meterSrc.connect(an); recState.analyser = an;
    const buf = new Float32Array(an.fftSize);
    recState.readLevel = () => { an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); level = Math.max(p, level * 0.92); };
  } else {
    recorder.onLevel = (p) => { level = Math.max(p, level * 0.92); };
  }
  const meter = $('#recMeter'), mg = meter.getContext('2d');
  const loop = () => {
    if (!recState) return;
    if (recState.readLevel) recState.readLevel();
    const t = ctx.currentTime - recState.startAt;
    const txt = t < 0 ? '–' + Math.ceil(-t) : fmtTime(t);
    $('#recTime').textContent = txt; $('#camTime').textContent = txt;
    const W = meter.width, Hm = meter.height;
    mg.clearRect(0, 0, W, Hm); mg.fillStyle = css('--sunk-2'); mg.fillRect(0, 0, W, Hm);
    const dbv = 20 * Math.log10(level + 1e-6); const x = clamp((dbv + 60) / 60, 0, 1) * W;
    mg.fillStyle = level > 0.95 ? css('--rec') : level > 0.6 ? css('--warn') : css('--good');
    mg.fillRect(0, 0, x, Hm);
    recState.raf = requestAnimationFrame(loop);
  };
  loop();
}

async function stopRecording() {
  if (!recState) return;
  const st = recState; recState = null;
  cancelAnimationFrame(st.raf); clearTimeout(st.startTimer);
  if (st.metroByUs && metro.running) stopMetro();
  $('#recPill').hidden = true; $('#recBtn').classList.remove('live'); $('#recBtnLabel').textContent = 'Record';
  const existing = st.scoreId ? await db.byIndex('takes', 'score', st.scoreId) : await db.all('takes');
  const name = (st.kind === 'video' ? 'Video ' : 'Take ') + (existing.length + 1);
  let take;
  if (st.kind === 'video') {
    const blob = vrec.recording ? await vrec.stop() : null;
    try { st.meterSrc && st.meterSrc.disconnect(); } catch {}
    vrec.close(); $('#cam').hidden = true; $('#camVideo').srcObject = null;
    if (!blob || blob.size < 2000) { toast('That was too short to keep.'); return; }
    toast('Saving the video…', 8000);
    const audio = await decodeVideoAudio(blob);
    const thumb = await videoThumb(blob);
    take = { id: uid(), kind: 'video', mime: blob.type, scoreId: st.scoreId, page: st.page, name, created: Date.now(), mirror: S.cam === 'user', thumb, fav: false };
    await db.put('files', { id: 'video:' + take.id, data: blob });
    if (audio && audio.data.length > audio.sr * 0.3) {
      take.sr = audio.sr; take.dur = audio.data.length / audio.sr; take.peaks = computePeaks(audio.data); take.peak = peakOf(audio.data); take.pcm = true;
      await db.put('files', { id: 'audio:' + take.id, data: audio.data });
    } else { take.pcm = false; take.dur = (performance.now() - (vrec.startedAt || performance.now())) / 1000; }
    $('#toast').hidden = true;
  } else {
    const { data, sr } = await recorder.stop();
    if (data.length < sr * 0.4) { toast('That was too short to keep.'); return; }
    take = { id: uid(), kind: 'audio', scoreId: st.scoreId, page: st.page, name, created: Date.now(), sr, dur: data.length / sr, peaks: computePeaks(data), peak: peakOf(data), fav: false };
    await db.put('files', { id: 'audio:' + take.id, data });
  }
  await db.put('takes', take);
  takesScope = st.scoreId ? 'score' : 'all';
  showPanel('takes');
  await selectTake(take.id);
}

// draggable camera preview
(function dragCam() {
  const cam = $('#cam'); let d = null;
  cam.addEventListener('pointerdown', (e) => { cam.setPointerCapture(e.pointerId); const r = cam.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; });
  cam.addEventListener('pointermove', (e) => {
    if (!d) return;
    const x = clamp(e.clientX - d.dx, 8, innerWidth - cam.offsetWidth - 8), y = clamp(e.clientY - d.dy, 8, innerHeight - cam.offsetHeight - 8);
    cam.style.left = x + 'px'; cam.style.top = y + 'px'; cam.style.bottom = 'auto';
  });
  cam.addEventListener('pointerup', () => { d = null; });
})();

// =====================================================================
// Recordings & player
// =====================================================================
const player = new Player();
let takesScope = 'score', currentTake = null, videoURL = null, nativeVideo = false;
$$('#takesScope button').forEach((b) => b.addEventListener('click', () => { takesScope = b.dataset.scope; refreshTakes(); }));
const thumbCache = new Map();
async function refreshTakes() {
  if (!V.score && takesScope === 'score') takesScope = 'all';
  $$('#takesScope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === takesScope));
  $('#takesScope button[data-scope="score"]').hidden = !V.score;
  const takes = takesScope === 'score' && V.score ? await db.byIndex('takes', 'score', V.score.id) : await db.all('takes');
  takes.sort((a, b) => (b.fav - a.fav) || (b.created - a.created));
  const titles = new Map(scores.map((s) => [s.id, s.title])); if (V.score) titles.set(V.score.id, V.score.title);
  const ul = $('#takeList'); ul.textContent = '';
  $('#takesEmpty').hidden = takes.length > 0;
  for (const t of takes) {
    const li = el('li', 'take' + (currentTake && currentTake.id === t.id ? ' on' : ''));
    if (t.kind === 'video' && t.thumb) {
      if (!thumbCache.has(t.id)) thumbCache.set(t.id, URL.createObjectURL(t.thumb));
      const img = el('img', 'vthumb'); img.src = thumbCache.get(t.id); img.alt = ''; li.append(img);
    } else if (t.peaks) {
      const cv = el('canvas'); cv.width = 128; cv.height = 72; drawMini(cv, t.peaks, css('--muted')); li.append(cv);
    } else li.append(el('span', 'vthumb'));
    const main = el('div', 'tk-main'); const nm = el('div', 'tk-name');
    if (t.fav) { const s = icon('i-star'); s.classList.add('fav'); nm.append(s); }
    if (t.kind === 'video') { const s = icon('i-video'); s.classList.add('kind'); nm.append(s); }
    nm.append(document.createTextNode(t.name));
    const when = new Date(t.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const sub = el('div', 'tk-sub', (takesScope === 'all' && t.scoreId ? (titles.get(t.scoreId) || 'Score') + ' · ' : '') + (t.scoreId ? 'p. ' + (t.page + 1) + ' · ' : '') + when);
    main.append(nm, sub);
    li.append(main, el('span', 'tk-dur num', fmtTime(t.dur || 0)));
    li.addEventListener('click', () => selectTake(t.id));
    ul.append(li);
  }
}
function drawMini(cv, peaks, color) {
  const g = cv.getContext('2d'); const W = cv.width, Hh = cv.height; g.fillStyle = color;
  const n = 40, step = peaks.length / n; let max = 0.0001; for (const p of peaks) max = Math.max(max, p);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) m = Math.max(m, peaks[j]); const h = Math.max(2, (m / max) * Hh * 0.9); g.fillRect(i * (W / n) + 1, (Hh - h) / 2, W / n - 2, h); }
}
async function selectTake(id) {
  const t = await db.get('takes', id);
  if (!t) { toast('That recording could not be loaded.'); return; }
  player.stop();
  const video = $('#takeVideo');
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
  video.removeAttribute('src'); video.load();
  nativeVideo = false;
  if (t.kind === 'video') {
    const vf = await db.get('files', 'video:' + id);
    if (!vf) { toast('That video could not be loaded.'); return; }
    videoURL = URL.createObjectURL(vf.data);
    video.src = videoURL; video.load();
    $('#videoWrap').hidden = false; $('#videoWrap').classList.toggle('mirror', !!t.mirror);
    if (!t.pcm) nativeVideo = true;
  } else $('#videoWrap').hidden = true;
  if (!nativeVideo) {
    const f = await db.get('files', 'audio:' + id);
    if (!f) { toast('That recording could not be loaded.'); return; }
    t.data = f.data;
    video.muted = true; video.controls = false;
    player.load(t, t.kind === 'video' ? video : null);
  } else {
    video.muted = false; video.controls = true; player.load({ data: new Float32Array(1), sr: 48000, peaks: new Float32Array(1), peak: 1 }, null);
  }
  currentTake = t;
  $('#player').hidden = false; $('#delConfirm').hidden = true;
  $('#waveWrap').hidden = nativeVideo; $('.times').hidden = nativeVideo; $('.transport').hidden = nativeVideo;
  $('#exportLabel').textContent = t.kind === 'video' ? 'Share video' : 'Export as heard';
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
  $('#tLoop').textContent = player.loop && player.b > player.a ? `Looping ${fmtTime(player.a, true)} – ${fmtTime(player.b, true)}` : 'Drag across the waveform to loop a passage';
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
const setSpeed = (v) => {
  if (nativeVideo) { const vid = $('#takeVideo'); vid.preservesPitch = true; vid.webkitPreservesPitch = true; vid.playbackRate = v; player.rate = v; }
  else player.setRate(v);
  syncPlayerControls();
};
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
async function deleteTakeData(id) { await db.del('takes', id); await db.del('files', 'audio:' + id); await db.del('files', 'video:' + id); }
$('#delTake').addEventListener('click', () => { $('#delConfirm').hidden = false; });
$('#delNo').addEventListener('click', () => { $('#delConfirm').hidden = true; });
$('#delYes').addEventListener('click', async () => {
  if (!currentTake) return;
  player.stop(); $('#takeVideo').pause();
  await deleteTakeData(currentTake.id);
  currentTake = null; $('#player').hidden = true; refreshTakes(); toast('Recording deleted');
});
const nativeShare = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standShare;
async function shareBlob(blob, name) {
  if (nativeShare) {
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    $('#toast').hidden = true;
    nativeShare.postMessage({ name, data: b64 });
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    $('#toast').hidden = true;
    await navigator.share({ files: [file], title: name }).catch(() => {});
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000); toast('Saved ' + name);
  }
}
async function exportTake() {
  if (!currentTake) return;
  const safe = (currentTake.name || 'Take').replace(/[\\/:*?"<>|]+/g, '');
  const btn = $('#exportBtn'); btn.disabled = true;
  try {
    if (currentTake.kind === 'video') {
      const vf = await db.get('files', 'video:' + currentTake.id);
      await shareBlob(vf.data, safe + (vf.data.type.includes('webm') ? '.webm' : '.mp4'));
    } else {
      toast('Preparing the file…', 10000);
      const blob = await player.exportWav();
      await shareBlob(blob, safe + (player.rate !== 1 ? ` (${Math.round(player.rate * 100)}%)` : '') + '.wav');
    }
  } catch (e) { console.error(e); toast('The export failed. Try a shorter loop.'); }
  btn.disabled = false;
}
$('#exportBtn').addEventListener('click', exportTake);
$('#shareBtn').addEventListener('click', exportTake);

const wave = $('#wave');
let waveRaf = 0;
function animateWave() { cancelAnimationFrame(waveRaf); const f = () => { drawWave(); player.syncVideo(); if (player.playing) waveRaf = requestAnimationFrame(f); }; f(); }
function drawWave() {
  if (!currentTake || nativeVideo || wave.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = wave.clientWidth, Hh = wave.clientHeight;
  if (wave.width !== Math.round(W * dpr)) { wave.width = Math.round(W * dpr); wave.height = Math.round(Hh * dpr); }
  const g = wave.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const accent = css('--accent-text'), muted = css('--muted'), ink = css('--ink');
  const dur = player.duration || 1, pos = player.currentPos();
  const peaks = currentTake.peaks; let max = 0.0001; for (const p of peaks) max = Math.max(max, p);
  if (player.b > player.a) {
    const xa = (player.a / dur) * W, xb = (player.b / dur) * W;
    g.fillStyle = accent; g.globalAlpha = player.loop ? 0.18 : 0.08; g.fillRect(xa, 0, xb - xa, Hh); g.globalAlpha = 1;
    g.fillRect(xa - 1, 0, 2, Hh); g.fillRect(xb - 1, 0, 2, Hh);
  }
  const bars = Math.floor(W / 3), px = (pos / dur) * W;
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / bars) * peaks.length));
    let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j]);
    const h = Math.max(1.5, Math.pow(m / max, 0.8) * (Hh - 16));
    g.fillStyle = i * 3 < px ? accent : muted; g.globalAlpha = i * 3 < px ? 1 : 0.5;
    g.fillRect(i * 3, (Hh - h) / 2, 2, h);
  }
  g.globalAlpha = 1; g.fillStyle = ink; g.fillRect(px - 1, 4, 2, Hh - 8);
  $('#tPos').textContent = fmtTime(pos, true);
}
let wdown = null;
wave.addEventListener('pointerdown', (e) => {
  if (!currentTake) return;
  wave.setPointerCapture(e.pointerId);
  const r = wave.getBoundingClientRect();
  wdown = { x: e.clientX, t: ((e.clientX - r.left) / r.width) * player.duration, sel: false };
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
  if (d.sel && player.b - player.a > 0.25) player.setLoop(true, player.a, player.b);
  else { if (d.sel) player.a = player.b = 0; player.seek(d.t); }
});
window.addEventListener('resize', () => requestAnimationFrame(() => { drawWave(); drawHarmonics(); drawTrace(); }));

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  await loadSettings();
  document.body.classList.add('at-home');
  player.room = S.room; player.wet = S.wet; player.autoLevel = S.autoLevel;
  applyMetroSettings(S.metro || { bpm: 80, meter: '4' });
  if (S.drone) Object.assign(drone, S.drone);
  if (S.scale) Object.assign(scale, S.scale); else scale.octave = DEFAULT_OCT[S.instrument] ?? 3;
  fillInstrumentSelects(); fillKeySelects(); fillHarmonicSelects();
  $('#pureFifths').checked = S.pureFifths;
  $('#countIn').checked = S.countIn; $('#clickWhileRec').checked = S.clickWhileRec;
  $$('#camSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cam === S.cam));
  updateTunerSetup(); syncDrone(); syncPlayerControls(); syncScaleUI();
  setHarmonicNote(INSTRUMENTS[S.instrument].strings ? INSTRUMENTS[S.instrument].strings[0] : 48);
  renderExamples();
  $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === S.sort));
  await refreshLibrary();
  setHomeTab(scores.length ? (S.hometab || 'mine') : 'mine');
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
