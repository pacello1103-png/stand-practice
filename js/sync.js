// Practice time from the iPad on the iPhone. While Stand is open on the iPad, it can be found
// (on the same Wi-Fi by itself, anywhere once the two have met, or with a six-digit code).
// The iPhone asks; the iPad answers with its practice log and the names of its pieces, straight
// from device to device. Only the connection details pass through the meeting service.
import { Signal, ICE, LS, myPairKey, roomName, DIRECT, DirectBox, directPeers, directWatch, knownPairs } from './link.js';

const TAG = { standPractice: 1 };
const PART = 15000, DPART = 60000;
const newCode = () => String(Math.floor(100000 + Math.random() * 900000));
export const pairId = (key) => 'stand-pp-' + key;
export const codeId = (code) => 'stand-pc-' + code;
// the iPads met for practice, and the ones linked as a camera (the same iPad key)
const knownIpads = () => { let l = []; try { l = JSON.parse(LS.get('standPracticeIpads') || '[]'); } catch {} for (const k of knownPairs()) if (!l.includes(k)) l.push(k); return l.slice(0, 5); };
const rememberIpad = (key) => { const l = knownIpads().filter((k) => k !== key); l.unshift(key); LS.set('standPracticeIpads', JSON.stringify(l.slice(0, 3))); };
export const hasKnownIpad = () => knownIpads().length > 0;

