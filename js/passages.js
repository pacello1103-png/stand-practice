// Passages: marked parts of a piece (any instrument) with a simple tempo log.
// Each passage is drawn on its page as a coloured box (an ink item), and its tempo history is
// kept here, per score. The panel shows progress, what has been missed, and a day-by-day table.
import { getSetting, setSetting } from './db.js';
import { PASSAGE_KINDS } from './ink.js';

const KIND_HINT = {
  melodic: 'Sing it through clean first, then add speed.',
  technical: 'Start slow. Add 5 bpm each time it is clean.',
  shift: 'Practise the shift slowly and in rhythm, then at tempo.',
  rhythm: 'Play the rhythm alone first, then with the notes.',
  bowing: 'Practise the bowing or breathing pattern on its own, then add the notes.',
};

let store = {};   // { scoreId: { passageId: passage } }
let D = null;     // dependencies from the app

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const $ = (s) => document.querySelector(s);
const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000); }
function dayLabel(d) {
  const t = dayKey();
  if (d === t) return 'Today';
  if (daysBetween(d, t) === 1) return 'Yesterday';
  return new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export async function loadPassages() { store = (await getSetting('passages', {})) || {}; }
const save = () => setSetting('passages', store);
export function passagesFor(scoreId) {
  return Object.values(store[scoreId] || {}).sort((a, b) => a.created - b.created);
}
export function dropScorePassages(scoreId) { delete store[scoreId]; save(); }
// every score that has passages: [{ scoreId, list }]
export function allPassages() { return Object.keys(store).map((scoreId) => ({ scoreId, list: passagesFor(scoreId) })).filter((x) => x.list.length); }
// how much a passage matters in a practice session: 0 skip, 1 low, 2 medium, 3 high
export function setPriority(scoreId, id, prio) { const p = store[scoreId] && store[scoreId][id]; if (p) { p.prio = prio; save(); } }
export function priorityOf(p) { return p.prio === undefined ? 2 : p.prio; }

// Per day: the first and the best tempo logged that day.
export function dayRows(p) {
  const by = new Map();
  for (const e of p.log) {
    const r = by.get(e.d);
    if (!r) by.set(e.d, { d: e.d, first: e.bpm, best: e.bpm, n: 1 });
    else { r.best = Math.max(r.best, e.bpm); r.n++; }
  }
  return [...by.values()];
}
export function lastEntry(p) { return p.log.length ? p.log[p.log.length - 1] : null; }
export function progress(p) {
  const last = lastEntry(p);
  if (!last || p.target === p.start) return last ? 1 : 0;
  return clamp((last.bpm - p.start) / (p.target - p.start), 0, 1);
}

// What has been missed. Short, plain sentences; at most three, most urgent first.
export function missed(list) {
  const today = dayKey(), out = [];
  for (const p of list) {
    const last = lastEntry(p);
    if (!last) { out.push({ p, prio: 2, text: 'Not practised yet.' }); continue; }
    if (last.bpm >= p.target) { out.push({ p, prio: 4, good: true, text: `Target ${p.target} reached. Set a higher one?` }); continue; }
    const gap = daysBetween(last.d, today);
    if (gap >= 3) out.push({ p, prio: 1, text: `Not practised for ${gap} days.` });
    const recent = dayRows(p).slice(-3);
    if (recent.length === 3 && recent.every((r) => r.best === last.bpm)) {
      out.push({ p, prio: 1, text: `Stuck at ${last.bpm} for three sessions. Go back about 5 bpm and build up again.` });
    }
  }
  return out.sort((a, b) => a.prio - b.prio).slice(0, 3);
}

// ---------- drawing ----------
function sparkline(canvas, p) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 300, H = canvas.clientHeight || 44;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const rows = dayRows(p).slice(-14);
  if (!rows.length) return;
  const vals = rows.map((r) => r.best);
  const lo = Math.min(p.start, p.target, ...vals) - 3, hi = Math.max(p.start, p.target, ...vals) + 3;
  const Y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const X = (i) => (rows.length === 1 ? W / 2 : 6 + (i / (rows.length - 1)) * (W - 12));
  g.setLineDash([4, 4]); g.strokeStyle = css('--good'); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, Y(p.target)); g.lineTo(W, Y(p.target)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = css('--accent-text'); g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath(); rows.forEach((r, i) => (i ? g.lineTo(X(i), Y(r.best)) : g.moveTo(X(i), Y(r.best)))); g.stroke();
  g.fillStyle = css('--accent-text');
  rows.forEach((r, i) => { g.beginPath(); g.arc(X(i), Y(r.best), 2.8, 0, Math.PI * 2); g.fill(); });
}

