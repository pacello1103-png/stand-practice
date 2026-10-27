// Small IndexedDB wrapper. Everything stays on the device.
const NAME = 'stand';
const VERSION = 1;
let opening;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('scores')) d.createObjectStore('scores', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('takes')) {
        const t = d.createObjectStore('takes', { keyPath: 'id' });
        t.createIndex('score', 'scoreId');
      }
      if (!d.objectStoreNames.contains('ink')) d.createObjectStore('ink', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => {
      const d = r.result;
      // (iOS can drop the connection while Stand is in the background: the next use opens it again)
      d.onclose = () => { if (opening === mine) opening = null; };
      d.onversionchange = () => { try { d.close(); } catch {} if (opening === mine) opening = null; };
      resolve(d);
    };
    r.onerror = () => { if (opening === mine) opening = null; reject(r.error); };
    r.onblocked = () => { /* waits for the other connection to close */ };
  });
  const mine = opening;
  return opening;
}
// one more try with a new connection when the old one was lost ("connection is closing",
// "Connection to Indexed Database server lost")
async function withDb(fn) {
  try { return await fn(await open()); }
  catch (e) {
    const n = String((e && (e.name + ' ' + e.message)) || '');
    if (!/InvalidState|closing|lost|UnknownError|TransactionInactive/i.test(n)) throw e;
    opening = null;
    return fn(await open());
  }
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export const db = {
  get(store, key) { return withDb((d) => wrap(d.transaction(store).objectStore(store).get(key))); },
  all(store) { return withDb((d) => wrap(d.transaction(store).objectStore(store).getAll())); },
  byIndex(store, index, value) { return withDb((d) => wrap(d.transaction(store).objectStore(store).index(index).getAll(value))); },
  put(store, value) { return withDb((d) => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(value); return done(tx); }); },
  del(store, key) { return withDb((d) => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); return done(tx); }); },
  keys(store) { return withDb((d) => wrap(d.transaction(store).objectStore(store).getAllKeys())); },
};

// (strict: a read that fails is an error, not the fallback, for what must not be written over)
export async function getSetting(k, fallback, strict = false) {
  try { const v = await db.get('kv', k); return v ? v.v : fallback; } catch (e) { if (strict) throw e; return fallback; }
}
export async function setSetting(k, v) {
  try { await db.put('kv', { k, v }); } catch { /* storage unavailable */ }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
