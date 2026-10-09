import { db, getSetting, setSetting, uid } from './db.js';
import { getCtx, unlock, micErrorText } from './audio.js';
import { Metronome, makeTapper, tempoMarking, meterInfo } from './metronome.js';
import { Tuner, Drone, DRONE_VOICES, DRONE_CHORDS, naturalHarmonics, playHarmonics, stopHarmonics, playRefTone } from './tuner.js';
import { NOTE_NAMES, SYSTEMS, INSTRUMENTS, stringTargets, etFreq, midiName } from './temperament.js';
import { ScalePlayer, SCALE_TYPES } from './scales.js';
import { Recorder, Player, computePeaks, peakOf, ROOMS } from './recorder.js';
import { VideoRecorder, decodeVideoAudio, videoThumb } from './video.js';
import { openDocument, makeThumb, readScoreInfo, findSplit, PAPERS, mapDoc, contentBox, unionBox } from './score.js';
import { InkLayer, COLORS, STAMPS, drawItem, loadMusicFont, setPaperColor, setMaskReadyHandler, itemBounds, itemsInLasso, transformItem, smartMask, saveItems } from './ink.js';
import { exportPdf } from './export.js';
import { searchWorks, workFiles, rankFiles, splitTitle, fileUrl, workUrl, loadComposers } from './imslp.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s, tenths) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0')); };
const fmtShort = (sec) => { const m = Math.round(sec / 60); return m < 60 ? m + ' min' : m < 600 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : Math.round(m / 60) + ' h'; };
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
  if (name === 'pages') renderPagesPanel();
}
function hidePanel() {
  if (!openPanel) return;
  $('#panel-' + openPanel).hidden = true;
  $$('[data-panel].on').forEach((b) => b.classList.remove('on'));
  if (openPanel === 'settings') saveScoreMeta();
  if (openPanel === 'tuner') pauseHarmonicListening();
  if (openPanel === 'app' && wink.testing) { wink.testing = false; $('#winkTest').textContent = 'Test'; $('#winkMeter').hidden = true; sendFace(); }
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
  renderGoal();
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
  const log = practice.log;
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
// Add a PDF to the library; title and composer come from IMSLP (when downloaded through Stand)
// or are read from the first page.
async function addPdf(data, name, meta) {
  const file = { id: uid(), kind: 'pdf', data };
  const doc = await openDocument(file);
  const thumb = await makeThumb(doc);
  meta = meta || await imslpMetaFor(name);
  const info = await readScoreInfo(doc, name, await loadComposers());
  const title = (meta && meta.title) || info.title || niceTitle(name);
  const composer = (meta && meta.composer) || info.composer || '';
  const score = { id: uid(), fileId: file.id, title, composer, pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb, source: meta ? 'IMSLP' : '' };
  doc.destroy();
  await db.put('files', file); await db.put('scores', score);
  return score;
}
async function addImages(blobs, name) {
  const file = { id: uid(), kind: 'images', data: blobs };
  const doc = await openDocument(file);
  const thumb = await makeThumb(doc);
  const score = { id: uid(), fileId: file.id, title: niceTitle(name), composer: '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb };
  doc.destroy();
  await db.put('files', file); await db.put('scores', score);
  return score;
}
$('#scanBtn').addEventListener('click', () => {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standScan && (window.standCaps || {}).scan) window.webkit.messageHandlers.standScan.postMessage({});
  else $('#scanInput').click();
});
$('#scanInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  toast('Adding the scan…', 8000);
  try { const sc = await addImages(files, 'Scan ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '.jpg'); await refreshLibrary(); setHomeTab('mine'); toast('Added. Tap the title in More to rename it.', 3500); openScore(sc.id); }
  catch (err) { console.error(err); toast('Those photos could not be read.'); }
});
const label = (sc) => (sc.composer ? `${sc.title} — ${sc.composer}` : sc.title);
$('#importInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  let added = 0, last = null;
  toast(files.length > 1 ? `Importing ${files.length} files…` : 'Importing…', 10000);
  for (const f of pdfs) {
    try { last = await addPdf(await f.arrayBuffer(), f.name); added++; } catch (err) { console.error(err); toast(`Could not open ${f.name}. Is it a PDF?`); }
  }
  if (imgs.length) {
    try { last = await addImages(imgs, imgs[0].name); added++; } catch (err) { console.error(err); toast('Those photos could not be read.'); }
  }
  setHomeTab('mine');
  await refreshLibrary();
  if (added) toast(added === 1 ? 'Added: ' + label(last) : `${added} scores added`, 4000);
});
// Files arriving from the iPad app: a PDF caught while browsing IMSLP, or "Open in Stand" from Files.
window.standIncoming = async (msg) => {
  try {
    const paths = msg.paths || [msg.path];
    const blobs = [];
    for (const p of paths) { const res = await fetch(p); if (!res.ok) throw new Error('missing file'); blobs.push(await res.blob()); }
    let sc;
    toast('Adding ' + (msg.meta && msg.meta.title ? msg.meta.title : msg.name) + '…', 8000);
    if (blobs.length === 1 && (/\.pdf$/i.test(msg.name) || blobs[0].type === 'application/pdf')) sc = await addPdf(await blobs[0].arrayBuffer(), msg.name, msg.meta && msg.meta.title ? msg.meta : null);
    else sc = await addImages(blobs.map((b) => (b.type ? b : new Blob([b], { type: 'image/jpeg' }))), msg.name);
    if (NATIVE && NATIVE.standDone) for (const p of paths) NATIVE.standDone.postMessage({ path: p });
    await refreshLibrary();
    if (!$('#score').hidden) await closeScore();
    hidePanel(); setHomeTab('mine');
    toast('Added: ' + label(sc), 3000);
    openScore(sc.id);
  } catch (e) { console.error(e); toast('That file could not be added.'); }
};

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
  for (const sel of [$('#instSel'), $('#tunerInst'), $('#appInst')]) {
    sel.textContent = '';
    for (const [k, v] of Object.entries(INSTRUMENTS)) { const o = el('option', '', v.label); o.value = k; sel.append(o); }
    sel.value = S.instrument;
  }
}
function setInstrument(k) {
  S.instrument = k; saveSettings();
  $('#instSel').value = k; $('#tunerInst').value = k; $('#appInst').value = k;
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
    if (!list.length) { st.textContent = 'Nothing on IMSLP for that. Try the composer’s surname and one word of the title, for example “Fauré élégie”. Newer music may only exist in print:'; renderBuy($('#findBuy'), q); $('#findBuy').hidden = false; return; }
    $('#findBuy').hidden = true;
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
const inApp = () => !!(NATIVE && NATIVE.standOpen);
function downloadLink(f, big) {
  const a = el('a', big ? 'btn primary' : 'icon-btn');
  a.href = fileUrl(f.index); a.target = '_blank'; a.rel = 'noopener';
  a.append(icon('i-download'));
  if (big) a.append(el('span', '', inApp() ? 'Add to my stand' : 'Download'));
  else a.setAttribute('aria-label', 'Download ' + f.label);
  a.addEventListener('click', (e) => {
    const meta = metaFor(f);
    rememberPick(f, meta);
    if (inApp()) {
      e.preventDefault();
      NATIVE.standOpen.postMessage({ url: fileUrl(f.index), title: meta.title, composer: meta.composer, index: f.index });
      toast('IMSLP opens here. Accept their terms if asked; the score then lands on your stand by itself.', 6000);
    } else toast('Accept IMSLP’s terms on their page to download. Then come back and tap Import score.', 6000);
  });
  return a;
}
function metaFor(f) {
  const sp = splitTitle(currentWork.title);
  const part = f.label && !/^complete score$/i.test(f.label) ? ' · ' + f.label : '';
  return { title: sp.work + part, composer: sp.composer, file: f.file };
}
async function rememberPick(f, meta) {
  const picks = (await getSetting('imslpPicks', {})) || {};
  picks[f.index] = { ...meta, at: Date.now() };
  const keys = Object.keys(picks); if (keys.length > 200) delete picks[keys[0]];
  await setSetting('imslpPicks', picks);
}
// Modern editions to buy, searched for this piece.
function editionLinks(q) {
  const e = encodeURIComponent(q);
  return [
    ['Henle', `https://www.henle.de/search?Scope=All&Search=${e}`],
    ['Bärenreiter', `https://www.google.com/search?q=${encodeURIComponent('site:baerenreiter.com ' + q)}`],
    ['Stretta', `https://www.stretta-music.com/en/search/?q=${e}`],
    ['Sheet Music Plus', `https://www.sheetmusicplus.com/en/search?Ntt=${e}`],
  ];
}
function renderBuy(box, q) {
  box.textContent = '';
  box.append(el('div', 'buy-title', 'Buy a modern edition'));
  const row = el('div', 'chips');
  for (const [name, url] of editionLinks(q)) { const a = el('a', 'chip-link', name); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.append(icon('i-ext')); row.append(a); }
  box.append(row);
}
function renderWork(data) {
  const inst = INSTRUMENTS[S.instrument];
  const { picks, groups, mostDownloaded } = rankFiles(data.files, inst.words);
  const st = $('#workStatus');
  if (!data.files.length) { st.hidden = false; st.textContent = 'IMSLP has no PDF scores for this page. It may hold only recordings, or the work is still under copyright.'; return; }
  st.hidden = true;
  const pk = $('#workPicks'); pk.textContent = '';
  const sp = splitTitle(data.title);
  const wq = `${sp.composer.split(' ').pop()} ${sp.work.replace(/\(.*?\)/g, '')}`.trim();
  renderBuy($('#workBuy'), wq);
  const wl = $('#workListen'); wl.textContent = ''; wl.append(el('div', 'buy-title', 'Listen to a performance'));
  const sv = el('div', 'services'); renderServices(sv, wq, true); wl.append(sv);
  const whyText = { mine: `Best for ${inst.label.toLowerCase()}`, score: 'Most downloaded full score', top: 'Most downloaded overall' };
  picks.forEach((p, i) => {
    const c = el('div', 'pick' + (i === 0 ? ' best' : ''));
    const why = el('div', 'why'); why.append(icon('i-star'), document.createTextNode(whyText[p.why])); c.append(why);
    c.append(el('div', 'pl', p.f.label), el('div', 'pm', fileMeta(p.f)));
    c.append(downloadLink(p.f, true));
    pk.append(c);
  });
  const gbox = $('#workGroups'); gbox.textContent = '';
  const total = data.files.length;
  const det = el('details', 'all-editions'); det.append(el('summary', '', `All editions on IMSLP (${total})`));
  gbox.append(det);
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
    det.append(sec);
  }
}

// =====================================================================
// Score viewer
// =====================================================================
const V = { score: null, file: null, base: null, doc: null, page: 0, spread: 1, half: false, cache: new Map(), splits: new Map(), pages: [], inking: false, usedJumps: new Set(), undo: [], redo: [], crop: null };
const stage = $('#stage');
const liveCanvas = el('canvas', 'live-layer'); $('#score').append(liveCanvas);
const zoomPill = el('button', 'zoom-pill num'); zoomPill.hidden = true; $('#score').append(zoomPill);
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
const PAPER_COLOR = { white: '#ffffff', cream: '#FBF6EA', night: '#ffffff' };

async function openScore(id) {
  const score = await db.get('scores', id);
  const file = score && await db.get('files', score.fileId);
  if (!file) { toast('This score’s file is missing.'); return; }
  let base;
  try { base = await openDocument(file); } catch (e) { console.error(e); toast('The score could not be opened.'); return; }
  if (V.base) V.base.destroy();
  V.score = score; V.file = file; V.base = base; V.doc = mapDoc(base, score.pageMap);
  V.cache.clear(); V.splits.clear(); V.undo = []; V.redo = []; V.half = false; V.usedJumps = new Set();
  V.crop = score.trim && score.trimBox ? score.trimBox : null;
  Z.s = 1; Z.x = 0; Z.y = 0;
  V.page = clamp(score.lastPage || 0, 0, V.doc.pages - 1);
  score.opened = Date.now(); db.put('scores', score);
  hidePanel(); clearSelection();
  $('#library').hidden = true; $('#score').hidden = false; document.body.classList.remove('at-home');
  $('#score').dataset.paper = S.paper; setPaperColor(PAPER_COLOR[S.paper] || '#fff');
  $('#scoreTitle').textContent = score.title;
  updateScrub();
  if (score.metro) applyMetroSettings(score.metro);
  showChrome(true);
  await layout();
  keepAwake();
  practice.scoreOpened(score.id);
  loadRef(score);
  if (base.paper) setInking(true);
  else chromeTimer = setTimeout(() => showChrome(false), 2500);
}
function updateScrub() { $('#pageRange').max = V.doc.pages; $('#pageScrub').hidden = V.doc.pages < 3; }
async function closeScore() {
  practice.scoreClosed();
  ref.pause(); loadRef(null);
  setInking(false);
  hidePanel(); clearSelection();
  if (V.score) { V.score.lastPage = V.page; await db.put('scores', V.score); }
  freePages(); for (const p of V.cache.values()) p.then(freeCanvas);
  if (V.base) V.base.destroy();
  V.base = null; V.doc = null; V.score = null; V.cache.clear(); stage.textContent = '';
  $('#score').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home');
  try { wakeLock && wakeLock.release(); } catch {}
  wakeLock = null;
  refreshLibrary();
}
$('#backBtn').addEventListener('click', closeScore);

// iOS keeps canvas memory until a canvas is shrunk; release what is no longer shown.
function freeCanvas(c) { if (c && !c.isConnected) { c.width = 0; c.height = 0; } }
function freePages() { for (const p of V.pages) if (p.ink) { p.ink.width = 0; p.ink.height = 0; } V.pages = []; }