// ---------- the Passages panel ----------
const openCards = new Set();
export function renderPassages() {
  const sid = D.scoreId();
  const list = sid ? passagesFor(sid) : [];
  const box = $('#passMissed'), ul = $('#passList');
  box.textContent = ''; ul.textContent = '';
  $('#passEmpty').hidden = list.length > 0;
  box.hidden = !list.length;
  $('#passSession').hidden = !allPassages().some((g) => g.list && g.list.length);
  if (!list.length) return;

  const items = missed(list);
  box.append(el('h3', '', 'What you have missed'));
  if (!items.length) box.append(el('p', 'hint', 'Nothing missed. Keep going.'));
  for (const m of items) {
    const row = el('div', 'pass-miss' + (m.good ? ' good' : ''));
    const dot = el('i'); dot.style.background = (PASSAGE_KINDS[m.p.kind] || PASSAGE_KINDS.melodic).color;
    row.append(dot, el('span', '', `${m.p.name}: ${m.text}`));
    box.append(row);
  }

  for (const p of list) ul.append(card(p, sid));
  requestAnimationFrame(() => list.forEach((p) => { const c = document.querySelector(`[data-spark="${p.id}"]`); if (c) sparkline(c, p); }));
}

function card(p, sid) {
  const kind = PASSAGE_KINDS[p.kind] || PASSAGE_KINDS.melodic;
  const li = el('li', 'pass-card' + (openCards.has(p.id) ? ' open' : ''));
  li.style.setProperty('--pc', kind.color);

  const head = el('button', 'pass-head');
  head.setAttribute('aria-expanded', openCards.has(p.id));
  const title = el('div', 'pass-title');
  title.append(el('strong', '', p.name), el('span', 'pass-kind', kind.label));
  const last = lastEntry(p);
  const right = el('div', 'pass-target num', `${p.start} → ${p.target}`);
  head.append(title, right);
  head.addEventListener('click', () => { openCards.has(p.id) ? openCards.delete(p.id) : openCards.add(p.id); renderPassages(); });
  li.append(head);

  const bar = el('div', 'pass-bar'); const fill = el('i');
  fill.style.width = (progress(p) * 100).toFixed(0) + '%';
  bar.append(fill); li.append(bar);

  const spark = el('canvas', 'pass-spark'); spark.dataset.spark = p.id; li.append(spark);

  const meta = el('p', 'pass-meta hint', last
    ? `Last: ${last.bpm} bpm · ${dayLabel(last.d)}`
    : 'Not practised yet. ' + KIND_HINT[p.kind]);
  li.append(meta);

  const log = el('div', 'pass-log');
  const input = el('input'); input.type = 'number'; input.inputMode = 'numeric'; input.min = 20; input.max = 300;
  input.value = D.currentBpm() || (last ? last.bpm : p.start); input.setAttribute('aria-label', 'Tempo for this session');
  const logBtn = el('button', 'btn primary small', 'Log tempo');
  logBtn.addEventListener('click', () => {
    const bpm = Math.round(+input.value);
    if (!(bpm >= 20 && bpm <= 300)) { D.toast('Enter a tempo between 20 and 300.'); return; }
    p.log.push({ d: dayKey(), bpm, t: Date.now() });
    save(); renderPassages();
    D.toast(bpm >= p.target ? `${bpm} bpm. Target reached!` : `Logged ${bpm} bpm.`);
  });
  log.append(input, el('span', 'hint', 'bpm'), logBtn);
  li.append(log);

  const acts = el('div', 'pass-acts');
  const show = el('button', 'btn ghost small', 'Show on page');
  show.addEventListener('click', () => D.goToPage(+p.key.split(':').pop()));
  const edit = el('button', 'btn ghost small', 'Edit');
  edit.addEventListener('click', () => openSheet({ edit: p }));
  const del = el('button', 'btn danger-text small', 'Remove');
  let armed = false;
  del.addEventListener('click', () => {
    if (!armed) { armed = true; del.textContent = 'Tap again to remove'; setTimeout(() => { armed = false; del.textContent = 'Remove'; }, 3000); return; }
    delete store[sid][p.id]; save();
    D.mapItems(p.key, (items) => items.filter((s) => s.pid !== p.id));
    openCards.delete(p.id); renderPassages();
  });
  acts.append(show, edit, del);
  li.append(acts);

  if (openCards.has(p.id)) {
    const rows = dayRows(p).reverse();
    const t = el('table', 'pass-table');
    const thead = el('tr'); ['Day', 'First', 'Best', 'Entries'].forEach((h) => thead.append(el('th', '', h)));
    t.append(thead);
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', '', dayLabel(r.d)), el('td', 'num', String(r.first)), el('td', 'num', String(r.best)), el('td', 'num', String(r.n)));
      t.append(tr);
    }
    li.append(rows.length ? t : el('p', 'hint', 'No tempos logged yet.'));
  }
  return li;
}

