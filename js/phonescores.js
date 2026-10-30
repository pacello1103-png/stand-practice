// "My scores" on the iPhone: the scores of the iPad, to read. The list (with small pictures) comes
// whenever the two meet, and every score is fetched then, one after another (again when it has
// changed on the iPad), and kept on the iPhone, so all can be read later without the iPad.
// A score taken off the iPhone (Edit) is not fetched again until it is brought back.
// Folders come as they are on the iPad. On the iPhone a score can be dragged (hold it, then move)
// into a folder, out of one, or onto another score to make a new folder; these choices are the
// iPhone's own and stay when the list comes again.
// Pages come as pictures, the markings as a clear layer on top: shown or hidden with one switch.
// Nothing can be changed here.
import { db, getSetting, setSetting } from './db.js';
import { nlog } from './link.js';
import { looksBlank } from './score.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const copyId = (id) => 'ipadcopy:' + id;
const toBlob = async (dataUrl) => (dataUrl ? (await fetch(dataUrl)).blob() : null);

export function initPhoneScores({ askIpad, toast, connected }) {
  const PS = { list: null, at: 0, busy: false, view: null, ink: true, urls: [], removed: new Set(), editing: false, sync: null, folder: null, org: { folders: [], place: {} }, drag: null };
  const bar = $('#phScoresBar'), pane = $('#phScores'), grid = $('#phsGrid'), viewer = $('#phView');
  const sub = () => {
    const n = PS.list ? PS.list.length : 0;
    $('#phsBarSub').textContent = n ? `${n} ${n === 1 ? 'score' : 'scores'} from your iPad` : 'The scores on your iPad, to read';
    $('#phsSub').textContent = PS.busy ? 'Looking for your iPad…' : PS.sync ? `Downloading ${Math.min(PS.sync.done + 1, PS.sync.n)} of ${PS.sync.n}${PS.sync.page ? ' · ' + PS.sync.page : '…'}` : PS.at ? 'From your iPad · ' + ago(PS.at) : 'Open Stand on your iPad, on the same Wi-Fi';
  };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  (async () => {
    const c = await getSetting('ipadScores', null); if (c) { PS.list = c.scores || []; PS.at = c.at || 0; }
    const FAIL = {};
    const rem = await getSetting('ipadRemoved', [], true).catch(() => FAIL), org = await getSetting('ipadOrg', null, true).catch(() => FAIL);
    if (rem === FAIL || org === FAIL) PS.readOnly = true;   // (never written over with nothing)
    PS.removed = new Set((rem !== FAIL && rem) || []);
    PS.org = { folders: [], place: {}, ...((org !== FAIL && org) || {}) };
    sub();
  })();
  const saveRemoved = () => (PS.readOnly ? Promise.resolve() : setSetting('ipadRemoved', [...PS.removed]));
  const saveOrg = () => (PS.readOnly ? Promise.resolve() : setSetting('ipadOrg', PS.org));
  // ---------- folders ----------
  // the iPad's folders (by their id there) and the iPhone's own; a score is in the folder chosen
  // on the iPhone, or else the one it has on the iPad
  const ipadPlace = (s) => (s.fid ? 'ipad:' + s.fid : s.folder ? 'ipadn:' + s.folder : '');
  const knownFolder = (id) => PS.org.folders.some((f) => f.id === id) || (PS.list || []).some((s) => ipadPlace(s) === id);
  // (a folder chosen here that has gone since: the score is back where the iPad has it)
  const folderOf = (s) => { const p = PS.org.place[s.id]; return p !== undefined && (p === '' || knownFolder(p)) ? p : ipadPlace(s); };
  function folders() {
    const map = new Map();
    for (const s of PS.list || []) if (s.fid || s.folder) map.set(s.fid ? 'ipad:' + s.fid : 'ipadn:' + s.folder, s.folder || 'Folder');
    for (const f of PS.org.folders) map.set(f.id, f.name);
    for (const [id, name] of Object.entries(PS.org.names || {})) if (map.has(id)) map.set(id, name);
    const visible = (PS.list || []).filter((s) => !PS.removed.has(s.id));
    return [...map.entries()].map(([id, name]) => ({ id, name, scores: visible.filter((s) => folderOf(s) === id), own: PS.org.folders.some((f) => f.id === id) }))
      .filter((f) => f.own || f.scores.length).sort((a, b) => a.name.localeCompare(b.name));
  }
  const folderName = (id) => (folders().find((f) => f.id === id) || {}).name || 'Folder';
  async function moveTo(ids, fid) {
    for (const id of ids) PS.org.place[id] = fid;
    await saveOrg(); render();
  }
  // a small sheet for a folder's name
  function askName(title, value, ok) {
    return new Promise((res) => {
      const back = $('#phsSheet'), form = $('#phsSheetForm'), inp = $('#phsSheetName');
      $('#phsSheetTitle').textContent = title; $('#phsSheetOk').textContent = ok; inp.value = value || '';
      back.hidden = false; setTimeout(() => { inp.focus(); inp.select(); }, 50);
      const done = (v) => { back.hidden = true; form.onsubmit = null; $('#phsSheetCancel').onclick = null; back.onclick = null; res(v); };
      form.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim().slice(0, 40); if (v) done(v); else inp.focus(); };
      $('#phsSheetCancel').onclick = () => done(null);
      back.onclick = (e) => { if (e.target === back) done(null); };
    });
  }
  // a small question with two answers (the sheet without its name box)
  function askSure(title, text, ok) {
    return new Promise((res) => {
      const back = $('#phsSheet'), form = $('#phsSheetForm'), inp = $('#phsSheetName'), okB = $('#phsSheetOk'), t = $('#phsSheetText');
      $('#phsSheetTitle').textContent = title; t.textContent = text; t.hidden = !text; inp.hidden = true;
      okB.textContent = ok; okB.classList.add('danger'); back.hidden = false;
      const done = (v) => { back.hidden = true; inp.hidden = false; t.hidden = true; okB.classList.remove('danger'); form.onsubmit = null; $('#phsSheetCancel').onclick = null; back.onclick = null; res(v); };
      form.onsubmit = (e) => { e.preventDefault(); done(true); };
      $('#phsSheetCancel').onclick = () => done(false);
      back.onclick = (e) => { if (e.target === back) done(false); };
    });
  }
  async function newFolder(ids) {
    const list = (PS.list || []).filter((s) => ids.includes(s.id));
    const comp = list.length > 1 && list.every((s) => s.composer && s.composer === list[0].composer) ? list[0].composer.split(/\s+/).pop() : '';
    const name = await askName(ids.length ? (ids.length === 2 ? 'New folder for these two' : 'New folder') : 'New folder', comp, 'Create');
    if (!name) return;
    const id = 'ph' + Date.now().toString(36);
    PS.org.folders.push({ id, name });
    for (const x of ids) PS.org.place[x] = id;
    await saveOrg(); render();
  }
  async function renameFolder(id) {
    const name = await askName('Rename folder', folderName(id), 'Rename'); if (!name) return;
    const own = PS.org.folders.find((f) => f.id === id);
    if (own) own.name = name; else PS.org.names = { ...(PS.org.names || {}), [id]: name };
    await saveOrg(); render();
  }
  async function deleteFolder(id) {
    // the folder goes; its scores stay, out of any folder
    for (const s of PS.list || []) if (folderOf(s) === id) PS.org.place[s.id] = '';
    PS.org.folders = PS.org.folders.filter((f) => f.id !== id);
    if (PS.folder === id) PS.folder = null;
    await saveOrg(); render();
  }
  // the scores on the iPhone: { id -> stamp } (only the small record of each, never its pages)
  const haveCopies = async () => {
    const keys = (await db.keys('files').catch(() => [])).map(String).filter((k) => /^ipadcopy:[^:]+$/.test(k));
    const out = new Map();
    for (const k of keys) { const f = await db.get('files', k).catch(() => null); if (f && (f.n || (f.pages && f.pages.length))) out.set(k.slice(9), f.stamp); }
    return out;
  };
  // (each version's pages under their own names: a version half fetched never mixes with the one
  // kept, which stays whole until the new one is complete)
  const pageKey = (id, i, stamp) => copyId(id) + ':s' + stamp + ':p' + i;
  const oldPageKey = (id, i) => copyId(id) + ':p' + i;
  const idOfKey = (k) => { const m = /^ipadcopy:([^:]+)/.exec(k); return m ? m[1] : null; };
  async function dropCopy(id) {
    const keys = (await db.keys('files').catch(() => [])).map(String).filter((k) => k === copyId(id) || k.startsWith(copyId(id) + ':'));
    for (const k of keys) await db.del('files', k).catch(() => {});
  }
  // a cancelled fetch (the score taken off the iPhone meanwhile, Cancel)
  const CANCEL = new Error('cancel');
  // one score from the iPad, page by page (each kept as it comes, so a score cut short goes on
  // from where it was next time), then its small record: the score is on the iPhone
  async function fetchScore(s, onPage, stop) {
    const halt = () => { if (PS.removed.has(s.id) || (stop && stop())) throw CANCEL; };
    const info = await askIpad({ what: 'scoreinfo', id: s.id }, 30000);
    halt();
    if (!info || !(info.n > 0)) throw new Error('no');
    const stamp = info.stamp ?? s.stamp;
    // (the next page is asked for while this one comes and is kept: the iPad draws it meanwhile, so
    // the pages come one after another with no waiting in between; never more than two at once)
    const have = [];
    for (let i = 0; i < info.n; i++) { const old = await db.get('files', pageKey(s.id, i, stamp)).catch(() => null); have[i] = !!(old && old.img); }
    const ask = (i) => { const p = askIpad({ what: 'page', id: s.id, i }, 30000); p.catch(() => {}); return p; };
    const nextTo = (i) => { for (let j = i + 1; j < info.n; j++) if (!have[j]) return j; return -1; };
    let ahead = null;
    for (let i = 0; i < info.n; i++) {
      if (have[i]) { if (onPage) onPage(i + 1, info.n); continue; }
      let first = ahead && ahead.i === i ? ahead.p : ask(i); ahead = null;
      // (one page at a time: the iPad draws each for the iPhone, two at once was too much for it)
      let d = null;
      for (let k = 0; k < 2 && !d; k++) { try { d = await (k ? ask(i) : first); } catch (e) { if (k || String(e.message) === 'ipad:none') throw e; } halt(); }
      if (!d || !d.img) throw new Error('no');
      halt();
      await db.put('files', { id: pageKey(s.id, i, stamp), kind: 'ipadpage', stamp, w: d.w, h: d.h, img: await toBlob(d.img), ink: await toBlob(d.ink) });
      d = null;
      if (onPage) onPage(i + 1, info.n);
      // (a breath between pages: the memory of the page just kept is let go before the next comes)
      await new Promise((r) => setTimeout(r, 40));
    }
    halt();
    const copy = { id: copyId(s.id), kind: 'ipadcopy', stamp, title: s.title, n: info.n, at: Date.now() };
    await db.put('files', copy);
    // (the score being read here goes on in its new version, whose pages are all here now)
    if (PS.view && PS.view.copy && PS.view.copy.id === copy.id) { PS.view.copy = copy; PS.view.i = Math.min(PS.view.i, copy.n - 1); }
    // (the pages of other versions go, now that this one is whole)
    const mine = copyId(s.id) + ':s' + stamp + ':';
    for (const k of (await db.keys('files').catch(() => [])).map(String)) if (k.startsWith(copyId(s.id) + ':') && !k.startsWith(mine)) await db.del('files', k).catch(() => {});
    return copy;
  }
  // every score not yet on the iPhone (or changed on the iPad since), one after another
  async function syncAll() {
    if (PS.sync) { PS.again = true; return; }
    if (!PS.list) return;
    PS.again = false;
    const have = await haveCopies();
    const want = PS.list.filter((s) => !PS.removed.has(s.id) && have.get(s.id) !== s.stamp);
    if (!want.length) return;
    PS.sync = { n: want.length, done: 0, failed: 0 }; sub(); nlog('iPhone: fetching ' + want.length + ' score(s) from the iPad');
    // (leaving the app for a moment does not stop it: iOS gives the newer apps some time)
    try { window.__nativeBusy && window.__nativeBusy(true, 'download'); } catch {}
    for (const s of want) {
      if (PS.removed.has(s.id)) { PS.sync.done++; continue; }
      try { await fetchScore(s, (k, n) => { PS.sync.page = `${s.title} · page ${k} of ${n}`; sub(); }); } catch (e) {
        if (e === CANCEL) { PS.sync.done++; continue; }
        if (/QuotaExceeded|quota/i.test(String((e && (e.name + ' ' + e.message)) || ''))) { PS.sync.full = true; break; }
        // (the iPad is short of memory: stop here and come back in a few minutes, never insist)
        if (String(e && e.message) === 'ipad:busy') { nlog('iPhone: the iPad is busy, later'); setTimeout(() => syncAll(), 180000); break; }
        if (!String(e && e.message).startsWith('ipad')) PS.sync.failed++;   // (one score the iPad could not send: the others still come)
        if (PS.sync.failed >= 2) break;   // (the iPad has gone)
      }
      PS.sync.page = '';
      PS.sync.done++; sub(); if (!pane.hidden) render();
    }
    const failed = PS.sync.failed, full = PS.sync.full; nlog('iPhone: fetched, ' + failed + ' failed' + (full ? ', full' : '')); PS.sync = null; sub(); if (!pane.hidden) render();
    try { window.__nativeBusy && window.__nativeBusy(false, 'download'); } catch {}
    if (full) toast('This iPhone is full: some scores could not be downloaded. Remove some downloads (Edit) or free some space.', 6000);
    else if (failed && !pane.hidden) toast('Some scores could not be downloaded. They come next time your iPad is found.');
    if (PS.again && !full && !failed) syncAll();
  }

  async function refresh(quiet) {
    if (PS.busy) return; PS.busy = true; sub();
    // (the settings could not be read at the start: read again now; what was changed meanwhile was not kept)
    if (PS.readOnly) { try { const rem = await getSetting('ipadRemoved', [], true), org = await getSetting('ipadOrg', null, true); PS.removed = new Set(rem || []); PS.org = { folders: [], place: {}, ...(org || {}) }; PS.readOnly = false; } catch {} }
    try {
      const d = await askIpad({ what: 'list' }, 20000);
      if (d && Array.isArray(d.scores)) {
        const had = PS.list || [];
        // (an empty list from an iPad that had scores is a hiccup there, not every score deleted)
        if (!d.scores.length && had.length) throw new Error('empty');
        PS.list = d.scores; PS.at = Date.now(); await setSetting('ipadScores', { at: PS.at, scores: PS.list });
        // copies of scores no longer on the iPad go: once they have been missing twice in a row
        const ids = new Set(PS.list.map((x) => x.id));
        PS.miss = PS.miss || new Map();
        for (const id of ids) PS.miss.delete(id);
        const keys = (await db.keys('files').catch(() => [])).map(String).filter((k) => k.startsWith('ipadcopy:'));
        const gone = new Set(keys.map(idOfKey).filter((id) => id && !ids.has(id)));
        for (const id of gone) { const n = (PS.miss.get(id) || 0) + 1; PS.miss.set(id, n); if (n >= 2) { await dropCopy(id); PS.miss.delete(id); } }
        // (and the scores taken off this iPhone that the iPad no longer has are forgotten)
        if (PS.list.length) { let ch = false; for (const id of [...PS.removed]) if (!ids.has(id) && (PS.miss.get(id) || 0) === 0) { PS.removed.delete(id); ch = true; } if (ch) saveRemoved(); }
        PS.busy = false; sub(); if (!pane.hidden) render();
        syncAll();
        return;
      }
    } catch { if (!quiet && !PS.list) toast('Your iPad was not found. Open Stand on it, on the same Wi-Fi.'); else if (!quiet) toast('Your iPad was not found. These are the scores kept on this iPhone.'); }
    PS.busy = false; sub(); if (!pane.hidden) render();
  }
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const have = await haveCopies();
    if (seq !== renderSeq) return;   // (a newer drawing of the list is on its way)
    grid.textContent = '';
    const q = $('#phsSearch').value.trim().toLowerCase();
    const all = PS.list || [];
    if (PS.folder && !folders().some((f) => f.id === PS.folder)) PS.folder = null;
    $('#phsTitle').textContent = PS.folder ? folderName(PS.folder) : 'My scores';
    $('#phsClose').setAttribute('aria-label', PS.folder ? 'All scores' : 'Back');
    // searching looks through every score; otherwise the folders come first, then the scores in none
    const list = all.filter((s) => !PS.removed.has(s.id) && (q ? (s.title + ' ' + (s.composer || '')).toLowerCase().includes(q) : folderOf(s) === (PS.folder || '')));
    if (!q && !PS.folder) for (const f of folders()) {
      const b = el('div', 'phs-card phs-folder'); b.setAttribute('role', 'button'); b.tabIndex = 0; b.dataset.folder = f.id;
      const th = el('div', 'phs-fthumb');
      for (const s of f.scores.slice(0, 4)) { const m = el('i'); if (s.thumb) m.style.backgroundImage = `url(${s.thumb})`; th.append(m); }
      if (PS.editing) {
        const x = el('button', 'phs-del'); x.setAttribute('aria-label', 'Delete the folder ' + f.name); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
        x.addEventListener('click', async (e) => { e.stopPropagation(); if (await askSure(`Delete the folder “${f.name}”?`, f.scores.length ? 'Its scores stay on this iPhone, out of any folder.' : '', 'Delete')) deleteFolder(f.id); });
        th.append(x);
      }
      b.append(th, el('div', 'phs-t', f.name), el('div', 'phs-c', f.scores.length === 1 ? '1 score' : f.scores.length + ' scores'));
      b.addEventListener('click', () => { if (PS.drag && PS.drag.moved) return; if (PS.editing) renameFolder(f.id); else { PS.folder = f.id; $('#phsSearch').value = ''; render(); pane.scrollTop = 0; } });
      grid.append(b);
    }
    $('#phsEmpty').hidden = list.length > 0 || PS.busy || (!q && !PS.folder && folders().length > 0);
    $('#phsEmpty').textContent = all.length ? (q ? 'Nothing found.' : 'No scores on this iPhone.') : 'Your scores show here once your iPad has been found: open Stand on it, on the same Wi-Fi.';
    grid.classList.toggle('editing', PS.editing);
    for (const s of list) {
      const b = el('div', 'phs-card'); b.setAttribute('role', 'button'); b.tabIndex = 0; b.dataset.score = s.id;
      const th = el('div', 'phs-thumb'); if (s.thumb) th.style.backgroundImage = `url(${s.thumb})`;
      const got = have.has(s.id), fresh = got && have.get(s.id) === s.stamp;
      // on the iPhone (green), on the way, or not yet
      const st = el('span', 'phs-state ' + (fresh ? 'ok' : got ? 'old' : 'no')); st.title = fresh ? 'On this iPhone' : got ? 'A newer version is on the iPad' : 'Not on this iPhone yet';
      th.append(st);
      if (PS.editing) {
        const x = el('button', 'phs-del'); x.setAttribute('aria-label', 'Remove ' + s.title + ' from this iPhone'); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
        x.addEventListener('click', async (e) => { e.stopPropagation(); if (await askSure(`Remove the download of “${s.title}”?`, 'It stays on your iPad, and can be downloaded again at any time.', 'Remove Download')) removeScore(s); });
        th.append(x);
      }
      b.append(th, el('div', 'phs-t', s.title), el('div', 'phs-c', s.composer || (s.pages + (s.pages === 1 ? ' page' : ' pages'))));
      b.addEventListener('click', () => { if (PS.drag && PS.drag.moved) return; if (!PS.editing) openScore(s); });
      dragFrom(b, s);
      grid.append(b);
    }
    const rem = all.filter((s) => PS.removed.has(s.id)), nr = rem.length;
    $('#phsRemoved').hidden = !nr;
    $('#phsRemovedText').textContent = nr === 1 ? '1 removed download' : `${nr} removed downloads`;
    // (in Edit, each one can be downloaded again on its own)
    const rl = $('#phsRemovedList'); rl.textContent = '';
    if (PS.editing) for (const r of rem) {
      const row = el('div', 'phs-removed-row'); const bt = el('button', 'btn small ghost', 'Download');
      bt.addEventListener('click', async (e) => { e.stopPropagation(); PS.removed.delete(r.id); await saveRemoved(); render(); syncAll(); });
      row.append(el('span', '', r.title), bt); rl.append(row);
    }
    $('#phsEdit').textContent = PS.editing ? 'Done' : 'Edit';
    $('#phsEditHint').hidden = !PS.editing;
    $('#phsNewFolder').hidden = PS.editing;
    $('#phsEdit').hidden = !all.length;
  }
  function openList() { pane.hidden = false; document.body.classList.add('phs-open'); render(); sub(); refresh(true); }
  function closeList() { pane.hidden = true; PS.editing = false; PS.folder = null; document.body.classList.remove('phs-open'); }
  // taken off the iPhone: its copy goes, and it is not downloaded again until brought back
  async function removeScore(s) {
    PS.removed.add(s.id); await saveRemoved();
    await dropCopy(s.id);
    toast(`${s.title} taken off this iPhone.`);
    render();
  }
  $('#phsEdit').addEventListener('click', () => { PS.editing = !PS.editing; render(); });
  $('#phsNewFolder').addEventListener('click', () => newFolder([]));
  // a tap on an empty part of the list leaves Edit
  pane.addEventListener('click', (e) => { if (PS.editing && !e.target.closest('.phs-card, button, input, .phs-sheet-back, .phs-removed')) { PS.editing = false; render(); } });
  // ---------- dragging: hold a score a moment, then move it ----------
  function dragFrom(card, s) {
    let t = 0, start = null;
    card.addEventListener('pointerdown', (e) => {
      if (PS.editing || (e.button && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      clearTimeout(t);
      t = setTimeout(() => {
        const r = card.getBoundingClientRect();
        const ghost = card.cloneNode(true); ghost.classList.add('phs-ghost');
        Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
        document.body.append(ghost); card.classList.add('phs-lifted');
        PS.drag = { s, ghost, dx: start.x - r.left, dy: start.y - r.top, moved: false, over: null, card };
        $('#phsOut').hidden = !PS.folder;
        if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
      }, 380);
    });
    card.addEventListener('pointermove', (e) => { if (!PS.drag && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { clearTimeout(t); start = null; } });
    const cancel = () => { clearTimeout(t); start = null; };
    card.addEventListener('pointerup', cancel); card.addEventListener('pointercancel', cancel);
  }
  const overTarget = (x, y) => {
    const hit = document.elementFromPoint(x, y); if (!hit) return null;
    const out = hit.closest('#phsOut'); if (out) return { out: true, el: out };
    const f = hit.closest('.phs-folder'); if (f) return { folder: f.dataset.folder, el: f };
    const c = hit.closest('.phs-card[data-score]'); if (c && c.dataset.score !== PS.drag.s.id) return { score: c.dataset.score, el: c };
    return null;
  };
  document.addEventListener('pointermove', (e) => {
    const d = PS.drag; if (!d) return;
    d.moved = true;
    d.ghost.style.left = e.clientX - d.dx + 'px'; d.ghost.style.top = e.clientY - d.dy + 'px';
    const o = overTarget(e.clientX, e.clientY);
    if (d.over && (!o || o.el !== d.over.el)) d.over.el.classList.remove('phs-over');
    if (o) o.el.classList.add('phs-over');
    d.over = o;
  });
  // (while a score is carried, the list does not scroll under the finger)
  document.addEventListener('touchmove', (e) => { if (PS.drag) e.preventDefault(); }, { passive: false });
  const endDrag = async () => {
    const d = PS.drag; if (!d) return;
    d.ghost.remove(); d.card.classList.remove('phs-lifted'); $('#phsOut').hidden = true;
    if (d.over) d.over.el.classList.remove('phs-over');
    const o = d.over;
    setTimeout(() => { PS.drag = null; }, 0);
    if (!o) return;
    if (o.out) { await moveTo([d.s.id], ''); toast(`${d.s.title} is out of the folder.`); }
    else if (o.folder) { await moveTo([d.s.id], o.folder); toast(`Moved to ${folderName(o.folder)}.`); }
    else if (o.score) await newFolder([o.score, d.s.id]);
  };
  document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
  $('#phsBringBack').addEventListener('click', async () => { PS.removed.clear(); await saveRemoved(); PS.editing = false; render(); syncAll(); refresh(true); });
  bar.addEventListener('click', openList);
  $('#phsClose').addEventListener('click', () => { if (PS.folder) { PS.folder = null; PS.editing = false; render(); } else closeList(); });
  $('#phsRefresh').addEventListener('click', () => refresh(false));
  $('#phsSearch').addEventListener('input', () => render());

  let opening = null;
  $('#phsLoadingCancel').addEventListener('click', () => { if (opening) opening.stop = true; $('#phsLoading').hidden = true; });
  async function openScore(s) {
    if (opening) opening.stop = true;
    const me = opening = { stop: false };
    let copy = await db.get('files', copyId(s.id)).catch(() => null);
    if (!copy || copy.stamp !== s.stamp) {
      const old = copy;
      $('#phsLoading').hidden = false; $('#phsLoadingText').textContent = copy ? 'Getting the latest from your iPad…' : 'Getting it from your iPad…';
      try { copy = await fetchScore(s, (k, n) => { if (!me.stop) $('#phsLoadingText').textContent = `Getting page ${k} of ${n}…`; }, () => me.stop); } catch (e) {
        copy = old;
        if (e === CANCEL || me.stop) { if (opening === me) { opening = null; $('#phsLoading').hidden = true; } if (!copy || me.stop) return; }
        if (!copy) {
          $('#phsLoading').hidden = true; opening = null;
          const why = String((e && e.message) || '');
          toast(why === 'ipad:none' ? 'That score is no longer on your iPad.' : why.startsWith('ipad') ? 'Your iPad could not send this score. Try again in a moment.' : 'Your iPad was not found. Open Stand on it, on the same Wi-Fi, to get this score.');
          return;
        }
        toast('Showing the copy on this iPhone.');
      }
      if (opening !== me) return;
      $('#phsLoading').hidden = true;
      render();
    }
    opening = null;
    showScore(s, copy);
  }
  // the reader: tap the right side for the next page, the left for the one before; swipe too
  function showScore(s, copy) {
    PS.view = { s, copy, i: 0 };
    viewer.hidden = false; $('#phvTitle').textContent = s.title;
    $('#phvInk').hidden = false;
    drawPage();
  }
  const countOf = (copy) => copy.n || (copy.pages ? copy.pages.length : 0);
  const pageOf = async (copy, i) => {
    if (copy.pages) return copy.pages[i];
    const id = copy.id.slice(9);
    return (await db.get('files', pageKey(id, i, copy.stamp)).catch(() => null)) || db.get('files', oldPageKey(id, i)).catch(() => null);
  };
  async function drawPage() {
    const v = PS.view; if (!v) return;
    const i0 = v.i, p = await pageOf(v.copy, v.i);
    if (PS.view !== v || v.i !== i0) return;
    if (!p) { $('#phvPage').textContent = `${v.i + 1} / ${countOf(v.copy)}`; toast('This page is missing on this iPhone. It comes again next time your iPad is found.'); return; }
    for (const u of PS.urls) URL.revokeObjectURL(u); PS.urls = [];
    const img = $('#phvImg'), ink = $('#phvInkImg');
    const u = URL.createObjectURL(p.img); PS.urls.push(u); img.src = u;
    // (a page that came white from the iPad, drawn when it was short of memory: thrown away, and the
    // score asked for again, those pages only, the next time the iPad is found)
    img.onload = async () => {
      img.onload = null;
      if (PS.view !== v || v.i !== i0 || !looksBlank(img)) return;
      const id = v.copy.id.slice(9);
      // (asked again once already: the page really is empty)
      const once = (() => { try { return JSON.parse(localStorage.getItem('standBlankOnce') || '[]'); } catch { return []; } })();
      const bk = id + ':' + i0; if (once.includes(bk)) return;
      try { localStorage.setItem('standBlankOnce', JSON.stringify([...once, bk].slice(-300))); } catch {}
      await db.del('files', pageKey(id, i0, v.copy.stamp)).catch(() => {});
      const c2 = await db.get('files', v.copy.id).catch(() => null);
      if (c2) { c2.stamp = 'again:' + c2.stamp; await db.put('files', c2).catch(() => {}); }
      nlog('iPhone: a white page thrown away (' + (i0 + 1) + ')');
      toast('This page came white from your iPad. It comes again the next time your iPad is found.', 4500);
    };
    if (p.ink && PS.ink) { const ui = URL.createObjectURL(p.ink); PS.urls.push(ui); ink.src = ui; ink.hidden = false; } else { ink.hidden = true; ink.removeAttribute('src'); }
    $('#phvPage').textContent = `${v.i + 1} / ${countOf(v.copy)}`;
    $('#phvInk').classList.toggle('on', PS.ink);
    $('#phvInk span').textContent = PS.ink ? 'Markings on' : 'Markings off';
    // the next page ready ahead
    const n = v.i + 1 < countOf(v.copy) ? await pageOf(v.copy, v.i + 1) : null; if (n && PS.view === v) { const pre = new Image(); const un = URL.createObjectURL(n.img); PS.urls.push(un); pre.src = un; }
  }
  const go = (d) => { const v = PS.view; if (!v) return; const i = Math.max(0, Math.min(countOf(v.copy) - 1, v.i + d)); if (i !== v.i) { v.i = i; drawPage(); } };
  $('#phvClose').addEventListener('click', () => { viewer.hidden = true; PS.view = null; for (const u of PS.urls) URL.revokeObjectURL(u); PS.urls = []; });
  $('#phvInk').addEventListener('click', () => { PS.ink = !PS.ink; drawPage(); });
  let sx = null, sy = 0;
  const stage = $('#phvStage');
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { const r = stage.getBoundingClientRect(); go(e.clientX > r.left + r.width * 0.4 ? 1 : -1); }
  });
  document.addEventListener('keydown', (e) => { if (viewer.hidden) return; if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'Escape') $('#phvClose').click(); });

  // the list comes by itself whenever the iPad is found
  if (connected) connected(() => refresh(true));
  setTimeout(() => refresh(true), 2500);
  // (iOS stops the app in the background: back in it, the downloads go on from the page they had reached)
  let backAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || PS.sync || Date.now() - backAt < 30000) return; backAt = Date.now(); setTimeout(() => refresh(true), 800); });
  return { refresh, openList };
}