// ---------- on the iPad ----------
export class PracticeHost {
  // getData: the practice; answer(q): anything else the iPhone asks for (its scores, to read)
  constructor(getData, answer) { this.getData = getData; this.answer = answer; this.sigs = []; this.pcs = new Map(); this.on = false; this.code = null; this.onShared = null; }
  async start() {
    if (this.on) return; this.on = true;
    // the apps: the iPhone asks over the direct link, and the answer goes straight back
    if (DIRECT() && !this.box) {
      this.box = new DirectBox('stand-dpp-host', async (m) => {
        if (m.type === 'SC_ASK' && this.on && this.answer) {
          const rid = (m.payload || {}).rid;
          try {
            const json = JSON.stringify(await this.answer((m.payload || {}).q || {}));
            // (bigger pieces on the direct link: fewer messages, a page crosses several times faster)
            const n = Math.ceil(json.length / DPART);
            for (let o = 0, k = 0; o < json.length; o += DPART, k++) { this.box.send(m.src, 'SC_PART', { rid, k, s: json.slice(o, o + DPART) }); if (k % 8 === 7) await new Promise((r) => setTimeout(r, 10)); }
            this.box.send(m.src, 'SC_END', { rid, n });
          } catch (e) { this.box.send(m.src, 'SC_ERR', { rid, why: String((e && e.message) || '') }); }
          return;
        }
        if (m.type !== 'PP_ASK' || !this.on) return;
        try {
          const json = JSON.stringify(await this.getData());
          this.box.send(m.src, 'PP_PAIR', { key: myPairKey() });
          for (let o = 0, k = 0; o < json.length; o += PART, k++) this.box.send(m.src, 'PP_PART', { k, s: json.slice(o, o + PART) });
          this.box.send(m.src, 'PP_END', { n: Math.ceil(json.length / PART) });
          this.onShared && this.onShared();
        } catch { this.box.send(m.src, 'PP_ERR', {}); }
      });
      this.box.open();
    }
    const ids = [pairId(myPairKey())];
    try { const room = await roomName(); if (room) ids.push(room + '-pp'); } catch {}
    for (const id of ids) await this._listen(id);
    if (!this.on) this.stop();
  }
  async _listen(id, again = true) {
    // if the meeting service drops the line, listen again a little later
    const retry = () => { if (again && this.on) setTimeout(() => { if (this.on && !this.sigs.some((x) => x.id === id)) this._listen(id); }, 20000); };
    const sig = new Signal(id, (m) => this._msg(sig, m), () => { const had = this.sigs.includes(sig); this.sigs = this.sigs.filter((x) => x !== sig); if (had) retry(); });
    try { await sig.open(); this.sigs.push(sig); return sig; } catch { sig.close(); retry(); return null; }
  }
  // a code for when the two are on different networks and have never met
  async showCode() {
    if (this.codeSig) return this.code;
    for (let i = 0; i < 3; i++) {
      const code = newCode(); const sig = await this._listen(codeId(code), false);
      if (sig) { this.code = code; this.codeSig = sig; return code; }
    }
    return null;
  }
  stop() {
    this.on = false;
    if (this.box) { this.box.close(); this.box = null; }
    for (const s of this.sigs) s.close(); this.sigs = []; this.codeSig = null; this.code = null;
    for (const pc of this.pcs.values()) try { pc.close(); } catch {} this.pcs.clear();
  }
  async _msg(sig, m) {
    const p = m.payload || {};
    if (m.type === 'OFFER' && p.standPractice && p.sdp) {
      const peer = m.src; const pc = new RTCPeerConnection({ iceServers: ICE }); this.pcs.set(peer, pc);
      pc.onicecandidate = (e) => { if (e.candidate) sig.send(peer, 'CANDIDATE', { ...TAG, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.ondatachannel = (e) => {
        const ch = e.channel;
        // a question (the scores, to read on the iPhone): answered in parts, as the practice is
        if (ch.label === 'stand-req') {
          ch.onmessage = async (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch { return; }
            if (m.t === 'thanks') { setTimeout(() => { try { pc.close(); } catch {} this.pcs.delete(peer); }, 300); return; }
            if (m.t !== 'ask' || !this.answer) return;
            try {
              const json = JSON.stringify(await this.answer(m.q || {}));
              for (let o = 0; o < json.length; o += PART) {
                // (the channel's buffer kept small: a big score is sent at the pace it goes)
                while (ch.bufferedAmount > 1 << 20) await new Promise((r) => setTimeout(r, 30));
                ch.send(JSON.stringify({ t: 'part', s: json.slice(o, o + PART) }));
              }
              ch.send(JSON.stringify({ t: 'end' }));
            } catch (e) { try { ch.send(JSON.stringify({ t: 'error', why: String((e && e.message) || '') })); } catch {} }
          };
          return;
        }
        ch.onopen = async () => {
          try {
            const json = JSON.stringify(await this.getData());
            ch.send(JSON.stringify({ t: 'pair', key: myPairKey() }));
            for (let o = 0; o < json.length; o += PART) ch.send(JSON.stringify({ t: 'part', s: json.slice(o, o + PART) }));
            ch.send(JSON.stringify({ t: 'end' }));
            this.onShared && this.onShared();
          } catch { try { ch.send(JSON.stringify({ t: 'error' })); } catch {} }
        };
        ch.onmessage = (ev) => { try { if (JSON.parse(ev.data).t === 'thanks') setTimeout(() => { try { pc.close(); } catch {} this.pcs.delete(peer); }, 300); } catch {} };
      };
      setTimeout(() => { if (this.pcs.get(peer) === pc && pc.connectionState !== 'connected') { try { pc.close(); } catch {} this.pcs.delete(peer); } }, 30000);
      try {
        await pc.setRemoteDescription(p.sdp);
        for (const c of (pc._pending || [])) await pc.addIceCandidate(c).catch(() => {});
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        sig.send(peer, 'ANSWER', { ...TAG, sdp: { type: ans.type, sdp: ans.sdp } });
      } catch { try { pc.close(); } catch {} this.pcs.delete(peer); }
    } else if (m.type === 'CANDIDATE' && p.standPractice && p.candidate) {
      const pc = this.pcs.get(m.src); if (!pc) return;
      if (pc.remoteDescription) pc.addIceCandidate(p.candidate).catch(() => {}); else (pc._pending = pc._pending || []).push(p.candidate);
    }
  }
}

// ---------- on the iPhone ----------
function askOne(target, ms) {
  return new Promise((resolve, reject) => {
    let pc = null, done = false;
    const sig = new Signal('stand-ppc-' + Math.random().toString(36).slice(2, 12), async (m) => {
      const p = m.payload || {};
      if (m.type === 'ANSWER' && p.standPractice && pc) {
        await pc.setRemoteDescription(p.sdp).catch(() => {});
        for (const c of pending) await pc.addIceCandidate(c).catch(() => {}); pending.length = 0;
      } else if (m.type === 'CANDIDATE' && p.standPractice && pc) {
        if (pc.remoteDescription) pc.addIceCandidate(p.candidate).catch(() => {}); else pending.push(p.candidate);
      } else if (m.type === 'EXPIRE') finish(new Error('not there'));
    });
    const pending = [];
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(T); setTimeout(() => { try { pc && pc.close(); } catch {} sig.close(); }, 400); if (err) reject(err); else resolve(val); };
    const T = setTimeout(() => finish(new Error('timeout')), ms);
    sig.open().then(async () => {
      pc = new RTCPeerConnection({ iceServers: ICE });
      const ch = pc.createDataChannel('practice');
      const parts = [];
      ch.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'pair' && m.key) rememberIpad(m.key);
        else if (m.t === 'part') parts.push(m.s);
        else if (m.t === 'end') { try { ch.send(JSON.stringify({ t: 'thanks' })); } catch {} try { finish(null, JSON.parse(parts.join(''))); } catch (e) { finish(e); } }
        else if (m.t === 'error') finish(new Error('ipad:' + (m.why || '')));
      };
      pc.onicecandidate = (e) => { if (e.candidate) sig.send(target, 'CANDIDATE', { ...TAG, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      sig.send(target, 'OFFER', { ...TAG, sdp: { type: offer.type, sdp: offer.sdp } });
    }).catch(() => finish(new Error('offline')));
  });
}
// over the direct link (the apps): ask the iPad nearby
function askDirect(ms) {
  return new Promise((resolve, reject) => {
    const parts = []; let done = false, need = -1;
    const box = new DirectBox('stand-dpp-' + Math.random().toString(36).slice(2, 10), (m) => {
      const p = m.payload || {};
      if (m.type === 'PP_PAIR' && p.key) rememberIpad(p.key);
      else if (m.type === 'PP_PART') parts[p.k] = p.s;
      else if (m.type === 'PP_END') { need = p.n; check(); }
      else if (m.type === 'PP_ERR') finish(new Error('ipad'));
    });
    const check = () => { if (need >= 0 && parts.filter((x) => x !== undefined).length >= need) { try { finish(null, JSON.parse(parts.join(''))); } catch (e) { finish(e); } } };
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(T); clearInterval(A); unw(); box.close(); if (err) reject(err); else resolve(val); };
    const T = setTimeout(() => finish(new Error('timeout')), ms);
    if (!box.open()) { finish(new Error('no link')); return; }
    const ask = () => { if (directPeers() > 0) box.send('stand-dpp-host', 'PP_ASK', {}); };
    const unw = directWatch((n) => { if (n) ask(); });
    ask();
    const A = setInterval(ask, 2500);
  });
}
// ---------- the iPhone asks the iPad for something else (its list of scores, one score's pages) ----------
function askOneQ(target, q, ms) {
  return new Promise((resolve, reject) => {
    let pc = null, done = false;
    const sig = new Signal('stand-ppc-' + Math.random().toString(36).slice(2, 12), async (m) => {
      const p = m.payload || {};
      if (m.type === 'ANSWER' && p.standPractice && pc) {
        await pc.setRemoteDescription(p.sdp).catch(() => {});
        for (const c of pending) await pc.addIceCandidate(c).catch(() => {}); pending.length = 0;
      } else if (m.type === 'CANDIDATE' && p.standPractice && pc) {
        if (pc.remoteDescription) pc.addIceCandidate(p.candidate).catch(() => {}); else pending.push(p.candidate);
      } else if (m.type === 'EXPIRE') finish(new Error('not there'));
    });
    const pending = [];
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(T); setTimeout(() => { try { pc && pc.close(); } catch {} sig.close(); }, 400); if (err) reject(err); else resolve(val); };
    let T = setTimeout(() => finish(new Error('timeout')), ms);
    sig.open().then(async () => {
      pc = new RTCPeerConnection({ iceServers: ICE });
      const ch = pc.createDataChannel('stand-req');
      const parts = [];
      ch.onopen = () => ch.send(JSON.stringify({ t: 'ask', q }));
      ch.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        // (while parts come, the wait goes on)
        clearTimeout(T); T = setTimeout(() => finish(new Error('timeout')), ms);
        if (m.t === 'part') parts.push(m.s);
        else if (m.t === 'end') { try { ch.send(JSON.stringify({ t: 'thanks' })); } catch {} try { finish(null, JSON.parse(parts.join(''))); } catch (e) { finish(e); } }
        else if (m.t === 'error') finish(new Error('ipad:' + (m.why || '')));
      };
      pc.onicecandidate = (e) => { if (e.candidate) sig.send(target, 'CANDIDATE', { ...TAG, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      sig.send(target, 'OFFER', { ...TAG, sdp: { type: offer.type, sdp: offer.sdp } });
    }).catch(() => finish(new Error('offline')));
  });
}
function askDirectQ(q, ms) {
  return new Promise((resolve, reject) => {
    const rid = Math.random().toString(36).slice(2, 10);
    const parts = []; let done = false, need = -1, asked = false;
    const box = new DirectBox('stand-dsc-' + rid, (m) => {
      const p = m.payload || {}; if (p.rid !== rid) return;
      clearTimeout(T); T = setTimeout(() => finish(new Error('timeout')), ms);
      if (m.type === 'SC_PART') parts[p.k] = p.s;
      else if (m.type === 'SC_END') { need = p.n; check(); }
      else if (m.type === 'SC_ERR') finish(new Error('ipad:' + (p.why || '')));
    });
    const check = () => { if (need >= 0 && parts.filter((x) => x !== undefined).length >= need) { try { finish(null, JSON.parse(parts.join(''))); } catch (e) { finish(e); } } };
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(T); clearInterval(A); unw(); box.close(); if (err) reject(err); else resolve(val); };
    let T = setTimeout(() => finish(new Error('timeout')), ms);
    if (!box.open()) { finish(new Error('no link')); return; }
    const ask = () => { if (!asked && directPeers() > 0) { asked = true; box.send('stand-dpp-host', 'SC_ASK', { rid, q }); } };
    const unw = directWatch((n) => { if (n) ask(); });
    ask();
    const A = setInterval(ask, 1500);
  });
}
// any question for the iPad: nearby and over the internet together, the first answer wins
export async function askIpad(q, ms = 20000) {
  // the iPad already met nearby: asked there only (the same answer coming twice, nearby and over
  // the internet, was twice the work and the memory); the internet only if that fails
  if (DIRECT() && directPeers() > 0) {
    // (the iPad answered, with an error of its own: asking it again over the internet is no use)
    try { return await askDirectQ(q, ms); } catch (e) { if (String(e && e.message).startsWith('ipad')) throw e; /* else the internet way, below */ }
  }
  const tries = [];
  if (DIRECT() && directPeers() === 0) tries.push(askDirectQ(q, ms));
  const targets = [];
  for (const k of knownIpads()) targets.push(pairId(k));
  try { const room = await roomName(); if (room) targets.push(room + '-pp'); } catch {}
  for (const t of targets) tries.push(askOneQ(t, q, ms));
  if (!tries.length) throw new Error('offline');
  // (when every way fails, the iPad's own answer says most)
  return Promise.any(tries).catch((agg) => { const es = (agg && agg.errors) || []; throw es.find((e) => String(e && e.message).startsWith('ipad')) || es[0] || new Error('offline'); });
}
// Ask every place the iPad could be at once; the first answer wins.
// The nearby way (Apple's peer-to-peer link) and the internet way are tried together, so a slow
// one never holds up the other.
export async function fetchPractice({ code } = {}) {
  const tries = [];
  if (!code && DIRECT()) tries.push(askDirect(directPeers() > 0 ? 9000 : 15000));
  const targets = [];
  if (code) targets.push(codeId(code));
  else {
    for (const k of knownIpads()) targets.push(pairId(k));
    try { const room = await roomName(); if (room) targets.push(room + '-pp'); } catch {}
  }
  for (const t of targets) tries.push(askOne(t, code ? 15000 : 12000));
  if (!tries.length) throw new Error('offline');
  return Promise.any(tries);
}
