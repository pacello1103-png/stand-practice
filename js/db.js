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
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return opening;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export const db = {
  async get(store, key) { const d = await open(); return wrap(d.transaction(store).objectStore(store).get(key)); },
  async all(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); },
  async byIndex(store, index, value) { const d = await open(); return wrap(d.transaction(store).objectStore(store).index(index).getAll(value)); },
  async put(store, value) { const d = await open(); const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(value); return done(tx); },
  async del(store, key) { const d = await open(); const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); return done(tx); },
  async keys(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAllKeys()); },
};

export async function getSetting(k, fallback) {
  try { const v = await db.get('kv', k); return v ? v.v : fallback; } catch { return fallback; }
}
export async function setSetting(k, v) {
  try { await db.put('kv', { k, v }); } catch { /* storage unavailable */ }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