// ---------- the passage sheet (create and edit) ----------
const SHEET = { kind: 'melodic', pending: null, edit: null };
function openSheet({ key, box, edit }) {
  SHEET.edit = edit || null;
  SHEET.pending = edit ? null : { key, box };
  SHEET.kind = edit ? edit.kind : 'melodic';
  $('#passSheetTitle').textContent = edit ? 'Edit passage' : 'New passage';
  $('#passName').value = edit ? edit.name : '';
  $('#passName').placeholder = `Passage ${passagesFor(D.scoreId()).length + 1}`;
  $('#passStart').value = edit ? edit.start : (D.currentBpm() || 60);
  $('#passTarget').value = edit ? edit.target : (D.currentBpm() ? D.currentBpm() + 20 : 100);
  drawKinds();
  D.showPanel('passsheet');
  setTimeout(() => $('#passName').focus(), 80);
}
function drawKinds() {
  const seg = $('#passKinds'); seg.textContent = '';
  for (const [k, v] of Object.entries(PASSAGE_KINDS)) {
    const b = el('button', k === SHEET.kind ? 'on' : '', v.label);
    b.dataset.kind = k;
    b.addEventListener('click', () => { SHEET.kind = k; drawKinds(); });
    seg.append(b);
  }
  $('#passKindHint').textContent = KIND_HINT[SHEET.kind];
}
export function markRegion(key, box) { openSheet({ key, box }); }

function saveSheet() {
  const sid = D.scoreId();
  const start = Math.round(+$('#passStart').value), target = Math.round(+$('#passTarget').value);
  if (!(start >= 20 && start <= 300) || !(target >= 20 && target <= 300)) { D.toast('Tempos go from 20 to 300.'); return; }
  const name = ($('#passName').value.trim() || $('#passName').placeholder).slice(0, 28);
  const kind = SHEET.kind;
  if (SHEET.edit) {
    const p = SHEET.edit;
    Object.assign(p, { name, kind, start, target });
    save();
    D.mapItems(p.key, (items) => items.map((s) => (s.pid === p.id ? { ...s, name, kind } : s)));
  } else if (SHEET.pending && sid) {
    const { key, box } = SHEET.pending;
    const id = uid();
    const rec = { id, name, kind, key, start, target, created: Date.now(), log: [] };
    (store[sid] = store[sid] || {})[id] = rec;
    save();
    const item = { t: 'passage', pid: id, name, kind, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
    D.mapItems(key, (items) => [...items, item]);
  }
  SHEET.pending = null; SHEET.edit = null;
  D.toast('Passage saved.');
  D.showPanel('passages');
}

export function initPassages(deps) {
  D = deps;
  $('#passSave').addEventListener('click', saveSheet);
  for (const id of ['#passCancel', '#passClose']) $(id).addEventListener('click', () => { SHEET.pending = null; SHEET.edit = null; D.showPanel('passages'); });
  $('#passName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSheet(); });
}
