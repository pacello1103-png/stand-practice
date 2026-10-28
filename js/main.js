import { pixDropFile } from './pixcache.js';
import { db, getSetting, setSetting, uid } from './db.js';
import { getCtx, unlock, micErrorText, ensureRunning, resetSound, audioLog, applySession } from './audio.js';
import { Metronome, makeTapper, tempoMarking, meterInfo } from './metronome.js';
import { Tuner, Drone, DRONE_VOICES, DRONE_CHORDS, naturalHarmonics, playHarmonics, stopHarmonics, playRefTone } from './tuner.js';
import { NOTE_NAMES, SYSTEMS, INSTRUMENTS, stringTargets, etFreq, midiName } from './temperament.js';
import { ScalePlayer, SCALE_TYPES } from './scales.js';
import { Recorder, Player, computePeaks, peakOf, ROOMS } from './recorder.js';
import { VideoRecorder, decodeVideoAudio, videoThumb, devShape } from './video.js';
import { paintCover, COVER_PHOTOS, PHOTO_CATS, photoById } from './covers.js';
import { drawNotebookPage, drawCover, PAPER_GROUPS, PAPER_TYPES, RASTRAL, COVER_STYLES, COVER_COLORS, systemsPerPage, PAGE_W as NB_PW, PAGE_H as NB_PH } from './notebook.js';
import { usableFiles, filesAsPictures } from './addpages.js';
import { initNotes, renderNotes, noteId, openNote, closeAllNotes } from './notes.js';
import { openDocument, sizesKey, makeThumb, looksBlack, readScoreInfo, findSplit, PAPERS, mapDoc, contentBox, unionBox, commonGaps, pageGaps } from './score.js';
import { openCropper, openCutter, openGluer } from './pagetools.js';
import { putPicture, PEN_KINDS, PEN_WIDTH, PALETTE, TEXT_STYLES, TEXT_EFFECTS, STICKERS, TAPES, FONTS, FRAMES, LOOK_DEFAULT, tbFont, recogniseShape, SHAPES, BACKGROUNDS, BG_PATTERNS, PHOTO_FILTERS, PHOTO_SHAPES, PALETTES, METALS, WORD_FONTS, shapePath } from './inkx.js';
import { ELEMENTS, ELEMENT_CATS, elementAspect } from './elements.js';
import { PracticeHost, fetchPractice, hasKnownIpad, askIpad } from './sync.js';
import { initPhoneScores } from './phonescores.js';
import { cloudAvailable, cloudSet, cloudGet, onCloudChange } from './cloud.js';
import { ask } from './dialog.js';
import { InkLayer, COLORS, STAMPS, drawItem, loadMusicFont, setPaperColor, setMaskReadyHandler, itemBounds, itemsInLasso, transformItem, smartMask, saveItems, loadItems, itemHit, textFont, measureTextBox, preloadAssets, PASSAGE_KINDS, setHiddenLayers, setActiveLayer, isHiddenItem, flushInk, dropInk, preloadMasks } from './ink.js';
import { initPassages, loadPassages, renderPassages, markRegion, dropScorePassages, allPassages, setPriority, priorityOf, missed as passMissed, progress as passProgress } from './passages.js';
import { exportPicture, exportPdf } from './export.js';
import { cutPcm, segmentsFor, segmentsLength, renderVideoCut } from './cut.js';
import { initReview, openReview } from './review.js';
import * as P from './pomodoro.js';
import { placeWords } from './textplace.js';
import { searchWorks, workFiles, rankFiles, splitTitle, fileUrl, workUrl, loadComposers, parseQuery, composerWorks, warmUp, prefetchWorks } from './imslp.js';
import { initCompose, openComposition } from './compose/editor.js';
import { pickRegion } from './picker.js';
import { recognise, recogniseBest } from './omr.js';
import { initStudio, openStudio } from './studio.js';
import { CameraHost, CameraPhone, directWatch } from './link.js';
import { PageFollower } from './follow.js';
import { Gaze, WinkDetector, WinkLevels, fitCalibration } from './gaze.js';
import { KeyFollower } from './keyfollow.js';
import { startTour } from './tour.js';
import { makeBackupSet, restoreBackup as restoreFiles, backupSizes, lastChange } from './backup.js';

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
function toast(msg, ms = 2800) { if (document.body.classList.contains('performing')) return; const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms); }

// Any first tap wakes the audio engine (iOS requirement).
let unlocked = false;
document.addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; unlock(); } else getCtx(); }, { capture: true });

// =====================================================================
// Settings
// =====================================================================
const S = {
  ref: 442, twoUp: true, onePage: false, landscapeLock: false, turnScore: false, halfTurn: false, paper: 'white', countIn: true, clickWhileRec: false, cam: 'user',
  room: 'studio', wet: 0.18, autoLevel: true, sort: 'recent', flash: false,
  instrument: 'cello', system: 'equal', key: 0, pureFifths: true,
  metro: null, drone: null, scale: null, hometab: 'mine',
};
async function loadSettings() { const saved = await getSetting('settings', {}); Object.assign(S, saved || {});
  // (layers are no longer offered: whatever was hidden in one shows again)
  if (S.hidLy && S.hidLy.length) { S.hidLy = []; saveSettings(); }
  setHiddenLayers([]); applyOrientation(); }
// Lock the whole app sideways, so a landscape score reads the right way up while the iPad is held upright.
function applyOrientation() {
  try { if (NATIVE && NATIVE.standOrientation) NATIVE.standOrientation.postMessage({ lock: S.landscapeLock ? 'landscape' : 'auto' }); } catch { /* not on the iPad */ }
}
let saveT; function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => setSetting('settings', S), 300); }

// =====================================================================
// Panels
// =====================================================================
let openPanel = null;
// A short tour the first time each tool opens. Kept on this iPad; Settings › Show the tour again resets nothing here.
const SECTION_TOURS = {
  metronome: [
    { title: 'Metronome', text: 'Tap the number to type a tempo, or use the − and + buttons. The slider moves it smoothly.', at: '#bpmVal' },
    { title: 'Beats', text: 'Tap a beat dot to make it accented, normal or silent. Pick the meter and the subdivision below.', at: '#beatDots' },
    { title: 'Tap tempo', text: 'Tap the Tap tempo button in time with the music and Stand sets the speed from your taps.', at: '#tapBtn' },
    { title: 'Start', text: 'Start or stop the click here. Stand counts you in if the count-in is on.', at: '#metroToggle' },
    { title: 'Speed trainer and silent bars', text: 'The speed trainer raises the tempo bar by bar. Silent bars drop the click out so you keep time yourself.', at: null },
  ],
  tuner: [
    { title: 'Tuner', text: 'Play one note at a time. The needle shows how far you are from it, in cents. Green means in tune.', at: '#tunerFace' },
    { title: 'Open strings', text: 'The string buttons tune the open strings, in fifths, the way a cello is tuned.', at: '#stringRow' },
    { title: 'Harmonics and drone', text: 'Harmonics and the drone have their own tabs at the top of this panel.', at: '#tunerTabs' },
    { title: 'Reference pitch', text: 'Change the reference pitch and the temperament in the settings if you play with others.', at: null },
  ],
  scales: [
    { title: 'Scales', text: 'Choose the key, the type and the number of octaves. The strip shows the notes to play.', at: '#scaleKeys' },
    { title: 'Play along', text: 'Play the scale with the drone under it, and set the direction (up, down or both).', at: '#scaleDir' },
  ],
  pomodoro: [
    { title: 'Practice timer', text: 'Work in focused blocks with rests between them. Pick a preset, or set your own times.', at: '#pomoPresets' },
    { title: 'Timer controls', text: 'Start, pause or stop the timer. A small pill keeps the time on screen while you play.', at: '#pomoPlayBtn' },
  ],
  record: [
    { title: 'Record', text: 'Choose Audio for the best sound, or Video to watch your posture and technique.', at: '#recAudio' },
    { title: 'Count-in', text: 'The count-in plays one bar of the metronome before recording starts.', at: '#countIn' },
    { title: 'Camera', text: 'Pick the front or back camera, or the iPhone if it is linked to film you.', at: '#camSeg' },
    { title: 'Your takes', text: 'Every recording is kept in Recordings, where you can listen, trim and share it.', at: null },
  ],
  takes: [
    { title: 'Recordings', text: 'Every take you recorded is here. Tap one to listen, or play it along with the score.', at: null },
  ],
  reps: [
    { title: 'Repetitions', text: 'Set a bar to repeat on a loop, and how many times, so you can practise the hard part on its own.', at: null },
  ],
  compose: [
    { title: 'Compose', text: 'Write on real staff paper. Choose a note value here, then tap the staff with the Pencil (or your finger, with finger writing on).', at: '#cpPal' },
    { title: 'Write or select', text: 'The pencil writes notes. The arrow selects them: tap a note, or drag from one note to another to select everything in between.', at: '#cpMode' },
    { title: 'Undo', text: 'Undo and redo are always here, next to the palette title.', at: '#cpPalUndo' },
    { title: 'All the signs', text: 'Notes, articulations, dynamics and hairpins, lines (slurs, 8va, endings), ornaments and grace notes, words, clefs and keys (with Transpose), and bars.', at: '#cpPalTabs' },
    { title: 'Slurs and hairpins', text: 'Select some notes and tap Slur, Crescendo or Diminuendo: the line goes over all of them, across bars and lines. With one note selected, each tap stretches it one note further.', at: null },
    { title: 'Tuplets', text: 'Duplets up to 11-tuplets are in the Notes tab under Tuplets. Choose one with the note value, then write the notes.', at: null },
    { title: 'Listen', text: 'Play the piece from the selected bar. Instruments, Sound, Layout and Export are next to it.', at: '#cpPlay' },
  ],
  notebook: [
    { title: 'Notebook', text: 'Engraved staff paper to write on with the Apple Pencil. Your finger turns pages, pinches to zoom and moves the page.', at: null },
    { title: 'Pens', text: 'Tap the pen again for pen types, sizes and colours. Each pen keeps its own colour and size.', at: '.ink-tool[data-tool="pen"]' },
    { title: 'Text', text: 'The Aa tool makes text boxes: tap the page and type, or write in the box with the Pencil. Tap a box once to move it, twice to edit it.', at: '.ink-tool[data-tool="tbox"]' },
    { title: 'Photos, titles and layouts', text: 'Photos (also inside a word or a shape), title styles, stickers, elements and ready-made page layouts.', at: '#inkInsert' },
    { title: 'Select and move', text: 'Draw a loop around things to move, resize or copy them. Pink lines show when they line up with the page or with other things.', at: '.ink-tool[data-tool="select"]' },
    { title: 'Zoom and pages', text: 'Zoom in for detail, add pages and see all your pages here.', at: '#zoomBtn' },
  ],
  score: [
    { title: 'Your score', text: 'Tap the right or left edge to turn the page, or swipe. A Bluetooth pedal works too. A tap in the middle shows or hides this bar.', at: null },
    { title: 'Markings', text: 'Write fingerings, bowings and dynamics with the Pencil. The Pencil opens the markings by itself when it touches the page. Hold a pen for its colours and sizes.', at: '#inkBtn' },
    { title: 'Practice tools', text: 'The metronome, tuner, scales, recordings and passages open over the score, so you never leave the music.', at: '[data-panel="metronome"]' },
    { title: 'Passages', text: 'Choose the Select tool in Markings and draw around a hard part: Passage keeps it, to practise later in a session that jumps from passage to passage.', at: '[data-panel="passages"]' },
    { title: 'Pages', text: 'In More › Pages you see every page: hold one to delete it, or hold and drag it to put it somewhere else. Move lines up joins the end of one page to the next.', at: '[data-panel="settings"]' },
    { title: 'Turning pages for you', text: 'In More you can turn on winking to turn pages, a tap on the stand, or turning by listening (Beta).', at: '[data-panel="settings"]' },
    { title: 'Perform', text: 'Perform hides everything but the music. Leave it with two deliberate taps on the pill.', at: '#performBtn' },
  ],
  harmonics: [
    { title: 'Harmonics', text: 'Play a natural harmonic: Stand tells you which one it is, on which string, and where to touch.', at: '#hMatch' },
    { title: 'Hear the series', text: 'Choose a note and listen to its harmonic series, one partial at a time or as a chord.', at: '#hSeries' },
  ],
  drone: [
    { title: 'Drone', text: 'A steady note to tune against. Tap a note to start it; choose the sound, the octave and the chord below.', at: '#droneNotes' },
    { title: 'Following you', text: 'In "It listens" mode the drone moves to the key you are playing in. "My list" steps through notes you choose, also with a pedal.', at: '#droneModeSeg' },
  ],
  passages: [
    { title: 'Passages', text: 'Mark the hard parts of a piece and track them. Choose the Select tool in Markings, draw around a passage, then tap Passage.', at: null },
  ],
  listen: [
    { title: 'Listen', text: 'Add a recording to play along with the score: slower without changing pitch, and loop any part.', at: null },
  ],
  goal: [
    { title: 'Practice log', text: 'Your practice time, day by day and piece by piece. Stand counts it while a score or a tool is open.', at: null },
  ],
  studio: [
    { title: 'Studio', text: 'Your video with the score on it, ready to share. Everything here is a copy: the recording itself never changes.', at: '#stStage' },
    { title: 'Add the score', text: 'Choose the score (from your library, a photo or a PDF) and tap the lines you play. They appear over the video.', at: '#stAddScore' },
    { title: 'Following you', text: 'Sync listens to the recording and moves the music along with your playing. You can also tap at the start of each bar.', at: '#stSyncBtn' },
    { title: 'Picture', text: 'Format chooses the shape (9:16 for Reels and Stories, 16:9, square) and the look. Drag the video to choose the part on show.', at: '#stFormatBtn' },
    { title: 'Timeline', text: 'Drag the ends of the sound to trim it, the bars of the score to move them, and add images that come and go.', at: '#stTimeline' },
    { title: 'Export', text: 'Makes the finished video and opens the share sheet: save it to Photos or send it.', at: '#stExport' },
  ],
  phonecam: [
    { title: 'Camera for iPad', text: 'Open Stand on your iPad, choose the iPhone as camera in Record, and keep both near each other. They find each other by themselves.', at: '#pcStatus' },
    { title: 'Adjust', text: 'Brightness, warmth and zoom are here. The iPad can also change them, and starts and stops the recording.', at: '#pcAdjBtn' },
  ],
};
function sectionTour(name, { force = false } = {}) {
  if (!SECTION_TOURS[name] || window.__noTour) return;
  S.sectionTours = S.sectionTours || {};
  if (S.sectionTours[name]) return;
  if (!force && openPanel !== name) return;   // the user has already moved on
  // one tour at a time (a tool opened on one of its tabs asks twice)
  if (sectionTour.busy || document.querySelector('.tour')) return;
  sectionTour.busy = name;
  startTour({ steps: SECTION_TOURS[name], onDone: () => { sectionTour.busy = null; S.sectionTours[name] = true; saveSettings(); } });
}

function showPanel(name, tab) {
  if (openPanel === name && !tab) { hidePanel(); return; }
  hidePanel();
  const p = $('#panel-' + name); if (!p) return;
  p.hidden = false; openPanel = name;
  { const tn = name === 'tuner' && tab === 'harm' ? 'harmonics' : name === 'tuner' && tab === 'drone' ? 'drone' : name;
    if (SECTION_TOURS[tn] && name !== 'compose') setTimeout(() => sectionTour(tn, { force: openPanel === name }), 350); }   // compose waits until you start writing
  $$(`[data-panel="${name}"]`).forEach((b) => { if (!b.dataset.tab || b.dataset.tab === tab) b.classList.add('on'); });
  if (name === 'tuner') setTunerTab(tab || currentTunerTab);
  // Recordings opens on the list (a recording left open last time is closed), unless its video
  // is over the score right now
  if (name === 'takes') { if (!VF.on && $('#player').hidden) $('#panel-takes').classList.remove('viewing'); if (!VF.on && !$('#player').hidden && !player.playing) { $('#player').hidden = true; $('#panel-takes').classList.remove('viewing'); currentTake = null; } refreshTakes(); }
  if (name === 'metronome') drawRamp();
  if (name === 'settings') fillScoreSettings();
  if (name === 'scales') renderScaleStrip();
  if (name === 'pages') { PG.sel.clear(); PG.selecting = false; PG.staged = null; for (const [o, t] of PG.thumbs) if (PG.edited.has(o)) t.stale = true; PG.edited.clear(); renderPagesPanel(); }
  if (name === 'passages') renderPassages();
  if (name === 'study') renderStudy();
  if (name === 'record') {
    syncLink(); if (host.state === 'linked') showRemotePreview();
    // the camera is opened ahead when the last recording was a video, so Record starts at once
    clearTimeout(VW.t);
    if (S.lastRecKind === 'video' && S.cam !== 'iphone' && !PHONE && !recState && window.innerWidth > window.innerHeight && window.MediaRecorder) vrec.open(S.cam).catch(() => {});
  }
}
function hidePanel() {
  if (!openPanel) return;
  $('#panel-' + openPanel).hidden = true;
  $$('[data-panel].on').forEach((b) => b.classList.remove('on'));
  if (openPanel === 'settings') saveScoreMeta();
  if (openPanel === 'setpick' && SETS.pick) { const was = openPanel; openPanel = null; $('#panel-' + was).hidden = true; spFree(); SETS.pick = null; }
  if (openPanel === 'record' && !(recState && recState.iphone)) hideRemotePreview();
  if (openPanel === 'record') { clearTimeout(VW.t); VW.t = setTimeout(() => { if (!recState && !vrec.recording) vrec.close(); }, 1500); }
  if (openPanel === 'pages' && PG.staged) { const was = openPanel; openPanel = null; $('#panel-' + was).hidden = true; savePageChanges(); }
  if (openPanel === 'tuner') { pauseHarmonicListening(); if (tuner.active && !TU.mini) { tuner.stop(); tuner.onReading(null); updateTunerButtons(); } }
  if (openPanel === 'app' && wink.testing) { wink.testing = false; $('#winkTest').textContent = 'Test'; $('#winkMeter').hidden = true; sendFace(); }
  if (openPanel === 'app' && tapTest.on) { tapTest.on = false; $('#tapTest').textContent = 'Test'; $('#tapLast').textContent = ''; sendTap(); }
  openPanel = null;
}
// a window opened in a screen (Layout, Capture, Sound in Compose; Pages, Settings in a score…)
// closes with that screen when you go back home
for (const id of ['#score', '#compose', '#studio']) {
  const scr = $(id); if (!scr) continue;
  new MutationObserver(() => { if (scr.hidden && openPanel) hidePanel(); }).observe(scr, { attributes: true, attributeFilter: ['hidden'] });
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
  if (e.target.closest('.panel, .topbar, .dock, .tiles, .inkbar, .toast, .cam, .picker, .cp-pal, .cp-sel, .cp-zoom, .studio, .tour')) return;
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
  $('#tab-mine').hidden = t !== 'mine'; $('#tab-find').hidden = t !== 'find'; $('#tab-sets').hidden = t !== 'sets';
  if (t === 'sets') renderSets();
  if (t === 'find') setTimeout(() => { if (!$('#findInput').value) $('#findInput').focus({ preventScroll: true }); }, 50);
}
$$('#homeTabs button').forEach((b) => b.addEventListener('click', () => setHomeTab(b.dataset.hometab)));

let scores = [];
const thumbURLs = new Map();
async function refreshLibrary() {
  scores = await db.all('scores').catch(() => []);
  renderGrid();
  renderBackupBanner().catch(() => {});
  renderToday();
  renderGoal();
}
function renderGrid() {
  const q = $('#searchInput').value.trim().toLowerCase();
  // inside a folder the library shows only its scores; a search looks through every score
  if (FOLD.current && !folderOf(FOLD.current)) FOLD.current = null;
  const inFolder = !q && FOLD.current ? FOLD.current : null;
  const list = scores.filter((s) => !s.preview && (!q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q))
    && (q || (inFolder ? s.folder === inFolder : !s.folder)));
  const by = S.sort;
  list.sort((a, b) => by === 'title' ? a.title.localeCompare(b.title)
    : by === 'composer' ? (a.composer || '~').localeCompare(b.composer || '~') || a.title.localeCompare(b.title)
      : (b.opened || b.added) - (a.opened || a.added));
  const grid = $('#grid'); grid.textContent = '';
  $('#emptyLib').hidden = scores.length > 0;
  $('.lib-bar').hidden = scores.length === 0;
  $('#folderBar').hidden = !inFolder;
  if (inFolder) $('#folderTitle').textContent = folderOf(inFolder).name;
  if (!q && !inFolder) for (const f of [...FOLD.list].sort((a, b) => a.name.localeCompare(b.name))) grid.append(folderCard(f));
  for (const s of list) {
    const b = el('button', 'card');
    const th = el('div', 'thumb');
    if (s.thumb) {
      th.style.backgroundImage = `url(${thumbURL(s)})`;
      // no white paper showing at the edges of a dark cover
      th.classList.add('has-pic');
    }
    else if (canRemakeThumb(s) && !thumbChecked.has(s.id)) { thumbChecked.add(s.id); fixThumb(s); }
    th.append(el('span', 'badge', s.pages + (s.pages === 1 ? ' page' : ' pages')));
    b.append(th, el('div', 'ttl', s.title), el('div', 'cmp', s.kind === 'comp' ? (s.composer ? s.composer + ' · ' : '') + 'Your composition' : s.composer || (s.seconds > 59 ? fmtMinutes(s.seconds) + ' practised' : 'Not practised yet')));
    if (LIB.sel.has(s.id)) b.classList.add('picked');
    const tick = el('span', 'pick'); tick.append(icon('i-check')); th.append(tick);
    b.addEventListener('click', () => {
      if (LIB.editing) { LIB.sel.has(s.id) ? LIB.sel.delete(s.id) : LIB.sel.add(s.id); b.classList.toggle('picked', LIB.sel.has(s.id)); syncLibActions(); return; }
      openScore(s.id);
    });
    // press and hold a score to start selecting
    let holdT = 0;
    b.addEventListener('pointerdown', () => { clearTimeout(holdT); holdT = setTimeout(() => { if (!LIB.editing) { setLibEditing(true); LIB.sel.add(s.id); b.classList.add('picked'); syncLibActions(); b.dataset.held = '1'; } }, 550); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(holdT));
    b.addEventListener('click', (e) => { if (b.dataset.held) { delete b.dataset.held; e.stopImmediatePropagation(); } }, true);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.dataset.sid = s.id;
    libDragSource(b, s.id);
    grid.append(b);
  }
}
// ---------- dragging selected scores onto a folder ----------
// In Select, press a chosen score and drag: all the chosen scores go together. Drop them on a
// folder (or on "Library" at the top of a folder) to move them there.
const LD = { on: null };
function libDragSource(card, id) {
  let start = null, holdT = 0, armT = 0, armed = false;
  card.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId }; armed = false;
    // a finger: held still a moment on a chosen score, then it moves (else the list scrolls)
    clearTimeout(holdT); clearTimeout(armT);
    if (e.pointerType === 'touch' && LIB.editing && LIB.sel.has(id)) holdT = setTimeout(() => { if (start && !LD.on) { beginLibDrag(e, card); LD.on.ghost.style.left = start.x + 'px'; LD.on.ghost.style.top = start.y + 'px'; if (navigator.vibrate) try { navigator.vibrate(8); } catch {} } }, 320);
    // held on a score not chosen yet: the hold chooses it (Select starts) and, without lifting the
    // finger, moving then carries it straight away
    else if (e.pointerType === 'touch' && !LIB.editing) armT = setTimeout(() => { if (start && LIB.editing && LIB.sel.has(id)) armed = true; }, 600);
  });
  card.addEventListener('pointermove', (e) => {
    if (!start || LD.on || e.pointerId !== start.id) return;
    if (armed && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 10) { armed = false; beginLibDrag(e, card); if (navigator.vibrate) try { navigator.vibrate(8); } catch {} return; }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 10) { clearTimeout(holdT); clearTimeout(armT); }
    if (e.pointerType === 'touch') return;   // (a finger drags after holding)
    if (!LIB.editing || !LIB.sel.has(id)) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
    beginLibDrag(e, card);
  });
  card.addEventListener('pointerup', () => { start = null; armed = false; clearTimeout(holdT); clearTimeout(armT); });
  card.addEventListener('pointercancel', () => { start = null; armed = false; clearTimeout(holdT); clearTimeout(armT); });
  card.addEventListener('touchmove', (e) => { if (LD.on || armed) e.preventDefault(); }, { passive: false });
}
function beginLibDrag(e, card) {
  const ids = [...LIB.sel];
  const ghost = el('div', 'lib-ghost');
  const picks = ids.slice(0, 3).map((sid) => $(`.card[data-sid="${sid}"] .thumb`)).filter(Boolean);
  picks.reverse().forEach((th, i) => { const c = el('div', 'lg-card'); c.style.backgroundImage = th.style.backgroundImage; c.style.transform = `rotate(${(i - 1) * 5}deg)`; ghost.append(c); });
  if (!picks.length) ghost.append(el('div', 'lg-card'));
  ghost.append(el('span', 'lg-count num', String(ids.length)));
  document.body.append(ghost);
  LD.on = { ghost, ids, over: null, card };
  document.body.classList.add('lib-dragging');
  $('#libOut').hidden = !FOLD.current;   // (inside a folder: a place to drop it out of the folder)
  try { card.setPointerCapture(e.pointerId); } catch {}
  const move = (ev) => {
    ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
    ghost.hidden = true; const t = document.elementFromPoint(ev.clientX, ev.clientY); ghost.hidden = false;
    // a folder, "Library" at the top of a folder, or another score (both go in a new folder)
    let over = t && (t.closest('.card.folder') || t.closest('#folderBack') || t.closest('#libOut'));
    if (!over && t && !FOLD.current) { const c = t.closest('.card[data-sid]'); if (c && !LD.on.ids.includes(c.dataset.sid)) over = c; }
    if (over !== LD.on.over) { if (LD.on.over) LD.on.over.classList.remove('drop-on'); if (over) over.classList.add('drop-on'); LD.on.over = over; }
    // near the top or bottom edge, the library scrolls
    const lib = $('#library'), r = lib.getBoundingClientRect();
    LD.on.scroll = ev.clientY < r.top + 70 ? -12 : ev.clientY > r.bottom - 70 ? 12 : 0;
  };
  const tick = () => { if (!LD.on) return; if (LD.on.scroll) $('#library').scrollTop += LD.on.scroll; requestAnimationFrame(tick); };
  const end = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    const d = LD.on; LD.on = null; document.body.classList.remove('lib-dragging'); ghost.remove(); $('#libOut').hidden = true;
    // a click follows the drag; it must not toggle the score
    // (only the click coming right now: a drag with a finger makes none, and the next real tap must work)
    const block = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    d.card.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => d.card.removeEventListener('click', block, { capture: true }), 400);
    if (!d.over) return;
    d.over.classList.remove('drop-on');
    // onto another score: a new folder for them all, named at once
    if (d.over.dataset.sid) {
      const sid = d.over.dataset.sid;
      LIB.sel = new Set([...d.ids, sid]); $$('#grid .card[data-sid]').forEach((c) => c.classList.toggle('picked', LIB.sel.has(c.dataset.sid))); syncLibActions();
      const comps = [...LIB.sel].map((x) => (scores.find((y) => y.id === x) || {}).composer || '').map((c) => c.trim());
      openFolderSheet('new');
      if (comps[0] && comps.every((c) => c === comps[0])) $('#folderName').value = comps[0].split(/\s+/).pop();
      d.over.classList.add('drop-merged'); setTimeout(() => d.over.classList.remove('drop-merged'), 600);
      return;
    }
    const target = d.over.id === 'folderBack' || d.over.id === 'libOut' ? null : d.over.dataset.folder;
    for (const sid of d.ids) { const sc = scores.find((x) => x.id === sid); if (!sc) continue; if (target) sc.folder = target; else delete sc.folder; db.put('scores', sc); }
    setLibEditing(false); renderGrid();
    toast(target ? `Moved ${d.ids.length === 1 ? 'it' : d.ids.length + ' scores'} to ${folderOf(target).name}.` : 'Moved to the library.');
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  move(e); tick();
}
// ---------- folders in the library (Etudes, Pieces, Orchestra...) ----------
// Folders are a single level, kept in settings. A score belongs to one folder or to the library.
const FOLD = { list: [], current: null };
const FP = { mode: 'new', id: null, armed: false };
const FOLDER_IDEAS = ['Etudes', 'Pieces', 'Orchestra', 'Concertos', 'Chamber music', 'Exams'];
async function loadFolders() { FOLD.list = (await getSetting('folders', [])) || []; }
const saveFolders = () => setSetting('folders', FOLD.list);
const folderOf = (id) => FOLD.list.find((f) => f.id === id);
// A cover that cannot show (its picture lost by the iPad, or drawn black when a heavy page did not
// draw) is made again, quietly, one at a time.
const thumbChecked = new Set();
let thumbFixing = Promise.resolve();
const canRemakeThumb = (s) => !!s.fileId && s.kind !== 'comp' && s.kind !== 'paper' && !s.preview;
function thumbURL(s) {
  if (!thumbURLs.has(s.id)) thumbURLs.set(s.id, URL.createObjectURL(s.thumb));
  const u = thumbURLs.get(s.id);
  if (!thumbChecked.has(s.id) && canRemakeThumb(s)) {
    thumbChecked.add(s.id);
    const im = new Image();
    im.onload = () => { if (looksBlack(im)) fixThumb(s); };
    im.onerror = () => fixThumb(s);
    im.src = u;
  }
  return u;
}
const loadsWell = (blob) => new Promise((res) => {
  if (!blob) { res(false); return; }
  const u = URL.createObjectURL(blob), im = new Image();
  im.onload = () => { const ok = !looksBlack(im); URL.revokeObjectURL(u); res(ok); };
  im.onerror = () => { URL.revokeObjectURL(u); res(false); };
  im.src = u;
});
function fixThumb(s) {
  thumbFixing = thumbFixing.then(async () => {
    // (never while a score is open: its pages come first)
    for (let i = 0; i < 120 && !$('#score').hidden; i++) await new Promise((r) => setTimeout(r, 1000));
    const fresh = await db.get('scores', s.id).catch(() => null); if (!fresh) return;
    let thumb = (await loadsWell(fresh.thumb)) ? fresh.thumb : null;
    if (!thumb) {
      const file = await db.get('files', fresh.fileId).catch(() => null);
      if (!file || (file.kind !== 'pdf' && file.kind !== 'images')) return;
      let base = null;
      try { base = await openDocument(file, fresh.sizes); thumb = await makeThumb(mapDoc(base, fresh.pageMap, fresh.cuts, fresh.glue)); }
      catch (e) { console.warn('cover', e); }
      finally { try { base && base.destroy(); } catch {} }
      if (!thumb) return;
      fresh.thumb = thumb; await db.put('scores', fresh);
    }
    const mine = scores.find((x) => x.id === s.id); if (mine) mine.thumb = thumb;
    if (thumbURLs.has(s.id)) { URL.revokeObjectURL(thumbURLs.get(s.id)); thumbURLs.delete(s.id); }
    thumbURLs.set(s.id, URL.createObjectURL(thumb));
    for (const th of document.querySelectorAll(`.card[data-sid="${s.id}"] .thumb`)) { th.style.backgroundImage = `url(${thumbURLs.get(s.id)})`; th.classList.add('has-pic'); }
  }).catch(() => {});
}
function folderCard(f) {
  const n = scores.filter((s) => s.folder === f.id).length;
  const b = el('button', 'card folder');
  b.dataset.folder = f.id;
  const th = el('div', 'thumb folder-tile');
  th.append(icon('i-folder'), el('span', 'folder-count num', String(n)));
  b.append(th, el('div', 'ttl', f.name), el('div', 'cmp', n === 1 ? '1 score' : n + ' scores'));
  b.addEventListener('click', () => { if (LIB.editing) setLibEditing(false); FOLD.current = f.id; renderGrid(); });
  return b;
}
function openFolderSheet(mode, id) {
  FP.mode = mode; FP.id = id || null; FP.armed = false;
  // (a new folder made while scores are selected takes them in)
  FP.withSel = mode === 'new' && LIB.editing && LIB.sel.size > 0;
  const f = id ? folderOf(id) : null;
  $('#folderSheetTitle').textContent = mode === 'move' ? 'Move to folder' : f ? 'Folder' : FP.withSel ? (LIB.sel.size === 2 ? 'New folder for these two' : `New folder for these ${LIB.sel.size}`) : 'New folder';
  $('#folderNameBox').hidden = mode === 'move';
  $('#folderMoveBox').hidden = mode !== 'move';
  $('#folderActions').hidden = mode === 'move';
  $('#folderName').value = mode === 'new' ? '' : f ? f.name : '';
  $('#folderDelete').hidden = mode !== 'rename';
  $('#folderDelete').textContent = 'Delete folder';
  $('#folderChips').textContent = '';
  if (mode === 'new') for (const name of FOLDER_IDEAS) {
    const c = el('button', 'chip', name);
    c.addEventListener('click', () => { $('#folderName').value = name; });
    $('#folderChips').append(c);
  }
  if (mode === 'move') {
    const pick = $('#folderPick'); pick.textContent = '';
    const choose = (target) => {
      const ids = [...LIB.sel];
      for (const sid of ids) {
        const sc = scores.find((x) => x.id === sid);
        if (!sc) continue;
        if (target) sc.folder = target; else delete sc.folder;
        db.put('scores', sc);
      }
      setLibEditing(false);
      hidePanel();
      renderGrid();
      toast(target ? `Moved to ${folderOf(target).name}.` : 'Moved to the library.');
    };
    const rows = [['', FOLD.current ? 'Out of the folder (the library)' : 'Library (no folder)'], ...[...FOLD.list].filter((x) => x.id !== FOLD.current).sort((a, b) => a.name.localeCompare(b.name)).map((x) => [x.id, x.name])];
    for (const [val, label] of rows) {
      const b = el('button', 'folder-row', label);
      b.addEventListener('click', () => choose(val || null));
      pick.append(b);
    }
    pick.append(el('button', 'folder-row new', '+ New folder'));
    pick.lastChild.addEventListener('click', () => { openFolderSheet('new'); });
    $('#folderMoveHint').textContent = `Moving ${LIB.sel.size} ${LIB.sel.size === 1 ? 'score' : 'scores'}.`;
  }
  showPanel('folder');
  if (mode !== 'move') setTimeout(() => $('#folderName').focus(), 80);
}
$('#newFolder').addEventListener('click', () => openFolderSheet('new'));
$('#folderBack').addEventListener('click', () => { if (LIB.editing) setLibEditing(false); FOLD.current = null; renderGrid(); });
$('#libNewFolder').addEventListener('click', () => openFolderSheet('new'));
$('#folderRename').addEventListener('click', () => openFolderSheet('rename', FOLD.current));
$('#folderSave').addEventListener('click', async () => {
  const name = $('#folderName').value.trim().slice(0, 40);
  if (!name) { toast('Give the folder a name.'); return; }
  if (FP.mode === 'new') {
    const f = { id: uid(), name, created: Date.now() };
    FOLD.list.push(f); FOLD.current = f.id;
    if (FP.withSel) {
      const ids = [...LIB.sel];
      for (const sid of ids) { const sc = scores.find((x) => x.id === sid); if (!sc) continue; sc.folder = f.id; db.put('scores', sc); }
      setLibEditing(false);
      toast(`${ids.length === 1 ? 'Moved it' : 'Moved ' + ids.length + ' scores'} to ${name}.`);
    }
  } else {
    const f = folderOf(FP.id); if (f) f.name = name;
  }
  saveFolders(); hidePanel(); renderGrid();
});
$('#folderDelete').addEventListener('click', async () => {
  if (!FP.armed) { FP.armed = true; $('#folderDelete').textContent = 'Tap again to delete'; setTimeout(() => { FP.armed = false; $('#folderDelete').textContent = 'Delete folder'; }, 3000); return; }
  // the scores in it go back to the library; nothing is deleted
  for (const sc of scores.filter((x) => x.folder === FP.id)) { delete sc.folder; await db.put('scores', sc); }
  FOLD.list = FOLD.list.filter((f) => f.id !== FP.id);
  FOLD.current = null; saveFolders(); hidePanel(); renderGrid();
});
$('#libMove').addEventListener('click', () => { if (LIB.sel.size) openFolderSheet('move'); });
// inside a folder: the selected scores go back to the library, out of any folder
$('#libOutBtn').addEventListener('click', () => {
  const ids = [...LIB.sel]; if (!ids.length) return;
  for (const sid of ids) { const sc = scores.find((x) => x.id === sid); if (sc) { delete sc.folder; db.put('scores', sc); } }
  setLibEditing(false); renderGrid();
  toast(ids.length === 1 ? 'Taken out of the folder: it is in the library.' : `${ids.length} scores taken out of the folder.`, 2000);
});
$('#folderSelect').addEventListener('click', () => setLibEditing(!LIB.editing));
// a tap on an empty part of the library leaves selecting
$('#library').addEventListener('click', (e) => {
  if (!LIB.editing || LD.on) return;
  if (e.target.closest('.card, button, input, select, .lib-actions, .seg, a, label, .tile, .panel')) return;
  setLibEditing(false);
});

// ---------- select and delete scores ----------
const LIB = { editing: false, sel: new Set(), confirm: false };
function setLibEditing(on) {
  LIB.editing = on; LIB.sel.clear(); LIB.confirm = false;
  $('#grid').classList.toggle('editing', on); $('#libActions').hidden = !on;
  $('#libEdit').textContent = on ? 'Done' : 'Select'; $('#folderSelect').textContent = on ? 'Done' : 'Select';
  if (on) toast(FOLD.list.length ? 'Tap more scores, then Move or New folder. Or drag onto a folder, or onto another score.' : 'Tap more scores, then New folder. Or drag it onto another score to make a folder.', 2800);
  $$('#grid .card').forEach((c) => c.classList.remove('picked'));
  syncLibActions();
}
function syncLibActions() {
  const n = LIB.sel.size;
  LIB.confirm = false;
  $('#libCount').textContent = n ? (n === 1 ? '1 score selected' : n + ' scores selected') : 'Tap scores to select';
  $('#libNewFolder').disabled = !n;
  $('#libDelete').disabled = !n;
  $('#libMove').disabled = !n;
  $('#libOutBtn').hidden = !FOLD.current; $('#libOutBtn').disabled = !n;
  $('#libDelete span').textContent = 'Delete';
  $('#libDelete').classList.remove('confirming');
}
$('#libEdit').addEventListener('click', () => setLibEditing(!LIB.editing));
$('#libCancel').addEventListener('click', () => setLibEditing(false));
$('#libDelete').addEventListener('click', async () => {
  const n = LIB.sel.size; if (!n) return;
  if (!LIB.confirm) {
    LIB.confirm = true; $('#libDelete').classList.add('confirming');
    $('#libDelete span').textContent = n === 1 ? 'Delete it with its recordings?' : `Delete ${n} scores and their recordings?`;
    return;
  }
  const ids = [...LIB.sel];
  for (const id of ids) { const sc = scores.find((x) => x.id === id); if (sc) await deleteScoreData(sc); }
  setLibEditing(false);
  await refreshLibrary();
  toast(ids.length === 1 ? 'Score deleted' : ids.length + ' scores deleted');
});
// what a score adds to its file when opened: pages from other files, pages turned round
function scoreFile(score, file) {
  if (score.more && score.more.length) file.more = score.more; else delete file.more;
  if (score.rot && Object.keys(score.rot).length) file.rot = score.rot; else delete file.rot;
  return file;
}
const FOLLOW_CLEANED = new Set();
// what the pages of a score are (its file, pages added, their order, cuts, joins, turns), as a
// short stamp: markings do not change it, a change to the pages does
function pagesStamp(sc) {
  const t = JSON.stringify([sc.fileId, sc.more || null, sc.pageMap || null, sc.cuts || null, sc.glue || null, sc.rot || null, sc.trim ? sc.trimBox || 1 : 0]);
  let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
async function deleteScoreData(s) {
  dropInk(s.id); dropEdited(s.id);
  for (const x of (await db.keys('files').catch(() => [])).map(String)) if (x.startsWith('follow:' + s.id + ':')) await db.del('files', x).catch(() => {});
  const takes = await db.byIndex('takes', 'score', s.id).catch(() => []);
  for (const t of takes) await deleteTakeData(t.id);
  const inkKeys = (await db.keys('ink')).filter((k) => String(k).startsWith(s.id + ':'));
  for (const k of inkKeys) await db.del('ink', k);
  dropScorePassages(s.id);
  await db.del('files', s.fileId).catch(() => {});
  if (s.fileId) pixDropFile(s.fileId);
  for (const id of s.more || []) { await db.del('files', id).catch(() => {}); pixDropFile(id); }
  await db.del('files', 'ref:' + s.id).catch(() => {});
  await db.del('scores', s.id);
  if (thumbURLs.has(s.id)) { URL.revokeObjectURL(thumbURLs.get(s.id)); thumbURLs.delete(s.id); }
}
async function renderToday() {
  const log = allPractice().log;
  const today = log[dayKey()] || 0;
  let week = 0; const d = new Date();
  for (let i = 0; i < 7; i++) { week += log[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  $('#todayStat').textContent = PHONE ? (today < 60 ? 'Nothing practised yet today' : `${fmtMinutes(today)} today`) : today < 60 && week < 60 ? 'No practice logged yet today' : `Today ${fmtMinutes(today)} · last 7 days ${fmtMinutes(week)}`;
}
$('#searchInput').addEventListener('input', renderGrid);
$$('#sortSeg button').forEach((b) => b.addEventListener('click', () => {
  S.sort = b.dataset.sort; saveSettings();
  $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderGrid();
}));

function niceTitle(name) {
  return String(name || '').replace(/\.(pdf|jpe?g|png|heic|heif|webp|tiff?)$/i, '').replace(/^(IMSLP|PMLP)\d+-/i, '').replace(/[_]+/g, ' ').replace(/%20/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
// A file name like "Bach - Cello Suite No.1" or "Cello_Suite_No.1_(Bach,_Johann_Sebastian)": the
// composer part comes out, the rest is the title.
function titleFromName(name, composer) {
  let t = niceTitle(name).replace(/\s*\((?:[^()]*,[^()]*)\)\s*$/, '').replace(/\s+(score|parts?|part|solo part|complete|full score)$/i, '');
  if (composer) {
    const last = composer.split(/\s+/).pop();
    const parts = t.split(/\s+[-–—]\s+/);
    if (parts.length > 1) { const i = parts.findIndex((p) => p.toLowerCase().includes(last.toLowerCase()) && p.split(' ').length <= 4); if (i >= 0) { parts.splice(i, 1); t = parts.join(' - '); } }
  }
  return t || niceTitle(name);
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
  const composer = (meta && meta.composer) || info.composer || '';
  const title = (meta && meta.title) || info.title || titleFromName(name, composer);
  const score = { id: uid(), fileId: file.id, title, composer, pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb, source: meta ? 'IMSLP' : '' , folder: FOLD.current || undefined };
  doc.destroy();
  await db.put('files', file); await db.put('scores', score);
  return score;
}
async function addImages(blobs, name) {
  const file = { id: uid(), kind: 'images', data: blobs };
  const doc = await openDocument(file);
  const thumb = await makeThumb(doc);
  const score = { id: uid(), fileId: file.id, title: niceTitle(name), composer: '', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb , folder: FOLD.current || undefined };
  doc.destroy();
  await db.put('files', file); await db.put('scores', score);
  return score;
}
$('#scanBtn').addEventListener('click', () => {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standScan && (window.standCaps || {}).scan) window.webkit.messageHandlers.standScan.postMessage({});
  else $('#scanInput').click();
});
// Pages go through the review first: straightened, cleaned and cropped before they join the library.
initReview({
  toast,
  async commit(blobs, name) {
    const sc = await addImages(blobs, name);
    await refreshLibrary(); setHomeTab('mine');
    toast('Added: ' + label(sc), 3000);
    openScore(sc.id);
  },
});
$('#scanInput').addEventListener('change', (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  openReview(files, 'Scan ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + '.jpg');
});
const label = (sc) => (sc.composer ? `${sc.title} — ${sc.composer}` : sc.title);
// Many PDFs at once: one after another, each saved as soon as it is read (so nothing is lost if
// one is damaged or the iPad is busy), with how far it has got, and a short pause between them so
// the iPad keeps up. A file that cannot be read is skipped and named at the end.
const IMP = { busy: false, queue: [] };
async function importPdfs(list) {
  IMP.queue.push(...list);
  if (IMP.busy) { toast(`${IMP.queue.length} more to add…`, 2500); return; }
  IMP.busy = true;
  let added = 0, last = null, total = IMP.queue.length, done = 0;
  const failed = [];
  setHomeTab('mine');
  try {
    while (IMP.queue.length) {
      const it = IMP.queue.shift(); done++;
      total = Math.max(total, done + IMP.queue.length);
      toast(total > 1 ? `Adding ${done} of ${total}: ${niceTitle(it.name)}…` : 'Adding ' + niceTitle(it.name) + '…', 120000);
      try {
        const buf = await it.data();
        last = await addPdf(buf, it.name, it.meta || null); added++;
        await refreshLibrary();
      } catch (err) { console.error(err); failed.push(it.name); }
      await new Promise((r) => setTimeout(r, 120));
    }
  } finally { IMP.busy = false; }
  if (failed.length) toast((added ? `${added} added. ` : '') + `Could not open ${failed.length === 1 ? failed[0] : failed.length + ' files'} (not a PDF, or damaged).`, 6000);
  else if (added) toast(added === 1 ? 'Added: ' + label(last) : `${added} scores added`, 4000);
  else $('#toast').hidden = true;
  return { added, last };
}
$('#importInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const imgs = files.filter((f) => !pdfs.includes(f) && (f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name)));
  const other = files.filter((f) => !pdfs.includes(f) && !imgs.includes(f));
  if (pdfs.length) await importPdfs(pdfs.map((f) => ({ name: f.name, data: () => f.arrayBuffer() })));
  if (other.length) setTimeout(() => toast(`${other.length === 1 ? other[0].name + ' is' : other.length + ' files are'} not a PDF or a picture, so ${other.length === 1 ? 'it was' : 'they were'} left out.`, 4000), pdfs.length ? 3500 : 0);
  if (imgs.length) openReview(imgs, imgs[0].name);
});
// Files arriving from the iPad app: a PDF caught while browsing IMSLP, or "Open in Stand" from Files.
window.standIncoming = async (msg) => {
  try {
    const paths = msg.paths || [msg.path];
    const blobs = [];
    for (const p of paths) { const res = await fetch(p); if (!res.ok) throw new Error('missing file'); blobs.push(await res.blob()); }
    // the files are in memory now, so the native copies can go
    if (NATIVE && NATIVE.standDone) for (const p of paths) NATIVE.standDone.postMessage({ path: p });
    if (!$('#score').hidden) await closeScore();
    hidePanel();
    // a backup opened from Files
    const isZipBackup = /\.zip$/i.test(msg.name || paths[0] || '') && /stand backup/i.test(msg.name || paths[0] || '');
    if (/\.standbackup$/i.test(msg.name || paths[0] || '') || isZipBackup) {
      toast('Bringing your library back…', 120000);
      window.__restoring = true;
      let r; try { r = await restoreFiles(blobs.map((b, i) => new File([b], (msg.names && msg.names[i]) || msg.name || 'backup.standbackup'))); } catch (e) { window.__restoring = false; throw e; }
      const miss = r.missing.filter((m) => m.lack.length);
      toast(miss.length ? `Restored ${r.scores} scores. This backup has more files: open Settings › Backup › Restore and choose all of them.` : `Restored ${r.scores} scores. Starting again…`, miss.length ? 8000 : 2500);
      setTimeout(() => location.reload(), miss.length ? 8000 : 2500);
      return;
    }
    // several files at once: the PDFs are added one by one, the pictures go to the scan review
    const names = paths.map((p, i) => (msg.names && msg.names[i]) || (paths.length === 1 ? msg.name : '') || String(p).split('/').pop() || 'Score.pdf');
    const isPdfAt = (i) => /\.pdf$/i.test(names[i]) || blobs[i].type === 'application/pdf';
    const pdfIdx = blobs.map((_, i) => i).filter(isPdfAt), imgIdx = blobs.map((_, i) => i).filter((i) => !isPdfAt(i));
    let res = null;
    if (pdfIdx.length) res = await importPdfs(pdfIdx.map((i) => ({ name: names[i], data: () => blobs[i].arrayBuffer(), meta: msg.meta && msg.meta.title && pdfIdx.length === 1 ? msg.meta : null })));
    if (imgIdx.length) { setHomeTab('mine'); openReview(imgIdx.map((i) => (blobs[i].type ? blobs[i] : new Blob([blobs[i]], { type: 'image/jpeg' }))), names[imgIdx[0]] || 'Scan.jpg'); return; }
    // one PDF opens straight away (a preview with Keep and Remove)
    if (res && res.added === 1 && pdfIdx.length === 1 && res.last) {
      if (PREVIEW.at && Date.now() - PREVIEW.at < 10 * 60000) { PREVIEW.at = 0; res.last.preview = true; await db.put('scores', res.last); await refreshLibrary(); toast('A look at ' + label(res.last) + '. Keep it to add it to your stand.', 3500); }
      openScore(res.last.id);
    }
  } catch (e) { console.error(e); toast('That file could not be added.'); }
};

// =====================================================================
// Find a score
// =====================================================================
const EXAMPLES = {
  cello: ['Elgar cello concerto', 'Bach cello suites', 'Fauré élégie', 'Popper Hungarian rhapsody', 'Saint-Saëns swan', 'Brahms cello sonata 1'],
  violin: ['Bach partita 2', 'Mendelssohn violin concerto', 'Kreutzer etudes', 'Bruch violin concerto 1', 'Massenet méditation'],
  viola: ['Brahms viola sonata', 'Bach cello suites viola', 'Stamitz viola concerto', 'Hindemith viola'],
  bass: ['Bottesini concerto', 'Dragonetti concerto', 'Simandl'],
  flute: ['Mozart flute concerto G', 'Fauré fantaisie', 'Bach flute sonata', 'Andersen etudes', 'Doppler fantaisie pastorale'],
  default: ['Bach cello suites', 'Mozart sonata', 'Chopin nocturne', 'Schubert ave maria', 'Debussy clair de lune'],
};
// The instrument's name as the player wrote it when it is "Other".
const instName = () => (S.instrument === 'other' && S.otherName) || INSTRUMENTS[S.instrument].label;
const INST_SELECTS = () => [['#instSel', '#instOtherFind'], ['#tunerInst', '#instOtherTuner'], ['#appInst', '#instOtherApp']];
function fillInstrumentSelects() {
  for (const [sel] of INST_SELECTS()) {
    const s = $(sel);
    s.textContent = '';
    for (const [k, v] of Object.entries(INSTRUMENTS)) { const o = el('option', '', v.label); o.value = k; s.append(o); }
    s.value = S.instrument;
  }
  syncOtherInputs();
}
// "Other" shows a box to type the instrument's name, in each place the instrument is chosen.
function syncOtherInputs(focus) {
  const show = S.instrument === 'other';
  let first = null;
  for (const [, inp] of INST_SELECTS()) {
    const i = $(inp);
    i.hidden = !show;
    if (show && i.value !== (S.otherName || '')) i.value = S.otherName || '';
    if (show && !first) first = i;
  }
  if (show && focus && first && !S.otherName) setTimeout(() => first.focus(), 60);
}
function setOtherName(name) {
  S.otherName = name.trim().slice(0, 30);
  saveSettings();
  for (const [, inp] of INST_SELECTS()) { const i = $(inp); if (document.activeElement !== i && i.value !== S.otherName) i.value = S.otherName; }
  if (currentWork) renderWork(currentWork);
  updateTunerSetup();
}
function setInstrument(k) {
  S.instrument = k; saveSettings();
  for (const [sel] of INST_SELECTS()) $(sel).value = k;
  syncOtherInputs(true);
  renderExamples(); updateTunerSetup();
  if (currentWork) renderWork(currentWork);
}
for (const [sel] of INST_SELECTS()) $(sel).addEventListener('change', (e) => setInstrument(e.target.value));
for (const [, inp] of INST_SELECTS()) $(inp).addEventListener('input', (e) => setOtherName(e.target.value));
function renderExamples() {
  const box = $('#findExamples'); box.textContent = '';
  for (const q of EXAMPLES[S.instrument] || EXAMPLES.default) {
    const b = el('button', '', q);
    b.addEventListener('click', () => { $('#findInput').value = q; $('#findInput')._syncClear?.(); runSearch(); });
    box.append(b);
  }
}
let searchToken = 0;
async function runSearch(typing) {
  const q = $('#findInput').value.trim();
  if (!q) return;
  if (!typing) $('#findInput').blur();
  const token = ++searchToken;
  $('#workView').hidden = true; $('#findList').hidden = false; $('#findIntro').hidden = true;
  const st = $('#findStatus'); st.hidden = false; st.textContent = 'Searching…';
  $('#workList').textContent = '';
  try {
    const res = await searchWorks(q, (early) => { if (token === searchToken) { st.textContent = 'Results'; renderWorkList(early.results, 30); } });
    if (token !== searchToken) return;
    const list = res.results;
    prefetchWorks(list.slice(0, res.browse ? 0 : 3).map((r) => r.title));
    if (!list.length) { st.textContent = 'Nothing found for that. Try the composer’s surname and one word of the title, for example “Fauré élégie”. Newer music may only exist in print:'; renderBuy($('#findBuy'), q); $('#findBuy').hidden = false; return; }
    $('#findBuy').hidden = true;
    st.textContent = res.browse ? `All ${list.length} works by ${res.composer.n}` : (res.composer ? `Works by ${res.composer.n}` : 'Results');
    renderWorkList(list, res.browse ? 80 : 30);
  } catch (e) {
    console.error(e);
    if (token === searchToken) st.textContent = 'The score library did not answer. Check the internet connection and try again.';
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
// results while typing: a short pause is enough (and the composer's works start loading early)
let typeT = 0;
$('#findInput').addEventListener('input', (e) => {
  clearTimeout(typeT);
  const v = e.target.value.trim();
  if (v.length >= 3) {
    parseQuery(v).then((pq) => { if (pq.composer) composerWorks(pq.composer.c).catch(() => {}); });
    typeT = setTimeout(() => { if ($('#findInput').value.trim() === v) runSearch(true); }, 650);
  }
});
$('#findInput').addEventListener('input', (e) => {
  if (e.target.value) return;
  searchToken++; currentWork = null;
  $('#workView').hidden = true; $('#findList').hidden = true; $('#findBuy').hidden = true; $('#findStatus').hidden = true; $('#findIntro').hidden = false;
});
// A clear (×) button in every search field.
for (const input of $$('.search input, #lsQuery, #lsCustom, #lsUrl')) {
  const x = el('button', 'clear-x'); x.type = 'button'; x.setAttribute('aria-label', 'Clear'); x.append(icon('i-close'));
  const wrap = input.closest('.search') ? input.parentElement : (() => { const w = el('span', 'clear-wrap'); input.replaceWith(w); w.append(input); return w; })();
  input.after(x);
  const sync = () => { x.hidden = !input.value; };
  input.addEventListener('input', sync); sync();
  x.addEventListener('pointerdown', (e) => e.preventDefault());
  x.addEventListener('click', () => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); sync(); input.focus(); });
  wrap.classList.add('has-clear');
  input._syncClear = sync;
}

let currentWork = null;
async function openWork(title) {
  $('#findList').hidden = true; $('#workView').hidden = false;
  const { work, composer } = splitTitle(title);
  $('#workTitle').textContent = work; $('#workComposer').textContent = composer;
  $('#workOpen').href = workUrl(title);
  $('#workPicks').textContent = ''; $('#workGroups').textContent = '';
  const st = $('#workStatus'); st.hidden = false; st.textContent = 'Reading the editions…';
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
    st.textContent = 'This piece could not be loaded. Try again, or open the page.';
  }
}
$('#workBack').addEventListener('click', () => { $('#workView').hidden = true; $('#findList').hidden = false; currentWork = null; });

// The edition under its name: who edited or arranged it, the publisher, then pages and downloads.
function fileMeta(f) {
  const bits = [];
  const src = f.arranger ? 'arr. ' + f.arranger : (f.editor && !/first edition|unknown/i.test(f.editor) ? 'ed. ' + f.editor : '');
  if (src) bits.push(src);
  if (f.publisher) bits.push(f.publisher.slice(0, 60));
  if (f.pages) bits.push(f.pages + (f.pages === 1 ? ' page' : ' pages'));
  bits.push(f.downloads.toLocaleString() + ' downloads');
  return bits.join(' · ');
}
const inApp = () => !!(NATIVE && NATIVE.standOpen);
// Preview: the score comes in and opens, with Keep and Remove at the top; left without Keep, it goes.
const PREVIEW = { at: 0, index: null };
function previewLink(f, big) {
  const a = el('a', big ? 'btn' : 'icon-btn');
  a.href = fileUrl(f.index); a.target = '_blank'; a.rel = 'noopener';
  a.append(icon('i-eye'));
  if (big) a.append(el('span', '', 'Preview')); else a.setAttribute('aria-label', 'Preview ' + f.label);
  a.addEventListener('click', (e) => {
    if (!inApp()) return;   // in a browser the score page simply opens
    e.preventDefault();
    const meta = metaFor(f);
    rememberPick(f, meta);
    PREVIEW.at = Date.now(); PREVIEW.index = f.index;
    NATIVE.standOpen.postMessage({ url: fileUrl(f.index), title: meta.title, composer: meta.composer, index: f.index });
    toast('The score opens for a look. Keep it, or it is removed when you close it.', 5000);
  });
  return a;
}
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
      e.preventDefault(); PREVIEW.at = 0;
      NATIVE.standOpen.postMessage({ url: fileUrl(f.index), title: meta.title, composer: meta.composer, index: f.index });
      toast('The score page opens here. Accept the terms if asked; the score then lands on your stand by itself.', 6000);
    } else toast('Accept the terms on the score page to download. Then come back and tap Import score.', 6000);
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
  if (!data.files.length) { st.hidden = false; st.textContent = 'There are no PDF scores for this piece. It may hold only recordings, or the work is still under copyright.'; return; }
  st.hidden = true;
  const pk = $('#workPicks'); pk.textContent = '';
  const sp = splitTitle(data.title);
  const wq = `${sp.composer.split(' ').pop()} ${sp.work.replace(/\(.*?\)/g, '')}`.trim();
  renderBuy($('#workBuy'), wq);
  const wl = $('#workListen'); wl.textContent = ''; wl.append(el('div', 'buy-title', 'Listen to a performance'));
  const sv = el('div', 'services'); renderServices(sv, wq, true); wl.append(sv);
  const whyText = { mine: `Best for ${instName().toLowerCase()}`, score: 'Most downloaded full score', top: 'Most downloaded overall' };
  picks.forEach((p, i) => {
    const c = el('div', 'pick' + (i === 0 ? ' best' : ''));
    const why = el('div', 'why'); why.append(icon('i-star'), document.createTextNode(whyText[p.why])); c.append(why);
    c.append(el('div', 'pl', p.f.label), el('div', 'pm', fileMeta(p.f)));
    const row = el('div', 'pick-btns'); row.append(previewLink(p.f, true), downloadLink(p.f, true)); c.append(row);
    pk.append(c);
  });
  const gbox = $('#workGroups'); gbox.textContent = '';
  const total = data.files.length;
  const det = el('details', 'all-editions'); det.append(el('summary', '', `All editions (${total})`));
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
        if (f.mine) lab.append(el('span', 'tag', 'For ' + instName().toLowerCase()));
        if (f.index === mostDownloaded) lab.append(el('span', 'tag top', 'Most downloaded'));
        if (/non-pd|copyright/i.test(f.copyright) && !/public domain/i.test(f.copyright)) lab.append(el('span', 'tag', 'Check copyright'));
        main.append(lab, el('div', 'f-meta', fileMeta(f)));
        li.append(main, previewLink(f, false), downloadLink(f, false));
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

// Where you are (the score and its page), so that if the page ever has to start again (iOS short
// of memory), it opens again right there instead of in the library.
function rememberPlace() { try { if (V.score && !V.score.preview) localStorage.setItem('standPlace', JSON.stringify({ id: V.score.id, page: V.page, t: Date.now() })); } catch {} }
async function reopenPlace() {
  let p = null; try { p = JSON.parse(localStorage.getItem('standPlace') || 'null'); } catch {}
  if (!p || !p.id || Date.now() - (p.t || 0) > 6 * 3600e3 || !scores.some((x) => x.id === p.id)) return;
  await openScore(p.id, { page: () => p.page || 0 });
  toast('Stand had to start again: you are back where you were.', 3000);
}
// iOS short of memory: what can be drawn again later goes now (pages away from the one on screen,
// the score kept for the iPhone when it is not being sent)
window.standMemoryLow = () => {
  try {
    const keep = new Set(V.pages.map((p) => p.art));
    for (const [k, pr] of [...V.cache.entries()]) pr.then((c) => { if (!keep.has(c)) { V.cache.delete(k); INCACHE.delete(c); freeCanvas(c); } }, () => {});
  } catch {}
  try { if (PH.doc && Date.now() - PH.t > 5000) phoneDocClose(); } catch {}
};
async function openScore(id, opts = {}) {
  if (LIB.editing) setLibEditing(false);
  const peek = scores.find((x) => x.id === id) || await db.get('scores', id);
  if (peek && peek.kind === 'comp') { openComposition(id); return; }
  const token = V.openToken = (V.openToken || 0) + 1;
  // the next score of a set or a practice session, already opened while the one before was played
  const pre = RUNPRE && RUNPRE.sid === id ? await RUNPRE.open.catch(() => null) : null;
  if (RUNPRE && RUNPRE.sid === id) RUNPRE = null;
  const score = pre ? pre.score : await db.get('scores', id);
  const file = pre ? pre.file : score && await db.get('files', score.fileId);
  if (!file) { toast('This score’s file is missing.'); return; }
  if (!pre) scoreFile(score, file);   // (pages added from other files, pages turned)
  let base = pre ? pre.base : null;
  if (!base) try { base = await openDocument(file, score.sizes); } catch (e) { console.error(e); toast('The score could not be opened.'); return; }
  if (token !== V.openToken) { base.destroy(); return; }   // the user went back, or opened another score
  // keep the page sizes, so the next opening is quicker
  if (base.sizes && !base.paper) { const k = sizesKey(file); if (!score.sizes || score.sizes.k !== k) score.sizes = { k, v: (base.rawSizes || base.sizes).map((x) => [Math.round(x[0] * 100) / 100, Math.round(x[1] * 100) / 100]) }; }
  if (V.base) try { V.base.destroy(); } catch {}
  V.score = score; V.file = file; V.base = base; V.doc = mapDoc(base, score.pageMap, score.cuts, score.glue);
  LY.active = ''; setActiveLayer(''); syncLayerUi(); closeAllNotes();
  $('#previewBar').hidden = !score.preview;
  follow.reset();
  clearCache(); READY.clear(); V.splits.clear(); V.undo = []; V.redo = []; V.half = false; V.usedJumps = new Set();
  V.crop = score.trim && score.trimBox ? score.trimBox : null;
  Z.s = 1; Z.x = 0; Z.y = 0;
  V.page = clamp(opts.page ? opts.page() : score.lastPage || 0, 0, V.doc.pages - 1);
  score.opened = Date.now(); db.put('scores', score);
  rememberPlace();
  hidePanel(); clearSelection();
  if (file.kind === 'paper') setTimeout(() => sectionTour('notebook', { force: true }), 600);
  else if (!opts.page) setTimeout(() => { if (!$('#score').hidden && !openPanel) sectionTour('score', { force: true }); }, 900);
  $('#library').hidden = true; $('#score').hidden = false; document.body.classList.remove('at-home');
  $('#score').dataset.paper = S.paper; setPaperColor(PAPER_COLOR[S.paper] || '#fff');
  $('#scoreTitle').textContent = score.title;
  updateScrub();
  if (score.metro) applyMetroSettings(score.metro);
  showChrome(true);
  try { await layout(); } catch (e) { if (token === V.openToken) console.warn(e); }
  if (token !== V.openToken) return;   // (gone back to the library meanwhile)
  keepAwake();
  follow.sync();
  practice.scoreOpened(score.id);
  loadRef(score);
  $('#score').classList.toggle('nbmode', !!base.paper);
  if (base.paper) setInking(true);
  else chromeTimer = setTimeout(() => showChrome(false), 2500);
}
function updateScrub() { $('#pageRange').max = V.doc.pages; $('#pageScrub').hidden = V.doc.pages < 3; }
const step0 = (fn) => { try { fn(); } catch (e) { console.warn(e); } };
async function closeScore() {
  V.openToken = (V.openToken || 0) + 1;     // cancels a score that is still opening
  // Show the library first, so going home always works even if a clean-up step fails.
  const sc = V.score;
  if (RUN.on) endRun();
  $('#score').hidden = true; $('#library').hidden = false; document.body.classList.add('at-home');
  try { localStorage.removeItem('standPlace'); } catch {}
  step0(() => finishTextBox());
  const step = (fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.warn(e)); } catch (e) { console.warn(e); } };
  step(() => finishText(true));
  step(() => practice.scoreClosed());
  step(() => { ref.pause(); loadRef(null); });
  step(() => setInking(false));
  step(() => { hidePanel(); clearSelection(); });
  step(() => { if (V.perform) setPerform(false); follow.sync(); });
  step(() => { showChrome(true); Z.s = 1; Z.x = 0; Z.y = 0; });
  step(() => flushInk());
  if (sc) dropEdited(sc.id);   // (the score is written just now, with its time)
  if (sc && sc.preview) {
    // (a preview written on is not thrown away without asking)
    // (written on: asked; anything but a clear "Don't Keep", a tap beside the question too, keeps it)
    const marked = (await db.keys('ink').catch(() => [])).some((k) => String(k).startsWith(sc.id + ':'));
    if (marked && !(await ask('Keep this score?', { ok: 'Don’t Keep', cancel: 'Keep', danger: true, sub: 'You have written on it. If you don’t keep it, it goes with its markings.' }))) { delete sc.preview; sc.lastPage = V.page; await db.put('scores', sc).catch(() => {}); toast('Added: ' + label(sc), 2500); }
    else { await deleteScoreData(sc).catch(() => {}); toast('Preview closed. The score was not kept.', 2500); }
  }
  else if (sc) { sc.lastPage = V.page; await db.put('scores', sc).catch(() => {}); }
  $('#previewBar').hidden = true;
  step(() => freePages());
  step(() => { for (const p of V.cache.values()) p.then(freeCanvas, () => {}); });
  step(() => { if (V.base) V.base.destroy(); });
  V.base = null; V.doc = null; V.score = null; V.cache.clear(); READY.clear(); INCACHE.clear(); stage.textContent = '';
  step(() => { wakeLock && wakeLock.release(); });
  wakeLock = null;
  refreshLibrary();
}
$('#backBtn').addEventListener('click', closeScore);
$('#previewKeep').addEventListener('click', async () => {
  const sc = V.score; if (!sc) return;
  delete sc.preview; await db.put('scores', sc); $('#previewBar').hidden = true;
  toast('Added: ' + label(sc), 2500); refreshLibrary();
});
$('#previewRemove').addEventListener('click', closeScore);

// iOS keeps canvas memory until a canvas is shrunk; release what is no longer shown.
function clearCache() { for (const p of V.cache.values()) p.then((c) => { INCACHE.delete(c); setTimeout(() => freeCanvas(c), 2000); }, () => {}); V.cache.clear(); }
function freeCanvas(c) { if (c && !c.isConnected) { c.width = 0; c.height = 0; } }
function freePages() { for (const p of V.pages) if (p.ink) { p.ink.width = 0; p.ink.height = 0; } V.pages = []; }

// Turned score: the page is drawn a quarter turn anticlockwise so that a landscape page fills an upright screen.
// Every page position is still in the page's own frame (fx along its width, fy along its height), so
// the helpers below turn screen points into page fractions and back.
const TURN = () => !!S.turnScore;
function fracOf(x, y, r) {
  return TURN() ? [1 - (y - r.top) / r.height, (x - r.left) / r.width] : [(x - r.left) / r.width, (y - r.top) / r.height];
}
function screenOf(fx, fy, r) {
  return TURN() ? [r.left + fy * r.width, r.top + (1 - fx) * r.height] : [r.left + fx * r.width, r.top + fy * r.height];
}
// size of a page box on screen, in page units (width, height)
function pageSize(r) { return TURN() ? [r.height, r.width] : [r.width, r.height]; }

function spreadSize() {
  const r = stage.getBoundingClientRect();
  // One page at a time: forced by the setting; otherwise two pages only when the iPad is landscape.
  return !TURN() && !S.onePage && S.twoUp && r.width > r.height * 1.05 && V.doc && V.doc.pages > 1 ? 2 : 1;
}
// The part of a page on show: its own crop, else the trimmed margins, cut to its piece.
function cropOf(i, forFile) {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  // side by side in landscape, wide white margins are left out so the music fills the screen
  // (only on screen: a file made from the score keeps its pages whole, however the iPad is held)
  const auto = !forFile && V.spread === 2 && S.fillScreen !== false && V.score && V.score.autoBox ? V.score.autoBox : null;
  if (!V.doc || i === undefined) return V.crop || auto || full;
  const o = V.doc.orig(i);
  let c = (V.score && V.score.crops && V.score.crops[o]) || V.crop || auto || full;
  if (V.doc.composite && V.doc.composite(i)) return { x: c.x, w: c.w, y: 0, h: 1 };
  const pc = V.doc.piece ? V.doc.piece(i) : null;
  if (pc) {
    const y0 = Math.max(c.y, pc.y), y1 = Math.min(c.y + c.h, pc.y + pc.h);
    c = { x: c.x, w: c.w, y: y1 - y0 > 0.02 ? y0 : pc.y, h: y1 - y0 > 0.02 ? y1 - y0 : pc.h };
  }
  return c;
}
// Size on screen of each page box (cropped when trimming margins).
// the whole page's size on screen for a page shown in a box (bigger when its margins are trimmed)
const innerW = (i, bw) => Math.round(bw / cropOf(i).w), innerH = (i, bh) => Math.round(bh / cropOf(i).h);
function pageBox(indices) {
  const r0 = stage.getBoundingClientRect();
  const r = TURN() ? { width: r0.height, height: r0.width } : r0;   // turned: fit the page to the swapped screen
  const pad = indices.length > 1 ? 2 : 4, gap = indices.length > 1 ? 2 : 0;
  const ratios = indices.map((i) => { const c = cropOf(i); return (V.doc.sizes[i][0] * c.w) / (V.doc.sizes[i][1] * c.h); });
  const sum = ratios.reduce((a, b) => a + b, 0);
  const h = Math.min(r.height - pad * 2, (r.width - pad * 2 - gap) / sum);
  return ratios.map((q) => [Math.floor(h * q), Math.floor(h)]);
}
// the largest page picture drawn: an iPhone has far less memory than an iPad (a zoomed page at
// 12 million pixels takes 48 MB, and several are kept)
const MAX_PX_IPAD = 8e6, MAX_PX_PHONE = 4e6;
const maxPx = () => (document.body.classList.contains('phone') ? MAX_PX_PHONE : MAX_PX_IPAD);
// Drawing pages: the pages on screen always come first. Pages drawn ahead of time (the next turn),
// and margin measuring, wait until nothing urgent is being drawn, and go one at a time, so they
// never hold up the page you are looking at. One asked for urgently jumps the queue.
const RQ = { busy: 0, q: [], seq: 0, t: 0, running: new Set() };
function rqPump() {
  RQ.q.sort((a, b) => a.prio - b.prio || a.t - b.t);
  // urgent work stops drawing that is no longer needed or not urgent (it is asked for again later)
  if (RQ.q.some((j) => j.prio === 0)) for (const r of RQ.running) if (r.prio > 0) r.ctl.abort();
  // and the next turn's pages come before quiet drawing further ahead (which is asked again later)
  if (RQ.q.some((j) => j.prio === 1)) for (const r of RQ.running) if (r.prio > 1 && r.retry) r.ctl.abort();
  for (const r of RQ.running) if (r.skip && r.skip()) r.ctl.abort();
  while (RQ.q.length) {
    const j = RQ.q[0];
    if (j.prio > 0 && RQ.busy > 0) return;
    RQ.q.shift();
    if (j.skip && j.skip()) { j.res(null); continue; }
    RQ.busy++; RQ.running.add(j);
    Promise.resolve().then(() => j.fn(j.ctl)).then(j.res, j.rej).finally(() => { RQ.busy--; RQ.running.delete(j); rqPump(); });
    if (j.prio > 0) return;
  }
}
const newCtl = () => { const c = { aborted: false, fns: [], abort() { if (c.aborted) return; c.aborted = true; for (const f of c.fns) try { f(); } catch {} } }; return c; };
function rqAdd(prio, fn, skip, retry = false) {
  let job;
  const p = new Promise((res, rej) => { job = { prio, fn, res, rej, skip, retry, t: ++RQ.seq, ctl: newCtl() }; });
  p.job = job; RQ.q.push(job);
  // urgent work starts at once; the rest a moment later, so urgent work asked for in the same
  // moment (the page on screen) is never stuck behind it
  if (prio === 0) rqPump(); else { clearTimeout(RQ.t); RQ.t = setTimeout(rqPump, 40); }
  return p;
}
function pageKey(i, w, h, zoom = 1) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let pw = w * dpr * zoom, ph = h * dpr * zoom;
  if (pw * ph > maxPx()) { const k = Math.sqrt(maxPx() / (pw * ph)); pw *= k; ph *= k; }
  return { key: i + '|' + Math.round(pw) + 'x' + Math.round(ph), pw, ph };
}
// The last drawing of each page, by page: shown at once while a sharper one (a new size) is drawn.
const READY = new Map();
const INCACHE = new Set();   // canvases the cache still holds (never emptied while kept)
function renderPage(i, w, h, zoom = 1, prio = 0) {
  const { key, pw, ph } = pageKey(i, w, h, zoom);
  if (V.cache.has(key)) {
    const v = V.cache.get(key); V.cache.delete(key); V.cache.set(key, v);
    if (prio === 0 && v.job && v.job.prio > 0) { v.job.prio = 0; v.job.skip = null; if (RQ.q.includes(v.job)) rqPump(); }
    return v;
  }
  const canvas = el('canvas', 'art');
  const doc = V.doc;
  // a page drawn ahead is skipped if the reader has gone elsewhere meanwhile
  // a page drawn ahead (or one turned past quickly) is skipped, or stopped, if the reader has gone elsewhere
  const skip = prio > 0 ? () => V.doc !== doc || (prio === 1 && Math.abs(i - V.page) > 4) : () => V.doc !== doc || i < V.page - 2 || i > V.page + 3;
  const p = rqAdd(prio, (ctl) => doc.render(i, canvas, pw, ph, { ctl }).then(() => (ctl.aborted ? null : canvas), (e) => { if (ctl.aborted) return null; throw e; }), skip);
  p.then((c) => {
    if (!c) { if (V.cache.get(key) === p) V.cache.delete(key); return; }
    if (V.cache.get(key) === p) INCACHE.add(c);
    if (V.doc === doc && zoom === 1) READY.set(i, { c, key, doc });
  }, () => { if (V.cache.get(key) === p) V.cache.delete(key); });
  V.cache.set(key, p);
  // kept: a few pages, and never more pixels in all than the device can spare (zoomed pages are big:
  // a few of them used to fill the memory and iOS closed Stand)
  const phone = document.body.classList.contains('phone');
  const pxOf = (k) => { const m = /\|(\d+)x(\d+)/.exec(k); return m ? m[1] * m[2] : 0; };
  let total = 0; for (const k of V.cache.keys()) total += pxOf(k);
  while (V.cache.size > 2 && (V.cache.size > (phone ? 4 : 6) || total > (phone ? 8e6 : 20e6))) { const k = V.cache.keys().next().value; total -= pxOf(k); const old = V.cache.get(k); V.cache.delete(k); old.then((c) => { INCACHE.delete(c); freeCanvas(c); }, () => {}); }
  return p;
}
// A drawing of page i that can be shown straight away (another size), or null.
function staleFor(i, key) {
  const r = READY.get(i);
  if (!r || r.doc !== V.doc || r.key === key || !r.c || !r.c.width) return null;
  return r.c;
}
let layoutToken = 0;
async function layout(fade) {
  if (!V.doc) return;
  const token = ++layoutToken;
  V.spread = spreadSize();
  if (V.spread === 2 && S.fillScreen !== false && V.score && V.score.autoBox === undefined) measureMargins();
  follow.pages();
  if (V.spread === 2) V.half = false;
  clearSelection();
  const spread = el('div', 'spread');
  const entries = [];
  let label;
  const makeBox = (bw, bh, c = cropOf(V.page)) => {
    const pg = el('div', 'pg'); pg.style.width = bw + 'px'; pg.style.height = bh + 'px';
    const inner = el('div', 'pgi');
    // whole pixels: the page picture and its markings then sit exactly on the screen's pixels (a
    // trimmed page at a fraction of a pixel is redrawn blurred by the iPad)
    const iw = Math.round(bw / c.w), ih = Math.round(bh / c.h);
    inner.style.width = iw + 'px'; inner.style.height = ih + 'px';
    inner.style.left = -Math.round(c.x * iw) + 'px'; inner.style.top = -Math.round(c.y * ih) + 'px';
    pg.append(inner);
    return { pg, inner, iw, ih };
  };
  if (V.half && V.page + 1 <= lastPg()) {
    const [box] = pageBox([V.page]);
    const b = makeBox(box[0], box[1]);
    const [cur, next] = await Promise.all([renderPage(V.page, b.iw, b.ih), renderPage(V.page + 1, b.iw, b.ih)]);
    if (token !== layoutToken) return;
    const key = V.page + ':' + cur.width;
    if (!V.splits.has(key)) V.splits.set(key, findSplit(cur, next));
    const saved = V.score.halfSplit && V.score.halfSplit[V.doc.orig(V.page)];
    const split = saved !== undefined && saved !== null ? saved : V.splits.get(key);
    // the top of the next page above the line, the rest of this page below it: two separate
    // windows, so the pages can never show through each other
    cur.className = 'art'; next.className = 'art';
    const topClip = el('div', 'half-clip'), botClip = el('div', 'half-clip');
    // (and each page's markings over it, to be seen: writing turns the half page off)
    const inkOf = (i, cv) => { const ink = el('canvas', 'ink'); ink.width = cv.width; ink.height = cv.height; const L = new InkLayer(ink, V.score.id, V.doc.composite && V.doc.composite(i) ? `${V.doc.orig(i)}+${V.doc.gluedFrom(i)}` : V.doc.orig(i)); void L; return ink; };
    const nextInk = inkOf(V.page + 1, next), curInk = inkOf(V.page, cur);
    for (const [cv, clip, ink] of [[next, topClip, nextInk], [cur, botClip, curInk]]) for (const c of [cv, ink]) { c.style.width = b.iw + 'px'; c.style.height = b.ih + 'px'; c.style.inset = 'auto'; c.style.left = '0'; clip.append(c); }
    const place = (f) => { topClip.style.top = '0'; topClip.style.height = (f * 100) + '%'; next.style.top = '0'; nextInk.style.top = '0'; botClip.style.top = (f * 100) + '%'; botClip.style.bottom = '0'; cur.style.top = (-f * b.ih) + 'px'; curInk.style.top = (-f * b.ih) + 'px'; };
    place(split); V.halfAt = split;
    const line = el('div', 'half-line'); line.style.top = (split * 100) + '%';
    const tag = el('div', 'half-tag', `↑ page ${V.page + 2}   ·   page ${V.page + 1} ↓`); tag.style.top = (split * 100) + '%';
    // drag the line up or down to see more or less of the next page; it settles between systems
    const grab = el('button', 'half-grab'); grab.setAttribute('aria-label', 'Drag to show more or less of the next page'); grab.style.top = (split * 100) + '%';
    grab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const setSplit = (f) => { V.halfAt = f; const v = (f * 100).toFixed(2) + '%'; place(f); line.style.top = v; tag.style.top = v; grab.style.top = v; };
    let drag = null;
    grab.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); try { grab.setPointerCapture(e.pointerId); } catch {} drag = { r: b.inner.getBoundingClientRect() }; grab.classList.add('on'); });
    grab.addEventListener('pointermove', (e) => { if (!drag) return; e.stopPropagation(); const f = clamp((TURN() ? 1 - (e.clientX - drag.r.left) / drag.r.width : (e.clientY - drag.r.top) / drag.r.height), 0.06, 0.94); drag.f = f; setSplit(f); });
    const endDrag = (e) => {
      if (!drag) return; e.stopPropagation(); grab.classList.remove('on');
      const f = drag.f; drag = null; if (f === undefined) return;
      if (!V.gaps) V.gaps = new Map();
      if (!V.gaps.has(key)) V.gaps.set(key, commonGaps(cur, next));
      const gaps = V.gaps.get(key);
      // the nearest clean gap between systems, if one is close
      let best = null; for (const gp of gaps) if (Math.abs(gp.mid - f) < 0.09 && (!best || Math.abs(gp.mid - f) < Math.abs(best.mid - f))) best = gp;
      const to = best ? best.mid : f;
      setSplit(to);
      V.score.halfSplit = { ...(V.score.halfSplit || {}), [V.doc.orig(V.page)]: +to.toFixed(4) };
      db.put('scores', V.score);
    };
    grab.addEventListener('pointerup', endDrag); grab.addEventListener('pointercancel', endDrag);
    b.inner.append(botClip, topClip, line, tag, grab);
    spread.append(b.pg);
    label = `${V.page + 1}½`;
  } else {
    V.half = false;
    const idx = [V.page]; if (V.spread === 2 && V.page + 1 <= lastPg()) idx.push(V.page + 1);
    // two pieces of one page are never side by side (they share their markings)
    if (idx.length === 2 && V.doc.orig(idx[0]) === V.doc.orig(idx[1])) idx.pop();
    const boxes = pageBox(idx);
    const made = boxes.map(([bw, bh], k) => makeBox(bw, bh, cropOf(idx[k])));
    // A page already drawn at another size (margins measured, the screen turned) is shown at
    // once, and swapped for the sharp one when it is ready.
    const proms = idx.map((i, k) => renderPage(i, made[k].iw, made[k].ih));
    prefetch(token);   // queued now, so it comes straight after these and before anything else
    const stale = idx.map((i, k) => staleFor(i, pageKey(i, made[k].iw, made[k].ih).key));
    const quick = await Promise.all(proms.map((p, k) => (stale[k] ? Promise.race([p, new Promise((r) => setTimeout(() => r(null), 30))]) : p)));
    if (token !== layoutToken) return;
    const canvases = quick.map((c, k) => c || stale[k]);
    // a drawing stopped on the way (very quick turning): asked for again
    if (canvases.some((c) => !c)) { if (!layout.retry) { layout.retry = true; setTimeout(() => { layout.retry = false; if (token === layoutToken) layout(); }, 0); } return; }
    idx.forEach((i, k) => {
      const b = made[k];
      const art = canvases[k]; art.className = 'art';
      if (!quick[k]) proms[k].then((sharp) => {
        const e = V.pages.find((x) => x.art === art);
        if (!sharp || !e || token !== layoutToken) return;
        sharp.className = 'art'; e.inner.replaceChild(sharp, art); e.art = sharp;
        e.layer.resize(sharp.width, sharp.height);
        if (!INCACHE.has(art)) freeCanvas(art);
      }, () => {});
      const ink = el('canvas', 'ink'); ink.width = art.width; ink.height = art.height;
      b.inner.append(art, ink); spread.append(b.pg);
      const layer = new InkLayer(ink, V.score.id, V.doc.composite && V.doc.composite(i) ? `${V.doc.orig(i)}+${V.doc.gluedFrom(i)}` : V.doc.orig(i));
      const entry = { index: i, orig: V.doc.orig(i), pg: b.pg, inner: b.inner, art, ink, layer, iw: b.iw, ih: b.ih };
      layer.onItems = () => renderNotes(entry);   // (the notes on the page follow its markings)
      entries.push(entry);
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
  syncPaperPlus();
  $('#pageRange').value = V.page + 1;
  prefetch(token);
}
// The next pages (and the ones before) are drawn ahead, after the pages on screen.
function prefetch(token) {
  if (token !== layoutToken || !V.doc) return;
  for (const start of [V.page + V.spread, V.page - V.spread]) {
    if (start < 0 || start >= V.doc.pages) continue;
    const ids = [start]; if (V.spread === 2 && start + 1 <= lastPg()) ids.push(start + 1);
    pageBox(ids).forEach((b, k) => renderPage(ids[k], innerW(ids[k], b[0]), innerH(ids[k], b[1]), 1, 1));
  }
  clearTimeout(WARM.t); WARM.t = setTimeout(() => warmAhead(token), 2500);
}
// A little further ahead, slow pages (scans) are drawn once, quietly, and kept as pictures, so
// turning several pages quickly never waits. Only when nothing else is being drawn.
const WARM = { t: 0, tried: new Set() };
async function warmAhead(token) {
  const doc = V.doc;
  if (token !== layoutToken || !doc || !doc.pixHas || document.hidden) return;
  // the pages ahead first, then the rest of the score (once each, kept as pictures: after that every
  // page of this score opens at once). Any page you ask for stops this and comes first.
  // Only a few pages each way, and never while a panel is open (the Pages panel draws every page
  // itself): drawing a whole long score in the background used up the iPhone's memory.
  if (document.querySelector('.panel:not([hidden])')) { clearTimeout(WARM.t); WARM.t = setTimeout(() => warmAhead(token), 4000); return; }
  const ahead = document.body.classList.contains('phone') ? 6 : 12, behind = document.body.classList.contains('phone') ? 2 : 4;
  const starts = [];
  for (let st0 = V.page + 2 * V.spread; st0 < Math.min(doc.pages, V.page + 2 * V.spread + ahead); st0 += V.spread) starts.push(st0);
  for (let st0 = V.page - V.spread * 2; st0 >= Math.max(0, V.page - V.spread * 2 - behind); st0 -= V.spread) starts.push(st0);
  for (const start of starts) {
    const ids = [start]; if (V.spread === 2 && start + 1 <= lastPg()) ids.push(start + 1);
    const boxes = pageBox(ids);
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k];
      const { key, pw, ph } = pageKey(i, innerW(i, boxes[k][0]), innerH(i, boxes[k][1]));
      const tag = doc.orig(i) + '|' + key;
      if (WARM.tried.has(tag) || V.cache.has(key)) continue;
      if (await doc.pixHas(i, pw, ph)) { WARM.tried.add(tag); continue; }
      if (token !== layoutToken) return;
      WARM.tried.add(tag);
      rqAdd(2, async (ctl) => {
        const c = document.createElement('canvas');
        try { await doc.render(i, c, pw, ph, { ctl }); if (ctl.aborted) WARM.tried.delete(tag); } catch { WARM.tried.delete(tag); } finally { c.width = c.height = 0; }
      }, () => V.doc !== doc || !!document.querySelector('.panel:not([hidden])'), true).catch(() => {});
    }
  }
}
function goTo(page, fade = true) {
  if (!V.doc) return;
  // (the eyes' model, when it shares this thread, waits while the page is drawn)
  globalThis.__busyUntil = performance.now() + 700;
  V.page = clamp(page, 0, V.doc.pages - 1); V.half = false; V.score.lastPage = V.page;
  rememberPlace();
  if (V.page === 0) V.usedJumps.clear();
  layout(fade);
}
function turn(dir) {
  if (!V.doc) return;
  // text being typed is kept (and its box closed) before the page changes
  if (typeof tbEdit !== 'undefined' && tbEdit) finishTextBox();
  if (typeof textEdit !== 'undefined' && textEdit) finishText();
  // in a set or a practice session: past the last page goes on to the next part, maybe in another score
  const rr = RUN.on ? runRange() : null;
  if (rr) {
    const halfLeft = S.halfTurn && V.spread === 1 && !V.inking && !V.half && V.page + 1 <= rr[1];
    if (dir > 0 && V.page + (V.spread === 2 ? 1 : 0) >= rr[1] && !halfLeft) { runGo(RUN.idx + 1); return; }
    if (dir < 0 && V.page <= rr[0] && !V.half) { runGo(RUN.idx - 1, true); return; }
  } else if (RUN.busy) return;
  if (dir > 0) {
    const last = V.page + (V.spread === 2 ? 1 : 0);
    const jumps = V.score.jumps || [];
    const j = jumps.find((x, i) => x.from - 1 >= V.page && x.from - 1 <= last && !(x.once && V.usedJumps.has(i)) && (!rr || (x.to - 1 >= rr[0] && x.to - 1 <= rr[1])));
    if (j && !V.half) {
      const i = jumps.indexOf(j); if (j.once) V.usedJumps.add(i);
      toast(`Jump to page ${j.to}`, 1400);
      goTo(j.to - 1);
      return;
    }
  }
  if (S.halfTurn && V.spread === 1 && !V.inking) {
    if (dir > 0) {
      if (!V.half && V.page + 1 <= lastPg()) { V.half = true; layout(true); return; }
      if (V.half) { goTo(V.page + 1); return; }
      return;
    }
    if (V.half) { V.half = false; layout(true); return; }
  }
  const next = clamp(V.page + dir * V.spread, rr ? rr[0] : 0, rr ? rr[1] : Math.max(0, V.doc.pages - 1));
  if (next === V.page) return;
  goTo(next);
}
window.standTurn = turn;
// (the keyboard coming up for typed words changes only the height: the pages are left as they are,
// so the words being typed are not lost)
let resizeT, lastW = window.innerWidth;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
  const ae = document.activeElement;
  const typing = (typeof textEdit !== 'undefined' && textEdit) || (typeof tbEdit !== 'undefined' && tbEdit) || !!(ae && ae.closest && ae.closest('.snote') && /^(TEXTAREA|INPUT)$/.test(ae.tagName));
  const sameW = window.innerWidth === lastW; lastW = window.innerWidth;
  if (V.doc && !(typing && sameW)) { clearCache(); layout(); }
  sizeLive();
}, 150); });
$('#pageRange').addEventListener('input', (e) => goTo(+e.target.value - 1, false));

let chromeTimer;
function showChrome(on) { clearTimeout(chromeTimer); if (V.perform) on = false; if (document.body.classList.contains('touring')) on = true; if ($('#score').classList.contains('nbmode')) on = true; $('#score').classList.toggle('chrome-off', !on); }
// ---------- turning pages by listening ----------
const follow = {
  inst: null,
  get wanted() { return !!(S.followTurn && V.doc && !$('#score').hidden); },
  make() {
    if (this.inst) return this.inst;
    this.inst = window.__follower = new PageFollower({
      render: (i, c, w) => { const [pw, ph] = V.doc.sizes ? V.doc.sizes[i] || [595, 842] : [595, 842]; return V.doc.render(i, c, w, Math.round(w * ph / pw)); },
      pages: () => (V.doc ? V.doc.pages : 0),
      turn: () => { if (V.doc && !$('#score').hidden) turn(1); },
      onState: (txt, hear) => { $('#followText').textContent = txt; $('#followBadge').classList.toggle('hear', !!hear); },
      half: () => (V.half ? V.halfAt ?? 0.5 : null),
      halfWanted: () => !!(S.halfTurn && V.spread === 1 && !V.inking),
      gaze: () => eyes.onPage(),
      when: () => followAt(),
      // (only a clarinet — or an instrument of your own — may sound other than written)
      fixedShift: () => (S.instrument === 'clarinet' || S.instrument === 'other' ? null : 0),
      // each page read once for good (until the score is changed): opening it again costs nothing
      store: {
        key: (i) => (V.score ? `follow:${V.score.id}:${pagesStamp(V.score)}:${i}` : null),
        async get(i) { const k = this.key(i); if (!k) return null; const f = await db.get('files', k); return f && f.r; },
        async put(i, r) {
          const k = this.key(i); if (!k) return;
          await db.put('files', { id: k, kind: 'follow', r, at: Date.now() });
          // (the readings of the score before it was changed go)
          const pre = `follow:${V.score.id}:`, mine = k.slice(0, k.lastIndexOf(':') + 1);
          if (FOLLOW_CLEANED.has(mine)) return; FOLLOW_CLEANED.add(mine);
          for (const x of (await db.keys('files').catch(() => [])).map(String)) if (x.startsWith(pre) && !x.startsWith(mine)) await db.del('files', x).catch(() => {});
        },
      },
      // the eyes put right while playing: a little of how far above or below the playing they are
      gazeOff: (dn) => {
        const g = eyes.gaze; if (!g || !g.cal) return;
        const r = $$('#stage .spread .pgi')[0]; if (!r) return;
        const h = r.getBoundingClientRect().height, lim = innerHeight * 0.3;
        g.cal = { ...g.cal, dy: clamp((g.cal.dy || 0) - dn * h * 0.05, -lim, lim) };
      },
    });
    return this.inst;
  },
  sync() {
    $('#followBadge').hidden = !this.wanted;
    if (this.wanted) { const f = this.make(); f.start(); this.pages(); }
    else if (this.inst) this.inst.stop();
    eyes.sync();
  },
  pages() { if (this.inst && this.inst.on && V.doc) this.inst.setPages(V.page, Math.min(V.doc.pages - 1, V.page + (V.spread === 2 ? 1 : 0))); },
  reset() { if (this.inst) this.inst.reset(); },
};
// ---------- following the eyes (a hint for turning pages by listening) ----------
// The front camera, a face model and a short calibration give roughly where on the screen the eyes
// are; mapped onto the pages on show, the follower takes it as a hint. While it runs it also sees
// winks (with both eyes in view), in place of the iPad's own face tracking, which needs the same
// camera.
const EYES_ON = !!globalThis.__eyesOn;
const eyes = {
  gaze: null, wink: null, running: false,
  orient() { return innerWidth > innerHeight ? 'land' : 'port'; },
  cal() { const c = S.eyesCal && S.eyesCal[this.orient()]; return c && Math.abs(c.w - innerWidth) < 40 && Math.abs(c.h - innerHeight) < 40 ? c : null; },
  // (set aside: the listening turns well by itself, and while the camera was used for the eyes the
  // winks were judged here, more slowly than by the iPad. EYES_ON brings it back.)
  get wanted() { return !!(EYES_ON && follow.wanted && S.followEyes && this.cal() && Gaze.supported()); },
  async sync() {
    if (this.wanted && !this.running) {
      this.running = true;
      if (!this.gaze) this.gaze = new Gaze();
      this.gaze.cal = this.cal();
      sendFace();
      const ok = await this.gaze.start();
      // (not an error when it was turned off meanwhile)
      if (!ok) { this.running = false; sendFace(); if (this.gaze.err && this.wanted) toast('Could not follow the eyes: ' + this.gaze.err); return; }
      if (!this.unsub) this.unsub = this.gaze.onSample((smp) => this.sample(smp));
    } else if (!this.wanted && this.running) {
      this.running = false; if (this.gaze && !EC.on) this.gaze.stop(); sendFace();   // (the set-up still uses the camera)
      // (turned off altogether: the face model's memory goes too)
      if (this.gaze && !(S.followTurn && S.followEyes) && !EC.on) this.gaze.dispose();
    }
    if (this.running && this.gaze) { this.gaze.cal = this.cal(); if (!EC.on) this.gaze.fast = !!S.wink; }   // (winks need every frame)
  },
  sample(smp) {
    // winks, while the camera is ours
    if (S.wink && !$('#score').hidden) {
      if (!this.wink) this.wink = new WinkDetector((eye) => winkFound(eye, 'camera'));
      this.wink.sens = S.winkSens || 0.7;
      this.wink.feed(smp);
    }
  },
  // where the eyes are on the pages on show: { page, xn, yn (0..1 on the page), q, sig }
  onPage() {
    const g = this.running && this.gaze && this.gaze.last;
    if (!g || !(g.quality > 0) || performance.now() - g.t > 400 || g.x === undefined) return null;
    const inners = $$('#stage .spread .pgi');
    for (let k = 0; k < inners.length; k++) {
      const r = inners[k].getBoundingClientRect();
      if (g.x < r.left - r.width * 0.04 || g.x > r.right + r.width * 0.04 || g.y < r.top - r.height * 0.04 || g.y > r.bottom + r.height * 0.04) continue;
      const xn = clamp((g.x - r.left) / r.width, 0, 1), yn = clamp((g.y - r.top) / r.height, 0, 1);
      let page = V.page + k;
      // half a page: the top of the next page above the line
      if (V.half && yn < (V.halfAt ?? 0.5)) page = V.page + 1;
      const c = this.gaze.cal || {}, err = c.errY || (c.err ? c.err * 0.75 : 120);
      return { page, xn, yn, q: g.quality, sig: clamp((err / r.height) * 0.9, 0.05, 0.25) };
    }
    return null;
  },
};
window.__eyes = eyes;
$('#followEyes').addEventListener('change', (e) => {
  S.followEyes = e.target.checked; saveSettings(); syncEyesUI();
  if (S.followEyes && !eyes.cal()) openEyeCal(); else follow.sync();
});
function syncEyesUI() {
  $('#followBody').hidden = !S.followTurn;
  const w = followAt();
  $('#followAt').value = Math.round(w * 100);
  $('#followAtMark').style.left = `calc(${w * 100}% + ${(3 - w * 6).toFixed(1)}px)`;   // (kept inside the frame at both ends)
  $('#followWhenHint').textContent = w < 0.05 ? 'The next page comes as you start the bar before the last: time to look ahead.' : w < 0.45 ? 'The next page comes during the bar before the last.' : w <= 0.55 ? 'The next page comes as you start the last bar.' : w < 0.95 ? 'The next page comes during the last bar.' : 'The next page comes with the last notes of the page.';
  $('#followEyes').checked = !!S.followEyes;
  const c = eyes.cal();
  $('#eyesState').textContent = !Gaze.supported() ? 'Not available on this device.' : !c ? 'Not set up yet.' : (c.errY || c.err) / innerHeight < 0.1 ? 'Set up: very good.' : (c.errY || c.err) / innerHeight < 0.2 ? 'Set up: good. It gets better as you play.' : 'Set up: rough. It puts itself right as you play; better light helps.';
  $('#eyesCal').textContent = c ? 'Set up again' : 'Set up my eyes';
}
$('#eyesCal').addEventListener('click', () => openEyeCal());
// where in the last two bars the page turns: 0 the bar before the last begins, 0.5 the last bar
// begins, 1 the last notes (a choice made before as a word is kept)
function followAt() { if (typeof S.followAt === 'number') return S.followAt; return S.followWhen === 'line' ? 0 : S.followWhen === 'end' ? 1 : 0.5; }
$('#followAt').addEventListener('input', (e) => { S.followAt = +e.target.value / 100; saveSettings(); syncEyesUI(); });
// the calibration: thirteen dots, the frames while looking at each one; then a check with five
// rings, and the result shown where it was measured. Works with the iPad straight ahead or to one
// side: the camera picture shows how it sees you before starting.
const EC = { on: false, gaze: null, last: null, offState: null, offSeen: null, phase: '' };
const ecWait = (ms) => new Promise((r) => setTimeout(r, ms));
function ecSet(title, html, go, extra = {}) {
  $('#eyeCalTitle').textContent = title; $('#eyeCalTitle').hidden = !title;
  $('#eyeCalText').innerHTML = html;
  $('#eyeCalGo').hidden = !go; if (go) $('#eyeCalGo').textContent = go;
  $('#eyeCalRedo').hidden = !extra.redo; $('#eyeCalCheck').hidden = !extra.check;
  $('#eyeCalCancel').textContent = extra.cancel || 'Cancel';
}
// how the camera sees you now: words and a colour for the ring around the picture
function ecJudge(smp) {
  if (!smp || !smp.face) return ['', 'Looking for your face… Some light on your face helps.'];
  if (!smp.see) return ['warn', 'One eye is hidden. Turn the iPad a little more towards you.'];
  if (smp.blinkL > 0.45 && smp.blinkR > 0.45) return ['ok', 'Your face is seen.'];
  if (Math.abs(smp.yaw) > 30) return ['ok', 'Seen from the side: that works.'];
  return ['ok', 'Both eyes are seen. Ready.'];
}
async function ecCamera() {
  // (one camera and one face model for both: the set-up and the following)
  if (!eyes.gaze) eyes.gaze = new Gaze();
  EC.gaze = eyes.gaze;
  EC.on = true; EC.gaze.fast = true; sendFace();
  const ok = EC.gaze.on || (await EC.gaze.start());
  if (!ok) return false;
  const v = $('#eyeCalVid'); if (EC.gaze.stream && v.srcObject !== EC.gaze.stream) { v.srcObject = EC.gaze.stream; v.play().catch(() => {}); }
  if (!EC.offState) EC.offState = EC.gaze.onSample((smp) => {
    EC.last = smp;
    const [cls, txt] = ecJudge(smp);
    const st = $('#eyeCalState'); st.textContent = txt; st.className = 'eyecal-state ' + cls; $('#eyeCalCam').className = 'eyecal-cam ' + cls;
    // while the dots run: say so at once when the eyes are lost
    // (no words to read while looking at the dots: the dot turns amber, and waits)
    if ($('#eyeCal').classList.contains('running')) { $('#eyeCalLive').hidden = true; $('#eyeCalDot').classList.toggle('lost', !smp.see); }
  });
  return true;
}
function ecRelease() {
  if (EC.offState) { EC.offState(); EC.offState = null; }
  if (EC.offSeen) { EC.offSeen(); EC.offSeen = null; }
  $('#eyeCalVid').srcObject = null;
}
async function openEyeCal() {
  if (!Gaze.supported()) { toast('Not available on this device.'); return; }
  hidePanel();
  const o = $('#eyeCal'); o.hidden = false; o.classList.remove('running', 'result'); $('#eyeCalSeen').hidden = true; $('#eyeCalLive').hidden = true; $('#eyeCalMarks').innerHTML = '';
  EC.phase = 'intro';
  ecSet('Set up your eyes', '<ol><li>Put the iPad exactly where it stands when you play: straight ahead or to the side, both work.</li><li>Sit or stand as you play, with your instrument if you can.</li><li>Follow each dot with your eyes until it is gone. Move your head only as you do when you read.</li><li>At the end the dot stays in the middle and a small arrow appears beside it: keep your eyes on the dot and turn your head a little that way.</li></ol><small>Then a short check shows where Stand sees you looking. It takes about half a minute.</small>', 'Start');
  $('#eyeCalState').textContent = 'Starting the camera…'; $('#eyeCalState').className = 'eyecal-state'; $('#eyeCalCam').className = 'eyecal-cam';
  EC.ready = ecCamera();
  const ok = await EC.ready;
  if (!ok && EC.phase === 'intro') { $('#eyeCalState').textContent = 'The camera could not start' + (EC.gaze && EC.gaze.err ? ': ' + EC.gaze.err : '.'); $('#eyeCalState').className = 'eyecal-state warn'; }
}
$('#eyeCalCancel').addEventListener('click', () => closeEyeCal());
function closeEyeCal() {
  EC.on = false; if (EC.gaze) EC.gaze.fast = !!S.wink; EC.phase = ''; $('#eyeCal').hidden = true; $('#eyeCal').classList.remove('running', 'result');
  ecRelease();
  if (EC.gaze && !eyes.running) EC.gaze.stop();
  syncEyesUI(); follow.sync();
}
// the dots: each held until the eyes have been seen on it for long enough (a little longer when
// they were lost meanwhile)
async function ecDots() {
  const W = innerWidth, H = innerHeight, mx = 0.07;
  const pts = [[0.5, 0.5], [mx, mx], [0.5, mx], [1 - mx, mx], [1 - mx, 0.5], [1 - mx, 1 - mx], [0.5, 1 - mx], [mx, 1 - mx], [mx, 0.5], [0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
  const samples = []; let cur = null;
  const off = EC.gaze.onSample((smp) => { if (cur && performance.now() > cur.from) { samples.push({ px: cur.px, py: cur.py, s: smp }); if (smp.see) cur.good++; } });
  const dot = $('#eyeCalDot'); dot.classList.remove('ring'); $('#eyeCal').classList.add('running');
  for (const [fx, fy] of pts) {
    if (!EC.on) break;
    dot.classList.remove('shrink'); dot.style.left = fx * W + 'px'; dot.style.top = fy * H + 'px';
    await ecWait(600);
    void dot.offsetWidth; dot.classList.add('shrink');
    const t0 = performance.now(); cur = { px: fx * W, py: fy * H, from: t0 + 450, good: 0 };
    await ecWait(1350);
    // (not seen well: wait for the eyes, up to three seconds more)
    for (let k = 0; k < 30 && cur.good < 5 && EC.on; k++) await ecWait(100);
    cur = null;
  }
  // Then the head moves while the eyes stay on one dot: so how the head turns is learned apart from
  // where the eyes look (else turning the head moved the point as if the eyes had moved)
  // No words to read meanwhile (reading them took the eyes off the dot): a small arrow beside the
  // dot shows which way to turn the head; the eyes stay on the dot.
  dot.classList.remove('shrink'); dot.style.left = 0.5 * W + 'px'; dot.style.top = 0.5 * H + 'px';
  dot.classList.add('pulse'); await ecWait(1400); dot.classList.remove('pulse');
  const heads = ['left', 'right', 'up', 'down'];
  for (let k = 0; k < heads.length && EC.on; k++) {
    dot.classList.remove('shrink'); dot.dataset.head = heads[k];
    await ecWait(700);
    // (each its own place in the set-up, a hair apart, so they are not merged into one)
    cur = { px: 0.5 * W + (k + 1) * 0.001, py: 0.5 * H, from: performance.now() + 300, good: 0 };
    await ecWait(1600);
    cur = null;
    delete dot.dataset.head; await ecWait(250);
  }
  delete dot.dataset.head; dot.classList.remove('lost', 'pulse');
  off(); $('#eyeCal').classList.remove('running'); $('#eyeCalLive').hidden = true;
  return samples;
}
// the check: five rings; where the eyes were seen on each, and a small shift of the whole when
// it was off the same way on all of them
async function ecCheck() {
  const W = innerWidth, H = innerHeight;
  const tg = [[0.5, 0.42], [0.18, 0.18], [0.82, 0.18], [0.82, 0.68], [0.18, 0.68]];
  const marks = $('#eyeCalMarks'); marks.innerHTML = '';
  const res = []; let cur = null;
  const off = EC.gaze.onSample((smp) => { if (cur && performance.now() > cur.from && smp.see && smp.x !== undefined && !(smp.blinkL > 0.45 && smp.blinkR > 0.45)) cur.pts.push([smp.x, smp.y]); });
  const dot = $('#eyeCalDot'); dot.classList.add('ring'); dot.classList.remove('shrink');
  $('#eyeCal').classList.remove('result'); $('#eyeCal').classList.add('running');
  for (const [fx, fy] of tg) {
    if (!EC.on) break;
    dot.style.left = fx * W + 'px'; dot.style.top = fy * H + 'px';
    const t0 = performance.now(); cur = { pts: [], from: t0 + 700 };
    await ecWait(1700);
    for (let k = 0; k < 20 && cur.pts.length < 4 && EC.on; k++) await ecWait(100);
    const P = cur.pts.slice(Math.floor(cur.pts.length * 0.2));
    res.push({ tx: fx * W, ty: fy * H, x: P.length ? P.reduce((a, p) => a + p[0], 0) / P.length : null, y: P.length ? P.reduce((a, p) => a + p[1], 0) / P.length : null });
    cur = null;
  }
  off(); dot.classList.remove('ring'); $('#eyeCal').classList.remove('running'); $('#eyeCalLive').hidden = true;
  return res;
}
function ecShowCheck(res, cal) {
  const W = innerWidth, H = innerHeight, marks = $('#eyeCalMarks'); marks.innerHTML = '';
  const seen = res.filter((r) => r.x !== null);
  let bx = 0, by = 0;
  if (seen.length >= 3) { bx = seen.reduce((a, r) => a + r.x - r.tx, 0) / seen.length; by = seen.reduce((a, r) => a + r.y - r.ty, 0) / seen.length; }
  const errOf = (sx, sy) => Math.sqrt(seen.reduce((a, r) => a + (r.x - sx - r.tx) ** 2 + (r.y - sy - r.ty) ** 2, 0) / Math.max(1, seen.length));
  // (the shift, only when it really helps)
  const shift = seen.length >= 3 && errOf(bx, by) < errOf(0, 0) * 0.8;
  if (!shift) { bx = 0; by = 0; }
  const err = seen.length ? errOf(bx, by) : 999;
  const errY = seen.length ? Math.sqrt(seen.reduce((a, r) => a + (r.y - by - r.ty) ** 2, 0) / seen.length) : 999;
  const unit = Math.min(W, H);
  res.forEach((r, i) => {
    const m = el('div', 'eyecal-mark'); m.style.left = r.tx + 'px'; m.style.top = r.ty + 'px'; marks.append(m);
    if (r.x === null) return;
    const x = clamp(r.x - bx, 8, W - 8), y = clamp(r.y - by, 8, H - 8), d = Math.hypot(x - r.tx, y - r.ty);
    const h = el('div', 'eyecal-hit ' + (d < unit * 0.09 ? 'good' : d < unit * 0.18 ? 'near' : 'far')); h.style.left = x + 'px'; h.style.top = y + 'px'; marks.append(h);
  });
  return { err, errY, bx, by, missed: res.length - seen.length };
}
async function ecRun(dotsToo) {
  EC.on = true; $('#eyeCalSeen').hidden = true; $('#eyeCalMarks').innerHTML = '';
  if (EC.ready) { $('#eyeCalGo').disabled = true; await EC.ready; $('#eyeCalGo').disabled = false; }
  if (!EC.gaze || !EC.gaze.on) { $('#eyeCalState').textContent = 'Starting the camera…'; if (!(await ecCamera())) { ecSet('The camera could not start', EC.gaze && EC.gaze.err ? EC.gaze.err : 'Allow Stand to use the camera in Settings, then try again.', 'Start'); return; } }
  const o = eyes.orient();
  if (dotsToo) {
    EC.phase = 'dots';
    const samples = await ecDots(); if (!EC.on) return;
    window.__eyesDbg = { n: samples.length, face: samples.filter((q) => q.s.face).length, see: samples.filter((q) => q.s.see).length, yaw: samples.slice(0, 3).map((q) => q.s.yaw), ratio: samples.slice(0, 3).map((q) => q.s.ratio) };
    const cal = fitCalibration(samples);
    if (!cal) { ecSet('Your eyes were not seen well enough', `Only ${window.__eyesDbg.see} of ${window.__eyesDbg.n} moments showed your eyes. Look at the camera picture: your face should be in it, lit from the front. Turn the iPad a little towards you, or sit a little closer, then try again.`, 'Try again'); EC.phase = 'intro'; return; }
    S.eyesCal = { ...(S.eyesCal || {}), [o]: { ...cal, w: innerWidth, h: innerHeight, at: Date.now() } };
    S.followEyes = true; saveSettings();
  }
  const cal = eyes.cal(); if (!cal) { EC.phase = 'intro'; ecSet('Set up your eyes', 'Start again to set up for this way round of the iPad.', 'Start'); return; }
  EC.gaze.cal = cal;
  // the check
  EC.phase = 'check';
  const res = await ecCheck(); if (!EC.on) return;
  const r = ecShowCheck(res, cal); window.__ecCheck = { res, r };
  // keep the shift and how good it was (the worse of the two measures, so the follower is not too sure)
  const errNow = Math.max(cal.err * 0.7, r.err);
  S.eyesCal = { ...(S.eyesCal || {}), [o]: { ...cal, dx: (cal.dx || 0) - r.bx, dy: (cal.dy || 0) - r.by, err: Math.round(Math.max(errNow, 30)), errY: Math.round(Math.max((cal.errY || cal.err) * 0.7, r.errY, 25)), checkErr: Math.round(r.err) } };
  saveSettings(); EC.gaze.cal = eyes.cal();
  // the ring follows the eyes from now on, to look around and see
  const seen = $('#eyeCalSeen'); seen.hidden = false;
  if (!EC.offSeen) EC.offSeen = EC.gaze.onSample((smp) => { if (smp.x !== undefined && smp.see) { seen.classList.remove('lost'); seen.style.left = clamp(smp.x, 0, innerWidth) + 'px'; seen.style.top = clamp(smp.y, 0, innerHeight) + 'px'; } else seen.classList.add('lost'); });
  $('#eyeCal').classList.add('result'); EC.phase = 'result';
  // what matters for turning is up and down: which line, and above all the end of the page
  const ey = (r.errY ?? r.err) / innerHeight;
  const verdict = r.missed >= 3 ? ['Your eyes were lost during the check', 'Keep the iPad where it is, with more light on your face, and set up again.']
    : ey < 0.1 ? ['Very good', 'Stand can tell the lines of the music apart, and when you reach the end of the page.']
    : ey < 0.2 ? ['Good', 'Stand can tell about where on the page you are looking: it helps the turns, and gets better as you play.']
    : ['Rough', 'It helps a little, and puts itself right as you play. Set up again with more light on your face, or the iPad a little closer, for better.'];
  ecSet(verdict[0], verdict[1] + '<small>Green dots: where Stand saw you looking at each ring. The green ring now follows your eyes; look around to try it.</small>', 'Done', { redo: true, check: true, cancel: 'Close' });
}
$('#eyeCalGo').addEventListener('click', () => {
  if (EC.phase === 'result') { closeEyeCal(); return; }
  if (EC.phase === 'intro') ecRun(true);
});
$('#eyeCalRedo').addEventListener('click', () => { if (EC.offSeen) { EC.offSeen(); EC.offSeen = null; } $('#eyeCal').classList.remove('result'); ecRun(true); });
$('#eyeCalCheck').addEventListener('click', () => { if (EC.offSeen) { EC.offSeen(); EC.offSeen = null; } $('#eyeCal').classList.remove('result'); ecRun(false); });
window.__ec = EC;
window.addEventListener('resize', () => { if (eyes.running && eyes.gaze) { eyes.gaze.cal = eyes.cal(); if (!eyes.gaze.cal) eyes.sync(); } });
// ---------- performance mode: nothing but the music ----------
function setPerform(on) {
  V.perform = !!on;
  $('#score').classList.toggle('performing', V.perform);
  document.body.classList.toggle('performing', V.perform);
  $('#performExit').hidden = !V.perform;
  if (V.perform) { hidePanel(); if (V.inking) setInking(false); Z.s = 1; Z.x = 0; Z.y = 0; applyZoom(); showChrome(false); keepAwake(); }
  else showChrome(true);
  follow.sync();
}
$('#performBtn').addEventListener('click', () => setPerform(true));
{
  // leaving takes two deliberate taps (tap, then 'Leave'), so nothing changes by accident on
  // stage; holding the pill works too
  const ex = $('#performExit'); let armT = null, holdT = null;
  const disarm = () => { clearTimeout(armT); ex.classList.remove('armed'); ex.querySelector('span').textContent = 'Performing'; };
  ex.addEventListener('pointerdown', (e) => { e.stopPropagation(); holdT = setTimeout(() => { disarm(); setPerform(false); }, 900); });
  const cancelHold = () => clearTimeout(holdT);
  ex.addEventListener('pointerup', cancelHold); ex.addEventListener('pointercancel', cancelHold);
  ex.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ex.classList.contains('armed')) { disarm(); setPerform(false); return; }
    ex.classList.add('armed'); ex.querySelector('span').textContent = 'Tap to leave';
    clearTimeout(armT); armT = setTimeout(disarm, 3500);
  });
}
document.addEventListener('keydown', (e) => {
  if ($('#score').hidden) return;
  if (e.target.matches('input, select, textarea')) {
    // typing on the page: a pedal still turns. Page Up/Down always; the arrows when they could not
    // move the cursor any further (after the last letter, or before the first)
    const tx = e.target, typing = tx.closest && (tx.classList.contains('tb-edit') || tx.classList.contains('ink-text'));
    if (!typing) return;
    const len = (tx.value || '').length, a = tx.selectionStart ?? len, b = tx.selectionEnd ?? len;
    const fwd = e.key === 'PageDown' || ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && a === len && b === len);
    const back = e.key === 'PageUp' || ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && a === 0 && b === 0);
    if (!fwd && !back) return;
    e.preventDefault(); tx.blur(); turn(fwd ? 1 : -1); return;
  }
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); turn(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

// ---------- zoom ----------
const Z = { s: 1, x: 0, y: 0, el: null, sharpT: 0, sharp: 1 };
// A notebook page can be made a little smaller than the screen; a score never: pinched smaller it
// settles back to fit the screen exactly.
const ZOOM_MIN_NB = 0.7;
const zoomMin = () => (NBK() ? ZOOM_MIN_NB : 1);
// Zoomed in on a score, the page can be pulled a little past its top and bottom edges, so the top
// line can be brought down below the markings bar to write above it.
const zoomSlack = () => (NBK() || Z.s <= 1.02 ? { top: 0, bot: 0 } : (() => { const h = stage.clientHeight || 800; return { top: Math.min(260, h * 0.24), bot: Math.min(140, h * 0.12) }; })());
function spreadNatural() {
  // position of the spread inside the stage before our transform
  const sr = stage.getBoundingClientRect();
  const w = Z.el.offsetWidth, h = Z.el.offsetHeight;
  return { ox: (sr.width - w) / 2, oy: (sr.height - h) / 2, w, h, sw: sr.width, sh: sr.height, left: sr.left, top: sr.top };
}
// Visual box of the spread when turned: centred on the stage, so offsets are from the centre.
function turnedBox() {
  const sr = stage.getBoundingClientRect();
  return { sw: sr.width, sh: sr.height, cx: sr.left + sr.width / 2, cy: sr.top + sr.height / 2,
    vw: Z.el.offsetHeight, vh: Z.el.offsetWidth };   // offset sizes are unturned, so swap them
}
function clampZoom() {
  if (TURN()) {
    const b = turnedBox(), cw = b.vw * Z.s, ch = b.vh * Z.s;
    Z.x = cw <= b.sw ? 0 : clamp(Z.x, -(cw - b.sw) / 2, (cw - b.sw) / 2);
    Z.y = ch <= b.sh ? 0 : clamp(Z.y, -(ch - b.sh) / 2, (ch - b.sh) / 2);
    return;
  }
  const n = spreadNatural();
  const cw = n.w * Z.s, ch = n.h * Z.s;
  if (cw <= n.sw) Z.x = (n.sw - cw) / 2 - n.ox; else Z.x = clamp(Z.x, n.sw - cw - n.ox, -n.ox);
  const sl = zoomSlack();
  if (ch <= n.sh && !sl.top) Z.y = (n.sh - ch) / 2 - n.oy; else Z.y = clamp(Z.y, Math.min(n.sh - ch - n.oy - sl.bot, (n.sh - ch) / 2 - n.oy), Math.max(-n.oy + sl.top, (n.sh - ch) / 2 - n.oy));
}
function applyZoom() {
  if (!Z.el) return;
  const turn = TURN();
  Z.el.style.transformOrigin = turn ? '50% 50%' : '';
  const turnCss = turn ? ' rotate(-90deg)' : '';
  // close to the normal size it snaps back, so returning to 100% is easy
  if (Math.abs(Z.s - 1) < 0.04) { Z.s = 1; Z.x = 0; Z.y = 0; Z.el.style.transform = turnCss.trim(); }
  else { clampZoom(); Z.el.style.transform = `translate(${Z.x}px, ${Z.y}px) scale(${Z.s})${turnCss}`; }
  zoomPill.hidden = Z.s === 1;
  if (Z.s > 1.05 || V.pages.some((p) => p.layer && p.layer.view)) { clearTimeout(Z.inkT); Z.inkT = setTimeout(sharpenInk, 260); }
  zoomPill.textContent = Math.round(Z.s * 100) + '%  ·  Reset';
  if (!$('#zoomPop').hidden) syncZoomPop();
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
  const sr = stage.getBoundingClientRect();
  for (const p of V.pages) {
    // (only the pages on screen are drawn at the bigger size: two big pages at once filled the memory)
    const pr = p.pg.getBoundingClientRect(), shown = pr.right > sr.left && pr.left < sr.right && pr.bottom > sr.top && pr.top < sr.bottom;
    if (!shown && want > 1) continue;
    const art = await renderPage(p.index, p.iw, p.ih, want);
    if (token !== layoutToken) return;
    if (art !== p.art) {
      art.className = 'art';
      p.inner.replaceChild(art, p.art); p.art = art;
      p.layer.resize(art.width, art.height);
    }
  }
  sharpenInk();
}
// Zoomed in, the markings are drawn again for just the part of the page on screen, at the full
// sharpness of the screen, so writing stays crisp at any zoom (the page itself can't be that big).
// Zoomed in, every second: is each page's markings layer as sharp as the screen where it shows?
// If not (a page drawn again underneath, a turn, anything that set the layer back to the whole
// page), it is made sharp again. (Writing looked blurred after the Pencil lifted on the iPad.)
setInterval(() => {
  if (!V.doc || Z.s <= 1.05 || TURN() || (GS && GS.kind) || $('#score').hidden) return;
  // (nothing moved since the markings were last made sharp: they are as sharp as they can be; very
  // zoomed in, the memory limit keeps them a little under the screen's sharpness, and drawing them
  // again every second made the iPad work for nothing)
  const here = Z.s + ':' + Z.x + ':' + Z.y + ':' + V.pages.length + ':' + (V.pages[0] && V.pages[0].art && V.pages[0].art.width);
  if (Z.sharpWhere === here && V.pages.every((p) => !p.layer || p.layer.view)) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (const p of V.pages) {
    if (!p.ink || !p.layer) continue;
    const r = p.ink.getBoundingClientRect(), sr = stage.getBoundingClientRect(); if (r.width < 4 || r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom) continue;
    if (p.ink.width / (r.width * dpr) < 0.92) { sharpenInk(); return; }
  }
}, 1000);
function sharpenInk() {
  clearTimeout(Z.inkT);
  if (!V.pages.length) return;
  if (GS && (GS.kind === 'ink' || GS.kind === 'erase' || GS.kind === 'smart')) { Z.inkT = setTimeout(sharpenInk, 300); return; }
  Z.sharpWhere = Z.s + ':' + Z.x + ':' + Z.y + ':' + V.pages.length + ':' + (V.pages[0] && V.pages[0].art && V.pages[0].art.width);
  const dpr = Math.min(window.devicePixelRatio || 1, 3), sr = stage.getBoundingClientRect();
  for (const p of V.pages) {
    if (!p.layer || !p.ink || !p.art) continue;
    const full = () => { if (p.layer.view) { p.ink.style.cssText = ''; p.layer.resize(p.art.width, p.art.height); } };
    if (Z.s <= 1.05 || TURN()) { full(); continue; }
    const r = p.inner.getBoundingClientRect(); if (!r.width || !r.height) continue;
    // The part on screen (and a margin round it, smaller if memory is short), cut on the screen's own
    // pixels: one pixel of the markings is exactly one pixel of the screen, so a line looks the same
    // after the Pencil lifts as while it is being drawn (a canvas a little smaller, or half a pixel
    // off, is blurred by the iPad when it is shown)
    let x0, x1, y0, y1, pw, ph;
    for (const m of [0.25, 0.15, 0.08, 0]) {
      const L = Math.max(Math.floor((sr.left - sr.width * m) * dpr), Math.floor(r.left * dpr)), R = Math.min(Math.ceil((sr.right + sr.width * m) * dpr), Math.ceil(r.right * dpr));
      const T = Math.max(Math.floor((sr.top - sr.height * m) * dpr), Math.floor(r.top * dpr)), B = Math.min(Math.ceil((sr.bottom + sr.height * m) * dpr), Math.ceil(r.bottom * dpr));
      pw = R - L; ph = B - T;
      x0 = (L / dpr - r.left) / r.width; x1 = (R / dpr - r.left) / r.width; y0 = (T / dpr - r.top) / r.height; y1 = (B / dpr - r.top) / r.height;
      if (pw * ph <= maxPx()) break;
    }
    if (pw < 4 || ph < 4) continue;
    if (pw * ph > maxPx()) { const k = Math.sqrt(maxPx() / (pw * ph)); pw *= k; ph *= k; }
    // the whole page is already as sharp as the screen: nothing to gain
    if (Math.abs(pw / (x1 - x0) - p.art.width) < 2 && Math.abs(r.width * dpr - p.art.width) < 2) { full(); continue; }
    Object.assign(p.ink.style, { inset: 'auto', left: x0 * 100 + '%', top: y0 * 100 + '%', width: (x1 - x0) * 100 + '%', height: (y1 - y0) * 100 + '%' });
    p.layer.setView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pw, ph);
  }
}
function setZoomAt(s, cx, cy, base) {
  // keep the point under (cx, cy) still while scaling from base
  if (TURN()) {
    const b = turnedBox();
    const ux = (cx - b.cx - base.x) / base.s, uy = (cy - b.cy - base.y) / base.s;
    // undo the quarter turn: on screen a local offset (px, py) shows as (py, -px)
    const px = -uy, py = ux;
    Z.s = clamp(s, zoomMin(), 5);
    Z.x = (cx - b.cx) - Z.s * py;
    Z.y = (cy - b.cy) + Z.s * px;
    applyZoom();
    return;
  }
  const n = spreadNatural();
  const wx = (cx - n.left - n.ox - base.x) / base.s, wy = (cy - n.top - n.oy - base.y) / base.s;
  Z.s = clamp(s, zoomMin(), 5);
  Z.x = cx - n.left - n.ox - wx * Z.s; Z.y = cy - n.top - n.oy - wy * Z.s;
  applyZoom();
}
zoomPill.addEventListener('click', () => { Z.s = 1; applyZoom(); scheduleSharpen(); });
// the Zoom button in the top bar: steps and presets, zooming about the middle of the screen
function zoomTo(s) {
  const sr = stage.getBoundingClientRect();
  setZoomAt(s, sr.left + sr.width / 2, sr.top + sr.height / 2, { s: Z.s, x: Z.x, y: Z.y });
  if (Math.abs(Z.s - 1) < 0.04) { Z.s = 1; applyZoom(); }
  scheduleSharpen(); syncZoomPop();
}
function syncZoomPop() {
  $('#zoomVal').textContent = Math.round(Z.s * 100) + '%';
  for (const b of $$('#zoomPresets button')) { b.classList.toggle('on', Math.abs(+b.dataset.z - Z.s) < 0.03); b.hidden = +b.dataset.z < zoomMin(); }
}
$('#zoomBtn').addEventListener('click', () => { const p = $('#zoomPop'); p.hidden = !p.hidden; if (!p.hidden) syncZoomPop(); });
$('#zoomIn').addEventListener('click', () => zoomTo(Math.min(5, Z.s * 1.25)));
$('#zoomOut').addEventListener('click', () => zoomTo(Math.max(zoomMin(), Z.s / 1.25)));
for (const b of $$('#zoomPresets button')) b.addEventListener('click', () => zoomTo(+b.dataset.z));

// ---------- live drawing layer ----------
function sizeLive() {
  const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
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
  // only on its own page (a thing dragged past the edge does not show over the next page)
  g.beginPath(); g.rect((r.left - sr.left) * k, (r.top - sr.top) * k, r.width * k, r.height * k); g.clip();
  const it = extra && extra.length ? { ...item, p: item.p.concat(extra) } : item;
  if (TURN()) {
    // page drawn a quarter turn anticlockwise: its width runs up the screen
    g.setTransform(0, -1, 1, 0, (r.left - sr.left) * k, (r.top - sr.top + r.height) * k);
    drawItem(g, it, r.height * k, r.width * k, true);
  } else {
    g.setTransform(1, 0, 0, 1, (r.left - sr.left) * k, (r.top - sr.top) * k);
    drawItem(g, it, r.width * k, r.height * k, true);
  }
  g.restore();
}
function drawLasso(pts) {
  const g = liveCanvas.getContext('2d'); const sr = stage.getBoundingClientRect(); const k = liveCanvas.width / sr.width;
  g.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  if (pts.length < 2) return;
  g.save(); g.setTransform(k, 0, 0, k, -sr.left * k, -sr.top * k);
  g.setLineDash([6, 5]); g.lineWidth = 1.6; g.strokeStyle = css('--accent-text'); g.fillStyle = 'rgba(0,0,0,0)';   // outline only, no blue fill
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------- markings state ----------
const INK = {
  tool: 'pen', finger: false, stamp: 'p', erase: 'smart', penKind: 'fountain', recent: [], kinds: {}, eraser: { size: 3, whole: false }, tape: { pat: 'stripes', size: 4 }, shapeFill: false, steady: 0,
  slots: [COLORS[0], COLORS[2]], slot: 0,
  hlSlots: [COLORS[4], COLORS[5]], hlSlot: 0,
  pen: { size: 3, a: 1 }, hl: { c: COLORS[4], size: 5, a: 0.4 }, stampStyle: { size: 5, a: 1 }, white: { size: 6 },
};
const inkSize = (tool, v) => tool === 'pen' ? 0.0007 + Math.pow(v / 10, 1.5) * 0.0045 : tool === 'hl' ? 0.006 + v * 0.0024 : tool === 'white' ? 0.004 + v * 0.003 : 0.014 + v * 0.0042;
const penColor = () => INK.slots[INK.slot];
function persistInk() { S.ink = { tool: ['pen', 'hl', 'stamp'].includes(INK.tool) ? INK.tool : 'pen', finger: INK.finger, stamp: INK.stamp, erase: INK.erase, penKind: INK.penKind, recent: INK.recent, kinds: INK.kinds, eraser: INK.eraser, tape: INK.tape, shapeFill: INK.shapeFill, steady: INK.steady, slots: INK.slots, slot: INK.slot, hlSlots: INK.hlSlots, hlSlot: INK.hlSlot, pen: INK.pen, hl: INK.hl, stampStyle: INK.stampStyle, white: INK.white }; saveSettings(); }
function styleFor(tool) {
  if (tool === 'pen' && NBK()) { const k = INK.penKind; return INK.kinds[k] || (INK.kinds[k] = { size: k === 'marker' || k === 'brush' || k === 'water' ? 4 : INK.pen.size, a: INK.pen.a }); }
  return tool === 'stamp' ? INK.stampStyle : tool === 'hl' ? INK.hl : INK.pen;
}
// the eraser's reach (page fractions); in a notebook it can be made much bigger
const eraserR = () => 0.002 + INK.eraser.size * 0.0025;   // the same size scale on scores and in notebooks (size 3 = the old default)
function colorFor(tool) { return tool === 'hl' ? INK.hl.c : penColor(); }
let hintT;
function inkHint(msg, ms = 3200) { const h = $('#inkHint'); h.textContent = msg; h.hidden = false; clearTimeout(hintT); hintT = setTimeout(() => (h.hidden = true), ms); }
function setInking(on) {
  if (on && V.half) { V.half = false; layout(); }
  V.inking = on;
  if (!on) { finishText(); flushWord(); finishTextBox(); }
  $('#inkbar').hidden = !on; $('#inkBtn').classList.toggle('on', on);
  stage.classList.toggle('inking', on);
  closeInkPops(); clearSelection();
  if (on) {
    // writing always shows the markings, even if they were hidden to see the clean score
    if (stage.classList.contains('hide-ink')) { stage.classList.remove('hide-ink'); $('#hideInkBtn').classList.remove('on'); $('#hideInkBtn').setAttribute('aria-pressed', 'false'); }
    showChrome(true); hidePanel(); loadMusicFont(); sizeLive(); syncInkBar();
    inkHint(INK.finger ? 'Your finger writes. Two fingers zoom and move; swipe with two fingers to turn.' : 'The Pencil writes. Your finger turns pages, pinches to zoom and moves the page.');
  } else { $('#inkHint').hidden = true; clearLive(); }
}
// A tap anywhere outside an open colour/eraser/tool panel closes it (buttons keep their own toggling).
const POP_OPENERS = {
  '#inkPop': '#inkColorBtn, .slot, .ink-tool[data-tool="pen"], .ink-tool[data-tool="hl"], #inkSizes',
  '#eraserPop': '.ink-tool[data-tool="eraser"]', '#tapePop': '.ink-tool[data-tool="tape"]',
  '#stampPop': '.ink-tool[data-tool="stamp"]', '#erasePop': '.ink-tool[data-tool="print"]',
  '#insertPop': '#inkInsert, #nbPhotoBtn', '#picPop': '.sel-bar', '#shapePop': '.sel-bar',
  '#addPagePop': '#nbAddBtn', '#textPop': '#tbBar', '#zoomPop': '#zoomBtn', '#layerPop': '#layerBtn',
};
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  for (const [id, opener] of Object.entries(POP_OPENERS)) {
    const p = $(id);
    if (!p || p.hidden || p.contains(t) || (t.closest && (t.closest('.tour') || t.closest(opener)))) continue;
    // a colour well (the system colour picker) keeps its panel open while it is in use
    if (t.closest && t.closest('input[type="color"]')) continue;
    p.hidden = true;
  }
}, true);
function closeInkPops() { $('#layerPop').hidden = true; $('#addPagePop').hidden = true; $('#shapePop').hidden = true; $('#eraserPop').hidden = true; $('#tapePop').hidden = true; $('#inkPop').hidden = true; $('#stampPop').hidden = true; $('#erasePop').hidden = true; $('#insertPop').hidden = true; $('#picPop').hidden = true; }
function syncInkBar() {
  const nb = NBK();
  $('#inkbar').classList.toggle('nb', nb);
  if (nb && (INK.tool === 'text' || INK.tool === 'print')) INK.tool = INK.tool === 'text' ? 'tbox' : 'pen';
  if (!nb && INK.tool === 'tbox') INK.tool = 'text';
  if (INK.tool !== 'tbox' && tbEdit) finishTextBox();
  $('#inkPop').classList.toggle('nb', nb);
  $$('.ink-tool[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === INK.tool));
  $('#textBar').hidden = !(V.inking && INK.tool === 'text');
  if (INK.tool === 'text') $('#inkHint').hidden = true;
  if (INK.tool !== 'text' && textEdit) finishText();
  const hl = INK.tool === 'hl';
  if (hl) INK.hl.c = INK.hlSlots[INK.hlSlot];
  // the two colour buttons show the highlighter's colours while the highlighter is in use
  $$('.slot').forEach((b, i) => { b.style.setProperty('--c', hl ? INK.hlSlots[i] : INK.slots[i]); b.classList.toggle('on', hl ? i === INK.hlSlot : i === INK.slot); b.classList.toggle('hl', hl); });
  const hlDot = $('#hlDot'); if (hlDot) hlDot.style.setProperty('--c', INK.hl.c);
  const penDot = $('#penDot'); if (penDot) penDot.style.setProperty('--c', penColor());
  syncSizes();
  $('#fingerBtn').classList.toggle('on', INK.finger);
  $('#inkUndo').disabled = !V.undo.length; $('#inkRedo').disabled = !V.redo.length;
}
// three quick thicknesses next to the colours, like a notes app
const SIZE_PRESETS = () => (INK.tool === 'hl' ? [3, 5, 8] : NBK() ? [2, 5, 10] : [2, 4, 7]);
function syncSizes() {
  const box = $('#inkSizes'); if (!box) return;
  const t = INK.tool === 'hl' ? 'hl' : INK.tool === 'pen' ? 'pen' : null;
  box.hidden = !t; if (!t) return;
  const cur = styleFor(t).size, pre = SIZE_PRESETS();
  const near = pre.reduce((bi, v, i) => (Math.abs(v - cur) < Math.abs(pre[bi] - cur) ? i : bi), 0);
  $$('#inkSizes button').forEach((b, i) => {
    b.classList.toggle('on', i === near && Math.abs(pre[i] - cur) <= 1);
    const d = t === 'hl' ? [7, 11, 16][i] : [4, 7, 11][i];
    b.style.setProperty('--d', d + 'px'); b.style.setProperty('--c', colorFor(t));
  });
}
$$('#inkSizes button').forEach((b) => b.addEventListener('click', () => {
  const t = INK.tool === 'hl' ? 'hl' : 'pen';
  styleFor(t).size = SIZE_PRESETS()[+b.dataset.i]; syncSizes(); persistInk();
  if (!$('#inkPop').hidden) fillInkPop();
}));
// palettes that belong together (notebooks)
function fillPalSets(cur, pick, box = $('#palSets')) {
  box.textContent = '';
  for (const [name, cols] of PALETTES) {
    const set = el('div', 'pal-set'); set.append(el('small', '', name));
    const row = el('div');
    for (const c of cols) { const b = el('button'); b.style.setProperty('--c', c); b.setAttribute('aria-label', name + ' ' + c); b.classList.toggle('on', c.toLowerCase() === (cur || '').toLowerCase()); b.addEventListener('click', () => pick(c)); row.append(b); }
    set.append(row); box.append(set);
  }
}
function fillInkPop() {
  const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen';
  const st = styleFor(tool), cur = colorFor(tool);
  $('#inkPopTitle').textContent = tool === 'hl' ? 'Highlighter' : `Colour ${INK.slot + 1}`;
  const sw = $('#swatches'); sw.textContent = '';
  const nb = NBK();
  const pick = (c) => { if (tool === 'hl') { INK.hl.c = c; INK.hlSlots[INK.hlSlot] = c; } else { INK.slots[INK.slot] = c; if (nb && tool === 'pen') styleFor('pen').c = c; } fillInkPop(); syncInkBar(); persistInk(); };
  for (const c of nb && tool !== 'hl' ? PALETTE : COLORS) {
    const b = el('button'); b.style.setProperty('--c', c); b.classList.toggle('on', c === cur); b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => pick(c));
    sw.append(b);
  }
  sw.classList.toggle('wide', nb && tool !== 'hl');
  // any colour, and the ones chosen that way lately
  $('#customColWrap').hidden = !nb;
  $('#inkCustom').value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#16181d';
  const rc = $('#recentCols'); rc.textContent = ''; rc.hidden = !nb || !INK.recent.length;
  for (const c of INK.recent) { const b = el('button'); b.style.setProperty('--c', c); b.classList.toggle('on', c === cur); b.addEventListener('click', () => pick(c)); rc.append(b); }
  INK._pick = pick;
  $('#palSets').hidden = !(nb && tool !== 'hl'); if (!$('#palSets').hidden) fillPalSets(cur, pick);
  $('#steadyRow').hidden = tool !== 'pen'; $('#steady').value = INK.steady; $('#steadyVal').textContent = INK.steady ? INK.steady : 'Off';
  const pk = $('#penKinds'); pk.hidden = !(nb && tool === 'pen');
  if (!pk.hidden) {
    pk.textContent = '';
    for (const kd of PEN_KINDS) {
      const b = el('button', 'pen-kind'); b.classList.toggle('on', INK.penKind === kd.k);
      const cv = el('canvas'); cv.width = 132; cv.height = 40; b.append(cv, el('span', '', kd.label));
      const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([0.08 + 0.84 * t, 0.5 + 0.25 * Math.sin(t * Math.PI * 2), 0.3 + 0.6 * Math.sin(t * Math.PI)]); }
      drawItem(cv.getContext('2d'), { t: 'pen', pk: kd.k, c: cur, a: 1, s: inkSize('pen', 4) * PEN_WIDTH[kd.k] * 3.2, p: pts }, 132, 40);
      b.addEventListener('click', () => { INK.penKind = kd.k; const st2 = styleFor('pen'); if (st2.c) INK.slots[INK.slot] = st2.c; else st2.c = INK.slots[INK.slot]; persistInk(); fillInkPop(); syncInkBar(); });
      pk.append(b);
    }
  }
  $('#inkSize').max = NBK() ? 20 : 10;
  $('#inkSize').value = st.size; $('#inkSizeVal').textContent = st.size;
  $('#shapeFillRow').hidden = !(NBK() && tool === 'pen'); $('#shapeFill').checked = !!INK.shapeFill;
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
  const pkd = tool === 'pen' && NBK() ? INK.penKind : undefined;
  drawItem(g, { t: tool, pk: pkd, c: colorFor(tool), a: st.a, s: inkSize(tool, st.size) * (800 / W) * (pkd ? PEN_WIDTH[pkd] : 1), p: pts }, c.width, c.height);
}
$('#inkSize').addEventListener('input', (e) => { const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen'; styleFor(tool).size = +e.target.value; $('#inkSizeVal').textContent = e.target.value; drawInkPreview(); syncSizes(); persistInk(); });
$('#inkAlpha').addEventListener('input', (e) => { const tool = INK.tool === 'hl' ? 'hl' : INK.tool === 'stamp' ? 'stamp' : 'pen'; styleFor(tool).a = +e.target.value / 100; $('#inkAlphaVal').textContent = e.target.value + '%'; drawInkPreview(); syncInkBar(); persistInk(); });
$('#shapeFill').addEventListener('change', (e) => { INK.shapeFill = e.target.checked; persistInk(); });
$('#steady').addEventListener('input', (e) => { INK.steady = +e.target.value; $('#steadyVal').textContent = INK.steady ? INK.steady : 'Off'; persistInk(); });
$('#inkCustom').addEventListener('change', (e) => {
  const c = e.target.value; INK.recent = [c, ...INK.recent.filter((x) => x !== c)].slice(0, 6);
  if (INK._pick) INK._pick(c);
});
$('#inkColorBtn').addEventListener('click', () => { const p = $('#inkPop'); const open = p.hidden; closeInkPops(); p.hidden = !open; if (open) fillInkPop(); });
$$('.slot').forEach((b, i) => b.addEventListener('click', () => {
  if (INK.tool === 'hl') { INK.hlSlot = i; INK.hl.c = INK.hlSlots[i]; syncInkBar(); persistInk(); return; }
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
  centreMusicGlyphs();
})();
// Bravura draws dynamics far above its baseline, so the letters looked lifted in their buttons.
// Measure the real ink of each glyph and move it to the middle of its box.
function centreMusicGlyphs() {
  document.fonts.load('26px Bravura').then(() => {
    const m = document.createElement('canvas').getContext('2d');
    const els = [...$$('#stampGrid button:not(.text):not(.finger):not(.shape):not(.roman):not(.emoji)'), ...$$('.stamp-ico')];
    for (const e of els) {
      const cs = getComputedStyle(e); const S = parseFloat(cs.fontSize) || 26;
      m.font = `${S}px Bravura`;
      if (e.dataset.centred) continue; const t = m.measureText(e.textContent); if (!t.actualBoundingBoxAscent && !t.actualBoundingBoxDescent) continue; e.dataset.centred = '1';
      const fA = t.fontBoundingBoxAscent ?? S * 0.8, fD = t.fontBoundingBoxDescent ?? S * 0.2;
      const base = (S - (fA + fD)) / 2 + fA;
      const inkMid = base - (t.actualBoundingBoxAscent - t.actualBoundingBoxDescent) / 2;
      e.style.lineHeight = S + 'px'; e.style.height = S + 'px';
      if (e.tagName === 'BUTTON') { const lab = e.textContent; e.textContent = ''; const sp = document.createElement('span'); sp.textContent = lab; sp.style.cssText = `display:block;height:${S}px;line-height:${S}px;transform:translateY(${(S / 2 - inkMid).toFixed(1)}px)`; e.style.height = ''; e.style.lineHeight = ''; e.append(sp); }
      else e.style.transform = `translateY(${(S / 2 - inkMid).toFixed(1)}px)`;
    }
  }).catch(() => {});
}
$$('.ink-tool[data-tool]').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.tool;
  const wasSame = INK.tool === t, popWasOpen = !$('#inkPop').hidden;
  closeInkPops(); clearSelection();
  if (t === 'eraser') { $('#eraserPop').hidden = false; syncEraserPop(); inkHint(NBK() ? 'Size and whole-line mode are in the pop-up.' : 'Size is in the pop-up.', 2200); }
  if (t === 'tape') { if (wasSame || !INK.tapeSeen) { $('#tapePop').hidden = false; syncTapePop(); INK.tapeSeen = true; } inkHint('Drag to lay a strip of tape.', 2200); }
  if ((t === 'pen' || t === 'hl') && wasSame && !popWasOpen) { INK.tool = t; syncInkBar(); $('#inkPop').hidden = false; fillInkPop(); return; }
  if (t === 'stamp') { $('#stampPop').hidden = wasSame && !$('#stampPop').hidden; $$('#stampGrid button').forEach((x) => x.classList.toggle('on', x.dataset.k === INK.stamp)); loadMusicFont(); }
  if (t === 'print') { $('#erasePop').hidden = wasSame; syncErasePop(); }   // stays open until you pick another tool, so the size bar can be used
  if (t === 'note') { if (INK.tool !== 'note') INK.beforeNote = INK.tool; INK.tool = t; syncInkBar(); inkHint('Tap the page where the note goes. Closed, it is a small tab that hides nothing; tap it to open it.', 3400); return; }
  if (t === 'select') inkHint(NBK() ? 'Tap a photo, text or line to select it, or draw a loop around several.' : 'Draw a loop around markings to select them.');
  if (t === 'text') inkHint('Tap where the words go, then type or write in the box with the Pencil. Tap a word to change it.', 3800);
  if (t === 'tbox') inkHint('Tap to place a text box, then type or write in it with the Pencil. Tap a box to change it.', 3800);
  if (t !== 'tbox') finishTextBox();
  if (t !== 'text') flushWord();
  INK.tool = t; syncInkBar(); persistInk();
}));
function syncErasePop() { $('#esSize').value = INK.white.size; $('#esSizeVal').textContent = INK.white.size; $('#esSizeRow').hidden = false; $$('#eraseMode button').forEach((x) => x.classList.toggle('on', x.dataset.mode === INK.erase)); $('#eraseHint').textContent = INK.erase === 'smart' ? 'Scribble over a printed fingering, dynamic, word or slur. Stand removes exactly that shape. Anything joined to the staff stays.' : 'Paint over any part of the printed page to cover it with paper colour.'; }
let erasePopT;
$('#esSize').addEventListener('input', (e) => { INK.white.size = +e.target.value; $('#esSizeVal').textContent = e.target.value; persistInk(); });
$$('#eraseMode button').forEach((b) => b.addEventListener('click', () => { INK.erase = b.dataset.mode; syncErasePop(); persistInk(); }));
$('#fingerBtn').addEventListener('click', () => { INK.finger = !INK.finger; syncInkBar(); persistInk(); inkHint(INK.finger ? 'Finger writing on. Two fingers zoom; swipe with two fingers to turn.' : 'Finger writing off. The Pencil writes, your finger turns pages.'); });
$('#inkBtn').addEventListener('click', () => setInking(!V.inking));
// Hide the markings to see the clean score (the markings stay where they are)
$('#hideInkBtn').addEventListener('click', () => {
  const on = !stage.classList.contains('hide-ink');
  stage.classList.toggle('hide-ink', on);
  $('#hideInkBtn').classList.toggle('on', on);
  $('#hideInkBtn').setAttribute('aria-pressed', String(on));
  if (on && V.inking) setInking(false);
});
$('#inkDone').addEventListener('click', () => setInking(false));
initNotes({
  hidden: isHiddenItem,
  hint: (t) => inkHint(t, 2200),
  change(entry, fn, undo) { const L = entry.layer, before = L.items.slice(), after = fn(before.slice()); L.setItems(after, true); if (undo) pushUndo(L.key, before, after.slice()); },
  undoStep(entry, before) { const L = entry.layer; if (JSON.stringify(before) !== JSON.stringify(L.items)) pushUndo(L.key, before, L.items.slice()); },
});

// ---------- layers: notes kept apart from your own markings ----------
// A score can have named layers (notes from a lesson, from listening to someone play). New
// markings go in the layer chosen here; a hidden layer is not drawn and cannot be touched.
const LY = { active: '' };
const scoreLayers = () => (V.score && V.score.layers) || [];
const lyHidden = (id) => (S.hidLy || []).includes(id);
function setLyHidden(id, hide) {
  const list = new Set(S.hidLy || []); if (hide) list.add(id); else list.delete(id);
  S.hidLy = [...list]; saveSettings(); setHiddenLayers(S.hidLy);
  markEdited(); phoneAnswers.clear();   // (the iPhone's copy shows what is shown here)
  clearSelection();
  for (const p of V.pages) if (p.layer && p.layer.ready) p.layer.redraw();
  PG.thumbs.forEach((t) => { t.stale = true; });
}
function useLayer(id) {
  if (id && lyHidden(id)) setLyHidden(id, false);    // writing in a layer shows it
  LY.active = id || ''; setActiveLayer(LY.active); syncLayerUi();
}
function syncLayerUi() {
  const L = scoreLayers().find((x) => x.id === LY.active);
  const chip = $('#lyChip'); chip.hidden = !L; chip.textContent = L ? L.name : '';
  $('#layerBtn').classList.toggle('on', !!L);
  if ($('#layerPop').hidden) return;
  const list = $('#lyList'); list.textContent = '';
  const row = (id, name) => {
    const r = el('div', 'ly-row' + (LY.active === id ? ' on' : '') + (id && lyHidden(id) ? ' off' : ''));
    const eye = el('button', 'ly-eye'); eye.setAttribute('aria-label', (id && lyHidden(id) ? 'Show ' : 'Hide ') + name);
    eye.innerHTML = '<svg><use href="#i-eye"/></svg>';
    if (!id) eye.disabled = true;
    eye.addEventListener('click', () => { const h = !lyHidden(id); setLyHidden(id, h); if (h && LY.active === id) LY.active = ''; setActiveLayer(LY.active); syncLayerUi(); inkHint(h ? `${name} is hidden.` : `${name} is shown.`, 1400); });
    const nm = el('button', 'ly-name'); nm.append(el('span', '', name)); if (LY.active === id) nm.append(el('em', '', 'writing here'));
    nm.addEventListener('click', () => { useLayer(id); inkHint(id ? `Writing in ${name}.` : 'Writing your own markings.', 1400); });
    r.append(eye, nm);
    if (id) {
      const del = el('button', 'ly-del'); del.setAttribute('aria-label', 'Delete ' + name); del.innerHTML = '<svg><use href="#i-trash"/></svg>';
      del.addEventListener('click', () => deleteLayer(id, name));
      r.append(del);
    }
    list.append(r);
  };
  row('', 'My markings');
  for (const x of scoreLayers()) row(x.id, x.name);
  $('#lyWhere').textContent = V.score ? V.score.title : '';
}
async function deleteLayer(id, name) {
  if (!(await ask(`Delete the layer “${name}”?`, { ok: 'Delete', danger: true, sub: 'Everything written in it, on every page, goes too.' }))) return;
  const sc = V.score; if (!sc) return;
  sc.layers = scoreLayers().filter((x) => x.id !== id); await db.put('scores', sc);
  const keys = (await db.keys('ink')).filter((k) => String(k).startsWith(sc.id + ':'));
  for (const k of keys) {
    const L = layerFor(k);
    if (L) { if (L.items.some((x) => x.ly === id)) L.setItems(L.items.filter((x) => x.ly !== id), true); continue; }
    const items = await loadItems(k).catch(() => []);
    if (items.some((x) => x.ly === id)) await saveItems(k, items.filter((x) => x.ly !== id));
  }
  V.undo = []; V.redo = []; syncInkBar(); markEdited(); phoneAnswers.clear();
  if (LY.active === id) LY.active = '';
  setActiveLayer(LY.active); setLyHidden(id, false); syncLayerUi();
}
$('#layerBtn').addEventListener('click', () => {
  const p = $('#layerPop'), open = p.hidden; closeInkPops(); p.hidden = !open;
  if (open) { syncLayerUi(); $('#lyName').value = ''; }
});
$('#lyNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#lyName').value.trim().slice(0, 40); if (!name || !V.score) { $('#lyName').focus(); return; }
  const sc = V.score;
  const id = 'ly' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  sc.layers = [...scoreLayers(), { id, name }]; await db.put('scores', sc);
  $('#lyName').value = ''; $('#lyName').blur();
  useLayer(id); inkHint(`Writing in ${name}. Hide it with the eye in Layers when you are done.`, 2600);
});


// ---------- undo (by page key, so it survives zooming, colour changes and page turns) ----------
function layerFor(key) { const p = V.pages.find((x) => x.layer && x.layer.key === key); return p && p.layer; }
// (passages are not part of undo: a passage marked or deleted since stays as it is now)
function applyItems(key, items) {
  const keep = (cur) => [...items.filter((x) => x.t !== 'passage'), ...cur.filter((x) => x.t === 'passage')];
  const L = layerFor(key);
  if (L) L.setItems(keep(L.items), true); else loadItems(key).then((cur) => saveItems(key, keep(cur)));
}
// undo or redo of a page not on show: that page is shown first, so the change is seen
function showUndoPage(u) {
  const keys = (u.group || [u]).map((x) => x.key);
  if (keys.some((k) => layerFor(k))) return false;
  const o = parseInt(String(keys[0]).split(':').pop(), 10); const i = isNaN(o) ? -1 : mappedOf(o);
  // (the page is on show already, its markings under another name, joined or cut since: undone here)
  if (i < 0 || i === V.page || (V.spread === 2 && i === V.page + 1)) return false;
  goTo(i); return true;
}
// (when the markings last changed: the iPhone's copy of the score knows it is out of date)
let editedT = 0, editedSc = null;
function markEdited() { if (!V.score) return; V.score.edited = Date.now(); editedSc = V.score; clearTimeout(editedT); editedT = setTimeout(flushEdited, 2500); try { phoneAnswers.clear(); } catch {} }
// (the new time written onto the score as it is now kept: never bringing back a score deleted, or a
// folder it has been moved out of, meanwhile)
async function flushEdited() {
  clearTimeout(editedT); editedT = 0;
  const sc = editedSc; editedSc = null; if (!sc) return;
  // (the score open: it is written as it is, being the newest of all)
  if (sc === V.score) { if (await db.get('scores', sc.id).catch(() => null)) await db.put('scores', V.score === sc ? sc : V.score || sc).catch(() => {}); return; }
  const cur = await db.get('scores', sc.id).catch(() => null); if (!cur) return;
  if ((cur.edited || 0) >= sc.edited) return;
  cur.edited = sc.edited; await db.put('scores', cur).catch(() => {});
}
function dropEdited(id) { if (editedSc && editedSc.id === id) { clearTimeout(editedT); editedT = 0; editedSc = null; } }
function pushUndo(key, before, after) { markEdited(); const pgNo = parseInt(String(key).split(':').pop(), 10); if (!isNaN(pgNo)) PG.edited.add(pgNo); V.undo.push({ key, before, after }); if (V.undo.length > 200) V.undo.shift(); V.redo = []; syncInkBar(); }
// a change to two pages at once (something moved from one page to the other) undoes in one step
function pushUndoGroup(list) { markEdited(); for (const x of list) { const pgNo = parseInt(String(x.key).split(':').pop(), 10); if (!isNaN(pgNo)) PG.edited.add(pgNo); } V.undo.push({ group: list }); if (V.undo.length > 200) V.undo.shift(); V.redo = []; syncInkBar(); }
function undo() { clearSelection(); const u = V.undo[V.undo.length - 1]; if (!u) return; if (showUndoPage(u)) { inkHint('This is the page that changes. Undo again to undo it.', 2200); return; } V.undo.pop(); for (const x of u.group || [u]) applyItems(x.key, x.before); V.redo.push(u); syncInkBar(); }
function redo() { clearSelection(); const u = V.redo[V.redo.length - 1]; if (!u) return; if (showUndoPage(u)) { inkHint('This is the page that changes. Redo again to redo it.', 2200); return; } V.redo.pop(); for (const x of u.group || [u]) applyItems(x.key, x.after); V.undo.push(u); syncInkBar(); }
$('#inkUndo').addEventListener('click', undo);
$('#inkRedo').addEventListener('click', redo);

// ---------- selection (lasso) ----------
const Sel = { entry: null, idx: [], box: null, el: null };
function clearSelection() {
  if (Sel.el && Sel.el.classList.contains('obj') && !tbEdit) { const tbb = $('#tbBar'); if (tbb && !tbb.hidden) { tbb.hidden = true; $('#inkbar').classList.remove('under'); $('#textPop').hidden = true; } }
  if (Sel.el) Sel.el.remove();
  if (Sel.bar) Sel.bar.remove();
  if (Sel.entry) Sel.entry.layer.redraw();
  Sel.entry = null; Sel.idx = []; Sel.box = null; Sel.el = null; Sel.bar = null; Sel.fr = null; Sel.dragging = false;
}
function selectionBox(entry, idx) {
  let b = null;
  for (const i of idx) { const r = itemBounds(entry.layer.items[i]); b = b ? { x0: Math.min(b.x0, r.x0), y0: Math.min(b.y0, r.y0), x1: Math.max(b.x1, r.x1), y1: Math.max(b.y1, r.y1) } : r; }
  return b;
}
// The frame of one photo, shape or text box: its own (unturned) box, its centre and its turn, so
// the selection turns with it and the handles stay on its corners. Page fractions.
function frameOf(s) {
  if (!s) return null;
  const A = Sel.entry ? (Sel.entry.ih / Sel.entry.iw) || 1.414 : 1.414;
  if (s.t === 'img') {
    const m = Math.min(s.w, s.h * A), pad = s.fr === 'white' || s.fr === 'polaroid' ? m * 0.045 : 0, bot = s.fr === 'polaroid' ? m * 0.2 : pad;
    const dy = (bot - pad) / 2, c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
    return { cx: s.x - sn * dy, cy: s.y + (c * dy) / A, w: s.w + pad * 2, h: s.h + (pad + bot) / A, rot: s.rot || 0 };
  }
  if (s.t === 'shape') return { cx: s.x, cy: s.y, w: s.w, h: Math.max(s.h, 0.004), rot: s.rot || 0 };
  if (s.t === 'tb') { const h = s.h || 0.04; return { cx: s.x + s.w / 2, cy: s.y + h / 2, w: s.w, h, rot: s.rot || 0 }; }
  return null;
}
function placeSelection() {
  if (!Sel.el || !Sel.box) return;
  // the frame follows the thing as it is now (after a change of size or style), except mid-drag
  if (Sel.fr && !Sel.dragging && Sel.entry && Sel.idx.length === 1) Sel.fr = frameOf(Sel.entry.layer.items[Sel.idx[0]]) || Sel.fr;
  const b = Sel.box, f = Sel.fr;
  if (f) {
    Object.assign(Sel.el.style, { left: (f.cx - f.w / 2) * 100 + '%', top: (f.cy - f.h / 2) * 100 + '%', width: f.w * 100 + '%', height: f.h * 100 + '%', transform: f.rot ? `rotate(${f.rot}rad)` : '' });
  } else Object.assign(Sel.el.style, { left: b.x0 * 100 + '%', top: b.y0 * 100 + '%', width: (b.x1 - b.x0) * 100 + '%', height: (b.y1 - b.y0) * 100 + '%', transform: '' });
  Sel.el.style.setProperty('--inv', 1 / Z.s);
  // the bar floats above the page (never cut off by the page's edge), clear of the tools at the
  // top and of the screen's edges: above the selection, else below it, else inside its top
  const bar = Sel.bar; if (!bar) return;
  const r = Sel.el.getBoundingClientRect(), ib = $('#inkbar').getBoundingClientRect(), tbb = $('#tbBar');
  const tops = [ib.bottom || 0, 60]; if (tbb && !tbb.hidden) tops.push(tbb.getBoundingClientRect().bottom || 0);
  const topLimit = Math.max(...tops) + 10;
  const obj = Sel.el.classList.contains('obj');
  const bw = bar.offsetWidth, bh = bar.offsetHeight, W = innerWidth, H = innerHeight;
  const gapUp = obj ? 46 : 10, gapDown = obj ? 16 : 10;
  let y;
  if (r.top - gapUp - bh >= topLimit) y = r.top - gapUp - bh;
  else if (r.bottom + gapDown + bh <= H - 16) y = r.bottom + gapDown;
  else y = Math.max(topLimit, Math.min(H - bh - 16, r.top + 12));
  y = Math.max(topLimit, Math.min(H - bh - 16, y));
  const x = Math.max(8, Math.min(W - bw - 8, r.left + r.width / 2 - bw / 2));
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}
function makeSelection(entry, idx) {
  const loop = Sel.pendingLoop; Sel.pendingLoop = null;
  clearSelection();
  if (!idx.length) return;
  Sel.entry = entry; Sel.idx = idx; Sel.box = selectionBox(entry, idx);
  const one = idx.length === 1 ? entry.layer.items[idx[0]] : null;
  Sel.fr = one ? frameOf(one) : null;
  const pic = one && one.t === 'img' ? one : null, tb = one && one.t === 'tb' ? one : null, shp = one && one.t === 'shape' ? one : null;
  const locked = idx.some((i) => entry.layer.items[i] && entry.layer.items[i].lock);
  const box = el('div', 'sel-box');
  if (pic || tb || shp) box.classList.add('obj');
  if (locked) box.classList.add('locked');
  const bar = el('div', 'sel-bar');
  const mk = (label, fn, cls) => {
    const b = el('button', cls || '', label);
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    b.addEventListener('pointerup', (e) => { e.stopPropagation(); fn(b); });
    return b;
  };
  // a short bar; the rest is one tap away under More
  const more = (...extra) => {
    const m = mk('More', (btn) => { const on = bar.classList.toggle('more'); btn.textContent = on ? 'Less' : 'More'; placeSelection(); }, 'sel-more');
    extra.forEach((x) => x.classList.add('extra'));
    return [m, ...extra];
  };
  const arrange = () => [mk('Front', () => reorderSelection(1)), mk('Back', () => reorderSelection(-1)), mk('Centre', centreSelection), mk('Lock', () => lockSelection(true)), mk('Copy', copySelection)];
  if (locked) {
    bar.append(mk('Unlock', () => lockSelection(false)));
  } else if (pic) {
    if (!pic.id) bar.append(mk('Add photo', () => { placeFor = { entry, i: idx[0] }; $('#insPlace').click(); }, 'accent'));
    if (pic.mask === 'word' || pic.mask === 'bloom') bar.append(mk('Word', () => { openPicPop('style'); setTimeout(() => { const w = $('#picWord'); if (w) { w.focus(); w.select(); } }, 60); }, 'accent'));
    bar.append(
      mk('Crop', (b) => { Sel.crop = !Sel.crop; box.classList.toggle('cropping', Sel.crop); b.classList.toggle('on', Sel.crop); b.textContent = Sel.crop ? 'Crop: done' : 'Crop'; if (Sel.crop) inkHint('Drag a corner to trim the photo. The photo stays where it is.', 3000); }),
      mk('Adjust', () => openPicPop('adjust')), mk('Style', () => openPicPop('style')),
      mk('Duplicate', duplicateSelection), mk('Delete', deleteSelection, 'danger'),
      ...more(mk('Flip', () => flipSelection()), ...arrange()),
    );
  } else if (shp) {
    bar.append(mk('Style', () => openShapePop()), mk('Colour', () => editSelection((s) => (s.k === 'line' ? { ...s, lc: penColor() } : { ...s, f: penColor(), metal: undefined }))),
      mk('Duplicate', duplicateSelection), mk('Delete', deleteSelection, 'danger'),
      ...more(mk('Flip', () => flipSelection()), ...arrange()));
  } else if (tb) {
    // in a notebook the text bar above already has Edit text
    bar.append(...(NBK() ? [] : [mk('Edit', () => { const e2 = Sel.entry, i = Sel.idx[0]; clearSelection(); startTextBox(e2, null, i); })]),
      mk('Duplicate', duplicateSelection), mk('Delete', deleteSelection, 'danger'), ...more(...arrange()));
  } else {
    bar.append(
      mk('Colour', () => editSelection((s) => (s.t === 'pen' || s.t === 'stamp' ? { ...s, c: penColor() } : s.t === 'tb' ? { ...s, c: penColor() } : s))),
      ...(NBK() || loop ? [] : [mk('Passage', () => markRegion(entry.layer.key, { ...Sel.box }))]),
      mk('Duplicate', duplicateSelection), mk('Delete', deleteSelection, 'danger'),
      ...(NBK() ? more(...arrange()) : [mk('Copy', copySelection)]),
    );
  }
  if (loop && !NBK()) bar.prepend(mk('Passage', () => { const k = entry.layer.key; clearSelection(); markRegion(k, loop); }, 'accent'));
  // four corners to resize (from the opposite corner); a photo also turns by its top handle
  if (!locked) {
    for (const c of ['nw', 'ne', 'sw', 'se']) { const h = el('div', 'sel-handle ' + c); h.dataset.c = c; box.append(h); }
    if (tb || (shp && shp.k !== 'line')) for (const c of ['e', 'w']) { const h = el('div', 'sel-side ' + c); h.dataset.c = c; box.append(h); }
    if (pic || shp || tb) { const r = el('div', 'sel-rot'); r.dataset.c = 'rot'; box.append(r); const ang = el('div', 'sel-angle num'); ang.hidden = true; box.append(ang); }
  }
  bar.classList.add('float');
  entry.inner.append(box);
  $('#score').append(bar);
  Sel.el = box; Sel.bar = bar; placeSelection();
  if (tb && NBK()) { $('#tbBar').hidden = false; $('#inkbar').classList.add('under'); syncTbBar(); }
  let drag = null;
  const pagePx = (e, r) => { const f = fracOf(e.clientX, e.clientY, r), PS = pageSize(r); return [f[0] * PS[0], f[1] * PS[1]]; };
  box.addEventListener('pointerdown', (e) => {
    // writing with the Pencil over something chosen writes (it never moves what is chosen);
    // the Pencil moves things only with the lasso tool, or by their handles
    if (e.pointerType === 'pen' && INK.tool !== 'select' && !(e.target.dataset && e.target.dataset.c)) { clearSelection(); return; }
    e.preventDefault(); e.stopPropagation();
    if (locked) return;
    box.setPointerCapture(e.pointerId);
    const r = entry.inner.getBoundingClientRect(), PS = pageSize(r);
    const c = e.target.dataset && e.target.dataset.c;
    const b0 = { ...Sel.box }, f0 = Sel.fr ? { ...Sel.fr } : null;
    const corner = (k) => {
      if (!f0) return [(k.includes('w') ? b0.x0 : b0.x1) * PS[0], (k.includes('n') ? b0.y0 : b0.y1) * PS[1]];
      // a corner of the turned frame, in page pixels
      const lx = (k.includes('w') ? -0.5 : 0.5) * f0.w * PS[0], ly = (k.includes('n') ? -0.5 : 0.5) * f0.h * PS[1], c = Math.cos(f0.rot), sn = Math.sin(f0.rot);
      return [f0.cx * PS[0] + lx * c - ly * sn, f0.cy * PS[1] + lx * sn + ly * c];
    };
    const opp = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
    drag = { mode: c ? (c === 'rot' ? 'rot' : c === 'e' || c === 'w' ? 'width' : Sel.crop ? 'crop' : 'scale') : 'move', c, r, PS, b0, p0: pagePx(e, r), items: Sel.idx.map((i) => entry.layer.items[i]) };
    if (c && c !== 'rot') { drag.C = corner(c); drag.A = corner(opp[c]); }
    drag.f0 = f0;
    // turning: about the middle of the thing, following the finger round
    if (c === 'rot') { drag.rx = (f0 ? f0.cx : (b0.x0 + b0.x1) / 2) * PS[0]; drag.ry = (f0 ? f0.cy : (b0.y0 + b0.y1) / 2) * PS[1]; drag.a0 = Math.atan2(drag.p0[1] - drag.ry, drag.p0[0] - drag.rx); drag.rot0 = (drag.items[0].rot || 0); }
  });
  const shaped = (d, P) => {
    const PS = d.PS, dx = (P[0] - d.p0[0]) / PS[0], dy = (P[1] - d.p0[1]) / PS[1];
    if (d.mode === 'move') {
      // pink guides, like a design app: the edges and middles of the things around it, the middle
      // and the margins of the page pull the selection into line
      if (!d.lines) d.lines = snapLines(entry, Sel.idx);
      const b = { x0: d.b0.x0 + dx, x1: d.b0.x1 + dx, y0: d.b0.y0 + dy, y1: d.b0.y1 + dy };
      const sx = snapAxis([b.x0, (b.x0 + b.x1) / 2, b.x1], d.lines.x, 7 / PS[0]);
      const sy = snapAxis([b.y0, (b.y0 + b.y1) / 2, b.y1], d.lines.y, 7 / PS[1]);
      const mx = dx + (sx ? sx.d : 0), my = dy + (sy ? sy.d : 0);
      showGuides(entry, sx ? sx.at : null, sy ? sy.at : null);
      return d.items.map((s) => transformItem(s, mx, my, 1, 0, 0));
    }
    if (d.mode === 'scale') {
      const vx = d.C[0] - d.A[0], vy = d.C[1] - d.A[1];
      const k = clamp(((P[0] - d.A[0]) * vx + (P[1] - d.A[1]) * vy) / (vx * vx + vy * vy || 1), 0.08, 10);
      return d.items.map((s) => transformItem(s, 0, 0, k, d.A[0] / PS[0], d.A[1] / PS[1]));
    }
    if (d.mode === 'rot') {
      // the angle the finger has gone round the middle (unwrapped, so it never jumps a full turn)
      let a = Math.atan2(P[1] - d.ry, P[0] - d.rx) - d.a0;
      while (a - (d.lastA || 0) > Math.PI) a -= 2 * Math.PI;
      while (a - (d.lastA || 0) < -Math.PI) a += 2 * Math.PI;
      d.lastA = a;
      const s0 = d.items[0], tot = d.rot0 + a;
      // a pull towards straight (every 45°), like a design app
      const q = Math.round(tot / (Math.PI / 4)) * (Math.PI / 4);
      const rot = Math.abs(tot - q) < 0.05 ? q : tot;
      d.deg = Math.round(((rot * 180 / Math.PI) % 360 + 360) % 360);
      return [{ ...s0, rot: +rot.toFixed(4) }];
    }
    if (d.mode === 'crop') return [cropPicture(d.items[0], d.c, P[0] - d.p0[0], P[1] - d.p0[1], PS)];
    // the side handles: along the thing's own width, even when it is turned
    const rot0 = d.items[0] && d.items[0].rot ? d.items[0].rot : 0;
    const along = ((P[0] - d.p0[0]) * Math.cos(rot0) + (P[1] - d.p0[1]) * Math.sin(rot0)) / PS[0];
    if (d.mode === 'width' && d.items[0].t === 'shape') {
      const s0 = d.items[0], nw = clamp(s0.w + (d.c === 'e' ? along : -along) * 2, 0.02, 2);
      return [{ ...s0, w: nw }];
    }
    if (d.mode === 'width') {
      // the sides change how wide the box is; the words flow to fit (the box keeps its middle when turned)
      const s0 = d.items[0];
      if (rot0) { const nw = clamp(s0.w + (d.c === 'e' ? along : -along), 0.06, 1.2); const t = measureTextBox({ ...s0, w: nw }); return [{ ...t, x: s0.x + (s0.w - nw) / 2, y: s0.y + ((s0.h || 0.04) - t.h) / 2 }]; }
      if (d.c === 'e') return [measureTextBox({ ...s0, w: clamp(s0.w + along, 0.06, 1.2) })];
      const nw = clamp(s0.w - along, 0.06, 1.2); return [measureTextBox({ ...s0, x: s0.x + (s0.w - nw), w: nw })];
    }
    return d.items;
  };
  // the page without the chosen things is drawn once; while dragging only they are drawn, once a frame
  let raf = 0;
  const frame = () => {
    raf = 0; if (!drag || !drag.P) return;
    const P = drag.P;
    drag.out = shaped(drag, P);
    if (!drag.hid) { entry.layer.redraw(new Set(Sel.idx)); drag.hid = true; }
    clearLive();
    // dragged onto the other page of the spread: it is drawn there, where it will land
    const other = drag.mode === 'move' ? otherPageAt(entry, drag.cx, drag.cy) : null;
    drag.to = other;
    for (const it of drag.out) { if (other) drawLiveItem(other, toOtherPage(entry, other, it), null, false); else drawLiveItem(entry, it, null, false); }
    if (Sel.el) Sel.el.style.visibility = other ? 'hidden' : '';
    let bb = null; for (const it of drag.out) { const q = itemBounds(it); bb = bb ? { x0: Math.min(bb.x0, q.x0), y0: Math.min(bb.y0, q.y0), x1: Math.max(bb.x1, q.x1), y1: Math.max(bb.y1, q.y1) } : q; }
    Sel.box = bb; if (drag.f0 && drag.out.length === 1) Sel.fr = frameOf(drag.out[0]);
    placeSelection();
    // the angle while turning
    const ang = Sel.el && Sel.el.querySelector('.sel-angle');
    if (drag.mode === 'rot' && ang) { ang.hidden = false; ang.textContent = drag.deg + '°'; ang.style.transform = `translate(-50%, -50%) rotate(${-(Sel.fr ? Sel.fr.rot : 0)}rad) scale(var(--inv, 1))`; }
  };
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.cx = e.clientX; drag.cy = e.clientY;
    const P = pagePx(e, drag.r);
    if (Math.hypot(P[0] - drag.p0[0], P[1] - drag.p0[1]) > 2) drag.moved = true;
    if (!drag.moved) return;
    drag.P = P; Sel.dragging = true;
    if (!raf) raf = requestAnimationFrame(frame);
  });
  const end = () => {
    if (!drag) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; if (drag.P) { const d0 = drag; frame(); drag = d0; } }
    const d = drag; drag = null; Sel.dragging = false; clearLive(); showGuides(entry, false, false);
    const ang = Sel.el && Sel.el.querySelector('.sel-angle'); if (ang) ang.hidden = true;
    if (!d.moved || !d.out) {
      Sel.box = d.b0; if (d.f0) Sel.fr = d.f0; placeSelection(); entry.layer.redraw();
      // a tap on a chosen text box: write in it
      if (d.mode === 'move' && tb && NBK() && Sel.idx.length === 1) { const i = Sel.idx[0]; clearSelection(); startTextBox(entry, null, i); }
      return;
    }
    if (d.to && d.to.layer && d.to.layer.ready) {
      // onto the other page: taken off this one and put on that one, in the same place on screen
      const to = d.to, moved = d.out.map((it) => ({ ...toOtherPage(entry, to, it), ly: it.ly || '' }));
      const b1 = entry.layer.items.slice(), a1 = b1.filter((_, i) => !Sel.idx.includes(i));
      const b2 = to.layer.items.slice(), a2 = [...b2, ...moved];
      entry.layer.setItems(a1); to.layer.setItems(a2);
      pushUndoGroup([{ key: entry.layer.key, before: b1, after: a1.slice() }, { key: to.layer.key, before: b2, after: a2.slice() }]);
      clearSelection(); lastEntry = to;
      makeSelection(to, moved.map((_, k) => b2.length + k));
      return;
    }
    const before = entry.layer.items.slice();
    const after = before.slice(); Sel.idx.forEach((i, k) => { after[i] = d.out[k]; });
    entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
    Sel.box = selectionBox(entry, Sel.idx); if (Sel.idx.length === 1) Sel.fr = frameOf(after[Sel.idx[0]]); placeSelection();
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
// The other page of a two-page spread under a point (not the page the thing came from).
function otherPageAt(entry, x, y) {
  if (x == null) return null;
  const p = entryAt(x, y);
  return p && p !== entry && p.inner && p.layer ? p : null;
}
// An item from one page, in the coordinates of another page, so it stays where it is on screen.
function toOtherPage(from, to, it) {
  const r1 = from.inner.getBoundingClientRect(), r2 = to.inner.getBoundingClientRect();
  const P1 = pageSize(r1), P2 = pageSize(r2);
  const k = P1[0] / P2[0];
  const [ox, oy] = fracOf(r1.left, r1.top, r2);   // where page one's corner is, on page two
  if (TURN()) return it;                           // never two pages when turned
  return transformItem(it, ox, oy, k, 0, 0);
}
// Trim a photo from one corner: the picture stays where it is on the page, only less of it shows.
function cropPicture(s, c, dxp, dyp, PS) {
  const W = PS[0], H = PS[1], rot = s.rot || 0, co = Math.cos(-rot), si = Math.sin(-rot);
  const lx = dxp * co - dyp * si, ly = dxp * si + dyp * co;   // the drag in the photo's own frame
  const w = s.w * W, h = s.h * H, cr = s.cr || [0, 0, 1, 1];
  const fw = w / (cr[2] - cr[0]), fh = h / (cr[3] - cr[1]);
  const L0 = -w / 2 - cr[0] * fw, T0 = -h / 2 - cr[1] * fh, R0 = L0 + fw, B0 = T0 + fh;
  let l = -w / 2, t = -h / 2, r = w / 2, b = h / 2;
  const min = 16;
  if (c.includes('w')) l = clamp(l + lx, L0, r - min); else r = clamp(r + lx, l + min, R0);
  if (c.includes('n')) t = clamp(t + ly, T0, b - min); else b = clamp(b + ly, t + min, B0);
  const ncr = [(l - L0) / fw, (t - T0) / fh, (r - L0) / fw, (b - T0) / fh].map((v) => +clamp(v, 0, 1).toFixed(5));
  const mx = (l + r) / 2, my = (t + b) / 2, c2 = Math.cos(rot), s2 = Math.sin(rot);
  const cx = s.x * W + mx * c2 - my * s2, cy = s.y * H + mx * s2 + my * c2;
  return { ...s, cr: ncr, x: +(cx / W).toFixed(5), y: +(cy / H).toFixed(5), w: +((r - l) / W).toFixed(5), h: +((b - t) / H).toFixed(5) };
}
function reorderSelection(dir) {
  const entry = Sel.entry; if (!entry) return;
  const before = entry.layer.items.slice();
  const picked = Sel.idx.map((i) => before[i]);
  const rest = before.filter((_, i) => !Sel.idx.includes(i));
  const after = dir > 0 ? [...rest, ...picked] : [...picked, ...rest];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  makeSelection(entry, picked.map((x) => after.indexOf(x)));
  inkHint(dir > 0 ? 'In front' : 'Behind', 1000);
}
// Lines things can line up with: page middle and margins, and the edges and middles of the other
// things on the page.
function snapLines(entry, skip) {
  const x = [0.5, 0.06, 0.94], y = [0.5, 0.05, 0.95];
  entry.layer.items.forEach((s, i) => {
    if (skip.includes(i) || s.t === 'bg' || s.t === 'passage' || s.t === 'mask') return;
    const b = itemBounds(s); if (!b || !isFinite(b.x0)) return;
    x.push(b.x0, (b.x0 + b.x1) / 2, b.x1); y.push(b.y0, (b.y0 + b.y1) / 2, b.y1);
  });
  return { x, y };
}
// the closest line to any of the edges, within reach: how far to move, and where the guide is
function snapAxis(edges, lines, reach) {
  let best = null;
  for (const e of edges) for (const l of lines) { const d = l - e; if (Math.abs(d) < reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l }; }
  return best;
}
function showGuides(entry, gx, gy) {
  let g = entry.inner.querySelector('.guide-x'); if (!g) { g = el('div', 'guide-x'); entry.inner.append(g); }
  let h = entry.inner.querySelector('.guide-y'); if (!h) { h = el('div', 'guide-y'); entry.inner.append(h); }
  const ax = typeof gx === 'number' ? gx : gx === true ? 0.5 : null, ay = typeof gy === 'number' ? gy : gy === true ? 0.5 : null;
  g.hidden = ax === null; if (ax !== null) g.style.left = (ax * 100) + '%';
  h.hidden = ay === null; if (ay !== null) h.style.top = (ay * 100) + '%';
  // a little tick when it lands on a line, as a design app does
  const key = (ax ?? '') + '|' + (ay ?? '');
  if ((ax !== null || ay !== null) && showGuides.last !== key && navigator.vibrate) { try { navigator.vibrate(5); } catch {} }
  showGuides.last = key;
}
function centreSelection() {
  const b = Sel.box; if (!b) return;
  const dx = 0.5 - (b.x0 + b.x1) / 2;
  editSelection((s) => transformItem(s, dx, 0, 1, 0, 0), true);
  inkHint('Centred on the page', 1200);
}
function lockSelection(on) {
  const entry = Sel.entry, idx = Sel.idx.slice(); if (!entry) return;
  const before = entry.layer.items.slice();
  const after = before.map((s, i) => (idx.includes(i) ? (on ? { ...s, lock: 1 } : (({ lock, ...r }) => r)(s)) : s));
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  makeSelection(entry, idx);
  inkHint(on ? 'Locked: it stays where it is. Tap it with the lasso to unlock.' : 'Unlocked', 2200);
}
function flipSelection() { editSelection((s) => ({ ...s, fx: s.fx ? 0 : 1 }), true); }
// the look of a chosen shape
function selShape() { return Sel.entry && Sel.idx.length === 1 && Sel.entry.layer.items[Sel.idx[0]].t === 'shape' ? Sel.entry.layer.items[Sel.idx[0]] : null; }
function openShapePop() {
  const s0 = selShape(); if (!s0) return;
  closeInkPops(); $('#shapePop').hidden = false;
  const row = (id, key, list, withNone) => {
    const g = $(id); g.textContent = '';
    for (const c of [...(withNone ? [''] : []), ...list]) {
      const b = el('button', 'tp-col' + ((s0[key] || '') === c ? ' on' : '')); b.style.setProperty('--c', c || 'transparent'); if (!c) b.classList.add('none');
      b.addEventListener('click', () => { shapeEdit((s) => ({ ...s, [key]: c, ...(key === 'f' ? { metal: undefined } : {}), ...(key === 'lc' && c && !s.lw ? { lw: 0.004 } : {}) })); openShapePop(); });
      g.append(b);
    }
  };
  row('#spFill', 'f', PALETTE.slice(0, 20), true); row('#spGrad2', 'g2', ['#ffffff', '#ffd6e0', '#fff1c1', '#d6e8ff', '#e9ddff', '#ff9f1c', '#2ec4ff', '#c86bfa', '#16181d'], false); row('#spLine', 'lc', PALETTE.slice(0, 20), true);
  fillPalSets(s0.f, (c) => { shapeEdit((s) => ({ ...s, f: c, metal: undefined })); openShapePop(); }, $('#spPals'));
  const mt = $('#spMetal'); mt.textContent = '';
  for (const [k, label] of [['', 'Colour'], ['gold', 'Gold'], ['rose', 'Rose gold'], ['silver', 'Silver'], ['copper', 'Copper']]) {
    const b = el('button', (s0.metal || '') === k ? 'on' : '', label);
    b.addEventListener('click', () => { shapeEdit((s) => ({ ...s, metal: k || undefined })); openShapePop(); });
    mt.append(b);
  }
  $('#spGrad').checked = !!s0.g; $('#spShadow').checked = !!s0.sh; $('#spArrow').checked = !!s0.ah; $('#spArrowRow').hidden = s0.k !== 'line';
  $('#spLw').value = Math.round((s0.lw || 0) * 1000); $('#spAlpha').value = Math.round((s0.a ?? 1) * 100);
}
const SPX = { before: null, t: 0 };
function shapeEdit(fn) {
  const entry = Sel.entry, s0 = selShape(); if (!s0) return;
  if (!SPX.before) SPX.before = entry.layer.items.slice();
  const items = entry.layer.items.slice(); items[Sel.idx[0]] = fn(s0);
  entry.layer.items = items; entry.layer.redraw(); entry.layer.save();
  Sel.box = selectionBox(entry, Sel.idx); placeSelection();
  clearTimeout(SPX.t); SPX.t = setTimeout(() => { if (SPX.before) { pushUndo(entry.layer.key, SPX.before, entry.layer.items.slice()); SPX.before = null; } }, 700);
}
$('#spGrad').addEventListener('change', (e) => shapeEdit((s) => ({ ...s, g: e.target.checked ? 1 : 0, g2: s.g2 || '#ffffff' })));
$('#spShadow').addEventListener('change', (e) => shapeEdit((s) => ({ ...s, sh: e.target.checked ? 1 : 0 })));
$('#spArrow').addEventListener('change', (e) => shapeEdit((s) => ({ ...s, ah: e.target.checked ? 1 : 0 })));
$('#spLw').addEventListener('input', (e) => shapeEdit((s) => ({ ...s, lw: +e.target.value / 1000, lc: s.lc || penColor() })));
$('#spAlpha').addEventListener('input', (e) => shapeEdit((s) => ({ ...s, a: +e.target.value / 100 })));
let CLIP = null;
function copySelection() {
  const entry = Sel.entry; if (!entry) return;
  CLIP = Sel.idx.map((i) => JSON.parse(JSON.stringify(entry.layer.items[i])));
  inkHint('Copied. Hold a finger on any page to paste it.', 2200);
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

// ---------- notebooks: photos, text boxes, pens ----------
const NBK = () => !!(V.file && V.file.kind === 'paper');
window.__nbCount = () => V.pages.map((p) => (p.layer ? p.layer.items.filter((x) => x.t !== 'bg').map((x) => x.t).join('+') || '-' : '?')).join(' , ');
// the page in the middle of the screen
let lastEntry = null;
function centreEntry() {
  const sr = stage.getBoundingClientRect();
  return entryAt(sr.left + sr.width / 2, sr.top + sr.height / 2) || (lastEntry && V.pages.includes(lastEntry) ? lastEntry : V.pages[0]);
}
async function insertPictures(files, at) {
  const imgs = [...files].filter((f) => f && /^image\//.test(f.type));
  if (!imgs.length) return false;
  const entry = at ? at.entry : centreEntry(); if (!entry || !entry.layer) return false;
  await entry.layer.loaded;
  if (!V.inking) setInking(true);
  inkHint('Adding the photo…', 3000);
  const before = entry.layer.items.slice(), added = [];
  const r = entry.inner.getBoundingClientRect(), PS = pageSize(r), aspect = PS[1] / PS[0];
  let k = 0;
  for (const f of imgs) {
    try {
      const pic = await putPicture(f);
      // fit in 60% of the width and 45% of the height of the page, keeping its shape
      let w = 0.6, h = (w * (pic.h / pic.w)) / aspect;
      if (h > 0.45) { h = 0.45; w = (h * aspect * pic.w) / pic.h; }
      const cx = at ? at.p[0] : 0.5, cy = at ? at.p[1] : 0.42;
      added.push({ t: 'img', id: pic.id, x: +clamp(cx + k * 0.03, w / 2, 1 - w / 2).toFixed(5), y: +clamp(cy + k * 0.03, h / 2, 1 - h / 2).toFixed(5), w: +w.toFixed(5), h: +h.toFixed(5), rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0 });
      k++;
    } catch { toast('That picture could not be opened.'); }
  }
  if (!added.length) return false;
  const after = [...before, ...added];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  INK.tool = 'select'; syncInkBar();
  makeSelection(entry, added.map((_, i) => before.length + i));
  inkHint('Drag to move. Corners resize, the top handle turns it.', 3000);
  return true;
}
function pasteItems(items, entry) {
  entry = entry || centreEntry(); if (!entry || !items || !items.length) return;
  if (!V.inking) setInking(true);
  const before = entry.layer.items.slice();
  const copies = items.map((x) => transformItem(JSON.parse(JSON.stringify(x)), 0.015, 0.015, 1, 0, 0));
  const after = [...before, ...copies];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  INK.tool = 'select'; syncInkBar();
  makeSelection(entry, copies.map((_, i) => before.length + i));
}
async function pasteFromClipboard() {
  // photos and words copied in other apps
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const list = await navigator.clipboard.read();
      for (const it of list) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { const b = await it.getType(type); if (await insertPictures([new File([b], 'pasted', { type })])) return; }
      }
      for (const it of list) if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); if (t.trim()) { addTextBox('body', t.trim()); return; } }
    }
  } catch {}
  if (CLIP) { pasteItems(CLIP); return; }
  toast('Nothing to paste. Copy a photo or some words first.');
}
document.addEventListener('paste', (e) => {
  if ($('#score').hidden || !NBK()) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const files = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (files.length) { e.preventDefault(); insertPictures(files); return; }
  const txt = e.clipboardData && e.clipboardData.getData('text/plain');
  if (txt && txt.trim()) { e.preventDefault(); addTextBox('body', txt.trim()); return; }
  if (CLIP) { e.preventDefault(); pasteItems(CLIP); }
});
stage.addEventListener('dragover', (e) => { if (NBK()) e.preventDefault(); });
stage.addEventListener('drop', (e) => {
  if (!NBK()) return;
  e.preventDefault();
  const entry = entryAt(e.clientX, e.clientY);
  const at = entry ? { entry, p: fracOf(e.clientX, e.clientY, entry.inner.getBoundingClientRect()) } : null;
  insertPictures(e.dataTransfer ? e.dataTransfer.files : [], at);
});
// the insert menu
(function buildInsert() {
  const box = $('#insStyles');
  for (const st of TEXT_STYLES) {
    const b = el('button', 'ins-style', st.label);
    b.style.font = `${st.b ? 700 : 400} ${st.k === 'title' ? 24 : st.k === 'fancy' ? 22 : st.k === 'heading' ? 18 : 15}px ${FONTS[st.ff].css}`;
    // the button shows the style's own colours (light words on the chalkboard, and so on)
    if (st.bg) { b.style.background = st.bg; const c = st.c || '#1d1d1f'; const lum = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return 0.2; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }; b.style.color = Math.abs(lum(c) - lum(st.bg)) > 0.35 ? c : (lum(st.bg) < 0.5 ? '#ffffff' : '#1d1d1f'); }
    b.addEventListener('click', () => { closeInkPops(); addTextBox(st.k); });
    box.append(b);
  }
})();
$('#inkInsert').addEventListener('click', () => { const p = $('#insertPop'); const open = p.hidden; closeInkPops(); clearSelection(); p.hidden = !open; if (open) insTab(INS.tab); });
// the add menu, by kind: photos, text, elements, stickers, layouts, background
const INS = { tab: 'photos' };
function insTab(t) {
  INS.tab = t; if (t === 'layouts') drawLayoutThumbs();
  $$('#insTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
  $$('#insertPop .ins-pane').forEach((p) => { p.hidden = p.dataset.pane !== t; });
}
$$('#insTabs button').forEach((b) => b.addEventListener('click', () => insTab(b.dataset.v)));
// put a new thing on the page in the middle of the screen, and choose it
function addItems(items, select = true) {
  const entry = centreEntry(); if (!entry) return null;
  if (!V.inking) setInking(true);
  closeInkPops(); clearSelection();
  // a new thing never lands exactly on top of the last one
  if (items.length === 1 && items[0].x != null && items[0].t !== 'bg') {
    const it = items[0] = { ...items[0] };
    for (let k = 0; k < 8 && entry.layer.items.some((o) => o.x != null && Math.abs(o.x - it.x) < 0.01 && Math.abs(o.y - it.y) < 0.01); k++) { it.x += 0.035; it.y += 0.03; }
  }
  const before = entry.layer.items.slice(), after = [...before, ...items];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  if (select) { INK.tool = 'select'; syncInkBar(); makeSelection(entry, items.map((_, i) => before.length + i)); }
  return entry;
}
const ELX = { cat: 'shapes' };
function buildShapes() {
  const cats = $('#elCats');
  if (!cats.childElementCount) {
    for (const [k, label] of [['shapes', 'Shapes'], ...ELEMENT_CATS]) {
      const b = el('button', '', label); b.dataset.v = k;
      b.addEventListener('click', () => { ELX.cat = k; buildShapes(); });
      cats.append(b);
    }
  }
  $$('#elCats button').forEach((b) => b.classList.toggle('on', b.dataset.v === ELX.cat));
  $('#elHint').hidden = ELX.cat !== 'shapes';
  const g = $('#insShapes'); g.textContent = '';
  const demoCol = '#3d4350';
  const list = ELX.cat === 'shapes' ? [...SHAPES, ['arrowline', 'Arrow line']].map(([k, label]) => ({ k, label, shape: true })) : ELEMENTS.filter((e) => e.cat === ELX.cat).map((e) => ({ k: 'e:' + e.k, label: e.label, ar: elementAspect(e.k) }));
  for (const it0 of list) {
    const { k, label } = it0;
    const b = el('button', 'ins-shape'); const c = el('canvas'); c.width = 120; c.height = 90; b.append(c, el('span', '', label));
    let demo;
    if (k === 'line' || k === 'arrowline') demo = { t: 'shape', k: 'line', ah: k === 'arrowline' ? 1 : 0, x: 0.5, y: 0.5, w: 0.7, h: 0.05, lc: '#2b6fd6', lw: 0.03 };
    else if (k === 'glass') demo = { t: 'shape', k, x: 0.5, y: 0.5, w: 0.7, h: 0.66, f: '#ffffff' };
    else if (it0.shape) demo = { t: 'shape', k, x: 0.5, y: 0.5, w: 0.62, h: 0.78, f: '#2b6fd6' };
    else { const ar = it0.ar, bw = Math.min(0.8, 0.72 * ar * 0.75), bh = (bw * 120) / ar / 90; demo = { t: 'shape', k, x: 0.5, y: 0.5, w: bw, h: Math.min(0.82, bh), f: demoCol }; if (bh > 0.82) demo.w = (0.82 * 90 * ar) / 120; }
    const g2 = c.getContext('2d');
    if (k === 'glass') { const gr = g2.createLinearGradient(0, 0, 120, 90); gr.addColorStop(0, '#e8907a'); gr.addColorStop(1, '#6a8fb5'); g2.fillStyle = gr; g2.fillRect(0, 0, 120, 90); }
    drawItem(g2, demo, 120, 90);
    b.addEventListener('click', () => addElement(it0));
    g.append(b);
  }
}
function addElement(it0) {
  const { k } = it0, col = penColor();
  let it;
  if (k === 'line' || k === 'arrowline') it = { t: 'shape', k: 'line', ah: k === 'arrowline' ? 1 : 0, x: 0.5, y: 0.45, w: 0.4, h: 0.02, lc: col, lw: 0.004, a: 1, rot: 0 };
  else if (k === 'glass') it = { t: 'shape', k, x: 0.5, y: 0.45, w: 0.62, h: 0.3, f: '#ffffff', a: 1, rot: 0 };
  else if (it0.shape) it = { t: 'shape', k, x: 0.5, y: 0.42, w: 0.3, h: k === 'banner' ? 0.08 : k === 'bubble' || k === 'cloud' ? 0.16 : k === 'bars' ? 0.3 : 0.3 / 1.414, f: k === 'bubble' || k === 'cloud' ? '#ffffff' : col, lc: k === 'bubble' || k === 'cloud' ? col : '', lw: k === 'bubble' || k === 'cloud' ? 0.003 : 0, a: 1, rot: 0 };
  else {
    const e = k.slice(2), cat = ELEMENTS.find((x) => x.k === e).cat;
    const w = cat === 'divider' ? 0.56 : cat === 'frame' ? 0.42 : cat === 'arrow' || cat === 'doodle' ? 0.3 : 0.24;
    it = { t: 'shape', k, x: 0.5, y: 0.42, w, h: w / it0.ar / 1.414, f: col, a: 1, rot: 0 };
  }
  addItems([it]);
}
buildShapes();
// music stickers, drawn with the music font
(function buildMusicStickers() {
  const G = [['\uE050', 'Treble clef'], ['\uE062', 'Bass clef'], ['\uE05C', 'Alto clef'], ['\uE1D2', 'Whole note'], ['\uE1D3', 'Half note'], ['\uE1D5', 'Crotchet'], ['\uE1D7', 'Quaver'], ['\uE4C0', 'Fermata'], ['\uE047', 'Segno'], ['\uE048', 'Coda'], ['\uE522', 'Forte'], ['\uE520', 'Piano'], ['\uE4E5', 'Rest'], ['\uE08A', 'Common time'], ['\uE262', 'Sharp'], ['\uE260', 'Flat']];
  const g = $('#insMusic');
  for (const [ch, label] of G) {
    const b = el('button', 'sticker music', ch); b.setAttribute('aria-label', label);
    b.addEventListener('click', () => addItems([{ t: 'stamp', k: 'mus', e: ch, c: penColor(), a: 1, s: 0.05, x: 0.5, y: 0.45 }]));
    g.append(b);
  }
})();
// page backgrounds
(function buildBackgrounds() {
  const g = $('#insBgs');
  for (const [c, c2] of BACKGROUNDS) {
    const b = el('button', 'ins-bg'); b.style.background = c2 ? `linear-gradient(135deg, ${c}, ${c2})` : c;
    b.addEventListener('click', () => setBackground({ c, c2: c2 || '' }));
    g.append(b);
  }
  const pats = $('#insPats');
  for (const [k, label] of BG_PATTERNS) { const b = el('button', '', label); b.dataset.v = k; b.addEventListener('click', () => setBackground({ pat: k })); pats.append(b); }
  $('#insBgNone').addEventListener('click', () => setBackground(null));
})();
function setBackground(ch) {
  const entry = centreEntry(); if (!entry) return;
  if (!V.inking) setInking(true);
  const before = entry.layer.items.slice();
  const cur = before.find((x) => x.t === 'bg');
  const rest = before.filter((x) => x.t !== 'bg');
  const bg = ch ? { t: 'bg', c: '#ffffff', c2: '', pat: '', a: 1, ...(cur || {}), ...ch } : null;
  const after = bg ? [bg, ...rest] : rest;
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  $$('#insPats button').forEach((b) => b.classList.toggle('on', bg && b.dataset.v === (bg.pat || '')));
}
// layouts: ready-made pages made of titles, boxes and photo places, in families that go together.
// Concerts and careers share one look (cream paper, deep ink, a little gold); practice pages a
// lighter one. Names and details are placeholders to type over.
const LC = { paper: '#fbf8f2', ink: '#1f2430', soft: '#6b6f7a', gold: '#8a6a3a', rule: '#ddd3c2', navy: '#1c2433', gold2: '#c9a96a', blue: '#2f4b7c', pale: '#eef2f8' };
// a text box measured for the page it goes on (sideways pages are wider than tall)
const tbP = (land) => (style, x, y, txt, extra = {}) => measureTextBox({ ...tbFromStyle(style, x, y, txt), ...extra, x, y }, land ? 1414 : 1000, land ? 1000 : 1414);
// one thing under another, each placed below the last: [style, text, extra, space after]
function flowTb(T, x, y, w, parts) {
  const items = [];
  for (const p of parts) {
    if (typeof p === 'number') { y += p; continue; }
    const [st, txt, ex = {}, gap = 0.008] = p;
    const it = T(st, ex.x ?? x, y, txt, { w, ...ex }); items.push(it); y += it.h + gap;
  }
  return { items, y };
}
const ornament = (x, y, w, col, land) => ({ t: 'shape', k: 'e:divline', x, y, w, h: w / (100 / 12) / (land ? 0.707 : 1.414), f: col, a: 1, rot: 0 });
const rule = (x0, y, w, col, lw = 0.0015) => ({ t: 'shape', k: 'line', x: x0 + w / 2, y, w, h: 0.01, lc: col, lw, a: 1, rot: 0 });
const vrule = (x, y0, len, col, land) => ({ t: 'shape', k: 'line', x, y: y0 + len / 2, w: len * (land ? 0.707 : 1.414), h: 0.01, lc: col, lw: 0.0012, a: 1, rot: Math.PI / 2 });
const photo = (x, y, w, h, mask = '', extra = {}) => ({ t: 'img', id: null, x, y, w, h, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0, mask, ...extra });
const box = (x, y, w, h, f, extra = {}) => ({ t: 'shape', k: 'rect', x: x + w / 2, y: y + h / 2, w, h, f, a: 1, rot: 0, ...extra });
const rbox = (x, y, w, h, f, extra = {}) => ({ t: 'shape', k: 'round', x: x + w / 2, y: y + h / 2, w, h, f, a: 1, rot: 0, ...extra });
// the music of one concert, for the programme pages
const PROG = [
  { who: 'Johann Sebastian Bach', d: '1685–1750', what: 'Suite No. 3 in C major, BWV 1009', parts: 'Prélude · Allemande · Courante · Sarabande · Bourrées I & II · Gigue', min: '22′' },
  { who: 'Robert Schumann', d: '1810–1856', what: 'Fantasiestücke, Op. 73', parts: 'Zart und mit Ausdruck · Lebhaft, leicht · Rasch und mit Feuer', min: '11′' },
  'Interval',
  { who: 'Gabriel Fauré', d: '1845–1924', what: 'Élégie, Op. 24', parts: 'Molto adagio', min: '7′' },
  { who: 'Johannes Brahms', d: '1833–1897', what: 'Sonata No. 1 in E minor, Op. 38', parts: 'Allegro non troppo · Allegretto quasi Menuetto · Allegro', min: '26′' },
];
const NOTES = [
  ['Bach · Suite No. 3', 'Written in Köthen around 1720, the six suites for solo cello are dances for a single voice that still manages to sound like many. The third is the brightest: an open, ringing C major, a Sarabande of great stillness and two Bourrées that everyone hums on the way home.'],
  ['Schumann · Fantasiestücke', 'Three “fantasy pieces”, written in two days in 1849. Each grows out of the one before, from the dreamy first to the fiery last, and the two players share every idea as equals.'],
  ['Fauré · Élégie', 'A lament that rises to a passionate climax and falls back into silence. Fauré planned it as the slow movement of a sonata; it became one of the best-loved pieces on its own.'],
  ['Brahms · Sonata in E minor', 'Brahms keeps the cello low and dark for long stretches. The sonata ends with a fugue on a theme from Bach’s Art of Fugue: a nod to the composer who opened tonight’s concert.'],
];
const BIOS = [
  ['Your Name', 'cello', 'Your Name studied at the conservatoire and plays as a soloist and chamber musician. Write here where you studied, with whom, the prizes and the places you have played.'],
  ['Partner Name', 'piano', 'Partner Name is a pianist and chamber musician. A few lines about their studies, their concerts and what they love to play.'],
];
// the programme, set in a column: composer and dates, the work, its movements, the minutes
function progCol(T, x, y, w, kf = 1, ky = 1) {
  const out = [];
  for (const p of PROG) {
    if (typeof p === 'string') {
      out.push(T('spaced', x, y + 0.006 * ky, p, { w, c: LC.gold, fs: 0.017 * kf, ls: 0.3 }));
      y += 0.05 * ky; continue;
    }
    const a = T('heading', x, y, p.who, { w: w * 0.7, ff: 'baskerville', fs: 0.022 * kf, c: LC.ink });
    const d = T('body', x + w * 0.7, y + 0.003 * ky, p.d, { w: w * 0.3, al: 'right', fs: 0.015 * kf, c: LC.soft });
    const b = T('body', x, y + a.h + 0.004 * ky, p.what, { w: w * 0.82, i: 1, fs: 0.018 * kf, c: LC.ink });
    const m = T('body', x + w * 0.82, b.y, p.min, { w: w * 0.18, al: 'right', fs: 0.017 * kf, c: LC.gold });
    const c = T('body', x, b.y + b.h + 0.003 * ky, p.parts, { w: w * 0.92, fs: 0.0145 * kf, c: LC.soft, lh: 1.35 });
    out.push(a, d, b, m, c); y = c.y + c.h + 0.026 * ky;
  }
  return { items: out, y };
}
const LAYOUTS = [
  // ---- concerts
  { k: 'programme', cat: 'concert', label: 'Programme', make: () => {
    const T = tbP(false);
    const head = flowTb(T, 0.1, 0.05, 0.8, [
      ['spaced', 'Programme', { c: LC.gold, fs: 0.02 }, 0.012],
      ['elegant', 'An Evening of Chamber Music', { c: LC.ink, fs: 0.048, i: 0 }, 0.012],
      ['body', 'Saturday 14 June · 7.30 pm · Concert Hall', { al: 'center', c: LC.soft, fs: 0.019 }],
    ]);
    const body = progCol(T, 0.1, head.y + 0.06, 0.8, 1.22, 1.45);
    const yb = Math.min(0.85, body.y + 0.005);
    return [
      { t: 'bg', c: LC.paper, pat: '', a: 1 },
      ...head.items, ornament(0.5, head.y + 0.022, 0.32, LC.gold),
      ...body.items,
      rule(0.1, yb, 0.8, LC.rule),
      T('heading', 0.1, yb + 0.025, BIOS[0][0], { w: 0.38, ff: 'baskerville', fs: 0.027, c: LC.ink, al: 'center' }),
      T('body', 0.1, yb + 0.062, BIOS[0][1], { w: 0.38, i: 1, al: 'center', fs: 0.021, c: LC.soft }),
      T('heading', 0.52, yb + 0.025, BIOS[1][0], { w: 0.38, ff: 'baskerville', fs: 0.027, c: LC.ink, al: 'center' }),
      T('body', 0.52, yb + 0.062, BIOS[1][1], { w: 0.38, i: 1, al: 'center', fs: 0.021, c: LC.soft }),
    ];
  } },
  { k: 'progland2', cat: 'concert', land: 1, label: 'Programme, 2 columns', make: () => {
    const T = tbP(true), L = 0.06, R = 0.54, cw = 0.4;
    const head = flowTb(T, L, 0.07, cw, [
      ['spaced', 'Programme', { c: LC.gold, fs: 0.0125 }, 0.016],
      ['elegant', 'An Evening of Chamber Music', { c: LC.ink, fs: 0.026, i: 0 }, 0.016],
      ['body', 'Saturday 14 June · 7.30 pm · Concert Hall', { al: 'center', c: LC.soft, fs: 0.0125 }],
    ]);
    const prog = progCol(T, L, head.y + 0.07, cw, 0.66, 1.25);
    const yb = Math.min(0.86, prog.y);
    const notes = flowTb(T, R, 0.07, cw, [
      ['spaced', 'About the music', { c: LC.gold, fs: 0.0125 }, 0.035],
      ...NOTES.flatMap(([h, t]) => [['heading', h, { ff: 'baskerville', fs: 0.0155, c: LC.ink }, 0.01], ['body', t, { fs: 0.0122, c: '#2c303a', lh: 1.5 }, 0.035]]),
    ]);
    return [
      { t: 'bg', c: LC.paper, pat: '', a: 1 },
      vrule(0.5, 0.08, 0.84, LC.rule, true),
      ...head.items, ornament(L + cw / 2, head.y + 0.03, 0.16, LC.gold, true), ...prog.items,
      T('body', L, yb, BIOS[0][0] + ', ' + BIOS[0][1] + '   ·   ' + BIOS[1][0] + ', ' + BIOS[1][1], { w: cw, al: 'center', i: 1, fs: 0.0135, c: LC.ink }),
      ...notes.items,
      ornament(R + cw / 2, 0.83, 0.12, LC.gold, true),
      T('body', R, 0.87, 'Please switch off your phones. Thank you for coming.', { w: cw, al: 'center', i: 1, fs: 0.0115, c: LC.soft }),
    ];
  } },
  { k: 'progland3', cat: 'concert', land: 1, label: 'Programme, 3 columns', make: () => {
    const T = tbP(true), cw = 0.27, X = [0.045, 0.365, 0.685];
    const prog = flowTb(T, X[0], 0.07, cw, [
      ['spaced', 'Programme', { c: LC.gold, fs: 0.011 }, 0.02],
      ['elegant', 'An Evening of Chamber Music', { c: LC.ink, fs: 0.0195, i: 0 }, 0.014],
      ['body', 'Saturday 14 June · 7.30 pm\nConcert Hall', { al: 'center', c: LC.soft, fs: 0.0112, lh: 1.45 }],
    ]);
    const list = progCol(T, X[0], prog.y + 0.075, cw, 0.62, 1.5);
    const notes = flowTb(T, X[1], 0.07, cw, [
      ['spaced', 'About the music', { c: LC.gold, fs: 0.011 }, 0.045],
      ...NOTES.flatMap(([h, t]) => [['heading', h, { ff: 'baskerville', fs: 0.015, c: LC.ink }, 0.012], ['body', t, { fs: 0.0119, c: '#2c303a', lh: 1.55 }, 0.05]]),
    ]);
    const bios = [{ t: 'bg', c: LC.paper, pat: '', a: 1 }, T('spaced', X[2], 0.07, 'The performers', { w: cw, c: LC.gold, fs: 0.011 })];
    let y = 0.14;
    for (const [n, ins, txt] of BIOS) {
      bios.push(photo(X[2] + 0.045, y + 0.07, 0.08, 0.08 * 1.414, 'circle'));
      bios.push(T('heading', X[2] + 0.1, y + 0.035, n, { w: cw - 0.1, ff: 'baskerville', fs: 0.016, c: LC.ink }));
      bios.push(T('body', X[2] + 0.1, y + 0.078, ins, { w: cw - 0.1, i: 1, fs: 0.013, c: LC.soft }));
      const b = T('body', X[2], y + 0.16, txt, { w: cw, fs: 0.0119, c: '#2c303a', lh: 1.55 }); bios.push(b);
      y = b.y + b.h + 0.07;
    }
    bios.push(ornament(X[2] + cw / 2, 0.83, 0.1, LC.gold, true), T('spaced', X[2], 0.86, 'Thank you for coming', { w: cw, c: LC.gold, fs: 0.0105 }), T('body', X[2], 0.895, 'Please switch off your phones.', { w: cw, al: 'center', i: 1, fs: 0.0105, c: LC.soft }));
    return [...bios, vrule(0.34, 0.08, 0.84, LC.rule, true), vrule(0.66, 0.08, 0.84, LC.rule, true), ...prog.items, ornament(X[0] + cw / 2, prog.y + 0.025, 0.12, LC.gold, true), ...list.items, ...notes.items];
  } },
  { k: 'notes', cat: 'concert', label: 'Programme notes', make: () => {
    const T = tbP(false);
    const f = flowTb(T, 0.1, 0.05, 0.8, [
      ['spaced', 'About the music', { c: LC.gold, fs: 0.02 }, 0.012],
      ['elegant', 'Programme notes', { c: LC.ink, fs: 0.048, i: 0 }, 0.06],
      ...NOTES.flatMap(([h, t]) => [['heading', h, { ff: 'baskerville', fs: 0.029, c: LC.ink }, 0.012], ['body', t, { fs: 0.0215, c: '#2c303a', lh: 1.55 }, 0.05]]),
    ]);
    return [{ t: 'bg', c: LC.paper, pat: '', a: 1 }, ornament(0.5, 0.155, 0.32, LC.gold), ...f.items, T('note', 0.5, Math.min(0.92, f.y + 0.01), 'notes by the performers', { w: 0.4, al: 'right', fs: 0.024, c: LC.gold })];
  } },
  { k: 'performers', cat: 'concert', label: 'The performers', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: LC.paper, pat: '', a: 1 }, T('spaced', 0.1, 0.05, 'Tonight', { w: 0.8, c: LC.gold, fs: 0.02 }), T('elegant', 0.1, 0.085, 'The performers', { w: 0.8, c: LC.ink, fs: 0.048, i: 0 }), ornament(0.5, 0.165, 0.32, LC.gold)];
    BIOS.forEach(([n, ins, txt], i) => {
      const y = 0.22 + i * 0.37, left = i % 2 === 0;
      out.push(photo(left ? 0.27 : 0.73, y + 0.13, 0.32, 0.26, 'arch'));
      const tx = left ? 0.47 : 0.1;
      const f = flowTb(T, tx, y + 0.02, 0.43, [['heading', n, { ff: 'baskerville', fs: 0.032, c: LC.ink }, 0.006], ['body', ins, { i: 1, fs: 0.021, c: LC.gold }, 0.02], ['body', txt, { fs: 0.0185, c: '#2c303a', lh: 1.5 }]]);
      out.push(...f.items);
    });
    return out;
  } },
  { k: 'running', cat: 'concert', label: 'Student concert', make: () => {
    const T = tbP(false), rows = [['Name Surname', 'Minuet in G', 'J. S. Bach'], ['Name Surname', 'Gavotte', 'F.-J. Gossec'], ['Name Surname', 'The Swan', 'C. Saint-Saëns'], ['Name Surname', 'Allegro', 'S. Suzuki'], ['Name Surname', 'Sicilienne', 'M. T. von Paradis'], ['Name Surname', 'Csárdás', 'V. Monti'], ['Everyone', 'Ode to Joy', 'L. van Beethoven']];
    const out = [{ t: 'bg', c: LC.paper, pat: '', a: 1 }, T('spaced', 0.1, 0.05, 'Studio of Teacher Name', { w: 0.8, c: LC.gold, fs: 0.02 }), T('magazine', 0.06, 0.085, 'Spring concert', { w: 0.88, c: LC.ink, fs: 0.068 }), T('body', 0.1, 0.18, 'Sunday 22 March · 4 pm · the music school hall', { w: 0.8, al: 'center', c: LC.soft, fs: 0.019 }), ornament(0.5, 0.225, 0.3, LC.gold)];
    rows.forEach(([who, what, by], i) => {
      const y = 0.27 + i * 0.088;
      out.push({ t: 'shape', k: 'circle', x: 0.135, y: y + 0.02, w: 0.06, h: 0.06 / 1.414, f: '', lc: LC.gold, lw: 0.0015, a: 1, rot: 0 });
      out.push(T('heading', 0.105, y + 0.0055, String(i + 1), { w: 0.06, al: 'center', ff: 'baskerville', fs: 0.022, c: LC.gold }));
      out.push(T('heading', 0.2, y - 0.004, what, { w: 0.4, ff: 'baskerville', fs: 0.025, c: LC.ink }));
      out.push(T('body', 0.2, y + 0.03, by, { w: 0.4, i: 1, fs: 0.018, c: LC.soft }));
      out.push(T('body', 0.62, y + 0.006, who, { w: 0.28, al: 'right', fs: 0.019, c: LC.ink }));
      if (i < rows.length - 1) out.push(rule(0.2, y + 0.07, 0.7, LC.rule, 0.001));
    });
    out.push(T('note', 0.1, 0.9, 'thank you for coming!', { w: 0.8, al: 'center', fs: 0.03, c: LC.gold }));
    return out;
  } },
  { k: 'invite', cat: 'concert', label: 'Invitation', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#f4efe8', c2: '#e9dfd2', pat: '', a: 1 },
      box(0.08, 0.07, 0.84, 0.86, '#fffdf9'), box(0.1, 0.085, 0.8, 0.83, '', { lc: '#c9ad7a', lw: 0.0015 }),
      T('fancy', 0.12, 0.13, 'You are invited', { w: 0.76, c: LC.gold, fs: 0.06 }),
      T('spaced', 0.12, 0.26, 'to a recital', { w: 0.76, c: LC.soft, fs: 0.022 }),
      T('magazine', 0.1, 0.31, 'Your Name', { w: 0.8, c: LC.ink, fs: 0.08 }),
      T('body', 0.12, 0.43, 'cello', { w: 0.76, al: 'center', i: 1, fs: 0.026, c: LC.soft }),
      ornament(0.5, 0.5, 0.3, LC.gold),
      T('heading', 0.12, 0.55, 'Saturday 14 June', { w: 0.76, al: 'center', ff: 'baskerville', fs: 0.034, c: LC.ink }),
      T('body', 0.12, 0.61, '7.30 pm · Concert Hall\nBach · Schumann · Fauré · Brahms', { w: 0.76, al: 'center', fs: 0.022, c: '#2c303a', lh: 1.5 }),
      T('spaced', 0.12, 0.78, 'Reception afterwards', { w: 0.76, c: LC.gold, fs: 0.018 }),
    ];
  } },
  { k: 'poster', cat: 'concert', label: 'Concert poster', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: LC.navy, c2: '#2a3550', pat: '', a: 1 },
      T('spaced', 0.1, 0.05, 'In concert', { w: 0.8, c: LC.gold2, fs: 0.02 }),
      photo(0.5, 0.33, 0.58, 0.4, 'arch'),
      T('magazine', 0.06, 0.56, 'Spring Recital', { w: 0.88, c: '#f7f1e6', fs: 0.08 }),
      ornament(0.5, 0.67, 0.3, LC.gold2),
      T('body', 0.1, 0.7, 'Bach · Schumann · Fauré · Brahms', { w: 0.8, al: 'center', i: 1, fs: 0.026, c: '#e9dfca' }),
      T('spaced', 0.1, 0.8, 'Saturday 14 June · 7.30 pm', { w: 0.8, c: LC.gold2, fs: 0.02 }),
      T('spaced', 0.1, 0.84, 'Concert Hall · free entry', { w: 0.8, c: '#cfc6b4', fs: 0.017 }),
    ];
  } },
  { k: 'recital', cat: 'concert', label: 'Word poster', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#111317', pat: '', a: 1 },
      T('spaced', 0.1, 0.06, 'The concert series presents', { w: 0.8, c: LC.gold2, fs: 0.018 }),
      photo(0.5, 0.34, 0.9, 0.36, 'word', { word: 'RECITAL', wf: 'condensed' }),
      rule(0.1, 0.58, 0.8, LC.gold2, 0.0016),
      T('magazine', 0.08, 0.61, 'An evening of chamber music', { w: 0.84, c: '#f8f3ea', fs: 0.055 }),
      T('spaced', 0.1, 0.77, 'Saturday · 7.30 pm · Concert Hall', { w: 0.8, c: '#e8d9bf', fs: 0.02 }),
      T('signature', 0.1, 0.83, 'free entry', { w: 0.8, c: LC.gold2, fs: 0.06 }),
    ];
  } },
  { k: 'archposter', cat: 'concert', label: 'Arch poster', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#efe7da', pat: '', a: 1 },
      photo(0.5, 0.38, 0.66, 0.5, 'arch'),
      T('magazine', 0.06, 0.66, 'Spring', { w: 0.88, c: LC.ink, fs: 0.11 }),
      T('spaced', 0.1, 0.8, 'student concert', { w: 0.8, c: LC.gold, fs: 0.026 }),
      ornament(0.5, 0.86, 0.34, LC.gold),
      T('body', 0.1, 0.89, 'Sunday · 4 pm · the music school hall', { w: 0.8, al: 'center', i: 1, fs: 0.019, c: LC.soft }),
    ];
  } },
  { k: 'tickets', cat: 'concert', label: 'Tickets', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: '#ffffff', pat: '', a: 1 }];
    for (let i = 0; i < 4; i++) {
      const y = 0.04 + i * 0.235;
      out.push(rbox(0.06, y, 0.88, 0.2, LC.paper, { lc: LC.rule, lw: 0.0015 }), box(0.06, y, 0.035, 0.2, LC.navy));
      out.push(vrule(0.72, y + 0.02, 0.16, LC.gold, false));
      out.push(T('spaced', 0.13, y + 0.025, 'Admit one', { w: 0.55, al: 'left', c: LC.gold, fs: 0.016 }));
      out.push(T('heading', 0.13, y + 0.055, 'An Evening of Chamber Music', { w: 0.56, ff: 'baskerville', fs: 0.028, c: LC.ink }));
      out.push(T('body', 0.13, y + 0.135, 'Saturday 14 June · 7.30 pm · Concert Hall', { w: 0.56, fs: 0.017, c: LC.soft }));
      out.push(T('spaced', 0.74, y + 0.045, 'Row · Seat', { w: 0.18, c: LC.soft, fs: 0.014 }));
      out.push(T('heading', 0.74, y + 0.085, 'C 12', { w: 0.18, al: 'center', ff: 'baskerville', fs: 0.04, c: LC.ink }));
    }
    return out;
  } },
  // ---- career
  { k: 'cv', cat: 'career', label: 'CV', make: () => {
    const T = tbP(false), ink = LC.ink, soft = '#5c6270', acc = LC.blue;
    const sec = (x, y, w, head) => [T('spaced', x, y, head, { w, al: 'left', c: acc, fs: 0.017, ls: 0.24 }), rule(x, y + 0.03, w, '#c9d2e3')];
    const entry = (x, y, w, a, b, when) => [
      T('heading', x, y, a, { w: w - 0.14, fs: 0.02, c: ink, ff: 'avenir' }),
      T('body', x + w - 0.14, y, when, { w: 0.14, al: 'right', fs: 0.016, c: soft }),
      T('body', x, y + 0.026, b, { w, fs: 0.017, c: soft, lh: 1.35 }),
    ];
    return [
      { t: 'bg', c: '#ffffff', pat: '', a: 1 },
      box(0, 0, 1, 0.17, LC.pale),
      photo(0.165, 0.085, 0.17, 0.12, 'circle'),
      T('title', 0.3, 0.04, 'Your Name', { w: 0.62, ff: 'display', fs: 0.058, c: ink }),
      T('spaced', 0.3, 0.105, 'Cellist · Teacher', { w: 0.62, al: 'left', c: acc, fs: 0.019, ls: 0.2 }),
      box(0, 0.17, 0.33, 0.83, '#f7f8fb'),
      ...sec(0.05, 0.2, 0.24, 'Contact'),
      T('body', 0.05, 0.245, 'name@email.com\n+00 000 000 000\nCity, Country\nyourwebsite.com', { w: 0.26, fs: 0.016, c: ink, lh: 1.6 }),
      ...sec(0.05, 0.38, 0.24, 'Languages'),
      T('body', 0.05, 0.425, 'English, fluent\nFrench, good\nGerman, basic', { w: 0.26, fs: 0.016, c: ink, lh: 1.6 }),
      ...sec(0.05, 0.53, 0.24, 'Also'),
      T('bullets', 0.05, 0.575, 'Baroque cello\nChamber music\nTeaching children\nConducting', { w: 0.26, fs: 0.016, c: ink, lh: 1.6 }),
      ...sec(0.37, 0.2, 0.56, 'Education'),
      ...entry(0.37, 0.245, 0.56, 'Master of Music, Performance', 'Conservatoire name, City · with Teacher Name', '2022–24'),
      ...entry(0.37, 0.315, 0.56, 'Bachelor of Music', 'University or conservatoire, City', '2018–22'),
      ...sec(0.37, 0.4, 0.56, 'Prizes'),
      ...entry(0.37, 0.445, 0.56, 'First prize, national competition', 'Senior category, solo and orchestra rounds', '2023'),
      ...entry(0.37, 0.515, 0.56, 'Chamber music prize', 'With your trio or quartet', '2021'),
      ...sec(0.37, 0.6, 0.56, 'Performing'),
      ...entry(0.37, 0.645, 0.56, 'Principal cello, youth orchestra', 'Seasons at home and on tour', '2019–'),
      ...entry(0.37, 0.715, 0.56, 'Solo recitals and concertos', 'Haydn C major, Elgar, Saint-Saëns No. 1', 'since 2017'),
      ...sec(0.37, 0.8, 0.56, 'Teaching'),
      ...entry(0.37, 0.845, 0.56, 'Teacher, music school', 'Pupils from 6 to 18, chamber groups, exam preparation', '2020–'),
    ];
  } },
  { k: 'cvclassic', cat: 'career', label: 'CV, classic', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: LC.paper, pat: '', a: 1 }];
    out.push(T('magazine', 0.08, 0.05, 'Your Name', { w: 0.84, c: LC.ink, fs: 0.07 }), T('spaced', 0.1, 0.135, 'Cellist', { w: 0.8, c: LC.gold, fs: 0.02 }), T('body', 0.1, 0.165, 'name@email.com · +00 000 000 000 · yourwebsite.com', { w: 0.8, al: 'center', c: LC.soft, fs: 0.017 }), ornament(0.5, 0.205, 0.28, LC.gold));
    const S = [
      ['Education', [['2022–24', 'Master of Music, Performance', 'Conservatoire name, City · with Teacher Name'], ['2018–22', 'Bachelor of Music', 'University or conservatoire, City']]],
      ['Prizes', [['2023', 'First prize, national competition', 'Senior category'], ['2021', 'Chamber music prize', 'With your trio or quartet']]],
      ['Performances', [['2024', 'Soloist, Elgar Concerto', 'Orchestra name, Concert Hall'], ['2023', 'Recital tour', 'Five cities, with Partner Name, piano'], ['since 2019', 'Principal cello', 'Youth orchestra, seasons and tours']]],
      ['Teaching', [['since 2020', 'Teacher, music school', 'Pupils from 6 to 18, chamber groups']]],
    ];
    let y = 0.25;
    for (const [h, rows] of S) {
      out.push(T('spaced', 0.1, y, h, { w: 0.8, al: 'left', c: LC.gold, fs: 0.017, ls: 0.24 }), rule(0.1, y + 0.03, 0.8, LC.rule));
      y += 0.048;
      for (const [when, a, b] of rows) {
        out.push(T('body', 0.1, y, when, { w: 0.16, fs: 0.017, c: LC.soft }), T('heading', 0.28, y - 0.002, a, { w: 0.62, ff: 'baskerville', fs: 0.021, c: LC.ink }), T('body', 0.28, y + 0.027, b, { w: 0.62, i: 1, fs: 0.017, c: LC.soft }));
        y += 0.062;
      }
      y += 0.012;
    }
    return out;
  } },
  { k: 'bio', cat: 'career', label: 'Biography', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#f6f1ea', pat: '', a: 1 },
      photo(0.5, 0.25, 0.56, 0.36, 'arch'),
      T('magazine', 0.08, 0.46, 'Your Name', { w: 0.84, c: LC.ink, fs: 0.075 }),
      T('spaced', 0.1, 0.56, 'cello', { w: 0.8, c: LC.gold, fs: 0.022 }),
      T('body', 0.1, 0.61, 'Your Name began playing the cello at the age of seven. Write here where you studied and with whom, the prizes you have won and the orchestras, ensembles and halls you have played with and in.\n\nAdd what makes you you: the music you love, the projects you run, your teaching. Keep it to two short paragraphs and write it in the third person, as programmes print it.', { w: 0.8, fs: 0.0195, c: '#2c303a', lh: 1.55 }),
    ];
  } },
  { k: 'repertoire', cat: 'career', label: 'Repertoire list', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: LC.paper, pat: '', a: 1 }];
    out.push(T('spaced', 0.1, 0.05, 'Your Name · cello', { w: 0.8, c: LC.gold, fs: 0.02 }), T('elegant', 0.1, 0.085, 'Repertoire', { w: 0.8, c: LC.ink, fs: 0.05, i: 0 }), ornament(0.5, 0.165, 0.3, LC.gold));
    const S = [['Concertos', [['Haydn', 'Concerto in C major, Hob. VIIb:1'], ['Elgar', 'Concerto in E minor, Op. 85'], ['Saint-Saëns', 'Concerto No. 1 in A minor, Op. 33']]], ['Sonatas', [['Beethoven', 'Sonata No. 3 in A major, Op. 69'], ['Brahms', 'Sonata No. 1 in E minor, Op. 38'], ['Debussy', 'Sonata in D minor']]], ['Solo works', [['Bach', 'Suites Nos. 1–3, BWV 1007–1009'], ['Cassadó', 'Suite for solo cello']]], ['Chamber music', [['Schubert', 'Piano Trio No. 1 in B♭ major, D. 898'], ['Dvořák', 'Piano Trio No. 4 “Dumky”, Op. 90']]]];
    let y = 0.21;
    for (const [h, rows] of S) {
      out.push(T('spaced', 0.1, y, h, { w: 0.8, al: 'left', c: LC.gold, fs: 0.016, ls: 0.24 }), rule(0.1, y + 0.028, 0.8, LC.rule));
      y += 0.045;
      for (const [who, what] of rows) { out.push(T('heading', 0.1, y, who, { w: 0.22, ff: 'baskerville', fs: 0.02, c: LC.ink }), T('body', 0.33, y + 0.001, what, { w: 0.57, i: 1, fs: 0.019, c: '#2c303a' })); y += 0.038; }
      y += 0.025;
    }
    return out;
  } },
  { k: 'audition', cat: 'career', label: 'Audition list', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: '#ffffff', pat: '', a: 1 }, box(0, 0, 1, 0.16, LC.pale)];
    out.push(T('spaced', 0.08, 0.04, 'Audition', { w: 0.6, al: 'left', c: LC.blue, fs: 0.019 }), T('title', 0.08, 0.07, 'Your Name', { w: 0.5, ff: 'display', fs: 0.05, c: LC.ink }), T('body', 0.6, 0.06, 'cello\nConservatoire name\nDate · time', { w: 0.32, al: 'right', fs: 0.017, c: '#5c6270', lh: 1.5 }));
    const rows = [['Bach', 'Suite No. 3 in C major', 'Prélude', '4′'], ['Haydn', 'Concerto in C major', 'I. Moderato, with cadenza', '10′'], ['Brahms', 'Sonata No. 1 in E minor', 'I. Allegro non troppo', '9′'], ['Popper', 'High School of Cello Playing', 'Étude No. 13', '3′'], ['Orchestral excerpts', 'Brahms 2, Verdi Requiem', 'as asked', '5′']];
    out.push(T('spaced', 0.08, 0.2, 'Order', { w: 0.1, al: 'left', c: LC.blue, fs: 0.014 }), T('spaced', 0.2, 0.2, 'Piece', { w: 0.5, al: 'left', c: LC.blue, fs: 0.014 }), T('spaced', 0.8, 0.2, 'Time', { w: 0.12, al: 'right', c: LC.blue, fs: 0.014 }), rule(0.08, 0.235, 0.84, '#c9d2e3'));
    rows.forEach(([who, what, part, min], i) => {
      const y = 0.26 + i * 0.1;
      out.push(T('heading', 0.08, y, String(i + 1), { w: 0.08, ff: 'display', fs: 0.04, c: '#c9d2e3' }));
      out.push(T('heading', 0.2, y, who + ' · ' + what, { w: 0.58, fs: 0.021, c: LC.ink, ff: 'avenir' }), T('body', 0.2, y + 0.03, part, { w: 0.58, i: 1, fs: 0.018, c: '#5c6270' }), T('body', 0.8, y + 0.005, min, { w: 0.12, al: 'right', fs: 0.021, c: LC.ink }));
      out.push(rule(0.08, y + 0.075, 0.84, '#e6ebf3', 0.001));
    });
    out.push(T('heading', 0.5, 0.77, 'Total about 31 minutes', { w: 0.42, al: 'right', fs: 0.019, c: LC.blue, ff: 'avenir' }));
    out.push(T('note', 0.08, 0.84, 'notes: bring the music for the panel, tune before going in', { w: 0.84, fs: 0.026, c: '#5c6270' }));
    return out;
  } },
  { k: 'letter', cat: 'career', label: 'Cover letter', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#ffffff', pat: '', a: 1 },
      T('magazine', 0.08, 0.05, 'Your Name', { w: 0.84, c: LC.ink, fs: 0.056, al: 'left' }),
      T('body', 0.08, 0.115, 'Cellist · name@email.com · +00 000 000 000 · yourwebsite.com', { w: 0.84, fs: 0.016, c: LC.soft }),
      rule(0.08, 0.15, 0.84, LC.gold, 0.002),
      T('body', 0.08, 0.19, 'Name of the person\nOrchestra or school\nStreet, City', { w: 0.5, fs: 0.018, c: LC.ink, lh: 1.5 }),
      T('body', 0.6, 0.19, 'City, date', { w: 0.32, al: 'right', fs: 0.018, c: LC.soft }),
      T('heading', 0.08, 0.31, 'Application for the position of section cello', { w: 0.84, ff: 'baskerville', fs: 0.022, c: LC.ink }),
      T('body', 0.08, 0.36, 'Dear Name,\n\nWrite a first paragraph about the position and why you are applying for it.\n\nIn the second, say what you bring: your studies, your playing in orchestras and chamber groups, and what you would love to do with them.\n\nEnd by thanking them and saying that you look forward to playing for the panel.\n\nWith best wishes,', { w: 0.84, fs: 0.019, c: '#2c303a', lh: 1.6 }),
      T('signature', 0.08, 0.78, 'Your Name', { w: 0.5, al: 'left', c: LC.ink, fs: 0.06 }),
    ];
  } },
  { k: 'lessons', cat: 'career', label: 'Lessons flyer', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: LC.paper, pat: '', a: 1 },
      photo(0.5, 0.22, 0.84, 0.3, 'round'),
      T('spaced', 0.1, 0.4, 'Now taking new pupils', { w: 0.8, c: LC.gold, fs: 0.02 }),
      T('magazine', 0.06, 0.435, 'Cello lessons', { w: 0.88, c: LC.ink, fs: 0.085 }),
      T('body', 0.1, 0.55, 'For children and adults, from the very first notes to exams and auditions.', { w: 0.8, al: 'center', i: 1, fs: 0.022, c: '#2c303a', lh: 1.45 }),
      ornament(0.5, 0.635, 0.3, LC.gold),
      T('bullets', 0.2, 0.67, 'Lessons of 30, 45 or 60 minutes\nA first lesson to meet\nChamber music for young players\nIn person or online', { w: 0.6, fs: 0.02, c: LC.ink, lh: 1.6, ff: 'baskerville' }),
      box(0.1, 0.84, 0.8, 0.1, LC.navy),
      T('heading', 0.1, 0.857, 'Your Name', { w: 0.8, al: 'center', ff: 'baskerville', fs: 0.026, c: '#f7f1e6' }),
      T('body', 0.1, 0.895, 'name@email.com · +00 000 000 000', { w: 0.8, al: 'center', fs: 0.018, c: LC.gold2 }),
    ];
  } },
  { k: 'cert', cat: 'career', label: 'Certificate', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#fffdf7', pat: '', a: 1 },
      box(0.05, 0.04, 0.9, 0.92, '', { lc: '#b8914a', lw: 0.006 }), box(0.07, 0.06, 0.86, 0.88, '', { lc: '#d9c08a', lw: 0.0015 }),
      T('gold', 0.1, 0.12, 'Certificate', { w: 0.8, fs: 0.07 }),
      T('spaced', 0.1, 0.22, 'of achievement', { w: 0.8, c: LC.gold, fs: 0.022 }),
      T('body', 0.1, 0.3, 'This is to certify that', { w: 0.8, al: 'center', i: 1, fs: 0.024, c: '#4a4f5a' }),
      T('signature', 0.1, 0.35, 'Name of the pupil', { w: 0.8, c: LC.ink, fs: 0.075 }),
      T('body', 0.12, 0.5, 'has played with great care and musicality in the spring concert, and completed this year’s scales, studies and pieces.', { w: 0.76, al: 'center', fs: 0.022, c: '#2c303a', lh: 1.5 }),
      ornament(0.5, 0.64, 0.3, '#b8914a'),
      rule(0.16, 0.8, 0.28, '#4a4f5a'), rule(0.56, 0.8, 0.28, '#4a4f5a'),
      T('body', 0.16, 0.815, 'teacher', { w: 0.28, al: 'center', i: 1, fs: 0.018, c: LC.soft }),
      T('body', 0.56, 0.815, 'date', { w: 0.28, al: 'center', i: 1, fs: 0.018, c: LC.soft }),
    ];
  } },
  // ---- practice (a lighter family: white paper, slate ink, soft green and blue)
  { k: 'week', cat: 'practice', label: 'Week planner', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#ffffff', pat: '', a: 1 },
      T('title', 0.08, 0.04, 'My practice week', { w: 0.5, c: '#1f2430' }),
      T('note', 0.6, 0.06, 'week of …', { w: 0.32, al: 'right', fs: 0.026, c: '#567c8d' }),
      ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].flatMap((d, i) => [
        rbox(0.07, 0.14 + i * 0.115, 0.86, 0.1, i % 2 ? '#f6f7fb' : '#eef4f0'),
        T('heading', 0.1, 0.155 + i * 0.115, d, { w: 0.24, fs: 0.022, c: '#2f4156' }),
        T('checklist', 0.36, 0.15 + i * 0.115, 'scales\npiece', { w: 0.32, fs: 0.019, lh: 1.6, c: '#2f4156' }),
        T('note', 0.68, 0.16 + i * 0.115, '… min', { w: 0.2, al: 'right', fs: 0.024, c: '#9aa3ad' }),
      ]),
    ];
  } },
  { k: 'log', cat: 'practice', label: 'Practice log', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: '#ffffff', pat: '', a: 1 }, T('title', 0.07, 0.04, 'Practice log', { w: 0.5, c: '#1f2430' }), T('note', 0.6, 0.06, 'month …', { w: 0.33, al: 'right', fs: 0.026, c: '#567c8d' })];
    const cols = [[0.07, 0.13, 'Date'], [0.21, 0.45, 'What I practised'], [0.67, 0.1, 'Min'], [0.78, 0.15, 'How it went']];
    out.push(rbox(0.06, 0.13, 0.88, 0.045, '#eef4f0'));
    for (const [x, w, h] of cols) out.push(T('heading', x, 0.141, h, { w, fs: 0.016, c: '#2f4156', ff: 'avenir' }));
    for (let i = 0; i < 16; i++) out.push(rule(0.06, 0.225 + i * 0.045, 0.88, '#e3e8ee', 0.001));
    out.push(...[0.2, 0.66, 0.77].map((x) => vrule(x, 0.13, 0.81, '#e3e8ee', false)));
    out.push(T('note', 0.07, 0.95 - 0.02, 'total this month: … hours', { w: 0.86, al: 'right', fs: 0.024, c: '#567c8d' }));
    return out;
  } },
  { k: 'lesson', cat: 'practice', label: 'Lesson notes', make: () => {
    const T = tbP(false);
    return [
      { t: 'bg', c: '#ffffff', pat: '', a: 1 },
      T('title', 0.07, 0.04, 'Lesson', { w: 0.45, c: '#1f2430' }),
      T('note', 0.55, 0.06, 'date …', { w: 0.38, al: 'right', fs: 0.026, c: '#567c8d' }),
      rule(0.07, 0.125, 0.86, '#cfd8e0'),
      rbox(0.07, 0.15, 0.42, 0.24, '#eef4f0'), T('heading', 0.1, 0.17, 'To work on', { w: 0.36, fs: 0.022, c: '#2f4156' }),
      T('checklist', 0.1, 0.215, 'Bow distribution\nIntonation of the shifts\nDynamics: more contrast', { w: 0.37, fs: 0.018, lh: 1.7, c: '#2f4156' }),
      rbox(0.51, 0.15, 0.42, 0.24, '#f6f7fb'), T('heading', 0.54, 0.17, 'For next week', { w: 0.36, fs: 0.022, c: '#2f4156' }),
      T('checklist', 0.54, 0.215, 'Scale: D major, 3 octaves\nStudy No. 4, slowly\nPiece: first page by heart', { w: 0.37, fs: 0.018, lh: 1.7, c: '#2f4156' }),
      T('heading', 0.07, 0.43, 'What the teacher said', { w: 0.86, fs: 0.022, c: '#2f4156' }),
      ...Array.from({ length: 8 }, (_, i) => rule(0.07, 0.5 + i * 0.045, 0.86, '#e3e8ee', 0.001)),
      T('sticky', 0.6, 0.86, 'Ask about: the vibrato in bar 12', { w: 0.33, fs: 0.022 }),
    ];
  } },
  { k: 'piece', cat: 'practice', label: 'Piece tracker', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: '#ffffff', pat: '', a: 1 }, T('spaced', 0.07, 0.045, 'Learning a piece', { w: 0.86, al: 'left', c: '#567c8d', fs: 0.018 }), T('title', 0.07, 0.07, 'Title of the piece', { w: 0.86, c: '#1f2430', fs: 0.05 }), T('body', 0.07, 0.135, 'Composer · for the concert on …', { w: 0.86, i: 1, fs: 0.02, c: '#6b6f7a' })];
    const stages = ['Notes', 'Rhythm', 'In tempo', 'By heart', 'Ready'];
    out.push(rbox(0.06, 0.2, 0.88, 0.05, '#eef4f0'), T('heading', 0.08, 0.213, 'Section', { w: 0.24, fs: 0.016, c: '#2f4156' }));
    stages.forEach((s, j) => out.push(T('heading', 0.34 + j * 0.12, 0.213, s, { w: 0.12, al: 'center', fs: 0.015, c: '#2f4156' })));
    ['Bars 1–16', 'Bars 17–32', 'Bars 33–48', 'Bars 49–64', 'Cadenza', 'Coda'].forEach((sct, i) => {
      const y = 0.27 + i * 0.075;
      out.push(T('body', 0.08, y + 0.012, sct, { w: 0.24, fs: 0.019, c: '#2f4156' }));
      stages.forEach((_, j) => out.push({ t: 'shape', k: 'round', x: 0.4 + j * 0.12, y: y + 0.025, w: 0.045, h: 0.045 / 1.414, f: '', lc: '#9fb8c3', lw: 0.0018, a: 1, rot: 0 }));
      out.push(rule(0.06, y + 0.06, 0.88, '#e3e8ee', 0.001));
    });
    out.push(T('heading', 0.07, 0.75, 'Tricky places', { w: 0.86, fs: 0.022, c: '#2f4156' }));
    out.push(...Array.from({ length: 3 }, (_, i) => rule(0.07, 0.82 + i * 0.045, 0.86, '#e3e8ee', 0.001)));
    return out;
  } },
  { k: 'scales', cat: 'practice', label: 'Scales tracker', make: () => {
    const T = tbP(false), out = [{ t: 'bg', c: '#ffffff', pat: '', a: 1 }, T('title', 0.07, 0.04, 'Scales', { w: 0.45, c: '#1f2430' }), T('note', 0.55, 0.06, 'tick each day you play it', { w: 0.38, al: 'right', fs: 0.022, c: '#567c8d' })];
    const keys = [['C', 'a'], ['G', 'e'], ['D', 'b'], ['A', 'f♯'], ['E', 'c♯'], ['B', 'g♯'], ['F♯', 'e♭'], ['D♭', 'b♭'], ['A♭', 'f'], ['E♭', 'c'], ['B♭', 'g'], ['F', 'd']];
    out.push(T('heading', 0.07, 0.135, 'Major', { w: 0.4, fs: 0.02, c: '#2f4156' }), T('heading', 0.53, 0.135, 'Minor', { w: 0.4, fs: 0.02, c: '#2f4156' }));
    keys.forEach(([M, m], i) => {
      const y = 0.18 + i * 0.062;
      for (const [x, name, tint] of [[0.07, M + ' major', '#eef4f0'], [0.53, m + ' minor', '#f6f7fb']]) {
        out.push(rbox(x, y, 0.4, 0.05, tint), T('body', x + 0.02, y + 0.012, name, { w: 0.14, fs: 0.018, c: '#2f4156' }));
        for (let d = 0; d < 7; d++) out.push({ t: 'shape', k: 'round', x: x + 0.18 + d * 0.031, y: y + 0.025, w: 0.022, h: 0.022 / 1.414, f: '#ffffff', lc: '#b9cbd3', lw: 0.0012, a: 1, rot: 0 });
      }
    });
    return out;
  } },
  { k: 'olive', cat: 'practice', label: 'Month goals', make: () => [
    { t: 'bg', c: '#475540', pat: '', a: 1 },
    tb('poster', 0.06, 0.05, 'GOALS', { w: 0.5, al: 'left', c: '#d4dbc4', fs: 0.1, ff: 'display', b: 0, ls: 0.06 }),
    tb('fancy', 0.08, 0.15, 'this month', { w: 0.6, al: 'left', c: '#ffffff', fs: 0.042 }),
    { t: 'img', id: null, x: 0.73, y: 0.18, w: 0.4, h: 0.26, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0, mask: 'arch' },
    ...[0, 1, 2, 3].flatMap((i) => [
      { t: 'shape', k: 'round', x: i % 2 ? 0.74 : 0.27, y: 0.47 + Math.floor(i / 2) * 0.23, w: 0.42, h: 0.2, f: '#2c3527', a: 1, rot: 0 },
      { t: 'shape', k: 'circle', x: (i % 2 ? 0.74 : 0.27), y: 0.4 + Math.floor(i / 2) * 0.23, w: 0.06, h: 0.06 / 1.414, f: '#d4dbc4', a: 1, rot: 0 },
      tb('body', (i % 2 ? 0.55 : 0.08), 0.44 + Math.floor(i / 2) * 0.23, ['Scales in thirds', 'Learn the second movement', 'Record a run-through', 'Twenty minutes of long notes'][i], { w: 0.38, al: 'center', c: '#e9eddf', fs: 0.024 }),
    ]),
  ] },
  { k: 'journal', cat: 'practice', label: 'Practice journal', make: () => [
    { t: 'bg', c: '#fffdf8', pat: 'grid', a: 1 },
    tb('chapter', 0.08, 0.05, 'Practice journal', { w: 0.84, c: '#2f4156' }),
    tb('note', 0.62, 0.12, 'date:', { w: 0.3, al: 'right', fs: 0.026, c: '#567c8d' }),
    { t: 'shape', k: 'flower', x: 0.17, y: 0.27, w: 0.2, h: 0.2 / 1.414, f: '#c8d9e6', a: 1, rot: 0 },
    tb('heading', 0.3, 0.2, 'Today I want to…', { w: 0.62, fs: 0.03, c: '#2f4156' }),
    tb('checklist', 0.3, 0.25, 'Warm up with long notes\nShift slowly, with the drone\nPlay the piece once, no stops', { w: 0.62, c: '#2f4156' }),
    { t: 'shape', k: 'round', x: 0.5, y: 0.62, w: 0.84, h: 0.22, f: '#f5efeb', a: 1, rot: 0 },
    tb('heading', 0.12, 0.53, 'What went well', { w: 0.76, fs: 0.028, c: '#567c8d' }),
    tb('sticky', 0.58, 0.79, 'Next time: record it!', { w: 0.34, rot: -0.04 }),
  ] },
  { k: 'elegant', cat: 'practice', label: 'Questions for my teacher', make: () => [
    { t: 'bg', c: '#f3ece6', pat: '', a: 1 },
    tb('title', 0.08, 0.05, 'Q&A', { w: 0.84, fs: 0.16, c: '#5d0d18', ff: 'bodoni', b: 0 }),
    tb('fancy', 0.08, 0.2, 'ask anything', { w: 0.84, al: 'left', c: '#5d0d18', fs: 0.05 }),
    { t: 'shape', k: 'line', x: 0.5, y: 0.3, w: 0.84, h: 0.01, lc: '#5d0d18', lw: 0.0018, a: 1, rot: 0 },
    tb('checklist', 0.08, 0.34, 'Why does the shift go flat?\nHow slow is slow enough?\nWhere should the bow change?\nWhat to play for the audition?', { w: 0.84, c: '#3e2a2c', ff: 'baskerville', fs: 0.028 }),
    { t: 'shape', k: 'round', x: 0.5, y: 0.8, w: 0.84, h: 0.16, f: '#5d0d18', a: 1, rot: 0 },
    tb('elegant', 0.12, 0.755, 'answers next lesson', { w: 0.76, c: '#f3ece6', fs: 0.036 }),
  ] },
  // ---- for sharing
  { k: 'collage', cat: 'social', label: 'Photo collage', make: () => [
    tb('fancy', 0.1, 0.05, 'Concert memories', { w: 0.8 }),
    { t: 'img', id: null, x: 0.3, y: 0.32, w: 0.42, h: 0.28, rot: -0.05, cr: [0, 0, 1, 1], a: 1, fr: 'polaroid', rr: 0 },
    { t: 'img', id: null, x: 0.7, y: 0.4, w: 0.42, h: 0.28, rot: 0.06, cr: [0, 0, 1, 1], a: 1, fr: 'polaroid', rr: 0 },
    { t: 'img', id: null, x: 0.45, y: 0.72, w: 0.5, h: 0.3, rot: 0.02, cr: [0, 0, 1, 1], a: 1, fr: 'tape', rr: 0 },
  ] },
  { k: 'polaroids', cat: 'social', label: 'Polaroid wall', make: () => [
    { t: 'bg', c: '#f1ece4', pat: 'dots', a: 1 },
    tb('note', 0.1, 0.05, 'this year in music', { w: 0.8, al: 'center', fs: 0.05, c: '#3d2e22' }),
    ...[[0.3, 0.3, -0.08], [0.7, 0.28, 0.06], [0.28, 0.62, 0.05], [0.72, 0.64, -0.05]].map(([x, y, r]) => ({ t: 'img', id: null, x, y, w: 0.36, h: 0.2, rot: r, cr: [0, 0, 1, 1], a: 1, fr: 'polaroid', rr: 0 })),
    { t: 'tape', x0: 0.24, y0: 0.18, x1: 0.36, y1: 0.18, w: 0.02, c: '#f4a3a3', pat: 'stripes', a: 0.85 },
    { t: 'tape', x0: 0.64, y0: 0.16, x1: 0.76, y1: 0.16, w: 0.02, c: '#7fd1cc', pat: 'dots', a: 0.85 },
    tb('note', 0.1, 0.86, 'first recital · summer course · new bow', { w: 0.8, al: 'center', fs: 0.03, c: '#5b4636' }),
  ] },
  { k: 'cover', cat: 'social', label: 'Magazine cover', make: () => [
    { t: 'img', id: null, x: 0.5, y: 0.5, w: 1, h: 1, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0 },
    tb('magazine', 0.04, 0.03, 'Cello', { w: 0.92, c: '#ffffff', fs: 0.17, fx: 'shadow' }),
    tb('spaced', 0.08, 0.24, 'the practice issue', { w: 0.84, c: '#ffffff', fs: 0.022 }),
    tb('headline', 0.06, 0.7, 'Slow practice, big results', { w: 0.6, c: '#ffffff', fs: 0.05, fx: 'shadow' }),
    tb('body', 0.06, 0.86, 'Scales in thirds · the bow arm · stage nerves', { w: 0.6, c: '#ffffff', fs: 0.022 }),
  ] },
  { k: 'glassq', cat: 'social', label: 'Glass quote', make: () => [
    { t: 'img', id: null, x: 0.5, y: 0.5, w: 1, h: 1, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0 },
    { t: 'shape', k: 'glass', x: 0.5, y: 0.52, w: 0.78, h: 0.42, f: '#ffffff', a: 1, rot: 0 },
    tb('note', 0.17, 0.39, 'today’s thought', { w: 0.66, ff: 'script', fs: 0.045, c: '#ffffff' }),
    tb('heading', 0.17, 0.46, 'Play it slowly, then play it beautifully.', { w: 0.66, ff: 'display', fs: 0.05, c: '#ffffff', fx: 'lift' }),
  ] },
  { k: 'mood', cat: 'social', label: 'Mood board', make: () => [
    { t: 'bg', c: '#f8f3ea', pat: '', a: 1 },
    tb('title', 0.08, 0.05, 'Mood board', { w: 0.84, ff: 'display', c: '#3d2e22' }),
    { t: 'img', id: null, x: 0.3, y: 0.33, w: 0.44, h: 0.3, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0, mask: 'arch' },
    { t: 'img', id: null, x: 0.72, y: 0.27, w: 0.36, h: 0.18, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0.2 },
    { t: 'img', id: null, x: 0.72, y: 0.46, w: 0.36, h: 0.16, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0.2 },
    ...['#3d2e22', '#8a6a4a', '#c9a96e', '#e8d9bf'].map((c, i) => ({ t: 'shape', k: 'circle', x: 0.17 + i * 0.13, y: 0.65, w: 0.1, h: 0.1 / 1.414, f: c, a: 1, rot: 0 })),
    { t: 'shape', k: 'e:sprig', x: 0.86, y: 0.8, w: 0.12, h: 0.12 / 0.6 / 1.414, f: '#8a6a4a', a: 1, rot: 0.2 },
    tb('note', 0.08, 0.72, 'Warm, slow, singing. Like an evening in late summer.', { w: 0.62, c: '#3d2e22' }),
  ] },
];
function tb(style, x, y, txt, extra = {}) { return measureTextBox({ ...tbFromStyle(style, x, y, txt), ...extra, x, y }); }
const LAYOUT_CATS = [['concert', 'Concerts'], ['career', 'Career'], ['practice', 'Practice'], ['social', 'For sharing']];
let layCat = 'concert';
(function buildLayouts() {
  const g = $('#insLayouts');
  // the layouts in sections, like the notebook covers
  const cats = el('div', 'el-cats lay-cats');
  for (const [id, label] of LAYOUT_CATS) {
    const b = el('button', id === layCat ? 'on' : '', label);
    b.addEventListener('click', () => { layCat = id; $$('.lay-cats button').forEach((x) => x.classList.toggle('on', x === b)); $$('#insLayouts .ins-layout').forEach((x) => { x.hidden = x.dataset.cat !== layCat; }); });
    cats.append(b);
  }
  g.before(cats);
  for (const L of LAYOUTS) {
    const b = el('button', 'ins-layout' + (L.land ? ' land' : '')); const c = el('canvas'); c.width = L.land ? 283 : 200; c.height = L.land ? 200 : 283; b.append(c, el('span', '', L.label));
    b.dataset.cat = L.cat || 'practice'; b.hidden = b.dataset.cat !== layCat;
    b.addEventListener('click', async () => {
      const items = L.make();
      const bg = items.filter((x) => x.t === 'bg'), rest = items.filter((x) => x.t !== 'bg');
      closeInkPops(); clearSelection();
      // in a notebook: a new page of its own (sideways when the layout is); elsewhere, on the page
      if (NBK()) {
        await addPaperPage('plain', { land: !!L.land, items: [...bg.map((x) => ({ c2: '', pat: '', ...x })), ...rest], quiet: true });
        if (!V.inking) setInking(true);
        inkHint(L.label + ': a new page. Tap anything to change it.', 2800);
        return;
      }
      addItems(rest, false);
      if (bg.length) setBackground(bg[0]);
      inkHint('Layout added. Tap anything to change it.', 2600);
    });
    g.append(b);
  }
})();
globalThis.__layouts = LAYOUTS;
async function drawLayoutThumbs() {
  await loadMusicFont();
  $$('#insLayouts canvas').forEach((c, i) => { const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); for (const it0 of LAYOUTS[i].make()) {
    // empty photo places show as a soft picture in the little previews
    const it = it0.t === 'img' && !it0.id && it0.mask !== 'bloom' && it0.mask !== 'word' ? { t: 'shape', k: it0.mask || (it0.rr ? 'round' : 'rect'), x: it0.x, y: it0.y, w: it0.w, h: it0.h, rot: it0.rot, f: '#d9c7b4', g: 1, g2: '#8fa7bd', a: 1 } : it0;
    drawItem(g, it, c.width, c.height, false);
  } });
}
// a photo place from a layout: choose the photo for it
let placeFor = null;
$('#insPlace').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; const P = placeFor; placeFor = null;
  if (!f || !P) return;
  const pic = await putPicture(f);
  const L = P.entry.layer, before = L.items.slice(), s0 = before[P.i]; if (!s0 || s0.t !== 'img') return;
  // fill the place: crop the photo to its shape
  const r = P.entry.inner.getBoundingClientRect(), PS = pageSize(r);
  const want = (s0.w * PS[0]) / (s0.h * PS[1]), have = pic.w / pic.h;
  let cr = [0, 0, 1, 1];
  if (have > want) { const k = want / have; cr = [(1 - k) / 2, 0, (1 + k) / 2, 1]; } else { const k = have / want; cr = [0, (1 - k) / 2, 1, (1 + k) / 2]; }
  const after = before.slice(); after[P.i] = { ...s0, id: pic.id, cr };
  L.setItems(after); pushUndo(L.key, before, after.slice()); makeSelection(P.entry, [P.i]);
});
$('#insPhoto').addEventListener('click', () => { closeInkPops(); $('#insFile').click(); });
// a place for a photo that shows through big letters and stripes; then choose the photo
$('#insWord').addEventListener('click', () => {
  const entry = addItems([{ t: 'img', id: null, x: 0.5, y: 0.42, w: 0.78, h: 0.5, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0, mask: 'bloom', word: 'ENCORE', wf: 'condensed' }]);
  if (entry) { placeFor = { entry, i: entry.layer.items.length - 1 }; $('#insPlace').click(); inkHint('Choose a photo. Change the word in Style.', 3000); }
});
// a glass card with words on it, ready to type
$('#insGlass').addEventListener('click', () => {
  const entry = addItems([{ t: 'shape', k: 'glass', x: 0.5, y: 0.45, w: 0.7, h: 0.22, f: '#ffffff', a: 1, rot: 0, sh: 1 }], false);
  if (!entry) return;
  const it = { ...tbFromStyle('heading', 0.2, 0.41, ''), w: 0.6, al: 'center', ff: 'avenir', fs: 0.034, c: '#1d2433' };
  it.x = 0.2; it.y = +(0.45 - 0.02).toFixed(4);
  startTextBox(entry, null, -1, it, true);
});
// a place for a photo in a shape: the shape first, then the photo
(function buildPhotoShapes() {
  const box = $('#insPhotoShapes'); if (!box) return;
  for (const [k, label] of [['circle', 'Circle'], ['arch', 'Arch'], ['heart', 'Heart'], ['star', 'Star'], ['flower', 'Flower'], ['blob', 'Blob'], ['squircle', 'Soft'], ['hexagon', 'Hexagon'], ['stamp', 'Stamp'], ['round', 'Rounded']]) {
    const b = el('button'); const c = el('canvas'); c.width = 92; c.height = 92; b.append(c, el('span', '', label));
    const g = c.getContext('2d'); g.translate(46, 46);
    const gr = g.createLinearGradient(-40, -40, 40, 40); gr.addColorStop(0, '#e8907a'); gr.addColorStop(1, '#6a8fb5');
    shapePath(g, k, 74, 74); g.fillStyle = gr; g.fill();
    b.addEventListener('click', () => {
      const w = 0.42, h = k === 'arch' ? 0.36 : w / 1.414;
      const entry = addItems([{ t: 'img', id: null, x: 0.5, y: 0.42, w, h, rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0, mask: k }]);
      if (entry) { placeFor = { entry, i: entry.layer.items.length - 1 }; $('#insPlace').click(); inkHint('Choose a photo for the ' + label.toLowerCase() + '.', 2600); }
    });
    box.append(b);
  }
})();
$('#insCamera').addEventListener('click', () => { closeInkPops(); $('#insCam').click(); });
$('#insPaste').addEventListener('click', () => { closeInkPops(); pasteFromClipboard(); });
for (const id of ['#insFile', '#insCam']) $(id).addEventListener('change', async (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) insertPictures(f); });

// ---------- text boxes: typed, or written with the Pencil (the iPad's Scribble turns it into type) ----------
// Like a design app: a box you drag, resize from the corners (size) or the sides (width), with
// many typefaces, ready-made combinations and effects. A tap selects it, a second tap edits it.
const TB = { style: 'body' };
function tbFromStyle(k, x, y, txt) {
  const st = TEXT_STYLES.find((t) => t.k === k) || TEXT_STYLES[2];
  const w = ['title', 'heading', 'poster', 'outline', 'elegant', 'retro', 'shadow', 'neon', 'fancy', 'arc'].includes(st.k) ? 0.8 : st.k === 'label' ? 0.34 : st.k === 'sticky' ? 0.36 : 0.6;
  const it = { t: 'tb', x: +clamp(x, 0.03, 0.97 - w).toFixed(4), y: +clamp(y, 0.02, 0.95).toFixed(4), w, txt: txt || '', ff: st.ff, fs: st.fs, b: st.b || 0, i: st.i || 0, u: 0, caps: st.caps || 0, ls: st.ls || 0, lh: st.lh || 0, al: st.al, c: st.c || penColor(), bg: st.bg || '', pad: st.pad || 0, fx: st.fx || '', fc: st.fc || '', curve: st.curve || 0, list: st.list || '', a: 1 };
  return it;
}
// the style of one combination, applied to a box that already has words
function styleOf(k) { const t = tbFromStyle(k, 0, 0); const { t: _t, x, y, w, txt, a, ...look } = t; return look; }
function addTextBox(k, txt) {
  const entry = centreEntry(); if (!entry) return;
  if (!V.inking) setInking(true);
  clearSelection();
  INK.tool = 'tbox'; syncInkBar();
  TB.style = k;
  const it = tbFromStyle(k, 0.1, k === 'title' || k === 'poster' ? 0.08 : 0.3, txt);
  it.x = +((1 - it.w) / 2).toFixed(4);
  startTextBox(entry, null, -1, it, !txt);
}
let tbEdit = null;
function startTextBox(entry, p, hitIdx, fresh, sample) {
  if (tbEdit) finishTextBox();
  const items = entry.layer.items;
  let hit = hitIdx;
  if (hit == null || hit < 0) hit = p ? items.findLastIndex((s) => s.t === 'tb' && itemHit(s, p[0], p[1], 0.004, 1, 1)) : -1;
  const item = hit >= 0 ? { ...items[hit] } : fresh || tbFromStyle(TB.style, p[0], p[1] - 0.012);
  const ta = el('textarea', 'tb-edit');
  ta.value = item.txt || (sample ? 'Your text' : ''); ta.placeholder = 'Type, or write here with the Pencil'; ta.spellcheck = true; ta.setAttribute('autocapitalize', 'sentences');
  $('#score').append(ta);
  tbEdit = { entry, item, hit, ta, before: items.slice() };
  item.txt = ta.value;
  if (hit >= 0) entry.layer.redraw(new Set([hit]));
  placeTextBox(); syncTbBar();
  ta.addEventListener('input', () => { tbEdit && (tbEdit.item.txt = ta.value); placeTextBox(); });
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') finishTextBox(); });
  ta.focus();
  if (sample) ta.select();
  $('#tbBar').hidden = false; $('#inkbar').classList.add('under');
}
function placeTextBox() {
  const t = tbEdit; if (!t) return;
  const r = t.entry.inner.getBoundingClientRect(), PS = pageSize(r), it = t.item;
  const at = screenOf(it.x, it.y, r), px = it.fs * PS[0];
  const pad = it.bg ? px * (it.pad ? 0.8 : 0.45) : 0;
  Object.assign(t.ta.style, {
    left: at[0] + 'px', top: at[1] + 'px', width: Math.max(80, it.w * PS[0]) + 'px',
    font: tbFont(it, px), lineHeight: String(it.lh || 1.28), color: it.fx === 'hollow' ? 'transparent' : it.c, textAlign: it.al || 'left',
    letterSpacing: (it.ls || 0) + 'em', textTransform: it.caps ? 'uppercase' : 'none',
    textDecoration: it.u ? 'underline' : 'none', background: it.bg || 'rgba(255,255,255,.35)',
    padding: pad + 'px', minHeight: px * 1.5 + 'px', webkitTextStroke: it.fx === 'hollow' || it.fx === 'outline' ? Math.max(1, px * 0.04) + 'px ' + (it.c || '#000') : '',
    textShadow: it.fx === 'neon' ? `0 0 ${px * 0.3}px ${it.c}` : it.fx === 'shadow' ? `${px * 0.06}px ${px * 0.08}px ${px * 0.18}px rgba(0,0,0,.35)` : 'none',
  });
  t.ta.style.height = 'auto'; t.ta.style.height = Math.max(px * 1.5, t.ta.scrollHeight + 2) + 'px';
}
function finishTextBox() {
  const t = tbEdit; if (!t) return; tbEdit = null;
  const txt = t.ta.value.replace(/\s+$/, ''); t.ta.remove();
  if (!(Sel.entry && selTb())) { $('#tbBar').hidden = true; $('#inkbar').classList.remove('under'); closeTextPop(); }
  const L = t.entry.layer;
  let after, idx = -1;
  if (t.hit >= 0) { after = txt ? t.before.map((s, i) => (i === t.hit ? measureTextBox({ ...t.item, txt }) : s)) : t.before.filter((_, i) => i !== t.hit); idx = txt ? t.hit : -1; }
  else if (txt) { after = [...t.before, measureTextBox({ ...t.item, txt })]; idx = after.length - 1; }
  else { L.redraw(); return; }
  L.setItems(after); pushUndo(L.key, t.before, after.slice());
  // the box stays chosen, to move it or change its look
  if (idx >= 0) makeSelection(t.entry, [idx]);
}
// the text box being edited, or the one chosen
function selTb() { return Sel.entry && Sel.idx.length === 1 && Sel.entry.layer.items[Sel.idx[0]] && Sel.entry.layer.items[Sel.idx[0]].t === 'tb' ? Sel.entry.layer.items[Sel.idx[0]] : null; }
function tbCur() { return tbEdit ? tbEdit.item : selTb(); }
function syncTbBar() {
  const it = tbCur(); if (!it) return;
  $('#tbFontBtn').textContent = (FONTS[it.ff] || FONTS.serif).label; $('#tbFontBtn').style.fontFamily = (FONTS[it.ff] || FONTS.serif).css;
  $('#tbBold').classList.toggle('on', !!it.b); $('#tbItalic').classList.toggle('on', !!it.i); $('#tbUnder').classList.toggle('on', !!it.u); $('#tbCaps').classList.toggle('on', !!it.caps);
  { const al = it.al || 'left', L = { left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10' }[al] || '';
    $('#tbAlignIco path').setAttribute('d', L); $('#tbAlign').setAttribute('aria-label', 'Alignment: ' + { left: 'left', center: 'centre', right: 'right' }[al]); }
  $('#tbColDot').style.background = it.c || '#16181d';
  // quick colours: the ones that suit the page, plus the last few used
  const q = $('#tbQuick'); q.textContent = '';
  for (const c of [...new Set([...(INK.recent || []).slice(0, 2), '#16181d', '#d12f2f', '#2b6fd6', '#2f9e55', '#ffffff'])].slice(0, 6)) {
    const b = el('button'); b.style.setProperty('--c', c); b.setAttribute('aria-label', 'Text colour ' + c); b.classList.toggle('on', (it.c || '').toLowerCase() === c.toLowerCase());
    b.addEventListener('click', () => tbChange({ c, fx: it.fx === 'gold' ? '' : it.fx })); q.append(b);
  }
  $('#tbList').classList.toggle('on', !!it.list); $('#tbList').textContent = it.list === 'check' ? '☐ list' : it.list === 'bullet' ? '• list' : '• ☐';
  $('#tbBox').classList.toggle('on', !!it.bg);
  $('#tbSizeVal').textContent = Math.round(it.fs * 1000);
  $('#tbEditBtn').hidden = !!tbEdit;
  if (!$('#textPop').hidden) fillTextPop();
}
// change the look of the box being edited, or of the chosen one (one undo step)
function tbChange(ch) {
  if (tbEdit) { Object.assign(tbEdit.item, ch); if (ch.fs) tbEdit.item.fs = clamp(ch.fs, 0.008, 0.25); placeTextBox(); syncTbBar(); tbEdit.ta.focus({ preventScroll: true }); return; }
  if (!selTb()) return;
  if (ch.fs) ch.fs = clamp(ch.fs, 0.008, 0.25);
  editSelection((s) => measureTextBox({ ...s, ...ch }), true);
  syncTbBar();
}
const TP = { tab: 'styles' };
function closeTextPop() { $('#textPop').hidden = true; }
function openTextPop(tab) { TP.tab = tab; $('#textPop').hidden = false; fillTextPop(); }
function fillTextPop() {
  const it = tbCur(); if (!it) { closeTextPop(); return; }
  $$('#tpTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === TP.tab));
  const body = $('#tpBody'); body.textContent = '';
  if (TP.tab === 'styles') {
    const g = el('div', 'tp-styles');
    for (const st of TEXT_STYLES) {
      const b = el('button', 'tp-style'); const c = el('canvas'); c.width = 300; c.height = 120; b.append(c);
      const sample = { ...tbFromStyle(st.k, 0, 0, st.label), x: 0.04, y: 0.06, w: 0.92 };
      sample.fs = clamp(sample.fs * 3.2, 0.11, 0.17); if (sample.curve) sample.curve = Math.round(sample.curve * 0.5);
      // in the middle of the tile
      const hh = measureTextBox(sample, 300, 120).h; sample.y = Math.max(0.02, (1 - hh) / 2);
      const g2 = c.getContext('2d'); if (sample.bg && !sample.pad) { /* drawn by the box */ }
      try { drawItem(g2, measureTextBox(sample, 300, 120), 300, 120, false); } catch {}
      b.addEventListener('click', () => tbChange(styleOf(st.k)));
      g.append(b);
    }
    body.append(g);
  } else if (TP.tab === 'fonts') {
    const g = el('div', 'tp-fonts');
    for (const [k, f] of Object.entries(FONTS)) {
      const b = el('button', 'tp-font' + (it.ff === k ? ' on' : ''), f.label); b.style.fontFamily = f.css;
      b.addEventListener('click', () => { tbChange({ ff: k }); fillTextPop(); });
      g.append(b);
    }
    body.append(g);
  } else if (TP.tab === 'colour') {
    const mk = (title, key, list) => {
      body.append(el('div', 'ctl-head', title));
      const row = el('div', 'tp-cols');
      for (const c of list) { const b = el('button', 'tp-col' + ((it[key] || '') === c ? ' on' : '')); b.style.setProperty('--c', c || 'transparent'); if (!c) b.classList.add('none'); b.addEventListener('click', () => { tbChange({ [key]: c, ...(key === 'bg' && !c ? { pad: 0 } : {}) }); fillTextPop(); }); row.append(b); }
      const pick = el('input'); pick.type = 'color'; pick.className = 'tp-pick'; pick.value = /^#[0-9a-f]{6}$/i.test(it[key] || '') ? it[key] : '#16181d';
      pick.addEventListener('change', () => { tbChange({ [key]: pick.value }); fillTextPop(); }); row.append(pick);
      body.append(row);
    };
    mk('Text', 'c', PALETTE);
    body.append(el('div', 'ctl-head pal-ctl-head', 'Palettes'));
    const ps = el('div', 'pal-sets'); fillPalSets(it.c, (c) => { tbChange({ c }); fillTextPop(); }, ps); body.append(ps);
    mk('Background', 'bg', ['', '#ffffff', '#fff3a0', '#ffe9a8', '#ffd6e0', '#d7f5e1', '#d6e8ff', '#e9ddff', '#16181d', '#2f3b33', '#1f3a8f', '#7a1520']);
    mk('Effect colour', 'fc', ['#16181d', '#ffffff', '#ffe066', '#ff2e88', '#00e5ff', '#2a3d7c', '#e2543a', '#2f9e55']);
    body.append(slider('Opacity', Math.round((it.a ?? 1) * 100), 10, 100, (v) => tbChange({ a: v / 100 })));
  } else if (TP.tab === 'effects') {
    const g = el('div', 'tp-fx');
    for (const [k, label] of TEXT_EFFECTS) {
      const b = el('button', 'tp-fxb' + ((it.fx || '') === k ? ' on' : '')); const c = el('canvas'); c.width = 160; c.height = 64; b.append(c, el('span', '', label));
      const sample = measureTextBox({ ...it, txt: 'Aa', x: 0.05, y: 0.1, w: 0.9, fs: 0.3, fx: k, curve: 0, bg: '', al: 'center', ls: 0, caps: 0 }, 160, 64);
      try { drawItem(c.getContext('2d'), sample, 160, 64, false); } catch {}
      b.addEventListener('click', () => { tbChange({ fx: k }); fillTextPop(); });
      g.append(b);
    }
    body.append(g);
    body.append(slider('Curve', it.curve || 0, -100, 100, (v) => tbChange({ curve: v })));
  } else {
    body.append(slider('Letter spacing', Math.round((it.ls || 0) * 100), -5, 50, (v) => tbChange({ ls: v / 100 })));
    body.append(slider('Line spacing', Math.round((it.lh || 1.28) * 100), 80, 220, (v) => tbChange({ lh: v / 100 })));
    body.append(slider('Size', Math.round(it.fs * 1000), 8, 250, (v) => tbChange({ fs: v / 1000 })));
  }
  function slider(label, val, min, max, fn) {
    const w = el('div', 'ctl'); const h = el('div', 'ctl-head'); const n = el('span', 'num', String(val)); h.append(el('span', '', label), n);
    const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.value = val;
    r.addEventListener('input', () => { n.textContent = r.value; fn(+r.value); });
    w.append(h, r); return w;
  }
}
(function buildTbBar() {
  const keep = (e) => { if (e.target.closest('input, select')) return; e.preventDefault(); if (tbEdit) tbEdit.ta.focus({ preventScroll: true }); };
  $('#tbBar').addEventListener('pointerdown', keep);
  $('#textPop').addEventListener('pointerdown', keep);
  $('#tbFontBtn').addEventListener('click', () => ($('#textPop').hidden || TP.tab !== 'fonts' ? openTextPop('fonts') : closeTextPop()));
  $('#tbStyles').addEventListener('click', () => ($('#textPop').hidden || TP.tab !== 'styles' ? openTextPop('styles') : closeTextPop()));
  $('#tbColour').addEventListener('click', () => ($('#textPop').hidden || TP.tab !== 'colour' ? openTextPop('colour') : closeTextPop()));
  $('#tbFx').addEventListener('click', () => ($('#textPop').hidden || TP.tab !== 'effects' ? openTextPop('effects') : closeTextPop()));
  $('#tbSpacing').addEventListener('click', () => ($('#textPop').hidden || TP.tab !== 'spacing' ? openTextPop('spacing') : closeTextPop()));
  $$('#tpTabs button').forEach((b) => b.addEventListener('click', () => openTextPop(b.dataset.v)));
  $('#tbSmaller').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ fs: it.fs / 1.12 }); });
  $('#tbBigger').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ fs: it.fs * 1.12 }); });
  $('#tbBold').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ b: it.b ? 0 : 1 }); });
  $('#tbItalic').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ i: it.i ? 0 : 1 }); });
  $('#tbUnder').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ u: it.u ? 0 : 1 }); });
  $('#tbCaps').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ caps: it.caps ? 0 : 1 }); });
  $('#tbAlign').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ al: { left: 'center', center: 'right', right: 'left' }[it.al || 'left'] }); });
  $('#tbList').addEventListener('click', () => { const it = tbCur(); if (it) tbChange({ list: { '': 'bullet', bullet: 'check', check: '' }[it.list || ''] || undefined, lh: it.list ? it.lh : Math.max(it.lh || 1.28, 1.5) }); });
  $('#tbBox').addEventListener('click', () => { const it = tbCur(); if (it) tbChange(it.bg ? { bg: '', pad: 0 } : { bg: '#fff3a0', pad: 1 }); });
  $('#tbEditBtn').addEventListener('click', () => { const e2 = Sel.entry, i = Sel.idx[0]; if (!selTb()) return; clearSelection(); startTextBox(e2, null, i); });
  $('#tbDone').addEventListener('click', () => { if (tbEdit) finishTextBox(); clearSelection(); $('#tbBar').hidden = true; $('#inkbar').classList.remove('under'); closeTextPop(); });
})();

// ---------- eraser and tape options (notebooks) ----------
function syncEraserPop() {
  $('#erSize').value = INK.eraser.size; $('#erSizeVal').textContent = INK.eraser.size;
  $$('#erMode button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'whole') === !!INK.eraser.whole));
}
$('#erSize').addEventListener('input', (e) => { INK.eraser.size = +e.target.value; $('#erSizeVal').textContent = e.target.value; persistInk(); });
$$('#erMode button').forEach((b) => b.addEventListener('click', () => { INK.eraser.whole = b.dataset.v === 'whole'; syncEraserPop(); persistInk(); }));
$('#erClear').addEventListener('click', async () => {
  const entry = lastEntry && V.pages.includes(lastEntry) ? lastEntry : centreEntry(); if (!entry) return;
  if (!(await ask('Clear everything on this page?', { ok: 'Clear page', danger: true, sub: 'You can undo it.' }))) return;
  const before = entry.layer.items.slice(), after = before.filter(isHiddenItem); entry.layer.setItems(after, true); pushUndo(entry.layer.key, before, after.slice()); closeInkPops();
});
function syncTapePop() {
  const g = $('#tapePats');
  if (!g.childElementCount) for (const [k, label] of TAPES) {
    const b = el('button', 'tape-pat'); b.dataset.v = k; const c = el('canvas'); c.width = 150; c.height = 44; b.append(c, el('span', '', label));
    b.addEventListener('click', () => { INK.tape.pat = k; syncTapePop(); persistInk(); });
    g.append(b);
  }
  $$('#tapePats button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === INK.tape.pat);
    const c = b.querySelector('canvas'), g2 = c.getContext('2d'); g2.clearRect(0, 0, c.width, c.height);
    drawItem(g2, { t: 'tape', x0: 0.04, y0: 0.5, x1: 0.96, y1: 0.5, w: 0.2, c: INK.tape.c || penColor(), pat: b.dataset.v, a: INK.tape.a ?? 1 }, 150, 44);
  });
  $('#tapeSize').value = INK.tape.size;
  // the tape's own colours
  const cols = $('#tapeCols'); cols.textContent = '';
  const cur = INK.tape.c || penColor();
  for (const c of ['#f4a3a3', '#f5a742', '#f3dd6d', '#7cc47f', '#7fd1cc', '#6fa8ec', '#b493e0', '#d23c8f', '#d9c3a0', '#b9bec7', '#16181d', '#ffffff']) {
    const b = el('button', 'tp-col' + (c.toLowerCase() === cur.toLowerCase() ? ' on' : '')); b.style.setProperty('--c', c); b.setAttribute('aria-label', 'Tape colour ' + c);
    b.addEventListener('click', () => { INK.tape.c = c; persistInk(); syncTapePop(); });
    cols.append(b);
  }
  const pk = el('input'); pk.type = 'color'; pk.className = 'tp-pick'; pk.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#f4a3a3';
  pk.addEventListener('change', () => { INK.tape.c = pk.value; persistInk(); syncTapePop(); }); cols.append(pk);
  $('#tapeAlpha').value = Math.round((INK.tape.a ?? 1) * 100);
}
$('#tapeAlpha').addEventListener('input', (e) => { INK.tape.a = +e.target.value / 100; persistInk(); syncTapePop(); });
$('#tapeSize').addEventListener('input', (e) => { INK.tape.size = +e.target.value; persistInk(); });
// stickers from the add menu
(function buildStickers() {
  const g = $('#insStickers');
  for (const e2 of STICKERS) {
    const b = el('button', 'sticker', e2);
    b.addEventListener('click', () => {
      closeInkPops();
      const entry = centreEntry(); if (!entry) return;
      if (!V.inking) setInking(true);
      const before = entry.layer.items.slice();
      const item = { t: 'stamp', k: 'emo', e: e2, c: '#000', a: 1, s: 0.07, x: 0.5, y: 0.45 };
      const after = [...before, item]; entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
      INK.tool = 'select'; syncInkBar(); makeSelection(entry, [after.length - 1]);
    });
    g.append(b);
  }
})();

// ---------- photo look and frame ----------
function selPic() { return Sel.entry && Sel.idx.length === 1 && Sel.entry.layer.items[Sel.idx[0]].t === 'img' ? Sel.entry.layer.items[Sel.idx[0]] : null; }
function openPicPop(tab) {
  const s = selPic(); if (!s) return;
  const p = $('#picPop'); closeInkPops(); p.hidden = false;
  $$('#picTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
  $('#picAdjust').hidden = tab !== 'adjust'; $('#picStyle').hidden = tab !== 'style';
  const f = s.f || LOOK_DEFAULT;
  $$('#picAdjust input[data-f]').forEach((i) => { i.value = Math.round((f[i.dataset.f] || 0) * 100); });
  $('#picBW').checked = !!f.bw; $('#picRound').value = Math.round((s.rr || 0) * 100); $('#picAlpha').value = Math.round((s.a ?? 1) * 100);
  $$('#picFrames button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.fr || '')));
  $$('#picShapes button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.mask || '')));
  syncPicWord(s);
  PICX.before = null;
}
const PICX = { before: null, t: 0 };
function syncPicWord(s) {
  const on = !!s && (s.mask === 'word' || s.mask === 'bloom');
  $('#picWordRow').hidden = !on; if (!on) return;
  if (document.activeElement !== $('#picWord')) $('#picWord').value = s.word || (s.mask === 'bloom' ? 'ENCORE' : 'MUSIC');
  $$('#picWordFonts button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.wf || 'condensed')));
}
$('#picWord').addEventListener('input', (e) => picEdit((s) => ({ ...s, word: e.target.value })));
// live while sliding; one undo step for the whole slide
function picEdit(fn) {
  const entry = Sel.entry, s = selPic(); if (!s) return;
  if (!PICX.before) PICX.before = entry.layer.items.slice();
  const i = Sel.idx[0], items = entry.layer.items.slice(); items[i] = fn(s);
  entry.layer.items = items; entry.layer.redraw(); entry.layer.save();
  Sel.box = selectionBox(entry, Sel.idx); placeSelection();
  clearTimeout(PICX.t);
  PICX.t = setTimeout(() => { if (PICX.before) { pushUndo(entry.layer.key, PICX.before, entry.layer.items.slice()); PICX.before = null; } }, 700);
}
$$('#picTabs button').forEach((b) => b.addEventListener('click', () => openPicPop(b.dataset.v)));
$$('#picAdjust input[data-f]').forEach((inp) => inp.addEventListener('input', () => picEdit((s) => ({ ...s, f: { ...(s.f || LOOK_DEFAULT), [inp.dataset.f]: +inp.value / 100 } }))));
$('#picBW').addEventListener('change', (e) => picEdit((s) => ({ ...s, f: { ...(s.f || LOOK_DEFAULT), bw: e.target.checked ? 1 : 0 } })));
$('#picReset').addEventListener('click', () => { picEdit((s) => ({ ...s, f: { ...LOOK_DEFAULT } })); openPicPop('adjust'); });
$('#picRound').addEventListener('input', (e) => picEdit((s) => ({ ...s, rr: +e.target.value / 100 })));
$('#picAlpha').addEventListener('input', (e) => picEdit((s) => ({ ...s, a: +e.target.value / 100 })));
(function buildPicExtras() {
  for (const [k, label, f] of PHOTO_FILTERS) {
    const b = el('button', 'frame-btn', label); b.dataset.v = k;
    b.addEventListener('click', () => { picEdit((s) => ({ ...s, f: { ...f } })); openPicPop('adjust'); });
    $('#picFilters').append(b);
  }
  for (const [k, label] of PHOTO_SHAPES) {
    const b = el('button', 'frame-btn', label); b.dataset.v = k;
    b.addEventListener('click', () => { picEdit((s) => ({ ...s, mask: k || undefined })); $$('#picShapes button').forEach((x) => x.classList.toggle('on', x === b)); syncPicWord(selPic()); });
    $('#picShapes').append(b);
  }
  for (const [k, label] of WORD_FONTS) {
    const b = el('button', 'frame-btn', label); b.dataset.v = k; b.style.fontFamily = FONTS[k].css;
    b.addEventListener('click', () => { picEdit((s) => ({ ...s, wf: k })); syncPicWord(selPic()); });
    $('#picWordFonts').append(b);
  }
})();
(function buildFrames() {
  for (const [k, label] of FRAMES) {
    const b = el('button', 'frame-btn', label); b.dataset.v = k;
    b.addEventListener('click', () => { picEdit((s) => ({ ...s, fr: k })); $$('#picFrames button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#picFrames').append(b);
  }
})();
// what is under a point: photos and text boxes first (topmost), then any marking when asked
function objectAt(x, y, any) {
  const entry = entryAt(x, y); if (!entry || !entry.layer || !entry.layer.ready) return null;
  const r = entry.inner.getBoundingClientRect(), p = fracOf(x, y, r), PS = pageSize(r);
  const items = entry.layer.items;
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i];
    if (s.t === 'bg' || (s.lock && !any)) continue;
    if (s.t === 'img' || s.t === 'tb' || s.t === 'shape') { if (itemHit(s, p[0], p[1], 0.002, 1, 1)) return { entry, i, p }; }
    else if (any && s.t !== 'passage' && itemHit(s, p[0], p[1], 10 / PS[0], PS[0], PS[1])) return { entry, i, p };
  }
  return null;
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
  const [fx, fy] = fracOf(e.clientX, e.clientY, r);
  return [fx, fy, e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5];
}
function touches() { return [...PT.values()].filter((p) => p.type === 'touch' && !p.palm); }

// A slur from a to b (page fractions): a smooth arc, thin at the ends and fuller in the middle, like
// an engraved slur. It curves to the side the pen went (above the notes unless you drew below).
function slurItem(a, b, path, rect) {
  const PS = pageSize(rect), W = PS[0], H = PS[1];
  const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 14) return null;
  const nx = dy / len, ny = -dx / len;            // the normal on the left of a→b (up when drawn left to right)
  // which side: where the pen actually went, on average
  let side = 0; for (const q of path) side += (q[0] * W - ax) * nx + (q[1] * H - ay) * ny;
  const dir = side / Math.max(1, path.length) < -len * 0.03 ? -1 : 1;
  const h = Math.max(W * 0.006, Math.min(len * 0.16, W * 0.035)) * dir;
  const st = styleFor('pen');
  const pts = [];
  const N = Math.max(16, Math.round(len / 6));
  for (let i = 0; i <= N; i++) {
    const t = i / N, bow = Math.pow(Math.sin(Math.PI * t), 0.85);
    const x = ax + dx * t + nx * h * bow, y = ay + dy * t + ny * h * bow;
    pts.push([+(x / W).toFixed(5), +(y / H).toFixed(5), +(0.1 + 0.7 * Math.sin(Math.PI * t)).toFixed(3)]);
  }
  return { t: 'pen', c: penColor(), a: st.a ?? 1, s: inkSize('pen', st.size) * 0.9, p: pts };
}
function startInk(e, entry) {
  lastEntry = entry;
  const tool = INK.tool;
  // markings still loading (a moment after the page opens): a pen or highlighter line is kept and
  // joins them; anything else waits
  if (!entry.layer.ready && tool !== 'pen' && tool !== 'hl') { GS = { kind: 'done', id: e.pointerId }; return; }
  const rect = entry.inner.getBoundingClientRect();
  const p = relPos(entry, e, rect);
  const before = entry.layer.items.slice();
  closeInkPops();
  // the slur: drag from the first note to the last; a neat engraved arc is drawn between them
  if (tool === 'stamp' && INK.stamp === 'slur') {
    GS = { kind: 'tape', slur: true, id: e.pointerId, entry, rect, before, type: e.pointerType, t0: now(), a: [p[0], p[1]], path: [[p[0], p[1]]], item: null };
    return;
  }
  if (tool === 'stamp') {
    const st = INK.stampStyle;
    const item = { t: 'stamp', k: INK.stamp, c: penColor(), a: st.a, s: inkSize('stamp', st.size), x: +p[0].toFixed(4), y: +p[1].toFixed(4) };
    entry.layer.commit(item); pushUndo(entry.layer.key, before, entry.layer.items.slice());
    GS = { kind: 'done', id: e.pointerId };
    return;
  }
  // a note: laid where the page was tapped, open to write in; the tool goes back to the one before
  if (tool === 'note') {
    GS = { kind: 'done', id: e.pointerId };
    const nid = noteId(), item = { t: 'note', nid, x: +clamp(p[0] - 0.01, 0, 0.9).toFixed(4), y: +clamp(p[1] - 0.01, 0, 0.92).toFixed(4), c: INK.noteC || 'yellow', txt: '' };
    openNote(nid);
    const after = [...before, item]; entry.layer.setItems(after); pushUndo(entry.layer.key, before, entry.layer.items.slice());
    INK.tool = INK.beforeNote || 'pen'; syncInkBar();
    setTimeout(() => { const t = entry.inner.querySelector(`.snote[data-nid="${nid}"] textarea`); if (t) t.focus(); }, 60);
    return;
  }
  if (tool === 'eraser') { GS = { kind: 'erase', id: e.pointerId, entry, rect, before, type: e.pointerType, changed: false }; GS.changed = entry.layer.eraseAt(p[0], p[1], eraserR(), INK.eraser.whole); showEraserDot(e, entry); return; }
  if (tool === 'text' && e.pointerType !== 'pen') { GS = { kind: 'done', id: e.pointerId }; startText(entry, p, e); return; }
  if (tool === 'tape') {
    const t = INK.tape;
    GS = { kind: 'tape', id: e.pointerId, entry, rect, before, type: e.pointerType, t0: now(), item: { t: 'tape', x0: +p[0].toFixed(4), y0: +p[1].toFixed(4), x1: +p[0].toFixed(4), y1: +p[1].toFixed(4), w: 0.012 + t.size * 0.006, c: t.c || penColor(), pat: t.pat, a: t.a ?? 1 } };
    scheduleLive(); return;
  }
  if (tool === 'tbox') {
    GS = { kind: 'done', id: e.pointerId };
    if (tbEdit) { finishTextBox(); return; }
    // a tap on a box chooses it (drag it, pull its sides wider, change its look); a second tap edits it
    const hit = entry.layer.items.findLastIndex((s2) => s2.t === 'tb' && !s2.lock && itemHit(s2, p[0], p[1], 0.006, 1, 1));
    if (hit >= 0) { if (Sel.entry === entry && Sel.idx.length === 1 && Sel.idx[0] === hit) { clearSelection(); startTextBox(entry, null, hit); } else makeSelection(entry, [hit]); return; }
    if (Sel.entry && selTb()) { clearSelection(); return; }
    startTextBox(entry, p); return;
  }
  if (tool === 'select') { GS = { kind: 'lasso', id: e.pointerId, entry, rect, pts: [[e.clientX, e.clientY]], rel: [p], type: e.pointerType }; return; }
  if (tool === 'print' && INK.erase === 'smart') {
    GS = { kind: 'smart', id: e.pointerId, entry, rect, before, type: e.pointerType, t0: now(), item: { t: 'hl', c: '#ff5a5f', a: 0.35, s: 0.012, p: [p] } };
    scheduleLive(); return;
  }
  const t = tool === 'print' ? 'white' : tool === 'hl' ? 'hl' : 'pen';
  const st = t === 'white' ? INK.white : styleFor(t);
  const pk = t === 'pen' && tool === 'pen' && NBK() ? INK.penKind : null;
  const item = { t, c: t === 'white' ? '#fff' : colorFor(t), a: t === 'white' ? 1 : st.a, s: inkSize(t, st.size) * (pk ? PEN_WIDTH[pk] : 1), p: [p] };
  if (pk && pk !== 'fountain') item.pk = pk;
  if (tool === 'text') wordPenDown();
  GS = { kind: 'ink', id: e.pointerId, entry, rect, before, item, type: e.pointerType, t0: now(), predicted: null, word: tool === 'text' };
  scheduleLive();
}
let liveRaf = 0;
function scheduleLive() {
  if (liveRaf) return;
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0;
    if (GS && (GS.kind === 'ink' || GS.kind === 'smart')) drawLiveItem(GS.entry, GS.item, GS.predicted);
    else if (GS && GS.kind === 'tape' && GS.item) drawLiveItem(GS.entry, GS.item, null);
    else if (GS && GS.kind === 'lasso') drawLasso(GS.pts);
  });
}
function moveInk(e) {
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  if (GS.kind === 'erase') {
    (GS.erasePts = GS.erasePts || []).push(...list.map((ev) => relPos(GS.entry, ev, GS.rect)));
    showEraserDot(e, GS.entry);
    if (!GS.eraseRaf) { const g = GS; g.eraseRaf = requestAnimationFrame(() => { g.eraseRaf = 0; const pts = g.erasePts || []; g.erasePts = []; if (pts.length && g.entry.layer.eraseMany(pts, eraserR(), INK.eraser.whole)) g.changed = true; }); }
    return;
  }
  if (GS.kind === 'lasso') { for (const ev of list) { GS.pts.push([ev.clientX, ev.clientY]); GS.rel.push(relPos(GS.entry, ev, GS.rect)); } scheduleLive(); return; }
  if (GS.kind === 'tape' && GS.slur) { const p = relPos(GS.entry, e, GS.rect); GS.path.push([p[0], p[1]]); GS.item = slurItem(GS.a, [p[0], p[1]], GS.path, GS.rect); scheduleLive(); return; }
  if (GS.kind === 'tape') { const p = relPos(GS.entry, e, GS.rect); GS.item.x1 = +p[0].toFixed(4); GS.item.y1 = +p[1].toFixed(4); scheduleLive(); return; }
  if (GS.straight && GS.straight.shape) return;
  const pts = GS.item.p;
  for (const ev of list) {
    const p = relPos(GS.entry, ev, GS.rect);
    const last = pts[pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.00025) continue;
    // calm the pressure a little: Pencil pressure is noisy at the start of a stroke
    p[2] = last[2] + (p[2] - last[2]) * 0.45;
    // steady hand: the line follows the Pencil on a short string, so wobbles smooth out
    if (INK.steady && GS.kind === 'ink' && GS.item.t === 'pen') { GS.rawLast = [p[0], p[1]]; const f = 1 - INK.steady * 0.082; p[0] = last[0] + (p[0] - last[0]) * f; p[1] = last[1] + (p[1] - last[1]) * f; }
    pts.push(p);
  }
  if (GS.kind === 'ink') {
    if (GS.straight) { straightLine(GS, relPos(GS.entry, e, GS.rect)); GS.predicted = null; scheduleLive(); return; }
    watchHold(GS, e);
  }
  const pr = e.getPredictedEvents ? e.getPredictedEvents() : [];
  GS.predicted = GS.kind === 'ink' && pr.length ? pr.slice(-2).map((ev) => relPos(GS.entry, ev, GS.rect)) : null;
  scheduleLive();
}
// Hold the Pencil still at the end of a line and it becomes perfectly straight (and level,
// when it is nearly level). Keep moving to place the end.
function watchHold(g, e) {
  if (g.item.t === 'white') return;
  if (g.hold && Math.hypot(e.clientX - g.hold.x, e.clientY - g.hold.y) < 4) return;
  clearTimeout(g.holdT);
  g.hold = { x: e.clientX, y: e.clientY };
  g.holdT = setTimeout(() => {
    if (GS !== g || g.straight) return;
    const r = g.rect, pts = g.item.p;
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i][0] - pts[i - 1][0]) * r.width, (pts[i][1] - pts[i - 1][1]) * r.height);
    const a = pts[0], b = pts[pts.length - 1];
    const chord = Math.hypot((b[0] - a[0]) * r.width, (b[1] - a[1]) * r.height);
    if (chord < 30 || len > chord * 1.25) {
      // a loop: a circle, box or triangle becomes a clean one
      if (g.item.t !== 'pen') return;
      const PS = pageSize(r), px = pts.map((q) => [q[0] * PS[0], q[1] * PS[1]]);
      const shp = recogniseShape(px); if (!shp) return;
      const pr = clamp(pts.reduce((m, q) => m + q[2], 0) / pts.length, 0.35, 0.65);
      g.item.p = shp.pts.map((q) => [q[0] / PS[0], q[1] / PS[1], pr]); g.item.sh = 1; if (NBK() && INK.shapeFill) g.item.fill = 1;
      g.straight = { shape: shp.kind }; g.predicted = null; scheduleLive();
      inkHint({ ellipse: 'Circle', rect: 'Rectangle', triangle: 'Triangle' }[shp.kind], 900);
      return;
    }
    g.straight = { a: [a[0], a[1]], pr: pts.reduce((m, p) => m + p[2], 0) / pts.length };
    straightLine(g, b); g.predicted = null; scheduleLive();
  }, 480);
}
function straightLine(g, end) {
  const r = g.rect, a = g.straight.a;
  let bx = end[0], by = end[1];
  const ang = Math.atan2((by - a[1]) * r.height, (bx - a[0]) * r.width);
  const deg = Math.abs((ang * 180) / Math.PI);
  if (deg < 4 || deg > 176) by = a[1];                    // level
  else if (Math.abs(deg - 90) < 4) bx = a[0];             // vertical
  const n = 14, pr = clamp(g.straight.pr, 0.35, 0.65);
  g.item.p = Array.from({ length: n }, (_, i) => [a[0] + ((bx - a[0]) * i) / (n - 1), a[1] + ((by - a[1]) * i) / (n - 1), pr]);
}

// ---------- text tool ----------
let textEdit = null;
function startText(entry, p, e) {
  if (textEdit) { finishText(); return; }
  const items = entry.layer.items;
  const hit = items.findIndex((s) => s.t === 'stamp' && s.k === 'txt' && itemHit(s, p[0], p[1], 0.004, 1, 1));
  const st = INK.stampStyle;
  // new words start at the tap, left-aligned, in the size and style the writing bar last set
  const item = hit >= 0 ? { ...items[hit] } : { t: 'stamp', k: 'txt', txt: '', c: penColor(), a: st.a, s: txtSize(), x: +p[0].toFixed(4), y: +p[1].toFixed(4), al: 'l', b: TXT.bold ? 1 : 0, bg: 0 };
  const r = entry.inner.getBoundingClientRect();
  const input = el('input', 'ink-text');
  input.value = item.txt || ''; input.placeholder = 'Type, or write here with the Pencil'; input.autocapitalize = 'off'; input.spellcheck = false;
  const PS = pageSize(r), at = screenOf(item.x, item.y, r);
  input.style.font = textFont(item.s * PS[0], item.b); input.style.color = item.c;
  input.style.left = at[0] + 'px'; input.style.top = at[1] + 'px';
  document.body.append(input);
  textEdit = { entry, item, hit, input, before: items.slice() };
  if (hit >= 0) entry.layer.redraw(new Set([hit]));
  // roomy while empty, so there is space to write in it with the Pencil (the iPad turns it into type)
  const fit = () => { input.style.width = Math.max(input.value ? 60 : 260, (input.value.length + 2) * item.s * PS[0] * 0.42) + 'px'; input.style.minHeight = input.value ? '' : '46px'; };
  fit();
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); finishText(); } else if (ev.key === 'Escape') finishText(true); });
  const t0 = now();
  input.addEventListener('blur', () => { if ((now() - t0 < 400 || barTouch) && textEdit && textEdit.input === input) { input.focus(); return; } finishText(); });
  input.focus();
  window.addEventListener('pointerup', () => input.focus(), { once: true });
}
function finishText(cancel) {
  const t = textEdit; if (!t) return; textEdit = null;
  const txt = t.input.value.trim(); t.input.remove();
  const L = t.entry.layer;
  if (cancel) { L.redraw(); return; }
  let after;
  if (t.hit >= 0) after = txt ? t.before.map((s, i) => (i === t.hit ? { ...t.item, txt } : s)) : t.before.filter((_, i) => i !== t.hit);
  else if (txt) after = [...t.before, placeWords(t.entry.art, { ...t.item, txt })];
  else { L.redraw(); return; }
  L.setItems(after); pushUndo(L.key, t.before, after.slice());
}

// Apple Pencil double-tap (or squeeze): switch between the eraser and the tool you were using.
let toolBeforeEraser = 'pen';
window.standPencilTap = () => {
  if (!V.inking) return;
  if (INK.tool === 'eraser') INK.tool = toolBeforeEraser;
  else { toolBeforeEraser = INK.tool; INK.tool = 'eraser'; }
  closeInkPops(); clearSelection(); syncInkBar();
  inkHint(INK.tool === 'eraser' ? 'Eraser' : 'Back to ' + ({ pen: 'the pen', hl: 'the highlighter', stamp: 'symbols', text: 'text', select: 'select', print: 'the score eraser' }[INK.tool] || 'writing'), 1200);
};
function endInk(cancelled) {
  const g = GS; GS = null;
  if (g) clearTimeout(g.holdT);
  cancelAnimationFrame(liveRaf); liveRaf = 0; clearLive(); hideEraserDot();
  if (!g) return;
  if (cancelled) return;
  // the steadied line catches up with where the Pencil lifted
  if (g.kind === 'ink' && g.rawLast && !g.straight && g.item && g.item.p.length) {
    const pts = g.item.p, l = pts[pts.length - 1];
    for (const t of [0.35, 0.65, 0.88, 1]) pts.push([l[0] + (g.rawLast[0] - l[0]) * t, l[1] + (g.rawLast[1] - l[1]) * t, l[2]]);
  }
  // a quick, straight sideways sweep of a finger is a page turn, not a line
  if (g.kind === 'ink' && g.type === 'touch' && !g.word && g.item && g.item.p.length >= 2) {
    const P = g.item.p, a = P[0], b = P[P.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dur = now() - g.t0;
    let len = 0; for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    if (dur < 420 && Math.abs(dx) > 0.22 && Math.abs(dy) < Math.abs(dx) * 0.3 && len < Math.abs(dx) * 1.25) { turn(dx < 0 ? 1 : -1); return; }
  }
  const L = g.entry && g.entry.layer;
  if (g.kind === 'erase') {
    if (g.eraseRaf) cancelAnimationFrame(g.eraseRaf);
    if (g.erasePts && g.erasePts.length && L.eraseMany(g.erasePts, eraserR(), INK.eraser.whole)) g.changed = true;
    if (g.changed) pushUndo(L.key, g.before, L.items.slice()); return;
  }
  if (g.kind === 'tape' && g.slur) { if (!g.item) return; L.commit(g.item); pushUndo(L.key, g.before, L.items.slice()); return; }
  if (g.kind === 'tape') { const it = g.item, PS = pageSize(g.rect); if (Math.hypot((it.x1 - it.x0) * PS[0], (it.y1 - it.y0) * PS[1]) < 12) return; L.commit(it); pushUndo(L.key, g.before, L.items.slice()); return; }
  if (g.kind === 'lasso') {
    // a tap (no loop) picks the thing under it
    const xs0 = g.pts.map((q) => q[0]), ys0 = g.pts.map((q) => q[1]);
    if (g.rel.length < 4 || Math.max(...xs0) - Math.min(...xs0) + Math.max(...ys0) - Math.min(...ys0) < 14) {
      const hit = objectAt(g.pts[0][0], g.pts[0][1], true);
      if (hit && hit.entry.layer.items[hit.i].t === 'tb' && Sel.entry === hit.entry && Sel.idx.length === 1 && Sel.idx[0] === hit.i) { clearSelection(); startTextBox(hit.entry, null, hit.i); return; }
      if (hit) makeSelection(hit.entry, [hit.i]);
      return;
    }
    const idx = itemsInLasso(L.items, g.rel);
    if (!idx.length) {
      // passages are for practising scores; in a notebook an empty loop just selects nothing
      if (NBK()) { inkHint('Nothing to select there. Draw the loop around what you want to move or change.'); return; }
      // a loop around music with nothing marked in it is a passage
      const xs = g.rel.map((p) => p[0]), ys = g.rel.map((p) => p[1]);
      const box = { x0: clamp(Math.min(...xs), 0, 1), y0: clamp(Math.min(...ys), 0, 1), x1: clamp(Math.max(...xs), 0, 1), y1: clamp(Math.max(...ys), 0, 1) };
      if (box.x1 - box.x0 < 0.02 || box.y1 - box.y0 < 0.01) { inkHint('Draw a bigger loop around the passage.'); return; }
      markRegion(L.key, box);
      return;
    }
    // what you wrote is chosen, and the loop itself can still become a passage
    if (!NBK()) { const xs = g.rel.map((p) => p[0]), ys = g.rel.map((p) => p[1]); Sel.pendingLoop = { x0: clamp(Math.min(...xs), 0, 1), y0: clamp(Math.min(...ys), 0, 1), x1: clamp(Math.max(...xs), 0, 1), y1: clamp(Math.max(...ys), 0, 1) }; }
    makeSelection(g.entry, idx);
    return;
  }
  if (g.word) { finishWord(g); return; }
  if (g.kind === 'smart') {
    const res = smartMask(g.entry.art, g.item.p, Math.max(1, Math.round(INK.white.size / 2)));
    if (!res.item) { inkHint(res.rejected ? 'That shape is joined to the staff or notes. Switch to Brush to cover it by hand.' : 'Nothing printed there.'); return; }
    L.commit(res.item); pushUndo(L.key, g.before, L.items.slice());
    return;
  }
  const done = g.item;
  done.p = done.p.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5), +p[2].toFixed(2)]);
  if (!L.ready) { L.commit(done); L.loaded.then(() => pushUndo(L.key, L.items.filter((x) => x !== done), L.items.slice())); return; }
  L.commit(done);
  pushUndo(L.key, g.before, L.items.slice());
  // zoomed in, the writing is drawn again at the full sharpness of the screen at once, so a line
  // looks the same after the Pencil lifts as while it was being drawn
  if (Z.s > 1.05 && L && !L.view) sharpenInk();
}
let eraserDot = null;
function showEraserDot(e, entry) {
  if (!eraserDot) { eraserDot = el('div', 'eraser-dot'); document.body.append(eraserDot); }
  // as big on screen as what it rubs out
  const d = entry ? Math.max(14, eraserR() * 2 * pageSize(entry.inner.getBoundingClientRect())[0]) : 28;
  eraserDot.style.width = eraserDot.style.height = d + 'px'; eraserDot.style.margin = (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px';
  eraserDot.hidden = false; eraserDot.style.left = e.clientX + 'px'; eraserDot.style.top = e.clientY + 'px';
}
function hideEraserDot() { if (eraserDot) eraserDot.hidden = true; }

function startNav(e) {
  GS = { kind: 'nav', id: e.pointerId, x: e.clientX, y: e.clientY, t0: now(), zx: Z.x, zy: Z.y, moved: false };
  // a finger held still on a page (notebooks and markings): copy, paste and the like
  if (e.pointerType === 'touch' && (V.inking || NBK()) && !V.perform && entryAt(e.clientX, e.clientY)) {
    const g = GS;
    g.holdT = setTimeout(() => { if (GS === g && !g.moved && touches().length === 1) { g.held = true; openHoldMenu(g.x, g.y); } }, 520);
  }
}
// ---------- press and hold: copy, cut, paste, duplicate, delete ----------
function closeHoldMenu() { const m = $('#holdMenu'); if (m) m.remove(); }
function openHoldMenu(x, y) {
  closeHoldMenu();
  const entry = entryAt(x, y); if (!entry || !entry.layer || !entry.layer.ready) return;
  if (!V.inking) setInking(true);
  const hit = objectAt(x, y, true);
  const inSel = Sel.entry === entry && hit && Sel.idx.includes(hit.i);
  if (hit && !inSel) { INK.tool = 'select'; syncInkBar(); makeSelection(entry, [hit.i]); }
  if (!hit) clearSelection();
  const has = !!(Sel.entry && Sel.idx.length);
  const r = entry.inner.getBoundingClientRect(), at = fracOf(x, y, r);
  const menu = el('div', 'hold-menu'); menu.id = 'holdMenu'; menu.setAttribute('role', 'menu');
  const add = (label, fn) => { const b = el('button', '', label); b.setAttribute('role', 'menuitem'); b.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); }); b.addEventListener('click', (ev) => { ev.stopPropagation(); closeHoldMenu(); fn(); }); menu.append(b); };
  if (has) {
    add('Copy', copySelection);
    add('Cut', () => { copySelection(); deleteSelection(); inkHint('Cut. Hold a finger on a page to paste it.', 2200); });
  }
  if (CLIP && CLIP.length) add('Paste', () => pasteAt(entry, at));
  if (has) {
    add('Duplicate', duplicateSelection);
    add('Delete', deleteSelection);
  }
  if (!has && !(CLIP && CLIP.length)) add('Paste from other apps', () => pasteFromClipboard());
  document.body.append(menu);
  const mr = menu.getBoundingClientRect();
  menu.style.left = clamp(x - mr.width / 2, 8, innerWidth - mr.width - 8) + 'px';
  menu.style.top = (y - mr.height - 18 > 8 ? y - mr.height - 18 : y + 22) + 'px';
  if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  setTimeout(() => window.addEventListener('pointerdown', function off(ev) { if (!ev.target.closest || !ev.target.closest('#holdMenu')) { closeHoldMenu(); window.removeEventListener('pointerdown', off, true); } }, true), 0);
}
// paste what was copied where the finger is (the copy keeps its shape and size)
function pasteAt(entry, at) {
  if (!CLIP || !CLIP.length) return;
  let bb = null; for (const it of CLIP) { const q = itemBounds(it); if (q && isFinite(q.x0)) bb = bb ? { x0: Math.min(bb.x0, q.x0), y0: Math.min(bb.y0, q.y0), x1: Math.max(bb.x1, q.x1), y1: Math.max(bb.y1, q.y1) } : q; }
  const cx = bb ? (bb.x0 + bb.x1) / 2 : 0.5, cy = bb ? (bb.y0 + bb.y1) / 2 : 0.5;
  // centred on the finger, but kept on the page
  const hw = bb ? Math.min(0.5, (bb.x1 - bb.x0) / 2) : 0, hh = bb ? Math.min(0.5, (bb.y1 - bb.y0) / 2) : 0;
  const tx = clamp(at[0], hw, 1 - hw), ty = clamp(at[1], hh, 1 - hh);
  const moved = CLIP.map((x) => transformItem(JSON.parse(JSON.stringify(x)), tx - cx, ty - cy, 1, 0, 0));
  if (!V.inking) setInking(true);
  const before = entry.layer.items.slice(), after = [...before, ...moved];
  entry.layer.setItems(after); pushUndo(entry.layer.key, before, after.slice());
  INK.tool = 'select'; syncInkBar(); lastEntry = entry;
  makeSelection(entry, moved.map((_, i) => before.length + i));
}
function startPinch() {
  const t = touches(); if (t.length < 2) return;
  const [a, b] = t;
  try { flushInk(); } catch {}   // (what was just written is kept on the iPad before zooming)
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
    // the Apple Pencil on a page opens the markings tools and starts writing straight away
    if (e.pointerType === 'pen' && !V.inking && !V.perform && S.penOpens !== false && entryAt(e.clientX, e.clientY)) {
      // the first touch only opens the markings (nothing is written by it); the next touch writes
      setInking(true); e.preventDefault(); GS = { kind: 'done', id: e.pointerId }; return;
    }
    if (V.inking) { const entry = entryAt(e.clientX, e.clientY); if (entry) { e.preventDefault(); startInk(e, entry); return; } }
    if (!V.inking || e.pointerType === 'mouse') startNav(e);
    return;
  }
  // touch
  // the hand resting on the screen while writing never turns the page: no touch counts while the
  // Pencil is down, nor for half a second after it lifts. A finger always turns pages, with the
  // markings open too (and in the notebook); only a contact as big as a palm, just after writing,
  // is taken for the hand. (A finger on the iPad can measure 50 px or more: a smaller limit took
  // fingers for the hand, so pages did not turn and the finger could not draw.)
  const big = Math.max(e.width || 0, e.height || 0) > 110;
  if (penDown || t - lastPenUp < (V.inking ? 500 : 350) || (big && t - lastPenUp < 1500)) { info.palm = true; return; }
  const n = touches().length;
  if (n >= 2 && V.perform) { GS = { kind: 'wait' }; return; }
  if (n >= 2) {
    if (GS && GS.holdT) clearTimeout(GS.holdT);
    if (GS && (GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso' || GS.kind === 'tape')) {
      // a second finger means zoom: drop a stroke that has only just started
      const young = now() - GS.t0 < 350 || (GS.item && GS.item.p.length < 8);
      endInk(young);
    }
    startPinch();
    return;
  }
  // text boxes are placed with a tap, so a finger can still swipe to turn the page with that tool
  if (V.inking && INK.finger && (INK.tool === 'tbox' || INK.tool === 'text')) { e.preventDefault(); startNav(e); GS.place = true; return; }
  if (V.inking && (INK.finger || INK.tool === 'note')) { const entry = entryAt(e.clientX, e.clientY); if (entry) { e.preventDefault(); startInk(e, entry); return; } }
  startNav(e);
});
window.addEventListener('pointermove', (e) => {
  const p = PT.get(e.pointerId); if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (!GS) return;
  if ((GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso' || GS.kind === 'tape') && GS.id === e.pointerId) { moveInk(e); return; }
  if (GS.kind === 'pinch') {
    const t = touches(); if (t.length < 2) return;
    const [a, b] = t;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const s = GS.base.s * (d / GS.d0);
    // zoom about the first centre, then follow the fingers (two-finger pan)
    setZoomAt(s, GS.cx0, GS.cy0, GS.base);
    if (Z.s !== 1) { Z.x += cx - GS.cx0; Z.y += cy - GS.cy0; applyZoom(); }
    GS.lastDx = cx - GS.cx0; GS.lastDs = d / GS.d0;
    return;
  }
  if (GS.kind === 'nav' && GS.id === e.pointerId) {
    const dx = e.clientX - GS.x, dy = e.clientY - GS.y;
    if (Math.hypot(dx, dy) > 8) { GS.moved = true; clearTimeout(GS.holdT); }
    if (Z.s !== 1 && GS.moved) { Z.x = GS.zx + dx; Z.y = GS.zy + dy; applyZoom(); }
  }
});
function pointerEnd(e) {
  if (e.target && e.target.closest && e.target.closest('.tour')) { PT.delete(e.pointerId); return; }   // taps on a tour are for the tour
  const p = PT.get(e.pointerId);
  PT.delete(e.pointerId);
  try { stage.releasePointerCapture(e.pointerId); } catch {}
  if (e.pointerType === 'pen') { penDown = false; lastPenUp = now(); }
  if (!GS) return;
  if ((GS.kind === 'ink' || GS.kind === 'smart' || GS.kind === 'erase' || GS.kind === 'lasso' || GS.kind === 'tape') && GS.id === e.pointerId) { endInk(false); return; }
  if (GS.kind === 'done' && GS.id === e.pointerId) { GS = null; return; }
  if (GS.kind === 'pinch') {
    if (touches().length < 2) {
      const g = GS; GS = PT.size ? { kind: 'wait' } : null;
      scheduleSharpen();
      // a quick two-finger swipe without zooming turns the page
      if (Z.s === 1 && Math.abs(g.lastDs - 1) < 0.08 && Math.abs(g.lastDx || 0) > 90 && now() - g.t0 < 700) turn(g.lastDx < 0 ? 1 : -1);
    }
    return;
  }
  if (GS.kind === 'wait') { if (!touches().length) GS = null; return; }
  if (GS.kind === 'nav' && GS.id === e.pointerId) {
    const g = GS; GS = null;
    clearTimeout(g.holdT);
    if (g.held) return;   // the hold menu is open
    if (!p || p.palm || e.type === 'pointercancel') return;
    if (penDown || (V.inking && now() - lastPenUp < 500)) return;   // the Pencil came down meanwhile: it was the hand
    const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = now() - g.t0;
    if (Z.s !== 1) {
      if (g.moved) { scheduleSharpen(); return; }
    } else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && dt < 800) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > 12 || dt > 600) return;
    if (g.place && V.inking) { const entry = entryAt(e.clientX, e.clientY); if (entry) { startInk(e, entry); if (GS && GS.kind === 'done') GS = null; return; } }
    // a tap at the very side of the page (or of the screen) turns the page, even over a photo
    // that covers the whole page; a tap further in chooses what is there
    const pgEntry = entryAt(e.clientX, e.clientY);
    let sideTap = e.clientX > window.innerWidth * 0.9 || e.clientX < window.innerWidth * 0.1;
    if (!sideTap && pgEntry) { const pr = pgEntry.pg.getBoundingClientRect(); const fx = (e.clientX - pr.left) / pr.width; sideTap = (fx > 0.88 && pgEntry === V.pages[V.pages.length - 1]) || (fx < 0.12 && pgEntry === V.pages[0]); }
    if (V.inking && NBK() && sideTap && !Sel.entry) { if (e.clientX > window.innerWidth / 2) turn(1); else turn(-1); return; }
    if (V.inking && NBK()) {
      const hit = objectAt(e.clientX, e.clientY, INK.tool === 'select');
      if (hit) {
        const s0 = hit.entry.layer.items[hit.i];
        if (s0.t === 'tb' && Sel.entry === hit.entry && Sel.idx.length === 1 && Sel.idx[0] === hit.i) { clearSelection(); startTextBox(hit.entry, null, hit.i); return; }
        makeSelection(hit.entry, [hit.i]); return;
      }
      if (Sel.entry) { clearSelection(); return; }
    }
    // double tap: zoom in, or back out
    const w = window.innerWidth;
    if (V.perform) { if (e.clientX > w * 0.5) turn(1); else turn(-1); return; }
    if (lastTap && now() - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40 && e.clientX > w * 0.32 && e.clientX < w * 0.68) {
      lastTap = null;
      if (Z.s !== 1) { Z.s = 1; applyZoom(); } else setZoomAt(2.2, e.clientX, e.clientY, { s: 1, x: 0, y: 0 });
      scheduleSharpen(); return;
    }
    lastTap = { t: now(), x: e.clientX, y: e.clientY };
    // a tap near the top, where the toolbar lives, brings the toolbar back (never turns a page)
    if ($('#score').classList.contains('chrome-off') && e.clientY < stage.getBoundingClientRect().top + 80) { showChrome(true); return; }
    if (e.clientX > w * 0.68) turn(1);
    else if (e.clientX < w * 0.32) turn(-1);
    else showChrome($('#score').classList.contains('chrome-off'));
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
  // bookmarks, pedal jumps and the parts of sets stay on the same music when pages are deleted,
  // moved, cut or joined (by the page each was on, found again in the new order)
  const old = V.doc, sid = V.score.id;
  // (the page it was on, and which piece of it, for a page cut in pieces)
  const anchor = (pg) => { if (!(old && pg >= 1 && pg <= old.pages)) return null; const o = old.orig(pg - 1); let occ = 0; for (let i = 0; i < pg - 1; i++) if (old.orig(i) === o) occ++; return { o, occ }; };
  const marks = { bm: (V.score.bookmarks || []).map((b) => anchor(b.page)), jf: (V.score.jumps || []).map((j) => anchor(j.from)), jt: (V.score.jumps || []).map((j) => anchor(j.to)) };
  const setParts = (typeof SETS !== 'undefined' ? SETS.list : []).flatMap((st) => (st.items || []).filter((it) => it.sid === sid)).map((it) => ({ it, a: anchor(it.a), b: anchor(it.b) }));
  V.doc = mapDoc(V.base, V.score.pageMap, V.score.cuts, V.score.glue);
  const firstOf = (a, last) => {
    if (!a) return null;
    const o = a.o, at = []; for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === o) at.push(i);
    let k = at.length ? (at[a.occ] ?? (last ? at[at.length - 1] : at[0])) : -1;
    if (k < 0) { for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) > o) { k = i; break; } if (k < 0) k = V.doc.pages - 1; }
    return k + 1;
  };
  if (old) {
    V.score.bookmarks = (V.score.bookmarks || []).map((b, i) => ({ ...b, page: firstOf(marks.bm[i]) ?? b.page }));
    V.score.jumps = (V.score.jumps || []).map((j, i) => ({ ...j, from: firstOf(marks.jf[i], true) ?? j.from, to: firstOf(marks.jt[i]) ?? j.to })).filter((j) => j.from !== j.to);
    if (setParts.length) { for (const p of setParts) { p.it.a = firstOf(p.a) ?? p.it.a; p.it.b = Math.max(p.it.a, firstOf(p.b, true) ?? p.it.b); } saveSets(); }
  }
  markEdited();   // (the iPhone's copy is out of date)
  V.score.pages = V.doc.pages;
  clearCache(); V.splits.clear();
  updateScrub();
  await refreshCover(V.score, V.doc);
  await db.put('scores', V.score);
}
// the small picture in the library: made again when the first page is no longer the same one
// (deleted, moved, turned, joined or cut)
async function refreshCover(sc, doc) {
  if (!sc || !doc || !doc.pages || (V.file && V.file.kind === 'paper')) return;
  const o = doc.orig(0);
  const key = [o, doc.composite && doc.composite(0) ? 'g' : '', JSON.stringify((doc.piece && doc.piece(0)) || null), (sc.rot && sc.rot[o]) || 0].join('|');
  if (sc.coverKey === key || (sc.coverKey === undefined && key === '0||null|0')) return;
  try {
    const t = await makeThumb(doc); if (!t) return;
    sc.thumb = t; sc.coverKey = key;
    if (thumbURLs.has(sc.id)) { URL.revokeObjectURL(thumbURLs.get(sc.id)); thumbURLs.delete(sc.id); }
  } catch (e) { console.warn(e); }
}
async function addPaperPage(tpl, opt = {}) {
  if (!V.file || V.file.kind !== 'paper') return;
  V.file.pages = (V.file.pages || 1) + 1;
  if (typeof tpl === 'string' && tpl !== V.file.template) V.file.pagesTpl = { ...(V.file.pagesTpl || {}), [V.file.pages - 1]: tpl };
  // (a sideways page, for a sideways layout)
  if (opt.land) V.file.pagesLand = { ...(V.file.pagesLand || {}), [V.file.pages - 1]: 1 };
  const orig = V.file.pages - 1 + (V.file.cover ? 1 : 0);
  if (V.score.pageMap) V.score.pageMap.push(orig);
  // what goes on it from the start (a layout)
  if (opt.items) await saveItems(V.score.id + ':' + orig, opt.items);
  await db.put('files', V.file);
  V.base = await openDocument(V.file);
  await reopenDoc();
  V.score.thumb = V.score.thumb || null;
  hidePanel(); goTo(V.doc.pages - 1); if (!opt.quiet) toast('Page added', 1400);
}
$('#paperAdd').addEventListener('click', () => addPaperPage());
// Pages from another file, after the page on show: a PDF's pages (copied as they are into a PDF
// score), photos or pictures. In a notebook each comes as a page with the picture on it.
// Turn the page on show (the left one of two) a quarter round: a photo taken sideways stands
// up, or a page is laid sideways like its neighbours. A notebook page changes between upright
// and sideways paper.
$('#pgTurn').addEventListener('click', async () => {
  const sc = V.score, file = V.file; if (!sc || !file || !V.doc) return;
  if (PG.staged) await savePageChanges(true);
  const o = V.doc.orig(V.page);
  if (file.kind === 'paper') {
    const k = o - (file.cover ? 1 : 0); if (k < 0) { toast('The cover stays as it is.'); return; }
    const land = { ...(file.pagesLand || {}) }; if (land[k]) delete land[k]; else land[k] = 1;
    file.pagesLand = land; await db.put('files', file);
  } else {
    const rot = { ...(sc.rot || {}) }; rot[o] = (((+rot[o] || 0) + 90) % 360); if (!rot[o]) delete rot[o];
    sc.rot = rot; scoreFile(sc, file);
  }
  try { V.base.destroy(); } catch {}
  V.base = await openDocument(file);
  PG.thumbs.clear();
  await reopenDoc(); layout();
  if (openPanel === 'pages') renderPagesPanel();
  const items = V.pages.find((p) => p.orig === o)?.layer?.items || [];
  toast(`Page ${V.page + 1} turned.` + (items.some((x) => x.t !== 'passage') ? ' Its markings stay where they were: move them if needed.' : ''), 2400);
});
$('#pgAddFile').addEventListener('click', () => { if (PG.staged) savePageChanges(true); $('#pgAddInput').value = ''; $('#pgAddInput').click(); });
$('#pgAddInput').addEventListener('change', (e) => { const f = usableFiles(e.target.files); if (f.length) addPagesFromFiles(f); else if (e.target.files.length) toast('Only PDFs and pictures can be added as pages.'); });
async function addPagesFromFiles(files) {
  const sc = V.score, file = V.file; if (!sc || !file) return;
  if (addPagesFromFiles.busy) { toast('Pages are being added. Wait a moment.'); return; }
  addPagesFromFiles.busy = true;
  let n = 0; const tick = () => { n++; $('#toast').textContent = `Adding pages… ${n}`; };
  toast('Adding pages…', 120000);
  // (the score closed meanwhile: what was written for it so far goes again)
  const made = [], inkMade = [];
  const gone = () => V.score !== sc;
  const undoMade = async () => { for (const id of made) await db.del('files', id).catch(() => {}); for (const k of inkMade) await db.del('ink', k).catch(() => {}); $('#toast').hidden = true; };
  try {
    const oldPages = V.base.pages;
    const lastShown = Math.min(V.doc.pages - 1, V.page + (V.spread === 2 ? 1 : 0));
    const afterOrig = V.doc.orig(lastShown);
    if (file.kind === 'paper') {
      const pics = await filesAsPictures(files, tick);
      const aspect = NB_PH / NB_PW;
      for (const b of pics) {
        const pic = await putPicture(b);
        const land = pic.w > pic.h * 1.1, a = land ? 1 / aspect : aspect;
        let w = 0.92, h = (w * pic.h / pic.w) / a; if (h > 0.92) { h = 0.92; w = (h * a * pic.w) / pic.h; }
        file.pages = (file.pages || 1) + 1;
        if (land) file.pagesLand = { ...(file.pagesLand || {}), [file.pages - 1]: 1 };
        if (file.template !== 'plain') file.pagesTpl = { ...(file.pagesTpl || {}), [file.pages - 1]: 'plain' };   // (blank paper under the picture)
        const orig = file.pages - 1 + (file.cover ? 1 : 0);
        if (gone()) { await undoMade(); return; }
        inkMade.push(sc.id + ':' + orig);
        await saveItems(sc.id + ':' + orig, [{ t: 'img', id: pic.id, x: 0.5, y: 0.5, w: +w.toFixed(5), h: +h.toFixed(5), rot: 0, cr: [0, 0, 1, 1], a: 1, fr: '', rr: 0 }]);
      }
    } else {
      // kept as files of their own, after the score's own pages (the score's file, maybe a large PDF,
      // is never written again: that took all the iPad's memory)
      const ids = [];
      let pics = [];
      const flush = async () => { if (!pics.length) return; const f = { id: uid(), kind: 'images', data: pics, partOf: sc.id }; made.push(f.id); await db.put('files', f); ids.push(f.id); pics = []; };
      for (const f of files) {
        if (gone()) { await undoMade(); return; }
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '')) { await flush(); const pf = { id: uid(), kind: 'pdf', data: await f.arrayBuffer(), partOf: sc.id }; made.push(pf.id); await db.put('files', pf); ids.push(pf.id); tick(); }
        else pics.push(...await filesAsPictures([f], tick));
      }
      await flush();
      if (gone()) { await undoMade(); return; }
      sc.more = [...(sc.more || []), ...ids]; file.more = sc.more;
    }
    if (file.kind === 'paper') await db.put('files', file);
    try { V.base.destroy(); } catch {}
    delete sc.sizes;
    V.base = await openDocument(file);
    const added = [...Array(V.base.pages - oldPages).keys()].map((k) => oldPages + k);
    if (!added.length) { toast('No pages were found in that file.'); await reopenDoc(); layout(); return; }
    const map = sc.pageMap ? sc.pageMap.slice() : [...Array(oldPages).keys()];
    const at = map.indexOf(afterOrig);
    map.splice(at < 0 ? map.length : at + 1, 0, ...added);
    sc.pageMap = map;
    markEdited(); phoneAnswers.clear();
    await reopenDoc();
    PG.thumbs.clear();
    let first = 0; for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === added[0]) { first = i; break; }
    goTo(first);
    if (openPanel === 'pages') renderPagesPanel();
    toast(added.length === 1 ? 'Page added' : added.length + ' pages added', 1800);
  } catch (err) { console.error(err); if (gone()) await undoMade(); else toast('Those pages could not be added: ' + (err.message || err)); }
  finally { addPagesFromFiles.busy = false; }
}
// In a notebook, a + under the last page adds the next one.
const paperPlus = el('button', 'paper-plus'); paperPlus.innerHTML = '<svg><use href="#i-plus"/></svg><span>New page</span>';
paperPlus.hidden = true; $('#score').append(paperPlus);
paperPlus.addEventListener('click', (e) => { e.stopPropagation(); addPaperPage(); });
paperPlus.addEventListener('pointerdown', (e) => e.stopPropagation());
function syncPaperPlus() {
  const last = V.doc && V.page + (V.spread === 2 ? 1 : 0) >= V.doc.pages - 1;
  paperPlus.hidden = !(V.file && V.file.kind === 'paper' && last && !V.half);
}

// ---------- pages: delete and restore ----------
// One grid of the pages you have; tap to pick, then Delete. Deleted pages wait below.
const PG = { sel: new Set(), thumbs: new Map(), scoreId: null, edited: new Set() };
// Page pictures for the Pages panel: made one after another (so the page on screen is not
// slowed down), with the markings on them.
const THQ = { q: [], busy: false };
function pageThumb(o) {
  if (PG.scoreId !== V.score.id || PG.base !== V.base) { PG.thumbs.clear(); PG.scoreId = V.score.id; PG.base = V.base; THQ.q = []; }
  let t = PG.thumbs.get(o);
  if (!t || t.stale) {
    const cv = t ? t.cv : el('canvas');
    const [pw, ph] = V.base.sizes[o];
    cv.width = 180; cv.height = Math.round((180 * ph) / pw);
    t = { cv, stale: false };
    PG.thumbs.set(o, t);
    const base = V.base, sid = V.score.id;
    // drawn only when it comes into view (a long score has hundreds of pages)
    const job = async () => {
      if (base !== V.base) return;
      const tmp = document.createElement('canvas');
      await base.render(o, tmp, 180, cv.height).catch(() => {});
      const items = (await loadItems(sid + ':' + o).catch(() => [])).filter((s) => s.t !== 'passage');
      if (items.length) { await preloadAssets(items); await preloadMasks(items); const g = tmp.getContext('2d'); for (const s of items) drawItem(g, s, tmp.width, tmp.height, false); }
      cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height); tmp.width = tmp.height = 0;
    };
    t.job = job;
  }
  if (t.job) {
    if (!window.IntersectionObserver) { const j = t.job; t.job = null; THQ.q.push(j); runThumbs(); }
    else {
      if (t.io) t.io.disconnect();
      const io = t.io = new IntersectionObserver((es) => { if (t.job && es.some((x) => x.isIntersecting)) { io.disconnect(); t.io = null; const j = t.job; t.job = null; THQ.q.push(j); runThumbs(); } }, { rootMargin: '400px 0px' });
      io.observe(t.cv);
    }
  }
  return t.cv;
}
async function runThumbs() {
  if (THQ.busy) return; THQ.busy = true;
  while (THQ.q.length) { const job = THQ.q.shift(); try { await job(); } catch {} }
  THQ.busy = false;
}
function renderPagesPanel() {
  const all = [...Array(V.base.pages).keys()];
  // changes made in the panel show at once and are kept aside until Save (or closing the panel)
  const saved = V.score.pageMap || all;
  const map = PG.staged || saved;
  const changed = !!PG.staged && PG.staged.join() !== saved.join();
  $('#pgSave').hidden = !changed || !!PG.selecting;
  // cropping, cutting and moving lines are for printed scores, not notebook pages
  $('#panel-pages .tool-list').hidden = NBK();
  PG.sel = new Set([...PG.sel].filter((o) => map.includes(o)));
  const grid = $('#pageGrid'); grid.textContent = '';
  // Tap a page to go to it. Hold a page: a Delete button comes up on it, and moving the finger
  // (still holding) carries the page to another place.
  // Hold a page: choosing starts with it; tap more pages to add them, then Delete at the bottom.
  // Hold and drag a page to move it.
  grid.classList.toggle('selecting', !!PG.selecting);
  $('#pgSelect').hidden = false; $('#pgSelect').textContent = PG.selecting ? 'Cancel' : 'Select';
  $('#pgHint').textContent = PG.selecting ? 'Tap the pages to delete, then Delete below.' : 'Tap a page to go to it. Hold a page to choose pages to delete; hold and drag it to move it.';
  map.forEach((o, i) => {
    const b = el('button', 'pthumb' + (V.doc && V.doc.orig && V.doc.orig(V.page) === o ? ' here' : '') + (PG.selecting && PG.sel.has(o) ? ' picked' : ''));
    b.type = 'button';
    const frame = el('span', 'pframe'); frame.append(pageThumb(o));
    b.append(frame, el('span', 'num', String(i + 1)));
    const cell = el('div', 'pcell'); cell.append(b); cell.dataset.i = i;
    b.addEventListener('click', async (e) => {
      if (PGH.justHeld) { e.preventDefault(); return; }
      if (PG.selecting) { if (PG.sel.has(o)) PG.sel.delete(o); else PG.sel.add(o); b.classList.toggle('picked', PG.sel.has(o)); syncPageDelete(map); return; }
      if (PG.staged) await savePageChanges(true);
      hidePanel(); const k = V.doc ? [...Array(V.doc.pages).keys()].find((q) => V.doc.orig(q) === o) : i; goTo(k === undefined ? i : k);
    });
    pageHold(cell, b, o, i, map);
    grid.append(cell);
  });
  const gone = all.filter((o) => !map.includes(o));
  $('#pgTrash').hidden = !gone.length;
  $('#pgTrashTitle').textContent = gone.length === 1 ? '1 deleted page' : gone.length + ' deleted pages';
  const tg = $('#pgTrashGrid'); tg.textContent = '';
  for (const o of gone) {
    const b = el('button', 'pthumb gone');
    const frame = el('span', 'pframe'); frame.append(pageThumb(o));
    b.append(frame, el('span', 'num', 'Put back'));
    b.addEventListener('click', () => { const at = map.findIndex((x) => x > o); const next = map.slice(); next.splice(at < 0 ? next.length : at, 0, o); PG.staged = next; renderPagesPanel(); });
    tg.append(b);
  }
  syncPageDelete(map);
}
$('#pgSelect').addEventListener('click', () => { PG.selecting = !PG.selecting; PG.sel.clear(); renderPagesPanel(); });
const grid0 = () => $('#pageGrid');
// ---------- holding a page: delete it, or drag it somewhere else ----------
const PGH = { t: 0, drag: null, justHeld: false, menu: null };
function pageHoldClose() { if (PGH.menu) { PGH.menu.remove(); PGH.menu = null; } $$('#pageGrid .pcell.held').forEach((c) => c.classList.remove('held')); }
function pageHold(cell, btn, o, i, map) {
  let start = null;
  const cancel = () => { clearTimeout(PGH.t); start = null; };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    pageHoldClose();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    PGH.justHeld = false;
    clearTimeout(PGH.t);
    PGH.t = setTimeout(() => {
      if (!start) return;
      PGH.justHeld = true;
      if (navigator.vibrate) try { navigator.vibrate(10); } catch {}
      // held: choosing starts with this page (Delete comes up below); moving now drags it instead
      cell.classList.add('held');
      if (!PG.selecting) { PG.selecting = true; grid0().classList.add('selecting'); $('#pgSelect').textContent = 'Cancel'; $('#pgHint').textContent = 'Tap the pages to delete, then Delete below.'; }
      PG.sel.add(o); btn.classList.add('picked'); syncPageDelete(map);
      PGH.drag = { o, from: i, map, cell, x: start.x, y: start.y, id: start.id, ghost: null, to: i, picked: true };
    }, 420);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (!PGH.drag && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9) cancel();   // a scroll, not a hold
  });
  btn.addEventListener('pointerup', cancel); btn.addEventListener('pointercancel', () => { if (!PGH.drag || !PGH.drag.ghost) cancel(); });
  // while a held page is dragged, the panel must not scroll
  btn.addEventListener('touchmove', (e) => { if (PGH.drag) e.preventDefault(); }, { passive: false });
}
window.addEventListener('pointermove', (e) => {
  const d = PGH.drag; if (!d || e.pointerId !== d.id) return;
  if (!d.ghost) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) return;
    // lifted and carried: a picture of the page follows the finger (moving, not choosing)
    if (PGH.menu) { PGH.menu.remove(); PGH.menu = null; }
    if (d.picked) { PG.sel.delete(d.o); if (!PG.sel.size) PG.selecting = false; d.cell.querySelector('.pthumb').classList.remove('picked'); syncPageDelete(d.map); }
    const src = d.cell.querySelector('canvas'), r = src.getBoundingClientRect();
    const g = el('canvas', 'pg-ghost'); g.width = src.width; g.height = src.height; g.getContext('2d').drawImage(src, 0, 0);
    g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
    document.body.append(g); d.ghost = g; d.w = r.width; d.h = r.height;
    d.cell.classList.add('carried');
    // where every page sits now (its place in the grid): the others slide between these places
    const gr = grid0().getBoundingClientRect();
    d.cells = $$('#pageGrid .pcell'); d.slots = d.cells.map((c) => { const q = c.getBoundingClientRect(); return { x: q.left - gr.left, y: q.top - gr.top, w: q.width, h: q.height }; });
    grid0().classList.add('reordering');
  }
  d.ghost.style.left = (e.clientX - d.w / 2) + 'px'; d.ghost.style.top = (e.clientY - d.h / 2) + 'px';
  // where it would go: the place nearest the finger. The other pages move apart to make room
  // for it there, so you see the new order before letting go.
  const gr = grid0().getBoundingClientRect(), px = e.clientX - gr.left, py = e.clientY - gr.top;
  let best = d.to, bd = Infinity;
  d.slots.forEach((q, k) => { const dd = Math.hypot(px - (q.x + q.w / 2), (py - (q.y + q.h / 2)) * 1.3); if (dd < bd) { bd = dd; best = k; } });
  if (best !== d.to) { d.to = best; layoutDrag(d); } else if (!d.laid) layoutDrag(d);
  // near the top or bottom of the panel, it scrolls
  const pb = $('#panel-pages .panel-body'), pr = pb.getBoundingClientRect();
  if (e.clientY < pr.top + 60) pb.scrollTop -= 14; else if (e.clientY > pr.bottom - 60) pb.scrollTop += 14;
});
function layoutDrag(d) {
  d.laid = true;
  // the order it would have: without the carried page, then the carried page put in at d.to
  const order = d.cells.map((_, k) => k).filter((k) => k !== d.from); order.splice(d.to, 0, d.from);
  order.forEach((k, slot) => { const a = d.slots[k], b = d.slots[slot]; d.cells[k].style.transform = (a.x === b.x && a.y === b.y) ? '' : `translate(${b.x - a.x}px, ${b.y - a.y}px)`; });
}
const pageDragEnd = (e) => {
  const d = PGH.drag; if (!d || (e && e.pointerId !== d.id)) return;
  PGH.drag = null;
  setTimeout(() => { PGH.justHeld = false; }, 350);
  $$('#pageGrid .pcell').forEach((x) => { x.classList.remove('carried'); x.style.transform = ''; });
  grid0().classList.remove('reordering');
  if (!d.ghost) { $$('#pageGrid .pcell.held').forEach((c) => c.classList.remove('held')); return; }   // held without moving: choosing
  d.ghost.remove(); pageHoldClose();
  const to = d.to;
  if (to === d.from) return;
  const next = d.map.slice(); next.splice(d.from, 1); next.splice(clamp(to, 0, next.length), 0, d.o);
  PG.staged = next; renderPagesPanel();
};
window.addEventListener('pointerup', pageDragEnd); window.addEventListener('pointercancel', pageDragEnd);
document.addEventListener('pointerdown', (e) => { if (PGH.menu && !e.target.closest('.pg-menu') && !e.target.closest('.pcell.held')) pageHoldClose(); }, true);
function syncPageDelete(map) {
  const n = PG.sel.size, btn = $('#pgDelete');
  btn.hidden = !PG.selecting;
  if (PG.selecting) $('#pgSave').hidden = true;
  btn.disabled = !n || n >= map.length;
  btn.querySelector('span').textContent = !n ? 'Choose pages to delete' : n >= map.length ? 'Keep at least one page' : n === 1 ? 'Delete 1 page' : `Delete ${n} pages`;
}
async function setPageMap(next) {
  const all = V.base.pages;
  const cur = V.score.pageMap || [...Array(all).keys()];
  const removed = cur.filter((o) => !next.includes(o));
  // (bookmarks, pedal jumps and sets are kept on the same music by reopenDoc)
  const curOrig = cur[V.page];
  // the plain order (every page, in order) needs no map; any other order or set is kept
  V.score.pageMap = next.length === all && next.every((o, i) => o === i) ? null : next;
  await reopenDoc();
  const k = next.indexOf(curOrig);
  V.page = clamp(k >= 0 ? k : V.page, 0, V.doc.pages - 1);
  PG.sel.clear();
  layout(); if (openPanel === 'pages') renderPagesPanel();
  return removed;
}
$('#pgDelete').addEventListener('click', () => {
  const all = [...Array(V.base.pages).keys()];
  const map = PG.staged || V.score.pageMap || all;
  if (!PG.sel.size || PG.sel.size >= map.length) return;
  // the pages go at once (they wait below, to put back)
  const n = PG.sel.size;
  PG.staged = map.filter((o) => !PG.sel.has(o));
  PG.sel.clear(); PG.selecting = false;
  savePageChanges(true).then(() => { renderPagesPanel(); toast(n === 1 ? 'Page deleted. It waits under Deleted pages, to put back.' : `${n} pages deleted. They wait under Deleted pages, to put back.`, 3000); });
});
// keep the changes: the score or notebook is laid out once, with the panel closed
async function savePageChanges(quiet) {
  const next = PG.staged; PG.staged = null;
  if (!next) return;
  const cur = V.score.pageMap || [...Array(V.base.pages).keys()];
  if (next.join() === cur.join()) return;
  const n = cur.filter((o) => !next.includes(o)).length, back = next.filter((o) => !cur.includes(o)).length;
  await setPageMap(next);
  goTo(V.page, false);
  if (!quiet) toast(n ? (n === 1 ? 'Page deleted. Put it back any time from Pages.' : `${n} pages deleted. Put them back any time from Pages.`) : back === 1 ? 'Page put back.' : back ? 'Pages put back.' : 'Pages moved.', 2600);
}
$('#pgSaveBtn').addEventListener('click', () => { hidePanel(); });
$('#pgCancel').addEventListener('click', () => { PG.staged = null; PG.sel.clear(); renderPagesPanel(); });
$('#pgRestoreAll').addEventListener('click', () => { PG.staged = [...Array(V.base.pages).keys()]; renderPagesPanel(); });
$('#pagesBtn').addEventListener('click', () => showPanel('pages'));
// ---------- crop and cut pages ----------
$('#pgCrop').addEventListener('click', async () => {
  if (!V.doc) return;
  hidePanel(); setInking(false);
  const o = V.doc.orig(V.page);
  const r = await openCropper({ doc: V.base, orig: o, box: (V.score.crops || {})[o] || V.crop, pageLabel: 'Page ' + (V.page + 1) });
  if (!r) return;
  const crops = { ...(V.score.crops || {}) };
  const full = r.box.x < 0.01 && r.box.y < 0.01 && r.box.w > 0.98 && r.box.h > 0.98;
  if (r.all) for (let i = 0; i < V.base.pages; i++) { if (full) delete crops[i]; else crops[i] = { ...r.box }; }
  else if (full) delete crops[o]; else crops[o] = { ...r.box };
  V.score.crops = crops; await db.put('scores', V.score);
  clearCache(); V.splits.clear(); layout();
  toast(full ? 'Showing the whole page.' : r.all ? 'Every page cropped.' : 'Page cropped.', 1800);
});
$('#pgCut').addEventListener('click', async () => {
  if (!V.doc) return;
  hidePanel(); setInking(false);
  const o = V.doc.orig(V.page);
  const cuts = await openCutter({ doc: V.base, orig: o, cuts: (V.score.cuts || {})[o], pageLabel: 'Page ' + (V.page + 1) });
  if (!cuts) return;
  V.score.cuts = { ...(V.score.cuts || {}) };
  if (cuts.length) V.score.cuts[o] = cuts; else delete V.score.cuts[o];
  await reopenDoc();
  for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === o) { V.page = i; break; }
  layout();
  toast(cuts.length ? `Cut into ${cuts.length + 1} pages.` : 'The page is whole again.', 1800);
});

// Pull lines from the next page up onto this one (no turn in the middle of a line).
$('#pgGlue').addEventListener('click', async () => {
  if (!V.doc) return;
  // two pages side by side: the lines come onto the right-hand page (the one before the turn)
  const at = V.spread === 2 && V.page + 1 <= V.doc.pages - 1 && V.doc.orig(V.page + 1) !== V.doc.orig(V.page) ? V.page + 1 : V.page;
  if (at >= V.doc.pages - 1) { toast(V.spread === 2 ? 'These are the last pages: there is nothing after them to move up.' : 'This is the last page.'); return; }
  hidePanel(); setInking(false);
  const o = V.doc.orig(at);
  const cur = (V.score.glue || {})[o];
  let next = V.doc.composite(at) ? V.doc.gluedFrom(at) : V.doc.orig(at + 1);
  if (V.doc.piece(at) || (!V.doc.composite(at) && V.doc.piece(at + 1))) { toast('Lines can be moved between whole pages (not pieces of a cut page).', 3500); return; }
  const r = await openGluer({ doc: V.base, orig: o, next, glue: cur, pageLabel: `Page ${at + 1} and ${at + 2}` });
  if (!r) return;
  V.score.glue = { ...(V.score.glue || {}) };
  if (r.remove) delete V.score.glue[o]; else V.score.glue[o] = r;
  await db.put('scores', V.score);
  await reopenDoc();
  // back where you were (the spread keeps its left page)
  for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === o) { V.page = at === V.page ? i : Math.max(0, i - 1); break; }
  clearCache(); layout();
  // the glued pages must follow each other: if something stops it (a page deleted or cut), say so
  const ok = r.remove || [...Array(V.doc.pages).keys()].some((i) => V.doc.composite(i) && V.doc.orig(i) === o);
  toast(r.remove ? 'The lines are back on their page.' : ok ? `Lines moved up onto page ${at + 1}. The turn now falls between lines.` : 'The lines could not be moved: the two pages are no longer one after the other.', 2600);
});

// ---------- export ----------
$('#exportPdfBtn').addEventListener('click', () => { fillExportPics(); $('#expPages').hidden = true; $('#expWith').hidden = $('#expClean').hidden = false; $('#expHint').textContent = 'Deleted pages are left out. The file opens in the share sheet: save it to Files, mail it or AirDrop it.'; showPanel('exportpdf'); });
async function doExport(withInk, only) {
  hidePanel();
  toast('Making the PDF…', 60000);
  await flushInk();
  try {
    let blob; try { blob = await exportPdf({ score: V.score, file: V.file, doc: V.doc, withInk, only, boxOf: (i) => cropOf(i, true), onProgress: (f) => { $('#toast').textContent = `Making the PDF… ${Math.round(f * 100)}%`; } }); } finally { setPaperColor(PAPER_COLOR[S.paper] || '#fff'); }
    const pagePart = only && only.length === 1 ? ' – page ' + (only[0] + 1) : '';
    const name = (V.score.title || 'Score').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) + pagePart + (withInk ? '' : ' (clean)') + '.pdf';
    $('#toast').hidden = true;
    await shareBlob(blob, name);
  } catch (e) { console.error(e); toast('The PDF could not be made: ' + (e.message || e)); }
}
$('#expWith').addEventListener('click', () => doExport(true));
// A page as a picture (to send, or to put in another app): the page on show, or either of the two
function fillExportPics() {
  const box = $('#expPics'); box.textContent = '';
  if (!V.doc) return;
  const shown = [V.page, ...(V.spread === 2 && V.page + 1 < V.doc.pages ? [V.page + 1] : [])];
  for (const i of shown) {
    const b = el('button', 'rec-choice wide-choice'); b.append(icon('i-image'), el('b', '', shown.length > 1 ? (i === V.page ? 'Left page as a picture' : 'Right page as a picture') : 'This page as a picture'), el('span', '', 'Page ' + (i + 1) + ' · a JPEG with your markings'));
    b.addEventListener('click', () => doExportPicture(i)); box.append(b);
  }
}
async function doExportPicture(i) {
  hidePanel(); toast('Making the picture…', 60000);
  try {
    let blob; try { blob = await exportPicture({ score: V.score, doc: V.doc, i, withInk: !stage.classList.contains('hide-ink'), box: cropOf(i, true) }); } finally { setPaperColor(PAPER_COLOR[S.paper] || '#fff'); }
    const name = (V.score.title || 'Score').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) + ' – page ' + (i + 1) + '.jpg';
    $('#toast').hidden = true;
    await shareBlob(blob, name);
  } catch (e) { console.error(e); toast('The picture could not be made: ' + (e.message || e)); }
}
// a notebook's own bar
$('#nbPhotoBtn').addEventListener('click', () => { if (!V.inking) setInking(true); $('#insFile').click(); });
$('#nbAddBtn').addEventListener('click', () => {
  // which paper for the new page: the same, or any other
  const p = $('#addPagePop'); const open = p.hidden; closeInkPops(); p.hidden = !open;
  if (open && !p.dataset.built) { p.dataset.built = '1'; fillPaperChoices($('#apPapers'), async (k) => { p.hidden = true; await addPaperPage(k); }); }
});
$('#apSame').addEventListener('click', async () => { $('#addPagePop').hidden = true; const last = V.file && V.file.pagesTpl && V.file.pagesTpl[(V.file.pages || 1) - 1]; await addPaperPage(last || undefined); });
$('#nbPagesBtn').addEventListener('click', () => showPanel('pages'));
// a notebook: the page on show (or either of the two), or the whole notebook
$('#nbExportBtn').addEventListener('click', () => {
  finishTextBox(); clearSelection();
  const box = $('#expPages'); box.textContent = '';
  const shown = [V.page, ...(V.spread === 2 && V.page + 1 < V.doc.pages ? [V.page + 1] : [])];
  const cover = V.file && V.file.cover ? 1 : 0;
  for (const i of shown) {
    const b = el('button', 'rec-choice wide-choice'); b.append(icon('i-pdf'), el('b', '', shown.length > 1 ? (i === V.page ? 'The left page' : 'The right page') : 'This page'), el('span', '', i < cover ? 'The cover' : 'Page ' + (i + 1 - cover) + ' only'));
    b.addEventListener('click', () => doExport(true, [i])); box.append(b);
  }
  const all = el('button', 'rec-choice wide-choice'); all.append(icon('i-pen'), el('b', '', 'The whole notebook'), el('span', '', V.doc.pages + ' pages'));
  all.addEventListener('click', () => doExport(true)); box.append(all);
  box.hidden = false; $('#expWith').hidden = $('#expClean').hidden = true; fillExportPics();
  $('#expHint').textContent = 'The file opens in the share sheet: save it to Files, mail it, print it or AirDrop it.';
  showPanel('exportpdf');
});
$('#expClean').addEventListener('click', () => doExport(false));

// ---------- trim margins ----------
async function setTrim(on) {
  const score = V.score, base = V.base; if (!score || !base) return;
  score.trim = on;
  if (on && !score.trimBox) {
    toast('Measuring the margins…', 20000);
    let box = null;
    for (let i = 0; i < base.pages; i++) {
      if (V.score !== score) { $('#toast').hidden = true; return; }
      const [pw, ph] = base.sizes[i];
      const c = document.createElement('canvas');
      await base.render(i, c, 300, Math.round((300 * ph) / pw)).catch(() => {});
      box = unionBox(box, contentBox(c)); c.width = c.height = 0;
    }
    score.trimBox = box; $('#toast').hidden = true;
    if (V.score !== score) { db.put('scores', score); return; }
  }
  // (switched again while measuring: the switch as it is now decides)
  V.crop = V.score.trim && V.score.trimBox ? V.score.trimBox : null;
  await db.put('scores', V.score);
  clearCache(); V.splits.clear(); layout();
}
// the white margins of the pages, measured quietly once (for filling the screen side by side)
async function measureMargins() {
  const score = V.score, base = V.base; if (!score || !base || score._measuring) return;
  score._measuring = true;
  let box = null;
  for (let i = 0; i < Math.min(base.pages, 12); i++) {
    const [pw, ph] = base.sizes[i];
    const c = document.createElement('canvas');
    const done = await rqAdd(3, () => base.render(i, c, 240, Math.round((240 * ph) / pw)).then(() => true), () => V.score !== score).catch(() => false);
    if (done) box = unionBox(box, contentBox(c));
    c.width = c.height = 0;
    if (V.score !== score) { delete score._measuring; return; }
  }
  delete score._measuring;
  // keep a little paper around the music; only worth it when the margins are wide
  if (box) { const m = 0.012; box = { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), w: Math.min(1, box.w + 2 * m), h: Math.min(1, box.h + 2 * m) }; }
  score.autoBox = box && (box.w < 0.96 || box.h < 0.96) ? box : null;
  await db.put('scores', score);
  // drawn again at the new size; until then the pages already drawn are shown, so nothing waits
  if (V.score === score && score.autoBox) layoutWhenFree(score);
}
// A new layout made by Stand itself (not by you) waits until you are not writing, typing or moving
// something: a page drawn again under the Pencil would lose the line being written.
function layoutWhenFree(score, tries = 0) {
  if (V.score !== score) return;
  const busy = GS || Sel.entry || (typeof textEdit !== 'undefined' && textEdit) || (typeof tbEdit !== 'undefined' && tbEdit);
  if (busy && tries < 240) { setTimeout(() => layoutWhenFree(score, tries + 1), 250); return; }
  layout();
}
$('#trimMargins').addEventListener('change', (e) => setTrim(e.target.checked));

// ---------- score settings ----------
function fillScoreSettings() {
  if (!V.score) return;
  $('#metaTitle').value = V.score.title; $('#metaComposer').value = V.score.composer || '';
  $('#twoUp').checked = S.twoUp; $('#onePage').checked = S.onePage; $('#landscapeLock').checked = !!S.landscapeLock; $('#turnScore').checked = !!S.turnScore; $('#halfTurn').checked = S.halfTurn; $('#trimMargins').checked = !!V.score.trim;
  renderBookmarks(); renderJumps(); $('#paperTools').hidden = !(V.file && V.file.kind === 'paper');
  syncViewSeg();
  $('#bmCount').textContent = (V.score.bookmarks || []).length || '';
  $('#jumpCount').textContent = (V.score.jumps || []).length || '';
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
  // a notebook carries its title on the cover and the first page
  if (V.file && V.file.kind === 'paper' && V.file.title !== V.score.title) {
    V.file.title = V.score.title; db.put('files', V.file);
    openDocument(V.file).then((d) => { V.base = d; return reopenDoc(); }).catch(() => {});
  }
}
$('#metaTitle').addEventListener('change', saveScoreMeta);
$('#metaComposer').addEventListener('change', saveScoreMeta);
// one choice for how pages sit on the screen
const VIEW_HINT = { auto: 'Two pages side by side when the iPad is sideways, one when upright.', one: 'Always one page, as big as possible.', turn: 'The page turned sideways to fill the screen while the iPad is upright.' };
function viewMode() { return S.turnScore ? 'turn' : S.onePage ? 'one' : 'auto'; }
function syncViewSeg() { const m = viewMode(); $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === m)); $('#viewHint').textContent = VIEW_HINT[m]; }
$$('#viewSeg button').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.view;
  S.turnScore = m === 'turn'; S.onePage = m === 'one'; S.twoUp = m === 'auto';
  saveSettings(); syncViewSeg(); clearCache(); layout();
}));
$('#twoUp').addEventListener('change', (e) => { S.twoUp = e.target.checked; saveSettings(); clearCache(); layout(); });
$('#onePage').addEventListener('change', (e) => { S.onePage = e.target.checked; saveSettings(); clearCache(); layout(); });
$('#landscapeLock').addEventListener('change', (e) => { S.landscapeLock = e.target.checked; saveSettings(); applyOrientation(); });
$('#turnScore').addEventListener('change', (e) => { S.turnScore = e.target.checked; saveSettings(); clearCache(); layout(); });
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
  $('#delScoreConfirm').hidden = true;
  V.score = null;           // closeScore must not save it again
  await closeScore();
  await deleteScoreData(s);
  refreshLibrary();
  toast('Score removed');
});

// ---------- passages (marked parts of the piece) ----------
// Items for a passage go on the page's markings layer, without undo steps of their own.
function mapPassageItems(key, fn) {
  const L = layerFor(key);
  if (L && L.ready) { L.setItems(fn(L.items.slice()), true); return; }
  loadItems(key).then((items) => saveItems(key, fn(items)));
}
initPassages({
  scoreId: () => (V.score ? V.score.id : null),
  currentBpm: () => (metro.running ? metro.bpm : null),
  toast,
  showPanel,
  goToPage(orig) {
    if (!V.doc) return;
    for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === orig) { hidePanel(); goTo(i); return; }
    toast('That page is not in this score any more.');
  },
  mapItems: mapPassageItems,
});

// ---------- practice tracking ----------
// log:  { day: seconds }                                   (totals, kept from earlier versions)
// log2: { day: { pieces: { scoreId: seconds }, tools: seconds, note: '' } }
const practice = {
  scoreId: null, lastTick: Date.now(), log: {}, log2: {},
  slots: {}, plan: { weeks: {}, remind: false, lead: 0 },
  async load() {
    this.log = (await getSetting('log', {})) || {}; this.log2 = (await getSetting('log2', {})) || {};
    this.slots = (await getSetting('slots', {})) || {};
    this.plan = { weeks: {}, remind: false, lead: 0, ...((await getSetting('plan', null)) || {}) };
  },
  day(k = dayKey()) { return (this.log2[k] = this.log2[k] || { pieces: {}, tools: 0, note: '' }); },
  scoreOpened(id) { this.flush(); this.scoreId = id; this.lastTick = Date.now(); },
  scoreClosed() { this.flush(); this.scoreId = null; },
  toolsActive() {
    try { return metro.running || drone.running || scale.playing || tuner.running || !!recState || player.playing || !ref.paused || (P.pomo.running && P.pomo.phase === 'work'); } catch { return false; }
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
    // which half hour of the day: for the practice plan
    const nowD = new Date(), slot = nowD.getHours() * 2 + (nowD.getMinutes() >= 30 ? 1 : 0);
    const sd = this.slots[k] || (this.slots[k] = {}); sd[slot] = (sd[slot] || 0) + dt;
    // (a backup being restored: its log is not written over before Stand starts again)
    if (!window.__restoring) { setSetting('log', this.log); setSetting('log2', this.log2); setSetting('slots', this.slots); }
    if (openPanel === 'goal') renderTracker();
  },
};
setInterval(() => { practice.flush(); renderGoal(); }, 15000);

// ---------- practice from the iPad, on the iPhone ----------
// The iPhone keeps the iPad's log next to its own and shows both together.
const IPAD = { data: null, busy: false, last: 0, tried: 0 };
function allPractice() {
  const d = IPAD.data; if (!d) return { log: practice.log, log2: practice.log2, slots: practice.slots };
  const log = { ...practice.log }; for (const [k, v] of Object.entries(d.log || {})) log[k] = (log[k] || 0) + v;
  const log2 = {};
  for (const src of [practice.log2, d.log2 || {}]) for (const [k, x] of Object.entries(src)) {
    const o = log2[k] || (log2[k] = { pieces: {}, tools: 0, note: '' });
    for (const [id, v] of Object.entries(x.pieces || {})) o.pieces[id] = (o.pieces[id] || 0) + v;
    o.tools += x.tools || 0; if (!o.note && x.note) o.note = x.note;
  }
  const slots = {};
  for (const src of [practice.slots || {}, d.slots || {}]) for (const [k, x] of Object.entries(src)) { const o = slots[k] || (slots[k] = {}); for (const [i, v] of Object.entries(x)) o[i] = (o[i] || 0) + v; }
  return { log, log2, slots };
}
// what the iPad sends: the last year of its log and the names of its pieces
async function practiceForPhone() {
  practice.flush();
  const since = dayKey(new Date(Date.now() - 400 * 864e5)), keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k >= since));
  const log2 = keep(practice.log2), titles = {};
  for (const d of Object.values(log2)) for (const id of Object.keys(d.pieces || {})) titles[id] = titleOf(id);
  const pieces = scores.filter((x) => (x.seconds || 0) > 59).map((x) => ({ id: x.id, title: x.title, composer: x.composer || '', seconds: Math.round(x.seconds) }));
  for (const x of pieces) titles[x.id] = x.title;
  return { v: 1, at: Date.now(), log: keep(practice.log), log2, titles, pieces, goal: S.goal || 30, slots: keep(practice.slots || {}), plan: practice.plan };
}
// The iPhone asks for the scores, to read them: the list with small pictures, then one score as
// page pictures (the markings as a clear layer of their own). The same question asked twice at
// once (nearby and over the internet) is answered from the same work.
const blobToData = (b) => new Promise((res) => { if (!b) { res(null); return; } const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(b); });
const canvasData = (c, type, q) => new Promise((res) => c.toBlob((b) => blobToData(b).then(res), type, q));
const phoneAnswers = new Map();
// A score goes page by page (the iPhone asks for each in turn): only one page is ever drawn and
// held at a time here and there (a whole score at once took all the memory of both).
// (the same question come twice at once, nearby and over the internet: answered by the same work)
const phoneLive = new Map();
function answerPhone(q) {
  if (q && (q.what === 'page' || q.what === 'scoreinfo')) {
    const k = q.what + ':' + q.id + ':' + (q.i ?? '');
    if (phoneLive.has(k)) return phoneLive.get(k);
    const p = q.what === 'page' ? pageForPhone(q.id, q.i) : infoForPhone(q.id);
    phoneLive.set(k, p); const off = () => { if (phoneLive.get(k) === p) phoneLive.delete(k); }; p.then(off, off);
    return p;
  }
  const key = JSON.stringify(q || {});
  const hit = phoneAnswers.get(key); if (hit && Date.now() - hit.t < 60000) return hit.p;
  const p = (q && q.what === 'score') ? scoreForPhone(q.id) : scoresForPhone();
  // (only the list is kept for a moment: a whole score is never kept)
  if (!(q && q.what === 'score')) { phoneAnswers.set(key, { t: Date.now(), p }); p.catch(() => phoneAnswers.delete(key)); }
  return p;
}
// the score being sent, kept open while its pages are asked for (closed when nobody asks for a while)
// (opened again when the score has changed since: its pages, their order, its markings)
const PH = { id: null, key: null, base: null, doc: null, sc: null, t: 0, closeT: 0, busy: Promise.resolve(), opening: null };
const phoneStamp = (id) => { const sc = scores.find((x) => x.id === id); if (!sc) return 0; const cur = V.score && V.score.id === id ? V.score : sc; return Math.max(sc.added || 0, cur.edited || sc.edited || 0); };
async function phoneDoc(id) {
  const key = id + ':' + phoneStamp(id);
  if (PH.key === key && PH.doc) { PH.t = Date.now(); return PH; }
  if (PH.opening && PH.opening.key === key) return PH.opening.p;
  phoneDocClose();
  const p = (async () => {
    const sc0 = scores.find((x) => x.id === id); if (!sc0) throw new Error('none');
    const sc = V.score && V.score.id === id ? V.score : sc0;
    const file = await db.get('files', sc.fileId); if (!file) throw new Error('none');
    scoreFile(sc, file);
    const base = await openDocument(file, sc.sizes);
    if (!PH.opening || PH.opening.key !== key) { try { base.destroy(); } catch {} throw new Error('busy'); }
    Object.assign(PH, { id, key, base, doc: mapDoc(base, sc.pageMap, sc.cuts, sc.glue), sc, t: Date.now(), opening: null });
    clearInterval(PH.closeT); PH.closeT = setInterval(() => { if (Date.now() - PH.t > 25000) phoneDocClose(); }, 5000);
    return PH;
  })();
  PH.opening = { key, p };
  p.catch(() => { if (PH.opening && PH.opening.p === p) PH.opening = null; });
  return p;
}
function phoneDocClose() { clearInterval(PH.closeT); if (PH.base) try { PH.base.destroy(); } catch {} Object.assign(PH, { id: null, key: null, base: null, doc: null, sc: null, opening: null }); }
// (all questions about a score in turn: one never closes the score another is drawing)
function phoneJob(fn) { const job = PH.busy.then(fn); PH.busy = job.catch(() => {}); return job; }
function infoForPhone(id) {
  return phoneJob(async () => {
    const P = await phoneDoc(id);
    return { v: 2, id, n: Math.min(P.doc.pages, 2000), stamp: phoneStamp(id) };
  });
}
function pageForPhone(id, i) {
  // one page at a time, in turn (two questions at once never draw two pages together)
  return phoneJob(async () => {
    const P = await phoneDoc(id), doc = P.doc;
    if (!(i >= 0 && i < doc.pages)) throw new Error('none');
    const [pw, ph] = doc.sizes[i], W = 1170, H = Math.round((W * ph) / pw);
    const c = document.createElement('canvas');
    // (a page that could not be drawn is an error, never a white page kept on the iPhone)
    try { await doc.render(i, c, W, H); } catch (e) { c.width = c.height = 0; throw new Error('draw'); }
    const img = await canvasData(c, 'image/jpeg', 0.8);
    c.width = c.height = 0;
    if (!img) throw new Error('draw');
    let ink = null;
    const ik = doc.composite && doc.composite(i) ? `${doc.orig(i)}+${doc.gluedFrom(i)}` : doc.orig(i);
    const items = (await loadItems(id + ':' + ik).catch(() => [])).filter((x) => x.t !== 'passage' && x.t !== 'note' && !isHiddenItem(x));
    if (items.length) {
      await preloadAssets(items); await preloadMasks(items);
      const k = document.createElement('canvas'); k.width = W; k.height = H; const g = k.getContext('2d');
      for (const it of items) drawItem(g, it, W, H, false);
      ink = await canvasData(k, 'image/png'); k.width = k.height = 0;
    }
    P.t = Date.now();
    return { v: 2, id, i, w: W, h: H, img, ink };
  });
}
async function scoresForPhone() {
  const out = [];
  for (const sc0 of scores.filter((x) => !x.preview && x.kind !== 'comp')) {
    const sc = V.score && V.score.id === sc0.id ? { ...sc0, edited: V.score.edited, pages: V.score.pages } : sc0;   // (the open score is the newest)
    out.push({ id: sc.id, title: sc.title, composer: sc.composer || '', pages: sc.pages || 0, folder: (folderOf(sc.folder) || {}).name || '', fid: folderOf(sc.folder) ? sc.folder : '', stamp: Math.max(sc.added || 0, sc.edited || 0), thumb: await blobToData(sc.thumb) });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return { v: 1, at: Date.now(), scores: out };
}
async function scoreForPhone(id) {
  const sc = scores.find((x) => x.id === id); if (!sc) throw new Error('none');
  const file = await db.get('files', sc.fileId); if (!file) throw new Error('none');
  scoreFile(sc, file);
  const base = await openDocument(file, sc.sizes);
  try {
    const doc = mapDoc(base, sc.pageMap, sc.cuts, sc.glue), pages = [];
    for (let i = 0; i < Math.min(doc.pages, 150); i++) {
      const [pw, ph] = doc.sizes[i], W = 1300, H = Math.round((W * ph) / pw);
      const c = document.createElement('canvas');
      await doc.render(i, c, W, H).catch(() => {});
      const img = await canvasData(c, 'image/jpeg', 0.84);
      let ink = null;
      const items = (await loadItems(sc.id + ':' + doc.orig(i)).catch(() => [])).filter((x) => x.t !== 'passage');
      if (items.length) {
        await preloadAssets(items);
        const k = document.createElement('canvas'); k.width = W; k.height = H; const g = k.getContext('2d');
        for (const it of items) drawItem(g, it, W, H, false);
        ink = await canvasData(k, 'image/png'); k.width = k.height = 0;
      }
      c.width = c.height = 0;
      pages.push({ w: W, h: H, img, ink });
    }
    return { v: 1, id, pages };
  } finally { try { base.destroy && base.destroy(); if (base.pdf) base.pdf.destroy(); } catch {} }
}
const pHost = new PracticeHost(practiceForPhone, answerPhone);
window.__answerPhone = answerPhone;
// The practice plan (the week in half hours) is the same on both: the one changed last wins.
function adoptPlan(d) {
  const p = d && d.plan;
  if (!p || !p.weeks || !(p.at > (practice.plan.at || 0))) return;
  practice.plan = { weeks: {}, remind: false, lead: 0, ...p };
  setSetting('plan', practice.plan);
  if (openPanel === 'goal') renderTracker();
}
function syncPracticeHost() {
  if (PHONE) return;
  const on = S.shareIphone !== false && document.visibilityState === 'visible';
  if (on) pHost.start(); else pHost.stop();
  $('#shareIphone').checked = S.shareIphone !== false;
  $('#iphoneCodeRow').hidden = S.shareIphone === false;
  if (!pHost.on) $('#iphoneCode').textContent = '';
}
$('#shareIphone').addEventListener('change', (e) => { S.shareIphone = e.target.checked; saveSettings(); syncPracticeHost(); });
$('#iphoneCodeBtn').addEventListener('click', async () => {
  if (!pHost.on) await pHost.start();
  $('#iphoneCode').textContent = '···';
  const code = await pHost.showCode();
  $('#iphoneCode').textContent = code ? code.replace(/(\d{3})(\d{3})/, '$1 $2') : 'No connection';
});
document.addEventListener('visibilitychange', () => { if (!PHONE) setTimeout(syncPracticeHost, 300); else if (document.visibilityState === 'visible' && (IPAD.data || hasKnownIpad()) && Date.now() - Math.max(IPAD.last, IPAD.tried) > 60000) getIpadPractice(true); });
// On the iPhone the iPad's practice comes by itself: when the iPad is found nearby, and every few
// minutes while Stand is open (one short question, nothing in between).
function phoneAutoPractice() {
  directWatch((n) => { if (n && S.ipadCard !== false && Date.now() - Math.max(IPAD.last, IPAD.tried) > 45000) getIpadPractice(true); });
  setInterval(() => { if (document.visibilityState === 'visible' && S.ipadCard !== false && Date.now() - Math.max(IPAD.last, IPAD.tried) > (IPAD.data ? 8 : 2) * 60000) getIpadPractice(true); }, 60000);
}
function agoShort(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function renderIpadCard() {
  if (!PHONE) return;
  const d = IPAD.data, AP = allPractice(), log = AP.log;
  // (nothing from the iPad yet: the card waits out of sight; the two find each other by themselves)
  $('#ipadCard').classList.toggle('waiting', !d && $('#icCodeBox').hidden);
  $('#icEmpty').hidden = !!d || IPAD.busy || !$('#icCodeBox').hidden;
  $('#icRefresh').hidden = !d;
  $('#icSub').textContent = d ? 'iPad and iPhone · updated ' + agoShort(d.at) : 'From your iPad';
  const st = $('#icStats'); st.textContent = ''; const ul = $('#icPieces'); ul.textContent = '';
  if (!d) return;
  let week = 0; for (const x of rangeDays(7)) week += log[dayKey(x)] || 0;
  for (const [v, l] of [[fmtShort(log[dayKey()] || 0), 'today'], [fmtShort(week), 'last 7 days'], [String(streakOf(log)), 'day streak']]) { const x = el('div'); x.append(el('b', 'num', v), el('span', '', l)); st.append(x); }
  // the pieces of the last 7 days, most played first
  const per = {}; for (const x of rangeDays(7)) { const dd = AP.log2[dayKey(x)]; if (dd) for (const [id, v] of Object.entries(dd.pieces)) per[id] = (per[id] || 0) + v; }
  let rows = Object.entries(per).map(([id, v]) => [titleOf(id), v]);
  if (!rows.length) rows = (d.pieces || []).map((x) => [x.title, x.seconds]);
  rows.sort((a, b) => b[1] - a[1]);
  const top = rows.length ? rows[0][1] : 1;
  for (const [t, v] of rows.slice(0, 4)) { const li = el('li'); const bar = el('i'); bar.style.setProperty('--w', Math.max(6, (v / top) * 100) + '%'); li.append(el('span', 't', t), el('span', 'm', fmtMinutes(v)), bar); ul.append(li); }
}
async function getIpadPractice(quiet, code) {
  if (IPAD.busy) return; IPAD.busy = true; IPAD.tried = Date.now();
  $('#icFind').hidden = !!quiet; $('#icFindText').textContent = 'Looking for your iPad…'; if (!quiet) { $('#icCodeBox').hidden = true; } renderIpadCard();
  try {
    // iCloud first (no searching needed); then straight from the iPad
    if (!code && cloudAvailable() && await pullPracticeFromCloud() && IPAD.data && Date.now() - (IPAD.data.at || 0) < 6 * 3600e3) { IPAD.busy = false; $('#icFind').hidden = true; renderIpadCard(); return; }
    const d = await fetchPractice(code ? { code } : {});
    if (d && d.v === 1) { IPAD.data = d; IPAD.last = Date.now(); adoptPlan(d); await setSetting('ipadPractice', d); $('#icCodeBox').hidden = true; if (!quiet) toast('Practice from your iPad is here'); }
  } catch {
    if (!quiet) { $('#icCodeBox').hidden = false; $('#icCode').value = ''; }
  }
  IPAD.busy = false; $('#icFind').hidden = true;
  renderIpadCard(); renderGoal(); renderToday(); if (openPanel === 'goal') renderTracker();
}
// With iCloud (the apps): each device puts its own practice in your iCloud and reads the other's.
// The iPhone sees the iPad's practice and the iPad the iPhone's, whenever either has been online.
const CLOUD_MINE = () => (PHONE ? 'practice-iphone' : 'practice-ipad'), CLOUD_OTHER = () => (PHONE ? 'practice-ipad' : 'practice-iphone');
let cloudPushT = 0;
async function pushPracticeToCloud() {
  if (!cloudAvailable()) return;
  try {
    let d = await practiceForPhone();
    // iCloud keeps up to 1 MB per app: a long log is cut to the last months
    if (JSON.stringify(d).length > 400000) { const since = dayKey(new Date(Date.now() - 120 * 864e5)), keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k >= since)); d = { ...d, log: keep(d.log), log2: keep(d.log2) }; }
    cloudSet(CLOUD_MINE(), d);
  } catch {}
}
function pushPracticeSoon() { clearTimeout(cloudPushT); cloudPushT = setTimeout(pushPracticeToCloud, 4000); }
async function pullPracticeFromCloud() {
  if (!cloudAvailable()) return false;
  const d = await cloudGet(CLOUD_OTHER());
  if (d && d.v === 1 && (!IPAD.data || (d.at || 0) >= (IPAD.data.at || 0))) {
    IPAD.data = d; IPAD.last = Date.now(); adoptPlan(d); await setSetting('ipadPractice', d);
    renderIpadCard(); renderGoal(); renderToday(); if (openPanel === 'goal') renderTracker();
    return true;
  }
  return !!d;
}
if (cloudAvailable()) {
  onCloudChange((keys) => { if (keys.includes(CLOUD_OTHER())) pullPracticeFromCloud(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushPracticeToCloud(); else pullPracticeFromCloud(); });
  setInterval(() => { if (document.visibilityState === 'visible') pushPracticeToCloud(); }, 5 * 60 * 1000);
}
async function initPracticeSync() {
  if (cloudAvailable()) { if (!PHONE) IPAD.data = (await getSetting('ipadPractice', null)) || null; setTimeout(() => { pullPracticeFromCloud(); pushPracticeSoon(); }, 2000); }
  if (!PHONE) { setTimeout(syncPracticeHost, 3000); return; }
  IPAD.data = (await getSetting('ipadPractice', null)) || null;
  phoneAutoPractice();
  renderIpadCard(); renderGoal(); renderToday();
  // (found by itself on the same Wi-Fi: no button to press)
  setTimeout(() => getIpadPractice(true), 1500);
  window.__phs = initPhoneScores({ askIpad: (q, ms) => (window.__askIpadTest || askIpad)(q, ms), toast, connected: (fn) => directWatch((n) => { if (n) fn(); }) });
}
$('#icConnect').addEventListener('click', () => getIpadPractice(false));
$('#icRefresh').addEventListener('click', () => getIpadPractice(false));
$('#icTryAgain').addEventListener('click', () => getIpadPractice(false));
$('#icCancel').addEventListener('click', () => { $('#icCodeBox').hidden = true; renderIpadCard(); });
$('#icHide').addEventListener('click', () => { S.ipadCard = false; saveSettings(); applyTools(); toast('Hidden. Bring it back in Settings › Tools on the home screen.'); });
$('#icCode').addEventListener('input', (e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); e.target.value = v; if (v.length === 6) { e.target.blur(); getIpadPractice(false, v); } });
$('#icStats').addEventListener('click', () => showPanel('goal'));
$('#icPieces').addEventListener('click', () => showPanel('goal'));
document.addEventListener('visibilitychange', () => { practice.lastTick = Date.now(); if (document.visibilityState === 'visible' && V.doc) keepAwake(); });
// going to the background: everything waiting is written now (iOS may end Stand there)
function saveAllNow() {
  flushInk(); flushEdited();
  if (V.score && !V.score.preview && V.score.lastPage !== V.page) { V.score.lastPage = V.page; db.put('scores', V.score).catch(() => {}); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAllNow(); });
window.addEventListener('pagehide', saveAllNow);

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
  try { syncMetroLinks(); } catch {}
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
let beatTotal = 0, autoBars = 0;
// Automatic page turns: the page changes on the downbeat that starts every N bars, after the
// bars you were playing. Pages can still be turned by hand, wink or pedal as usual.
function autoTurnBar() {
  autoBars++;
  const n = S.autoTurn || 0;
  if (!n || autoBars <= 1 || (autoBars - 1) % n !== 0) return;
  if (!V.doc || $('#score').hidden) return;
  if (!RUN.on && V.page + (V.spread === 2 ? 1 : 0) >= V.doc.pages - 1) return;   // last page: stay
  turn(1);
}
metro.onBeat = (ev) => {
  const dots = $$('#beatDots .beat');
  dots.forEach((d, i) => d.classList.toggle('hit', i === ev.beat));
  const led = $('#metroLed'); led.classList.add('hit'); led.classList.toggle('acc', ev.acc === 2);
  setTimeout(() => { led.classList.remove('hit'); dots.forEach((d) => d.classList.remove('hit')); }, 110);
  if (ev.countIn) $('#recNote').textContent = `Count-in ${ev.beat + 1}`;
  else { beatTotal++; showBpm(ev.bpm); if (metro.ramp.on && openPanel === 'metronome') drawRamp(beatTotal); if (ev.beat === 0 && beatTotal > 0) { walk.bar(); autoTurnBar(); } }
  if (S.flash && ev.beat === 0 && !ev.muted) { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
};
metro.onStop = () => { updateMetroButtons(); showBpm(metro.bpm); };
function startMetro(opts) { unlock(); beatTotal = -1; autoBars = 0; const t = metro.start(opts); updateMetroButtons(); return t; }
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
  if (openPanel === 'tuner' && (t === 'harm' || t === 'drone')) setTimeout(() => sectionTour(t === 'harm' ? 'harmonics' : 'drone', { force: true }), 350);
  if (t === 'tune') { requestAnimationFrame(drawTrace); renderIntonation(); if (openPanel === 'tuner' && !tuner.running) { TU.userStopped = false; startTuner(); } }
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
  tuner.ref = S.ref; tuner.key = S.key; tuner.system = S.system; tuner.long = S.instrument === 'bass';
  drone.ref = S.ref; drone.refresh();
  scale.ref = S.ref;
  $('#refVal').textContent = S.ref + ' Hz';
  $('#keyField').hidden = S.system === 'equal';
  const inst = INSTRUMENTS[S.instrument];
  $('#fifthsRow').hidden = !(inst.strings && inst.fifths);
  const targets = stringTargets(S.instrument, S.ref, S.pureFifths && inst.fifths);
  tuner.strings = targets;
  // the instrument's range: from a little below its lowest string to about four octaves above
  { const RANGE = { flute: [60, 98], clarinet: [50, 94], oboe: [58, 93], voice: [40, 84], piano: null, other: null };
    const mid = (m) => S.ref * Math.pow(2, (m - 69) / 12);
    if (targets.length) { const lo = Math.min(...targets.map((t) => t.freq)), hi = Math.max(...targets.map((t) => t.freq)); tuner.setRange(lo * 0.94, hi * Math.pow(2, S.instrument === 'guitar' ? 2 : 3.3)); }
    else { const r = RANGE[S.instrument]; tuner.setRange(r ? mid(r[0] - 1) : 0, r ? mid(r[1] + 1) : 0); } }
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
// ---------- intonation: which notes you tend to play sharp or flat ----------
// Every tenth of a second of a held note (after its attack) counts once, per note and per day,
// so the picture is the same on any iPad and you can see whether a note is getting better.
const INTO = { run: null, dirty: false, view: 'notes', pick: null };
function intoStore() {
  if (!S.into2 || typeof S.into2 !== 'object') S.into2 = { notes: {} };
  // earlier versions kept only the 12 note names
  if (S.into && Array.isArray(S.into.n) && !S.into2.migrated) {
    S.into.n.forEach((n, pc) => { if (n) { const m = 60 + pc; const e = S.into2.notes[m] = S.into2.notes[m] || { n: 0, sum: 0, sq: 0, days: {} }; e.n += Math.round(n / 6); e.sum += (S.into.sum[pc] / n) * Math.round(n / 6); e.sq += Math.pow(S.into.sum[pc] / n, 2) * Math.round(n / 6); } });
    S.into2.migrated = true;
  }
  return S.into2;
}
function feedIntonation(r) {
  const t = performance.now();
  if (!r || r.held || !isFinite(r.cents) || r.midi === undefined) { INTO.run = null; return; }
  if (!INTO.run || INTO.run.midi !== r.midi) { INTO.run = { midi: r.midi, t0: t, last: 0 }; return; }
  if (t - INTO.run.t0 < 250 || t - INTO.run.last < 100 || Math.abs(r.cents) > 40) return;
  INTO.run.last = t;
  const d = intoStore(), k = r.midi, day = dayKey();
  const e = d.notes[k] = d.notes[k] || { n: 0, sum: 0, sq: 0, days: {} };
  e.n++; e.sum += r.cents; e.sq += r.cents * r.cents;
  const dd = e.days[day] = e.days[day] || [0, 0]; dd[0]++; dd[1] += r.cents;
  // keep 60 days of history
  const keys = Object.keys(e.days); if (keys.length > 60) delete e.days[keys.sort()[0]];
  INTO.dirty = true;
}
const MIN_N = 5;   // half a second of a held note
function noteStats(list) {
  let n = 0, sum = 0, sq = 0, week = [0, 0], before = [0, 0];
  const cut = dayKey(new Date(Date.now() - 6 * 864e5));
  for (const e of list) {
    n += e.n; sum += e.sum; sq += e.sq;
    for (const [d, [k, s2]] of Object.entries(e.days || {})) { const tgt = d >= cut ? week : before; tgt[0] += k; tgt[1] += s2; }
  }
  if (n < MIN_N) return null;
  const avg = sum / n, spread = Math.sqrt(Math.max(0, sq / n - avg * avg));
  const w = week[0] >= MIN_N ? week[1] / week[0] : null, b = before[0] >= MIN_N ? before[1] / before[0] : null;
  return { n, avg, spread, trend: w !== null && b !== null ? Math.abs(b) - Math.abs(w) : null };
}
function renderIntonation() {
  const d = intoStore(), box = $('#intoMap'); box.textContent = '';
  const notes = Object.entries(d.notes).map(([m, e]) => [+m, e]);
  $('#intoReset').hidden = !notes.length;
  // view switch
  let sw = $('#intoView');
  if (!sw) {
    sw = el('div', 'seg full into-view'); sw.id = 'intoView';
    for (const [k, l] of [['notes', 'By note name'], ['range', 'Across my range']]) { const b = el('button', '', l); b.dataset.v = k; b.addEventListener('click', () => { INTO.view = k; INTO.pick = null; renderIntonation(); }); sw.append(b); }
    box.before(sw);
  }
  $$('#intoView button').forEach((b) => b.classList.toggle('on', b.dataset.v === INTO.view));
  let cols = [];
  if (INTO.view === 'notes') {
    for (let pc = 0; pc < 12; pc++) cols.push({ key: 'pc' + pc, label: NOTE_NAMES[pc], sub: '', st: noteStats(notes.filter(([m]) => ((m % 12) + 12) % 12 === pc).map(([, e]) => e)) });
  } else {
    const inst = INSTRUMENTS[S.instrument];
    const played = notes.filter(([, e]) => e.n >= MIN_N).map(([m]) => m);
    let lo = inst.strings ? inst.strings[0] : 48, hi = lo + 36;
    if (played.length) { lo = Math.min(lo, ...played); hi = Math.max(lo + 12, ...played); }
    for (let m = lo; m <= hi; m++) { const e = d.notes[m]; cols.push({ key: 'm' + m, label: NOTE_NAMES[((m % 12) + 12) % 12], sub: String(Math.floor(m / 12) - 1), st: e ? noteStats([e]) : null, midi: m }); }
  }
  box.classList.toggle('range', INTO.view === 'range');
  const any = cols.some((c) => c.st);
  box.hidden = !any; sw.hidden = !notes.length;
  for (const c of cols) {
    const a = c.st ? c.st.avg : null;
    const col = el('button', 'into-col' + (a === null ? ' none' : Math.abs(a) < 5 ? ' ok' : '') + (INTO.pick === c.key ? ' pick' : ''));
    const track = el('div', 'into-track'); const bar = el('i');
    if (a !== null) {
      const h = Math.min(1, Math.abs(a) / 25) * 50; bar.style.height = Math.max(2, h) + '%'; bar.style[a > 0 ? 'bottom' : 'top'] = '50%';
      // how steady: a faint band of the usual spread
      const band = el('s'); const sp = Math.min(50, (c.st.spread / 25) * 50); band.style.top = 50 - Math.min(50, ((a + c.st.spread) / 25) * 50) + '%'; band.style.height = Math.min(100, sp * 2) + '%'; track.append(band);
    }
    track.append(bar);
    const ra = a === null ? null : Math.round(a);
    col.append(track, el('b', '', c.label), el('small', 'num', ra === null ? '' : (ra > 0 ? '+' : ra < 0 ? '−' : '') + Math.abs(ra)));
    if (c.sub && c.label === 'C') col.append(el('small', 'oct', c.label + c.sub));
    col.addEventListener('click', () => { INTO.pick = INTO.pick === c.key ? null : c.key; renderIntonation(); });
    box.append(col);
  }
  // the picked note, in words
  let det = $('#intoDetail'); if (!det) { det = el('p', 'hint into-detail'); det.id = 'intoDetail'; box.after(det); }
  const pick = cols.find((c) => c.key === INTO.pick);
  if (pick && pick.st) {
    const st = pick.st, a = Math.round(st.avg);
    const name = pick.label + (pick.sub || '');
    let t = `${name}: ${Math.abs(a) < 3 ? 'in tune on average' : Math.abs(a) + '¢ ' + (a > 0 ? 'sharp' : 'flat') + ' on average'}, ${st.spread < 6 ? 'very steady' : st.spread < 12 ? 'fairly steady' : 'it varies'} (±${Math.round(st.spread)}¢).`;
    if (st.trend !== null) t += st.trend > 1.5 ? ' Better this week than before.' : st.trend < -1.5 ? ' Less in tune this week than before.' : ' About the same as before.';
    det.textContent = t; det.hidden = false;
  } else det.hidden = true;
  const all = cols.filter((c) => c.st);
  const off = all.filter((c) => Math.abs(c.st.avg) >= 6).sort((x, y) => Math.abs(y.st.avg) - Math.abs(x.st.avg));
  $('#intoSummary').textContent = !all.length ? 'Play scales or a passage with the tuner on. Stand learns which notes you tend to play sharp or flat.'
    : !off.length ? (all.length === 1 ? `The note you played sits within 5 cents on average. Lovely.` : `All ${all.length} notes you played sit within 5 cents on average. Lovely.`)
      : 'Watch ' + off.slice(0, 3).map((c) => `${c.label}${c.sub || ''} (${Math.round(Math.abs(c.st.avg))}¢ ${c.st.avg > 0 ? 'sharp' : 'flat'})`).join(', ') + '. Bars above the line are sharp, below are flat; tap a note for more.';
}
$('#intoReset').addEventListener('click', () => { if ($('#intoReset').dataset.armed !== '1') { $('#intoReset').dataset.armed = '1'; $('#intoReset').textContent = 'Tap again to clear'; setTimeout(() => { $('#intoReset').dataset.armed = ''; $('#intoReset').textContent = 'Start over'; }, 3000); return; } S.into = null; S.into2 = null; saveSettings(); renderIntonation(); });
// The tuner's screen timers run only while the tuner listens (none at all when it is off).
const TT = { t: 0, n: 0 };
function tunerTimers() {
  if (TT.t) return;
  TT.t = setInterval(() => {
    if (!tuner.active && !INTO.dirty) { clearInterval(TT.t); TT.t = 0; return; }
    TT.n++;
    if (tuner.running && ((openPanel === 'tuner' && currentTunerTab === 'tune') || TU.mini)) drawTrace();
    if (TT.n % 6 === 0 && INTO.dirty) {
      INTO.dirty = false;
      if (openPanel === 'tuner' && currentTunerTab === 'tune') renderIntonation();
      clearTimeout(INTO.saveT); INTO.saveT = setTimeout(saveSettings, 3000);
    }
    // iOS sometimes keeps the sound asleep until the screen is touched (after Stand was away): say so
    if (TT.n % 8 === 0 && tuner.running && !lastReading) {
      let st = 'running'; try { st = getCtx().state; } catch {}
      if (st !== 'running') { if (openPanel === 'tuner') $('#tCents').textContent = 'Tap the screen to start listening'; if (TU.mini) $('#mtCents').textContent = 'Tap to listen'; }
    }
  }, 100);
}

tuner.onReading = (r) => {
  lastReading = r; if (!TT.t) tunerTimers();
  if (currentTunerTab === 'tune') feedIntonation(r);
  const face = $('#tunerFace');
  $$('#stringRow button').forEach((b) => { const near = r && !r.held && r.string === b.dataset.label; b.classList.toggle('near', near); b.classList.toggle('ok', near && Math.abs(r.cents) < 3); });
  if (H.follow) followHarmonics(r);
  miniReading(r);
  if (!r) {
    // the sound stopped: the last note stays (dimmed) for a few seconds, so the display does not
    // flash on and off between notes and bow changes
    const goIdle = () => {
      face.classList.add('idle'); face.classList.remove('intune', 'held');
      $('#tCents').textContent = tuner.active ? 'Play a note' : 'The tuner is off'; $('#tHz').innerHTML = '&nbsp;';
      needle.target = 0; animateNeedle();
    };
    clearTimeout(TU.idleT);
    if (tuner.running && TU.shownAt && performance.now() - TU.shownAt < 4000) { face.classList.add('held'); face.classList.remove('intune'); TU.idleT = setTimeout(goIdle, 4000); }
    else goIdle();
    return;
  }
  clearTimeout(TU.idleT); TU.shownAt = performance.now();
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
// A small bar under the trace: are your notes mostly high or low over the last 10 seconds?
function updateTendency() {
  const mark = $('#tendMark'), txt = $('#tendText'); if (!mark || !txt) return;
  const t = performance.now();
  const pts = tuner.trace.filter((p) => t - p.t < 10000 && Math.abs(p.cents) <= 50);
  if (pts.length < 8) { mark.style.left = '50%'; mark.classList.remove('ok'); txt.textContent = 'Play a few notes to see your tendency.'; return; }
  const mean = pts.reduce((a, p) => a + p.cents, 0) / pts.length;
  const high = pts.filter((p) => p.cents > 5).length / pts.length, low = pts.filter((p) => p.cents < -5).length / pts.length;
  mark.style.left = (50 + clamp(mean, -50, 50)) + '%';
  mark.classList.toggle('ok', Math.abs(mean) < 5);
  const dir = Math.abs(mean) < 5 ? 'in tune on average' : mean > 0 ? `high by ${Math.round(mean)} cents` : `low by ${Math.round(-mean)} cents`;
  txt.textContent = `Tendency: ${dir}. ${Math.round(high * 100)}% of notes high, ${Math.round(low * 100)}% low.`;
}
function drawTrace() {
  updateTendency();
  paintTrace('#traceCanvas');
  if (TU.mini) {
    paintTrace('#mtTrace');
    const now = performance.now();
    if (now - (renderMiniInto.at || 0) > 600) { renderMiniInto.at = now; renderMiniInto(); }
  }
}
// the small tuner's copy of "Your intonation": compact bars, same data and same two views
function renderMiniInto() {
  const box = $('#mtInto'); if (!box) return;
  const notes = Object.entries(intoStore().notes).map(([m, e]) => [+m, e]);
  const cols = [];
  if (INTO.view === 'notes') {
    for (let pc = 0; pc < 12; pc++) cols.push({ label: NOTE_NAMES[pc], st: noteStats(notes.filter(([m]) => ((m % 12) + 12) % 12 === pc).map(([, e]) => e)) });
  } else {
    const inst = INSTRUMENTS[S.instrument];
    const played = notes.filter(([, e]) => e.n >= MIN_N).map(([m]) => m);
    let lo = inst.strings ? inst.strings[0] : 48, hi = lo + 36;
    if (played.length) { lo = Math.min(lo, ...played); hi = Math.max(lo + 12, ...played); }
    for (let m = lo; m <= hi; m++) { const e = intoStore().notes[m]; cols.push({ label: NOTE_NAMES[((m % 12) + 12) % 12], st: e ? noteStats([e]) : null }); }
  }
  const any = cols.some((c) => c.st);
  box.hidden = !any;
  if (!any) return;
  box.textContent = '';
  for (const c of cols) {
    const col = el('div', 'mi-col' + (c.st && Math.abs(c.st.avg) < 5 ? ' ok' : ''));
    const track = el('div', 'mi-track');
    if (c.st) {
      const a = c.st.avg, bar = el('i', 'mi-bar');
      bar.style.height = Math.max(2, Math.min(1, Math.abs(a) / 25) * 50) + '%';
      bar.style[a > 0 ? 'bottom' : 'top'] = '50%';
      track.append(bar);
    }
    col.append(track, el('small', 'mi-lbl', c.label));
    box.append(col);
  }
}
$('#mtInto').addEventListener('click', () => { INTO.view = INTO.view === 'notes' ? 'range' : 'notes'; INTO.pick = null; renderMiniInto.at = 0; renderMiniInto(); });
function paintTrace(sel) {
  const c = $(sel); if (!c || !c.getClientRects().length) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const good = css('--good'), accent = css('--accent-text'), muted = css('--muted');
  const span = 8000, t = performance.now();
  const Y = (cents) => H / 2 - (clamp(cents, -50, 50) / 50) * (H / 2 - 8);
  g.fillStyle = good; g.globalAlpha = 0.14; g.fillRect(0, Y(5), W, Y(-5) - Y(5)); g.globalAlpha = 1;
  g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.globalAlpha = 1;
  if (sel !== '#mtTrace') { g.fillStyle = muted; g.font = '600 10px ui-rounded, -apple-system, sans-serif'; g.fillText('+50', 6, 12); g.fillText('−50', 6, H - 4); }
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

}

async function startTuner() {
  try {
    TU.userStopped = false;
    const p = tuner.start(); updateTunerButtons();
    if (!tuner.running) { $('#tCents').textContent = 'Play a note'; }
    await p;
    $('#micHint').textContent = 'Listening. Nothing leaves this device.';
    updateTunerButtons();
    return true;
  } catch (e) { $('#micHint').textContent = micErrorText(e); toast(micErrorText(e), 5000); return false; }
}
function stopTuner() { tuner.stop(); tuner.onReading(null); H.follow = false; H.ownsMic = false; TU.userStopped = true; updateTunerButtons(); }
// ---------- the tuner is on whenever it is open (Stop turns it off), and can stay on screen small ----------
const TU = { userStopped: false, mini: false };
function miniReading(r) {
  if (!TU.mini) return;
  const box = $('#miniTuner');
  const idle = () => { box.classList.remove('dim'); $('#mtNote').textContent = '–'; $('#mtOct').textContent = ''; $('#mtCents').textContent = tuner.active ? 'Play a note' : 'Off'; $('#mtNeedle').style.left = '50%'; box.classList.remove('intune', 'off'); };
  clearTimeout(TU.miniT);
  if (!r) { if (tuner.running && TU.miniAt && performance.now() - TU.miniAt < 4000) { box.classList.add('dim'); TU.miniT = setTimeout(idle, 4000); } else idle(); return; }
  TU.miniAt = performance.now(); box.classList.remove('dim');
  $('#mtNote').textContent = r.name; $('#mtOct').textContent = r.octave;
  if (r.held) return;
  const c = clamp(r.cents, -50, 50);
  $('#mtNeedle').style.left = (50 + c) + '%';
  $('#mtCents').textContent = Math.abs(r.cents) < 3 ? 'In tune' : (r.cents > 0 ? '+' : '−') + Math.abs(r.cents).toFixed(0) + ' cents';
  box.classList.toggle('intune', Math.abs(r.cents) < 3); box.classList.toggle('off', Math.abs(r.cents) >= 15);
}
async function showMiniTuner(on) {
  TU.mini = on; $('#miniTuner').hidden = !on;
  if (on) { hidePanel(); if (!tuner.running) await startTuner(); miniReading(lastReading); }
  else if (openPanel !== 'tuner' && tuner.active && !H.follow) { tuner.stop(); tuner.onReading(null); updateTunerButtons(); }
}
$('#tunerFloat').addEventListener('click', () => showMiniTuner(true));
$('#mtClose').addEventListener('click', (e) => { e.stopPropagation(); showMiniTuner(false); });
{
  // drag it anywhere
  const box = $('#miniTuner'); let d = null;
  box.addEventListener('pointerdown', (e) => { if (e.target.closest('.mt-x')) return; const r = box.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; try { box.setPointerCapture(e.pointerId); } catch {} });
  box.addEventListener('pointermove', (e) => { if (!d) return; box.style.left = clamp(e.clientX - d.dx, 4, innerWidth - box.offsetWidth - 4) + 'px'; box.style.top = clamp(e.clientY - d.dy, 4, innerHeight - box.offsetHeight - 4) + 'px'; box.style.right = 'auto'; });
  const up = () => { d = null; }; box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  // turning the iPad: a tuner dragged to the side stays on the screen
  const keepIn = () => {
    if (box.hidden || !box.style.left) return;
    const x = parseFloat(box.style.left), y = parseFloat(box.style.top);
    box.style.left = clamp(x, 4, Math.max(4, innerWidth - box.offsetWidth - 4)) + 'px';
    box.style.top = clamp(y, 4, Math.max(4, innerHeight - box.offsetHeight - 4)) + 'px';
  };
  window.addEventListener('resize', keepIn); window.addEventListener('orientationchange', () => setTimeout(keepIn, 300));
  // a tap opens the full tuner
  box.addEventListener('click', (e) => { if (e.target.closest('.mt-x')) return; });
}
function updateTunerButtons() {
  if (tuner.active) tunerTimers();
  const b = $('#tunerToggle');
  // while the microphone is still opening the tuner already counts as on (a tap then stops it)
  b.innerHTML = tuner.active ? '<svg><use href="#i-stop"/></svg><span>Stop tuner</span>' : '<svg><use href="#i-mic"/></svg><span>Start tuner</span>';
  b.classList.toggle('primary', !tuner.active);
  const h = $('#hListen');
  h.innerHTML = H.follow ? '<svg><use href="#i-pause"/></svg><span>Pause listening</span>' : '<svg><use href="#i-mic"/></svg><span>Listen</span>';
  h.classList.toggle('primary', !H.follow);
}
$('#tunerToggle').addEventListener('click', () => (tuner.active ? stopTuner() : startTuner()));
// Leaving the app turns the microphone off (the tuner and the drone's ear); coming back turns them
// on again. If iOS takes the microphone away, they open it again.
const MICPAUSE = { tuner: false, ear: false, metro: null };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (recState) return;                      // a recording keeps going
    // the metronome pauses too (it would hold the sound of other apps), and comes back where it was
    if (metro.running) { MICPAUSE.metro = { beat: Math.floor((metro._beatCount || 0) / metro.beats) * metro.beats }; metro.stop(true); }
    MICPAUSE.tuner = tuner.active; if (tuner.active) { tuner.stop(); tuner.onReading(null); }
    MICPAUSE.ear = !!keyEar.ear; if (keyEar.ear) keyEar.ear.stop();
  } else {
    if (MICPAUSE.tuner && !TU.userStopped && (openPanel === 'tuner' || TU.mini)) startTuner().then(updateTunerButtons);
    if (MICPAUSE.ear && keyEar.ear) keyEar.ear.start();
    if (MICPAUSE.metro) { const m = MICPAUSE.metro; MICPAUSE.metro = null; if (!metro.running) startMetro({ fromBeat: m.beat }); }
    MICPAUSE.tuner = MICPAUSE.ear = false;
    updateTunerButtons();
  }
});
window.addEventListener('stand-mic-lost', () => {
  if (tuner.running) tuner.restart();
  if (keyEar.ear && keyEar.ear.on) keyEar.ear.restart();
});
// a new sound system: the key listener connects to it again (the tuner, metronome and drone do it themselves)
window.addEventListener('stand-audio-new', () => { if (keyEar.ear && keyEar.ear.on) keyEar.ear.restart(); });

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
const DL = { adding: false };   // adding notes to "My list"
(function buildDroneUI() {
  const box = $('#droneNotes');
  NOTE_NAMES.forEach((n, i) => {
    const b = el('button', '', n); b.dataset.pc = i;
    b.addEventListener('click', () => {
      // adding notes to "My list": each note tapped joins the list, in order
      if (DL.adding && droneMode() === 'list') { S.droneList = [...(S.droneList || []), i]; saveSettings(); syncDrone(); b.classList.add('added'); setTimeout(() => b.classList.remove('added'), 260); return; }
      if (drone.running) drone.change(i); else drone.pc = i; keyEar.set(i, drone.chord === 'minor'); syncDrone(); persistDrone();
    });
    box.append(b);
  });
  const sel = $('#droneSound'); sel.textContent = '';
  for (const [k, v] of Object.entries(DRONE_VOICES)) {
    const o = el('option', '', v); o.value = k; sel.append(o);
    const b = el('button', '', v); b.dataset.sound = k;
    b.addEventListener('click', () => { sel.value = k; sel.dispatchEvent(new Event('change')); });
    $('#droneSoundSeg').append(b);
  }
  const ch = $('#droneChord'); ch.textContent = '';
  for (const [k, v] of Object.entries(DRONE_CHORDS)) { const o = el('option', '', v.label); o.value = k; ch.append(o); }
})();
function syncDrone() {
  $$('#droneNotes button').forEach((b) => b.classList.toggle('on', +b.dataset.pc === drone.pc));
  $('#droneOct').value = drone.octave; $('#droneSound').value = drone.sound; $('#droneChord').value = drone.chord;
  $('#droneOctave').checked = drone.lowOct; $('#droneVol').value = drone.volume;
  $$('#droneSoundSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sound === drone.sound));
  const mode = droneMode();
  $$('#droneModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('#droneModeHint').textContent = {
    stay: 'Tap a note above whenever the key changes, or press a pedal; the drone glides to it.',
    listen: 'Stand listens to you and moves the drone to the key you are playing in (it waits until the new key is clear).',
    list: 'Tap Add notes, then the notes in the order of the piece. While playing, tap Next (or ▶ in the bar at the bottom, or a pedal) when the music moves on.',
    walk: 'The drone walks through the keys by itself, to practise every key.',
  }[mode];
  $('#droneListen').hidden = mode !== 'listen'; $('#droneSensRow').hidden = $('#droneSensEnds').hidden = mode !== 'listen';
  $('#droneSens').value = S.earSens ?? 0.6;
  $('#droneListBox').hidden = mode !== 'list';
  $('#droneWalkRow').hidden = mode !== 'walk';
  $('#dronePedal').value = S.dronePedal || 'semi'; $('#dronePedalRow').hidden = mode === 'list' || mode === 'walk';
  $('#droneWalk').value = S.droneWalk === 'chromatic' ? 'chromatic' : 'fifths'; $('#droneWalkBars').value = S.droneWalkBars || 8; $('#droneWalkBarsRow').hidden = mode !== 'walk';
  const list = S.droneList || [];
  const chips = $('#droneChips'); chips.textContent = '';
  if (!DL.adding && !list.length) chips.append(el('span', 'hint', 'No notes yet. Tap Add notes, then the notes in order.'));
  if (DL.adding && !list.length) chips.append(el('span', 'hint', 'Tap the notes above, in order.'));
  $('#droneListAdd').innerHTML = DL.adding ? '<svg><use href="#i-check"/></svg><span>Done</span>' : '<svg><use href="#i-plus"/></svg><span>Add notes</span>';
  $('#droneListAdd').classList.toggle('primary', DL.adding);
  $('#droneListBox').classList.toggle('adding', DL.adding);
  $('#droneNotes').classList.toggle('adding', DL.adding && mode === 'list');
  if (mode !== 'list') DL.adding = false;
  list.forEach((pc, i) => { const b = el('button', i === (S.droneListAt || 0) && drone.running ? 'on' : '', NOTE_NAMES[pc]); const x = el('span', 'x', '×'); b.append(x); x.addEventListener('click', (e) => { e.stopPropagation(); list.splice(i, 1); S.droneList = list; saveSettings(); syncDrone(); }); b.addEventListener('click', () => { S.droneListAt = i; saveSettings(); if (drone.running) drone.change(pc); else drone.pc = pc; syncDrone(); }); chips.append(b); });
  const nx = list.length ? list[((S.droneListAt || 0) + 1) % list.length] : null;
  $('#droneNextNote').textContent = nx === null ? '' : NOTE_NAMES[nx];
  $('#droneNext').disabled = !list.length;
  $('#dronePillNext').hidden = !(drone.running && mode === 'list' && list.length);
  keyEar.sync();
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
$('#droneWalk').addEventListener('change', (e) => { S.droneWalk = e.target.value; saveSettings(); syncDrone(); walk.reset(); });
function droneMode() { return S.droneMode || (S.droneWalk && S.droneWalk !== 'stay' ? 'walk' : 'stay'); }
$$('#droneModeSeg button').forEach((b) => b.addEventListener('click', () => { S.droneMode = b.dataset.mode; if (S.droneMode === 'walk' && (!S.droneWalk || S.droneWalk === 'stay')) S.droneWalk = 'fifths'; saveSettings(); syncDrone(); walk.reset(); }));
function droneNext(dir = 1) {
  const list = S.droneList || []; if (!list.length) return;
  S.droneListAt = ((S.droneListAt || 0) + (dir < 0 ? list.length - 1 : 1)) % list.length; saveSettings();
  const pc = list[S.droneListAt];
  if (drone.running) drone.change(pc); else drone.pc = pc;
  syncDrone();
}
$('#droneNext').addEventListener('click', () => droneNext());
$('#dronePillNext').addEventListener('click', () => droneNext());
// "Add notes": while on, every note tapped above joins the list; Done ends it
$('#droneListAdd').addEventListener('click', () => { DL.adding = !DL.adding; syncDrone(); });
$('#droneListClear').addEventListener('click', () => { S.droneList = []; S.droneListAt = 0; saveSettings(); syncDrone(); });
// A pedal (or the arrow keys) moves the drone while it sounds and no score is open: through your
// list, or a semitone / a fifth up and down (Pedal moves the drone).
document.addEventListener('keydown', (e) => {
  if (!$('#score').hidden || e.target.matches('input, select, textarea') || !drone.running) return;
  const fwd = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key), back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
  if (!fwd && !back) return;
  const mode = droneMode();
  if (mode === 'list') { if ((S.droneList || []).length) { e.preventDefault(); droneNext(fwd ? 1 : -1); } return; }
  const how = S.dronePedal || 'semi';
  if (how === 'off') return;
  e.preventDefault();
  const step = how === 'fifths' ? 7 : 1;
  drone.change((drone.pc + (fwd ? step : 12 - step)) % 12);
  keyEar.set(drone.pc, drone.chord === 'minor'); syncDrone(); persistDrone();
});
$('#dronePedal').addEventListener('change', (e) => { S.dronePedal = e.target.value; saveSettings(); });
// listening for the key
const keyEar = {
  ear: null,
  sync() {
    const want = drone.running && droneMode() === 'listen';
    if (want && !this.ear) {
      this.ear = new KeyFollower((k) => {
        if (!drone.running) return;
        if (drone.chord === 'major' || drone.chord === 'minor') drone.chord = k.minor ? 'minor' : 'major';
        drone.change(k.pc); syncDrone(); persistDrone();
        // (reading the score, the drone panel closed: said in a word, the pill shows it too)
        if (!(openPanel === 'tuner' && currentTunerTab === 'drone')) toast('Drone → ' + NOTE_NAMES[k.pc] + (k.minor ? ' minor' : ' major'), 1800);
      }, (k, err) => {
        const t = $('#droneHear');
        if (err) { t.textContent = err; return; }
        if (k) t.innerHTML = `Hearing <b>${NOTE_NAMES[k.pc]} ${k.minor ? 'minor' : 'major'}</b> · drone on <b>${NOTE_NAMES[drone.pc]}</b>`;
        else t.innerHTML = `Listening… the drone stays on <b>${NOTE_NAMES[drone.pc]}</b> until the key clearly changes`;
      });
      this.ear.sens = S.earSens ?? 0.6;
      this.ear.set(drone.pc, drone.chord === 'minor');
      this.ear.start();
    } else if (!want && this.ear) { this.ear.stop(); this.ear = null; $('#droneHear').textContent = 'Play: when the key clearly changes, the drone moves to it.'; }
  },
  set(pc, minor) { if (this.ear) this.ear.set(pc, minor); },
};
$('#droneSens').addEventListener('input', (e) => { S.earSens = +e.target.value; if (keyEar.ear) keyEar.ear.sens = S.earSens; saveSettings(); });
$('#droneWalkBars').addEventListener('change', (e) => { S.droneWalkBars = +e.target.value; saveSettings(); walk.reset(); });
function startDrone() { unlock(); drone.start(); walk.reset(); syncDrone(); }
function stopDrone() { drone.stop(); walk.stop(); syncDrone(); }
$('#droneToggle').addEventListener('click', () => (drone.running ? stopDrone() : startDrone()));
$('#dronePillStop').addEventListener('click', stopDrone);
// The drone can walk through keys: around the circle of fifths or up by semitones,
// every few bars of the metronome tempo (in time with the click when it is running).
const walk = {
  bars: 0, timer: 0,
  reset() { this.bars = 0; clearInterval(this.timer); this.timer = 0; if (drone.running && droneMode() === 'walk' && !metro.running) this.timer = setInterval(() => this.bar(), (metro.beats * 60000) / metro.bpm); },
  stop() { clearInterval(this.timer); this.timer = 0; },
  bar() {
    if (!drone.running || droneMode() !== 'walk') return;
    this.bars++;
    if (this.bars % (S.droneWalkBars || 8)) return;
    drone.change((drone.pc + (S.droneWalk === 'chromatic' ? 1 : 7)) % 12);
    syncDrone(); persistDrone();
  },
};

// ---------- metronome shortcuts inside the drone and scale tools ----------
function syncMetroLinks() {
  $$('.ml-bpm').forEach((x) => (x.textContent = Math.round(metro.bpm)));
  $$('.ml-on').forEach((x) => (x.checked = metro.running));
}
$$('.ml-down').forEach((b) => holdRepeat(b, () => { setBpm(metro.bpm - 1); syncMetroLinks(); }));
$$('.ml-up').forEach((b) => holdRepeat(b, () => { setBpm(metro.bpm + 1); syncMetroLinks(); }));
$$('.ml-on').forEach((x) => x.addEventListener('change', (e) => {
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
  $('#scaleCount').checked = scale.countIn !== false;
  $('#scaleClick').checked = !!scale.click; showScaleBpm();
  $('#scaleDrone').checked = scale.drone; $('#scaleRepeat').checked = scale.repeat;
  $('#scaleTitle').textContent = scale.title();
  $('#scalePillNote').textContent = scale.title();
  syncMetroLinks();
  renderScaleStrip();
}
function persistScale() {
  S.scale = { tonic: scale.tonic, octave: scale.octave, octaves: scale.octaves, type: scale.type, direction: scale.direction, system: scale.system, perBeat: scale.perBeat, sound: scale.sound, volume: scale.volume, drone: scale.drone, click: scale.click, repeat: scale.repeat, countIn: scale.countIn, bpm: scale.bpm };
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
// count-in: the big note shows 4 3 2 1 before the first note
$('#scaleCount').addEventListener('change', (e) => { scale.countIn = e.target.checked; persistScale(); });
scale.onCount = (n) => { $('#scaleNote').textContent = n; $('#scaleCents').textContent = 'count-in'; };
$('#scaleVol').addEventListener('input', (e) => { scale.setVolume(+e.target.value); persistScale(); });
$('#scaleDrone').addEventListener('change', (e) => { scale.drone = e.target.checked; scaleChanged(); });
$('#scaleRepeat').addEventListener('change', (e) => { scale.repeat = e.target.checked; persistScale(); });
scale.onNote = (ev) => {
  $('#scaleCents').textContent = '';
  const name = midiName(ev.midi);
  $('#scaleNote').textContent = name;
  const c = Math.round(scale.cents(ev.midi));
  $('#scaleCents').textContent = scale.system === 'equal' ? '' : (c === 0 ? '±0¢' : (c > 0 ? '+' : '−') + Math.abs(c) + '¢');
  $('#scalePillNote').textContent = name;
  $$('#scaleStrip span').forEach((s) => s.classList.toggle('on', +s.dataset.midi === ev.midi));
};
scale.onEnd = () => { updateScaleButtons(); const b = $('#scaleBeats'); if (b) b.textContent = ''; };
function updateScaleButtons() {
  const b = $('#scaleToggle');
  b.innerHTML = scale.playing ? '<svg><use href="#i-stop"/></svg><span>Stop</span>' : '<svg><use href="#i-play"/></svg><span>Play scale</span>';
  b.classList.toggle('primary', !scale.playing);
  $('#scalePill').hidden = !scale.playing;
  if (!scale.playing) { $$('#scaleStrip span').forEach((s) => s.classList.remove('on')); $('#scaleNote').textContent = '–'; $('#scaleCents').textContent = ''; $('#scalePillNote').textContent = scale.title(); }
  syncMetroLinks();
}
// The scale has its own tempo and its own click, in the same clock as the notes: always exactly together.
async function startScale() {
  unlock();
  scale.ref = S.ref;
  // the sound system must really be running (after the tuner's microphone iOS can leave it asleep)
  scale.playing = true; updateScaleButtons();
  await ensureRunning().catch(() => {});
  if (!scale.playing) return;            // stopped while it was waking
  scale.start(0);
  updateScaleButtons();
}
function stopScale() { scale.stop(); updateScaleButtons(); }
function restartScale() { scale.stop(true); startScale(); }
function showScaleBpm() { $('#scaleBpmVal').textContent = Math.round(scale.bpm); $('#scaleBpm').value = Math.round(scale.bpm); }
// a new tempo while the scale plays: it carries on from the next note at the new speed
let scaleTempoT = 0;
function setScaleBpm(v) {
  scale.bpm = clamp(Math.round(v), 30, 208); showScaleBpm(); persistScale();
  clearTimeout(scaleTempoT); if (scale.playing) scaleTempoT = setTimeout(restartScale, 350);
}
$('#scaleBpm').addEventListener('input', (e) => setScaleBpm(+e.target.value));
holdRepeat($('#scaleSlower'), () => setScaleBpm(scale.bpm - 1));
holdRepeat($('#scaleFaster'), () => setScaleBpm(scale.bpm + 1));
{ const tap = makeTapper((b) => setScaleBpm(b)); $('#scaleTap').addEventListener('click', tap); }
$('#scaleClick').addEventListener('change', (e) => { scale.click = e.target.checked; persistScale(); if (scale.playing) restartScale(); });
// the beats of each note, as dots: C ● ○ ○ ○
scale.onBeat = (ev) => {
  const box = $('#scaleBeats'); if (!box) return;
  const n = scale.perBeat < 1 ? Math.round(1 / scale.perBeat) : 4;
  if (box.childElementCount !== n) { box.textContent = ''; for (let i = 0; i < n; i++) box.append(el('i')); }
  [...box.children].forEach((d, i) => d.classList.toggle('on', i === ev.beat - 1));
};
$('#scaleToggle').addEventListener('click', () => (scale.playing ? stopScale() : startScale()));
$('#scalePillStop').addEventListener('click', stopScale);

// =====================================================================
// Recording (audio and video)
// =====================================================================
const recorder = new Recorder();
recorder.onGap = (gap) => toast(gap < 0 ? 'The microphone was lost and could not be opened again. Stop the recording: what was recorded so far is kept.' : 'The microphone changed (headphones or a call). The recording goes on.', 4500);
const vrec = new VideoRecorder();
const VW = { t: 0 };
let recState = null;
$('#countIn').addEventListener('change', (e) => { S.countIn = e.target.checked; saveSettings(); });
$('#clickWhileRec').addEventListener('change', (e) => { S.clickWhileRec = e.target.checked; saveSettings(); });
$$('#camSeg button').forEach((b) => b.addEventListener('click', () => { S.cam = b.dataset.cam; saveSettings(); $$('#camSeg button').forEach((x) => x.classList.toggle('on', x === b)); syncLink(); }));

// ---------- the iPhone as the camera ----------
const host = new CameraHost();
function syncLink() {
  const on = S.cam === 'iphone';
  $('#linkCard').hidden = !on;
  if (on && host.state === 'off') host.start();
  if (!on && host.state !== 'off' && !(recState && recState.iphone)) { host.stop(); hideRemotePreview(); }
  drawLink();
}
function drawLink() {
  const st = host.state, info = host.info || {};
  const linked = st === 'linked';
  const code = host.mode === 'code';
  $('#linkCard').classList.toggle('linked', linked);
  $('#linkFind').hidden = linked || code || !['opening', 'waiting'].includes(st);
  $('#linkCode').hidden = linked || !(code || (host.code && st === 'waiting'));
  $('#linkCode').textContent = st === 'waiting' && host.code ? host.code.replace(/(\d{3})(\d{3})/, '$1 $2') : st === 'opening' ? '···' : '—';
  $('#linkCode').classList.toggle('also', !code);
  $('#linkTitle').textContent = linked ? 'iPhone camera ready' : 'Use your iPhone as the camera';
  $('#linkHint').textContent = linked ? 'Record starts and stops it from here; the video comes to this iPad when you stop.'
    : st === 'offline' ? 'Could not reach the internet to find the iPhone. Check the connection and try again.'
      : st === 'lost' ? 'The iPhone went away. Open Camera for iPad on it again.'
        : code ? 'On your iPhone, open Stand, tap Camera for iPad, then Use a code, and type this code.'
          : host.code ? 'Open Stand on your iPhone and tap Camera for iPad. Keep the two near each other: they connect by themselves. If they do not, tap Use a code on the iPhone and type:' : 'Open Stand on your iPhone and tap Camera for iPad. Keep the two near each other: they connect by themselves.';
  $('#linkOn').hidden = !linked;
  if (linked) {
    $$('#linkFacing button').forEach((b) => b.classList.toggle('on', b.dataset.f === (info.facing || 'environment')));
    const shape = info.shape || 'portrait';
    $('#linkShape').classList.toggle('landscape', shape === 'landscape');
    $('#linkShape span').textContent = (shape === 'landscape' ? 'Horizontal' : 'Vertical') + ' — follows how the iPhone is held';
    if (document.activeElement !== $('#linkBright')) $('#linkBright').value = info.bright || 0;
    if (document.activeElement !== $('#linkWarm')) $('#linkWarm').value = info.warm || 0;
    if (document.activeElement !== $('#linkZoom')) $('#linkZoom').value = info.zoom || 1;
    $('#linkZoomVal').textContent = (+(info.zoom || 1)).toFixed(1).replace('.0', '') + '×';
    $$('#linkQuality button').forEach((b) => b.classList.toggle('on', b.dataset.q === (info.quality || 'fhd')));
    $$('#linkFps button').forEach((b) => b.classList.toggle('on', +b.dataset.r === (info.fps || 30)));
    $('#linkLightRow').hidden = !info.canLight; $('#linkLight').checked = !!info.light;
    const busy = !!info.recording;
    $$('#linkQuality button, #linkFps button, #linkFacing button').forEach((b) => { b.disabled = busy; });
  }
  $('#linkRetry').textContent = code ? 'Find automatically' : st === 'offline' || st === 'lost' ? 'Try again' : 'Use a code';
  $('#linkOff').hidden = st === 'off';
  syncRemoteShape();
}
host.onState = (st) => { if (st === 'linked' && S.shareIphone !== false && !PHONE) setTimeout(async () => { try { host.sendPractice(await practiceForPhone()); } catch {} }, 600); drawLink(); if (st === 'linked' && openPanel === 'record') showRemotePreview(); if (st === 'lost' || st === 'off') { if (!(recState && recState.iphone)) hideRemotePreview(); } if (st === 'lost' && S.cam === 'iphone') setTimeout(() => { if (host.state === 'lost' && S.cam === 'iphone') host.start(); }, 1500); };
host.onInfo = () => drawLink();
host.onStream = () => { if (openPanel === 'record' || (recState && recState.iphone)) showRemotePreview(); };
$$('#linkFacing button').forEach((b) => b.addEventListener('click', () => { host.set({ facing: b.dataset.f }); drawLink(); }));
$$('#linkQuality button').forEach((b) => b.addEventListener('click', () => { host.set({ quality: b.dataset.q }); drawLink(); }));
$$('#linkFps button').forEach((b) => b.addEventListener('click', () => { host.set({ fps: +b.dataset.r }); drawLink(); }));
for (const [id, key] of [['#linkBright', 'bright'], ['#linkWarm', 'warm'], ['#linkZoom', 'zoom']]) {
  $(id).addEventListener('input', (e) => { host.set({ [key]: +e.target.value }); if (key === 'zoom') $('#linkZoomVal').textContent = (+e.target.value).toFixed(1).replace('.0', '') + '×'; });
}
$('#linkLight').addEventListener('change', (e) => host.set({ light: e.target.checked }));
$('#linkReset').addEventListener('click', () => { host.set({ bright: 0, warm: 0, zoom: 1, light: false }); drawLink(); });
$('#linkRetry').addEventListener('click', () => host.start({ code: host.mode !== 'code' && !['offline', 'lost'].includes(host.state) }));
$('#linkOff').addEventListener('click', () => { host.stop(); hideRemotePreview(); drawLink(); });
function syncRemoteShape() {
  const cam = $('#cam'); if (!cam.classList.contains('remote')) return;
  const v = $('#camVideo');
  const portrait = v.videoWidth ? v.videoHeight > v.videoWidth : (host.info || {}).shape === 'portrait';
  cam.classList.toggle('portrait', portrait);
}
$('#camVideo').addEventListener('resize', syncRemoteShape);
function showRemotePreview() {
  if (!host.stream) return;
  const cam = $('#cam'); cam.hidden = false; cam.classList.add('remote'); cam.classList.toggle('mirror', (host.info || {}).facing === 'user');
  const v = $('#camVideo'); if (v.srcObject !== host.stream) { v.srcObject = host.stream; v.play().catch(() => {}); }
  if (!cam.querySelector('.cam-src')) cam.append(el('span', 'cam-src', 'iPhone'));
  syncRemoteShape();
}
function hideRemotePreview() {
  const cam = $('#cam'); if (!cam.classList.contains('remote')) return;
  cam.classList.remove('remote', 'portrait'); cam.hidden = true; $('#camVideo').srcObject = null;
  const t = cam.querySelector('.cam-src'); if (t) t.remove();
}
async function startIphoneVideo() {
  if (host.state !== 'linked') { showPanel('record'); toast('Open Camera for iPad on your iPhone first. It connects by itself on the same Wi-Fi.', 5000); return; }
  showRemotePreview();
  const ctx = getCtx();
  const ci = setupCountIn();
  recState = { kind: 'video', iphone: true, ...ci, page: V.score ? V.page : 0, scoreId: V.score ? V.score.id : null, t0: performance.now() };
  const wait = Math.max(0, (ci.startAt - ctx.currentTime) * 1000);
  recState.startTimer = setTimeout(() => { if (recState && recState.iphone) host.record(); }, wait);
  $('#recPill').hidden = false; $('#recBtn').classList.add('live'); $('#recBtnLabel').textContent = 'Stop';
  $('#recNote').textContent = 'Recording on iPhone';
  const meter = $('#recMeter'), mg = meter.getContext('2d');
  // colours read once: reading styles on every frame costs time the camera needs
  const MC = { s: css('--sunk-2'), r: css('--rec'), w: css('--warn'), g: css('--good') };
  let lastTxt = '';
  const loop = () => {
    if (!recState) return;
    const t = ctx.currentTime - recState.startAt;
    const txt = t < 0 ? '–' + Math.ceil(-t) : fmtTime(t);
    if (txt !== lastTxt) { lastTxt = txt; $('#recTime').textContent = txt; $('#camTime').textContent = txt; }
    mg.clearRect(0, 0, meter.width, meter.height);
    recState.raf = requestAnimationFrame(loop);
  };
  loop();
}
// a video the iPhone sent again after a failed try (the iPad had stopped waiting): kept too
host.onLateFile = async (r) => {
  try {
    if (!r || !r.blob || r.blob.size < 2000) return;
    const blob = r.blob, audio = await decodeVideoAudio(blob), thumb = await videoThumb(blob);
    const take = { id: uid(), kind: 'video', mime: blob.type, scoreId: V.score ? V.score.id : undefined, page: V.page || 0, name: 'iPhone video', created: Date.now(), mirror: !!r.mirror, thumb, fav: false, source: 'iPhone' };
    await db.put('files', { id: 'video:' + take.id, data: blob });
    if (audio && audio.data.length > audio.sr * 0.3) { take.sr = audio.sr; take.dur = audio.data.length / audio.sr; take.peaks = computePeaks(audio.data); take.peak = peakOf(audio.data); take.pcm = true; await db.put('files', { id: 'audio:' + take.id, data: audio.data }); }
    else take.pcm = false;
    await db.put('takes', take);
    toast('The video from the iPhone arrived. It is in Recordings.', 4000);
    if (openPanel === 'takes') refreshTakes();
  } catch {}
};
async function finishIphoneVideo(st, name) {
  toast('Getting the video from the iPhone…', 900000);
  host.onProgress = (f) => { $('#toast').textContent = `Getting the video from the iPhone… ${Math.round(f * 100)}%`; };
  const r = await host.stopRecording();
  host.onProgress = null;
  hideRemotePreview();
  if (!r || r.error || !r.blob || r.blob.size < 2000) { toast(r && r.error === 'timeout' ? 'The iPhone did not send the video.' : 'The video could not be brought over from the iPhone.', 5000); return null; }
  $('#toast').textContent = 'Saving the video…';
  const blob = r.blob;
  const audio = await decodeVideoAudio(blob);
  const thumb = await videoThumb(blob);
  const take = { id: uid(), kind: 'video', mime: blob.type, scoreId: st.scoreId, page: st.page, name, created: Date.now(), mirror: !!r.mirror, thumb, fav: false, source: 'iPhone' };
  await db.put('files', { id: 'video:' + take.id, data: blob });
  if (audio && audio.data.length > audio.sr * 0.3) {
    take.sr = audio.sr; take.dur = audio.data.length / audio.sr; take.peaks = computePeaks(audio.data); take.peak = peakOf(audio.data); take.pcm = true;
    await db.put('files', { id: 'audio:' + take.id, data: audio.data });
  } else { take.pcm = false; take.dur = (performance.now() - st.t0) / 1000; }
  $('#toast').hidden = true;
  return take;
}
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

// ---------- native video (iPad app): the camera is recorded by iOS itself ----------
const canNativeVideo = () => !!(NATIVE && NATIVE.standVideo && (window.standCaps || {}).video);
const NV = { wait: null };
function nvWait(types, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { NV.wait = null; resolve({ type: 'timeout' }); }, ms);
    NV.wait = { types, done: (ev) => { clearTimeout(t); NV.wait = null; resolve(ev); } };
  });
}
window.standVideoEvent = (ev) => {
  if (ev.type === 'level') { if (recState && recState.native) recState.nLevel = Math.pow(10, (ev.db || -80) / 20); return; }
  if (ev.type === 'saving') { NV.savingSince = performance.now(); return; }
  if (NV.wait && NV.wait.types.includes(ev.type)) { NV.wait.done(ev); return; }
  // iOS ended the recording by itself (another app took the camera, a call, the app went to
  // the background): keep what was recorded.
  if (ev.type === 'done' && ev.video) { NV.early = ev; if (recState && recState.native) stopRecording(); else if (!NV.saving) saveOrphanVideo(ev); return; }
  if (ev.type === 'error' && recState && recState.native) { toast('The recording stopped: ' + (ev.message || 'camera error'), 5000); stopRecording(); }
};
async function saveOrphanVideo(ev) {
  NV.early = null;
  const name = 'Video ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const take = await finishNativeVideo({ scoreId: V.score ? V.score.id : null, page: V.page || 0, t0: performance.now() }, name, ev);
  if (take) { await db.put('takes', take); toast('The video was saved in Recordings.', 3500); }
}
async function startNativeVideo() {
  const ready = nvWait(['ready', 'error'], 10000);
  NATIVE.standVideo.postMessage({ cmd: 'open', front: S.cam === 'user' });
  const ev = await ready;
  if (ev.type !== 'ready') {
    NATIVE.standVideo.postMessage({ cmd: 'close' });
    toast(ev.reason === 'permission' ? 'Camera or microphone access is off. Turn them on in Settings › Stand.' : 'The camera could not start. Close other apps using the camera and try again.', 6000);
    sendFace();
    return;
  }
  const ctx = getCtx();
  const ci = setupCountIn();
  recState = { kind: 'video', native: true, ...ci, page: V.score ? V.page : 0, scoreId: V.score ? V.score.id : null, nLevel: 0, t0: performance.now() };
  const wait = Math.max(0, (ci.startAt - ctx.currentTime) * 1000);
  recState.startTimer = setTimeout(() => { if (recState && recState.native) { NATIVE.standVideo.postMessage({ cmd: 'record' }); recState.t0 = performance.now(); } }, wait);
  $('#recPill').hidden = false; $('#recBtn').classList.add('live'); $('#recBtnLabel').textContent = 'Stop';
  let level = 0;
  recState.readLevel = () => { level = Math.max(recState.nLevel || 0, level * 0.92); return level; };
  const meter = $('#recMeter'), mg = meter.getContext('2d');
  // colours read once: reading styles on every frame costs time the camera needs
  const MC = { s: css('--sunk-2'), r: css('--rec'), w: css('--warn'), g: css('--good') };
  let lastTxt = '';
  const loop = () => {
    if (!recState) return;
    recState.readLevel();
    const t = ctx.currentTime - recState.startAt;
    const txt = t < 0 ? '–' + Math.ceil(-t) : fmtTime(t);
    if (txt !== lastTxt) { lastTxt = txt; $('#recTime').textContent = txt; }
    const W = meter.width, Hm = meter.height;
    mg.clearRect(0, 0, W, Hm); mg.fillStyle = MC.s; mg.fillRect(0, 0, W, Hm);
    const dbv = 20 * Math.log10(level + 1e-6); const x = clamp((dbv + 60) / 60, 0, 1) * W;
    mg.fillStyle = level > 0.95 ? MC.r : level > 0.6 ? MC.w : MC.g;
    mg.fillRect(0, 0, x, Hm);
    recState.raf = requestAnimationFrame(loop);
  };
  loop();
}
async function finishNativeVideo(st, name, given) {
  NV.saving = true;
  let ev = given || NV.early;
  NV.early = null;
  if (!ev) {
    const doneP = nvWait(['done', 'error'], 600000);
    NATIVE.standVideo.postMessage({ cmd: 'stop' });
    toast('Saving the video…', 600000);
    ev = await doneP;
  } else toast('Saving the video…', 600000);
  NV.saving = false;
  sendFace();
  if (ev.type !== 'done' || !ev.video) { toast(ev.type === 'error' ? 'The video could not be saved.' : 'That was too short to keep.'); return null; }
  try {
    const res = await fetch(ev.video); if (!res.ok) throw new Error('missing video');
    const blob = new Blob([await res.blob()], { type: 'video/quicktime' });
    let audio = null;
    if (ev.audio) { const ar = await fetch(ev.audio); if (ar.ok) audio = await decodeVideoAudio(await ar.blob()); }
    if (!audio) audio = await decodeVideoAudio(blob);
    for (const p of [ev.video, ev.audio]) if (p) NATIVE.standDone.postMessage({ path: p });
    if (blob.size < 2000) { toast('That was too short to keep.'); return null; }
    const thumb = await videoThumb(blob);
    const take = { id: uid(), kind: 'video', mime: blob.type, scoreId: st.scoreId, page: st.page, name, created: Date.now(), mirror: !!ev.mirror, thumb, fav: false };
    await db.put('files', { id: 'video:' + take.id, data: blob });
    if (audio && audio.data.length > audio.sr * 0.3) {
      take.sr = audio.sr; take.dur = audio.data.length / audio.sr; take.peaks = computePeaks(audio.data); take.peak = peakOf(audio.data); take.pcm = true;
      await db.put('files', { id: 'audio:' + take.id, data: audio.data });
    } else { take.pcm = false; take.dur = (performance.now() - st.t0) / 1000; }
    $('#toast').hidden = true;
    return take;
  } catch (e) { console.error(e); toast('The video could not be saved.'); return null; }
}

async function startRecording(kind) {
  if (recState) { hidePanel(); stopRecording(); return; }   // already recording: the second tap stops
  if (NV.wait || NV.saving) return;            // the camera is opening or a video is being saved
  unlock(); hidePanel();
  if (player.playing) player.pause();
  if (scale.playing) { scale.stop(); updateScaleButtons(); }
  if (tuner.running) stopTuner();
  S.lastRecKind = kind; saveSettings();
  if (kind === 'video' && S.cam === 'iphone' && !PHONE) return startIphoneVideo();
  const landscape = devShape() === 'landscape';
  if (kind === 'video' && canNativeVideo() && !PHONE && !(landscape && window.MediaRecorder && navigator.mediaDevices)) { recState = { kind: 'video', native: true, opening: true }; sendFace(); recState = null; return startNativeVideo(); }
  if (kind === 'video') { recState = { kind: 'video', opening: true }; sendFace(); recState = null; }
  const ctx = getCtx();
  let meterSrc = null;
  if (kind === 'video') {
    try { await vrec.open(S.cam, undefined, { canvas: PHONE }); } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Camera access is off. Turn it on in Settings › Stand › Camera (or Settings › Safari › Camera).' : 'The camera could not start (' + ((e && (e.name || e.message)) || 'unknown') + '). Close other apps using the camera and try again.', 6000); return; }
    const cam = $('#cam'); cam.hidden = false; cam.classList.toggle('mirror', S.cam === 'user'); cam.classList.toggle('portrait', vrec.shape === 'portrait');
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
      try { vrec.start(); } catch (e) { console.error(e); toast('Video could not start: ' + (e.message || e.name), 6000); stopRecording(); return; }
      // from now on the device keeps the way it is held, so the video keeps its shape
      try { if (NATIVE && NATIVE.standOrientation) NATIVE.standOrientation.postMessage({ lock: vrec.shape === 'landscape' ? 'landscape' : 'portrait' }); } catch {}
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
  // colours read once: reading styles on every frame costs time the camera needs
  const MC = { s: css('--sunk-2'), r: css('--rec'), w: css('--warn'), g: css('--good') };
  let lastTxt = '';
  const loop = () => {
    if (!recState) return;
    if (recState.readLevel) recState.readLevel();
    const t = ctx.currentTime - recState.startAt;
    const txt = t < 0 ? '–' + Math.ceil(-t) : fmtTime(t);
    if (txt !== lastTxt) { lastTxt = txt; $('#recTime').textContent = txt; $('#camTime').textContent = txt; }
    const W = meter.width, Hm = meter.height;
    mg.clearRect(0, 0, W, Hm); mg.fillStyle = MC.s; mg.fillRect(0, 0, W, Hm);
    const dbv = 20 * Math.log10(level + 1e-6); const x = clamp((dbv + 60) / 60, 0, 1) * W;
    mg.fillStyle = level > 0.95 ? MC.r : level > 0.6 ? MC.w : MC.g;
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
  if (st.iphone) {
    take = await finishIphoneVideo(st, name);
    if (!take) return;
  } else if (st.native) {
    take = await finishNativeVideo(st, name);
    if (!take) return;
  } else if (st.kind === 'video') {
    const blob = vrec.recording ? await vrec.stop() : null;
    try { st.meterSrc && st.meterSrc.disconnect(); } catch {}
    vrec.close(); $('#cam').hidden = true; $('#cam').classList.remove('portrait'); $('#camVideo').srcObject = null;
    try { if (NATIVE && NATIVE.standOrientation) NATIVE.standOrientation.postMessage({ lock: S.landscapeLock ? 'landscape' : 'auto' }); } catch {}
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

// a video from Photos or Files: becomes a recording, ready for Studio
$('#takeImport').addEventListener('click', () => $('#takeImportFile').click());
$('#takeImportFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  toast('Bringing in the video…', 60000);
  try {
    const blob = f.slice(0, f.size, f.type || 'video/mp4');
    const audio = await decodeVideoAudio(blob);
    const thumb = await videoThumb(blob);
    const take = { id: uid(), kind: 'video', mime: blob.type || 'video/mp4', scoreId: null, page: 0, name: f.name.replace(/\.[^.]+$/, '') || 'Video', created: Date.now(), mirror: false, thumb, fav: false, source: 'Imported' };
    await db.put('files', { id: 'video:' + take.id, data: blob });
    if (audio && audio.data.length > audio.sr * 0.3) {
      take.sr = audio.sr; take.dur = audio.data.length / audio.sr; take.peaks = computePeaks(audio.data); take.peak = peakOf(audio.data); take.pcm = true;
      await db.put('files', { id: 'audio:' + take.id, data: audio.data });
    } else {
      take.pcm = false;
      take.dur = await new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(v.duration || 0); v.onerror = () => res(0); v.src = URL.createObjectURL(blob); });
    }
    await db.put('takes', take);
    $('#toast').hidden = true;
    takesScope = 'all'; $$('#takesScope button').forEach((b) => b.classList.toggle('on', b.dataset.scope === 'all'));
    await refreshTakes(); await selectTake(take.id);
    toast('Imported. Tap Studio to put the score on it.', 3000);
  } catch (err) { console.error(err); toast('That video could not be read.', 3000); }
});

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
  // the phone turned: the camera stays on the screen, and before recording starts the video
  // takes the new shape (portrait or landscape)
  const keep = () => {
    if (cam.hidden) return;
    if (recState && recState.kind === 'video' && !recState.iphone && !recState.native && !vrec.recording) {
      const shape = devShape();
      if (vrec.setShape(shape)) cam.classList.toggle('portrait', shape === 'portrait');
      else if (vrec.direct && vrec.shape !== shape && !keep.busy) {
        // the camera's own picture (iPad): opened again in the new shape before recording starts
        keep.busy = true;
        vrec.open(S.cam, shape).then((stream) => {
          $('#camVideo').srcObject = stream; $('#camVideo').play().catch(() => {});
          cam.classList.toggle('portrait', vrec.shape === 'portrait');
          try { if (recState && recState.meterSrc) { recState.meterSrc.disconnect(); recState.meterSrc = getCtx().createMediaStreamSource(stream); if (recState.analyser) recState.meterSrc.connect(recState.analyser); } } catch {}
        }).catch(() => {}).finally(() => { keep.busy = false; });
      }
    }
    if (cam.style.left) {
      const r = cam.getBoundingClientRect();
      cam.style.left = clamp(r.left, 8, Math.max(8, innerWidth - r.width - 8)) + 'px';
      cam.style.top = clamp(r.top, 8, Math.max(8, innerHeight - r.height - 8)) + 'px';
    }
  };
  window.addEventListener('resize', () => requestAnimationFrame(keep));
  window.addEventListener('orientationchange', () => { setTimeout(keep, 350); setTimeout(keep, 900); });
  try { screen.orientation && screen.orientation.addEventListener('change', () => setTimeout(keep, 120)); } catch {}
})();

// =====================================================================
// Recordings & player
// =====================================================================
const player = new Player();
let takesScope = 'score', currentTake = null, videoURL = null, nativeVideo = false;
// This score / All also bring you back from a recording to the list
$$('#takesScope button').forEach((b) => b.addEventListener('click', () => { takesScope = b.dataset.scope; if (!$('#player').hidden) backToTakeList(); else refreshTakes(); }));
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
    // a video that will not load is tried once more (a fresh link to the file), then said so
    let tried = false;
    video.onerror = () => {
      if (currentTake !== t && currentTake) return;
      if (!tried) { tried = true; if (videoURL) URL.revokeObjectURL(videoURL); videoURL = URL.createObjectURL(vf.data); video.src = videoURL; video.load(); return; }
      toast('This video could not be played on this iPad. Try Share to open it in Photos.', 4500);
    };
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
  $('#panel-takes').classList.add('viewing');
  const pb = $('#panel-takes .panel-body'); if (pb) pb.scrollTop = 0;
  $('#waveWrap').hidden = nativeVideo; $('.times').hidden = nativeVideo; $('.transport').hidden = nativeVideo;
  $('#exportLabel').textContent = t.kind === 'video' ? 'Share video' : 'Export as heard';
  $('#takeFloat').hidden = t.kind !== 'video' || nativeVideo;
  if (VF.on && t.kind !== 'video') closeVideoFloat(false);
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
// ---------- cutting a recording ----------
function syncCut() {
  const ok = !!currentTake && player.loop && player.b - player.a > 0.2 && !nativeVideo && !cutting;
  $('#cutKeep').disabled = !ok; $('#cutRemove').disabled = !ok;
  $('#cutRange').textContent = player.loop && player.b > player.a
    ? `${fmtTime(player.a, true)} – ${fmtTime(player.b, true)} · ${(player.b - player.a).toFixed(1)} s`
    : 'Select a part of the waveform';
}
let cutting = false;
async function cutTake(mode) {
  const t = currentTake;
  if (!t || cutting || !(player.b > player.a)) return;
  const a = player.a, b = player.b, dur = player.duration;
  const segs = segmentsFor(dur, a, b, mode);
  if (!segs.length || segmentsLength(segs) < 0.2) { toast('Nothing left to keep.'); return; }
  cutting = true; syncCut();
  const prog = $('#cutProgress'); prog.hidden = false; prog.querySelector('i').style.width = '0%';
  const setPct = (f) => { prog.querySelector('i').style.width = Math.round(f * 100) + '%'; $('#cutPct').textContent = Math.round(f * 100) + '%'; };
  try {
    const pcm = cutPcm(t.data, t.sr, a, b, mode);
    const id = uid();
    let take = { id, kind: t.kind, scoreId: t.scoreId, page: t.page, name: t.name + (mode === 'keep' ? ' · selection' : ' · cut'), created: Date.now(), sr: t.sr, dur: pcm.length / t.sr, peaks: computePeaks(pcm), peak: peakOf(pcm), fav: false };
    if (t.kind === 'video') {
      const blob = await renderVideoCut({ url: videoURL, mirror: !!t.mirror, segs, pcm, sr: t.sr, onProgress: setPct });
      take = { ...take, mime: blob.type, mirror: false, pcm: true, thumb: await videoThumb(blob) };
      await db.put('files', { id: 'video:' + id, data: blob });
    } else setPct(1);
    await db.put('files', { id: 'audio:' + id, data: pcm });
    await db.put('takes', take);
    takesScope = take.scoreId ? 'score' : 'all';
    toast('Saved as a new recording.', 3000);
    refreshTakes();
  } catch (err) {
    toast('That recording could not be cut.', 3500);
  } finally {
    cutting = false; prog.hidden = true; syncCut();
  }
}
$('#cutKeep').addEventListener('click', () => cutTake('keep'));
$('#cutRemove').addEventListener('click', () => cutTake('remove'));

player.onState = () => {
  syncCut();
  const p = $('#playBtn'); p.innerHTML = player.playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>';
  p.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  $('#loopBtn').classList.toggle('on', player.loop);
  $('#tLoop').textContent = player.loop && player.b > player.a ? `Looping ${fmtTime(player.a, true)} – ${fmtTime(player.b, true)}` : 'Drag across the waveform to loop a passage';
  $('#tDur').textContent = fmtTime(player.duration, true);
  if (player.playing) animateWave(); else drawWave();
  if (VF.on) vfSync();
};
player.onBusy = (on) => { $('#waveBusy').hidden = !on; };
$('#playBtn').addEventListener('click', () => { unlock(); player.playing ? player.pause() : player.play(); });
// ---------- the video over the score ----------
// Drag a video out of Recordings (or tap its button) and it floats small over the score, as while
// recording: drag it anywhere, pull its corner to resize, pinch (or double-tap) to zoom into the
// picture and drag to look around in it. The controls hide while you play.
const VF = { on: false, z: 1, x: 0, y: 0, quietT: 0 };
const vfEl = $('#vfloat');
function vfApply() {
  const v = $('#takeVideo'), st = $('#vfStage');
  const W = st.clientWidth, H = st.clientHeight;
  VF.z = clamp(VF.z, 1, 5);
  // keep the picture covering the window
  VF.x = clamp(VF.x, W - W * VF.z, 0); VF.y = clamp(VF.y, H - H * VF.z, 0);
  const mirror = $('#videoWrap').classList.contains('mirror');
  v.style.transform = `translate(${VF.x}px, ${VF.y}px) scale(${VF.z})` + (mirror ? ` translateX(${W}px) scaleX(-1)` : '');
  $('#vfZoom').hidden = VF.z < 1.05; $('#vfZoom').textContent = VF.z.toFixed(1) + '×';
}
function vfSync() {
  const p = $('#vfPlay'); p.innerHTML = player.playing ? '<svg><use href="#i-pause"/></svg>' : '<svg><use href="#i-play"/></svg>';
  p.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
  $('#vfSpeed').textContent = Math.round(player.rate * 100) + '%';
  vfEl.classList.remove('quiet'); clearTimeout(VF.quietT);
  if (player.playing) VF.quietT = setTimeout(() => vfEl.classList.add('quiet'), 2500);
}
function openVideoFloat(at) {
  if (!currentTake || currentTake.kind !== 'video') return;
  const wrap = $('#videoWrap');
  $('#vfStage').append(wrap);
  VF.on = true; VF.z = 1; VF.x = 0; VF.y = 0;
  vfEl.hidden = false;
  if (at) {
    const r = vfEl.getBoundingClientRect();
    vfEl.style.left = clamp(at[0] - r.width / 2, 8, innerWidth - r.width - 8) + 'px';
    vfEl.style.top = clamp(at[1] - r.height / 2, 8, innerHeight - r.height - 8) + 'px'; vfEl.style.bottom = 'auto';
  }
  hidePanel();
  requestAnimationFrame(vfApply); vfSync();
}
function closeVideoFloat(back) {
  if (!VF.on) return;
  VF.on = false; vfEl.hidden = true;
  const wrap = $('#videoWrap'), v = $('#takeVideo');
  v.style.transform = '';
  $('#player').insertBefore(wrap, $('#waveWrap'));
  vfEl.classList.remove('big');
  if (back) showPanel('takes'); else player.pause();
}
$('#takeFloat').addEventListener('click', () => openVideoFloat());
// back from a recording to all the recordings (what is playing over the score keeps playing)
function backToTakeList() {
  if (!VF.on) { player.stop(); try { $('#takeVideo').pause(); } catch {} }
  $('#player').hidden = true; $('#panel-takes').classList.remove('viewing');
  if (!VF.on) currentTake = null;
  refreshTakes();
}
$('#vfBig').addEventListener('click', (e) => {
  e.stopPropagation();
  const big = vfEl.classList.toggle('big');
  if (big) { vfEl.dataset.w = vfEl.style.width || ''; vfEl.style.width = ''; } else vfEl.style.width = vfEl.dataset.w || '';
  // stays on the screen
  requestAnimationFrame(() => { const r = vfEl.getBoundingClientRect(); vfEl.style.left = clamp(r.left, 4, Math.max(4, innerWidth - r.width - 4)) + 'px'; vfEl.style.top = clamp(r.top, 4, Math.max(4, innerHeight - r.height - 4)) + 'px'; vfEl.style.bottom = 'auto'; vfApply(); });
});
$('#vfPlay').addEventListener('click', (e) => { e.stopPropagation(); unlock(); player.playing ? player.pause() : player.play(); setTimeout(vfSync, 50); });
$('#vfSpeed').addEventListener('click', (e) => { e.stopPropagation(); const steps = [1, 0.9, 0.75, 0.6, 0.5]; const i = steps.findIndex((s) => Math.abs(s - player.rate) < 0.01); setSpeed(steps[(i + 1) % steps.length]); vfSync(); });
$('#vfBack').addEventListener('click', (e) => { e.stopPropagation(); closeVideoFloat(true); });
$('#vfClose').addEventListener('click', (e) => { e.stopPropagation(); closeVideoFloat(false); });
for (const b of vfEl.querySelectorAll('.vf-btn')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
{
  // gestures on the window: one finger moves it (or looks around a zoomed picture), two pinch
  const pts = new Map(); let g = null, lastTap = 0;
  const st = $('#vfStage');
  st.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { st.setPointerCapture(e.pointerId); } catch {}
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    vfEl.classList.remove('quiet'); clearTimeout(VF.quietT);
    const r = vfEl.getBoundingClientRect();
    if (pts.size === 1) g = { kind: 'one', x0: e.clientX, y0: e.clientY, left: r.left, top: r.top, px: VF.x, py: VF.y, moved: false, t0: performance.now() };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()], sr = st.getBoundingClientRect();
      g = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: VF.z, x0: VF.x, y0: VF.y, cx: (a[0] + b[0]) / 2 - sr.left, cy: (a[1] + b[1]) / 2 - sr.top };
    }
  });
  st.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (g.kind === 'one') {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (VF.z > 1.02) { VF.x = g.px + dx; VF.y = g.py + dy; vfApply(); }
      else {
        const r = vfEl.getBoundingClientRect();
        vfEl.style.left = clamp(g.left + dx, 4, innerWidth - r.width - 4) + 'px';
        vfEl.style.top = clamp(g.top + dy, 4, innerHeight - r.height - 4) + 'px'; vfEl.style.bottom = 'auto';
      }
    } else if (g.kind === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const z = clamp(g.z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / g.d0, 1, 5);
      // zoom about the point between the fingers
      VF.x = g.cx - (g.cx - g.x0) * (z / g.z0); VF.y = g.cy - (g.cy - g.y0) * (z / g.z0); VF.z = z; vfApply();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (g && g.kind === 'one' && !g.moved && performance.now() - g.t0 < 300) {
      const now = performance.now();
      // double tap: zoom in to 2× where you tapped, or back to the whole picture
      if (now - lastTap < 320) {
        const sr = st.getBoundingClientRect(), cx = g.x0 - sr.left, cy = g.y0 - sr.top;
        if (VF.z > 1.05) { VF.z = 1; VF.x = 0; VF.y = 0; } else { VF.z = 2; VF.x = cx - (cx - VF.x) * 2; VF.y = cy - (cy - VF.y) * 2; }
        vfApply(); lastTap = 0;
      } else { lastTap = now; if (player.playing) { vfEl.classList.toggle('quiet'); clearTimeout(VF.quietT); } }
    }
    if (!pts.size) g = null; else if (pts.size === 1) { const [p] = [...pts.values()]; const r = vfEl.getBoundingClientRect(); g = { kind: 'one', x0: p[0], y0: p[1], left: r.left, top: r.top, px: VF.x, py: VF.y, moved: true, t0: 0 }; }
  };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  // the corner: bigger or smaller (the bottom-left corner stays where it is)
  const rz = $('#vfResize'); let rs = null;
  rz.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { rz.setPointerCapture(e.pointerId); } catch {} const r = vfEl.getBoundingClientRect(); rs = { x0: e.clientX, w0: r.width, left: r.left, bottom: r.bottom }; });
  rz.addEventListener('pointermove', (e) => {
    if (!rs) return;
    const w = clamp(rs.w0 + (e.clientX - rs.x0), 200, Math.min(innerWidth - 16, 900));
    vfEl.style.width = w + 'px';
    const h = vfEl.getBoundingClientRect().height;
    vfEl.style.top = clamp(rs.bottom - h, 4, innerHeight - h - 4) + 'px'; vfEl.style.bottom = 'auto';
    vfApply();
  });
  const rup = () => { rs = null; }; rz.addEventListener('pointerup', rup); rz.addEventListener('pointercancel', rup);
  // keep it on the screen when the iPad turns
  window.addEventListener('resize', () => { if (!VF.on) return; const r = vfEl.getBoundingClientRect(); if (vfEl.style.left) vfEl.style.left = clamp(r.left, 4, Math.max(4, innerWidth - r.width - 4)) + 'px'; if (vfEl.style.top) vfEl.style.top = clamp(r.top, 4, Math.max(4, innerHeight - r.height - 4)) + 'px'; vfApply(); });
}
// drag the video out of Recordings onto the score
{
  const wrap = $('#videoWrap'); let d = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (VF.on || !currentTake || currentTake.kind !== 'video' || nativeVideo) return;
    d = { x0: e.clientX, y0: e.clientY, id: e.pointerId, lift: null, t0: performance.now() };
  });
  window.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.lift && dist > 18) {
      // lifted: a picture of the video follows the finger
      const r = wrap.getBoundingClientRect();
      const lift = el('div', 'vf-lift'); lift.style.width = Math.min(260, r.width) + 'px'; lift.style.height = Math.min(260, r.width) * (r.height / r.width) + 'px';
      const c = document.createElement('canvas'); c.width = 260; c.height = Math.round(260 * r.height / r.width); c.style.width = '100%'; c.style.height = '100%';
      try { c.getContext('2d').drawImage($('#takeVideo'), 0, 0, c.width, c.height); } catch {}
      lift.append(c); document.body.append(lift); d.lift = lift;
    }
    if (d.lift) { const lw = d.lift.offsetWidth, lh = d.lift.offsetHeight; d.lift.style.left = (e.clientX - lw / 2) + 'px'; d.lift.style.top = (e.clientY - lh / 2) + 'px'; }
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const lift = d.lift; d = null;
    if (!lift) return;
    lift.remove();
    // dropped outside the panel (on the score): it stays there, small
    const pr = $('#panel-takes').getBoundingClientRect();
    const outside = e.clientX < pr.left || e.clientX > pr.right || e.clientY < pr.top || e.clientY > pr.bottom;
    if (outside) openVideoFloat([e.clientX, e.clientY]);
  };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}

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
  player.stop(); const video = $('#takeVideo'); try { video.pause(); } catch {}
  $('#delConfirm').hidden = true;
  if (VF.on) closeVideoFloat(false);
  await deleteTakeData(currentTake.id);
  // back to the list (it was hidden while the recording was open: the other recordings stay reachable)
  if (videoURL) { URL.revokeObjectURL(videoURL); videoURL = null; }
  video.removeAttribute('src'); try { video.load(); } catch {}
  currentTake = null; $('#player').hidden = true; $('#panel-takes').classList.remove('viewing'); refreshTakes(); toast('Recording deleted');
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
      await shareBlob(vf.data, safe + (vf.data.type.includes('webm') ? '.webm' : vf.data.type.includes('quicktime') ? '.mov' : '.mp4'));
    } else {
      toast('Preparing the file…', 10000);
      const blob = await player.exportWav();
      await shareBlob(blob, safe + (player.rate !== 1 ? ` (${Math.round(player.rate * 100)}%)` : '') + '.wav');
    }
  } catch (e) { console.error(e); toast('The export failed. Try a shorter loop.'); }
  btn.disabled = false;
}
$('#exportBtn').addEventListener('click', exportTake);
$('#studioBtn').addEventListener('click', () => {
  if (!currentTake) return;
  player.stop(); $('#takeVideo').pause(); hidePanel();
  openStudio(currentTake.id);
  setTimeout(() => { if (!$('#studio').hidden) sectionTour('studio', { force: true }); }, 900);
});
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
// A new notebook: a cover (style, colour, title) and engraved paper, chosen with a large preview.
const NB = { tpl: 'treble', style: 'photo', photo: 'r2', cat: 'records', dir: 'down', color: '#1d2f6f', staff: 3, bars: 0, paper: 'white', built: false };
function paperThumb(k) {
  const c = el('canvas'); c.width = 240; c.height = 170;
  const full = document.createElement('canvas'); full.width = 240; full.height = Math.round(240 * 842 / 595);
  drawNotebookPage(full.getContext('2d'), { template: k, title: '', opts: { header: false, numbers: false } }, 1, full.width, full.height);
  c.getContext('2d').drawImage(full, 0, 10, 240, 170, 0, 0, 240, 170);
  return c;
}
function fillPaperChoices(box, onPick) {
  box.textContent = '';
  for (const [title, keys] of PAPER_GROUPS) {
    box.append(el('div', 'paper-group', title));
    for (const k of keys) {
      const t = PAPER_TYPES[k]; if (!t) continue;
      const b = el('button'); b.dataset.v = k; b.append(paperThumb(k), document.createTextNode(t.label));
      b.addEventListener('click', () => onPick(k, b));
      box.append(b);
    }
  }
}
function nbFile(pages = 1) {
  return { kind: 'paper', template: NB.tpl, pages, title: $('#nbTitle').value.trim() || 'Notebook', cover: $('#nbHasCover').checked ? { style: NB.style, photo: NB.style === 'photo' ? NB.photo : undefined, dir: NB.dir, ts: NB.ts || 1, color: NB.color, sub: $('#nbSub').value.trim() } : null,
    opts: { staffMm: RASTRAL[NB.staff].mm, bars: NB.bars, paper: NB.paper, header: $('#nbHeader').checked, numbers: $('#nbNumbers').checked, composer: $('#nbSub').value.trim() } };
}
let nbT = 0;
function nbPreview() {
  clearTimeout(nbT);
  nbT = setTimeout(async () => {
    await loadMusicFont();
    const f = nbFile(1);
    const cv = $('#nbCover'), pg = $('#nbPage');
    const W = 900, H = Math.round(900 * 842 / 595);
    cv.hidden = !f.cover;
    if (f.cover) { const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; await paintCover(tmp.getContext('2d'), f, W, H); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(tmp, 0, 0); }
    pg.width = W; pg.height = H; drawNotebookPage(pg.getContext('2d'), f, 0, W, H);
    const t = PAPER_TYPES[NB.tpl];
    $('#nbStaffSec').classList.toggle('off', !!t.kind);
    const r = RASTRAL[NB.staff], n = systemsPerPage(NB.tpl, r.mm, false);
    $('#nbStaffVal').textContent = t.kind ? '' : `${r.mm} mm · ${r.use} · ${n} ${n === 1 ? 'line' : 'lines'} a page`;
    $$('#nbStyles canvas').forEach((c) => { const b = c.parentElement; paintCover(c.getContext('2d'), { title: f.title, cover: b.dataset.photo ? { style: 'photo', photo: b.dataset.photo, dir: NB.dir, sub: '' } : { style: b.dataset.v, color: NB.color, sub: '' } }, c.width, c.height, true); });
    $('#nbColors').hidden = NB.cat !== 'classic';
    $('#nbDir').hidden = !(NB.style === 'photo' && photoById(NB.photo).t.k === 'tear');
  }, 60);
}
// the covers of one kind: photos (records, flowers, paint, paper, music) or the drawn classics
function nbTiles() {
  $$('#nbCats button').forEach((x) => x.classList.toggle('on', x.dataset.v === NB.cat));
  const sb = $('#nbStyles'); sb.innerHTML = '';
  const pick = (b, apply) => b.addEventListener('click', () => { apply(); $('#nbHasCover').checked = true; $$('#nbStyles button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); });
  if (NB.cat === 'classic') {
    for (const st of COVER_STYLES) {
      const b = el('button'); b.dataset.v = st.id; const c = el('canvas'); c.width = 120; c.height = 170; b.append(c, document.createTextNode(st.label));
      b.classList.toggle('on', NB.style === st.id);
      pick(b, () => { NB.style = st.id; }); sb.append(b);
    }
  } else {
    for (const p of COVER_PHOTOS.filter((x) => x.cat === NB.cat)) {
      const b = el('button'); b.dataset.v = 'photo'; b.dataset.photo = p.id; const c = el('canvas'); c.className = 'ph'; c.width = 200; c.height = 283; b.append(c, document.createTextNode(p.label));
      b.classList.toggle('on', NB.style === 'photo' && NB.photo === p.id);
      pick(b, () => { NB.style = 'photo'; NB.photo = p.id; }); sb.append(b);
    }
  }
}
async function openNewNotebook() {
  hidePanel();
  $('#newNotebook').hidden = false;
  if (!NB.built) {
    NB.built = true;
    await loadMusicFont();
    const cats = $('#nbCats');
    for (const [id, label] of [...PHOTO_CATS, ['classic', 'Classic']]) {
      const b = el('button'); b.dataset.v = id; b.textContent = label;
      b.addEventListener('click', () => { NB.cat = id; nbTiles(); nbPreview(); });
      cats.append(b);
    }
    $$('#nbDir button').forEach((b) => b.addEventListener('click', () => { NB.dir = b.dataset.v; $$('#nbDir button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); }));
    const cb = $('#nbColors');
    for (const [name, hex] of COVER_COLORS) {
      const b = el('button'); b.style.background = hex; b.setAttribute('aria-label', name); b.dataset.v = hex;
      b.addEventListener('click', () => { NB.color = hex; $$('#nbColors button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); });
      cb.append(b);
    }
    // the papers in two groups: staff paper, and the others
    fillPaperChoices($('#nbPapers'), (k, b) => { NB.tpl = k; $$('#nbPapers button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); });
    for (const id of ['#nbTitle', '#nbSub']) $(id).addEventListener('input', nbPreview);
    $('#nbTs').addEventListener('input', (e) => { NB.ts = +e.target.value / 100; $('#nbTsVal').textContent = e.target.value + '%'; nbPreview(); });
    for (const id of ['#nbHasCover', '#nbHeader', '#nbNumbers']) $(id).addEventListener('change', nbPreview);
    $('#nbStaff').addEventListener('input', (e) => { NB.staff = +e.target.value; nbPreview(); });
    $$('#nbBars button').forEach((b) => b.addEventListener('click', () => { NB.bars = +b.dataset.v; $$('#nbBars button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); }));
    $$('#nbColour button').forEach((b) => b.addEventListener('click', () => { NB.paper = b.dataset.v; $$('#nbColour button').forEach((x) => x.classList.toggle('on', x === b)); nbPreview(); }));
  }
  // the instrument's own clef first
  if (!NB.touched) NB.tpl = { cello: 'bass', bass: 'bass', viola: 'alto', piano: 'piano', guitar: 'tab', voice: 'treble' }[S.instrument] || 'treble';
  nbTiles();
  $$('#nbColors button').forEach((x) => x.classList.toggle('on', x.dataset.v === NB.color));
  $$('#nbPapers button').forEach((x) => x.classList.toggle('on', x.dataset.v === NB.tpl));
  $('#nbStaff').value = NB.staff;
  nbPreview();
}
$('#newNotebookBtn').addEventListener('click', openNewNotebook);
$('#nbCancel').addEventListener('click', () => { $('#newNotebook').hidden = true; });
$('#nbPapers').addEventListener('click', () => { NB.touched = true; });
$('#nbCreate').addEventListener('click', async () => {
  const file = { id: uid(), ...nbFile(+$('#nbPages').value) };
  const doc = await openDocument(file);
  const thumb = await makeThumb(doc, { dark: true });   // (a notebook's cover may well be dark)
  const score = { id: uid(), fileId: file.id, title: file.title, composer: file.cover && file.cover.sub ? file.cover.sub : 'Notebook', pages: doc.pages, added: Date.now(), opened: 0, lastPage: 0, seconds: 0, thumb, kind: 'paper', folder: FOLD.current || undefined };
  await db.put('files', file); await db.put('scores', score);
  $('#nbTitle').value = ''; $('#newNotebook').hidden = true;
  await refreshLibrary(); openScore(score.id);
  // straight to the first page to write on
  if (file.cover) setTimeout(() => { if (V.score && V.score.id === score.id && V.page === 0) goTo(1, false); }, 600);
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
    const a = el('a', 'service ' + cls + (small ? ' small' : '')); a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.append(icon('i-svc-' + cls), el('span', '', name));
    box.append(a);
  }
}
function renderListen() {
  const box = $('#lsWho'); box.textContent = '';
  const list = ['Any', ...(PERFORMERS[S.instrument] || [])];
  for (const n of list) {
    const b = el('button', n === (LS.who || 'Any') ? 'on' : '', n);
    b.addEventListener('click', () => { LS.who = n === 'Any' ? '' : n; $('#lsCustom').value = ''; $('#lsCustom')._syncClear?.(); renderListen(); });
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
  if (!$('#lsQuery').dataset.for || $('#lsQuery').dataset.for !== (V.score && V.score.id)) { $('#lsQuery').value = q; $('#lsQuery').dataset.for = V.score ? V.score.id : ''; $('#lsQuery')._syncClear?.(); }
  renderListen();
}
$('#lsQuery').addEventListener('input', () => renderServices($('#lsServices'), listenQuery()));
$('#lsCustom').addEventListener('input', () => { if ($('#lsCustom').value.trim()) LS.who = ''; renderListen(); $('#lsCustom').focus(); });
$('#lsSave').addEventListener('click', () => {
  const url = $('#lsUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('Paste a full link that starts with https://'); return; }
  const name = $('#lsName').value.trim() || (/spotify/.test(url) ? 'Spotify recording' : /youtu/.test(url) ? 'YouTube video' : 'Recording');
  V.score.listen = [...(V.score.listen || []), { name, url }];
  db.put('scores', V.score); $('#lsUrl').value = ''; $('#lsUrl')._syncClear?.(); $('#lsName').value = ''; renderListen();
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
  const log = allPractice().log;
  const goal = (S.goal || 30) * 60, today = log[dayKey()] || 0;
  const f = Math.min(1, today / goal);
  $('#goalArc').style.strokeDashoffset = (125.66 * (1 - f)).toFixed(1);
  $('#goalPct').textContent = Math.round(today / 60);
  $('#goalBtn').classList.toggle('done', f >= 1);
  $('#goalBtn').setAttribute('aria-label', `Practised ${Math.round(today / 60)} of ${S.goal || 30} minutes today`);
}
const TR = { range: 'week', day: dayKey() };
function rangeDays(n) { const out = []; const d = new Date(); d.setDate(d.getDate() - (n - 1)); for (let i = 0; i < n; i++) { out.push(new Date(d)); d.setDate(d.getDate() + 1); } return out; }
function titleOf(id) { const s = scores.find((x) => x.id === id); return s ? s.title : (IPAD.data && IPAD.data.titles && IPAD.data.titles[id]) || 'Removed score'; }
let trBars = [];
function renderTracker() {
  const AP = allPractice(), log = AP.log, goal = S.goal || 30;
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
  for (const k of keys) { const d = AP.log2[k]; if (!d) continue; for (const [id, v] of Object.entries(d.pieces)) per[id] = (per[id] || 0) + v; tools += d.tools || 0; }
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
  const dk = TR.day, dd = AP.log2[dk];
  const date = new Date(dk + 'T12:00');
  $('#trDayTitle').textContent = dk === dayKey() ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#trDayMin').textContent = fmtMinutes(log[dk] || 0);
  const dl = $('#trDayList'); dl.textContent = '';
  if (dd) for (const [id, v] of Object.entries(dd.pieces).sort((a, b) => b[1] - a[1])) dl.append(el('li', '', `${titleOf(id)} · ${fmtMinutes(v)}`));
  if (dd && dd.tools > 30) dl.append(el('li', '', `Tools · ${fmtMinutes(dd.tools)}`));
  const note = $('#trNote'); if (document.activeElement !== note) note.value = (dd && dd.note) || '';
  note.placeholder = dk === dayKey() ? 'What did you work on today? What is next?' : 'Notes for this day';
  renderPlan();
}

// =====================================================================
// Practice plan: the week in half hours. Tap (or drag over) the times you want to practise; they
// turn green. Afterwards a planned half hour stays green when you practised in it, and turns red
// when you did not. A plan carries on into the following weeks until you change it.
// =====================================================================
const PL = { week: null, paint: null, H0: 12, H1: 46 };   // the shown week (its Monday), rows 6:00–23:00
const mondayOf = (d) => { const m = new Date(d.getFullYear(), d.getMonth(), d.getDate()); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
const weekKeyOf = (d) => dayKey(mondayOf(d));
// the plan of a week: its own, or the one it carries on from
function planFor(wk) {
  const W = practice.plan.weeks;
  if (W[wk]) return W[wk];
  const before = Object.keys(W).filter((k) => k < wk).sort().pop();
  return before ? W[before] : [];
}
function savePlan() { practice.plan.at = Date.now(); setSetting('plan', practice.plan); if (typeof pushPracticeSoon === 'function') pushPracticeSoon(); }
const slotTime = (s) => `${String(Math.floor(s / 2)).padStart(2, '0')}:${s % 2 ? '30' : '00'}`;
function renderPlan() {
  const grid = $('#planGrid'); if (!grid) return;
  const now = new Date(), cur = mondayOf(now);
  if (!PL.week) PL.week = cur;
  const wk = dayKey(PL.week), curKey = dayKey(cur);
  const plan = new Set(planFor(wk));
  const slots = allPractice().slots || {};
  // the rows: 6:00–23:00, wider when the plan or the practice goes outside
  let h0 = PL.H0, h1 = PL.H1;
  for (const id of plan) { const s = +id.split('-')[1]; h0 = Math.min(h0, s); h1 = Math.max(h1, s + 1); }
  for (let d = 0; d < 7; d++) { const day = new Date(PL.week); day.setDate(day.getDate() + d); const x = slots[dayKey(day)] || {}; for (const [s, v] of Object.entries(x)) if (v >= 300) { h0 = Math.min(h0, +s); h1 = Math.max(h1, +s + 1); } }
  $('#plWeek').textContent = wk === curKey ? 'This week' : PL.week.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' – ' + new Date(PL.week.getTime() + 6 * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const past = wk < curKey;
  $('#plHint').textContent = past ? 'An earlier week: green where you practised as planned, red where you did not.' : 'Tap or drag over the half hours you want to practise. The plan carries on into the next weeks.';
  grid.textContent = '';
  grid.style.gridTemplateRows = `auto repeat(${h1 - h0}, var(--plan-row))`;
  grid.append(el('span', 'pl-corner'));
  const days = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(PL.week); day.setDate(day.getDate() + d); days.push(day);
    const hd = el('span', 'pl-day' + (dayKey(day) === dayKey(now) ? ' today' : ''));
    hd.append(el('b', '', day.toLocaleDateString(undefined, { weekday: 'short' })), el('small', '', String(day.getDate())));
    grid.append(hd);
  }
  let planned = 0, kept = 0;
  for (let s = h0; s < h1; s++) {
    grid.append(el('span', 'pl-time' + (s % 2 ? ' half' : ''), s % 2 ? '' : slotTime(s)));
    for (let d = 0; d < 7; d++) {
      const day = days[d], id = d + '-' + s;
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(s / 2), s % 2 ? 30 : 0);
      const end = new Date(start.getTime() + 30 * 60000);
      const sec = ((slots[dayKey(day)] || {})[s]) || 0, done = sec >= 300;
      const isPlan = plan.has(id), over = end <= now;
      let cls = 'pl-cell';
      if (isPlan && over) { cls += done ? ' done' : ' missed'; planned++; if (done) kept++; }
      else if (isPlan) { cls += ' plan'; planned++; if (done) kept++; }
      else if (done) cls += ' extra';
      if (start <= now && now < end) cls += ' now';
      if (over) cls += ' over';
      const c = el('span', cls); c.dataset.id = id; c.dataset.over = over ? '1' : '';
      c.setAttribute('role', 'gridcell');
      c.setAttribute('aria-label', `${day.toLocaleDateString(undefined, { weekday: 'long' })} ${slotTime(s)}${isPlan ? ', planned' : ''}${done ? ', practised' : ''}`);
      grid.append(c);
    }
  }
  $('#plSum').textContent = planned ? `${kept} of ${planned} half hours` : '';
  $('#planRemind').checked = !!practice.plan.remind;
  $('#planLead').value = String(practice.plan.lead || 0);
  $('#planLead').hidden = !practice.plan.remind;
  // the first time: show the morning-to-evening part around now (or the first plan)
  if (!PL.scrolled) {
    PL.scrolled = true;
    const first = [...plan].map((x) => +x.split('-')[1]).sort((a, b) => a - b)[0];
    const target = first !== undefined ? first : now.getHours() * 2;
    const row = grid.querySelector('.pl-time:nth-of-type(1)');
    requestAnimationFrame(() => { const sc = $('#plScroll'); const rh = parseFloat(getComputedStyle(grid).getPropertyValue('--plan-row')) || 20; sc.scrollTop = Math.max(0, (target - h0 - 2) * (rh + 2)); void row; });
  }
}
// tap or drag: the first cell decides whether the drag plans or clears
{
  const grid = $('#planGrid');
  const cellAt = (e) => { const t = document.elementFromPoint(e.clientX, e.clientY); return t && t.classList && t.classList.contains('pl-cell') ? t : null; };
  const apply = (c) => {
    if (!c || !PL.paint || PL.paint.seen.has(c.dataset.id)) return;
    PL.paint.seen.add(c.dataset.id);
    if (c.dataset.over) return;
    const set = PL.paint.set;
    if (PL.paint.add) set.add(c.dataset.id); else set.delete(c.dataset.id);
    c.classList.toggle('plan', PL.paint.add);
  };
  grid.addEventListener('pointerdown', (e) => {
    const c = cellAt(e); if (!c) return;
    const wk = dayKey(PL.week), curKey = weekKeyOf(new Date());
    if (wk < curKey) { toast('This week is over. Plan this week or the next ones.', 2400); return; }
    if (c.dataset.over) { toast('That time has passed.', 1600); return; }
    e.preventDefault();
    const set = new Set(planFor(wk));
    PL.paint = { add: !set.has(c.dataset.id), set, seen: new Set(), wk, touch: e.pointerType === 'touch', x: e.clientX, y: e.clientY, locked: e.pointerType !== 'touch' };
    try { grid.setPointerCapture(e.pointerId); } catch {}
    apply(c);
  });
  grid.addEventListener('pointermove', (e) => {
    if (!PL.paint) return;
    // a finger moving up or down at first scrolls the list instead of painting
    if (!PL.paint.locked) {
      const dx = Math.abs(e.clientX - PL.paint.x), dy = Math.abs(e.clientY - PL.paint.y);
      if (dy > 10 && dy > dx * 1.4 && PL.paint.seen.size <= 1) { const c0 = [...PL.paint.seen][0]; if (c0) { const el0 = grid.querySelector(`[data-id="${c0}"]`); if (el0) el0.classList.toggle('plan', !PL.paint.add); PL.paint.set[PL.paint.add ? 'delete' : 'add'](c0); } PL.paint = null; return; }
      if (dx > 8) PL.paint.locked = true;
    }
    apply(cellAt(e));
  });
  const end = () => {
    if (!PL.paint) return;
    const p = PL.paint; PL.paint = null;
    practice.plan.weeks[p.wk] = [...p.set].sort();
    savePlan(); renderPlan();
    syncReminders();
  };
  grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
  grid.style.touchAction = 'pan-y';
  $('#plPrev').addEventListener('click', () => { PL.week = new Date(PL.week.getTime() - 7 * 864e5); renderPlan(); });
  $('#plNext').addEventListener('click', () => { PL.week = new Date(PL.week.getTime() + 7 * 864e5); renderPlan(); });
}
// ---------- reminders (the Stand app on iPad and iPhone) ----------
const NOTIFY = () => window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standNotify;
// The reminders of the next seven days: each weekday from the plan of the week it falls in (the
// phone repeats them every week, so Stand puts them right again whenever it is opened).
function reminderItems() {
  const lead = practice.plan.lead || 0, items = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let k = 0; k < 7; k++) {
    const day = new Date(today.getTime() + k * 864e5);
    const d = (day.getDay() + 6) % 7;                 // 0 = Monday, as in the plan
    const list = planFor(weekKeyOf(day)).map((id) => id.split('-').map(Number)).filter(([dd]) => dd === d).map(([, sl]) => sl).sort((a, b) => a - b);
    for (let i = 0; i < list.length; i++) {
      const s0 = list[i]; let s1 = s0; while (list[i + 1] === s1 + 1) { i++; s1++; }
      let mins = s0 * 30 - lead, wd = d;
      if (mins < 0) { mins += 24 * 60; wd = (d + 6) % 7; }
      items.push({ weekday: ((wd + 1) % 7) + 1, hour: Math.floor(mins / 60), minute: mins % 60, title: 'Time to practise', body: `Your plan: ${slotTime(s0)}–${slotTime(s1 + 1).replace('48:00', '24:00')}.` });
    }
  }
  return items;
}
function syncReminders(extra = []) {
  const N = NOTIFY();
  if (!N) return;
  if (practice.plan.remind || extra.length) N.postMessage({ op: 'schedule', items: [...(practice.plan.remind ? reminderItems() : []), ...extra] });
  else N.postMessage({ op: 'clear' });
}
// put the reminders right whenever Stand opens or comes back (a new week may have its own plan)
setTimeout(() => syncReminders(), 4000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => syncReminders(), 1500); });
// a test: a reminder in one minute (it goes again the next time the reminders are put right)
function testReminder() {
  if (!NOTIFY()) { toast('Reminders come from the Stand app on iPad and iPhone.', 3000); return; }
  const t = new Date(Date.now() + 70 * 1000);
  syncReminders([{ weekday: t.getDay() + 1, hour: t.getHours(), minute: t.getMinutes(), title: 'Stand', body: 'This is how your practice reminders will look.' }]);
  toast('A test reminder comes in about a minute. Leave Stand (go to the Home Screen) to see it.', 5000);
  setTimeout(() => syncReminders(), 3 * 60 * 1000);
}
window.standNotifyState = (st) => {
  if (st && !st.allowed && st.asked && practice.plan.remind) {
    practice.plan.remind = false; savePlan(); renderPlan();
    toast('Notifications are off for Stand. Turn them on in Settings › Notifications › Stand.', 5000);
  }
};
$('#planRemind').addEventListener('change', (e) => {
  if (e.target.checked && !NOTIFY()) { e.target.checked = false; toast('Reminders come from the Stand app on iPad and iPhone.', 3000); return; }
  practice.plan.remind = e.target.checked; savePlan(); syncReminders(); renderPlan();
  if (e.target.checked) toast('You will get a reminder when a planned practice begins.', 2600);
});
$('#planTest').addEventListener('click', testReminder);
$('#planLead').addEventListener('change', (e) => { practice.plan.lead = +e.target.value; savePlan(); syncReminders(); });
$('#trChart').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left;
  const b = trBars.find((q) => x >= q.x0 && x < q.x1);
  if (b && b.key) { TR.day = b.key; renderTracker(); }
});
$$('#trRange button').forEach((b) => b.addEventListener('click', () => { TR.range = b.dataset.range; renderTracker(); }));
$('#trNote').addEventListener('input', (e) => { practice.day(TR.day).note = e.target.value; clearTimeout(practice.noteT); practice.noteT = setTimeout(() => setSetting('log2', practice.log2), 500); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="goal"]')) { TR.day = dayKey(); PL.week = null; PL.scrolled = false; requestAnimationFrame(renderTracker); } });
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

// --- wink to turn pages (iPad app, face tracking) ---
const wink = { on: false, testing: false, lv: [], det: new WinkLevels(), lastLv: 0, lastTurn: 0 };
// a wink as the iPad saw it, checked against the levels of both eyes just before it: the winking eye
// clearly shut, the other clearly open all along (with no levels to go by, it stands)
function winkOk(eye) {
  const now = performance.now(), win = wink.lv.filter((q) => now - q.t < 500);
  if (win.length < 4) return true;
  const shut = Math.max(...win.map((q) => (eye === 'left' ? q.l : q.r))), other = Math.max(...win.map((q) => (eye === 'left' ? q.r : q.l)));
  const before = wink.lv.filter((q) => now - q.t >= 500).map((q) => (eye === 'left' ? q.r : q.l)).sort((a, b) => a - b);
  const rest = before.length ? before[Math.floor(before.length * 0.3)] : 0.1;
  // as it was: the other eye clearly open; or, with the face aside (that eye half shut all the
  // time), the other eye no further shut than its own rest
  return !(other > 0.5 || other > shut * 0.6) || (!(other - rest > 0.3 && other > 0.5) && other < shut * 0.85);
}
// the face turned aside: one eye's resting level well above the other's (it looks half shut)
function faceAside() {
  const now = performance.now(), old = wink.lv.filter((q) => now - q.t > 400);
  if (old.length < 8) return false;
  const med = (k) => { const v = old.map((q) => q[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  return Math.abs(med('l') - med('r')) > 0.14;
}
function winkSupported() { return !!(NATIVE && NATIVE.standFace && CAPS.face); }
// --- tap the stand to turn pages (iPad app, motion sensors) ---
const tapTest = { on: false };
function tapSupported() { return !!(NATIVE && NATIVE.standTap && CAPS.tap); }
function sendTap() {
  if (!tapSupported()) return;
  const active = (S.tapStand && !$('#score').hidden && !(recState && recState.kind === 'video')) || tapTest.on;
  NATIVE.standTap.postMessage({ on: !!active, sensitivity: S.tapSens || 0.6 });
}
function syncTapUI() {
  // knocking on the stand is replaced by turning pages by listening
  const ok = false; if (S.tapStand) { S.tapStand = false; sendTap(); }
  $('#tapRow').hidden = !ok; $('#tapNo').hidden = ok; $('#tapCard').hidden = !ok;
  $('#followOn').checked = !!S.followTurn;
  $('#tapOn').checked = !!S.tapStand; $('#tapSens').value = Math.round((S.tapSens || 0.6) * 100);
  $('#tapBody').hidden = !S.tapStand;
  syncEyesUI();
}
$('#followOn').addEventListener('change', (e) => { S.followTurn = e.target.checked; saveSettings(); syncEyesUI(); follow.sync(); });
$('#tapOn').addEventListener('change', (e) => { S.tapStand = e.target.checked; saveSettings(); syncTapUI(); sendTap(); });
$('#tapSens').addEventListener('input', (e) => { S.tapSens = +e.target.value / 100; saveSettings(); sendTap(); });
$('#tapTest').addEventListener('click', () => {
  tapTest.on = !tapTest.on;
  $('#tapTest').textContent = tapTest.on ? 'Stop test' : 'Test';
  $('#tapLast').textContent = tapTest.on ? 'Knock on the stand…' : '';
  sendTap();
});
window.standTapEvent = (ev) => {
  if (!ev || ev.type !== 'tap') return;
  if (tapTest.on) { $('#tapLast').textContent = 'Tap heard'; return; }
  if (!$('#score').hidden && S.tapStand && !V.inking) turn(1);
};

function sendFace() {
  sendTap();
  if (!winkSupported()) return;
  // (while the eyes are followed, the camera is in use here, and winks are seen from it)
  let jsCam = false; try { jsCam = !!(eyes.running || EC.on); } catch {}
  const active = !jsCam && ((S.wink && !$('#score').hidden && !(recState && recState.kind === 'video')) || wink.testing);
  // (the eye levels always come: a wink is checked against them, the other eye clearly open)
  NATIVE.standFace.postMessage({ on: !!active, sensitivity: S.winkSens || 0.7, test: wink.testing || !!(S.winkGate ?? 1) });
  wink.on = !!active;
  $('#winkBadge').hidden = !(S.wink && !$('#score').hidden && active);
}
function syncWinkUI() {
  const ok = winkSupported();
  $('#winkRow').hidden = !ok; $('#winkNo').hidden = ok;
  $('#winkOn').checked = !!S.wink; $('#winkSens').value = Math.round((S.winkSens || 0.7) * 100);
  $('#winkSwap').checked = !!S.winkSwap; $('#winkBody').hidden = !S.wink;
}
$('#winkOn').addEventListener('change', (e) => { S.wink = e.target.checked; saveSettings(); syncWinkUI(); sendFace(); });
$('#winkSens').addEventListener('input', (e) => { S.winkSens = +e.target.value / 100; saveSettings(); sendFace(); });
$('#autoTurn').addEventListener('change', (e) => { S.autoTurn = +e.target.value; saveSettings(); autoBars = 0; });
// Sound routing in the iPad app: the microphone is always the iPad's; the speaker can be forced.
function sendAudio() { window.__standSpeaker = !!S.audioSpeaker; try { applySession(); } catch {} if (NATIVE && NATIVE.standAudio) NATIVE.standAudio.postMessage({ speaker: !!S.audioSpeaker }); }
$('#audioSpeaker').addEventListener('change', (e) => { S.audioSpeaker = e.target.checked; saveSettings(); sendAudio(); });
// (the microphone opening or closing resets where the sound goes on iOS: said again)
window.addEventListener('stand-mic-changed', () => setTimeout(sendAudio, 300));
// Bluetooth headphones gone into their call mode (poor sound): said once, with what to do
let callModeSaid = false;
window.addEventListener('stand-tuner-state', () => { try { updateTunerButtons(); } catch {} });
window.addEventListener('stand-audio-callmode', () => { if (callModeSaid) return; callModeSaid = true; toast('Your Bluetooth headphones are in call mode, so the sound is poor. Turn off what listens (tuner, listening to turn pages), or tap “Start the sound again” in Settings › Sound.', 6000); });
// the sound, as it is now, and what happened to it (to tell what went wrong)
function syncSoundState() {
  const c = getCtx();
  $('#soundState').textContent = `Sound system: ${c.state === 'running' ? 'on' : c.state}, ${Math.round(c.sampleRate / 100) / 10} kHz.`;
  const ol = $('#soundLog'); ol.textContent = '';
  for (const e of audioLog.slice(-14).reverse()) ol.append(el('li', '', `${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${e.what} · ${e.state}, ${Math.round(e.sr / 100) / 10} kHz`));
  if (!audioLog.length) ol.append(el('li', '', 'Nothing yet.'));
}
$('#soundReset').addEventListener('click', async () => { await resetSound(); unlock(); setTimeout(() => { syncSoundState(); testBeep(); }, 300); toast('The sound was started again.', 1600); });
function testBeep() { const c = getCtx(); const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 660; g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(0.25, c.currentTime + 0.02); g.gain.linearRampToValueAtTime(0, c.currentTime + 0.35); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.4); }
$('#soundTest').addEventListener('click', () => { unlock(); testBeep(); setTimeout(syncSoundState, 300); });
$('#soundLog').closest('details').addEventListener('toggle', syncSoundState);
$('#penOpens').addEventListener('change', (e) => { S.penOpens = e.target.checked; saveSettings(); });
$('#winkSwap').addEventListener('change', (e) => { S.winkSwap = e.target.checked; saveSettings(); });
$('#winkTest').addEventListener('click', () => { wink.testing = !wink.testing; $('#winkTest').textContent = wink.testing ? 'Stop test' : 'Test'; $('#winkMeter').hidden = !wink.testing; sendFace(); });
// a wink seen (from the levels here, or the iPad's own): the page turns, once
// (one wink seen twice, by the iPad and from the levels here, turns once; two winks of yours, one
// after the other, turn twice: the next can come 0.4 s after the last)
function winkFound(rawEye, src = 'ipad') {
  const now = performance.now(); if (now - wink.lastTurn < (src !== wink.lastSrc ? 900 : 400)) return; wink.lastTurn = now; wink.lastSrc = src;
  let eye = rawEye; if (S.winkSwap) eye = eye === 'left' ? 'right' : 'left';
  if (wink.testing) { const t = $('#winkLast'); t.textContent = eye === 'right' ? 'Right wink → next page' : 'Left wink → previous page'; }
  if (!$('#score').hidden && S.wink) {
    turn(eye === 'right' ? 1 : -1);
    const f = $('#winkFlash'); f.className = 'wink-flash ' + eye; void f.offsetWidth; f.classList.add('on');
  }
}
window.standFaceEvent = (ev) => {
  if (!ev) return;
  if (ev.type === 'levels') {
    const now = performance.now();
    wink.lv.push({ t: now, l: +ev.l || 0, r: +ev.r || 0 }); while (wink.lv.length && now - wink.lv[0].t > 1500) wink.lv.shift();
    wink.lastLv = now;
    // the iPad's own winks turn the page as they always did; with the face aside the levels are
    // judged here too, each eye against its own rest (the iPad misses those winks)
    wink.det.sens = S.winkSens || 0.7;
    // (judged here as well, from the levels: a wink is seen ~0.12 s after the eye shuts, sooner than
    // the iPad's own, which comes later; the first of the two turns the page, once)
    const e = wink.det.feed(now, +ev.l || 0, +ev.r || 0, !ev.hand);
    if (e && (faceAside() || (S.winkFast ?? true))) winkFound(e, 'levels');
    if (!wink.testing) return;
    const [l, r] = S.winkSwap ? [ev.r, ev.l] : [ev.l, ev.r];
    $('#eyeL').style.setProperty('--v', l); $('#eyeR').style.setProperty('--v', r);
    // a hand over the eyes pauses winking (shown while testing)
    const wm = $('#winkMeter'); if (wm) wm.classList.toggle('hand', !!ev.hand);
    return;
  }
  if (ev.type === 'wink') {
    if (!winkOk(ev.eye)) { if (wink.testing) $('#winkLast').textContent = 'Both eyes closed: not a wink'; return; }
    winkFound(ev.eye);
  }
  if (ev.type === 'unsupported') { CAPS.face = false; syncWinkUI(); }
};
new MutationObserver(() => sendFace()).observe($('#score'), { attributes: true, attributeFilter: ['hidden'] });

// --- backup (to iCloud Drive, through the share sheet) ---
const mb = (n) => n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(1)} GB`;
const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
async function backupState() {
  const at = await getSetting('backupAt', 0), changed = await lastChange();
  return { at, changed, stale: !at || changed > at, days: at ? (Date.now() - at) / 864e5 : Infinity };
}
async function renderBackup() {
  const st = await backupState(), sz = await backupSizes();
  const box = $('#bkState');
  box.classList.toggle('ok', !!st.at && !st.stale); box.classList.toggle('old', !!st.at && st.stale);
  $('#bkStateTitle').textContent = !st.at ? 'No backup yet' : st.stale ? `Last backup ${ago(st.at)}` : `Backed up ${ago(st.at)}`;
  $('#bkStateText').textContent = !st.at ? `Your library is ${mb(sz.essentials)}${sz.recordings ? `, recordings ${mb(sz.recordings)}` : ''}.` : st.stale ? 'There are changes since then.' : 'Nothing has changed since.';
  $('#bkTakesSize').textContent = sz.recordings ? `(${mb(sz.recordings)})` : '(none yet)';
  $('#bkLibSize').textContent = `(${mb(sz.essentials)})`;
  $('#bkTakes').disabled = !sz.recordings;
  const set = await getSetting('backupTakes', false); $('#bkTakes').checked = !!set && sz.recordings > 0;
  $('#bkSettingsState').textContent = st.at ? `Last backup ${ago(st.at)}.` : 'Everything in Stand, kept safe outside the app.';
  const auto = await getSetting('backupAuto', 'week'); $$('#bkAuto button').forEach((x) => x.classList.toggle('on', x.dataset.auto === auto));
  $('#bkTakesWhich').hidden = !$('#bkTakes').checked || canSaveHere();
  $('#panel-backup').classList.toggle('in-folder', canSaveHere());
  if (canSaveHere()) $('#bkAutoHint').textContent = 'When it is time and something has changed, Stand makes the backup by itself, in the Stand folder, without asking anything.';
  const fresh = (await newTakeIds(false)).length; const nb = $('#bkTakesWhich button[data-which="new"]'); if (nb) nb.textContent = fresh ? `Only new ones (${fresh})` : 'Only new ones (none)';
}
async function renderBackupBanner() {
  const b = $('#bkBanner'); if (!b) return;
  const st = await backupState();
  const snooze = await getSetting('backupSnooze', 0);
  const has = scores.length > 0;
  const auto = await getSetting('backupAuto', 'week');
  const every = auto === 'day' ? 1 : 7;
  const show = has && st.stale && st.days >= every && Date.now() > snooze;
  b.hidden = !show;
  if (show) {
    $('#bkBannerTitle').textContent = st.at ? 'Time for a new backup' : 'Keep a copy in iCloud Drive';
    $('#bkBannerText').textContent = st.at ? `The last one was ${ago(st.at)}, and you have changed things since.` : 'Your scores and markings are only on this iPad. If Stand is deleted, they go with it.';
    $('#bkBannerGo').textContent = auto !== 'off' ? 'Save backup' : 'Back up';
  }
}
$('#bkLater').addEventListener('click', async () => { await setSetting('backupSnooze', Date.now() + 3 * 864e5); $('#bkBanner').hidden = true; });
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="backup"]')) { $('#bkFiles').hidden = true; renderBackup(); } });
$('#bkTakes').addEventListener('change', (e) => setSetting('backupTakes', e.target.checked));
// ---- making a backup: the library as one file (or a few, when it is very big), the recordings
// in their own files (only the new ones, unless all are asked for). Names say what each file is.
const BK = { vols: [] };
const prettyDay = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
async function newTakeIds(all) {
  const takes = await db.all('takes');
  if (all) return takes.map((t) => t.id);
  const done = new Set(await getSetting('backupTakesDone', []));
  return takes.filter((t) => !done.has(t.id)).map((t) => t.id);
}
// The Stand folder in Files (On My iPad › Stand), written by the app itself (newer iPad apps only)
const NSAVE = () => (window.standCaps || {}).files && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standSave;
const canSaveHere = () => !!NSAVE();
const saveWait = new Map();
window.standSaved = (r) => { const w = r && saveWait.get(r.id); if (w) { saveWait.delete(r.id); w(r); } };
// (newer apps say when each piece is written: the next one goes then, so a big file never piles up in memory)
const chunkWait = new Map();
window.standSavedChunk = (r) => { const w = r && chunkWait.get(r.id); if (w) { chunkWait.delete(r.id); w(); } };
const b64Of = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
async function saveInStandFolder(blob, folder, name) {
  const H = NSAVE(); if (!H) throw new Error('no folder');
  const id = uid();
  const done = new Promise((res) => saveWait.set(id, res));
  H.postMessage({ op: 'begin', id, folder, name });
  const PIECE = 2 * 1024 * 1024;
  let acks = +((window.standCaps || {}).files) >= 2;
  try {
    for (let o = 0; o < blob.size; o += PIECE) {
      const ok = acks ? new Promise((r) => { chunkWait.set(id, r); setTimeout(() => { if (chunkWait.get(id) === r) { acks = false; r(); } }, 10000); }) : null;
      H.postMessage({ op: 'chunk', id, data: await b64Of(blob.slice(o, o + PIECE)) });
      if (ok) await ok;
    }
    chunkWait.delete(id);
  }
  catch (e) { H.postMessage({ op: 'cancel', id }); saveWait.delete(id); throw e; }
  H.postMessage({ op: 'end', id });
  const r = await Promise.race([done, new Promise((res) => setTimeout(() => res({ ok: false, error: 'timeout' }), 180000))]);
  saveWait.delete(id);
  if (!r.ok) throw new Error(r.error || 'not saved');
  return r.path;
}
// Files › Stand › Scores: each score of the library as a PDF, in its folder. Only what is new or
// changed is written; a score renamed or moved leaves its old copy behind no more. (A score deleted
// in Stand keeps its copy here: nothing you had is ever lost by a backup.)
const fileSafe = (t, max = 80) => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '') || 'Untitled';
async function mirrorScores() {
  const H = NSAVE(); if (!H) return;
  const done = await getSetting('folderPdfs', {}), next = {}, used = new Set();
  for (const sc of scores) {
    if (!sc.fileId || sc.kind === 'paper' || sc.kind === 'comp') continue;
    const fo = FOLD.list.find((x) => x.id === sc.folder);
    const folder = 'Scores' + (fo ? '/' + fileSafe(fo.name, 60) : '');
    let name = fileSafe((sc.composer ? sc.composer + ' - ' : '') + sc.title, 110), k = 2;
    while (used.has((folder + '/' + name).toLowerCase())) name = fileSafe((sc.composer ? sc.composer + ' - ' : '') + sc.title, 104) + ` (${k++})`;
    used.add((folder + '/' + name).toLowerCase());
    const path = folder + '/' + name + '.pdf';
    const f = await db.get('files', sc.fileId);
    if (!f || f.kind !== 'pdf' || !f.data) continue;
    const size = f.data.byteLength ?? f.data.size ?? 0, key = path + '|' + size;
    if (done[sc.fileId] === key) { next[sc.fileId] = key; continue; }
    await saveInStandFolder(f.data instanceof Blob ? f.data : new Blob([f.data], { type: 'application/pdf' }), folder, name + '.pdf');
    const old = done[sc.fileId] && done[sc.fileId].split('|')[0];
    if (old && old !== path) try { H.postMessage({ op: 'remove', path: old }); } catch {}
    next[sc.fileId] = key;
    await setSetting('folderPdfs', { ...done, ...next });   // (kept as it goes: an interrupted copy goes on from here)
  }
  for (const [id, key] of Object.entries(done)) if (!next[id]) next[id] = key;
  await setSetting('folderPdfs', next);
}
// a little time in the background for work that should not stop half way (newer iPad apps only)
function nativeBusy(on, why) { try { if ((window.standCaps || {}).busy) window.webkit.messageHandlers.standBusy.postMessage({ on: !!on, why }); } catch {} }
window.__nativeBusy = nativeBusy;
const canShareAll = (vols) => { try { const fs = vols.map((v) => new File([v.blob], v.name, { type: 'application/zip' })); return !!(navigator.canShare && navigator.canShare({ files: fs })); } catch { return false; } };
async function backupNow({ auto = false } = {}) {
  const btn = $('#bkMake'); if (btn.disabled) return; btn.disabled = true;
  toast('Packing your library…', 60000);
  try {
    const stamp = prettyDay();
    const vols = await makeBackupSet('library', stamp, FOLD.list);
    // with the Stand folder nothing is asked: every recording not yet kept goes along too
    const here = canSaveHere();
    if (here || $('#bkTakes').checked) {
      const ids = await newTakeIds(here ? false : BK.which === 'all');
      if (ids.length) { toast('Packing your recordings…', 60000); vols.push(...await makeBackupSet('recordings', stamp, FOLD.list, ids)); }
    }
    BK.vols = vols;
    $('#toast').hidden = true;
    const ul = $('#bkList'); ul.textContent = '';
    let saved = 0;
    const done = async () => {
      await setSetting('backupAt', Date.now()); await setSetting('backupSnooze', 0);
      const recs = vols.filter((v) => v.kind === 'Recordings').flatMap((v) => v.takeIds || []);
      if (recs.length) await setSetting('backupTakesDone', [...new Set([...(await getSetting('backupTakesDone', [])), ...recs])]);
      renderBackup(); renderBackupBanner();
    };
    const markSaved = (li, go) => { if (!li.classList.contains('saved')) { li.classList.add('saved'); go.textContent = 'Saved'; saved++; } if (saved === vols.length) done(); };
    vols.forEach((v, i) => {
      const li = el('li'); const name = el('span', '', v.kind + (v.count > 1 ? ` · part ${v.part} of ${v.count}` : '')); name.append(' ', el('small', 'num', mb(v.size)));
      const go = el('button', 'btn small' + (i === 0 ? ' primary' : ''), 'Save');
      go.addEventListener('click', async () => {
        await shareBlob(v.blob, v.name);
        markSaved(li, go);
        const next = ul.children[i + 1]; if (next) next.querySelector('.btn').classList.add('primary');
      });
      li.append(name, go); ul.append(li);
    });
    const all = vols.length > 1 && canShareAll(vols);
    $('#bkSaveAll').hidden = !all;
    $('#bkSaveAll').onclick = async () => {
      const fs = vols.map((v) => new File([v.blob], v.name, { type: 'application/zip' }));
      try { await navigator.share({ files: fs }); [...ul.children].forEach((li) => markSaved(li, li.querySelector('.btn'))); } catch {}
    };
    $('#bkHow').innerHTML = vols.length > 1
      ? `Your backup is <b>${vols.length} files</b>, named by what they hold. ${all ? 'Tap <b>Save all at once</b>, or save them one by one' : 'Save them one by one'}: in the sheet choose <b>Save to Files</b>, then <b>iCloud Drive › Stand</b> (make the folder Stand the first time). Opened in Files, each file is a folder with your scores as PDFs and your recordings.`
      : 'In the sheet that opens, choose <b>Save to Files</b>, then <b>iCloud Drive › Stand</b> (make the folder Stand the first time). Opened in Files, the file is a folder with your scores as PDFs (in the folders of your library).';
    $('#bkFiles').hidden = false;
    // the app can write to its own folder in Files: the backup is saved there at once, every part
    // (the older library backups go, the three newest stay); Share still sends a copy elsewhere
    if (canSaveHere()) {
      nativeBusy(true, 'backup');
      try {
        toast('Saving the backup in Files › Stand › Backups…', 120000);
        // Backups: the library (the newest three stay); Recordings: the new recordings (each
        // backup's own file, with the time, so none is written over)
        const hm = new Date().toTimeString().slice(0, 5).replace(':', '.');
        for (const li of ul.children) {
          const v = vols[[...ul.children].indexOf(li)];
          const rec = v.kind === 'Recordings';
          await saveInStandFolder(v.blob, rec ? 'Recordings' : 'Backups', rec ? v.name.replace(/\.zip$/, ` ${hm}.zip`) : v.name);
          const go = li.querySelector('.btn'); markSaved(li, go); go.textContent = 'Share'; go.classList.remove('primary');
        }
        const nLib = vols.filter((v) => v.kind === 'Library').length;
        try { NSAVE().postMessage({ op: 'keep', folder: 'Backups', prefix: 'Stand – Library – ', count: Math.max(3, nLib * 3) }); } catch {}
        // Scores: every score as a PDF you can open by hand, in the folders of your library
        try { toast('Saving your scores in Files › Stand › Scores…', 120000); await mirrorScores(); } catch (err) { console.warn('scores copy', err); }
        $('#bkHow').innerHTML = 'Saved in <b>Files › On My iPad › Stand</b>: <b>Backups</b> (to bring everything back), <b>Scores</b> (your scores as PDFs, in your folders), <b>Recordings</b> and <b>Diagnostics</b>. They stay on this iPad, so if Stand is deleted they go with it: from time to time tap <b>Share</b> and save a copy in <b>iCloud Drive</b> too.';
        toast('Backup saved in Files › Stand', 3500);
      } catch (err) { toast('The backup could not be saved in the Stand folder (' + (err.message || err) + '). Use Share instead.', 6000); }
      nativeBusy(false, 'backup');
    } else if (vols.length === 1 || auto) ul.querySelector('.btn').click();
  } catch (err) { console.error(err); toast('The backup could not be made: ' + (err.message || err), 5000); }
  btn.disabled = false;
}
$('#bkMake').addEventListener('click', () => backupNow());
BK.which = 'new';
$$('#bkTakesWhich button').forEach((b) => b.addEventListener('click', () => { BK.which = b.dataset.which; $$('#bkTakesWhich button').forEach((x) => x.classList.toggle('on', x === b)); }));
$('#bkTakes').addEventListener('change', () => { $('#bkTakesWhich').hidden = !$('#bkTakes').checked; });
// automatic: when the time has come and something changed, the banner offers the finished backup
$$('#bkAuto button').forEach((b) => b.addEventListener('click', async () => { await setSetting('backupAuto', b.dataset.auto); $$('#bkAuto button').forEach((x) => x.classList.toggle('on', x === b)); renderBackupBanner(); }));
// with the Stand folder there is nothing to choose: when a backup is due it is made by itself, while
// the library is on screen and nothing else is going on (once a day at most)
setInterval(async () => {
  try {
    if (!canSaveHere() || document.visibilityState !== 'visible' || !$('#score').hidden || openPanel || recState || $('#bkMake').disabled) return;
    if (Date.now() - (window.__autoBkAt || 0) < 864e5 || !scores.length) return;
    const auto = await getSetting('backupAuto', 'week'); if (auto === 'off') return;
    const st = await backupState(); if (!(st.stale && st.days >= (auto === 'day' ? 1 : 7))) return;
    window.__autoBkAt = Date.now();
    await backupNow({ auto: true });
  } catch {}
}, 60000);
$('#bkBannerGo').addEventListener('click', async () => { showPanel('backup'); renderBackup(); if ((await getSetting('backupAuto', 'week')) !== 'off') backupNow({ auto: true }); });
$('#bkInput').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  toast('Bringing your library back…', 120000);
  try {
    window.__restoring = true;
    const r = await restoreFiles(files);
    const miss = r.missing.filter((m) => m.lack.length);
    await setSetting('backupAt', Date.now());
    if (miss.length) toast(`Restored ${r.scores} scores. ${miss.map((m) => `File${m.lack.length > 1 ? 's' : ''} ${m.lack.join(', ')} of ${m.count}`).join('; ')} not chosen — restore again with all the files to get the rest.`, 9000);
    else toast(`Restored ${r.scores} score${r.scores === 1 ? '' : 's'}${r.takes ? ` and ${r.takes} recording${r.takes === 1 ? '' : 's'}` : ''}. Starting again…`, 3000);
    // settings and the practice log come back too: start fresh with them
    setTimeout(() => location.reload(), miss.length ? 9000 : 2200);
  } catch (err) { window.__restoring = false; console.error(err); toast(err.message || 'That file could not be restored.', 5000); }
});
// ask the system to keep our storage (it is never cleared to make room)
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch {}
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="app"]')) { syncWinkUI(); syncTapUI(); syncSoundState(); $('#appInst').value = S.instrument; applyAppearance(); } });

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
// iPhone: a phone-sized Stand, and the camera for the iPad
// =====================================================================
const PHONE = /iPhone|iPod/.test(navigator.userAgent) || (Math.min(screen.width, screen.height) < 500 && matchMedia('(pointer: coarse)').matches);
if (PHONE) document.body.classList.add('phone');

const phone = new CameraPhone();
function pcDraw(st, f) {
  const s2 = st || phone.state;
  const status = $('#pcStatus');
  status.classList.toggle('live', phone.recording);
  status.textContent = phone.recording ? '● Recording' : s2 === 'linked' ? 'Linked to the iPad' : s2 === 'connecting' ? 'Looking for the iPad…' : s2 === 'sending' ? `Sending to the iPad ${Math.round((f || 0) * 100)}%` : s2 === 'nobody' ? 'No iPad with that code' : s2 === 'offline' ? 'No internet to find the iPad' : s2 === 'lost' ? 'Looking for the iPad again…' : 'Not linked';
  const linked = s2 === 'linked' || s2 === 'sending';
  $('#pcJoin').hidden = linked;
  $('#pcFindText').textContent = s2 === 'offline' ? 'No internet. Trying again…' : s2 === 'nobody' ? 'No iPad with that code.' : 'Looking for your iPad…';
  $('#pcBottom').hidden = !linked;
  if (!linked) { $('#pcAdjust').hidden = true; $('#pcAdjBtn').classList.remove('on'); }
  $('#pcFlip').hidden = !linked || phone.recording;
  $('#pcRec').classList.toggle('on', phone.recording);
  $('#phonecam').classList.toggle('front', phone.facing === 'user');
  $('#pcSend').hidden = s2 !== 'sending'; if (s2 === 'sending') $('#pcSend i').style.width = Math.round((f || 0) * 100) + '%';
  $('#pcHint').textContent = phone.recording ? (phone.shape === 'portrait' ? 'Recording upright' : 'Recording sideways')
    : (phone.shape === 'portrait' ? 'Vertical. Turn the iPhone sideways for a horizontal video.' : 'Horizontal. Hold it upright for a vertical video.');
  for (const [id, key] of [['#pcBright', 'bright'], ['#pcWarm', 'warm'], ['#pcZoom', 'zoom']]) if (document.activeElement !== $(id)) $(id).value = phone.s[key];
}
// the iPad's practice comes along with the camera link
setInterval(async () => { if (!PHONE && host.state === 'linked' && S.shareIphone !== false) { try { host.sendPractice(await practiceForPhone()); } catch {} } }, 3 * 60000);
phone.onPractice = async (d) => {
  if (!d || d.v !== 1) return;
  IPAD.data = d; IPAD.last = Date.now(); adoptPlan(d); await setSetting('ipadPractice', d);
  renderIpadCard(); renderGoal(); renderToday(); if (openPanel === 'goal') renderTracker();
};
phone.onState = (st, f) => { if (typeof f === 'string') toast(f, 4500); pcDraw(st === 'error' ? phone.state : st, typeof f === 'number' ? f : 0); };
// a video that could not reach the iPad is kept here, in Recordings, never lost
phone.onUnsent = async (blob, mirror) => {
  try {
    const id = uid();
    await db.put('files', { id: 'video:' + id, data: blob });
    const dur = await new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => res(v.duration || 0); v.onerror = () => res(0); v.src = URL.createObjectURL(blob); });
    await db.put('takes', { id, kind: 'video', name: 'Camera video (not sent)', created: Date.now(), dur, mime: blob.type, mirror: !!mirror, thumb: await videoThumb(blob).catch(() => null) });
  } catch {}
  $('#pcResend').hidden = false;
};
$('#pcResend').addEventListener('click', async () => { $('#pcResend').hidden = true; const ok = await phone.resend(); if (!ok && phone.unsent) $('#pcResend').hidden = false; });
phone.onLocal = (stream) => { const v = $('#pcVideo'); if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); } };
$('#phoneCamTile').addEventListener('click', async () => {
  $('#phonecam').hidden = false; $('#pcCodeBox').hidden = true; $('#pcUseCode').hidden = false; pcDraw('connecting');
  try { await phone.openCamera(); } catch (e) { toast('Camera access is off. Turn it on in Settings › Stand.', 5000); return; }
  phone.find();
  setTimeout(() => { if (!$('#phonecam').hidden) sectionTour('phonecam', { force: true }); }, 800);
});
$('#pcUseCode').addEventListener('click', () => { $('#pcCodeBox').hidden = false; $('#pcUseCode').hidden = true; setTimeout(() => $('#pcCode').focus(), 100); });
$('#pcConnect').addEventListener('click', async () => {
  const code = $('#pcCode').value.replace(/\D/g, '');
  if (code.length !== 6) { toast('Type the six numbers shown on the iPad.'); return; }
  $('#pcCode').blur();
  phone.find(code);
});
$('#pcCode').addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) $('#pcConnect').click(); });
$('#pcClose').addEventListener('click', () => { phone.leave(); $('#phonecam').hidden = true; $('#pcVideo').srcObject = null; });
$('#pcFlip').addEventListener('click', () => phone.apply({ facing: phone.facing === 'user' ? 'environment' : 'user' }));
$('#pcRec').addEventListener('click', () => { if (phone.recording) phone.stopAndSend(); else phone.record(); });
$('#pcAdjBtn').addEventListener('click', () => { const h = !$('#pcAdjust').hidden; $('#pcAdjust').hidden = h; $('#pcAdjBtn').classList.toggle('on', !h); });
for (const [id, key] of [['#pcBright', 'bright'], ['#pcWarm', 'warm'], ['#pcZoom', 'zoom']]) $(id).addEventListener('input', (e) => phone.apply({ [key]: +e.target.value }));
window.__link = { host, phone };

// =====================================================================
// Sets and practice sessions: one reading order across several scores
// =====================================================================
// A run is a list of parts, each a range of pages in one score (a set) or one passage's page (a
// practice session). Turning past a part's last page opens the next part, in whatever score it is.
const RUN = { on: false, kind: '', name: '', items: [], idx: 0, busy: false };
const runItem = () => (RUN.on ? RUN.items[RUN.idx] : null);
function mappedOf(orig) { if (!V.doc) return 0; for (let i = 0; i < V.doc.pages; i++) if (V.doc.orig(i) === orig) return i; return -1; }
// the pages (0-based, in the score as it is now) of the part on show; null when another score is open
function runRange() {
  const it = runItem(); if (!it || !V.doc || !V.score || V.score.id !== it.sid) return null;
  const n = V.doc.pages;
  if (it.orig !== undefined) { const k = mappedOf(it.orig); const p = k < 0 ? 0 : k; return [p, p]; }
  const a = clamp(it.a - 1, 0, n - 1);
  return [a, clamp(it.b - 1, a, n - 1)];
}
function lastPg() { const r = RUN.on ? runRange() : null; return r ? r[1] : V.doc.pages - 1; }
// where a part opens: its first page, or (going back) the last spread of it
function runStartPage(r, atEnd) {
  if (!atEnd) return r[0];
  const sp = spreadSize();
  return sp === 2 ? r[0] + 2 * Math.floor((r[1] - r[0]) / 2) : r[1];
}
async function runGo(idx, atEnd = false) {
  if (!RUN.on || RUN.busy) return;
  if (idx >= RUN.items.length) { toast(RUN.kind === 'study' ? 'That was the last passage. Well practised!' : 'That is the end of the set.', 2200); return; }
  if (idx < 0) { toast(RUN.kind === 'study' ? 'This is the first passage.' : 'This is the start of the set.', 1600); return; }
  const it = RUN.items[idx];
  RUN.busy = true;
  try {
    const sameScore = V.score && V.score.id === it.sid && !$('#score').hidden;
    RUN.idx = idx;
    if (!sameScore) {
      const sc = scores.find((s) => s.id === it.sid) || await db.get('scores', it.sid).catch(() => null);
      if (!sc) {
        toast('A score in this ' + (RUN.kind === 'study' ? 'session' : 'set') + ' is not in your library any more. It is skipped.', 2400);
        RUN.busy = false; RUN.idx = idx; return runGo(idx + (atEnd ? -1 : 1), atEnd);
      }
      // leave the score on show tidily (as going back to the library does), without going home
      step0(() => finishTextBox()); step0(() => finishText(true)); step0(() => clearSelection());
      if (V.inking) step0(() => setInking(false));
      if (V.score) { V.score.lastPage = V.page; db.put('scores', V.score).catch(() => {}); }
      if (V.score) step0(() => freePages());
      await openScore(it.sid, { page: () => { const r = runRange(); return r ? runStartPage(r, atEnd) : 0; } });
      if (!V.score || V.score.id !== it.sid) return;   // something else was opened meanwhile
    } else {
      const r = runRange();
      if (r) { Z.s = 1; Z.x = 0; Z.y = 0; goTo(runStartPage(r, atEnd)); }
    }
    runShow(!sameScore);
    if (it.orig !== undefined) runFlashPassage(it);
    // the next part, when it is in another score: that score opened and its first pages drawn now,
    // quietly, so going on to it is quick
    prewarmRun(RUN.items[idx + 1]);
    // the next part, when it is in this score, is drawn ahead too
    const nx = RUN.items[idx + 1];
    if (nx && V.doc && V.score && nx.sid === V.score.id) {
      const k = nx.orig !== undefined ? mappedOf(nx.orig) : clamp(nx.a - 1, 0, V.doc.pages - 1);
      // (as the next turn: the part on show is often a single page, so this is the very next page)
      if (k >= 0) { const ids = [k]; pageBox(ids).forEach((b) => renderPage(k, innerW(k, b[0]), innerH(k, b[1]), 1, 1)); }
    }
  } finally { RUN.busy = false; }
}
let RUNPRE = null;   // { sid, p: Promise<{ score, file, base }> }
function dropRunPre() { const r = RUNPRE; RUNPRE = null; if (r) r.open.then((x) => { if (x && x.base && x.base !== V.base) try { x.base.destroy(); } catch {} }, () => {}); }
function prewarmRun(it) {
  if (!it || !RUN.on || (V.score && it.sid === V.score.id)) return;
  if (RUNPRE && RUNPRE.sid === it.sid) return;
  dropRunPre();
  const open = (async () => {
    await new Promise((r) => setTimeout(r, 250));   // (after the part now on show is drawn)
    const score = await db.get('scores', it.sid); if (!score) return null;
    const file = await db.get('files', score.fileId); if (!file) return null;
    scoreFile(score, file);
    return { score, file, base: await openDocument(file, score.sizes) };
  })();
  const p = (async () => {
    const o = await open; if (!o) return null;
    const { score, base } = o;
    // its first pages at the size they will be shown: drawn into the kept pictures
    const keep = { doc: V.doc, score: V.score, crop: V.crop, spread: V.spread };
    let jobs = [];
    const doc = mapDoc(base, score.pageMap, score.cuts, score.glue);
    try {
      V.doc = doc; V.score = score; V.crop = score.trim && score.trimBox ? score.trimBox : null; V.spread = spreadSize();
      const k = it.orig !== undefined ? Math.max(0, mappedOf(it.orig)) : clamp(it.a - 1, 0, doc.pages - 1);
      const end = it.orig !== undefined ? k : clamp((it.b || it.a) - 1, k, doc.pages - 1);
      const ids = [k]; if (V.spread === 2 && k + 1 <= Math.max(end, k + 1) && k + 1 < doc.pages) ids.push(k + 1);
      jobs = pageBox(ids).map((b, j) => ({ i: ids[j], ...pageKey(ids[j], innerW(ids[j], b[0]), innerH(ids[j], b[1])) }));
    } finally { Object.assign(V, keep); }
    for (const j of jobs) {
      // (stopped for the next page of the part on show, it is asked for again a moment later)
      for (let tries = 0; tries < 20; tries++) {
        if (!RUNPRE || RUNPRE.sid !== it.sid) break;
        const c = document.createElement('canvas');
        let stopped = false;
        const r = runRange(), nearEnd = !r || V.page + (V.spread === 2 ? 1 : 0) >= r[1];
        await rqAdd(nearEnd ? 1 : 2, (ctl) => doc.render(j.i, c, j.pw, j.ph, { ctl, keep: true }).finally(() => { stopped = ctl.aborted; }), () => !RUN.on, !nearEnd).catch(() => { stopped = true; });
        c.width = c.height = 0;
        if (!stopped) break;
        await new Promise((res) => setTimeout(res, 400));
      }
    }
    return o;
  })();
  RUNPRE = { sid: it.sid, open, p };
}
function startRun(kind, name, items) {
  if (!items.length) return;
  RUN.on = true; RUN.kind = kind; RUN.name = name; RUN.items = items; RUN.idx = 0; RUN.busy = false;
  hidePanel();
  runGo(0);
}
function endRun() {
  dropRunPre();
  RUN.on = false; RUN.items = []; RUN.idx = 0;
  $('#runPill').hidden = true;
  if (V.doc && !$('#score').hidden) layout();
}
const PRIO_LABEL = ['Skip', 'Low', 'Medium', 'High'];
function runShow(newScore) {
  const it = runItem(); if (!it) { $('#runPill').hidden = true; return; }
  const sc = scores.find((s) => s.id === it.sid) || V.score;
  const title = sc ? sc.title : '';
  const n = RUN.items.length;
  $('#runPill').hidden = false;
  $('#runPill').dataset.kind = RUN.kind;
  if (RUN.kind === 'study') {
    $('#runTitle').textContent = `${it.name}`;
    $('#runSub').textContent = `Passage ${RUN.idx + 1} of ${n} · ${PRIO_LABEL[it.prio] || ''} · ${title}`;
  } else {
    const r = runRange();
    const pg = r ? (r[0] === r[1] ? `page ${r[0] + 1}` : `pages ${r[0] + 1}–${r[1] + 1}`) : '';
    $('#runTitle').textContent = RUN.name;
    $('#runSub').textContent = `${RUN.idx + 1} of ${n} · ${title}${pg ? ' · ' + pg : ''}`;
  }
  $('#runPrev').disabled = RUN.idx === 0; $('#runNext').disabled = RUN.idx >= n - 1;
  if (newScore && RUN.idx > 0) toast(RUN.kind === 'study' ? `${it.name} · ${title}` : `${title}`, 1600);
}
// the passage being practised is pointed out for a moment when its page opens
function runFlashPassage(it) {
  setTimeout(async () => {
    if (runItem() !== it || !V.score) return;
    const items = await loadItems(V.score.id + ':' + it.orig).catch(() => []);
    const s = items.find((x) => x.t === 'passage' && x.pid === it.pid); if (!s) return;
    const pgEl = [...stage.querySelectorAll('.pg')][0]; if (!pgEl) return;
    const inner = pgEl.querySelector('.pgi'); if (!inner) return;
    const f = el('div', 'pass-flash');
    const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), y0 = Math.min(s.y0, s.y1), y1 = Math.max(s.y0, s.y1);
    f.style.left = x0 * 100 + '%'; f.style.top = y0 * 100 + '%'; f.style.width = (x1 - x0) * 100 + '%'; f.style.height = (y1 - y0) * 100 + '%';
    inner.append(f); setTimeout(() => f.remove(), 1600);
  }, 120);
}
$('#runPrev').addEventListener('click', () => runGo(RUN.idx - 1));
$('#runNext').addEventListener('click', () => runGo(RUN.idx + 1));
$('#runEnd').addEventListener('click', () => { const k = RUN.kind; endRun(); toast(k === 'study' ? 'Practice session ended.' : 'Set ended. You can turn through this score as usual.', 1800); });
window.__run = { RUN, runGo, runRange, startRun, endRun };

// ---------- Sets in the library ----------
const SETS = { list: [], edit: null, pick: null };
async function loadSets() { SETS.list = (await getSetting('sets', [])) || []; }
const saveSets = () => setSetting('sets', SETS.list);
function coverOf(sid) {
  const s = scores.find((x) => x.id === sid); if (!s || !s.thumb) return '';
  return `url(${thumbURL(s)})`;
}
const partPages = (it) => (it.a === it.b ? `Page ${it.a}` : `Pages ${it.a}–${it.b}`);
function renderSets() {
  const ul = $('#setList'); ul.textContent = '';
  $('#setEmpty').hidden = SETS.list.length > 0;
  for (const set of SETS.list) {
    const li = el('li', 'set-card');
    const covers = el('div', 'set-covers');
    [...new Set(set.items.map((i) => i.sid))].slice(0, 3).forEach((sid, k) => { const c = el('i'); c.style.backgroundImage = coverOf(sid); c.style.setProperty('--k', k); covers.append(c); });
    const txt = el('button', 'set-txt');
    const pages = set.items.reduce((n, i) => n + (i.b - i.a + 1), 0);
    const names = set.items.map((i) => (scores.find((s) => s.id === i.sid) || {}).title).filter(Boolean);
    txt.append(el('strong', '', set.name), el('span', 'hint', `${set.items.length} part${set.items.length === 1 ? '' : 's'} · ${pages} page${pages === 1 ? '' : 's'}`), el('span', 'set-names', [...new Set(names)].join(' · ')));
    txt.addEventListener('click', () => openSetEditor(set));
    const play = el('button', 'btn primary small'); play.append(icon('i-play'), el('span', '', 'Play'));
    play.disabled = !set.items.length;
    play.addEventListener('click', () => playSet(set));
    li.append(covers, txt, play);
    ul.append(li);
  }
}
function playSet(set) {
  const items = set.items.filter((i) => scores.some((s) => s.id === i.sid)).map((i) => ({ ...i }));
  if (!items.length) { toast('The scores in this set are no longer in your library.'); return; }
  startRun('set', set.name, items);
}
$('#setNew').addEventListener('click', () => {
  const set = { id: uid(), name: `Set ${SETS.list.length + 1}`, items: [], created: Date.now() };
  SETS.list.push(set); saveSets();
  openSetEditor(set, true);
});
function openSetEditor(set, fresh) {
  SETS.edit = set;
  $('#setEditTitle').textContent = fresh ? 'New set' : 'Set';
  $('#setName').value = set.name;
  renderSetParts();
  showPanel('setedit');
  if (fresh) setTimeout(() => { $('#setName').select(); }, 80);
}
function renderSetParts() {
  const set = SETS.edit; if (!set) return;
  const ol = $('#setParts'); ol.textContent = '';
  $('#setPartsEmpty').hidden = set.items.length > 0;
  $('#setPlay').disabled = !set.items.length;
  set.items.forEach((it, i) => {
    const sc = scores.find((s) => s.id === it.sid);
    const li = el('li', 'set-part' + (sc ? '' : ' missing'));
    const th = el('i', 'sp-cover'); th.style.backgroundImage = coverOf(it.sid);
    const txt = el('button', 'sp-txt');
    txt.append(el('strong', '', sc ? sc.title : 'Score not in the library'), el('span', '', partPages(it) + (sc && it.a === 1 && it.b >= (sc.pages || 0) ? ' (whole score)' : '')));
    txt.addEventListener('click', () => { if (sc) openSetPicker(i); });
    const up = el('button', 'icon-btn small'); up.append(icon('i-up')); up.disabled = i === 0; up.setAttribute('aria-label', 'Earlier');
    const dn = el('button', 'icon-btn small'); dn.append(icon('i-down')); dn.disabled = i === set.items.length - 1; dn.setAttribute('aria-label', 'Later');
    const rm = el('button', 'icon-btn small'); rm.append(icon('i-close')); rm.setAttribute('aria-label', 'Remove');
    up.addEventListener('click', () => { [set.items[i - 1], set.items[i]] = [set.items[i], set.items[i - 1]]; saveSets(); renderSetParts(); });
    dn.addEventListener('click', () => { [set.items[i + 1], set.items[i]] = [set.items[i], set.items[i + 1]]; saveSets(); renderSetParts(); });
    rm.addEventListener('click', () => { set.items.splice(i, 1); saveSets(); renderSetParts(); });
    li.append(el('span', 'sp-num num', String(i + 1)), th, txt, up, dn, rm);
    ol.append(li);
  });
}
$('#setName').addEventListener('input', () => { if (!SETS.edit) return; SETS.edit.name = $('#setName').value.trim() || 'Set'; saveSets(); });
function closeSetEditor() {
  const set = SETS.edit; SETS.edit = null;
  if (set && !set.items.length && !$('#setName').value.trim().replace(/^Set \d+$/, '')) { SETS.list = SETS.list.filter((s) => s !== set); saveSets(); }
  hidePanel(); renderSets();
}
$('#setEditClose').addEventListener('click', closeSetEditor);
$('#setAdd').addEventListener('click', () => openSetPicker(-1));
$('#setPlay').addEventListener('click', () => { const set = SETS.edit; if (!set) return; SETS.edit = null; renderSets(); playSet(set); });
$('#setDelete').addEventListener('click', async () => {
  const set = SETS.edit; if (!set) return;
  if (!(await ask(`Delete “${set.name}”?`, { ok: 'Delete', danger: true, sub: 'The scores themselves stay in your library.' }))) return;
  SETS.list = SETS.list.filter((s) => s !== set); saveSets(); SETS.edit = null; hidePanel(); renderSets();
});

// choosing music for a set: a score, then its pages from small pictures of them
function openSetPicker(partIdx) {
  SETS.pick = { part: partIdx, sid: null, doc: null, base: null, a: 0, b: 0, taps: 0, token: 0 };
  $('#spScores').hidden = false; $('#spPages').hidden = true; $('#spTitle').textContent = partIdx >= 0 ? 'Change pages' : 'Add music';
  $('#spSearch').value = '';
  showPanel('setpick');
  if (partIdx >= 0) { const it = SETS.edit.items[partIdx]; spOpenScore(it.sid, it.a - 1, it.b - 1); return; }
  spRenderScores();
}
function spRenderScores() {
  const q = $('#spSearch').value.trim().toLowerCase();
  const ul = $('#spList'); ul.textContent = '';
  const list = scores.filter((s) => s.kind !== 'comp' && (!q || (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q)))
    .sort((a, b) => (b.opened || b.added) - (a.opened || a.added));
  for (const s of list) {
    const b = el('button', 'sp-score');
    const th = el('i', 'sp-cover'); th.style.backgroundImage = coverOf(s.id);
    const t = el('span', 'sp-txt'); t.append(el('strong', '', s.title), el('span', '', (s.composer ? s.composer + ' · ' : '') + s.pages + (s.pages === 1 ? ' page' : ' pages')));
    b.append(th, t);
    b.addEventListener('click', () => spOpenScore(s.id));
    ul.append(b);
  }
  if (!list.length) ul.append(el('p', 'hint center', q ? 'No score matches.' : 'Your library is empty.'));
}
$('#spSearch').addEventListener('input', spRenderScores);
function spFree() {
  const P = SETS.pick; if (!P) return;
  P.token++;
  if (P.base && P.base !== V.base) try { P.base.destroy(); } catch {}
  P.base = null; P.doc = null;
  for (const c of $('#spStrip').querySelectorAll('canvas')) { c.width = 0; c.height = 0; }
  $('#spStrip').textContent = '';
}
async function spOpenScore(sid, a, b) {
  const P = SETS.pick; spFree();
  const score = scores.find((s) => s.id === sid) || await db.get('scores', sid);
  const file = score && await db.get('files', score.fileId);
  if (!file) { toast('This score’s file is missing.'); return; }
  scoreFile(score, file);
  const token = ++P.token;
  let base, doc;
  // the score on show is used as it is; another one is opened just for its pictures
  if (V.score && V.score.id === sid && V.base) { base = V.base; doc = V.doc; }
  else {
    try { base = await openDocument(file); } catch { toast('The score could not be opened.'); return; }
    if (token !== P.token) { try { base.destroy(); } catch {} return; }
    doc = mapDoc(base, score.pageMap, score.cuts, score.glue);
  }
  Object.assign(P, { sid, base, doc, a: a ?? 0, b: b ?? doc.pages - 1, taps: a === undefined ? 0 : 2, title: score.title });
  if (a === undefined) { P.a = 0; P.b = doc.pages - 1; }
  // any pages can be chosen (not only one run of pages): a new part starts with none, a part
  // being changed with its own pages
  P.sel = new Set(); if (a !== undefined) for (let k = a; k <= (b ?? a); k++) P.sel.add(k);
  $('#spScores').hidden = true; $('#spPages').hidden = false; $('#spTitle').textContent = score.title;
  const strip = $('#spStrip');
  const cells = [];
  for (let i = 0; i < doc.pages; i++) {
    const cell = el('button', 'sp-page');
    const [pw, ph] = doc.sizes[i] || [595, 842];
    const cv = el('canvas'); cv.width = 120; cv.height = Math.round(120 * ph / pw);
    cell.append(cv, el('span', 'num', String(i + 1)));
    // tap: this page in or out; hold: every page from the last one chosen to this one
    let holdT = 0, held = false;
    cell.addEventListener('pointerdown', () => { held = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; spRange(i); }, 450); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cell.addEventListener(ev, () => clearTimeout(holdT));
    cell.addEventListener('click', () => { if (held) { held = false; return; } spTap(i); });
    strip.append(cell); cells.push(cv);
  }
  spMark();
  // the pages chosen are scrolled into view
  setTimeout(() => { const c = strip.children[P.a]; if (c) c.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 30);
  for (let i = 0; i < doc.pages; i++) {
    if (token !== P.token) return;
    await doc.render(i, cells[i], cells[i].width, cells[i].height).catch(() => {});
  }
}
function spTap(i) {
  const P = SETS.pick;
  if (P.sel.has(i)) P.sel.delete(i); else { P.sel.add(i); P.last = i; }
  spMark();
}
function spRange(i) {
  const P = SETS.pick;
  const from = P.last !== undefined ? P.last : i;
  for (let k = Math.min(from, i); k <= Math.max(from, i); k++) P.sel.add(k);
  P.last = i; spMark();
}
// the chosen pages as runs of pages one after another: [[a, b], ...] (0-based)
function spRuns(sel) {
  const pages = [...sel].sort((x, y) => x - y), runs = [];
  for (const p of pages) { const r = runs[runs.length - 1]; if (r && p === r[1] + 1) r[1] = p; else runs.push([p, p]); }
  return runs;
}
function spMark() {
  const P = SETS.pick;
  const runs = spRuns(P.sel);
  [...$('#spStrip').children].forEach((c, i) => { c.classList.toggle('on', P.sel.has(i)); c.classList.toggle('edge', runs.some((r) => r[0] === i || r[1] === i)); });
  const n = P.sel.size;
  const txt = runs.map((r) => (r[0] === r[1] ? `${r[0] + 1}` : `${r[0] + 1}–${r[1] + 1}`)).join(', ');
  $('#spHint').textContent = n ? `Chosen: page${n === 1 ? '' : 's'} ${txt}. Tap a page to add or take it out; hold one to choose all pages up to it.` : 'Tap the pages you want (any of them). Hold a page to choose all the pages up to it.';
  $('#spOk').textContent = !n ? 'Choose pages' : (P.part >= 0 ? 'Use ' : 'Add ') + (n === 1 ? `page ${txt}` : `${n} pages`);
  $('#spOk').disabled = !n;
}
$('#spAll').addEventListener('click', () => { const P = SETS.pick; if (!P.doc) return; P.sel = new Set([...Array(P.doc.pages).keys()]); spMark(); });
$('#spOk').addEventListener('click', () => {
  const P = SETS.pick, set = SETS.edit; if (!P || !P.doc || !set || !P.sel.size) return;
  // each run of pages becomes a part, in page order
  const parts = spRuns(P.sel).map(([a, b]) => ({ sid: P.sid, a: a + 1, b: b + 1 }));
  if (P.part >= 0) set.items.splice(P.part, 1, ...parts); else set.items.push(...parts);
  saveSets(); spFree(); SETS.pick = null;
  renderSetParts(); showPanel('setedit');
});
$('#spBack').addEventListener('click', () => {
  const P = SETS.pick;
  if (P && !$('#spPages').hidden && P.part < 0) { spFree(); $('#spScores').hidden = false; $('#spPages').hidden = true; $('#spTitle').textContent = 'Add music'; spRenderScores(); return; }
  spFree(); SETS.pick = null; renderSetParts(); showPanel('setedit');
});
$('#spClose').addEventListener('click', () => { spFree(); SETS.pick = null; renderSetParts(); showPanel('setedit'); });

// ---------- practice session with passages ----------
function studyGroups() {
  const order = new Map(scores.map((s, i) => [s.id, i]));
  return allPassages().filter((g) => order.has(g.scoreId))
    .sort((a, b) => (V.score && a.scoreId === V.score.id ? -1 : V.score && b.scoreId === V.score.id ? 1 : 0) || (scores.find((s) => s.id === b.scoreId).opened || 0) - (scores.find((s) => s.id === a.scoreId).opened || 0));
}
function renderStudy() {
  const box = $('#studyList'); box.textContent = '';
  const groups = studyGroups();
  $('#studyEmpty').hidden = groups.length > 0; $('#studyOpts').hidden = !groups.length; $('#studyStart').hidden = !groups.length;
  S.studyOff = S.studyOff || {};
  for (const g of groups) {
    const sc = scores.find((s) => s.id === g.scoreId);
    const on = !S.studyOff[g.scoreId];
    const sec = el('section', 'study-score' + (on ? '' : ' off'));
    const head = el('label', 'study-head');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = on;
    cb.addEventListener('change', () => { if (cb.checked) delete S.studyOff[g.scoreId]; else S.studyOff[g.scoreId] = true; saveSettings(); renderStudy(); });
    const th = el('i', 'sp-cover'); th.style.backgroundImage = coverOf(g.scoreId);
    // the piece and its composer, each on its own line, cut short when long
    const nm = el('span', 'study-name'); nm.append(el('strong', '', sc.title)); if (sc.composer) nm.append(el('small', '', sc.composer));
    head.append(cb, th, nm, el('span', 'hint', `${g.list.length} passage${g.list.length === 1 ? '' : 's'}`));
    sec.append(head);
    const urgent = new Map(passMissed(g.list).filter((x) => !x.good).map((x) => [x.p.id, x.text]));
    for (const p of g.list) {
      const row = el('div', 'study-row');
      const dot = el('i', 'study-dot'); dot.style.background = (PASSAGE_KINDS[p.kind] || PASSAGE_KINDS.melodic).color;
      const t = el('div', 'study-txt');
      const last = p.log.length ? p.log[p.log.length - 1].bpm : null;
      t.append(el('strong', '', p.name), el('span', 'hint', (last ? `${last} of ${p.target} bpm` : `Target ${p.target} bpm`) + (urgent.has(p.id) ? ' · ' + urgent.get(p.id) : '') + ` · page ${parseInt(p.key.split(':').pop(), 10) + 1}`));
      const seg = el('div', 'seg study-prio');
      const pr = priorityOf(p);
      [3, 2, 1, 0].forEach((v) => {
        const b = el('button', (pr === v ? 'on' : '') + (v === 0 ? ' skip' : ''), PRIO_LABEL[v]);
        b.addEventListener('click', () => { setPriority(g.scoreId, p.id, v); renderStudy(); });
        seg.append(b);
      });
      row.append(dot, t, seg);
      if (pr === 0) row.classList.add('skipped');
      sec.append(row);
    }
    box.append(sec);
  }
  const n = studyItems().length;
  $('#studyStart').disabled = !n;
  $('#studyStart').querySelector('span').textContent = n ? `Start · ${n} passage${n === 1 ? '' : 's'}` : 'Choose some passages';
  $('#studyTwice').checked = !!S.studyTwice;
}
// highest priority first; within a priority, what was practised least comes first, then page order
function studyItems() {
  const out = [];
  for (const g of studyGroups()) {
    if (S.studyOff && S.studyOff[g.scoreId]) continue;
    for (const p of g.list) {
      const prio = priorityOf(p); if (!prio) continue;
      out.push({ sid: g.scoreId, orig: parseInt(p.key.split(':').pop(), 10), pid: p.id, name: p.name, prio, prog: passProgress(p), created: p.created });
    }
  }
  out.sort((a, b) => b.prio - a.prio || a.prog - b.prog || (a.sid === b.sid ? a.orig - b.orig : 0) || a.created - b.created);
  if (S.studyTwice) out.push(...out.filter((x) => x.prio === 3).map((x) => ({ ...x })));
  return out;
}
$('#studyTwice').addEventListener('change', (e) => { S.studyTwice = e.target.checked; saveSettings(); renderStudy(); });
$('#studyStart').addEventListener('click', () => { const items = studyItems(); if (items.length) startRun('study', 'Practice session', items); });

// ---------- tools on the home screen, and the first time Stand opens ----------
// writing scores needs the iPad's big screen and the Pencil: on the iPhone, Compose is not offered
// on the iPhone there are no scores, so no Passages either
const TOOLS = [['tuner', 'Tuner'], ['harmonics', 'Harmonics'], ['drone', 'Drone'], ['metronome', 'Metronome'], ['scales', 'Scales'], ['study', 'Passages'], ['reps', 'Repetitions'], ['pomodoro', 'Practice timer'], ['record', 'Record'], ['takes', 'Recordings'], ['compose', 'Compose']].filter(([k]) => !((k === 'compose' || k === 'study') && (/iPhone|iPod/.test(navigator.userAgent) || (Math.min(screen.width, screen.height) < 500 && matchMedia('(pointer: coarse)').matches))));
// a sensible start for each instrument (everything else can be switched on)
function toolsFor(inst) {
  const strings = !!(INSTRUMENTS[inst] && INSTRUMENTS[inst].fifths);
  const all = new Set(TOOLS.map(([k]) => k));
  if (!strings) all.delete('harmonics');
  if (inst === 'piano') { all.delete('drone'); all.delete('tuner'); }
  return [...all];
}
function shownTools() {
  // Passages came later: shown to people who had already chosen their tools too
  if (Array.isArray(S.tools) && !S.toolsStudy) { S.toolsStudy = true; if (!S.tools.includes('study')) S.tools.push('study'); saveSettings(); }
  return Array.isArray(S.tools) ? S.tools : TOOLS.map(([k]) => k);
}
function applyTools() {
  const on = new Set(shownTools());
  $$('.tile[data-tile]').forEach((t) => t.classList.toggle('off', !on.has(t.dataset.tile)));
  // each group as wide as its tools
  $$('.tgroup').forEach((g) => { const n = g.querySelectorAll('.tile[data-tile]:not(.off)').length; g.hidden = !n; g.style.setProperty('--n', n); });
  $('#ipadCard').classList.toggle('off', S.ipadCard === false);
}
function toolChips(box, getOn, setOn) {
  box.textContent = '';
  for (const [k, label] of TOOLS) {
    const b = el('button', getOn().includes(k) ? 'on' : '', label);
    b.addEventListener('click', () => { const cur = new Set(getOn()); if (cur.has(k)) cur.delete(k); else cur.add(k); setOn(TOOLS.map(([x]) => x).filter((x) => cur.has(x))); b.classList.toggle('on', cur.has(k)); });
    box.append(b);
  }
  if (PHONE) {
    const b = el('button', S.ipadCard === false ? '' : 'on', 'iPad practice');
    b.addEventListener('click', () => { S.ipadCard = S.ipadCard === false; saveSettings(); applyTools(); b.classList.toggle('on', S.ipadCard !== false); });
    box.append(b);
  }
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="app"]')) toolChips($('#appTools'), shownTools, (v) => { S.tools = v; saveSettings(); applyTools(); }); });
// "Show the tour again": plays the main tour now, and clears the tool tours so each one
// appears the next time its tool is opened (metronome tour when you open the metronome, and so on)
$('#tourAgain').addEventListener('click', () => {
  S.sectionTours = {}; saveSettings();
  hidePanel(); setTimeout(() => startTour({ phone: PHONE }), 200);
});
function showWelcome() {
  const w = $('#welcome'); w.hidden = false;
  const sel = $('#welInst'); sel.textContent = '';
  for (const [k, v] of Object.entries(INSTRUMENTS)) { const o = el('option', '', v.label); o.value = k; sel.append(o); }
  sel.value = S.instrument;
  let chosen = toolsFor(S.instrument), touched = false;
  const draw = () => toolChips($('#welTools'), () => chosen, (v) => { chosen = v; touched = true; });
  sel.onchange = () => { if (!touched) chosen = toolsFor(sel.value); draw(); };
  draw();
  const done = () => { setInstrument(sel.value); S.tools = chosen; S.welcomed = true; saveSettings(); applyTools(); w.hidden = true; };
  $('#welGo').onclick = () => { done(); if (!S.toured) setTimeout(() => startTour({ onDone: () => { S.toured = true; saveSettings(); } }), 250); };
  $('#welRestore').onclick = () => { done(); showPanel('backup'); $('#bkFiles').hidden = true; renderBackup(); };
}

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  await loadSettings();
  await practice.load();
  setTimeout(syncReminders, 1500);
  await loadPassages();
  await loadSets().catch(() => {});
  await loadFolders();
  applyAppearance();
  document.body.classList.add('at-home');
  player.room = S.room; player.wet = S.wet; player.autoLevel = S.autoLevel;
  applyMetroSettings(S.metro || { bpm: 80, meter: '4' });
  if (S.drone) {
    const d = S.drone; Object.assign(drone, { pc: d.pc ?? 9, octave: d.octave ?? 2, volume: d.volume ?? 0.5, lowOct: !!d.lowOct, speed: d.speed || 'medium' });
    // sounds that are no longer offered become the nearest one kept (Flute, Tanpura → Bow)
    drone.sound = DRONE_VOICES[d.sound] ? d.sound : d.sound === 'organ' ? 'organ' : d.sound === 'pure' || d.sound === 'soft' ? 'pure' : 'bow';
    drone.chord = d.chord && DRONE_CHORDS[d.chord] ? d.chord : d.third ? (d.minor ? 'minor' : 'major') : d.fifth === false ? 'root' : 'fifth';
  }
  if (S.ink) {
    const k = S.ink;
    INK.finger = !!k.finger; INK.stamp = k.stamp || 'p'; INK.tool = k.tool || 'pen'; INK.erase = k.erase || 'smart';
    if (Array.isArray(k.slots) && k.slots.length === 2) INK.slots = k.slots; else if (k.pen && k.pen.c) INK.slots = [k.pen.c, COLORS[2]];
    INK.slot = k.slot === 1 ? 1 : 0;
    if (PEN_KINDS.some((x) => x.k === k.penKind)) INK.penKind = k.penKind; if (Array.isArray(k.recent)) INK.recent = k.recent.slice(0, 6);
    if (k.kinds) INK.kinds = k.kinds; if (k.eraser) Object.assign(INK.eraser, k.eraser); if (k.tape) Object.assign(INK.tape, k.tape); INK.shapeFill = !!k.shapeFill; INK.steady = clamp(+k.steady || 0, 0, 10);
    if (Array.isArray(k.hlSlots) && k.hlSlots.length === 2) INK.hlSlots = k.hlSlots; INK.hlSlot = k.hlSlot === 1 ? 1 : 0;
    Object.assign(INK.pen, { size: (k.pen && k.pen.size) || 3, a: (k.pen && k.pen.a) || 1 }); Object.assign(INK.hl, k.hl || {}); Object.assign(INK.stampStyle, k.stampStyle || {}); Object.assign(INK.white, k.white || {});
  }
  syncInkBar();
  $('#autoTurn').value = String(S.autoTurn || 0); $('#audioSpeaker').checked = !!S.audioSpeaker; sendAudio(); $('#penOpens').checked = S.penOpens !== false;
  if (S.scale) { Object.assign(scale, S.scale); if (!S.scale.bpm) scale.bpm = metro.bpm || 60; if (!['piano', 'organ', 'bow', 'pure'].includes(scale.sound)) scale.sound = scale.sound === 'soft' ? 'pure' : scale.sound === 'strings' || scale.sound === 'flute' ? 'bow' : 'piano'; } else scale.octave = DEFAULT_OCT[S.instrument] ?? 3;
  fillInstrumentSelects(); fillKeySelects(); fillHarmonicSelects();
  $('#pureFifths').checked = S.pureFifths;
  $('#countIn').checked = S.countIn; $('#clickWhileRec').checked = S.clickWhileRec;
  if (PHONE && S.cam === 'iphone') S.cam = 'user';
  $$('#camSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cam === S.cam));
  updateTunerSetup(); syncDrone(); syncPlayerControls(); syncScaleUI();
  setHarmonicNote(INSTRUMENTS[S.instrument].strings ? INSTRUMENTS[S.instrument].strings[0] : 48);
  renderExamples();
  $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sort === S.sort));
  initStudio({ toast, pickRegion, shareBlob, room: () => S.room, wet: () => S.wet, onSaved: () => refreshTakes() });
  initCompose({
    toast, showPanel, hidePanel, shareBlob, refreshLibrary, pickRegion, recognise: recogniseBest,
    workStarted: (name) => sectionTour(name, { force: true }),
    async addPdfToLibrary(data, name, meta) { const sc = await addPdf(data, name, meta); await refreshLibrary(); return sc; },
  });
  await refreshLibrary();
  applyTools();
  // the first time: a short welcome (people who already have scores have been here before)
  // a preview left open when Stand was closed is kept (nothing is ever lost by surprise)
  for (const sc of scores.filter((x) => x.preview)) { delete sc.preview; db.put('scores', sc).catch(() => {}); }
  if (!S.welcomed) { if (scores.length) { S.welcomed = true; saveSettings(); } else if (!PHONE) showWelcome(); }
  if (PHONE && !S.phoneToured && !window.__noTour) setTimeout(() => startTour({ phone: true, onDone: () => { S.phoneToured = true; saveSettings(); } }), 700);
  renderGoal(); syncWinkUI(); syncTapUI(); initPracticeSync();
  setHomeTab(scores.length ? (S.hometab || 'mine') : 'mine');
  // started again by the app after the page stopped (memory): back to the score and page
  if (/[?&]recover=1/.test(location.search)) { try { history.replaceState(null, '', location.pathname); } catch {} setTimeout(() => reopenPlace().catch(() => {}), 300); }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  // the most searched composers' works, loaded quietly so the first searches are instant
  setTimeout(() => { if (navigator.onLine === false || PHONE) return; loadComposers().then((list) => warmUp([...list].sort((a, b) => b.p - a.p).slice(0, 10).map((c) => c.c))).catch(() => {}); }, 5000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// =====================================================================
// Practice timer
// =====================================================================
function drawPomo() {
  const p = P.pomo, idle = p.phase === 'idle';
  const word = p.phase === 'rest' ? 'Rest' : 'Play';
  const setText = (sel, t) => { const n = $(sel); if (n.textContent !== t) n.textContent = t; };
  setText('#pomoTime', P.fmt(idle ? p.work * 60000 : P.remaining()));
  setText('#pomoPhase', idle ? 'Ready' : `${word} · round ${p.round} of ${p.rounds}`);
  setText('#pomoPlayBtn span', idle ? 'Start' : 'Resume');
  $('#pomoPlayBtn').hidden = p.running;
  $('#pomoPauseBtn').hidden = !p.running;
  $('#pomoStopBtn').hidden = idle;
  $('#pomoPill').hidden = idle;
  setText('#pomoPillTime', P.fmt(P.remaining()));
  setText('#pomoPillPhase', word);
  const pillBtn = $('#pomoPillToggle');
  const icon = p.running ? 'i-pause' : 'i-play';
  if (pillBtn.dataset.icon !== icon) { pillBtn.dataset.icon = icon; pillBtn.innerHTML = `<svg><use href="#${icon}"/></svg>`; }
  pillBtn.setAttribute('aria-label', p.running ? 'Pause' : 'Resume');
  $$('#pomoPresets button').forEach((b) => b.classList.toggle('on', b.dataset.p === p.preset));
  $('#pomoCustom').hidden = p.preset !== 'custom';
  $$('#panel-pomodoro .pomo-set, #pomoPresets button').forEach((n) => { n.disabled = !idle; });
  setText('#pomoNote', p.preset === 'custom' ? 'Your own times. Play time counts in your practice tracker.' : P.PRESETS[p.preset].text + ' Play time counts in your practice tracker.');
  if (document.activeElement !== $('#pomoWork')) $('#pomoWork').value = p.work;
  if (document.activeElement !== $('#pomoRest')) $('#pomoRest').value = p.rest;
  $('#pomoRounds').value = String(p.rounds);
  $('#pomoChime').checked = p.chime;
}
function pomoChanged() { P.pomoSave(); drawPomo(); }
$('#pomoPlayBtn').addEventListener('click', () => P.start());
$('#pomoPauseBtn').addEventListener('click', () => P.pause());
$('#pomoStopBtn').addEventListener('click', () => P.stop());
$('#pomoPillToggle').addEventListener('click', () => P.toggle());
$$('#pomoPresets button').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.p, p = P.pomo;
  if (k !== 'custom') { p.work = P.PRESETS[k].work; p.rest = P.PRESETS[k].rest; }
  p.preset = k; pomoChanged();
}));
function pomoField(sel, key, min, max) {
  $(sel).addEventListener('change', (e) => {
    const v = Math.round(+e.target.value);
    P.pomo[key] = Math.min(max, Math.max(min, Number.isFinite(v) ? v : P.pomo[key]));
    P.pomo.preset = 'custom'; pomoChanged();
  });
}
pomoField('#pomoWork', 'work', 1, 180);
pomoField('#pomoRest', 'rest', 1, 60);
$('#pomoRounds').addEventListener('change', (e) => { P.pomo.rounds = +e.target.value; pomoChanged(); });
$('#pomoChime').addEventListener('change', (e) => { P.pomo.chime = e.target.checked; pomoChanged(); });
P.initPomodoro({ toast, draw: drawPomo });

// =====================================================================
// Writing bar for typed words
// =====================================================================
// Words are typed with the keyboard, or written with the Pencil (iPad Scribble turns handwriting into
// typed letters in the box). They start where you tapped and stay clear of the notes.
const TXT = { size: null, bold: false, bg: false };
const txtDefault = () => inkSize('stamp', INK.stampStyle.size) * 0.9;
const txtSize = () => TXT.size ?? txtDefault();
function syncTextBar() {
  $('#txtBold').classList.toggle('on', TXT.bold);
  $('#txtPaper').classList.toggle('on', TXT.bg);
}
function textBarChange(fn) {
  const cur = textEdit && textEdit.item;
  if (cur) {
    if (fn.size) cur.s = clamp01(cur.s * fn.size, 0.004, 0.09);
    if (fn.bold !== undefined) cur.b = fn.bold ? 1 : 0;
    if (fn.bg !== undefined) cur.bg = fn.bg ? 1 : 0;
    const r = textEdit.entry.inner.getBoundingClientRect();
    textEdit.input.style.font = textFont(cur.s * pageSize(r)[0], cur.b);
    textEdit.input.dataset.paper = cur.bg ? '1' : '';
    textEdit.input.style.background = cur.bg ? 'rgba(255,255,255,0.95)' : '';
  }
  if (fn.size) TXT.size = clamp01(txtSize() * fn.size, 0.004, 0.09);
  if (fn.bold !== undefined) TXT.bold = fn.bold;
  if (fn.bg !== undefined) TXT.bg = fn.bg;
  syncTextBar();
  setSetting('textBar', { size: TXT.size, bold: TXT.bold, bg: TXT.bg });
  if (textEdit) { textEdit.entry.layer.redraw(); textEdit.input.focus(); }
}
const clamp01 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
$('#txtSmaller').addEventListener('click', () => textBarChange({ size: 1 / 1.2 }));
$('#txtBigger').addEventListener('click', () => textBarChange({ size: 1.2 }));
$('#txtBold').addEventListener('click', () => textBarChange({ bold: !TXT.bold }));
$('#txtPaper').addEventListener('click', () => textBarChange({ bg: !TXT.bg }));
$('#txtDone').addEventListener('click', () => { if (textEdit) finishText(); else { INK.tool = 'pen'; syncInkBar(); persistInk(); } });
// Pressing the bar must not take the typing focus away from the words.
// Tapping the bar keeps the words in focus, so the writing is not finished by the tap.
let barTouch = false;
$('#textBar').addEventListener('pointerdown', (e) => { e.preventDefault(); barTouch = true; if (textEdit) textEdit.input.focus(); });
window.addEventListener('pointerup', () => { setTimeout(() => { barTouch = false; }, 350); });
(async () => {
  const saved = await getSetting('textBar', null);
  if (saved) { TXT.size = saved.size || null; TXT.bold = !!saved.bold; TXT.bg = !!saved.bg; }
  syncTextBar();
})();

// =====================================================================
// Words written with the Pencil
// =====================================================================
// In the Text tool, a stroke written with the Pencil is read as a word (on the iPad, by the system's
// text recognition). The typed word starts where the handwriting started, and the placement rules
// keep it off the printed notes. A tap still opens the box for typing.
const WORDS = new Map();
const RECOGNISE_WORDS = [...new Set([
  ...Object.values(INSTRUMENTS).map((i) => i.label), 'violin', 'viola', 'cello', 'double bass', 'bass', 'flute', 'piano', 'organ', 'harp',
  'guitar', 'oboe', 'clarinet', 'bassoon', 'horn', 'trumpet', 'trombone', 'tuba', 'pizzicato', 'arco', 'legato', 'staccato', 'tenuto',
  'marcato', 'accent', 'ritardando', 'rallentando', 'accelerando', 'crescendo', 'diminuendo', 'dolce', 'cantabile', 'espressivo', 'tempo',
  'poco', 'molto', 'sempre', 'forte', 'fortissimo', 'pianissimo', 'fermata', 'tutti', 'solo', 'vibrato', 'portamento', 'mezzo', 'senza',
  'sul ponticello', 'sul tasto', 'con sordino', 'sordino', 'breath', 'bowing', 'fingering', 'a tempo', 'rit.', 'cresc.', 'dim.',
])];
// The handwriting as a small black-on-white picture, big enough for the recogniser to read.
function wordBitmap(strokes, x0, y0, x1, y1, inner, small) {
  const wpx = Math.max(1, (x1 - x0) * inner.width), hpx = Math.max(1, (y1 - y0) * inner.height);
  const k = Math.min((small ? 96 : 220) / hpx, 3000 / wpx), pad = small ? 24 : 40;
  const c = document.createElement('canvas');
  c.width = Math.ceil(wpx * k + pad * 2); c.height = Math.ceil(hpx * k + pad * 2);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = small ? Math.max(3, Math.min(hpx * k * 0.06, 6)) : Math.max(5, Math.min(hpx * k * 0.07, 16));
  for (const pts of strokes) {
    g.beginPath();
    pts.forEach((p, i) => { const X = pad + (p[0] - x0) * inner.width * k, Y = pad + (p[1] - y0) * inner.height * k; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    if (pts.length === 1) { const X = pad + (pts[0][0] - x0) * inner.width * k, Y = pad + (pts[0][1] - y0) * inner.height * k; g.lineTo(X + 0.5, Y); }
    g.stroke();
  }
  return c.toDataURL('image/png');
}
// Writing words: every stroke is kept (the pen can be lifted between letters, for dots and
// crosses); when the pen has rested for a moment, or writing starts somewhere else, the word
// is read and set in type. If it cannot be read, the handwriting simply stays.
const WORD = { pend: null };
const WORD_WAIT = () => S.wordWait || 1700;
function finishWord(g) {
  const pts = g.item.p, entry = g.entry, L = entry.layer;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const inner = entry.inner.getBoundingClientRect();
  const PS = pageSize(inner);
  const size = Math.max((x1 - x0) * PS[0], (y1 - y0) * PS[1]);
  let P = WORD.pend;
  // a tap, not writing: open the box for typing
  if (!P && (pts.length < 6 || size < 14)) { startText(entry, pts[0], null); return; }
  // far from the word being written: that word is finished first
  if (P) {
    const h = Math.max(P.y1 - P.y0, 0.012);
    const near = P.entry === entry && x0 < P.x1 + h * 3 && x1 > P.x0 - h * 2 && y0 < P.y1 + h * 1.2 && y1 > P.y0 - h * 1.2;
    if (!near) { flushWord(); P = null; }
  }
  if (!P) P = WORD.pend = { entry, strokes: [], before: L.items.slice(), x0: 1, y0: 1, x1: 0, y1: 0, bold: TXT.bold };
  P.strokes.push(pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]));
  P.x0 = Math.min(P.x0, x0); P.y0 = Math.min(P.y0, y0); P.x1 = Math.max(P.x1, x1); P.y1 = Math.max(P.y1, y1);
  // show the stroke as ink while the word is being written
  const st = styleFor('pen');
  L.commit({ t: 'pen', c: penColor(), a: st.a, s: inkSize('pen', st.size), p: pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5), +(p[2] || 0.5).toFixed(2)]) });
  clearTimeout(P.timer);
  P.timer = setTimeout(flushWord, WORD_WAIT());
}
function wordPenDown() { if (WORD.pend) clearTimeout(WORD.pend.timer); }
function flushWord() {
  const P = WORD.pend; WORD.pend = null;
  if (!P) return;
  clearTimeout(P.timer);
  const L = P.entry.layer;
  const written = L.items.slice();
  if (!NATIVE || !NATIVE.standRecognize) {
    pushUndo(L.key, P.before, written);
    inkHint('Turning handwriting into type needs the iPad app. Your writing is kept as it is.', 4000);
    return;
  }
  const inner = P.entry.inner.getBoundingClientRect();
  const id = uid();
  const all = P.strokes.flat();
  // two pictures of the same writing (large and bold, small and fine): the recogniser reads
  // each, and the better answer is kept
  const job = { entry: P.entry, pts: all, before: P.before, written, bold: P.bold, answers: [], want: 2 };
  WORDS.set(id, job); WORDS.set(id + '~s', job);
  job.timer = setTimeout(() => decideWord(job), 3000);
  NATIVE.standRecognize.postMessage({ id, png: wordBitmap(P.strokes, P.x0, P.y0, P.x1, P.y1, inner).split(',')[1], words: RECOGNISE_WORDS });
  NATIVE.standRecognize.postMessage({ id: id + '~s', png: wordBitmap(P.strokes, P.x0, P.y0, P.x1, P.y1, inner, true).split(',')[1], words: RECOGNISE_WORDS });
  inkHint('Reading…', 6000);
}
// The recogniser's answer: the word goes where the handwriting started, in the size of the handwriting.
// close to a word musicians write (one or two letters off): that word
function editDistance(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function snapWord(t) {
  const low = t.toLowerCase().replace(/[^a-zà-ÿ .]/g, '');
  if (!low) return { text: t, known: false };
  let best = null, bd = 99;
  for (const w of RECOGNISE_WORDS) { const d = editDistance(low, w.toLowerCase()); if (d < bd) { bd = d; best = w; } }
  const ok = bd === 0 || (low.length >= 4 && bd <= 1) || (low.length >= 8 && bd <= 2);
  return ok ? { text: bd === 0 ? t : best, known: true } : { text: t, known: false };
}
function decideWord(job) {
  if (job.decided) return; job.decided = true; clearTimeout(job.timer);
  for (const [k, v] of WORDS) if (v === job) WORDS.delete(k);
  const cands = job.answers.filter(Boolean).map(snapWord);
  const pick = cands.find((c) => c.known) || cands[0];
  wordRead(job, pick ? pick.text : '');
}
window.standRecognized = (msg) => {
  // words read for the composer's capture go there
  if (String(msg.id).startsWith('cap:')) { if (window.__capTextDone) window.__capTextDone(msg.id, msg.text || ''); return; }
  const job = WORDS.get(msg.id); WORDS.delete(msg.id);
  if (!job || job.decided) return;
  job.answers[String(msg.id).endsWith('~s') ? 1 : 0] = (msg.text || '').trim();
  job.got = (job.got || 0) + 1;
  if (job.got >= job.want) decideWord(job);
};
function wordRead(job, text) {
  if (!text) { if (job.written) pushUndo(job.entry.layer.key, job.before, job.written); inkHint('Kept as handwriting (it could not be read as text).', 3500); return; }
  const art = job.entry.art, W = art.width, H = art.height;
  const pts = job.pts;
  let y0 = 1, y1 = 0, xs = 1;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); xs = Math.min(xs, p[0]); }
  const hArt = Math.max(8, (y1 - y0) * H);
  const item = {
    t: 'stamp', k: 'txt', txt: text, c: penColor(), a: INK.stampStyle.a,
    s: clamp01((hArt * 1.2) / (0.78 * W), 0.006, 0.07),
    x: +xs.toFixed(4), y: +((y0 + y1) / 2).toFixed(4), al: 'l', b: job.bold ? 1 : 0, bg: 0,
  };
  const placed = placeWords(art, item);
  const after = [...job.before, placed];
  job.entry.layer.setItems(after); pushUndo(job.entry.layer.key, job.before, after.slice());
  inkHint(`“${text}”`, 2000);
};


// ---------- when Stand closes by itself ----------
// Every few seconds what is going on is noted; if Stand was ended without going to the background
// first (iOS closed it: memory, mostly), the next start keeps what it was doing, to show in
// Settings and find the cause.
(() => {
  const K = 'standAlive', KC = 'standCrashes';
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const prev = get(K, null);
  if (prev && prev.open && Date.now() - prev.t < 3 * 864e5) {
    const list = get(KC, []); list.push(prev); while (list.length > 6) list.shift(); put(KC, list);
  }
  const what = () => {
    const on = [];
    try {
      if (!$('#score').hidden && V.score) on.push(NBK() ? 'a notebook' : 'a score' + (V.doc ? ` (${V.doc.pages} pages)` : ''));
      else if (document.body.classList.contains('at-home')) on.push('the library');
      if (Z.s > 1.05) on.push('zoomed ' + Math.round(Z.s * 100) + '%');
      if (V.inking) on.push('writing');
      if (typeof follow !== 'undefined' && follow.inst && follow.inst.on) on.push('listening to turn');
      if (typeof eyes !== 'undefined' && eyes.running) on.push('following the eyes');
      if (S.wink) on.push('winks');
      if (metro.running) on.push('metronome'); if (drone.running) on.push('drone'); if (scale.playing) on.push('scales'); if (tuner.running) on.push('tuner');
      if (recState) on.push('recording'); if (player.playing) on.push('playing a take');
      if (openPanel) on.push('panel ' + openPanel);
      if (document.querySelector('.cp-root:not([hidden]), #compose:not([hidden])')) on.push('Compose');
      if (!$('#phScores')?.hidden) on.push('iPhone scores');
      let px = 0; for (const c of document.querySelectorAll('canvas')) px += c.width * c.height;
      on.push(Math.round(px / 1e6) + ' M canvas pixels on screen');
    } catch {}
    return on.join(', ');
  };
  const note = (open) => put(K, { t: Date.now(), open, what: what(), build: (window.standCaps && window.standCaps.build) || '' });
  note(true);
  setInterval(() => { if (!document.hidden) note(true); }, 3000);
  document.addEventListener('visibilitychange', () => note(!document.hidden));
  window.addEventListener('pagehide', () => note(false));
  window.__crashes = () => get(KC, []);
  // Settings: the times Stand closed by itself lately, and what it was doing
  const show = () => {
    const list = get(KC, []).filter((c) => Date.now() - c.t < 7 * 864e5);
    const box = $('#crashBox'); if (!box) return;
    box.hidden = !list.length;
    const ol = $('#crashList'); ol.textContent = '';
    for (const c of list.slice().reverse()) ol.append(el('li', '', `${new Date(c.t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}: ${c.what || '—'}`));
  };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-panel="app"]')) setTimeout(show, 50); });
  $('#crashClear')?.addEventListener('click', () => { put(KC, []); show(); });
})();