function spreadSize() {
  const r = stage.getBoundingClientRect();
  return S.twoUp && r.width > r.height * 1.05 && V.doc && V.doc.pages > 1 ? 2 : 1;
}
function cropOf() { return V.crop || { x: 0, y: 0, w: 1, h: 1 }; }
// Size on screen of each page box (cropped when trimming margins).
function pageBox(indices) {
  const r = stage.getBoundingClientRect();
  const c = cropOf();
  const pad = 6, gap = indices.length > 1 ? 2 : 0;
  const ratios = indices.map((i) => (V.doc.sizes[i][0] * c.w) / (V.doc.sizes[i][1] * c.h));
  const sum = ratios.reduce((a, b) => a + b, 0);
  const h = Math.min(r.height - pad * 2, (r.width - pad * 2 - gap) / sum);
  return ratios.map((q) => [Math.floor(h * q), Math.floor(h)]);
}
const MAX_PX = 12e6;
function renderPage(i, w, h, zoom = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let pw = w * dpr * zoom, ph = h * dpr * zoom;
  if (pw * ph > MAX_PX) { const k = Math.sqrt(MAX_PX / (pw * ph)); pw *= k; ph *= k; }
  const key = i + '|' + Math.round(pw) + 'x' + Math.round(ph);
  if (V.cache.has(key)) { const v = V.cache.get(key); V.cache.delete(key); V.cache.set(key, v); return v; }
  const canvas = el('canvas', 'art');
  const p = V.doc.render(i, canvas, pw, ph).then(() => canvas);
  V.cache.set(key, p);
  while (V.cache.size > 6) { const k = V.cache.keys().next().value; const old = V.cache.get(k); V.cache.delete(k); old.then(freeCanvas); }
  return p;
}
let layoutToken = 0;
async function layout(fade) {
  if (!V.doc) return;
  const token = ++layoutToken;
  V.spread = spreadSize();
  if (V.spread === 2) V.half = false;
  clearSelection();
  const spread = el('div', 'spread');
  const c = cropOf();
  const entries = [];
  let label;
  const makeBox = (bw, bh) => {
    const pg = el('div', 'pg'); pg.style.width = bw + 'px'; pg.style.height = bh + 'px';
    const inner = el('div', 'pgi');
    const iw = bw / c.w, ih = bh / c.h;
    inner.style.width = iw + 'px'; inner.style.height = ih + 'px';
    inner.style.left = -c.x * iw + 'px'; inner.style.top = -c.y * ih + 'px';
    pg.append(inner);
    return { pg, inner, iw, ih };
  };
  if (V.half && V.page + 1 < V.doc.pages) {
    const [box] = pageBox([V.page]);
    const b = makeBox(box[0], box[1]);
    const [cur, next] = await Promise.all([renderPage(V.page, b.iw, b.ih), renderPage(V.page + 1, b.iw, b.ih)]);
    if (token !== layoutToken) return;
    const key = V.page + ':' + cur.width;
    if (!V.splits.has(key)) V.splits.set(key, findSplit(cur, next));
    const split = V.splits.get(key);
    b.inner.style.setProperty('--split', (split * 100).toFixed(2) + '%');
    cur.className = 'art bottom-part'; next.className = 'art top-part';
    const line = el('div', 'half-line'); line.style.top = (split * 100) + '%';
    const tag = el('div', 'half-tag', `↑ page ${V.page + 2}   ·   page ${V.page + 1} ↓`); tag.style.top = (split * 100) + '%';
    b.inner.append(cur, next, line, tag);
    spread.append(b.pg);
    label = `${V.page + 1}½`;
  } else {
    V.half = false;
    const idx = [V.page]; if (V.spread === 2 && V.page + 1 < V.doc.pages) idx.push(V.page + 1);
    const boxes = pageBox(idx);
    const made = boxes.map(([bw, bh]) => makeBox(bw, bh));
    const canvases = await Promise.all(idx.map((i, k) => renderPage(i, made[k].iw, made[k].ih)));
    if (token !== layoutToken) return;
    idx.forEach((i, k) => {
      const b = made[k];
      const art = canvases[k]; art.className = 'art';
      const ink = el('canvas', 'ink'); ink.width = art.width; ink.height = art.height;
      b.inner.append(art, ink); spread.append(b.pg);
      const layer = new InkLayer(ink, V.score.id, V.doc.orig(i));
      entries.push({ index: i, orig: V.doc.orig(i), pg: b.pg, inner: b.inner, art, ink, layer, iw: b.iw, ih: b.ih });
    });
    label = idx.length > 1 ? `${idx[0] + 1}–${idx[1] + 1}` : `${idx[0] + 1}`;
  }
  freePages();
  V.pages = entries;
  stage.textContent = '';
  stage.append(spread);
  Z.el = spread; Z.s = 1; Z.x = 0; Z.y = 0; Z.sharp = 1; applyZoom();
  if (fade && !matchMedia('(prefers-reduced-motion: reduce)').matches) { spread.classList.add('fade'); requestAnimationFrame(() => requestAnimationFrame(() => spread.classList.remove('fade'))); }
  $('#pageLabel').textContent = label + ' / ' + V.doc.pages;
  $('#pageRange').value = V.page + 1;
  setTimeout(() => {
    if (token !== layoutToken || !V.doc) return;
    for (const start of [V.page + V.spread, V.page - V.spread]) {
      if (start < 0 || start >= V.doc.pages) continue;
      const ids = [start]; if (V.spread === 2 && start + 1 < V.doc.pages) ids.push(start + 1);
      pageBox(ids).forEach((b, k) => renderPage(ids[k], b[0] / cropOf().w, b[1] / cropOf().h));
    }
  }, 80);
}
function goTo(page, fade = true) {
  if (!V.doc) return;
  V.page = clamp(page, 0, V.doc.pages - 1); V.half = false; V.score.lastPage = V.page;
  if (V.page === 0) V.usedJumps.clear();
  layout(fade);
}
function turn(dir) {
  if (!V.doc) return;
  if (dir > 0) {
    const last = V.page + (V.spread === 2 ? 1 : 0);
    const jumps = V.score.jumps || [];
    const j = jumps.find((x, i) => x.from - 1 >= V.page && x.from - 1 <= last && !(x.once && V.usedJumps.has(i)));
    if (j && !V.half) {
      const i = jumps.indexOf(j); if (j.once) V.usedJumps.add(i);
      toast(`Jump to page ${j.to}`, 1400);
      goTo(j.to - 1);
      return;
    }
  }
  if (S.halfTurn && V.spread === 1 && !V.inking) {
    if (dir > 0) {
      if (!V.half && V.page + 1 < V.doc.pages) { V.half = true; layout(true); return; }
      if (V.half) { goTo(V.page + 1); return; }
      return;
    }
    if (V.half) { V.half = false; layout(true); return; }
  }
  const next = clamp(V.page + dir * V.spread, 0, Math.max(0, V.doc.pages - 1));
  if (next === V.page) return;
  goTo(next);
}
window.standTurn = turn;
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (V.doc) { V.cache.clear(); layout(); } sizeLive(); }, 150); });
$('#pageRange').addEventListener('input', (e) => goTo(+e.target.value - 1, false));

