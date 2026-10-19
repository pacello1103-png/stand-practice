// The iPhone as a camera for the iPad. The two find each other with a six-digit code through
// a small public meeting service (only the connection details pass through it); the picture
// and the recording go straight from the iPhone to the iPad over your Wi-Fi.
// The iPhone shows a live preview on the iPad, records in full quality itself, and sends the
// finished video to the iPad when you stop.

export const SIGNAL = { host: '0.peerjs.com', port: 443, secure: true, key: 'peerjs', path: '/' };
// Direct first (same Wi-Fi, or the iPad on the iPhone's own hotspot); when the two cannot reach
// each other directly, a public relay carries the picture instead.
export const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];
const CHUNK = 64 * 1024;

// ---------- finding each other without the internet (iPad and iPhone apps) ----------
// The apps also talk directly over Apple's peer-to-peer link (the way AirDrop finds devices:
// same Wi-Fi, or just nearby). Every message goes both ways at once (that link and the meeting
// service on the internet); whichever arrives first is used, the copy is ignored.
const NATIVE = () => !!(window.standCaps && window.standCaps.peer && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standPeer);
const hub = { sigs: new Map(), started: false, seen: new Set(), peers: 0 };
const ANY_HOST = 'stand-any-host';
function hubStart() {
  if (hub.started || !NATIVE()) return;
  hub.started = true;
  window.standPeerMessage = (str) => { let m; try { m = JSON.parse(str); } catch { return; } deliver(m); };
  window.standPeerState = (n) => { hub.peers = n; };
  try { window.webkit.messageHandlers.standPeer.postMessage({ op: 'start', name: 'Stand ' + (/iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)) ? 'iPad' : 'iPhone') }); } catch {}
}
function deliver(m) {
  if (!m || !m.dst) return;
  if (m.mid) { if (hub.seen.has(m.mid)) return; hub.seen.add(m.mid); if (hub.seen.size > 500) hub.seen.delete(hub.seen.values().next().value); }
  const sig = hub.sigs.get(m.dst);
  if (sig && sig.onMsg) sig.onMsg(m);
}
export const nativeLink = () => NATIVE();
export { ANY_HOST };

export class Signal {
  // nativeOnly: only over the direct link (an address everyone can use there, never on the internet)
  constructor(id, onMsg, onState, nativeOnly) { this.id = id; this.onMsg = onMsg; this.onState = onState; this.queue = []; this.nativeOnly = !!nativeOnly; }
  open() {
    if (NATIVE()) { hubStart(); hub.sigs.set(this.id, this); this.native = true; }
    if (this.nativeOnly) return this.native ? Promise.resolve() : Promise.reject(new Error('offline'));
    const net = this._openNet();
    // with the direct link, being offline (or the meeting service being down) is no problem
    return this.native ? net.catch((e) => { if (e.message === 'taken') throw e; }) : net;
  }
  _openNet() {
    return new Promise((resolve, reject) => {
      const token = Math.random().toString(36).slice(2);
      const url = `${SIGNAL.secure ? 'wss' : 'ws'}://${SIGNAL.host}:${SIGNAL.port}${SIGNAL.path.replace(/\/$/, '')}/peerjs?key=${SIGNAL.key}&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.4`;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      this.ws = ws;
      const t = setTimeout(() => { reject(new Error('timeout')); try { ws.close(); } catch {} }, 9000);
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'OPEN') { clearTimeout(t); this.ready = true; this.hb = setInterval(() => this.raw({ type: 'HEARTBEAT' }), 5000); for (const q of this.queue) this.raw(q); this.queue = []; resolve(); return; }
        if (m.type === 'ID-TAKEN') { clearTimeout(t); reject(new Error('taken')); return; }
        if (m.type === 'ERROR') { clearTimeout(t); reject(new Error((m.payload && m.payload.msg) || 'error')); return; }
        const mid = m.payload && m.payload.mid;
        if (mid) { if (hub.seen.has(mid)) return; hub.seen.add(mid); }
        this.onMsg && this.onMsg(m);
      };
      ws.onerror = () => { clearTimeout(t); reject(new Error('offline')); };
      ws.onclose = () => { clearInterval(this.hb); this.ready = false; this.onState && this.onState('closed'); };
    });
  }
  raw(m) { if (this.nativeOnly) return; if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else this.queue.push(m); }
  send(dst, type, payload) {
    const mid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const p = { ...(payload || {}), mid };
    if (this.native) { try { window.webkit.messageHandlers.standPeer.postMessage({ op: 'send', data: JSON.stringify({ type, dst, src: this.id, payload: p, mid }) }); } catch {} }
    this.raw({ type, dst, payload: p });
  }
  close() { clearInterval(this.hb); if (hub.sigs.get(this.id) === this) hub.sigs.delete(this.id); try { this.ws && this.ws.close(); } catch {} }
}
const newCode = () => String(Math.floor(100000 + Math.random() * 900000));

