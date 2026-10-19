// iCloud key-value storage (iPad and iPhone apps): small things that follow you to your other
// devices with the same Apple ID, with no account to make. Used for practice time, so the iPhone
// shows what was practised on the iPad and the other way round. Nothing goes anywhere else: it is
// your own iCloud.
const H = () => (window.standCaps && window.standCaps.cloud && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standCloud) || null;
export const cloudAvailable = () => !!H();
const waiting = new Map();
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.standCloudValue = (key, value) => { const w = waiting.get(key); if (w) { waiting.delete(key); for (const f of w) f(value); } };
  window.standCloudChanged = (keys) => { for (const f of listeners) try { f(keys || []); } catch {} };
}
export function cloudSet(key, obj) {
  const h = H(); if (!h) return false;
  try { h.postMessage({ op: 'set', key, value: JSON.stringify(obj) }); return true; } catch { return false; }
}
export function cloudGet(key, timeout = 2500) {
  const h = H(); if (!h) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(t); let o = null; try { o = v ? JSON.parse(v) : null; } catch {} resolve(o); };
    const t = setTimeout(() => { const w = waiting.get(key); if (w) { w.delete(done); } resolve(null); }, timeout);
    if (!waiting.has(key)) waiting.set(key, new Set());
    waiting.get(key).add(done);
    try { h.postMessage({ op: 'get', key }); } catch { resolve(null); }
  });
}
export function onCloudChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