let chromeTimer;
function showChrome(on) { clearTimeout(chromeTimer); $('#score').classList.toggle('chrome-off', !on); }
document.addEventListener('keydown', (e) => {
  if ($('#score').hidden || e.target.matches('input, select, textarea')) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); turn(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

// ---------- zoom ----------
const Z = { s: 1, x: 0, y: 0, el: null, sharpT: 0, sharp: 1 };
function spreadNatural() {
  // position of the spread inside the stage before our transform
  const sr = stage.getBoundingClientRect();
  const w = Z.el.offsetWidth, h = Z.el.offsetHeight;
  return { ox: (sr.width - w) / 2, oy: (sr.height - h) / 2, w, h, sw: sr.width, sh: sr.height, left: sr.left, top: sr.top };
}
function clampZoom() {
  const n = spreadNatural();
  const cw = n.w * Z.s, ch = n.h * Z.s;
  if (cw <= n.sw) Z.x = (n.sw - cw) / 2 - n.ox; else Z.x = clamp(Z.x, n.sw - cw - n.ox, -n.ox);
  if (ch <= n.sh) Z.y = (n.sh - ch) / 2 - n.oy; else Z.y = clamp(Z.y, n.sh - ch - n.oy, -n.oy);
}
function applyZoom() {
  if (!Z.el) return;
  if (Z.s <= 1.001) { Z.s = 1; Z.x = 0; Z.y = 0; Z.el.style.transform = ''; }
  else { clampZoom(); Z.el.style.transform = `translate(${Z.x}px, ${Z.y}px) scale(${Z.s})`; }
  zoomPill.hidden = Z.s <= 1.001;
  zoomPill.textContent = Math.round(Z.s * 100) + '%  ·  Reset';
  if (Sel.entry) placeSelection();
}
function scheduleSharpen() {
  clearTimeout(Z.sharpT);
  Z.sharpT = setTimeout(sharpen, 260);
}
// After zooming, render the visible pages again at the new size so the music stays crisp.
async function sharpen() {
  const want = Z.s > 1.15 ? Math.min(Z.s, 4) : 1;
  if (Math.abs(want - Z.sharp) < 0.2 && !(want === 1 && Z.sharp !== 1)) return;
  Z.sharp = want;
  const token = layoutToken;
  for (const p of V.pages) {
    const art = await renderPage(p.index, p.iw, p.ih, want);
    if (token !== layoutToken) return;
    if (art !== p.art) {
      art.className = 'art';
      p.inner.replaceChild(art, p.art); p.art = art;
      p.layer.resize(art.width, art.height);
    }
  }
}
function setZoomAt(s, cx, cy, base) {
  // keep the point under (cx, cy) still while scaling from base
  const n = spreadNatural();
  const wx = (cx - n.left - n.ox - base.x) / base.s, wy = (cy - n.top - n.oy - base.y) / base.s;
  Z.s = clamp(s, 1, 5);
  Z.x = cx - n.left - n.ox - wx * Z.s; Z.y = cy - n.top - n.oy - wy * Z.s;
  applyZoom();
}
zoomPill.addEventListener('click', () => { Z.s = 1; applyZoom(); scheduleSharpen(); });

// ---------- live drawing layer ----------
function sizeLive() {
  const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  liveCanvas.style.left = r.left + 'px'; liveCanvas.style.top = r.top + 'px';
  liveCanvas.style.width = r.width + 'px'; liveCanvas.style.height = r.height + 'px';
  liveCanvas.width = Math.round(r.width * dpr); liveCanvas.height = Math.round(r.height * dpr);
}
function clearLive() { liveCanvas.getContext('2d').clearRect(0, 0, liveCanvas.width, liveCanvas.height); }
// Draw an item on the live layer in the coordinates of a page.
function drawLiveItem(entry, item, extra, clear = true) {
  const g = liveCanvas.getContext('2d');
  const sr = stage.getBoundingClientRect(), r = entry.inner.getBoundingClientRect();
  const k = liveCanvas.width / sr.width;
  if (clear) g.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  g.save();
  g.setTransform(1, 0, 0, 1, (r.left - sr.left) * k, (r.top - sr.top) * k);
  const it = extra && extra.length ? { ...item, p: item.p.concat(extra) } : item;
  drawItem(g, it, r.width * k, r.height * k, true);
  g.restore();
}
function drawLasso(pts) {
  const g = liveCanvas.getContext('2d'); const sr = stage.getBoundingClientRect(); const k = liveCanvas.width / sr.width;
  g.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  if (pts.length < 2) return;
  g.save(); g.setTransform(k, 0, 0, k, -sr.left * k, -sr.top * k);
  g.setLineDash([6, 5]); g.lineWidth = 1.6; g.strokeStyle = css('--accent-text'); g.fillStyle = css('--accent-soft');
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------- markings state ----------
const INK = {
  tool: 'pen', finger: false, stamp: 'p', erase: 'smart',
  slots: [COLORS[0], COLORS[2]], slot: 0,
  pen: { size: 3, a: 1 }, hl: { c: COLORS[4], size: 5, a: 0.4 }, stampStyle: { size: 5, a: 1 }, white: { size: 6 },
};
const inkSize = (tool, v) => tool === 'pen' ? 0.0011 + v * 0.00055 : tool === 'hl' ? 0.006 + v * 0.0024 : tool === 'white' ? 0.004 + v * 0.003 : 0.014 + v * 0.0042;
const penColor = () => INK.slots[INK.slot];
function persistInk() { S.ink = { tool: ['pen', 'hl', 'stamp'].includes(INK.tool) ? INK.tool : 'pen', finger: INK.finger, stamp: INK.stamp, erase: INK.erase, slots: INK.slots, slot: INK.slot, pen: INK.pen, hl: INK.hl, stampStyle: INK.stampStyle, white: INK.white }; saveSettings(); }
function styleFor(tool) { return tool === 'stamp' ? INK.stampStyle : tool === 'hl' ? INK.hl : INK.pen; }
function colorFor(tool) { return tool === 'hl' ? INK.hl.c : penColor(); }
let hintT;
function inkHint(msg, ms = 3200) { const h = $('#inkHint'); h.textContent = msg; h.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => (h.hidden = true), ms); }
function setInking(on) {
  if (on && V.half) { V.half = false; layout(); }
  V.inking = on;
  $('#inkbar').hidden = !on; $('#inkBtn').classList.toggle('on', on);
  stage.classList.toggle('inking', on);
  closeInkPops(); clearSelection();
  if (on) {
    showChrome(true); hidePanel(); loadMusicFont(); sizeLive(); syncInkBar();
    inkHint(INK.finger ? 'Your finger writes. Two fingers zoom and move; swipe with two fingers to turn.' : 'The Pencil writes. Your finger turns pages, pinches to zoom and moves the page.');
  } else { $('#inkHint').hidden = true; clearLive(); }
}
function closeInkPops() { $('#inkPop').hidden = true; $('#stampPop').hidden = true; $('#erasePop').hidden = true; }
function syncInkBar() {
  $$('.ink-tool[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === INK.tool));
  $$('.slot').forEach((b, i) => { b.style.setProperty('--c', INK.slots[i]); b.classList.toggle('on', i === INK.slot && INK.tool !== 'hl'); });
  const hlDot = $('#hlDot'); if (hlDot) hlDot.style.setProperty('--c', INK.hl.c);
  $('#fingerBtn').classList.toggle('on', INK.finger);
  $('#inkUndo').disabled = !V.undo.length; $('#inkRedo').disabled = !V.redo.length;
}
function fillInkPop() {
  const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen';
  const st = styleFor(tool), cur = colorFor(tool);
  $('#inkPopTitle').textContent = tool === 'hl' ? 'Highlighter' : `Colour ${INK.slot + 1}`;
  const sw = $('#swatches'); sw.textContent = '';
  for (const c of COLORS) {
    const b = el('button'); b.style.setProperty('--c', c); b.classList.toggle('on', c === cur); b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => { if (tool === 'hl') INK.hl.c = c; else INK.slots[INK.slot] = c; fillInkPop(); syncInkBar(); persistInk(); });
    sw.append(b);
  }
  $('#inkSize').value = st.size; $('#inkSizeVal').textContent = st.size;
  $('#inkAlpha').value = Math.round(st.a * 100); $('#inkAlphaVal').textContent = Math.round(st.a * 100) + '%';
  drawInkPreview();
}
function drawInkPreview() {
  const c = $('#inkPreview'); const dpr = devicePixelRatio || 1; const W = c.clientWidth || 300, H = c.clientHeight || 54;
  c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen', st = styleFor(tool);
  if (tool === 'stamp') { loadMusicFont().then(() => { g.clearRect(0, 0, c.width, c.height); drawItem(g, { t: 'stamp', k: INK.stamp, c: penColor(), a: st.a, s: inkSize('stamp', st.size) * (800 / W), x: 0.5, y: 0.5 }, c.width, c.height); }); return; }
  const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([0.08 + 0.84 * t, 0.5 + 0.22 * Math.sin(t * Math.PI * 2), tool === 'pen' ? 0.35 + 0.5 * Math.sin(t * Math.PI) : 0.5]); }
  drawItem(g, { t: tool, c: colorFor(tool), a: st.a, s: inkSize(tool, st.size) * (800 / W), p: pts }, c.width, c.height);
}
$('#inkSize').addEventListener('input', (e) => { const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen'; styleFor(tool).size = +e.target.value; $('#inkSizeVal').textContent = e.target.value; drawInkPreview(); persistInk(); });
$('#inkAlpha').addEventListener('input', (e) => { const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen'; styleFor(tool).a = +e.target.value / 100; $('#inkAlphaVal').textContent = e.target.value + '%'; drawInkPreview(); syncInkBar(); persistInk(); });
$('#inkColorBtn').addEventListener('click', () => { const p = $('#inkPop'); const open = p.hidden; closeInkPops(); p.hidden = !open; if (open) fillInkPop(); });
$$('.slot').forEach((b, i) => b.addEventListener('click', () => {
  const again = INK.slot === i && ['pen', 'stamp'].includes(INK.tool);
  INK.slot = i; if (!['pen', 'stamp'].includes(INK.tool)) INK.tool = 'pen';
  syncInkBar(); persistInk(); clearSelection();
  if (again) { const p = $('#inkPop'); const open = p.hidden; closeInkPops(); p.hidden = !open; if (open) fillInkPop(); } else closeInkPops();
}));
(function buildStampGrid() {
  const g = $('#stampGrid');
  for (const st of STAMPS) {
    const b = el('button', st.font === 'music' ? '' : st.font, st.label);
    b.dataset.k = st.k; b.setAttribute('aria-label', st.k);
    b.addEventListener('click', () => { INK.stamp = st.k; INK.tool = 'stamp'; $$('#stampGrid button').forEach((x) => x.classList.toggle('on', x === b)); syncInkBar(); persistInk(); closeInkPops(); inkHint('Tap the music to place it.'); });
    g.append(b);
  }
})();
$$('.ink-tool[data-tool]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  const wasSame = INK.tool === t;
  closeInkPops(); clearSelection();
  if (t === 'stamp') { $('#stampPop').hidden = wasSame && !$('#stampPop').hidden; $$('#stampGrid button').forEach((x) => x.classList.toggle('on', x.dataset.k === INK.stamp)); loadMusicFont(); }
  if (t === 'print') { $('#erasePop').hidden = wasSame; syncErasePop(); clearTimeout(erasePopT); erasePopT = setTimeout(() => { $('#erasePop').hidden = true; }, 6000); }
  if (t === 'select') inkHint('Draw a loop around markings to select them.');
  INK.tool = t; syncInkBar(); persistInk();
}));
function syncErasePop() { $$('#eraseMode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === INK.erase)); $('#eraseHint').textContent = INK.erase === 'smart' ? 'Scribble over a printed fingering, dynamic, word or slur. Stand removes exactly that shape. Anything joined to the staff stays.' : 'Paint over any part of the printed page to cover it with paper colour.'; }
let erasePopT;
$$('#eraseMode button').forEach((b) => b.addEventListener('click', () => { INK.erase = b.dataset.mode; syncErasePop(); persistInk(); clearTimeout(erasePopT); erasePopT = setTimeout(() => { $('#erasePop').hidden = true; }, 1200); }));
$('#fingerBtn').addEventListener('click', () => { INK.finger = !INK.finger; syncInkBar(); persistInk(); inkHint(INK.finger ? 'Finger writing on. Two fingers zoom; swipe with two fingers to turn.' : 'Finger writing off. The Pencil writes, your finger turns pages.'); });
$('#inkBtn').addEventListener('click', () => setInking(!V.inking));
$('#inkDone').addEventListener('click', () => setInking(false));

// ---------- undo (by page key, so it survives zooming, colour changes and page turns) ----------
function layerFor(key) { const p = V.pages.find((x) => x.layer && x.layer.key === key); return p && p.layer; }
function applyItems(key, items) { const L = layerFor(key); if (L) L.setItems(items.slice()); else saveItems(key, items); }
function pushUndo(key, before, after) { V.undo.push({ key, before, after }); if (V.undo.length > 200) V.undo.shift(); V.redo = []; syncInkBar(); }
function undo() { clearSelection(); const u = V.undo.pop(); if (!u) return; applyItems(u.key, u.before); V.redo.push(u); syncInkBar(); }
function redo() { clearSelection(); const u = V.redo.pop(); if (!u) return; applyItems(u.key, u.after); V.undo.push(u); syncInkBar(); }
$('#inkUndo').addEventListener('click', undo);
$('#inkRedo').addEventListener('click', redo);

// ---------- selection (lasso) ----------
const Sel = { entry: null, idx: [], box: null, el: null };
function clearSelection() {
  if (Sel.el) Sel.el.remove();
  if (Sel.entry) Sel.entry.layer.redraw();
  Sel.entry = null; Sel.idx = []; Sel.box = null; Sel.el = null;
}
function selectionBox(entry, idx) {
  let b = null;
  for (const i of idx) { const r = itemBounds(entry.layer.items[i]); b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r; }
  return b;
}
function placeSelection() {
  if (!Sel.el || !Sel.box) return;
  const b = Sel.box;
  Object.assign(Sel.el.style, { left: b.x0 * 100 + '%', top: b.y0 * 100 + '%', width: (b.x1 - b.x0) * 100 + '%', height: (b.y1 - b.y0) * 100 + '%' });
  Sel.el.style.setProperty('--inv', 1 / Z.s);
}
function makeSelection(entry, idx) {
  clearSelection();
  if (!idx.length) return;
  Sel.entry = entry; Sel.idx = idx; Sel.box = selectionBox(entry, idx);
  const box = el('div', 'sel-box');
  const handle = el('div', 'sel-handle');
  const bar = el('div', 'sel-bar');
  const mk = (label, fn, cls) => {
    const b = el('button', cls || '', label);
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    b.addEventListener('pointerup', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  bar.append(
    mk('Colour', () => editSelection((s) => (s.t === 'pen' || s.t === 'stamp' ? { ...s, c: penColor() } : s))),
    mk('Duplicate', duplicateSelection),
    mk('Delete', deleteSelection, 'danger'),
  );
  box.append(handle, bar);
  if (Sel.box.y0 < 0.07) bar.classList.add('below');
  entry.inner.append(box);
  Sel.el = box; placeSelection();
  // drag to move, corner to resize
  let drag = null;
  const start = (e, mode) => {
    e.preventDefault(); e.stopPropagation();
    box.setPointerCapture(e.pointerId);
    const r = entry.inner.getBoundingClientRect();
    drag = { mode, x: e.clientX, y: e.clientY, r, box: { ...Sel.box } };
  };
  box.addEventListener('pointerdown', (e) => start(e, e.target === handle ? 'scale' : 'move'));
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / drag.r.width, dy = (e.clientY - drag.y) / drag.r.height;
    let k = 1, mx = dx, my = dy;
    if (drag.mode === 'scale') {
      const w0 = drag.box.x1 - drag.box.x0, h0 = drag.box.y1 - drag.box.y0;
      k = clamp(1 + Math.max(dx / w0, dy / h0), 0.2, 6);
      mx = 0; my = 0;
    }
    drag.k = k; drag.dx = mx; drag.dy = my;
    const ox = drag.box.x0, oy = drag.box.y0;
    Sel.box = { x0: ox + mx, y0: oy + my, x1: ox + mx + (drag.box.x1 - ox) * k, y1: oy + my + (drag.box.y1 - oy) * k };
    placeSelection();
    // preview on the live layer
    clearLive();
    for (const i of Sel.idx) drawLiveItem(entry, transformItem(entry.layer.items[i], mx, my, k, ox, oy), null, false);
    entry.layer.redraw(new Set(Sel.idx));
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; clearLive();
    if (!d.k && !d.dx && !d.dy) { entry.layer.redraw(); return; }
    const k = d.k || 1, dx = d.dx || 0, dy = d.dy || 0, ox = d.box.x0, oy = d.box.y0;
    editSelection((s) => transformItem(s, dx, dy, k, ox, oy), true);
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
function editSelection(fn, keepBox) {
  const entry = Sel.entry; if (!entry) return;
  const before = entry.layer.items.slice();
  const after = before.map((s, i) => (Sel.idx.includes(i) ? fn(s) : s));
  entry.layer.setItems(after);
  pushUndo(entry.layer.key, before, after.slice());
  const idx = Sel.idx;
  if (keepBox) { Sel.box = selectionBox(entry, idx); placeSelection(); } else makeSelection(entry, idx);
}
function duplicateSelection() {
  const entry = Sel.entry; if (!entry) return;
  const before = entry.layer.items.slice();
  const copies = Sel.idx.map((i) => transformItem(before[i], 0.02, 0.02, 1, 0, 0));
  const after = [...before, ...copies];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  makeSelection(entry, copies.map((_, k) => before.length + k));
}
function deleteSelection() {
  const entry = Sel.entry; if (!entry) return;
  const before = entry.layer.items.slice();
  const after = before.filter((_, i) => !Sel.idx.includes(i));
  clearSelection();
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
}

// ---------- one gesture handler for Pencil, fingers and pinch ----------
const PT = new Map();          // active pointers
let GS = null;                 // current gesture
let penDown = false, lastPenUp = 0;
const now = () => performance.now();
function entryAt(x, y) {
  for (const p of V.pages) { const r = p.pg.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return p; }
  return null;
}
function relPos(entry, e, rect) {
  const r = rect || entry.inner.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5];
}
function touches() { return [...PT.values()].filter((p) => p.type === 'touch' && !p.palm); }

function startInk(e, entry) {
  const tool = INK.tool;
  const rect = entry.inner.getBoundingClientRect();
  const p = relPos(entry, e, rect);
  const before = entry.layer.items.slice();
  closeInkPops();
  if (tool === 'stamp') {
    const st = INK.stampStyle;
    const item = { t: 'stamp', k: INK.stamp, c: penColor(), a: st.a, s: inkSize('stamp', st.size), x: +p[0].toFixed(4), y: +p[1].toFixed(4) };
    entry.layer.commit(item); pushUndo(entry.layer.key, before, entry.layer.items.slice());
    GS = { kind: 'done', id: e.pointerId };
    return;
  }
  if (tool === 'eraser') { GS = { kind: 'erase', id: e.pointerId, entry, rect, before, type: e.pointerType }; entry.layer.eraseAt(p[0], p[1], 0.016); showEraserDot(e); return; }
  if (tool === 'select') { GS = { kind: 'lasso', id: e.pointerId, entry, rect, pts: [[e.clientX, e.clientY]], rel: [p], type: e.pointerType }; return; }
  if (tool === 'print' && INK.erase === 'smart') {
    GS = { kind: 'smart', id: e.pointerId, entry, rect, before, type: e.pointerType, t0: now(), item: { t: 'hl', c: '#ff5a5f', a: 0.35, s: 0.012, p: [p] } };
    scheduleLive(); return;
  }
  const t = tool === 'print' ? 'white' : tool === 'hl' ? 'hl' : 'pen';
  const st = t === 'white' ? INK.white : styleFor(t);
  const item = { t, c: t === 'white' ? '#fff' : colorFor(t), a: t === 'white' ? 1 : st.a, s: inkSize(t, st.size), p: [p] };
  GS = { kind: 'ink', id: e.pointerId, entry, rect, before, item, type: e.pointerType, t0: now(), predicted: null };
  scheduleLive();
}
let liveRaf = 0;
function scheduleLive() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0;
    if (GS && (GS.kind === 'ink' || GS.kind === 'smart')) drawLiveItem(GS.entry, GS.item, GS.predicted);
    else if (GS && GS.kind === 'lasso') drawLasso(GS.pts);
  });
}
function moveInk(e) {
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  if (GS.kind === 'erase') { for (const ev of list) { const p = relPos(GS.entry, ev, GS.rect); GS.entry.layer.eraseAt(p[0], p[1], 0.016); } showEraserDot(e); return; }
  if (GS.kind === 'lasso') { for (const ev of list) { GS.pts.push([ev.clientX, ev.clientY]); GS.rel.push(relPos(GS.entry, ev, GS.rect)); } scheduleLive(); return; }
  const pts = GS.item.p;
  for (const ev of list) {
    const p = relPos(GS.entry, ev, GS.rect);
    const last = pts[pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.00025) continue;
    // calm the pressure a little: Pencil pressure is noisy at the start of a stroke
    p[2] = last[2] + (p[2] - last[2]) * 0.45;
    pts.push(p);
  }
  const pr = e.getPredictedEvents ? e.getPredictedEvents() : [];
  GS.predicted = GS.kind === 'ink' && pr.length ? pr.slice(-2).map((ev) => relPos(GS.entry, ev, GS.rect)) : null;
  scheduleLive();
}
function endInk(cancelled) {
  const g = GS; GS = null;
  cancelAnimationFrame(liveRaf); liveRaf = 0; clearLive(); hideEraserDot();
  if (!g) return;
  if (cancelled) return;
  const L = g.entry && g.entry.layer;
  if (g.kind === 'erase') { if (L.items.length !== g.before.length) pushUndo(L.key, g.before, L.items.slice()); return; }
  if (g.kind === 'lasso') {
    if (g.rel.length < 4) return;
    const idx = itemsInLasso(L.items, g.rel);
    if (!idx.length) { inkHint('Nothing inside. Draw the loop around your markings.'); return; }
    makeSelection(g.entry, idx);
    return;
  }
  if (g.kind === 'smart') {
    const res = smartMask(g.entry.art, g.item.p);
    if (!res.item) { inkHint(res.rejected ? 'That shape is joined to the staff or notes. Switch to Brush to cover it by hand.' : 'Nothing printed there.'); return; }
    L.commit(res.item); pushUndo(L.key, g.before, L.items.slice());
    return;
  }
  const done = g.item;
  done.p = done.p.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5), +p[2].toFixed(2)]);
  L.commit(done);
  pushUndo(L.key, g.before, L.items.slice());
}
let eraserDot = null;
function showEraserDot(e) {
  if (!eraserDot) { eraserDot = el('div', 'eraser-dot'); document.body.append(eraserDot); }
  eraserDot.hidden = false; eraserDot.style.left = e.clientX + 'px'; eraserDot.style.top = e.clientY + 'px';
}
function hideEraserDot() { if (eraserDot) eraserDot.hidden = true; }

function startNav(e) { GS = { kind: 'nav', id: e.pointerId, x: e.clientX, y: e.clientY, t0: now(), zx: Z.x, zy: Z.y, moved: false }; }
function startPinch() {
  const t = touches(); if (t.length < 2) return;
  const [a, b] = t;
  GS = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx0: (a.x + b.x) / 2, cy0: (a.y + b.y) / 2, base: { s: Z.s, x: Z.x, y: Z.y }, t0: now() };
}