// ---------- finding each other without a code ----------
// Devices on the same Wi-Fi share one internet address. Stand turns that address into a room
// name, so the iPhone finds the iPad by itself; nothing else is needed.
const hash = (str) => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).slice(0, 12); };
let roomCache = null;
async function publicAddress() {
  if (window.__standRoomIp) return window.__standRoomIp;   // tests
  try {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    pc.createDataChannel('x');
    let ip = null;
    const done = new Promise((res) => {
      pc.onicecandidate = (e) => {
        if (!e.candidate) { res(); return; }
        const m = /\s((?:\d{1,3}\.){3}\d{1,3})\s\d+\styp\ssrflx/.exec(e.candidate.candidate || '');
        if (m) { ip = m[1]; res(); }
      };
      setTimeout(res, 4000);
    });
    await pc.setLocalDescription(await pc.createOffer()); await done; pc.close();
    if (ip) return ip;
  } catch {}
  try { const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' }); const j = await r.json(); if (j.ip) return j.ip; } catch {}
  return null;
}
// Once linked, the iPad and iPhone remember each other, so they also find each other later on
// any network (no account needed).
export const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
export function myPairKey() { let k = LS.get('standPairKey'); if (!k) { k = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); LS.set('standPairKey', k); } return k; }
function knownPairs() { try { return JSON.parse(LS.get('standPairs') || '[]'); } catch { return []; } }
export async function roomName() {
  if (roomCache) return roomCache;
  const ip = await publicAddress();
  if (!ip) return null;
  roomCache = 'stand-room-' + hash('stand:' + ip);
  return roomCache;
}

