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
import { nlog, directOnFile } from './link.js';
import { looksBlank, openDocument, mapDoc } from './score.js';
import { cleanLines, cleanEdges, eraseCrossings } from './picker-lines.js';

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
    // the score's own file, in one go (the iPad offers it): its pages are drawn here
    if (info.src && info.src.kind === 'pdf' && fileLinkOk()) {
      try { return await fetchSrc(s, info, stamp, onPage, halt); } catch (e) {
        if (e === CANCEL) throw e;
        nlog('iPhone: the file did not come (' + String((e && e.message) || e).slice(0, 60) + '), page by page instead');
      }
    }
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
    const copy = { id: copyId(s.id), kind: 'ipadcopy', stamp, title: s.title, n: info.n, at: Date.now(), ...(info.src ? {} : { noSrc: true }) };
    await db.put('files', copy);
    // (the score being read here goes on in its new version, whose pages are all here now)
    if (PS.view && PS.view.copy && PS.view.copy.id === copy.id) { PS.view.copy = copy; PS.view.i = Math.min(PS.view.i, copy.n - 1); }
    // (the pages of other versions go, now that this one is whole)
    const mine = copyId(s.id) + ':s' + stamp + ':';
    for (const k of (await db.keys('files').catch(() => [])).map(String)) if (k.startsWith(copyId(s.id) + ':') && !k.startsWith(mine)) await db.del('files', k).catch(() => {});
    return copy;
  }
  // ---------- the score as its own file ----------
  // (the iPad's PDF, kept here with the order of its pages, cuts and turns, and the markings of the
  // pages that have some as clear pictures; the pages are drawn here, once, and kept)
  const fileLinkOk = () => !!(window.standCaps && window.standCaps.peer && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standPeer);
  const verKey = (id, stamp) => copyId(id) + ':s' + stamp + ':';
  const srcKey = (id, stamp) => verKey(id, stamp) + 'src';
  const inkKey = (id, stamp, i) => verKey(id, stamp) + 'ink' + i;
  function waitFile(id, stamp, ms) {
    let off = null, timer = 0;
    const p = new Promise((res, rej) => {
      off = directOnFile((meta, path, err) => {
        if (meta.kind !== 'scoresrc' || meta.sid !== id || String(meta.stamp) !== String(stamp)) return;
        if (err || !path) { rej(new Error(err || 'failed')); return; }
        res(path);
      });
      timer = setTimeout(() => rej(new Error('timeout')), ms);
    });
    p.finally(() => { clearTimeout(timer); if (off) off(); }).catch(() => {});
    return p;
  }
  async function fetchSrc(s, info, stamp, onPage, halt) {
    const t0 = Date.now();
    let have = await db.get('files', srcKey(s.id, stamp)).catch(() => null);
    if (!(have && have.data && (have.data.byteLength || have.data.size))) {
      if (onPage) onPage(0, info.n);
      const arrived = waitFile(s.id, stamp, 180000);
      await askIpad({ what: 'src', id: s.id }, 180000);
      const path = await arrived;
      halt();
      const buf = await (await fetch(path)).arrayBuffer();
      try { window.webkit.messageHandlers.standDone.postMessage({ path }); } catch {}
      if (!buf.byteLength || (info.src.size && buf.byteLength !== info.src.size)) throw new Error('size');
      // (it must open: a file that does not is never kept)
      const test = await openDocument({ id: verKey(s.id, stamp) + 'src', kind: 'pdf', data: buf }, null);
      try { test.destroy(); } catch {}
      await db.put('files', { id: srcKey(s.id, stamp), kind: 'pdf', data: buf });
      have = true;
    }
    halt();
    // the markings, page by page (only the pages that have some)
    const inkP = info.src.ink || [];
    for (let k = 0; k < inkP.length; k++) {
      const i = inkP[k];
      if (await db.get('files', inkKey(s.id, stamp, i)).catch(() => null)) continue;
      const d = await askIpad({ what: 'ink', id: s.id, i, w: 2400 }, 30000);
      halt();
      await db.put('files', { id: inkKey(s.id, stamp, i), kind: 'ipadink', ink: d && d.ink ? await toBlob(d.ink) : null });
      if (onPage) onPage(Math.round(((k + 1) / inkP.length) * info.n), info.n);
    }
    halt();
    const copy = { id: copyId(s.id), kind: 'ipadcopy', mode: 'pdf', stamp, title: s.title, n: info.n, struct: info.src.struct || {}, ink: inkP, at: Date.now() };
    await db.put('files', copy);
    nlog('iPhone: a score came as a file (' + info.n + ' pages, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    if (PS.view && PS.view.copy && PS.view.copy.id === copy.id) { PS.view.copy = copy; PS.view.i = Math.min(PS.view.i, copy.n - 1); }
    const mine = verKey(s.id, stamp);
    for (const k of (await db.keys('files').catch(() => [])).map(String)) if (k.startsWith(copyId(s.id) + ':') && !k.startsWith(mine)) await db.del('files', k).catch(() => {});
    if (onPage) onPage(info.n, info.n);
    prepareSoon(copy);
    return copy;
  }
  // The PDF open here (one score at a time; closed when not used for a while)
  const PDOC = { key: null, p: null, t: 0, timer: 0 };
  function pdfClose() { const p = PDOC.p; clearInterval(PDOC.timer); PDOC.key = null; PDOC.p = null; if (p) p.then((d) => { try { d.base.destroy(); } catch {} }, () => {}); }
  function pdfDoc(copy) {
    const key = copy.id + ':' + copy.stamp;
    PDOC.t = Date.now();
    if (PDOC.key === key && PDOC.p) return PDOC.p;
    pdfClose();
    PDOC.key = key;
    const p = PDOC.p = (async () => {
      const src = await db.get('files', srcKey(copy.id.slice(9), copy.stamp));
      if (!src || !src.data) throw new Error('nosrc');
      const st = copy.struct || {};
      const data = src.data instanceof Blob ? await src.data.arrayBuffer() : src.data;
      const base = await openDocument({ id: verKey(copy.id.slice(9), copy.stamp) + 'src', kind: 'pdf', data, ...(st.rot ? { rot: st.rot } : {}) }, st.sizes || null);
      return { base, doc: mapDoc(base, st.pageMap || null, st.cuts || null, st.glue || null) };
    })();
    p.catch(() => { if (PDOC.p === p) { PDOC.key = null; PDOC.p = null; } });
    PDOC.timer = setInterval(() => { if (Date.now() - PDOC.t > 40000 && !JQ.running) pdfClose(); }, 10000);
    return p;
  }
  // All drawing from the PDF one job at a time (memory), the ones for what is on show first:
  // priority 0 Play now, 1 the page being read, 2 ahead of Play, 5 made ready in the background.
  const JQ = { list: [], running: false };
  function job(pri, key, fn) {
    const had = JQ.list.find((j) => j.key === key);
    if (had) { had.pri = Math.min(had.pri, pri); return had.p; }
    let res, rej; const p = new Promise((a, b) => { res = a; rej = b; });
    JQ.list.push({ pri, key, fn, res, rej, p, at: JQ.seq = (JQ.seq || 0) + 1 });
    if (!JQ.running) runJobs();
    return p;
  }
  async function runJobs() {
    JQ.running = true;
    while (JQ.list.length) {
      JQ.list.sort((a, b) => a.pri - b.pri || a.at - b.at);
      const j = JQ.list.shift();
      try { j.res(await j.fn()); } catch (e) { j.rej(e); }
      PDOC.t = Date.now();
      await new Promise((r) => setTimeout(r, 0));
    }
    JQ.running = false;
  }
  const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
  // a page of a PDF copy, drawn here at the iPhone's size and kept (the next time it opens at once)
  function pdfPage(copy, i, pri = 1) {
    const id = copy.id.slice(9);
    return job(pri, 'pg:' + copy.id + ':' + copy.stamp + ':' + i, async () => {
      const kept = await db.get('files', pageKey(id, i, copy.stamp)).catch(() => null);
      if (kept && kept.img) return kept;
      const { doc } = await pdfDoc(copy);
      if (!(i >= 0 && i < doc.pages)) return null;
      const [pw, ph] = doc.sizes[i], W = 1242, H = Math.round((W * ph) / pw);
      const c = document.createElement('canvas');
      try { await doc.render(i, c, W, H); } catch { c.width = c.height = 0; return null; }
      const img = await canvasBlob(c, 'image/jpeg', 0.86); c.width = c.height = 0;
      if (!img) return null;
      const ik = (copy.ink || []).includes(i) ? await db.get('files', inkKey(id, copy.stamp, i)).catch(() => null) : null;
      const rec = { id: pageKey(id, i, copy.stamp), kind: 'ipadpage', stamp: copy.stamp, w: W, h: H, img, ink: (ik && ik.ink) || null };
      await db.put('files', rec).catch(() => {});
      return rec;
    });
  }
  // Play's lines of a page of a PDF copy: the page drawn big (sharp on the iPhone held sideways),
  // its lines found on a smaller copy, each cut out as the iPad does it; kept.
  function pdfPlay(copy, i, pri = 2) {
    const id = copy.id.slice(9);
    return job(pri, 'pl:' + copy.id + ':' + copy.stamp + ':' + i, async () => {
      const kept = await db.get('files', playKey(copy, i)).catch(() => null);
      if (kept && kept.kind === 'pdfplay' && Array.isArray(kept.lines)) return kept.lines;
      const T0 = performance.now();
      const { doc } = await pdfDoc(copy);
      if (!(i >= 0 && i < doc.pages)) return [];
      const [pw, ph] = doc.sizes[i], W = 2400, H = Math.round((W * ph) / pw);
      const c = document.createElement('canvas');
      try { await doc.render(i, c, W, H); } catch { c.width = c.height = 0; return null; }
      const T1 = performance.now();
      const W0 = 1700, c0 = document.createElement('canvas'); c0.width = W0; c0.height = Math.round((W0 * ph) / pw);
      const g0 = c0.getContext('2d'); g0.imageSmoothingQuality = 'high'; g0.drawImage(c, 0, 0, c0.width, c0.height);
      let found = null;
      if (!PP.threadBroken) { try { found = await linesInThread(await createImageBitmap(c0)); } catch {} }
      if (found === null) {
        PP.threadBroken = true;
        try { const [{ analyse }, { linesOf }] = await Promise.all([import('./omr.js'), import('./picker-lines.js')]); found = linesOf(await analyse(c0, false, false, { stavesOnly: true })); } catch { found = []; }
      }
      c0.width = c0.height = 0;
      const T2 = performance.now();
      const Ls = cleanLines(found || []);
      const ikRec = (copy.ink || []).includes(i) ? await db.get('files', inkKey(id, copy.stamp, i)).catch(() => null) : null;
      const inkB = ikRec && ikRec.ink ? await createImageBitmap(ikRec.ink).catch(() => null) : null;
      const out = [];
      const pg = c.getContext('2d', { willReadFrequently: true });
      const edges = Ls.length ? cleanEdges(pg, W, H, Ls) : [];
      for (let li = 0; li < Ls.length; li++) {
        const L = Ls[li], E = edges[li];
        const sx = E.sx, sy = E.a, sw = E.sw, sh = Math.max(1, E.b - E.a);
        const lc = document.createElement('canvas'); lc.width = Math.round(sw); lc.height = Math.round(sh);
        const lg = lc.getContext('2d', { alpha: false, willReadFrequently: true }); lg.drawImage(c, sx, sy, sw, sh, 0, 0, lc.width, lc.height);
        try { eraseCrossings(lg, lc.width, lc.height, pg, sx, sy, H); } catch {}
        // (a scan's grey paper made white, its ink kept)
        try {
          const id2 = lg.getImageData(0, 0, lc.width, lc.height), d = id2.data, hist = new Uint32Array(256);
          for (let q = 0; q < d.length; q += 16) hist[(d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) | 0]++;
          let tot = 0; for (const x of hist) tot += x; let acc = 0, paper = 255; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > tot * 0.4) { paper = v; break; } }
          if (paper < 252 && paper > 120) { const k = 255 / paper; for (let q = 0; q < d.length; q += 4) { d[q] = Math.min(255, d[q] * k); d[q + 1] = Math.min(255, d[q + 1] * k); d[q + 2] = Math.min(255, d[q + 2] * k); } lg.putImageData(id2, 0, 0); }
        } catch {}
        const img = await canvasBlob(lc, 'image/jpeg', 0.84);
        let ink = null;
        if (inkB) { const kc = document.createElement('canvas'); kc.width = lc.width; kc.height = lc.height; kc.getContext('2d').drawImage(inkB, (sx / W) * inkB.width, (sy / H) * inkB.height, (sw / W) * inkB.width, (sh / H) * inkB.height, 0, 0, kc.width, kc.height); ink = await canvasBlob(kc, 'image/png'); kc.width = kc.height = 0; }
        lc.width = lc.height = 0;
        out.push({ w: Math.round(sw), h: Math.round(sh), sx, pw: W, ...(L.top !== undefined ? { st: L.top * H - sy, sb: L.bot * H - sy } : {}), img, ink });
      }
      c.width = c.height = 0;
      try { inkB && inkB.close(); } catch {}
      await db.put('files', { id: playKey(copy, i), kind: 'pdfplay', lines: out }).catch(() => {});
      (window.__ppT = window.__ppT || []).push([i, Math.round(T1 - T0), Math.round(T2 - T1), Math.round(performance.now() - T2)]);
      return out;
    });
  }
  // a score that came as a file: every page and its lines made ready in the background, so the
  // score opens and Play goes on at once (the first pages first)
  const PREP = new Set();
  function prepareSoon(copy) {
    const k = copy.id + ':' + copy.stamp; if (PREP.has(k)) return; PREP.add(k);
    (async () => {
      for (let i = 0; i < copy.n; i++) { await pdfPage(copy, i, 5).catch(() => {}); await pdfPlay(copy, i, 5).catch(() => {}); }
      nlog('iPhone: a score is ready to play (' + copy.n + ' pages)');
    })().finally(() => PREP.delete(k));
  }
  // every score not yet on the iPhone (or changed on the iPad since), one after another
  async function syncAll() {
    if (PS.sync) { PS.again = true; return; }
    if (!PS.list) return;
    PS.again = false;
    const have = await haveCopies();
    // (a score kept here as page pictures, from before: fetched again once as its own file, when the
    // iPad offers it, so Play is quick on it too; one the iPad cannot send that way stays as it is)
    const upgrade = new Set();
    if (fileLinkOk()) for (const k of (await db.keys('files').catch(() => [])).map(String).filter((k) => /^ipadcopy:[^:]+$/.test(k))) {
      const f = await db.get('files', k).catch(() => null);
      if (f && f.mode !== 'pdf' && !f.noSrc) upgrade.add(k.slice(9));
    }
    const want = PS.list.filter((s) => !PS.removed.has(s.id) && (have.get(s.id) !== s.stamp || upgrade.has(s.id)));
    if (!want.length) return;
    PS.sync = { n: want.length, done: 0, failed: 0 }; sub(); nlog('iPhone: fetching ' + want.length + ' score(s) from the iPad');
    // (leaving the app for a moment does not stop it: iOS gives the newer apps some time)
    try { window.__nativeBusy && window.__nativeBusy(true, 'download'); } catch {}
    for (const s of want) {
      if (PS.removed.has(s.id)) { PS.sync.done++; continue; }
      try { await fetchScore(s, (k, n) => { PS.sync.page = k ? `${s.title} · page ${k} of ${n}` : s.title; sub(); }); } catch (e) {
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
      try { copy = await fetchScore(s, (k, n) => { if (!me.stop) $('#phsLoadingText').textContent = k ? `Getting page ${k} of ${n}…` : 'Getting it from your iPad…'; }, () => me.stop); } catch (e) {
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
    viewer.hidden = false; $('#phvTitle').textContent = s.title; if (window.__sendFace) window.__sendFace();
    if (copy && copy.mode === 'pdf') prepareSoon(copy);
    $('#phvInk').hidden = false;
    drawPage();
  }
  const countOf = (copy) => copy.n || (copy.pages ? copy.pages.length : 0);
  const pageOf = async (copy, i) => {
    if (copy.pages) return copy.pages[i];
    if (copy.mode === 'pdf') return pdfPage(copy, i, PP.open ? 2 : 1).catch(() => null);
    const id = copy.id.slice(9);
    return (await db.get('files', pageKey(id, i, copy.stamp)).catch(() => null)) || db.get('files', oldPageKey(id, i)).catch(() => null);
  };
  let zoomHeld = () => false, pzResetHook = () => {};
  async function drawPage() {
    const v = PS.view; if (!v) return;
    pzResetHook();
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
      // (drawn here from the PDF: drawn again the next time, nothing to ask the iPad for)
      if (v.copy.mode === 'pdf') { await db.del('files', pageKey(id, i0, v.copy.stamp)).catch(() => {}); return; }
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
  window.__phoneViewer = { active: () => !viewer.hidden, wink: (eye) => { if (!PP.open) go(eye === 'right' ? 1 : -1); } };
  const go = (d) => { const v = PS.view; if (!v) return; const i = Math.max(0, Math.min(countOf(v.copy) - 1, v.i + d)); if (i !== v.i) { v.i = i; drawPage(); } };
  $('#phvClose').addEventListener('click', () => { if (PP.open) ppClose(); viewer.hidden = true; PS.view = null; if (window.__sendFace) window.__sendFace(); for (const u of PS.urls) URL.revokeObjectURL(u); PS.urls = []; });
  $('#phvInk').addEventListener('click', () => { PS.ink = !PS.ink; drawPage(); });
  let sx = null, sy = 0;
  const stage = $('#phvStage');
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null || zoomHeld()) { sx = null; return; } const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { const r = stage.getBoundingClientRect(); go(e.clientX > r.left + r.width * 0.4 ? 1 : -1); }
  });
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    // (a page-turning pedal sends these keys)
    const fwd = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key), back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (PP.open) { if (fwd) { e.preventDefault(); ppStep(1); } else if (back) { e.preventDefault(); ppStep(-1); } else if (e.key === 'Escape') ppClose(); return; }
    if (fwd) { e.preventDefault(); go(1); } if (back) { e.preventDefault(); go(-1); } if (e.key === 'Escape') $('#phvClose').click();
  });

  // ---------- zoom: pinch the page, drag it around; back to the whole page on turning ----------
  const PZ = { s: 1, x: 0, y: 0, pts: new Map(), used: false, lastTap: 0 };
  const box = $('#phvPageBox');
  stage.classList.add('zoomable');
  const pzApply = () => { box.style.transform = PZ.s > 1.001 ? `translate(${PZ.x}px, ${PZ.y}px) scale(${PZ.s})` : ''; };
  const pzReset = () => { PZ.s = 1; PZ.x = 0; PZ.y = 0; pzApply(); };
  const pzClamp = () => {
    const r = box.getBoundingClientRect(), w = r.width / PZ.s, h = r.height / PZ.s, sr = stage.getBoundingClientRect();
    // (the page never leaves the screen)
    PZ.x = Math.min(sr.width * 0.4, Math.max(-(w * PZ.s - sr.width * 0.6), PZ.x));
    PZ.y = Math.min(sr.height * 0.4, Math.max(-(h * PZ.s - sr.height * 0.6), PZ.y));
    if (PZ.s <= 1.001) { PZ.x = 0; PZ.y = 0; }
  };
  // a point on the screen as a point of the page (before the zoom)
  let base = null;
  const zoomAt = (fx, fy, s1) => {
    if (!base) { const t = box.style.transform; box.style.transform = ''; const r = box.getBoundingClientRect(); base = { x: r.left, y: r.top }; box.style.transform = t; }
    const lx = (fx - base.x - PZ.x) / PZ.s, ly = (fy - base.y - PZ.y) / PZ.s;
    PZ.s = Math.max(1, Math.min(4, s1));
    PZ.x = fx - base.x - lx * PZ.s; PZ.y = fy - base.y - ly * PZ.s;
    pzClamp(); pzApply();
  };
  let pinch = null, pan = null;
  stage.addEventListener('pointerdown', (e) => {
    PZ.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (PZ.pts.size === 1) { PZ.used = false; base = null; pan = { x: e.clientX, y: e.clientY, px: PZ.x, py: PZ.y }; }
    if (PZ.pts.size === 2) {
      const [a, b] = [...PZ.pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: PZ.s }; PZ.used = true; pan = null;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!PZ.pts.has(e.pointerId)) return;
    PZ.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && PZ.pts.size >= 2) {
      const [a, b] = [...PZ.pts.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    } else if (pan && PZ.s > 1.001) {
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) PZ.used = true;
      PZ.x = pan.px + dx; PZ.y = pan.py + dy; pzClamp(); pzApply();
    }
  });
  const pzUp = (e) => {
    PZ.pts.delete(e.pointerId);
    if (PZ.pts.size < 2) pinch = null;
    if (PZ.pts.size === 0) {
      if (PZ.s < 1.05) pzReset();
      // (the gesture is over: the next one starts afresh; a tap still turns the page as before)
      setTimeout(() => { if (PZ.pts.size === 0) PZ.used = false; }, 0);
    }
  };
  stage.addEventListener('pointerup', pzUp); stage.addEventListener('pointercancel', pzUp);
  // (zoomed in, a drag moves the page and a tap does not turn it)
  zoomHeld = () => PZ.used || PZ.s > 1.05;
  pzResetHook = pzReset;

  // ---------- Play: the music two lines at a time, as big as the iPhone held sideways allows ----------
  // Only the lines of music (no titles, no text), two at a time; a tap, a wink or the pedal brings
  // the next two, across the pages. Each line comes from the iPad drawn on its own, sharp, from the
  // score itself, and is kept here: the next time it opens at once. Away from the iPad, the lines
  // are cut from the pages already here.
  const PP = { open: false, p: 0, k: 0, quietT: 0, st: null };
  const halves = [{ y0: 0, y1: 0.5, x0: 0, x1: 1 }, { y0: 0.5, y1: 1, x0: 0, x1: 1 }];
  let LW2 = null, lwSeq2 = 0; const lwWait2 = new Map();
  const linesInThread = (bmp) => new Promise((res) => {
    try {
      if (!LW2) {
        LW2 = new Worker(new URL('./picker-worker.js', import.meta.url), { type: 'module' });
        LW2.onmessage = (e) => { const d = e.data || {}; const w = lwWait2.get(d.id); if (!w) return; lwWait2.delete(d.id); clearTimeout(w.t); w.res(d.error ? null : d.lines || []); };
        LW2.onerror = () => { for (const w of lwWait2.values()) { clearTimeout(w.t); w.res(null); } lwWait2.clear(); try { LW2.terminate(); } catch {} LW2 = null; };
      }
      const id = ++lwSeq2;
      const t = setTimeout(() => { lwWait2.delete(id); try { LW2.terminate(); } catch {} LW2 = null; res(null); }, 15000);
      lwWait2.set(id, { res, t });
      LW2.postMessage({ id, page: bmp, light: true }, [bmp]);
    } catch { res(null); }
  });
  // (away from the iPad: the lines found here, on the page picture)
  async function linesOfPage(copy, i) {
    const S = PP.st; if (S && S.lines.has(i)) return S.lines.get(i);
    const p = await pageOf(copy, i); if (!p || !p.img) return [];
    let found = null;
    if (!PP.threadBroken) { try { found = await linesInThread(await createImageBitmap(p.img)); } catch {} }
    // (no thread for it on this iPhone: read here, as Capture does; a moment, once per page)
    if (found === null) {
      PP.threadBroken = true;
      try {
        const [{ analyse }, { linesOf }] = await Promise.all([import('./omr.js'), import('./picker-lines.js')]);
        const bmp = await createImageBitmap(p.img); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0); try { bmp.close(); } catch {}
        found = linesOf(await analyse(c, false, false, { stavesOnly: true })); c.width = c.height = 0;
      } catch { found = []; }
    }
    // (a page with no music on it, a title page, is passed over)
    const lines = cleanLines(found || []);
    if (S && PP.st === S) S.lines.set(i, lines);
    return lines;
  }
  const dataBlob = async (u) => (u ? (await fetch(u)).blob() : null);
  const playKey = (copy, i) => copy.id + ':s' + copy.stamp + ':play11-' + i;   // (kept with the version's pages, gone with them)
  // Everything Play knows of one score, in one place: when another score is opened, a line still on
  // its way for the one before can never land in it.
  const newState = (copy) => ({ key: copy.id + ':' + copy.stamp, copy, pages: new Map(), loading: new Map(), bmp: new Map(), lines: new Map() });
  PP.st = null;
  // the lines of page i: [{ img, ink, w, h, sx, pw, st, sb }], [] for a page with no music, null
  // when it could not be had just now (the iPad busy, the page not here yet: asked again later)
  async function playLines(copy, i) {
    const S = PP.st; if (!S || S.copy !== copy) return null;
    if (S.pages.has(i)) return S.pages.get(i);
    if (S.loading.has(i)) return S.loading.get(i);
    const job = (async () => {
      // (a score that came as a file: its lines are made here, from the PDF, sharp; no iPad needed)
      if (copy.mode === 'pdf') return pdfPlay(copy, i, PP.open && Math.abs(i - PP.p) <= 1 ? 0 : 2);
      const kept = await db.get('files', playKey(copy, i)).catch(() => null);
      if (kept && Array.isArray(kept.lines) && kept.kind !== 'localplay') return kept.lines;
      // from the iPad, sharp (busy a moment: asked again); lines made here before are kept, and
      // replaced by the iPad's when it is there
      for (let tries = 0; tries < (kept ? 1 : 3); tries++) {
        try {
          const d = await askIpad({ what: 'lines', id: copy.id.slice(9), i }, kept ? 4000 : 30000);
          if (d && Array.isArray(d.lines)) {
            const lines = [];
            for (const L of d.lines) lines.push({ w: L.w, h: L.h, sx: L.sx, pw: L.pw, st: L.st, sb: L.sb, img: await dataBlob(L.img), ink: await dataBlob(L.ink) });
            await db.put('files', { id: playKey(copy, i), kind: 'ipadplay', lines }).catch(() => {});
            return lines;
          }
        } catch (e) { if (kept || !/busy/.test(String(e && e.message))) break; }
        if (PP.st !== S) return null;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (kept && Array.isArray(kept.lines)) return kept.lines;
      // here, from the page picture (kept, so the next time it opens at once)
      const p = await pageOf(copy, i).catch(() => null); if (!p || !p.img) return null;
      const Ls = await linesOfPage(copy, i);
      const bmp = await createImageBitmap(p.img).catch(() => null); if (!bmp) return null;
      const inkB = p.ink ? await createImageBitmap(p.ink).catch(() => null) : null;
      const out = [];
      const pc = document.createElement('canvas'); pc.width = bmp.width; pc.height = bmp.height;
      const pg = pc.getContext('2d', { willReadFrequently: true }); pg.drawImage(bmp, 0, 0);
      const edges = cleanEdges(pg, bmp.width, bmp.height, Ls);
      for (let li = 0; li < Ls.length; li++) {
        const L = Ls[li], E = edges[li];
        const sx = E.sx, sy = E.a, sw = E.sw, sh = Math.max(1, E.b - E.a);
        const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
        c.getContext('2d', { willReadFrequently: true }).drawImage(pc, sx, sy, sw, sh, 0, 0, c.width, c.height);
        try { eraseCrossings(c.getContext('2d', { willReadFrequently: true }), c.width, c.height, pg, sx, sy, bmp.height); } catch {}
        const img = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        let ink = null;
        if (inkB) { c.getContext('2d').clearRect(0, 0, c.width, c.height); c.getContext('2d').drawImage(inkB, sx / bmp.width * inkB.width, sy / bmp.height * inkB.height, sw / bmp.width * inkB.width, sh / bmp.height * inkB.height, 0, 0, c.width, c.height); ink = await new Promise((r) => c.toBlob(r, 'image/png')); }
        out.push({ w: c.width, h: c.height, sx, pw: bmp.width, ...(L.top !== undefined ? { st: L.top * bmp.height - sy, sb: L.bot * bmp.height - sy } : {}), img, ink }); c.width = c.height = 0;
      }
      pc.width = pc.height = 0;
      try { bmp.close(); inkB && inkB.close(); } catch {}
      await db.put('files', { id: playKey(copy, i), kind: 'localplay', lines: out }).catch(() => {});
      return out;
    })();
    S.loading.set(i, job);
    const lines = await job.catch(() => null);
    S.loading.delete(i);
    if (PP.st === S && Array.isArray(lines)) S.pages.set(i, lines);
    return lines;
  }
  // (a page that could not be had: tried again a few times, then passed over for now)
  async function linesSure(copy, i) {
    for (let t = 0; t < 4; t++) { const L = await playLines(copy, i); if (Array.isArray(L)) return L; if (!PP.open) return []; await new Promise((r) => setTimeout(r, 1200)); }
    return [];
  }
  // Only lines of the score's own music: a line far smaller than the others, or much shorter (the
  // examples in a page of text, a footnote), is left out, once enough of the score is known.
  function goodOf(S) {
    let n0 = 0; for (const L of S.pages.values()) n0 += L.length;
    const key = S.pages.size + ':' + n0;
    if (S.goodKey !== key) { S.goodKey = key; S.good = goodMake(S); }
    return S.good;
  }
  function goodMake(S) {
    const hs = [], ws = [];
    for (const L of S.pages.values()) for (const q of L) { const pw = q.pw || q.w; ws.push(q.w / pw); if (q.st !== undefined && q.sb !== undefined) hs.push((q.sb - q.st) / pw); }
    if (ws.length < 5) return () => true;
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const mw = med(ws), mh = hs.length >= 5 ? med(hs) : 0;
    return (q) => { const pw = q.pw || q.w; if (q.w / pw < mw * 0.6) return false; if (mh && q.st !== undefined && q.sb !== undefined) { const h = (q.sb - q.st) / pw; if (h < mh * 0.72 || h > mh * 1.6) return false; } return true; };
  }
  // the line n good lines after (p, k), across pages, or null at either end
  async function after(copy, p, k, n) {
    const S = PP.st; if (!S) return null;
    const N = countOf(copy); let left = Math.abs(n); const dir = n >= 0 ? 1 : -1;
    let L = await linesSure(copy, p), q = k;
    for (let guard = 0; guard < 4000; guard++) {
      if (left === 0) { if (q >= 0 && q < L.length && goodOf(S)(L[q])) return { p, k: q }; left = 1; }
      q += dir;
      while (q < 0 || q >= L.length) {
        if (q >= L.length) { p++; if (p >= N) return null; L = await linesSure(copy, p); q = 0; }
        else { p--; if (p < 0) return null; L = await linesSure(copy, p); q = L.length - 1; }
        if (PP.st !== S) return null;
      }
      if (goodOf(S)(L[q])) left--;
    }
    return null;
  }
  // where a line is in the whole score (counting good lines from the start), when every page before
  // it is known; -1 otherwise
  function indexOf(at) {
    const S = PP.st; if (!S) return -1;
    const good = goodOf(S); let n = 0;
    for (let i = 0; i < at.p; i++) { const L = S.pages.get(i); if (!L) return -1; for (const q of L) if (good(q)) n++; }
    const L = S.pages.get(at.p); if (!L) return -1;
    for (let k = 0; k < at.k && k < L.length; k++) if (good(L[k])) n++;
    return n;
  }
  function atIndex(g) {
    const S = PP.st; if (!S) return null;
    const good = goodOf(S); let n = 0;
    for (let i = 0; i < countOf(S.copy); i++) { const L = S.pages.get(i); if (!L) return null; for (let k = 0; k < L.length; k++) if (good(L[k])) { if (n === g) return { p: i, k }; n++; } }
    return null;
  }
  // the screens start at line 0, n, 2n… of the whole score (switching between two and three
  // lines keeps the place and sets the screens out again from the start)
  function snapped(at) {
    const g = indexOf(at); if (g < 0) return at;
    const n = ppN(), g2 = Math.floor(g / n) * n;
    return atIndex(g2) || at;
  }
  async function bitmapOf(at, which) {
    const S = PP.st; if (!S) return null;
    const key = at.p + ':' + at.k + ':' + which;
    if (S.bmp.has(key)) return S.bmp.get(key);
    const L = (S.pages.get(at.p) || [])[at.k]; const b = L && L[which];
    const v = b ? await createImageBitmap(b).catch(() => null) : null;
    if (PP.st !== S) { try { v && v.close(); } catch {} return null; }
    S.bmp.set(key, v);
    // (only the few lines around are kept)
    while (S.bmp.size > 18) { const k0 = S.bmp.keys().next().value; const o = S.bmp.get(k0); S.bmp.delete(k0); try { o && o.close(); } catch {} }
    return v;
  }
  // how many lines at once: two or three (kept)
  const ppN = () => { try { return localStorage.getItem('standPlayN') === '3' ? 3 : 2; } catch { return 2; } };
  const lineOf = (at) => (at && PP.st ? (PP.st.pages.get(at.p) || [])[at.k] : null);
  // All the lines on the screen at one size (the size the widest takes across), each in its own
  // place, its staves in the middle of it; what reaches beyond its place is not drawn there.
  async function drawLines(cv, ats, still = () => true) {
    const dpr = Math.min(3, devicePixelRatio || 1), W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    const imgs = await Promise.all(ats.map((at) => (at ? bitmapOf(at, 'img') : null)));
    const inks = await Promise.all(ats.map((at) => (at && PS.ink ? bitmapOf(at, 'ink') : null)));
    // (a newer screen asked for meanwhile: this one is never drawn over it)
    if (!still()) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const Ls = ats.map(lineOf), n = ats.length, Hs = H / n;
    // (across: the lines' place on their pages, as parts of the page)
    const fr = Ls.map((L, q) => (L && imgs[q] ? { a: (L.sx ?? 0) / (L.pw || L.w), b: ((L.sx ?? 0) + L.w) / (L.pw || L.w) } : null));
    const known = fr.filter(Boolean); if (!known.length) return;
    const minX = Math.min(...known.map((f) => f.a)), maxX = Math.max(...known.map((f) => f.b));
    let kPage = (W * 0.97) / Math.max(1e-6, maxX - minX);
    // (and small enough for each line's staves, with room above and below, to fit its place)
    Ls.forEach((L, q) => { if (!L || !imgs[q]) return; const pw = L.pw || L.w; const staffH = L.st !== undefined && L.sb !== undefined ? L.sb - L.st : L.h * 0.45; const need = (staffH / pw) * kPage; if (need > Hs * 0.78) kPage *= (Hs * 0.78) / need; });
    const x0 = (W - (maxX - minX) * kPage) / 2;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    Ls.forEach((L, q) => {
      const img = imgs[q]; if (!L || !img) return;
      const pw = L.pw || L.w, k = kPage / pw;
      const dw = L.w * k, dh = L.h * k, dx = x0 + (fr[q].a - minX) * kPage;
      const mid = L.st !== undefined && L.sb !== undefined ? (L.st + L.sb) / 2 : L.h / 2;
      const top = q * Hs, dy = top + Hs / 2 - mid * k;
      g.save(); g.beginPath(); g.rect(0, top, W, Hs); g.clip();
      g.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
      if (inks[q]) g.drawImage(inks[q], dx, dy, dw, dh);
      g.restore();
    });
  }
  let drawTok = 0;
  async function ppDraw() {
    const v = PS.view; if (!v || !PP.open || !PP.st) return;
    const S = PP.st, tok = ++drawTok;
    const busyT = setTimeout(() => { if (tok === drawTok) $('#phpBusy').hidden = false; }, 200);
    let a = { p: PP.p, k: PP.k };
    // (enough of the score known first to tell its music from the examples in a page of text: the
    // pages after this one, until there are several lines)
    for (let q = a.p, known = 0; q < countOf(v.copy) && q < a.p + 4; q++) {
      known = 0; for (const L of S.pages.values()) known += L.length;
      if (known >= 8 && S.pages.size >= 2) break;
      await linesSure(v.copy, q);
      if (tok !== drawTok || PP.st !== S) return;
    }
    // (on a line of the score's music: the first one from here on)
    const L0 = await linesSure(v.copy, a.p);
    if (!(a.k < L0.length && goodOf(S)(L0[a.k]))) { const n = await after(v.copy, a.p, a.k, 0); if (n) a = n; }
    // (the screens set out from the start of the score only when Play opens or 2/3 is changed: after
    // that each screen follows the one before, so a line never stays behind or comes twice)
    if (PP.snap) { a = snapped(a); PP.snap = false; }
    PP.p = a.p; PP.k = a.k;
    const ats = [a]; for (let q = 1; q < ppN(); q++) ats.push(ats[q - 1] ? await after(v.copy, ats[q - 1].p, ats[q - 1].k, 1) : null);
    if (tok !== drawTok || PP.st !== S) return;
    await drawLines($('#phpC'), ats, () => tok === drawTok && PP.st === S);
    if (tok !== drawTok || PP.st !== S) return;
    clearTimeout(busyT); $('#phpBusy').hidden = true;
    $('#phpWhere').textContent = `Page ${a.p + 1} of ${countOf(v.copy)}`;
    window.__ppShown = ats.map((x) => (x ? x.p + ':' + x.k : null));   // (for the tests: what is on the screen)
    for (const b of document.querySelectorAll('#phpN button')) b.classList.toggle('on', +b.dataset.n === ppN());
    v.i = a.p;
  }
  // The whole score, page after page, made ready while Play is open (from the place it opened at,
  // then from the start), so the screens can be set out and every line is ready to go on to.
  async function readyAll(S) {
    const N = countOf(S.copy), order = [];
    for (let i = PP.p; i < N; i++) order.push(i);
    for (let i = 0; i < PP.p; i++) order.push(i);
    for (const i of order) { if (!PP.open || PP.st !== S) return; if (!S.pages.has(i)) await linesSure(S.copy, i).catch(() => {}); }
  }
  // (taps one after another, each from where the last one went: never two from the same place)
  function ppStep(d) {
    if ((PP.waiting || 0) >= 3) return PP.chain;
    PP.waiting = (PP.waiting || 0) + 1;
    PP.chain = (PP.chain || Promise.resolve()).then(() => ppStep1(d)).catch(() => {}).finally(() => { PP.waiting--; });
    return PP.chain;
  }
  async function ppStep1(d) {
    const v = PS.view; if (!v || !PP.open || !PP.st) return;
    const n = await after(v.copy, PP.p, PP.k, d * ppN());
    if (!n || !PP.open) return;
    PP.p = n.p; PP.k = n.k; ppDraw(); ppQuiet();
  }
  const ppQuiet = () => { const el = $('#phPlay'); el.classList.remove('quiet'); clearTimeout(PP.quietT); PP.quietT = setTimeout(() => el.classList.add('quiet'), 2500); };
  const orient = (lock) => { try { window.webkit.messageHandlers.standOrientation.postMessage({ lock }); } catch {} };
  const dropState = () => { const S = PP.st; PP.st = null; if (S) for (const o of S.bmp.values()) { try { o && o.close(); } catch {} } };
  async function ppOpen() {
    const v = PS.view; if (!v) return;
    PP.open = true; PP.p = v.i; PP.k = 0; PP.snap = true;
    // (another score, or another version of it: nothing of the one before is kept)
    if (!PP.st || PP.st.key !== v.copy.id + ':' + v.copy.stamp || PP.st.copy !== v.copy) { dropState(); PP.st = newState(v.copy); }
    const g = $('#phpC').getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, $('#phpC').width, $('#phpC').height);
    $('#phPlay').hidden = false; orient('landscape'); ppQuiet();
    window.__phonePlay = { active: true, wink: (eye) => ppStep(eye === 'right' ? 1 : -1) };
    if (window.__sendFace) window.__sendFace();
    await ppDraw();
    readyAll(PP.st);
  }
  function ppClose() {
    PP.open = false; $('#phPlay').hidden = true; orient('auto');
    window.__phonePlay = null; if (window.__sendFace) window.__sendFace();
    if (PP.st) { for (const o of PP.st.bmp.values()) { try { o && o.close(); } catch {} } PP.st.bmp.clear(); }
    drawPage();
  }
  $('#phvPlay').addEventListener('click', ppOpen);
  $('#phpClose').addEventListener('click', (e) => { e.stopPropagation(); ppClose(); });
  for (const b of document.querySelectorAll('#phpN button')) b.addEventListener('click', (e) => { e.stopPropagation(); try { localStorage.setItem('standPlayN', b.dataset.n); } catch {} PP.snap = true; ppDraw(); ppQuiet(); });
  {
    const pl = $('#phPlay'); let tx = null, ty = 0;
    pl.addEventListener('pointerdown', (e) => { if (e.target.closest('.php-close, .php-n')) { tx = null; return; } tx = e.clientX; ty = e.clientY; });
    pl.addEventListener('pointerup', (e) => {
      if (tx === null) return; const dx = e.clientX - tx, dy = e.clientY - ty; tx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { ppStep(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dy) > 40) { ppStep(dy < 0 ? 1 : -1); return; }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) ppStep(e.clientX > innerWidth * 0.3 ? 1 : -1);
    });
    addEventListener('resize', () => { if (PP.open) ppDraw(); });
  }

  // the list comes by itself whenever the iPad is found
  if (connected) connected(() => refresh(true));
  setTimeout(() => refresh(true), 2500);
  // (iOS stops the app in the background: back in it, the downloads go on from the page they had reached)
  let backAt = 0;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || PS.sync || Date.now() - backAt < 30000) return; backAt = Date.now(); setTimeout(() => refresh(true), 800); });
  return { refresh, openList };
}