stage.addEventListener('pointerdown', (e) => {
  if (!V.doc) return;
  const t = now();
  const info = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, palm: false };
  PT.set(e.pointerId, info);
  try { stage.setPointerCapture(e.pointerId); } catch {}
  if (e.pointerType === 'pen' || e.pointerType === 'mouse') {
    if (GS && GS.type === 'touch' && (GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase')) endInk(true);
    if (e.pointerType === 'pen') { penDown = true; for (const p of PT.values()) if (p.type === 'touch') p.palm = true; }
    if (V.inking) { const entry = entryAt(e.clientX, e.clientY); if (entry) { e.preventDefault(); startInk(e, entry); return; } }
    if (!V.inking || e.pointerType === 'mouse') startNav(e);
    return;
  }
  // touch
  if (penDown || t - lastPenUp < 350) { info.palm = true; return; }
  const n = touches().length;
  if (n >= 2) {
    if (GS && (GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso')) {
      // a second finger means zoom: drop a stroke that has only just started
      const young = now() - GS.t0 < 350 || (GS.item && GS.item.p.length < 8);
      endInk(young);
    }
    startPinch();
    return;
  }
  if (V.inking && INK.finger) { const entry = entryAt(e.clientX, e.clientY); if (entry) { e.preventDefault(); startInk(e, entry); return; } }
  startNav(e);
});
window.addEventListener('pointermove', (e) => {
  const p = PT.get(e.pointerId); if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (!GS) return;
  if ((GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso') && GS.id === e.pointerId) { moveInk(e); return; }
  if (GS.kind === 'pinch') {
    const t = touches(); if (t.length < 2) return;
    const [a, b] = t;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const s = GS.base.s * (d / GS.d0);
    // zoom about the first centre, then follow the fingers (two-finger pan)
    setZoomAt(s, GS.cx0, GS.cy0, GS.base);
    if (Z.s > 1.001) { Z.x += cx - GS.cx0; Z.y += cy - GS.cy0; applyZoom(); }
    GS.lastDx = cx - GS.cx0; GS.lastDs = d / GS.d0;
    return;
  }
  if (GS.kind === 'nav' && GS.id === e.pointerId) {
    const dx = e.clientX - GS.x, dy = e.clientY - GS.y;
    if (Math.hypot(dx, dy) > 8) GS.moved = true;
    if (Z.s > 1.001 && GS.moved) { Z.x = GS.zx + dx; Z.y = GS.zy + dy; applyZoom(); }
  }
});
function pointerEnd(e) {
  const p = PT.get(e.pointerId);
  PT.delete(e.pointerId);
  try { stage.releasePointerCapture(e.pointerId); } catch {}
  if (e.pointerType === 'pen') { penDown = false; lastPenUp = now(); }
  if (!GS) return;
  if ((GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso') && GS.id === e.pointerId) { endInk(false); return; }
  if (GS.kind === 'done' && GS.id === e.pointerId) { GS = null; return; }
  if (GS.kind === 'pinch') {
    if (touches().length < 2) {
      const g = GS; GS = PT.size ? { kind: 'wait' } : null;
      scheduleSharpen();
      // a quick two-finger swipe without zooming turns the page
      if (Z.s <= 1.001 && Math.abs(g.lastDs - 1) < 0.08 && Math.abs(g.lastDx || 0) > 90 && now() - g.t0 < 700) turn(g.lastDx < 0 ? 1 : -1);
    }
    return;
  }
  if (GS.kind === 'wait') { if (!touches().length) GS = null; return; }
  if (GS.kind === 'nav' && GS.id === e.pointerId) {
    const g = GS; GS = null;
    if (!p || e.type === 'pointercancel') return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = now() - g.t0;
    if (Z.s > 1.001) {
      if (g.moved) { scheduleSharpen(); return; }
    } else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 800) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 12 || dt > 600) return;
    // double tap: zoom in, or back out
    const w = window.innerWidth;
    if (lastTap && now() - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40 && e.clientX > w * 0.32 && e.clientX < w * 0.68) {
      lastTap = null;
      if (Z.s > 1.001) { Z.s = 1; applyZoom(); } else setZoomAt(2.2, e.clientX, e.clientY, { s: 1, x: 0, y: 0 });
      scheduleSharpen(); return;
    }
    lastTap = { t: now(), x: e.clientX, y: e.clientY };
    if (e.clientX > w * 0.68) turn(1);
    else if (e.clientX < w * 0.32) turn(-1);
    else if (!V.inking) showChrome($('#score').classList.contains('chrome-off'));
  }
}
let lastTap = null;
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
// iOS: stop the page itself from scrolling or zooming while we handle touches
stage.addEventListener('touchstart', (e) => { if (e.touches.length > 1 || V.inking) e.preventDefault(); }, { passive: false });
stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));

// ---------- bookmarks and jumps ----------
function renderBookmarks() {
  const ul = $('#bmList'); ul.textContent = '';
  for (const [i, b] of (V.score.bookmarks || []).entries()) {
    const li = el('li'); const go = el('button', 'go', b.name);
    go.addEventListener('click', () => { hidePanel(); goTo(b.page - 1); });
    const del = el('button', 'icon-btn small'); del.append(icon('i-close')); del.setAttribute('aria-label', 'Remove bookmark');
    del.addEventListener('click', () => { V.score.bookmarks.splice(i, 1); db.put('scores', V.score); renderBookmarks(); });
    li.append(go, el('span', 'num', 'p. ' + b.page), del); ul.append(li);
  }
}
$('#bmAdd').addEventListener('click', () => {
  const n = (V.score.bookmarks || []).length + 1;
  const bm = { name: 'Bookmark ' + n, page: V.page + 1 };
  V.score.bookmarks = [...(V.score.bookmarks || []), bm].sort((a, b) => a.page - b.page);
  db.put('scores', V.score); renderBookmarks();
  const li = $$('#bmList li').find((x) => x.querySelector('.go').textContent === bm.name);
  if (li) {
    const go = li.querySelector('.go'); const inp = el('input'); inp.value = go.textContent; inp.className = 'go';
    go.replaceWith(inp); inp.focus(); inp.select();
    const save = () => { bm.name = inp.value.trim() || bm.name; db.put('scores', V.score); renderBookmarks(); };
    inp.addEventListener('blur', save); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  }
});
function renderJumps() {
  const ul = $('#jumpList'); ul.textContent = '';
  for (const [i, j] of (V.score.jumps || []).entries()) {
    const li = el('li'); li.append(el('span', 'go', `After page ${j.from} → page ${j.to}${j.once ? ' (first time)' : ''}`));
    const del = el('button', 'icon-btn small'); del.append(icon('i-close')); del.setAttribute('aria-label', 'Remove jump');
    del.addEventListener('click', () => { V.score.jumps.splice(i, 1); db.put('scores', V.score); renderJumps(); });
    li.append(del); ul.append(li);
  }
  $('#jumpFrom').max = $('#jumpTo').max = V.doc ? V.doc.pages : 999;
  if (!$('#jumpFrom').value) $('#jumpFrom').value = V.page + 1 + (V.spread === 2 ? 1 : 0);
}
$('#jumpAdd').addEventListener('click', () => {
  const n = V.doc.pages, from = +$('#jumpFrom').value, to = +$('#jumpTo').value;
  if (!(from >= 1 && from <= n && to >= 1 && to <= n && from !== to)) { toast(`Use page numbers between 1 and ${n}.`); return; }
  V.score.jumps = [...(V.score.jumps || []), { from, to, once: $('#jumpOnce').checked }];
  db.put('scores', V.score); V.usedJumps.clear(); $('#jumpTo').value = ''; renderJumps();
});
async function reopenDoc() {
  V.doc = mapDoc(V.base, V.score.pageMap);
  V.score.pages = V.doc.pages;
  V.cache.clear(); V.splits.clear();
  updateScrub();
  await db.put('scores', V.score);
}
$('#paperAdd').addEventListener('click', async () => {
  if (!V.file || V.file.kind !== 'paper') return;
  V.file.pages = (V.file.pages || 1) + 1;
  if (V.score.pageMap) V.score.pageMap.push(V.file.pages - 1);
  await db.put('files', V.file);
  V.base = await openDocument(V.file);
  await reopenDoc();
  hidePanel(); goTo(V.doc.pages - 1); toast('Page added');
});

// ---------- pages: delete and restore ----------
async function renderPagesPanel() {
  const grid = $('#pageGrid'); grid.textContent = '';
  const map = V.score.pageMap || [...Array(V.base.pages).keys()];
  const token = {}; renderPagesPanel.token = token;
  const items = [];
  for (let o = 0; o < V.base.pages; o++) {
    const shown = map.includes(o);
    const card = el('div', 'pthumb' + (shown ? '' : ' gone'));
    const cv = el('canvas'); card.append(cv);
    const lab = el('span', 'num', shown ? 'Page ' + (map.indexOf(o) + 1) : 'Deleted');
    const btn = el('button', 'btn small ' + (shown ? 'danger-text' : ''), shown ? 'Delete' : 'Restore');
    btn.addEventListener('click', async () => {
      if (shown && map.length <= 1) { toast('A score needs at least one page.'); return; }
      const cur = V.score.pageMap || [...Array(V.base.pages).keys()];
      const delIndex = cur.indexOf(o);
      V.score.pageMap = shown ? cur.filter((x) => x !== o) : [...cur, o].sort((a, b) => a - b);
      if (shown) {
        const fix = (pg) => (pg - 1 > delIndex ? pg - 1 : pg);
        V.score.bookmarks = (V.score.bookmarks || []).map((b) => ({ ...b, page: fix(b.page) }));
        V.score.jumps = (V.score.jumps || []).map((j) => ({ ...j, from: fix(j.from), to: fix(j.to) }));
      }
      if (V.score.pageMap.length === V.base.pages) V.score.pageMap = null;
      await reopenDoc();
      V.page = clamp(V.page, 0, V.doc.pages - 1);
      layout(); renderPagesPanel();
    });
    card.append(lab, btn);
    grid.append(card);
    items.push([o, cv]);
  }
  for (const [o, cv] of items) {
    if (renderPagesPanel.token !== token) return;
    const [pw, ph] = V.base.sizes[o];
    await V.base.render(o, cv, 180, Math.round((180 * ph) / pw)).catch(() => {});
  }
}
$('#pagesBtn').addEventListener('click', () => showPanel('pages'));

// ---------- export ----------
$('#exportPdfBtn').addEventListener('click', () => showPanel('exportpdf'));
async function doExport(withInk) {
  hidePanel();
  toast('Making the PDF…', 60000);
  try {
    const blob = await exportPdf({ score: V.score, file: V.file, doc: V.doc, withInk, onProgress: (f) => { $('#toast').textContent = `Making the PDF… ${Math.round(f * 100)}%`; } });
    setPaperColor(PAPER_COLOR[S.paper] || '#fff');
    const name = (V.score.title || 'Score').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) + (withInk ? '' : ' (clean)') + '.pdf';
    $('#toast').hidden = true;
    await shareBlob(blob, name);
  } catch (e) { console.error(e); toast('The PDF could not be made: ' + (e.message || e)); }
}
$('#expWith').addEventListener('click', () => doExport(true));
$('#expClean').addEventListener('click', () => doExport(false));

// ---------- trim margins ----------
async function setTrim(on) {
  V.score.trim = on;
  if (on && !V.score.trimBox) {
    toast('Measuring the margins…', 20000);
    let box = null;
    for (let i = 0; i < V.base.pages; i++) {
      const [pw, ph] = V.base.sizes[i];
      const c = document.createElement('canvas');
      await V.base.render(i, c, 300, Math.round((300 * ph) / pw));
      box = unionBox(box, contentBox(c)); c.width = c.height = 0;
    }
    V.score.trimBox = box; $('#toast').hidden = true;
  }
  V.crop = on ? V.score.trimBox : null;
  await db.put('scores', V.score);
  V.cache.clear(); V.splits.clear(); layout();
}
$('#trimMargins').addEventListener('change', (e) => setTrim(e.target.checked));

// ---------- score settings ----------
function fillScoreSettings() {
  if (!V.score) return;
  $('#metaTitle').value = V.score.title; $('#metaComposer').value = V.score.composer || '';
  $('#twoUp').checked = S.twoUp; $('#halfTurn').checked = S.halfTurn; $('#trimMargins').checked = !!V.score.trim;
  renderBookmarks(); renderJumps(); $('#paperTools').hidden = !(V.file && V.file.kind === 'paper');
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
  setPaperColor(PAPER_COLOR[S.paper] || '#fff'); for (const p of V.pages) p.layer.redraw();
  $$('#paperSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
setMaskReadyHandler(() => { for (const p of V.pages) p.layer.redraw(); });
$('#delScore').addEventListener('click', () => { $('#delScoreConfirm').hidden = false; });
$('#delScoreNo').addEventListener('click', () => { $('#delScoreConfirm').hidden = true; });
$('#delScoreYes').addEventListener('click', async () => {
  const s = V.score; if (!s) return;
  const takes = await db.byIndex('takes', 'score', s.id);
  for (const t of takes) await deleteTakeData(t.id);
  const inkKeys = (await db.keys('ink')).filter((k) => String(k).startsWith(s.id + ':'));
  for (const k of inkKeys) await db.del('ink', k);
  await db.del('files', s.fileId);
  hidePanel(); practice.scoreClosed();
  freePages(); V.score = null; if (V.base) V.base.destroy(); V.base = null; V.doc = null;
  await db.del('scores', s.id);
  thumbURLs.delete(s.id);
  $('#score').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home'); stage.textContent = '';
  refreshLibrary();
  toast('Score removed');
});

// ---------- practice tracking ----------
// log:  { day: seconds }                                   (totals, kept from earlier versions)
// log2: { day: { pieces: { scoreId: seconds }, tools: seconds, note: '' } }
const practice = {
  scoreId: null, lastTick: Date.now(), log: {}, log2: {},
  async load() { this.log = (await getSetting('log', {})) || {}; this.log2 = (await getSetting('log2', {})) || {}; },
  day(k = dayKey()) { return (this.log2[k] = this.log2[k] || { pieces: {}, tools: 0, note: '' }); },
  scoreOpened(id) { this.flush(); this.scoreId = id; this.lastTick = Date.now(); },
  scoreClosed() { this.flush(); this.scoreId = null; },
  toolsActive() {
    try { return metro.running || drone.running || scale.playing || tuner.running || !!recState || player.playing || !ref.paused; } catch { return false; }
  },
  flush() {
    const t = Date.now(), dt = Math.min(60, (t - this.lastTick) / 1000); this.lastTick = t;
    if (document.visibilityState !== 'visible' || dt <= 0) return;
    const tools = this.toolsActive();
    if (!this.scoreId && !tools) return;
    const k = dayKey(), d = this.day(k);
    this.log[k] = (this.log[k] || 0) + dt;
    if (this.scoreId) {
      d.pieces[this.scoreId] = (d.pieces[this.scoreId] || 0) + dt;
      if (V.score && V.score.id === this.scoreId) { V.score.seconds = (V.score.seconds || 0) + dt; db.put('scores', V.score); }
    } else d.tools += dt;
    setSetting('log', this.log); setSetting('log2', this.log2);
    if (openPanel === 'goal') renderTracker();
  },
};
setInterval(() => { practice.flush(); renderGoal(); }, 15000);
document.addEventListener('visibilitychange', () => { practice.lastTick = Date.now(); if (document.visibilityState === 'visible' && V.doc) keepAwake(); });

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
  try { scale.bpm = v; syncMetroLinks(); } catch {}
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
  else { beatTotal++; showBpm(ev.bpm); if (metro.ramp.on && openPanel === 'metronome') drawRamp(beatTotal); if (ev.beat === 0 && beatTotal > 0) walk.bar(); }
  if (S.flash && ev.beat === 0 && !ev.muted) { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
};
metro.onStop = () => { updateMetroButtons(); showBpm(metro.bpm); };
function startMetro(opts) { unlock(); beatTotal = -1; const t = metro.start(opts); updateMetroButtons(); return t; }
function stopMetro() { metro.stop(); }
function updateMetroButtons() {
  const on = metro.running;
  try { syncMetroLinks(); walk.reset(); } catch {}
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
  if (t === 'harm') { requestAnimationFrame(drawHarmonics); startHarmonicListening(); } else pauseHarmonicListening();
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
// The needle follows the reading with a light spring, so it glides instead of jumping.
const needle = { cur: 0, vel: 0, target: 0, raf: 0 };
function animateNeedle() {
  if (needle.raf) return;
  const step = () => {
    const k = 0.22, d = 0.62;
    needle.vel = needle.vel * d + (needle.target - needle.cur) * k;
    needle.cur += needle.vel;
    $('#needle').style.transform = `rotate(${needle.cur.toFixed(2)}deg)`;
    if (Math.abs(needle.target - needle.cur) > 0.05 || Math.abs(needle.vel) > 0.05) needle.raf = requestAnimationFrame(step);
    else needle.raf = 0;
  };
  needle.raf = requestAnimationFrame(step);
}
tuner.onReading = (r) => {
  lastReading = r;
  const face = $('#tunerFace');
  $$('#stringRow button').forEach((b) => { const near = r && !r.held && r.string === b.dataset.label; b.classList.toggle('near', near); b.classList.toggle('ok', near && Math.abs(r.cents) < 3); });
  if (H.follow) followHarmonics(r);
  if (!r) {
    face.classList.add('idle'); face.classList.remove('intune', 'held');
    $('#tCents').textContent = tuner.running ? 'Listening… play a note' : 'Tap Start, then play a note'; $('#tHz').innerHTML = '&nbsp;';
    needle.target = 0; animateNeedle();
    return;
  }
  face.classList.remove('idle');
  face.classList.toggle('held', !!r.held);
  const c = r.cents;
  $('#tNote').textContent = r.name; $('#tOct').textContent = r.octave;
  if (!r.held) {
    $('#tCents').textContent = Math.abs(c) < 3 ? '✓ In tune' : (c > 0 ? '+' : '−') + Math.abs(c).toFixed(0) + ' cents ' + (c > 0 ? 'sharp' : 'flat');
    let sub = r.freq.toFixed(1) + ' Hz';
    if (r.string) sub += ` · ${r.string} string${S.pureFifths && INSTRUMENTS[S.instrument].fifths ? ', pure fifths' : ''}`;
    else if (S.system !== 'equal' && Math.abs(r.offset) > 0.5) sub += ` · ${SYSTEMS[S.system].label} ${r.offset > 0 ? '+' : '−'}${Math.abs(r.offset).toFixed(0)}¢ in ${NOTE_NAMES[S.key]}`;
    $('#tHz').textContent = sub;
    needle.target = (clamp(c, -50, 50) / 50) * 55; animateNeedle();
    face.classList.toggle('intune', Math.abs(c) < 3);
  }
};
function drawTrace() {
  const c = $('#traceCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const good = css('--good'), accent = css('--accent-text'), muted = css('--muted');
  const span = 8000, t = performance.now();
  const Y = (cents) => H / 2 - (clamp(cents, -50, 50) / 50) * (H / 2 - 8);
  g.fillStyle = good; g.globalAlpha = 0.14; g.fillRect(0, Y(5), W, Y(-5) - Y(5)); g.globalAlpha = 1;
  g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = muted; g.font = '600 10px ui-rounded, -apple-system, sans-serif'; g.fillText('+50', 6, 12); g.fillText('−50', 6, H - 4);
  const pts = tuner.trace.filter((p) => t - p.t < span);
  g.lineWidth = 2.5; g.lineJoin = 'round'; g.lineCap = 'round';
  let prev = null;
  for (const p of pts) {
    const x = W - ((t - p.t) / span) * W, y = Y(p.cents);
    if (prev && p.t - prev.t < 250 && p.name === prev.name) {
      g.strokeStyle = Math.abs(p.cents) < 5 ? good : accent;
      g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x, y); g.stroke();
    }
    prev = { ...p, x, y };
  }
  if (!pts.length) { g.fillStyle = muted; g.font = '500 12px -apple-system, sans-serif'; g.textAlign = 'center'; g.fillText('Your intonation over the last 8 seconds appears here', W / 2, H / 2 - 8); g.textAlign = 'start'; }
}
setInterval(() => { if (tuner.running && openPanel === 'tuner' && currentTunerTab === 'tune') drawTrace(); }, 100);
async function startTuner() {
  try {
    await tuner.start();
    $('#micHint').textContent = 'Listening. Nothing leaves this device.';
    updateTunerButtons();
    return true;
  } catch (e) { $('#micHint').textContent = micErrorText(e); toast(micErrorText(e), 5000); return false; }
}
function stopTuner() { tuner.stop(); tuner.onReading(null); H.follow = false; H.ownsMic = false; updateTunerButtons(); }
function updateTunerButtons() {
  const b = $('#tunerToggle');
  b.innerHTML = tuner.running ? '<svg><use href="#i-stop"/></svg><span>Stop tuner</span>' : '<svg><use href="#i-mic"/></svg><span>Start tuner</span>';
  b.classList.toggle('primary', !tuner.running);
  const h = $('#hListen');
  h.innerHTML = H.follow ? '<svg><use href="#i-pause"/></svg><span>Pause listening</span>' : '<svg><use href="#i-mic"/></svg><span>Listen</span>';
  h.classList.toggle('primary', !H.follow);
}
$('#tunerToggle').addEventListener('click', () => (tuner.running ? stopTuner() : startTuner()));

// ---------- harmonics: which natural harmonic are you playing? ----------
const H = { midi: 36, f0: 0, follow: false, ownsMic: false, profile: null, lit: 0, count: 8, found: null, sounding: false };
function fillHarmonicSelects() {
  const sel = $('#hPc'); sel.textContent = '';
  NOTE_NAMES.forEach((n, i) => { const o = el('option', '', n); o.value = i; sel.append(o); });
}
function stringsForHarmonics() { return stringTargets(S.instrument, S.ref, S.pureFifths && INSTRUMENTS[S.instrument].fifths); }
function setHarmonicNote(midi) {
  H.midi = midi; H.f0 = etFreq(midi, S.ref); H.profile = null;
  $('#hPc').value = ((midi % 12) + 12) % 12; $('#hOctSel').value = Math.floor(midi / 12) - 1;
  $('#hNote').textContent = NOTE_NAMES[((midi % 12) + 12) % 12]; $('#hOct').textContent = Math.floor(midi / 12) - 1;
  $('#hSrc').textContent = H.f0.toFixed(1) + ' Hz · chosen note';
  showHarmonicMatch(H.f0, true);
  drawHarmonics();
}
$('#hPc').addEventListener('change', () => { pauseHarmonicListening(); setHarmonicNote(12 * (+$('#hOctSel').value + 1) + +$('#hPc').value); });
$('#hOctSel').addEventListener('change', () => { pauseHarmonicListening(); setHarmonicNote(12 * (+$('#hOctSel').value + 1) + +$('#hPc').value); });
$('#hCount').addEventListener('change', (e) => { H.count = +e.target.value; drawHarmonics(); });
function showHarmonicMatch(freq, chosen) {
  const box = $('#hMatch');
  const strings = stringsForHarmonics();
  if (!strings.length) { box.innerHTML = ''; box.append(el('p', 'hint', 'Natural harmonics on open strings are shown for string instruments. Choose yours in Settings.')); H.found = null; return; }
  const list = naturalHarmonics(freq, strings, 8);
  H.found = list[0] || null;
  box.textContent = '';
  const open = strings.find((x) => Math.abs(1200 * Math.log2(freq / x.freq)) < 30);
  if (!list.length && open) {
    box.append(el('div', 'h-title', `Open ${open.name} string`), el('p', 'hint', 'The fundamental of the string. Its natural harmonics are the overtones below: play them by touching the string lightly at the octave, fifth, fourth and major third.'));
    H.found = { string: open, n: 1, f: open.freq, touches: [] };
    return;
  }
  if (!list.length) {
    box.append(el('div', 'h-title', chosen ? 'Not a natural harmonic' : 'A stopped note'), el('p', 'hint', 'This pitch is not a natural harmonic on your open strings. The bars below show the overtones inside it.'));
    return;
  }
  const best = list[0];
  const ord = (n) => n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
  box.append(el('div', 'h-title', `${ord(best.n)} harmonic on the ${best.string.name} string`));
  const tl = best.touches.map((t) => `${midiName(t.midi)} (${t.name}${Math.abs(t.off) >= 15 ? `, ${t.off > 0 ? 'a little sharp of it' : 'a little flat of it'}` : ''})`);
  box.append(el('p', 'h-touch', 'Touch lightly at ' + tl.join(' or ')));
  if (!chosen) {
    const cc = Math.round(best.cents);
    const ok = Math.abs(cc) < 5;
    const p = el('p', 'h-cents' + (ok ? ' ok' : ''), ok ? '✓ Pure: matches the string’s harmonic' : `${cc > 0 ? '+' : '−'}${Math.abs(cc)} cents from the pure harmonic (check the open string tuning)`);
    box.append(p);
  }
  if (list.length > 1) box.append(el('p', 'hint', 'Also: ' + list.slice(1, 3).map((h) => `${ord(h.n)} harmonic on the ${h.string.name} string`).join(', ')));
}
let harmT = 0;
function followHarmonics(r) {
  if (!r || r.held) return;
  const t = performance.now(); if (t - harmT < 140) return; harmT = t;
  H.f0 = r.freq; H.midi = r.midi;
  H.profile = tuner.harmonics(H.count);
  $('#hNote').textContent = r.name; $('#hOct').textContent = r.octave;
  $('#hSrc').textContent = r.freq.toFixed(1) + ' Hz · you are playing';
  showHarmonicMatch(r.freq, false);
  if (openPanel === 'tuner' && currentTunerTab === 'harm') drawHarmonics();
}
async function startHarmonicListening() {
  if (H.follow) return;
  if (!tuner.running) { if (!(await startTuner())) return; H.ownsMic = true; }
  H.follow = true; updateTunerButtons();
  if (!lastReading) $('#hSrc').textContent = 'Listening… play and hold a note';
}
function pauseHarmonicListening() {
  if (!H.follow) return;
  H.follow = false;
  if (H.ownsMic) { tuner.stop(); tuner.onReading(null); H.ownsMic = false; }
  updateTunerButtons();
}
$('#hListen').addEventListener('click', () => (H.follow ? pauseHarmonicListening() : startHarmonicListening()));
let harmGeom = null;
function drawHarmonics() {
  const c = $('#harmCanvas'); if (!c || c.offsetParent === null) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth, Hh = c.clientHeight;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const accent = css('--accent'), accentT = css('--accent-text'), muted = css('--muted'), ink = css('--ink'), warn = css('--warn');
  const n = H.count, pad = 8, gap = 4, bw = (W - pad * 2 - gap * (n - 1)) / n;
  const top = H.profile ? 10 : 24, base = Hh - 50;
  harmGeom = { pad, gap, bw, n };
  for (let k = 1; k <= n; k++) {
    const x = pad + (k - 1) * (bw + gap);
    const level = H.profile ? (H.profile[k - 1] + 60) / 60 : Math.pow(1 / k, 0.7);
    const h = Math.max(3, level * (base - top));
    const lit = H.lit === k || H.lit === -1;
    g.fillStyle = lit ? accentT : accent; g.globalAlpha = lit ? 1 : H.profile ? 0.9 : 0.45;
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
  if (!H.profile) { g.fillStyle = muted; g.font = '500 11px -apple-system, sans-serif'; g.fillText('Overtones inside this note (typical strengths)', pad, 12); }
}
function setSounding(on) {
  H.sounding = on;
  $('#hStop').hidden = !on;
}
let litT, soundT;
function lightHarmonic(k, ms) { H.lit = k; drawHarmonics(); clearTimeout(litT); litT = setTimeout(() => { H.lit = 0; drawHarmonics(); }, ms); }
function soundFor(ms) { setSounding(true); clearTimeout(soundT); soundT = setTimeout(() => setSounding(false), ms); }
$('#harmCanvas').addEventListener('click', (e) => {
  if (!harmGeom) return;
  const r = e.currentTarget.getBoundingClientRect();
  const k = Math.floor((e.clientX - r.left - harmGeom.pad) / (harmGeom.bw + harmGeom.gap)) + 1;
  if (k < 1 || k > harmGeom.n) return;
  pauseHarmonicListening(); unlock();
  playHarmonics(H.f0, { mode: 'one', h: k });
  lightHarmonic(k, 2200); soundFor(2400);
});
// Hear the harmonic series of the string the harmonic belongs to (or of the note).
$('#hSeries').addEventListener('click', () => {
  pauseHarmonicListening(); unlock();
  const base = H.found ? H.found.string.freq : H.f0, upTo = H.found ? Math.max(H.found.n, 5) : H.count;
  const p = playHarmonics(base, { mode: 'series', count: upTo });
  if (!H.found) for (let k = 1; k <= H.count; k++) setTimeout(() => { H.lit = k; drawHarmonics(); }, (p.start - getCtx().currentTime + (k - 1) * p.step) * 1000);
  clearTimeout(litT); litT = setTimeout(() => { H.lit = 0; drawHarmonics(); }, p.total * 1000);
  soundFor(p.total * 1000);
});
$('#hChord').addEventListener('click', () => {
  pauseHarmonicListening(); unlock();
  const target = H.found ? H.found.f : H.f0;
  const p = H.found ? playHarmonics(target, { mode: 'one', h: 1 }) : playHarmonics(H.f0, { mode: 'chord', count: H.count });
  if (!H.found) lightHarmonic(-1, p.total * 1000);
  soundFor(p.total * 1000);
});
$('#hStop').addEventListener('click', () => { stopHarmonics(); setSounding(false); H.lit = 0; drawHarmonics(); });

// ---------- drone ----------
(function buildDroneUI() {
  const box = $('#droneNotes');
  NOTE_NAMES.forEach((n, i) => {
    const b = el('button', '', n); b.dataset.pc = i;
    b.addEventListener('click', () => { drone.pc = i; syncDrone(); drone.refresh(); persistDrone(); });
    box.append(b);
  });
  const sel = $('#droneSound'); sel.textContent = '';
  for (const [k, v] of Object.entries(DRONE_VOICES)) { const o = el('option', '', v); o.value = k; sel.append(o); }
  const ch = $('#droneChord'); ch.textContent = '';
  for (const [k, v] of Object.entries(DRONE_CHORDS)) { const o = el('option', '', v.label); o.value = k; ch.append(o); }
})();
function syncDrone() {
  $$('#droneNotes button').forEach((b) => b.classList.toggle('on', +b.dataset.pc === drone.pc));
  $('#droneOct').value = drone.octave; $('#droneSound').value = drone.sound; $('#droneChord').value = drone.chord;
  $('#droneOctave').checked = drone.lowOct; $('#droneVol').value = drone.volume;
  $('#droneSpeedRow').hidden = drone.sound !== 'tanpura'; $('#droneChordRow').hidden = drone.sound === 'tanpura';
  $$('#droneSpeed button').forEach((b) => b.classList.toggle('on', b.dataset.speed === drone.speed));
  $('#droneWalk').value = S.droneWalk || 'stay'; $('#droneWalkBars').value = S.droneWalkBars || 8; $('#droneWalkBarsRow').hidden = (S.droneWalk || 'stay') === 'stay';
  $('#dronePillNote').textContent = drone.label();
  const b = $('#droneToggle');
  b.innerHTML = drone.running ? '<svg><use href="#i-stop"/></svg><span>Stop drone</span>' : '<svg><use href="#i-play"/></svg><span>Start drone</span>';
  b.classList.toggle('primary', !drone.running);
  $('#dronePill').hidden = !drone.running;
}
function persistDrone() { S.drone = { pc: drone.pc, octave: drone.octave, sound: drone.sound, chord: drone.chord, lowOct: drone.lowOct, volume: drone.volume, speed: drone.speed }; saveSettings(); }
$('#droneOct').addEventListener('change', (e) => { drone.octave = +e.target.value; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneSound').addEventListener('change', (e) => { const was = drone.running; if (was) drone.stop(); drone.sound = e.target.value; if (was) drone.start(); syncDrone(); persistDrone(); });
$('#droneChord').addEventListener('change', (e) => { drone.chord = e.target.value; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneOctave').addEventListener('change', (e) => { drone.lowOct = e.target.checked; drone.refresh(); syncDrone(); persistDrone(); });
$('#droneVol').addEventListener('input', (e) => { drone.setVolume(+e.target.value); persistDrone(); });
$$('#droneSpeed button').forEach((b) => b.addEventListener('click', () => { drone.speed = b.dataset.speed; drone.refresh(); syncDrone(); persistDrone(); }));
$('#droneWalk').addEventListener('change', (e) => { S.droneWalk = e.target.value; saveSettings(); syncDrone(); walk.reset(); });
$('#droneWalkBars').addEventListener('change', (e) => { S.droneWalkBars = +e.target.value; saveSettings(); walk.reset(); });
function startDrone() { unlock(); drone.start(); walk.reset(); syncDrone(); }
function stopDrone() { drone.stop(); walk.stop(); syncDrone(); }
$('#droneToggle').addEventListener('click', () => (drone.running ? stopDrone() : startDrone()));
$('#dronePillStop').addEventListener('click', stopDrone);
// The drone can walk through keys: around the circle of fifths or up by semitones,
// every few bars of the metronome tempo (in time with the click when it is running).
const walk = {
  bars: 0, timer: 0,
  reset() { this.bars = 0; clearInterval(this.timer); this.timer = 0; if (drone.running && (S.droneWalk || 'stay') !== 'stay' && !metro.running) this.timer = setInterval(() => this.bar(), (metro.beats * 60000) / metro.bpm); },
  stop() { clearInterval(this.timer); this.timer = 0; },
  bar() {
    if (!drone.running || (S.droneWalk || 'stay') === 'stay') return;
    this.bars++;
    if (this.bars % (S.droneWalkBars || 8)) return;
    drone.pc = (drone.pc + (S.droneWalk === 'fifths' ? 7 : 1)) % 12;
    drone.refresh(); syncDrone(); persistDrone();
  },
};

// ---------- metronome shortcuts inside the drone and scale tools ----------
function syncMetroLinks() {
  $$('.ml-bpm').forEach((x) => (x.textContent = Math.round(metro.bpm)));
  $$('.ml-on').forEach((x) => (x.checked = x.dataset.for === 'scale' ? !!scale.click : metro.running));
}
$$('.ml-down').forEach((b) => holdRepeat(b, () => { setBpm(metro.bpm - 1); syncMetroLinks(); }));
$$('.ml-up').forEach((b) => holdRepeat(b, () => { setBpm(metro.bpm + 1); syncMetroLinks(); }));
$$('.ml-on').forEach((x) => x.addEventListener('change', (e) => {
  if (x.dataset.for === 'scale') { scale.click = e.target.checked; persistScale(); if (scale.playing) restartScale(); return; }
  if (e.target.checked) startMetro(); else stopMetro();
  syncMetroLinks();
}));

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
  $('#scalePer').value = scale.perBeat; $('#scaleSound').value = scale.sound; $('#scaleVol').value = scale.volume;
  $('#scaleDrone').checked = scale.drone; $('#scaleRepeat').checked = scale.repeat;
  $('#scaleTitle').textContent = scale.title();
  $('#scalePillNote').textContent = scale.title();
  syncMetroLinks();
  renderScaleStrip();
}
function persistScale() {
  S.scale = { tonic: scale.tonic, octave: scale.octave, octaves: scale.octaves, type: scale.type, direction: scale.direction, system: scale.system, perBeat: scale.perBeat, sound: scale.sound, volume: scale.volume, drone: scale.drone, click: scale.click, repeat: scale.repeat };
  saveSettings();
}
function scaleChanged(restart = true) {
  syncScaleUI(); persistScale();
  if (restart && scale.playing) restartScale();
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
$('#scalePer').addEventListener('change', (e) => { scale.perBeat = +e.target.value; persistScale(); if (scale.playing) restartScale(); });
$('#scaleSound').addEventListener('change', (e) => { scale.sound = e.target.value; scaleChanged(); });
$('#scaleVol').addEventListener('input', (e) => { scale.setVolume(+e.target.value); persistScale(); });
$('#scaleDrone').addEventListener('change', (e) => { scale.drone = e.target.checked; scaleChanged(); });
$('#scaleRepeat').addEventListener('change', (e) => { scale.repeat = e.target.checked; persistScale(); });
scale.onNote = (ev) => {
  const name = midiName(ev.midi);
  $('#scaleNote').textContent = name;
  const c = Math.round(scale.cents(ev.midi));
  $('#scaleCents').textContent = scale.system === 'equal' ? '' : (c === 0 ? '±0¢' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢');
  $('#scalePillNote').textContent = name;
  $$('#scaleStrip span').forEach((s) => s.classList.toggle('on', +s.dataset.midi === ev.midi));
};
let scaleOwnsMetro = false;
scale.onEnd = () => { if (scaleOwnsMetro && metro.running) stopMetro(); scaleOwnsMetro = false; updateScaleButtons(); };
function updateScaleButtons() {
  const b = $('#scaleToggle');
  b.innerHTML = scale.playing ? '<svg><use href="#i-stop"/></svg><span>Stop</span>' : '<svg><use href="#i-play"/></svg><span>Play scale</span>';
  b.classList.toggle('primary', !scale.playing);
  $('#scalePill').hidden = !scale.playing;
  if (!scale.playing) { $$('#scaleStrip span').forEach((s) => s.classList.remove('on')); $('#scaleNote').textContent = '–'; $('#scaleCents').textContent = ''; $('#scalePillNote').textContent = scale.title(); }
  syncMetroLinks();
}
// The scale always plays at the metronome tempo; with "Click" on, both start together, in time.
function startScale() {
  unlock();
  scale.ref = S.ref; scale.bpm = metro.bpm;
  let at = 0;
  if (scale.click) {
    if (metro.running) stopMetro();
    at = startMetro({ accentFirstOnly: false }); scaleOwnsMetro = true;
  }
  scale.start(at);
  updateScaleButtons();
}
function stopScale() { scale.stop(); if (scaleOwnsMetro && metro.running) stopMetro(); scaleOwnsMetro = false; updateScaleButtons(); }
function restartScale() { scale.stop(true); if (scaleOwnsMetro && metro.running) stopMetro(true); scaleOwnsMetro = false; startScale(); }
$('#scaleToggle').addEventListener('click', () => (scale.playing ? stopScale() : startScale()));
$('#scalePillStop').addEventListener('click', stopScale);

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
    try { await vrec.open(S.cam); } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Camera access is off. Turn it on in Settings › Stand › Camera (or Settings › Safari › Camera).' : 'The camera could not start (' + ((e && (e.name || e.message)) || 'unknown') + '). Close other apps using the camera and try again.', 6000); return; }
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
    if (!window.MediaRecorder) { toast('Video recording needs iPadOS 15 or newer.', 6000); vrec.close(); $('#cam').hidden = true; if (recState.metroByUs) stopMetro(); recState = null; return; }
    recState.startTimer = setTimeout(() => {
      if (!recState) return;
      try { vrec.start(); } catch (e) { console.error(e); toast('Video could not start: ' + (e.message || e.name), 6000); stopRecording(); }
    }, wait);
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
// Manuscript paper
// =====================================================================
let paperTpl = 'treble';
async function buildPaperGrid() {
  const grid = $('#paperGrid'); if (grid.childElementCount) return;
  await loadMusicFont();
  for (const [k, v] of Object.entries(PAPERS)) {
    const b = el('button'); b.dataset.k = k;
    const cv = el('canvas'); cv.width = 400; cv.height = 202;
    const doc = await openDocument({ kind: 'paper', template: k, pages: 1 });
    const full = document.createElement('canvas'); await doc.render(0, full, 400, 566);
    cv.getContext('2d').drawImage(full, 0, 70, 400, 202, 0, 0, 400, 202);
    b.append(cv, document.createTextNode(v.label));
    b.addEventListener('click', () => { paperTpl = k; $$('#paperGrid button').forEach((x) => x.classList.toggle('on', x === b)); });
    grid.append(b);
  }
  $$('#paperGrid button').forEach((x) => x.classList.toggle('on', x.dataset.k === paperTpl));
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="newpaper"]')) buildPaperGrid(); });
$('#paperCreate').addEventListener('click', async () => {
  const file = { id: uid(), kind: 'paper', template: paperTpl, pages: +$('#paperPages').value };
  const doc = await openDocument(file);
  const thumb = await makeThumb(doc);
  const name = $('#paperName').value.trim() || PAPERS[paperTpl].label + ' notebook';
  const score = { id: uid(), fileId: file.id, title: name, composer: 'Manuscript', pages: file.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb, kind: 'paper' };
  await db.put('files', file); await db.put('scores', score);
  $('#paperName').value = '';
  hidePanel(); await refreshLibrary(); openScore(score.id);
});

// =====================================================================
// Listen: performances on YouTube, Spotify and Apple Music, saved links, play-along
// =====================================================================
const PERFORMERS = {
  cello: ['Jacqueline du Pré', 'Mstislav Rostropovich', 'Yo-Yo Ma', 'Pablo Casals', 'Pierre Fournier', 'Steven Isserlis', 'Sol Gabetta', 'Mischa Maisky', 'Truls Mørk', 'Gautier Capuçon'],
  violin: ['Jascha Heifetz', 'David Oistrakh', 'Itzhak Perlman', 'Hilary Hahn', 'Anne-Sophie Mutter', 'Janine Jansen', 'Isabelle Faust', 'Joshua Bell'],
  viola: ['Tabea Zimmermann', 'Yuri Bashmet', 'Antoine Tamestit', 'Kim Kashkashian', 'William Primrose'],
  bass: ['Gary Karr', 'Edgar Meyer', 'Božo Paradžik', 'Catalin Rotaru'],
  flute: ['Emmanuel Pahud', 'Jean-Pierre Rampal', 'James Galway', 'Sharon Bezaly'],
  clarinet: ['Sabine Meyer', 'Martin Fröst', 'Andreas Ottensamer', 'Jack Brymer'],
  oboe: ['Albrecht Mayer', 'Heinz Holliger', 'François Leleux'],
  piano: ['Martha Argerich', 'András Schiff', 'Krystian Zimerman', 'Maurizio Pollini', 'Glenn Gould', 'Daniil Trifonov'],
  guitar: ['Andrés Segovia', 'Julian Bream', 'John Williams', 'Ana Vidović'],
  voice: ['Cecilia Bartoli', 'Dietrich Fischer-Dieskau', 'Jessye Norman', 'Jonas Kaufmann'],
  other: [],
};
const LS = { who: '' };
function listenQuery() { const q = $('#lsQuery').value.trim(); const who = $('#lsCustom').value.trim() || LS.who; return (q + (who ? ' ' + who : '')).trim(); }
function serviceLinks(q) {
  const e = encodeURIComponent(q);
  return [
    ['yt', 'YouTube', `https://www.youtube.com/results?search_query=${e}`],
    ['sp', 'Spotify', `https://open.spotify.com/search/${e}`],
    ['am', 'Apple Music', `https://music.apple.com/search?term=${e}`],
  ];
}
function renderServices(box, q, small) {
  box.textContent = '';
  for (const [cls, name, url] of serviceLinks(q)) {
    const a = el('a', 'service ' + cls); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.append(document.createTextNode(name)); if (!small) a.append(el('small', '', 'Search'));
    box.append(a);
  }
}
function renderListen() {
  const box = $('#lsWho'); box.textContent = '';
  const list = ['Any', ...(PERFORMERS[S.instrument] || [])];
  for (const n of list) {
    const b = el('button', n === (LS.who || 'Any') ? 'on' : '', n);
    b.addEventListener('click', () => { LS.who = n === 'Any' ? '' : n; $('#lsCustom').value = ''; renderListen(); });
    box.append(b);
  }
  renderServices($('#lsServices'), listenQuery());
  const ul = $('#lsSaved'); ul.textContent = '';
  for (const [i, r] of ((V.score && V.score.listen) || []).entries()) {
    const li = el('li'); const a = el('a', 'go', r.name); a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
    const kind = /spotify/.test(r.url) ? 'Spotify' : /youtu/.test(r.url) ? 'YouTube' : /apple/.test(r.url) ? 'Apple Music' : 'Link';
    const del = el('button', 'icon-btn small'); del.append(icon('i-close')); del.setAttribute('aria-label', 'Remove');
    del.addEventListener('click', () => { V.score.listen.splice(i, 1); db.put('scores', V.score); renderListen(); });
    li.append(a, el('span', 'num', kind), del); ul.append(li);
  }
  $('#lsSaved').closest('.sub-card').hidden = !V.score;
  $('#refInput').closest('.sub-card').hidden = !V.score;
  syncRef();
}
function openListen() {
  const q = V.score ? `${(V.score.composer || '').split(' ').pop()} ${V.score.title.replace(/[·,].*$/, '')}`.trim() : '';
  if (!$('#lsQuery').dataset.for || $('#lsQuery').dataset.for !== (V.score && V.score.id)) { $('#lsQuery').value = q; $('#lsQuery').dataset.for = V.score ? V.score.id : ''; }
  renderListen();
}
$('#lsQuery').addEventListener('input', () => renderServices($('#lsServices'), listenQuery()));
$('#lsCustom').addEventListener('input', () => { if ($('#lsCustom').value.trim()) LS.who = ''; renderListen(); $('#lsCustom').focus(); });
$('#lsSave').addEventListener('click', () => {
  const url = $('#lsUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Paste a full link that starts with https://'); return; }
  const name = $('#lsName').value.trim() || (/spotify/.test(url) ? 'Spotify recording' : /youtu/.test(url) ? 'YouTube video' : 'Recording');
  V.score.listen = [...(V.score.listen || []), { name, url }];
  db.put('scores', V.score); $('#lsUrl').value = ''; $('#lsName').value = ''; renderListen();
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="listen"]')) openListen(); });

// --- play-along recording attached to a score ---
const ref = $('#refAudio');
const RF = { url: null, scoreId: null, a: null, b: null };
try { ref.preservesPitch = true; ref.webkitPreservesPitch = true; ref.mozPreservesPitch = true; } catch {}
async function loadRef(score) {
  if (RF.scoreId === (score && score.id)) return;
  ref.pause(); if (RF.url) URL.revokeObjectURL(RF.url); RF.url = null; RF.a = RF.b = null; RF.scoreId = score ? score.id : null;
  if (!score || !score.ref) { ref.removeAttribute('src'); syncRef(); return; }
  const f = await db.get('files', 'ref:' + score.id);
  if (!f) { syncRef(); return; }
  RF.url = URL.createObjectURL(f.data); ref.src = RF.url; ref.load();
  syncRef();
}
function syncRef() {
  const has = !!(V.score && V.score.ref && RF.url);
  $('#refNone').hidden = has; $('#refBox').hidden = !has;
  if (has) $('#refName').textContent = V.score.ref.name;
  const playing = !ref.paused;
  $('#refPlay').innerHTML = playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>';
  $('#refPillPlay').innerHTML = playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>';
  $('#refPill').hidden = !RF.url || (ref.paused && ref.currentTime < 0.05);
  $('#refPillTxt').textContent = (V.score && V.score.ref ? V.score.ref.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 22) : 'Recording') + ' · ' + Math.round(ref.playbackRate * 100) + '%';
  $('#refA').classList.toggle('on', RF.a != null); $('#refB').classList.toggle('on', RF.b != null);
  $('#refLoopTxt').textContent = RF.a != null && RF.b != null ? `Loop ${fmtTime(RF.a)}–${fmtTime(RF.b)}${RF.b - RF.a < 3 ? ' (' + (RF.b - RF.a).toFixed(1) + ' s)' : ''}` : RF.a != null ? 'Now set B' : '';
  $$('#refSpeed button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.s - ref.playbackRate) < 0.001));
}
$('#refInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !V.score) return;
  await db.put('files', { id: 'ref:' + V.score.id, data: f });
  V.score.ref = { name: f.name }; await db.put('scores', V.score);
  RF.scoreId = null; await loadRef(V.score); toast('Recording added. Press play and read along.');
});
$('#refRemove').addEventListener('click', async () => {
  if (!V.score) return;
  ref.pause(); await db.del('files', 'ref:' + V.score.id); delete V.score.ref; await db.put('scores', V.score);
  RF.scoreId = null; await loadRef(V.score); syncRef();
});
const toggleRef = () => { unlock(); if (ref.paused) ref.play().catch(() => toast('The recording could not play.')); else ref.pause(); };
$('#refPlay').addEventListener('click', toggleRef);
$('#refPillPlay').addEventListener('click', toggleRef);
$$('#refSpeed button').forEach((b) => b.addEventListener('click', () => { ref.playbackRate = +b.dataset.s; syncRef(); }));
$('#refVol').addEventListener('input', (e) => { ref.volume = +e.target.value; });
$('#refA').addEventListener('click', () => { if (RF.a != null && RF.b != null) { RF.a = RF.b = null; } else RF.a = ref.currentTime; syncRef(); });
$('#refB').addEventListener('click', () => { if (RF.a == null) return; if (ref.currentTime > RF.a + 0.3) { RF.b = ref.currentTime; ref.currentTime = RF.a; } syncRef(); });
$('#refSeek').addEventListener('input', (e) => { if (ref.duration) ref.currentTime = (+e.target.value / 1000) * ref.duration; });
ref.addEventListener('timeupdate', () => {
  if (RF.a != null && RF.b != null && ref.currentTime >= RF.b) ref.currentTime = RF.a;
  if (ref.duration) { $('#refSeek').value = Math.round((ref.currentTime / ref.duration) * 1000); $('#refPos').textContent = fmtTime(ref.currentTime); $('#refDur').textContent = fmtTime(ref.duration); }
});
['play', 'pause', 'ended', 'loadedmetadata', 'ratechange'].forEach((n) => ref.addEventListener(n, syncRef));

// =====================================================================
// Practice tracker
// =====================================================================
function streakOf(log) {
  let n = 0; const d = new Date();
  if ((log[dayKey(d)] || 0) < 300) d.setDate(d.getDate() - 1); // today not done yet does not break it
  while ((log[dayKey(d)] || 0) >= 300) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderGoal() {
  const log = practice.log;
  const goal = (S.goal || 30) * 60, today = log[dayKey()] || 0;
  const f = Math.min(1, today / goal);
  $('#goalArc').style.strokeDashoffset = (125.66 * (1 - f)).toFixed(1);
  $('#goalPct').textContent = Math.round(today / 60);
  $('#goalBtn').classList.toggle('done', f >= 1);
  $('#goalBtn').setAttribute('aria-label', `Practised ${Math.round(today / 60)} of ${S.goal || 30} minutes today`);
}
const TR = { range: 'week', day: dayKey() };
function rangeDays(n) { const out = []; const d = new Date(); d.setDate(d.getDate() - (n - 1)); for (let i = 0; i < n; i++) { out.push(new Date(d)); d.setDate(d.getDate() + 1); } return out; }
function titleOf(id) { const s = scores.find((x) => x.id === id); return s ? s.title : 'Removed score'; }
let trBars = [];
function renderTracker() {
  const log = practice.log, goal = S.goal || 30;
  const today = Math.round((log[dayKey()] || 0) / 60);
  let week = 0; for (const d of rangeDays(7)) week += log[dayKey(d)] || 0;
  const total = Object.values(log).reduce((a, b) => a + b, 0);
  const stats = $('#goalStats'); stats.textContent = '';
  for (const [v, l] of [[today + ' / ' + goal, 'min today'], [streakOf(log), 'day streak'], [fmtShort(week), 'this week'], [fmtShort(total), 'all time']]) {
    const x = el('div', 'stat'); x.append(el('b', '', String(v)), el('span', '', l)); stats.append(x);
  }
  $$('#trRange button').forEach((b) => b.classList.toggle('on', b.dataset.range === TR.range));
  $('#goalSel').value = goal;
  // bars
  let bars = [];
  if (TR.range === 'year') {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear(), m = d.getMonth(); let sum = 0;
      for (const [k, v] of Object.entries(log)) { const [ky, km] = k.split('-').map(Number); if (ky === y && km === m + 1) sum += v; }
      bars.push({ m: sum / 60, label: d.toLocaleDateString(undefined, { month: 'narrow' }), month: `${y}-${String(m + 1).padStart(2, '0')}` });
      d.setMonth(d.getMonth() + 1);
    }
  } else {
    bars = rangeDays(TR.range === 'week' ? 7 : 30).map((d) => ({ m: (log[dayKey(d)] || 0) / 60, label: TR.range === 'week' ? d.toLocaleDateString(undefined, { weekday: 'short' }) : String(d.getDate()), key: dayKey(d) }));
  }
  const c = $('#trChart'); const dpr = devicePixelRatio || 1, W = c.clientWidth || 400, H = c.clientHeight || 150;
  c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
  const unitGoal = TR.range === 'year' ? null : goal;
  const max = Math.max(unitGoal ? unitGoal * 1.25 : 1, ...bars.map((x) => x.m), 1);
  const n = bars.length, bw = (W - 8) / n, base = H - 20;
  const Y = (m) => base - (m / max) * (base - 10);
  if (unitGoal) { g.strokeStyle = css('--good'); g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(unitGoal)); g.lineTo(W, Y(unitGoal)); g.stroke(); g.setLineDash([]); }
  trBars = [];
  bars.forEach((x, i) => {
    const h = Math.max(2, base - Y(x.m)), bx = 4 + i * bw + Math.min(3, bw * 0.15), w = bw - 2 * Math.min(3, bw * 0.15);
    const sel = x.key && x.key === TR.day;
    g.fillStyle = unitGoal && x.m >= unitGoal ? css('--good') : css('--accent-text');
    g.globalAlpha = sel ? 1 : 0.7;
    g.beginPath(); (g.roundRect ? g.roundRect(bx, base - h, w, h, Math.min(3, w / 2)) : g.rect(bx, base - h, w, h)); g.fill();
    g.globalAlpha = 1;
    if (n <= 12 || i % 5 === 0 || i === n - 1) { g.fillStyle = sel ? css('--ink') : css('--muted'); g.font = `${sel ? 700 : 600} 10px -apple-system, sans-serif`; g.textAlign = 'center'; g.fillText(x.label, 4 + i * bw + bw / 2, H - 5); }
    trBars.push({ x0: 4 + i * bw, x1: 4 + (i + 1) * bw, key: x.key });
  });
  // pieces in this period
  const keys = TR.range === 'year' ? rangeDays(366).map(dayKey) : bars.map((b) => b.key);
  const per = {}; let tools = 0;
  for (const k of keys) { const d = practice.log2[k]; if (!d) continue; for (const [id, v] of Object.entries(d.pieces)) per[id] = (per[id] || 0) + v; tools += d.tools || 0; }
  const rows = Object.entries(per).map(([id, v]) => [titleOf(id), v]);
  if (tools > 30) rows.push(['Tuner, scales and other tools', tools]);
  rows.sort((a, b) => b[1] - a[1]);
  const ul = $('#trPieces'); ul.textContent = '';
  const top = rows.length ? rows[0][1] : 1;
  for (const [t, v] of rows.slice(0, 12)) {
    const li = el('li'); const bar = el('span', 'tr-bar'); bar.style.setProperty('--w', Math.max(4, (v / top) * 100) + '%');
    li.append(el('span', 'tr-name', t), bar, el('span', 'num tr-time', fmtMinutes(v)));
    ul.append(li);
  }
  $('#trPiecesEmpty').hidden = rows.length > 0;
  // selected day
  const dk = TR.day, dd = practice.log2[dk];
  const date = new Date(dk + 'T12:00');
  $('#trDayTitle').textContent = dk === dayKey() ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#trDayMin').textContent = fmtMinutes(log[dk] || 0);
  const dl = $('#trDayList'); dl.textContent = '';
  if (dd) for (const [id, v] of Object.entries(dd.pieces).sort((a, b) => b[1] - a[1])) dl.append(el('li', '', `${titleOf(id)} · ${fmtMinutes(v)}`));
  if (dd && dd.tools > 30) dl.append(el('li', '', `Tools · ${fmtMinutes(dd.tools)}`));
  const note = $('#trNote'); if (document.activeElement !== note) note.value = (dd && dd.note) || '';
  note.placeholder = dk === dayKey() ? 'What did you work on today? What is next?' : 'Notes for this day';
  // heat map: last 18 weeks
  const hm = $('#trHeat'); hm.textContent = '';
  const start = new Date(); start.setDate(start.getDate() - (7 * 18 - 1) - ((start.getDay() + 6) % 7 - 6));
  for (let i = 0; i < 7 * 18; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const m = (log[dayKey(d)] || 0) / 60;
    const cell = el('span'); const lvl = m <= 0 ? 0 : m < goal * 0.34 ? 1 : m < goal * 0.67 ? 2 : m < goal ? 3 : 4;
    cell.className = 'h' + lvl; cell.title = `${d.toLocaleDateString()} · ${Math.round(m)} min`;
    if (d > new Date()) cell.className = 'h-future';
    hm.append(cell);
  }
}
$('#trChart').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left;
  const b = trBars.find((q) => x >= q.x0 && x < q.x1);
  if (b && b.key) { TR.day = b.key; renderTracker(); }
});
$$('#trRange button').forEach((b) => b.addEventListener('click', () => { TR.range = b.dataset.range; renderTracker(); }));
$('#trNote').addEventListener('input', (e) => { practice.day(TR.day).note = e.target.value; clearTimeout(practice.noteT); practice.noteT = setTimeout(() => setSetting('log2', practice.log2), 500); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="goal"]')) { TR.day = dayKey(); requestAnimationFrame(renderTracker); } });
$('#goalSel').addEventListener('change', (e) => { S.goal = +e.target.value; saveSettings(); renderGoal(); renderTracker(); });

// =====================================================================
// App settings: appearance, page turning by winking, backup
// =====================================================================
const NATIVE = window.webkit && window.webkit.messageHandlers ? window.webkit.messageHandlers : null;
const CAPS = window.standCaps || {};
function applyAppearance() {
  const root = document.documentElement;
  if (S.theme === 'light' || S.theme === 'dark') root.dataset.theme = S.theme; else delete root.dataset.theme;
  if (S.accent === 'black') root.dataset.accent = 'black'; else delete root.dataset.accent;
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === (S.theme || 'auto')));
  $$('#accentSeg button').forEach((b) => b.classList.toggle('on', b.dataset.accent === (S.accent || 'blue')));
  drawRamp(); drawTrace(); drawHarmonics();
}
$$('#themeSeg button').forEach((b) => b.addEventListener('click', () => { S.theme = b.dataset.theme; saveSettings(); applyAppearance(); }));
$$('#accentSeg button').forEach((b) => b.addEventListener('click', () => { S.accent = b.dataset.accent; saveSettings(); applyAppearance(); }));
$('#appInst').addEventListener('change', (e) => setInstrument(e.target.value));

// --- wink to turn pages (iPad app, face tracking) ---
const wink = { on: false, testing: false };
function winkSupported() { return !!(NATIVE && NATIVE.standFace && CAPS.face); }
function sendFace() {
  if (!winkSupported()) return;
  const active = (S.wink && !$('#score').hidden && !(recState && recState.kind === 'video')) || wink.testing;
  NATIVE.standFace.postMessage({ on: !!active, sensitivity: S.winkSens || 0.55, test: wink.testing });
  wink.on = !!active;
  $('#winkBadge').hidden = !(S.wink && !$('#score').hidden && active);
}
function syncWinkUI() {
  const ok = winkSupported();
  $('#winkRow').hidden = !ok; $('#winkNo').hidden = ok;
  $('#winkOn').checked = !!S.wink; $('#winkSens').value = Math.round((S.winkSens || 0.55) * 100);
  $('#winkSwap').checked = !!S.winkSwap; $('#winkBody').hidden = !S.wink;
}
$('#winkOn').addEventListener('change', (e) => { S.wink = e.target.checked; saveSettings(); syncWinkUI(); sendFace(); });
$('#winkSens').addEventListener('input', (e) => { S.winkSens = +e.target.value / 100; saveSettings(); sendFace(); });
$('#winkSwap').addEventListener('change', (e) => { S.winkSwap = e.target.checked; saveSettings(); });
$('#winkTest').addEventListener('click', () => { wink.testing = !wink.testing; $('#winkTest').textContent = wink.testing ? 'Stop test' : 'Test'; $('#winkMeter').hidden = !wink.testing; sendFace(); });
window.standFaceEvent = (ev) => {
  if (!ev) return;
  if (ev.type === 'levels') {
    const [l, r] = S.winkSwap ? [ev.r, ev.l] : [ev.l, ev.r];
    $('#eyeL').style.setProperty('--v', l); $('#eyeR').style.setProperty('--v', r);
    return;
  }
  if (ev.type === 'wink') {
    let eye = ev.eye; if (S.winkSwap) eye = eye === 'left' ? 'right' : 'left';
    if (wink.testing) { const t = $('#winkLast'); t.textContent = eye === 'right' ? 'Right wink → next page' : 'Left wink → previous page'; }
    if (!$('#score').hidden && S.wink && !openPanel) {
      turn(eye === 'right' ? 1 : -1);
      const f = $('#winkFlash'); f.className = 'wink-flash ' + eye; void f.offsetWidth; f.classList.add('on');
    }
  }
  if (ev.type === 'unsupported') { CAPS.face = false; syncWinkUI(); }
};
new MutationObserver(() => sendFace()).observe($('#score'), { attributes: true, attributeFilter: ['hidden'] });

// --- backup ---
async function makeBackup(withTakes) {
  const parts = []; let size = 0;
  const pack = (v) => {
    if (v instanceof Blob) { parts.push(v); size += v.size; return { $bin: parts.length - 1, $t: 'blob', mime: v.type }; }
    if (v instanceof ArrayBuffer) { parts.push(new Blob([v])); size += v.byteLength; return { $bin: parts.length - 1, $t: 'ab' }; }
    if (v instanceof Float32Array) { parts.push(new Blob([v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)])); size += v.byteLength; return { $bin: parts.length - 1, $t: 'f32' }; }
    if (Array.isArray(v)) return v.map(pack);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = pack(x); return o; }
    return v;
  };
  const takes = withTakes ? await db.all('takes') : [];
  let files = await db.all('files');
  if (!withTakes) files = files.filter((f) => !String(f.id).startsWith('audio:') && !String(f.id).startsWith('video:'));
  const data = pack({ v: 1, made: Date.now(), scores: await db.all('scores'), files, ink: await db.all('ink'), takes, kv: await db.all('kv') });
  const json = new TextEncoder().encode(JSON.stringify(data));
  const head = new Uint8Array(12); head.set(new TextEncoder().encode('STANDBK1'));
  new DataView(head.buffer).setUint32(8, json.length, true);
  const lens = new Uint8Array(parts.length * 4); const dv = new DataView(lens.buffer);
  parts.forEach((p, i) => dv.setUint32(i * 4, p.size, true));
  const count = new Uint8Array(4); new DataView(count.buffer).setUint32(0, parts.length, true);
  void size;
  return new Blob([head, json, count, lens, ...parts], { type: 'application/octet-stream' });
}
async function restoreBackup(file) {
  const buf = await file.arrayBuffer();
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
  if (magic !== 'STANDBK1') throw new Error('This is not a Stand backup.');
  const dv = new DataView(buf);
  const jl = dv.getUint32(8, true);
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, jl)));
  let o = 12 + jl; const n = dv.getUint32(o, true); o += 4;
  const lens = []; for (let i = 0; i < n; i++) { lens.push(dv.getUint32(o, true)); o += 4; }
  const bins = []; for (const L of lens) { bins.push(buf.slice(o, o + L)); o += L; }
  const unpack = (v) => {
    if (v && typeof v === 'object' && '$bin' in v) { const b = bins[v.$bin]; return v.$t === 'blob' ? new Blob([b], { type: v.mime || '' }) : v.$t === 'f32' ? new Float32Array(b) : b; }
    if (Array.isArray(v)) return v.map(unpack);
    if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = unpack(x); return r; }
    return v;
  };
  const d = unpack(data);
  for (const f of d.files) await db.put('files', f);
  for (const s of d.scores) await db.put('scores', s);
  for (const i of d.ink) await db.put('ink', i);
  for (const t of d.takes) await db.put('takes', t);
  for (const k of d.kv) if (k.k !== 'settings') await db.put('kv', k);
  await practice.load();
  return d.scores.length;
}
$('#backupMake').addEventListener('click', async () => {
  toast('Packing your library…', 60000);
  try {
    const blob = await makeBackup($('#backupTakes').checked);
    $('#toast').hidden = true;
    await shareBlob(blob, `Stand backup ${dayKey()}.standbackup`);
  } catch (e) { console.error(e); toast('The backup failed: ' + (e.message || e)); }
});
$('#backupInput').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  toast('Restoring…', 60000);
  try { const n = await restoreBackup(f); await refreshLibrary(); renderGoal(); toast(`Restored ${n} score${n === 1 ? '' : 's'}.`); }
  catch (err) { console.error(err); toast(err.message || 'That file could not be restored.'); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="app"]')) { syncWinkUI(); $('#appInst').value = S.instrument; applyAppearance(); } });