// =====================================================================
// iPad side: waits for an iPhone, shows its picture, starts and stops its recording
// =====================================================================
export class CameraHost {
  constructor() { this.state = 'off'; this.stream = null; this.onState = null; this.onStream = null; this.onProgress = null; this.onInfo = null; this.info = {}; }
  _set(s, info) { this.state = s; this.onState && this.onState(s, info); }
  // auto: wait in the room of this Wi-Fi; with { code: true }: show a six-digit code instead
  async start(opts = {}) {
    this.stop();
    this._set('opening');
    // the iPhone app finds the iPad app nearby directly, without a code or the internet
    if (NATIVE()) { const sa = new Signal(ANY_HOST, (m) => this._msg(m, sa), () => {}, true); try { await sa.open(); this.sig4 = sa; } catch {} }

    this.mode = opts.code ? 'code' : 'auto';
    if (this.mode === 'auto') {
      const room = await roomName();
      if (!room && this.state === 'opening') { if (await this._openPair(true)) { this._set('waiting'); return 'pair'; } }
      if (room && this.state === 'opening') {
        for (let i = 0; i < 3; i++) {
          const id = `${room}-${i}`;
          this.sig = new Signal(id, (m) => this._msg(m), (s) => { if (s === 'closed' && this.state !== 'off' && this.state !== 'linked') this._set('offline'); });
          try { await this.sig.open(); this.code = null; this._openPair(); this._openCode(); this._set('waiting'); return id; } catch (e) { this.sig.close(); this.sig = null; if (e.message !== 'taken') break; }
        }
      }
      this.mode = 'code';
    }
    for (let tries = 0; tries < 3; tries++) {
      this.code = newCode();
      this.sig = new Signal('stand-cam-' + this.code, (m) => this._msg(m), (s) => { if (s === 'closed' && this.state !== 'off' && this.state !== 'linked') this._set('offline'); });
      try { await this.sig.open(); this._set('waiting', this.code); return this.code; } catch (e) { this.sig.close(); if (e.message !== 'taken') { this._set('offline'); return null; } }
    }
    this._set('offline'); return null;
  }
  // A six-digit code is always ready as well: on an iPhone's own hotspot (or any network where
  // the two cannot find each other by themselves) the code still works.
  async _openCode() {
    for (let tries = 0; tries < 3; tries++) {
      const code = newCode();
      const sig = new Signal('stand-cam-' + code, (m) => this._msg(m, sig), () => {});
      try { await sig.open(); if (this.state === 'off') { sig.close(); return; } this.sig3 = sig; this.code = code; this._set(this.state, this.code); return; } catch (e) { sig.close(); if (e.message !== 'taken') return; }
    }
  }
  async _openPair(main) {
    const id = 'stand-pair-' + myPairKey();
    const sig = new Signal(id, (m) => { this.sigFrom = sig; this._msg(m, sig); }, () => {});
    try { await sig.open(); this.sig2 = sig; if (main && !this.sig) this.sig = sig; return true; } catch { sig.close(); return false; }
  }
  async _msg(m, via) {
    if (m.type === 'OFFER' && m.payload && m.payload.stand) {
      if (this.pc) { try { this.pc.close(); } catch {} }
      // WebKit only shares this iPad's real Wi-Fi address once the page is using the microphone;
      // without it the two often cannot reach each other on the same network
      if (!this.permStream && navigator.mediaDevices) { try { this.permStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { this.permStream = null; } }
      this.reply = via || this.sig;
      this.peer = m.src;
      const pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
      const out = this.reply;
      pc.onicecandidate = (e) => { if (e.candidate) out.send(this.peer, 'CANDIDATE', { stand: 1, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      pc.ontrack = (e) => { this.stream = e.streams[0] || new MediaStream([e.track]); this.onStream && this.onStream(this.stream); };
      pc.ondatachannel = (e) => this._channel(e.channel);
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && this.state === 'linked' && this.pc === pc) this._set('lost'); };
      await pc.setRemoteDescription(m.payload.sdp);
      for (const c of this.pending || []) await pc.addIceCandidate(c).catch(() => {});
      this.pending = [];
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      out.send(this.peer, 'ANSWER', { stand: 1, sdp: { type: ans.type, sdp: ans.sdp } });
    } else if (m.type === 'CANDIDATE' && m.payload && m.payload.candidate) {
      if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(m.payload.candidate).catch(() => {});
      else (this.pending = this.pending || []).push(m.payload.candidate);
    } else if (m.type === 'LEAVE' || m.type === 'EXPIRE') { if (this.state === 'linked') this._set('lost'); }
  }
  _channel(ch) {
    this.ch = ch; ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      this._set('linked', this.info); this.send({ t: 'pair', key: myPairKey() });
      setTimeout(() => { if (this.permStream && this.state === 'linked') { this.permStream.getTracks().forEach((t) => t.stop()); this.permStream = null; } }, 3000);
    };
    ch.onclose = () => { if (this.state === 'linked' && this.ch === ch) this._set('lost'); };
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string') { if (this.rx) { this.rx.parts.push(e.data); this.rx.got += e.data.byteLength; this.onProgress && this.onProgress(this.rx.got / this.rx.size); } return; }
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { this.info = m; this._set('linked', m); }
      else if (m.t === 'state') { this.info = { ...this.info, ...m }; this.onInfo && this.onInfo(this.info); }
      else if (m.t === 'file-start') this.rx = { size: m.size, mime: m.mime, parts: [], got: 0, mirror: m.mirror };
      else if (m.t === 'file-end') { const rx = this.rx; this.rx = null; const blob = new Blob(rx.parts, { type: rx.mime }); this._file && this._file({ blob, mirror: rx.mirror }); }
      else if (m.t === 'error') { this._file && this._file(null, m.msg); }
      else if (m.t === 'bye') { this._set('lost'); }
    };
  }
  send(m) { if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify(m)); }
  setCamera(facing) { this.send({ t: 'set', facing }); }
  set(settings) { this.info = { ...this.info, ...settings }; this.send({ t: 'set', ...settings }); }
  record() { this.send({ t: 'record' }); }
  // stop: the iPhone finishes the file and sends it over
  stopRecording() {
    return new Promise((resolve) => {
      this._file = (r, err) => { this._file = null; resolve(r ? r : { error: err || 'failed' }); };
      this.send({ t: 'stop' });
      setTimeout(() => { if (this._file) { this._file = null; resolve({ error: 'timeout' }); } }, 15 * 60 * 1000);
    });
  }
  stop() {
    try { this.send({ t: 'bye' }); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    if (this.sig) this.sig.close();
    if (this.sig2 && this.sig2 !== this.sig) this.sig2.close();
    if (this.sig3) this.sig3.close();
    if (this.sig4) this.sig4.close();
    this.pc = null; this.ch = null; this.sig = null; this.sig2 = null; this.sig3 = null; this.sig4 = null; this.code = null; this.stream = null;
    if (this.permStream) { this.permStream.getTracks().forEach((t) => t.stop()); this.permStream = null; }
    if (this.state !== 'off') this._set('off');
  }
}

