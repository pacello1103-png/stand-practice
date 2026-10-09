// Chromatic tuner (McLeod pitch method) and an intonation drone.
import { getCtx, master, acquireMic, releaseMic } from './audio.js';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function freqToNote(f, ref) {
  const midi = 69 + 12 * Math.log2(f / ref);
  const n = Math.round(midi);
  return { midi: n, name: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: (midi - n) * 100 };
}
export const noteFreq = (midi, ref) => ref * Math.pow(2, (midi - 69) / 12);

// McLeod Pitch Method on a mono buffer. Returns {freq, clarity} or null.
export function detectPitch(buf, sr) {
  const N = buf.length;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.004) return null;
  const minLag = Math.max(2, Math.floor(sr / 1600));
  const maxLag = Math.min(Math.floor(N / 2), Math.ceil(sr / 50));
  const nsdf = new Float32Array(maxLag + 1);
  let m = 0;
  for (let i = 0; i < N; i++) m += 2 * buf[i] * buf[i];
  for (let tau = 0; tau <= maxLag; tau++) {
    if (tau > 0) m -= buf[tau - 1] * buf[tau - 1] + buf[N - tau] * buf[N - tau];
    let acf = 0;
    const lim = N - tau;
    for (let i = 0; i < lim; i++) acf += buf[i] * buf[i + tau];
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // key maxima between positive zero crossings
  const peaks = [];
  let pos = false, best = -1, bestV = 0;
  for (let t = 1; t <= maxLag; t++) {
    if (!pos && nsdf[t - 1] <= 0 && nsdf[t] > 0) { pos = true; best = -1; bestV = 0; }
    else if (pos && nsdf[t - 1] > 0 && nsdf[t] <= 0) { pos = false; if (best > 0) peaks.push(best); }
    if (pos && t >= minLag && nsdf[t] > bestV) { bestV = nsdf[t]; best = t; }
  }
  if (pos && best > 0 && best < maxLag) peaks.push(best);
  if (!peaks.length) return null;
  let top = 0;
  for (const p of peaks) top = Math.max(top, nsdf[p]);
  const thresh = 0.88 * top;
  const tau = peaks.find((p) => nsdf[p] >= thresh);
  const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1] ?? b;
  const den = a - 2 * b + c;
  const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
  const clarity = b;
  if (clarity < 0.75) return null;
  return { freq: sr / (tau + shift), clarity };
}

export class Tuner {
  constructor() {
    this.ref = 442;
    this.running = false;
    this.onReading = null; // ({freq,name,octave,cents} | null)
  }
  async start() {
    if (this.running) return;
    const ctx = getCtx();
    const src = await acquireMic();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    // Gentle high-pass removes rumble that confuses low strings.
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 40;
    src.connect(this.hp).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.half = new Float32Array(this.analyser.fftSize / 2);
    this.hist = [];
    this.smooth = null;
    this.running = true;
    this.lastHeard = 0;
    let frame = 0;
    const loop = () => {
      if (!this.running) return;
      if ((frame++ & 1) === 0) this._analyse(ctx.sampleRate);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  _analyse(sr) {
    this.analyser.getFloatTimeDomainData(this.buf);
    const h = this.half;
    for (let i = 0; i < h.length; i++) h[i] = 0.5 * (this.buf[2 * i] + this.buf[2 * i + 1]);
    const r = detectPitch(h, sr / 2);
    const now = performance.now();
    if (!r) {
      if (now - this.lastHeard > 600) { this.hist = []; this.smooth = null; this.onReading && this.onReading(null); }
      return;
    }
    this.lastHeard = now;
    this.hist.push(r.freq);
    if (this.hist.length > 5) this.hist.shift();
    const sorted = [...this.hist].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    // jump straight to a new note, otherwise glide
    if (!this.smooth || Math.abs(1200 * Math.log2(med / this.smooth)) > 60) this.smooth = med;
    else this.smooth += 0.35 * (med - this.smooth);
    const n = freqToNote(this.smooth, this.ref);
    this.onReading && this.onReading({ freq: this.smooth, ...n });
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.hp.disconnect(); this.analyser.disconnect(); } catch {}
    releaseMic();
  }
}

// ---------------- Drone ----------------
function wave(ctx, kind) {
  const n = 24;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    let a = 0;
    if (kind === 'cello') a = Math.pow(k, -1.15) * (k === 2 ? 0.8 : 1) * (k % 5 === 0 ? 0.6 : 1);
    else if (kind === 'organ') a = ({ 1: 1, 2: 0.55, 3: 0.35, 4: 0.28, 6: 0.14, 8: 0.1 })[k] || 0;
    else a = k === 1 ? 1 : 0;
    im[k] = a;
  }
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

export class Drone {
  constructor() {
    this.ref = 442; this.pc = 9; this.octave = 2; this.sound = 'cello';
    this.fifth = true; this.lowOct = false; this.volume = 0.5;
    this.running = false; this.voices = [];
  }
  get midi() { return 12 * (this.octave + 1) + this.pc; }
  label() { return NOTE_NAMES[this.pc] + this.octave + (this.fifth ? ' + 5th' : ''); }
  _freqs() {
    const f = noteFreq(this.midi, this.ref);
    const out = [[f, 1]];
    if (this.fifth) out.push([f * 1.5, 0.6]);
    if (this.lowOct) out.push([f / 2, 0.7]);
    return out;
  }
  start() {
    const ctx = getCtx();
    if (this.running) this._stopVoices(0.15);
    this.out = this.out || (() => { const g = ctx.createGain(); g.connect(master()); return g; })();
    this.out.gain.setTargetAtTime(this.volume * 0.5, ctx.currentTime, 0.05);
    const pw = this.sound === 'pure' ? null : wave(ctx, this.sound);
    const now = ctx.currentTime;
    this.voices = this._freqs().map(([f, a]) => {
      const o = ctx.createOscillator();
      if (pw) o.setPeriodicWave(pw); else o.type = 'sine';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.min(9000, f * (this.sound === 'cello' ? 7 : 12)); lp.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(a / 1.6, now, 0.12);
      o.connect(lp).connect(g).connect(this.out);
      o.start(now);
      return { o, g, ratio: f / noteFreq(this.midi, this.ref) };
    });
    this.running = true;
  }
  _stopVoices(t = 0.25) {
    const ctx = getCtx(), now = ctx.currentTime;
    for (const v of this.voices) { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, t / 3); v.o.stop(now + t + 0.1); }
    this.voices = [];
  }
  stop() { if (!this.running) return; this._stopVoices(); this.running = false; }
  refresh() { if (this.running) this.start(); }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.5, getCtx().currentTime, 0.05); }
}