// =====================================================================
// Repetitions
// =====================================================================
const R = { goal: 5, now: 0, tries: 0, sets: 0 };
function renderReps(celebrate) {
  const dots = $('#repsDots'); dots.textContent = '';
  for (let i = 0; i < R.goal; i++) { const d = el('span'); if (i < R.now) d.className = 'on'; dots.append(d); }
  dots.classList.toggle('done', !!celebrate);
  $('#repsNow').textContent = R.now; $('#repsGoalVal').textContent = R.goal;
  $('#repsStats').textContent = R.tries ? `${R.tries} tries · ${R.sets} time${R.sets === 1 ? '' : 's'} reached the goal` : '';
}
$('#repsOk').addEventListener('click', () => {
  R.tries++; R.now++;
  if (R.now >= R.goal) { R.sets++; renderReps(true); toast(`${R.goal} clean in a row. Well played!`); R.now = 0; setTimeout(() => renderReps(), 900); return; }
  renderReps();
});
$('#repsMiss').addEventListener('click', () => { R.tries++; R.now = 0; renderReps(); });
$('#repsReset').addEventListener('click', () => { R.now = 0; R.tries = 0; R.sets = 0; renderReps(); });
$('#repsGoal').addEventListener('change', (e) => { R.goal = +e.target.value; R.now = Math.min(R.now, R.goal - 1); renderReps(); });
renderReps();

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  await loadSettings();
  await practice.load();
  applyAppearance();
  document.body.classList.add('at-home');
  player.room = S.room; player.wet = S.wet; player.autoLevel = S.autoLevel;
  applyMetroSettings(S.metro || { bpm: 80, meter: '4' });
  if (S.drone) {
    const d = S.drone; Object.assign(drone, { pc: d.pc ?? 9, octave: d.octave ?? 2, volume: d.volume ?? 0.5, lowOct: !!d.lowOct, speed: d.speed || 'medium' });
    drone.sound = DRONE_VOICES[d.sound] ? d.sound : 'strings';
    drone.chord = d.chord && DRONE_CHORDS[d.chord] ? d.chord : d.third ? (d.minor ? 'minor' : 'major') : d.fifth === false ? 'root' : 'fifth';
  }
  if (S.ink) {
    const k = S.ink;
    INK.finger = !!k.finger; INK.stamp = k.stamp || 'p'; INK.tool = k.tool || 'pen'; INK.erase = k.erase || 'smart';
    if (Array.isArray(k.slots) && k.slots.length === 2) INK.slots = k.slots; else if (k.pen && k.pen.c) INK.slots = [k.pen.c, COLORS[2]];
    INK.slot = k.slot === 1 ? 1 : 0;
    Object.assign(INK.pen, { size: (k.pen && k.pen.size) || 3, a: (k.pen && k.pen.a) || 1 }); Object.assign(INK.hl, k.hl || {}); Object.assign(INK.stampStyle, k.stampStyle || {}); Object.assign(INK.white, k.white || {});
  }
  syncInkBar();
  if (S.scale) { Object.assign(scale, S.scale); if (!['piano', 'soft', 'strings'].includes(scale.sound)) scale.sound = 'piano'; } else scale.octave = DEFAULT_OCT[S.instrument] ?? 3;
  fillInstrumentSelects(); fillKeySelects(); fillHarmonicSelects();
  $('#pureFifths').checked = S.pureFifths;
  $('#countIn').checked = S.countIn; $('#clickWhileRec').checked = S.clickWhileRec;
  $$('#camSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cam === S.cam));
  updateTunerSetup(); syncDrone(); syncPlayerControls(); syncScaleUI();
  setHarmonicNote(INSTRUMENTS[S.instrument].strings ? INSTRUMENTS[S.instrument].strings[0] : 48);
  renderExamples();
  $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === S.sort));
  await refreshLibrary();
  renderGoal(); syncWinkUI();
  setHomeTab(scores.length ? (S.hometab || 'mine') : 'mine');
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