// =====================================================================
// iPhone side: the camera
// =====================================================================
// The picture is drawn through a canvas, so brightness, warmth and zoom work on every iPhone,
// and the shape (upright or sideways) simply follows how the iPhone is held.
export const CAM_DEFAULTS = { facing: 'environment', quality: 'fhd', fps: 30, bright: 0, warm: 0, zoom: 1, light: false };
export class CameraPhone {
  constructor() { this.onState = null; this.onLocal = null; this.s = { ...CAM_DEFAULTS }; this.shape = 'portrait'; this.recording = false; this.caps = {}; }
  get facing() { return this.s.facing; }
  set facing(f) { this.s.facing = f; }
  _set(s, info) { this.state = s; this.onState && this.onState(s, info); }
  _size() {
    const [w, h] = this.s.quality === 'hd' ? [1280, 720] : [1920, 1080];
    return this.shape === 'portrait' ? [h, w] : [w, h];
  }
  async openCamera() {
    if (this.cam) this.cam.getTracks().forEach((t) => t.stop());
    const [w, h] = this.s.quality === 'hd' ? [1280, 720] : [1920, 1080];
    this.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.s.facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: this.s.fps } }, audio: false });
    if (!this.mic) {
      try { this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch { this.mic = null; }
    }
    const track = this.cam.getVideoTracks()[0];
    try { this.caps = track.getCapabilities ? track.getCapabilities() : {}; } catch { this.caps = {}; }
    if (!this.src) {
      this.src = document.createElement('video'); this.src.muted = true; this.src.playsInline = true; this.src.setAttribute('playsinline', '');
      this.src.addEventListener('resize', () => this._shapeFromFrame());
    }
    this.src.srcObject = this.cam;
    await this.src.play().catch(() => {});
    await this._hardware();
    this._ensureCanvas();
    this._shapeFromFrame();
    this.raw = null; this._route();
    return this.out;
  }
  // a picture in the shape the iPhone is held; fixed while recording
  _shapeFromFrame() {
    const v = this.src; if (!v || !v.videoWidth) return;
    const shape = v.videoWidth >= v.videoHeight ? 'landscape' : 'portrait';
    if (shape !== this.shape && !this.recording) { this.shape = shape; this._resize(); this.sendState(); this.onState && this.onState(this.state); }
    this._route();
  }
  _ensureCanvas() {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.g = this.canvas.getContext('2d', { alpha: false });
      this._resize();
      const loop = () => { this._frame(); if (this.src && this.src.requestVideoFrameCallback) this.src.requestVideoFrameCallback(loop); else requestAnimationFrame(loop); };
      this._timer = setInterval(() => { if (!this._busy) this._frame(); }, 1000 / 15);   // keeps going if frame callbacks stall
      loop();
      this.canvasOut = this.canvas.captureStream ? this.canvas.captureStream() : this.cam;
      this.out = this.canvasOut;
    }
  }
  _resize() { if (!this.canvas) return; const [w, h] = this._size(); if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } }
  // When nothing needs drawing (no software brightness, warmth or zoom, and the camera already
  // gives the right shape), the camera's own track goes straight out: no canvas, much less heat.
  _needsCanvas() {
    const v = this.src, s = this.s, c = this.caps;
    if (!v || !v.videoWidth) return true;
    const hwZoom = c.zoom && c.zoom.max > 1, hwBright = c.exposureCompensation && c.exposureCompensation.max > 0;
    if (!hwZoom && s.zoom > 1.01) return true;
    if (!hwBright && Math.abs(s.bright) > 0.01) return true;
    if (Math.abs(s.warm) > 0.01) return true;
    const [W, H] = this._size();
    return Math.abs(v.videoWidth / v.videoHeight - W / H) > 0.02;
  }
  _route() {
    if (this.recording || !this.cam) return;            // the picture source never changes mid-take
    const raw = !this._needsCanvas();
    if (raw === this.raw && this.out) return;
    this.raw = raw;
    const track = raw ? this.cam.getVideoTracks()[0] : this.canvasOut.getVideoTracks()[0];
    this.out = raw ? this.cam : this.canvasOut;
    const sender = this.pc && this.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
    if (sender && sender.track !== track) sender.replaceTrack(track).catch(() => {});
    this.onLocal && this.onLocal(this.out);
  }
  _frame() {
    const v = this.src, g = this.g, c = this.canvas;
    if (!v || !g || !v.videoWidth) return;
    if (this.raw) return;
    this._busy = true;
    const W = c.width, H = c.height, s = this.s;
    const hwZoom = this.caps.zoom && this.caps.zoom.max > 1;
    const z = hwZoom ? 1 : Math.max(1, s.zoom);
    const k = Math.max(W / v.videoWidth, H / v.videoHeight) * z;
    const dw = v.videoWidth * k, dh = v.videoHeight * k;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const hwBright = this.caps.exposureCompensation && this.caps.exposureCompensation.max > 0;
    if (!hwBright && s.bright > 0.01) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, s.bright); g.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh); }
    if (!hwBright && s.bright < -0.01) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(0.85, -s.bright * 0.6); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    if (Math.abs(s.warm) > 0.01) { g.globalCompositeOperation = 'soft-light'; g.globalAlpha = Math.min(0.6, Math.abs(s.warm) * 0.45); g.fillStyle = s.warm > 0 ? '#ff9a3c' : '#3c8cff'; g.fillRect(0, 0, W, H); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    this._busy = false;
  }
  async _hardware() {
    const t = this.cam && this.cam.getVideoTracks()[0]; if (!t || !t.applyConstraints) return;
    const adv = {}, c = this.caps;
    if (c.zoom && c.zoom.max > 1) adv.zoom = Math.min(c.zoom.max, Math.max(c.zoom.min || 1, this.s.zoom));
    if (c.exposureCompensation && c.exposureCompensation.max > 0) adv.exposureCompensation = Math.max(c.exposureCompensation.min, Math.min(c.exposureCompensation.max, this.s.bright * c.exposureCompensation.max));
    if (c.torch) adv.torch = !!this.s.light;
    if (Object.keys(adv).length) await t.applyConstraints({ advanced: [adv] }).catch(() => {});
  }
  get canLight() { return !!this.caps.torch; }
  async apply(next) {
    const before = { ...this.s };
    Object.assign(this.s, next);
    const reopen = !this.recording && (before.facing !== this.s.facing || before.quality !== this.s.quality || before.fps !== this.s.fps);
    if (reopen) await this.openCamera().catch(() => {});
    else { this._resize(); await this._hardware(); this._route(); }
    this.sendState(); this.onState && this.onState(this.state);
  }
  // look for the iPad on this Wi-Fi (or the one showing this code) until it answers
  async find(code) {
    clearTimeout(this.retry); this.searching = true;
    this._set('connecting');
    if (!this.cam) await this.openCamera();
    let targets;
    if (code) targets = ['stand-cam-' + code.replace(/\D/g, '')];
    else {
      const pairs = knownPairs().map((k) => 'stand-pair-' + k);
      const room = await roomName();
      targets = [...(NATIVE() ? [ANY_HOST] : []), ...(room ? [0, 1, 2].map((i) => `${room}-${i}`).slice(0, 1) : []), ...pairs, ...(room ? [`${room}-1`, `${room}-2`] : [])];
      if (!targets.length) { this._set('offline'); this.searching = false; this.retry = setTimeout(() => this.find(), 5000); return false; }
    }
    if (!this.sig) {
      this.sig = new Signal('stand-phone-' + Math.random().toString(36).slice(2, 10), (m) => this._msg(m), () => { this.sig = null; });
      try { await this.sig.open(); } catch { this.sig = null; this._set('offline'); this.retry = setTimeout(() => this.find(code), 4000); return false; }
    }
    let i = 0;
    const attempt = async () => {
      if (!this.searching || this.state === 'linked') return;
      await this._offer(targets[i % targets.length]); i++;
      this.retry = setTimeout(() => { if (this.state !== 'linked' && this.searching) { if (code && i >= 3) { this._set('nobody'); this.searching = false; return; } attempt(); } }, 3500);
    };
    attempt();
    return true;
  }
  async _offer(target) {
    try { this.pc && this.pc.close(); } catch {}
    const pc = this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.target = target; this.pending = [];
    pc.onicecandidate = (e) => { if (e.candidate && this.pc === pc) this.sig && this.sig.send(target, 'CANDIDATE', { stand: 1, candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onconnectionstatechange = () => { if (this.pc === pc && ['failed', 'closed'].includes(pc.connectionState) && this.state === 'linked') this._lost(); };
    for (const t of this.out.getVideoTracks()) pc.addTrack(t, this.out);
    const ch = pc.createDataChannel('stand', { ordered: true });
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => { if (this.pc !== pc) return; this.ch = ch; clearTimeout(this.retry); this.searching = false; this._set('linked'); this.sendState(); };
    ch.onclose = () => { if (this.ch === ch && this.state === 'linked') this._lost(); };
    ch.onmessage = (e) => this._cmd(JSON.parse(e.data));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sig && this.sig.send(target, 'OFFER', { stand: 1, sdp: { type: offer.type, sdp: offer.sdp } });
  }
  _lost() { this.ch = null; this._set('lost'); if (!this.left) { this.retry = setTimeout(() => this.find(), 2500); } }
  async _msg(m) {
    if (!this.pc) return;
    if (m.src && this.target && m.src !== this.target) return;
    if (m.type === 'ANSWER' && m.payload && m.payload.sdp) { await this.pc.setRemoteDescription(m.payload.sdp).catch(() => {}); for (const c of this.pending || []) await this.pc.addIceCandidate(c).catch(() => {}); this.pending = []; }
    else if (m.type === 'CANDIDATE' && m.payload && m.payload.candidate) { if (this.pc.remoteDescription) await this.pc.addIceCandidate(m.payload.candidate).catch(() => {}); else (this.pending = this.pending || []).push(m.payload.candidate); }
  }
  send(m) { if (this.ch && this.ch.readyState === 'open') this.ch.send(JSON.stringify(m)); }
  sendState() { this.send({ t: 'state', ...this.s, shape: this.shape, recording: this.recording, canLight: this.canLight, hwZoom: !!(this.caps.zoom && this.caps.zoom.max > 1) }); }
  async _cmd(m) {
    if (m.t === 'pair') { const list = knownPairs().filter((k) => k !== m.key); list.unshift(m.key); LS.set('standPairs', JSON.stringify(list.slice(0, 4))); }
    else if (m.t === 'set') { const { t, ...rest } = m; await this.apply(rest); }
    else if (m.t === 'camera') await this.apply({ facing: m.facing });
    else if (m.t === 'record') this.record();
    else if (m.t === 'stop') this.stopAndSend();
    else if (m.t === 'bye') this._lost();
  }
  record() {
    if (this.recording) return true;
    if (!window.MediaRecorder || !this.out) { this.send({ t: 'error', msg: 'This iPhone cannot record video here.' }); this.onState && this.onState('error', 'This iPhone cannot record video here.'); return false; }
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm', ''].filter((t) => !t || MediaRecorder.isTypeSupported(t));
    const rate = this.s.quality === 'hd' ? 6_000_000 : 12_000_000;
    const withAudio = [...this.out.getVideoTracks(), ...(this.mic ? this.mic.getAudioTracks().filter((t) => t.readyState === 'live') : [])];
    // some iPhones refuse one way of recording and accept another: try them in turn
    const tries = [];
    for (const type of types) tries.push({ tracks: withAudio, opts: { mimeType: type || undefined, videoBitsPerSecond: this.s.fps === 60 ? rate * 1.5 : rate, audioBitsPerSecond: 192_000 } });
    tries.push({ tracks: withAudio, opts: {} });
    tries.push({ tracks: this.out.getVideoTracks(), opts: {} });
    this.rec = null;
    for (const t of tries) {
      try {
        const rec = new MediaRecorder(new MediaStream(t.tracks), t.opts);
        this.chunks = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
        rec.onerror = () => { if (this.rec === rec && this.recording) this._recFailed('The recording stopped by itself.'); };
        rec.start(1000);
        this.rec = rec; this.mime = (rec.mimeType || t.opts.mimeType || 'video/mp4').split(';')[0];
        break;
      } catch (e) { /* the next way */ }
    }
    if (!this.rec) { this._recFailed('The iPhone could not start recording.'); return false; }
    this.recording = true; this.sendState(); this.onState && this.onState(this.state);
    return true;
  }
  _recFailed(msg) {
    try { this.rec && this.rec.state !== 'inactive' && this.rec.stop(); } catch {}
    this.rec = null; this.recording = false; this.chunks = [];
    this.send({ t: 'error', msg }); this.sendState();
    this._shapeFromFrame(); this._route();
    this.onState && this.onState(this.state === 'sending' ? 'linked' : this.state, msg);
  }
  async stopAndSend() {
    if (!this.recording || !this.rec) { this.send({ t: 'error', msg: 'not recording' }); this.recording = false; this.sendState(); return; }
    // never wait for ever: some recorders do not say when they have stopped
    const done = new Promise((r) => { this.rec.onstop = r; setTimeout(r, 4000); });
    try { this.rec.stop(); } catch {}
    await done;
    this.recording = false; this.sendState();
    this._shapeFromFrame(); this._route();
    const blob = new Blob(this.chunks, { type: this.mime });
    this.chunks = [];
    this.lastBlob = blob;
    this.onState && this.onState('sending', 0);
    this.send({ t: 'file-start', size: blob.size, mime: blob.type, mirror: this.s.facing === 'user' });
    const buf = await blob.arrayBuffer();
    for (let o = 0; o < buf.byteLength; o += CHUNK) {
      // wait while the channel is full
      while (this.ch && this.ch.bufferedAmount > 4 * 1024 * 1024) await new Promise((r) => setTimeout(r, 20));
      if (!this.ch) { this.onState && this.onState('lost'); return; }
      this.ch.send(buf.slice(o, o + CHUNK));
      if ((o / CHUNK) % 32 === 0) this.onState && this.onState('sending', o / buf.byteLength);
    }
    this.send({ t: 'file-end' });
    this.onState && this.onState('linked');
  }
  leave() {
    this.left = true; this.searching = false;
    clearTimeout(this.retry);
    try { this.send({ t: 'bye' }); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    if (this.sig) this.sig.close();
    if (this.cam) this.cam.getTracks().forEach((t) => t.stop());
    if (this.mic) this.mic.getTracks().forEach((t) => t.stop());
    clearInterval(this._timer);
    this.pc = null; this.ch = null; this.cam = null; this.mic = null; this.sig = null; this.canvas = null; this.g = null; this.out = null;
    this._set('off');
    this.left = false;
  }
}
