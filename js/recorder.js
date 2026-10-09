// Recorder (raw PCM, no processing) and a player with pitch-preserving slow-down and reverb.
import { getCtx, master, acquireMic, releaseMic } from './audio.js';

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

let workletReady = null;
function loadWorklet(ctx) {
  if (!workletReady) {
    const url = URL.createObjectURL(new Blob([CAPTURE_SRC], { type: 'application/javascript' }));
    workletReady = ctx.audioWorklet.addModule(url);
  }
  return workletReady;
}

export class Recorder {
  constructor() { this.recording = false; this.onLevel = null; }
  async prepare() {
    const ctx = getCtx();
    const src = await acquireMic();
    this.src = src;
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
    this.chunks = [];
    this.recording = true;
    this._at = at;
    if (this.node.port) this.node.port.postMessage({ cmd: 'start', at });
  }
  async stop() {
    const ctx = getCtx();
    if (this.node.port) {
      await new Promise((res) => { this._resolveStop = res; this.node.port.postMessage({ cmd: 'stop' }); setTimeout(res, 500); });
    }
    this.recording = false;
    try { this.src.disconnect(this.node); this.node.disconnect(); this.sink.disconnect(); } catch {}
    releaseMic();
    let len = 0; for (const c of this.chunks) len += c.length;
    const data = new Float32Array(len);
    let o = 0; for (const c of this.chunks) { data.set(c, o); o += c.length; }
    this.chunks = [];
    return { data, sr: ctx.sampleRate };
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
    for (const [ms, g] of [[11, 0.5], [17, 0.35], [23, 0.3], [31, 0.22], [43, 0.16]]) {
      const i = pre + Math.round((ms * (1 + ch * 0.07) * room.decay ** 0.3) * sr / 1000);
      if (i < len) d[i] += g * (ch ? -1 : 1) * 0.6;
    }
  }
  // normalise energy so all rooms sit at a similar level
  let e = 0; for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const g = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= g; }
  return ir;
}

// ---------------- WAV ----------------
export function encodeWav(channels, sr) {
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
  }
  _graph() {
    const ctx = getCtx();
    if (this.out) return;
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
    const ctx = getCtx();
    let data = this.take.data;
    if (Math.abs(rate - 1) > 1e-3) {
      this.onBusy && this.onBusy(true);
      data = await stretchAsync(this.take.data, this.take.sr, rate);
      this.onBusy && this.onBusy(false);
    }
    const buf = ctx.createBuffer(1, Math.max(1, data.length), this.take.sr);
    buf.copyToChannel(data, 0);
    this.cache.set(key, buf);
    return buf;
  }

  currentPos() {
    if (!this.playing) return this.pos;
    const ctx = getCtx();
    let t = this.startOffset + (ctx.currentTime - this.startTime) * 1; // stretched seconds
    let orig = t * this.rate;
    if (this.loop && this.b > this.a) {
      const span = this.b - this.a;
      if (orig >= this.b) orig = this.a + ((orig - this.a) % span);
    }
    return Math.min(orig, this.duration);
  }

  async play() {
    if (!this.take) return;
    const ctx = getCtx();
    this._graph();
    this.out.gain.value = this.levelGain();
    const rate = this.rate;
    const buf = await this._buffer(rate);
    if (rate !== this.rate) return; // speed changed while preparing
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
    const when = ctx.currentTime + 0.02;
    src.start(when, from / rate);
    if (this.video) {
      const v = this.video;
      try { v.muted = true; v.playbackRate = rate; v.currentTime = from; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {}
    }
    this.src = src; this.startTime = when; this.startOffset = from / rate;
    this.playing = true;
    src.onended = () => { if (this.src === src) { this.playing = false; this.pos = this.loop ? this.a : 0; this._videoTo(this.pos, true); this._emit(); } };
    this._emit();
  }
  _stopSource() { if (this.src) { const s = this.src; this.src = null; try { s.onended = null; s.stop(); } catch {} } }
  pause() { if (!this.playing) return; this.pos = this.currentPos(); this._stopSource(); this.playing = false; this._videoTo(this.pos, true); this._emit(); }
  stop() { this._stopSource(); this.playing = false; if (this.video) try { this.video.pause(); } catch {} this._emit(); }
  async seek(t) { const was = this.playing; this.pause(); this.pos = Math.max(0, Math.min(this.duration, t)); this._videoTo(this.pos, true); if (was) await this.play(); else this._emit(); }
  attachVideo(el) { this.video = el; }
  _videoTo(t, pause) { const v = this.video; if (!v) return; try { if (pause) v.pause(); if (Math.abs(v.currentTime - t) > 0.02) v.currentTime = t; } catch {} }
  // Keep the picture locked to the (time-stretched) sound. Call every frame while playing.
  syncVideo() {
    const v = this.video; if (!v || !this.playing) return;
    const t = this.currentPos();
    if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
    if (Math.abs(v.playbackRate - this.rate) > 1e-3) v.playbackRate = this.rate;
    if (Math.abs(v.currentTime - t) > 0.12) v.currentTime = t;
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
