// Recorder (raw PCM, no processing) and a player with pitch-preserving slow-down and reverb.
import { getCtx, master, acquireMic, releaseMic, holdSound, wantAudio } from './audio.js';

// ---------------- capture ----------------
const CAPTURE_SRC = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.startAt = 0; this.buf = new Float32Array(4096); this.n = 0; this.pk = 0; this.blocks = 0;
    this.port.onmessage = (e) => { if (e.data.cmd === 'start') { this.on = true; this.startAt = e.data.at || 0; }
      else if (e.data.cmd === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); } }; }
  flush() { if (this.n) { this.port.postMessage({ chunk: this.buf.slice(0, this.n) }); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    if (this.on) {
      let from = 0;
      if (this.startAt && currentTime < this.startAt) {
        const until = Math.round((this.startAt - currentTime) * sampleRate);
        if (until >= ch.length) { this.meter(peak); return true; }
        from = until;
      }
      this.startAt = 0;
      for (let i = from; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) this.flush(); }
    }
    this.meter(peak);
    return true;
  }
  meter(p) { if (p > this.pk) this.pk = p; if (++this.blocks >= 8) { this.port.postMessage({ peak: this.pk }); this.pk = 0; this.blocks = 0; } }
}
registerProcessor('stand-capture', Capture);`;

// (the capture is added to each sound system it is used in: after iOS replaced the sound system,
// the one added to the old one did not exist in the new, and recording failed until Stand closed)
const workletReady = new WeakMap();
function loadWorklet(ctx) {
  if (!workletReady.has(ctx)) {
    const url = URL.createObjectURL(new Blob([CAPTURE_SRC], { type: 'application/javascript' }));
    const p = ctx.audioWorklet.addModule(url); p.catch(() => workletReady.delete(ctx));
    workletReady.set(ctx, p);
  }
  return workletReady.get(ctx);
}

export class Recorder {
  constructor() {
    this.recording = false; this.onLevel = null; this.onGap = null;
    // the microphone lost while recording (headphones put on or taken off, a call): it is opened
    // again and the take goes on, with a moment of silence where nothing could be heard
    window.addEventListener('stand-mic-lost', () => this._reconnect());
    window.addEventListener('stand-audio-new', () => this._reconnect());
  }
  async _reconnect() {
    if (!this.recording || this._stopping || this._recon || !this.node) return;
    this._recon = true;
    const lostAt = performance.now();
    try {
      try { this.src.disconnect(this.node); this.node.disconnect(); this.sink.disconnect(); } catch {}
      const src = await acquireMic(); releaseMic();   // (still held once, from the start)
      if (!this.recording || this._stopping) return;
      const gap = (performance.now() - lostAt) / 1000;
      this._flushTo(this.sr);
      this.parts.push({ silence: Math.round(gap * this.sr) });
      await this._wire(src);
      if (this.node.port) this.node.port.postMessage({ cmd: 'start', at: 0 });
      this.onGap && this.onGap(gap);
    } catch (e) { console.warn(e); this.onGap && this.onGap(-1); } finally { this._recon = false; }
  }
  // what was captured so far, at the take's own rate (the microphone may come back at another)
  _flushTo(sr) {
    if (!this.chunks || !this.chunks.length) return;
    this.parts.push({ chunks: this.chunks, sr: this.wireSr || sr });
    this.chunks = [];
  }
  async prepare() {
    const src = await acquireMic();
    const ctx = src.context || getCtx();
    this.sr = ctx.sampleRate; this.parts = [];
    await this._wire(src);
  }
  async _wire(src) {
    // the microphone's own sound system (it may have just been made anew)
    const ctx = src.context || getCtx();
    this.src = src; this.ctx = ctx; this.wireSr = ctx.sampleRate;
    if (ctx.audioWorklet) {
      await loadWorklet(ctx);
      this.node = new AudioWorkletNode(ctx, 'stand-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      this.sink = ctx.createGain(); this.sink.gain.value = 0;
      src.connect(this.node).connect(this.sink).connect(ctx.destination);
      this.chunks = [];
      this.node.port.onmessage = (e) => {
        const d = e.data;
        if (d.chunk) this.chunks.push(d.chunk);
        if (d.peak !== undefined && this.onLevel) this.onLevel(d.peak);
        if (d.done && this._resolveStop) this._resolveStop();
      };
    } else {
      // Fallback for very old Safari
      this.node = ctx.createScriptProcessor(4096, 1, 1);
      this.sink = ctx.createGain(); this.sink.gain.value = 0;
      src.connect(this.node).connect(this.sink).connect(ctx.destination);
      this.chunks = [];
      this.node.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        let peak = 0; for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
        if (this.onLevel) this.onLevel(peak);
        if (this.recording && (!this._at || getCtx().currentTime >= this._at)) this.chunks.push(ch.slice());
      };
    }
  }
  start(at = 0) {
    this.chunks = []; this.parts = []; this._stopping = false;
    if (!this.recording) holdSound(true);
    this.recording = true;
    this._at = at;
    if (this.node.port) this.node.port.postMessage({ cmd: 'start', at });
  }
  async stop() {
    const ctx = this.ctx || getCtx();
    this._stopping = true;
    // (a microphone being opened again: waited for, so nothing is left connected)
    for (let k = 0; k < 40 && this._recon; k++) await new Promise((r) => setTimeout(r, 50));
    if (this.recording) holdSound(false);
    if (this.node.port) {
      await new Promise((res) => { this._resolveStop = res; this.node.port.postMessage({ cmd: 'stop' }); setTimeout(res, 500); });
    }
    this.recording = false;
    try { this.src.disconnect(this.node); this.node.disconnect(); this.sink.disconnect(); } catch {}
    releaseMic();
    const sr = this.sr || ctx.sampleRate;
    this._flushTo(sr);
    // the parts one after another (silence where the microphone was lost; another rate brought to
    // the take's own)
    const pieces = [];
    for (const p of this.parts || []) {
      if (p.silence) { pieces.push(new Float32Array(p.silence)); continue; }
      let len = 0; for (const c of p.chunks) len += c.length;
      let d = new Float32Array(len); let o = 0; for (const c of p.chunks) { d.set(c, o); o += c.length; }
      if (p.sr && p.sr !== sr) { const k = p.sr / sr, n = Math.floor(len / k), r = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * k, j = Math.floor(x), f = x - j; r[i] = (d[j] || 0) * (1 - f) + (d[j + 1] || 0) * f; } d = r; }
      pieces.push(d);
    }
    let len = 0; for (const d of pieces) len += d.length;
    const data = new Float32Array(len);
    let o = 0; for (const d of pieces) { data.set(d, o); o += d.length; }
    this.chunks = []; this.parts = [];
    return { data, sr };
  }
  cancel() { if (this.node) { this.stop(); } }
}

export function computePeaks(data, n = 600) {
  const out = new Float32Array(n);
  const step = data.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0; const a = Math.floor(i * step), b = Math.min(data.length, Math.floor((i + 1) * step));
    for (let j = a; j < b; j++) { const v = Math.abs(data[j]); if (v > m) m = v; }
    out[i] = m;
  }
  return out;
}

export function peakOf(data) { let m = 0; for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > m) m = v; } return m; }

// ---------------- reverb ----------------
export const ROOMS = {
  dry: null,
  studio: { decay: 0.7, pre: 0.008, damp: 0.55, label: 'Studio' },
  hall: { decay: 1.9, pre: 0.022, damp: 0.45, label: 'Hall' },
  church: { decay: 3.6, pre: 0.035, damp: 0.38, label: 'Church' },
};

export function makeImpulse(ctx, room) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * (room.decay * 1.25 + room.pre));
  const ir = ctx.createBuffer(2, len, sr);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const pre = Math.round(room.pre * sr) + ch * 7;
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / room.decay);
      // high frequencies die faster than lows, like a real room
      const k = Math.min(0.97, 0.15 + room.damp * (t / room.decay) * 1.6);
      lp = lp * k + rnd() * (1 - k);
      const fadeIn = Math.min(1, t / 0.004);
      d[i] = lp * env * fadeIn * 3;
    }
    // a few early reflections
    // early reflections: walls, floor and ceiling, getting denser and softer, different in each ear
    let rs = 31 + ch * 17; const rr = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    const span = 18 + room.decay * 22;
    for (let r = 0; r < 18; r++) {
      const ms = 4 + Math.pow(rr(), 1.3) * span;
      const gg = 0.55 * Math.exp(-ms / (span * 0.7)) * (0.6 + rr() * 0.4);
      const i = pre + Math.round(ms * sr / 1000);
      // each reflection is a little blurred (a few samples), as from a real surface
      for (let q = -2; q <= 2; q++) if (i + q < len && i + q > 0) d[i + q] += gg * (rr() < 0.5 ? -1 : 1) * (1 - Math.abs(q) * 0.3) * 0.5;
    }
  }
  // normalise energy so all rooms sit at a similar level
  let e = 0; for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const g = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= g; }
  return ir;
}

// ---------------- WAV ----------------
export function encodeWav(channels, sr, bits = 16) {
  if (bits === 24) return encodeWav24(channels, sr);
  const nCh = channels.length, len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) {
    let s = Math.max(-1, Math.min(1, channels[c][i]));
    // TPDF dither
    s += (Math.random() - Math.random()) / 32768;
    v.setInt16(o, s < 0 ? Math.max(-32768, s * 32768) : Math.min(32767, s * 32767), true); o += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// studio quality (24-bit), for the audio of a composition
function encodeWav24(channels, sr) {
  const nCh = channels.length, len = channels[0].length, bytes = len * nCh * 3;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf), u = new Uint8Array(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 3, true); v.setUint16(32, nCh * 3, true); v.setUint16(34, 24, true); w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    let x = Math.round(s * 8388607); if (x < 0) x += 16777216;
    u[o++] = x & 255; u[o++] = (x >> 8) & 255; u[o++] = (x >> 16) & 255;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------------- player ----------------
let worker = null, jobId = 0;
const jobs = new Map();
function stretchAsync(data, sr, rate, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./stretch-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const j = jobs.get(e.data.id); if (!j) return;
      if (e.data.progress !== undefined) { j.onProgress && j.onProgress(e.data.progress); return; }
      jobs.delete(e.data.id); j.resolve(e.data.out);
    };
  }
  const id = ++jobId;
  return new Promise((resolve) => {
    jobs.set(id, { resolve, onProgress });
    const copy = data.slice();
    worker.postMessage({ id, data: copy, sr, rate }, [copy.buffer]);
  });
}

export class Player {
  constructor() {
    this.take = null; this.rate = 1; this.room = 'studio'; this.wet = 0.18; this.autoLevel = true;
    this.loop = false; this.a = 0; this.b = 0; this.pos = 0;
    this.playing = false; this.cache = new Map(); this.irCache = new Map();
    this.onState = null; this.onBusy = null;
    // iOS replaced the sound system while a take was playing: it goes on from where it was
    if (typeof window !== 'undefined') window.addEventListener('stand-audio-new', () => { if (this.playing && this.take) { const at = this.currentPos(); this._stopSource(); this.playing = false; this.pos = at; this.play(); } });
  }
  _graph() {
    const ctx = getCtx();
    // (a new sound system since: a new graph, or the take would play into the old one, silent)
    if (this.out && this.out.context === ctx) return;
    // (the prepared sound itself can be played in any sound system: it is kept)
    this.out = ctx.createGain();
    this.dry = ctx.createGain();
    this.conv = ctx.createConvolver(); this.conv.normalize = false;
    this.wetG = ctx.createGain();
    this.out.connect(this.dry).connect(master());
    this.out.connect(this.conv).connect(this.wetG).connect(master());
    this._applyRoom();
  }
  _applyRoom() {
    if (!this.out) return;
    const ctx = getCtx();
    const room = ROOMS[this.room];
    if (room) {
      if (!this.irCache.has(this.room)) this.irCache.set(this.room, makeImpulse(ctx, room));
      if (this.conv.buffer !== this.irCache.get(this.room)) this.conv.buffer = this.irCache.get(this.room);
    }
    const wet = room ? this.wet : 0;
    // equal-ish power blend that keeps the direct sound present
    this.dry.gain.setTargetAtTime(1 - wet * 0.35, ctx.currentTime, 0.03);
    this.wetG.gain.setTargetAtTime(wet * 0.55, ctx.currentTime, 0.03);
  }
  setRoom(room) { this.room = room; this._applyRoom(); }
  setWet(w) { this.wet = w; this._applyRoom(); }
  levelGain() {
    if (!this.take || !this.autoLevel) return 1;
    const p = this.take.peak || 0.0001;
    return Math.min(6, 0.89 / p);
  }
  setAutoLevel(on) { this.autoLevel = on; if (this.out) this.out.gain.setTargetAtTime(this.levelGain(), getCtx().currentTime, 0.03); }

  load(take, video) {
    this.stop();
    this.video = video || null;
    this.take = take; this.pos = 0; this.a = 0; this.b = 0; this.loop = false;
    this.cache.clear();
    this._emit();
  }
  get duration() { return this.take ? this.take.data.length / this.take.sr : 0; }

  async _buffer(rate) {
    const key = rate.toFixed(3);
    if (this.cache.has(key)) return this.cache.get(key);
    // (the same slowing down asked twice: done once; for this recording only)
    const take = this.take;
    if (this._making && this._making.take === take && this._making.key === key) return this._making.p;
    const p = (async () => {
      let data = take.data;
      if (Math.abs(rate - 1) > 1e-3) {
        this.onBusy && this.onBusy(true);
        try { data = await stretchAsync(take.data, take.sr, rate); } finally { this.onBusy && this.onBusy(false); }
      }
      if (take !== this.take) return null;   // (another recording loaded meanwhile)
      const buf = getCtx().createBuffer(1, Math.max(1, data.length), take.sr);
      buf.copyToChannel(data, 0);
      this.cache.set(key, buf);
      return buf;
    })();
    this._making = { take, key, p };
    let buf; try { buf = await p; } finally { if (this._making && this._making.p === p) this._making = null; }
    return buf;
  }

  currentPos() {
    if (!this.playing) return this.pos;
    const ctx = getCtx();
    // (the sound system replaced while playing: the time goes by the clock on the wall)
    let t = this.startOffset + (ctx === this.ctxPlaying ? ctx.currentTime - this.startTime : (performance.now() - this.startPerf) / 1000); // stretched seconds
    let orig = t * this.rate;
    if (this.loop && this.b > this.a) {
      const span = this.b - this.a;
      if (orig >= this.b) orig = this.a + ((orig - this.a) % span);
    }
    return Math.min(orig, this.duration);
  }

  async play() {
    if (!this.take) return;
    // (paused or stopped while the sound was being prepared: it does not start after all)
    const me = this._playTok = (this._playTok || 0) + 1;
    const rate = this.rate;
    const buf = await this._buffer(rate);
    if (rate !== this.rate || me !== this._playTok || !buf) return; // speed changed, or stopped, while preparing
    const ctx = getCtx();
    this._graph();
    this.out.gain.value = this.levelGain();
    this._stopSource();
    let from = this.pos;
    if (this.loop && this.b > this.a && (from < this.a || from >= this.b - 0.05)) from = this.a;
    if (!this.loop && from >= this.duration - 0.05) from = 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    if (this.loop && this.b > this.a) {
      src.loop = true; src.loopStart = this.a / rate; src.loopEnd = this.b / rate;
    }
    // the picture must be ready to move with the sound: wait a moment for it (a video that is
    // still loading used to stay still while the sound played)
    if (this.video && this.video.readyState < 2) {
      const v = this.video;
      await new Promise((r) => { const done = () => { v.removeEventListener('canplay', done); v.removeEventListener('loadeddata', done); clearTimeout(t); r(); }; const t = setTimeout(done, 1500); v.addEventListener('canplay', done); v.addEventListener('loadeddata', done); try { v.load && v.readyState === 0 && v.load(); } catch {} });
      if (rate !== this.rate || this.src || me !== this._playTok) return;
    }
    const when = ctx.currentTime + 0.02;
    src.start(when, from / rate);
    if (this.video) {
      const v = this.video;
      try {
        v.muted = true; v.playbackRate = rate; v.currentTime = from;
        const pr = v.play();
        // not allowed (yet): try once more a moment later; syncVideo keeps trying while playing
        if (pr && pr.catch) pr.catch(() => setTimeout(() => { if (this.playing && v.paused) v.play().catch(() => {}); }, 250));
      } catch {}
    }
    this.src = src; this.startTime = when; this.startOffset = from / rate; this.startPerf = performance.now() + 20; this.ctxPlaying = ctx;
    this.playing = true; wantAudio(true, 'player');
    src.onended = () => { if (this.src === src) { this.playing = false; wantAudio(false, 'player'); this.pos = this.loop ? this.a : 0; this._videoTo(this.pos, true); this._emit(); } };
    this._emit();
  }
  _stopSource() { if (this.src) { const s = this.src; this.src = null; try { s.onended = null; s.stop(); } catch {} } }
  pause() { this._playTok = (this._playTok || 0) + 1; if (!this.playing) return; this.pos = this.currentPos(); this._stopSource(); this.playing = false; wantAudio(false, 'player'); this._videoTo(this.pos, true); this._emit(); }
  stop() { this._playTok = (this._playTok || 0) + 1; this._stopSource(); this.playing = false; wantAudio(false, 'player'); if (this.video) try { this.video.pause(); } catch {} this._emit(); }
  async seek(t) { const was = this.playing; this.pause(); this.pos = Math.max(0, Math.min(this.duration, t)); this._videoTo(this.pos, true); if (was) await this.play(); else this._emit(); }
  attachVideo(el) { this.video = el; }
  _videoTo(t, pause) { const v = this.video; if (!v) return; try { if (pause) v.pause(); if (Math.abs(v.currentTime - t) > 0.02) v.currentTime = t; } catch {} }
  // Keep the picture locked to the (time-stretched) sound. Call every frame while playing.
  syncVideo() {
    const v = this.video; if (!v || !this.playing) return;
    const t = this.currentPos();
    if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
    // A small drift is corrected by speeding up or slowing down the picture a little: jumping the
    // time (setting currentTime) is what makes the picture stutter. Only a big gap is jumped over.
    const d = t - v.currentTime;
    if (Math.abs(d) > 0.6) { v.currentTime = t; if (Math.abs(v.playbackRate - this.rate) > 1e-3) v.playbackRate = this.rate; return; }
    // Changing the speed itself costs a frame on iPad, so it changes rarely: nothing while the
    // picture is within 60 ms, then a fixed 2% (or 5% for a bigger gap) until it is back in step.
    const ad = Math.abs(d);
    let k = this._vk || 0;
    if (ad < 0.02) k = 0; else if (ad > 0.06) k = Math.sign(d) * (ad > 0.25 ? 0.05 : 0.02);
    this._vk = k;
    const target = this.rate * (1 + k);
    if (Math.abs(v.playbackRate - target) > 1e-3) v.playbackRate = target;
  }
  async setRate(r) {
    if (Math.abs(r - this.rate) < 1e-4) return;
    const was = this.playing; const p = this.currentPos();
    this.pause(); this.rate = r; this.pos = p;
    if (was) await this.play(); else { this._emit(); this._buffer(r).catch(() => {}); }
  }
  async setLoop(on, a = this.a, b = this.b) {
    const was = this.playing; const p = this.currentPos();
    this.pause(); this.loop = on; this.a = a; this.b = b; this.pos = on && b > a ? a : p;
    if (was) await this.play(); else this._emit();
  }
  _emit() { this.onState && this.onState(); }

  // Render what you hear (speed, room, level, loop region) into a stereo WAV.
  async exportWav() {
    const sr = this.take.sr;
    const buf = await this._buffer(this.rate);
    let start = 0, end = buf.length;
    if (this.loop && this.b > this.a) { start = Math.floor((this.a / this.rate) * sr); end = Math.ceil((this.b / this.rate) * sr); }
    const room = ROOMS[this.room];
    const tail = room ? Math.ceil(room.decay * 1.25 * sr) : 0;
    const len = end - start + tail;
    const off = new OfflineAudioContext(2, len, sr);
    const src = off.createBufferSource();
    const piece = off.createBuffer(1, end - start, sr);
    piece.copyToChannel(buf.getChannelData(0).subarray(start, end), 0);
    src.buffer = piece;
    const g = off.createGain(); g.gain.value = this.levelGain();
    const dry = off.createGain(); dry.gain.value = room ? 1 - this.wet * 0.35 : 1;
    src.connect(g).connect(dry).connect(off.destination);
    if (room) {
      const conv = off.createConvolver(); conv.normalize = false; conv.buffer = makeImpulse(off, room);
      const wet = off.createGain(); wet.gain.value = this.wet * 0.55;
      g.connect(conv).connect(wet).connect(off.destination);
    }
    src.start();
    const rendered = await off.startRendering();
    const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
    let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (peak > 0.98) { const k = 0.98 / peak; for (let i = 0; i < L.length; i++) { L[i] *= k; R[i] *= k; } }
    return encodeWav([L, R], sr);
  }
}
