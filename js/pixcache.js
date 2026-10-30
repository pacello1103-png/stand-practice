// Drawn pages kept as pictures, so a PDF page that took a long time to draw (scans from IMSLP
// above all) shows at once the next time: when the score opens again, or when you come back to
// it. Kept in a small database of its own (never in backups); the oldest go first when it fills.
const NAME = 'stand-pix', MAX = 260;
let opening = null, known = null, count = 0;

function open() {
  if (opening) return opening;
  opening = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('p')) { const s = d.createObjectStore('p', { keyPath: 'k' }); s.createIndex('at', 'at'); }
      // (light copies of heavy scans: every page once, never pruned, dropped with the file)
      if (!d.objectStoreNames.contains('L')) d.createObjectStore('L', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch((e) => { opening = null; throw e; });
  return opening;
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

// the keys are read once, so "is it there?" never waits for the database
async function keys() {
  if (known) return known;
  try { const d = await open(); const ks = await wrap(d.transaction('p').objectStore('p').getAllKeys()); known = new Set(ks); count = ks.length; }
  catch { known = new Set(); }
  return known;
}
export async function pixHas(k) { return (await keys()).has(k); }
export async function pixGet(k) {
  if (!(await keys()).has(k)) return null;
  try {
    const d = await open();
    const v = await wrap(d.transaction('p').objectStore('p').get(k));
    if (!v) { known.delete(k); return null; }
    // used again: it is kept longer (written quietly, later)
    setTimeout(() => { open().then((d2) => { const tx = d2.transaction('p', 'readwrite'); tx.objectStore('p').put({ ...v, at: Date.now() }); }).catch(() => {}); }, 1500);
    return v.b;
  } catch { return null; }
}
export async function pixPut(k, b, f) {
  if (!b || !b.size) return;
  try {
    await keys();
    const d = await open();
    const tx = d.transaction('p', 'readwrite');
    tx.objectStore('p').put({ k, b, f, at: Date.now() });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    if (!known.has(k)) { known.add(k); count++; }
    if (count > MAX) prune();
  } catch { /* storage full or unavailable: pages are simply drawn again */ }
}
let pruning = false;
async function prune() {
  if (pruning) return; pruning = true;
  try {
    const d = await open();
    const tx = d.transaction('p', 'readwrite');
    const idx = tx.objectStore('p').index('at');
    let n = count - MAX + 30;
    await new Promise((res) => {
      const c = idx.openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur || n <= 0) { res(); return; } known.delete(cur.primaryKey); count--; n--; cur.delete(); cur.continue(); };
      c.onerror = () => res();
    });
  } catch {} finally { pruning = false; }
}
// ---- the light copy of a heavy scan: each page once as a picture of a sensible size, so the
// enormous original is not read again (reading one of its pages took hundreds of MB)
export async function lightGet(f, i) {
  try { const d = await open(); const v = await wrap(d.transaction('L').objectStore('L').get(f + '|' + i)); return v ? v.b : null; } catch { return null; }
}
export async function lightPut(f, i, b) {
  if (!b || !b.size) return;
  try { const d = await open(); const tx = d.transaction('L', 'readwrite'); tx.objectStore('L').put({ k: f + '|' + i, f, b, at: Date.now() }); await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); } catch {}
}
export async function lightKeys(f) {
  try { const d = await open(); const ks = await wrap(d.transaction('L').objectStore('L').getAllKeys()); return new Set(ks.filter((k) => String(k).startsWith(f + '|')).map((k) => +String(k).slice(f.length + 1))); } catch { return new Set(); }
}
export async function lightDel(f, i) {
  try { const d = await open(); const tx = d.transaction('L', 'readwrite'); tx.objectStore('L').delete(f + '|' + i); } catch {}
}
export async function pixDel(k) {
  try { const d = await open(); const tx = d.transaction('p', 'readwrite'); tx.objectStore('p').delete(k); if (known) { if (known.delete(k)) count--; } } catch {}
}
async function lightDrop(f) {
  try { const d = await open(); const ks = (await wrap(d.transaction('L').objectStore('L').getAllKeys())).filter((k) => String(k).startsWith(f + ':') || String(k).startsWith(f + '|')); if (!ks.length) return; const tx = d.transaction('L', 'readwrite'); for (const k of ks) tx.objectStore('L').delete(k); } catch {}
}
// a score's file was replaced or deleted: its pictures go too
export async function pixDropFile(f) {
  lightDrop(f);
  try {
    const ks = [...(await keys())].filter((k) => k.startsWith(f + ':'));
    if (!ks.length) return;
    const d = await open(); const tx = d.transaction('p', 'readwrite'); const s = tx.objectStore('p');
    for (const k of ks) { s.delete(k); known.delete(k); count--; }
  } catch {}
}
export async function pixClear() {
  try { const d = await open(); const tx = d.transaction(['p', 'L'], 'readwrite'); tx.objectStore('p').clear(); tx.objectStore('L').clear(); known = new Set(); count = 0; } catch {}
}
