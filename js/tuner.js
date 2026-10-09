// Chromatic tuner (McLeod pitch method via FFT autocorrelation), overtone analysis,
// harmonic-series playback and an intonation drone.
import { getCtx, master, acquireMic, releaseMic } from './audio.js';
import { NOTE_NAMES, centsOffset } from './temperament.js';
export { NOTE_NAMES };

export function freqToNote(f, ref) {
  const midi = 69 + 12 * Math.log2(f / ref);
  const n = Math.round(midi);
  return { midi: n, pc: ((n % 12) + 12) % 12, name: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1, cents: (midi - n) * 100 };
}
export const noteFreq = (midi, ref) => ref * Math.pow(2, (midi - 69) / 12);

// ---------- FFT (iterative radix-2, in place) ----------
const twiddles = new Map();
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  let tw = twiddles.get(n);
  if (!tw) {
    tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) { tw.c[i] = Math.cos((2 * Math.PI * i) / n); tw.s[i] = Math.sin((2 * Math.PI * i) / n); }
    twiddles.set(n, tw);
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = tw.c[k], wi = sign * tw.s[k];
        const a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

// McLeod Pitch Method. buf: mono samples. Returns {freq, clarity} or null.
export function detectPitch(buf, sr) {
  const N = buf.length;
  let ms = 0;
  for (let i = 0; i < N; i++) ms += buf[i] * buf[i];
  const rms = Math.sqrt(ms / N);
  if (rms < 0.003) return null;
  const M = 1 << Math.ceil(Math.log2(2 * N));
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let i = 0; i < N; i++) re[i] = buf[i];
  fft(re, im, false);
  for (let i = 0; i < M; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft(re, im, true);
  const minLag = Math.max(2, Math.floor(sr / 4400));
  const maxLag = Math.min(Math.floor(N / 2), Math.ceil(sr / 38));
  const nsdf = new Float64Array(maxLag + 2);
  let m = 2 * ms; // sum of squares over both windows at tau = 0
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    if (tau > 0) m -= buf[tau - 1] * buf[tau - 1] + buf[N - tau] * buf[N - tau];
    nsdf[tau] = m > 1e-12 ? (2 * (re[tau] / M)) / m : 0;
  }
  const peaks = [];
  let pos = false, best = -1, bestV = 0;
  for (let t = 1; t <= maxLag; t++) {
    if (!pos && nsdf[t - 1] <= 0 && nsdf[t] > 0) { pos = true; best = -1; bestV = 0; }
    else if (pos && nsdf[t - 1] > 0 && nsdf[t] <= 0) { pos = false; if (best > 0) peaks.push(best); }
    if (pos && t >= minLag && nsdf[t] > bestV) { bestV = nsdf[t]; best = t; }
  }
  if (pos && best > 0) peaks.push(best);
  if (!peaks.length) return null;
  let top = 0;
  for (const p of peaks) top = Math.max(top, nsdf[p]);
  const tau = peaks.find((p) => nsdf[p] >= 0.9 * top);
  const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? Math.max(-1, Math.min(1, (0.5 * (a - c)) / den)) : 0;
  if (b < 0.8) return null;
  let period = tau + shift;
  // Precision: measure across several periods (the k-th repetition) when it is clear enough.
  const interp = (t) => { const p = nsdf[t - 1], q = nsdf[t], r = nsdf[t + 1]; const d = p - 2 * q + r; return d !== 0 ? t + Math.max(-1, Math.min(1, (0.5 * (p - r)) / d)) : t; };
  for (let k = Math.floor((maxLag - 1) / period); k >= 2; k--) {
    const centre = Math.round(k * period);
    let bt = centre, bv = -1;
    for (let t = Math.max(1, centre - 3); t <= Math.min(maxLag, centre + 3); t++) if (nsdf[t] > bv) { bv = nsdf[t]; bt = t; }
    if (bv > 0.85 * b && bt > 1 && bt < maxLag) { period = interp(bt) / k; break; }
  }
  return { freq: sr / period, clarity: b, rms };
}

// Relative strength (dB, 0 = loudest) of partials 1..n of f0 in buf.
export function harmonicProfile(buf, sr, f0, n = 12) {
  const N = buf.length;
  const M = 1 << Math.ceil(Math.log2(N * 2));
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let i = 0; i < N; i++) re[i] = buf[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im, false);
  const mag = (k) => Math.hypot(re[k], im[k]);
  const out = [];
  let max = 1e-12;
  for (let h = 1; h <= n; h++) {
    const f = f0 * h;
    if (f > sr / 2 - 100) { out.push(0); continue; }
    const center = (f * M) / sr;
    const span = Math.max(2, center * 0.025);
    let m = 0;
    for (let k = Math.floor(center - span); k <= Math.ceil(center + span); k++) if (k > 0 && k < M / 2) m = Math.max(m, mag(k));
    out.push(m); max = Math.max(max, m);
  }
  return out.map((m) => (m > 0 ? Math.max(-60, 20 * Math.log10(m / max)) : -60));
}

export class Tuner {
  constructor() {
    this.ref = 442; this.key = 0; this.system = 'equal';
    this.strings = []; // [{freq,label}] open-string targets
    this.running = false;
    this.onReading = null;
    this.trace = []; // {t, cents, name}
    this.lastBuf = null; this.lastF0 = 0;
  }
  async start() {
    if (this.running) return;
    const ctx = getCtx();
    const src = await acquireMic();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 32; this.hp.Q.value = 0.6;
    src.connect(this.hp).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.hist = []; this.smooth = null; this.lastHeard = 0; this.running = true;
    let frame = 0;
    const loop = () => {
      if (!this.running) return;
      if ((frame++ & 1) === 0) this._analyse(ctx.sampleRate);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  // Which target are we aiming at? Open string (pure fifths) when close, else the tempered note.
  _target(f) {
    const n = freqToNote(f, this.ref);
    for (const s of this.strings) {
      const c = 1200 * Math.log2(f / s.freq);
      if (Math.abs(c) < 45) return { ...n, cents: c, target: s.freq, string: s.label };
    }
    const off = centsOffset(n.pc, this.key, this.system);
    let cents = n.cents - off;
    return { ...n, cents, target: noteFreq(n.midi, this.ref) * Math.pow(2, off / 1200), offset: off };
  }
  _analyse(sr) {
    this.analyser.getFloatTimeDomainData(this.buf);
    const r = detectPitch(this.buf, sr);
    const now = performance.now();
    if (!r) {
      if (now - this.lastHeard > 500) { this.hist = []; this.smooth = null; this.onReading && this.onReading(null); }
      return;
    }
    this.lastHeard = now;
    this.hist.push(r.freq);
    if (this.hist.length > 5) this.hist.shift();
    const sorted = [...this.hist].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    if (!this.smooth || Math.abs(1200 * Math.log2(med / this.smooth)) > 50) { this.smooth = med; this.hist = [r.freq]; }
    else this.smooth += 0.3 * (med - this.smooth);
    const t = this._target(this.smooth);
    this.lastBuf = this.buf.slice(); this.lastF0 = this.smooth; this.lastSr = sr;
    this.trace.push({ t: now, cents: t.cents, name: t.name });
    while (this.trace.length && now - this.trace[0].t > 10000) this.trace.shift();
    this.onReading && this.onReading({ freq: this.smooth, ...t });
  }
  harmonics(n = 10) { return this.lastBuf ? harmonicProfile(this.lastBuf, this.lastSr, this.lastF0, n) : null; }
  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.hp.disconnect(); this.analyser.disconnect(); } catch {}
    releaseMic();
  }
}

// ---------- hearing the harmonic series ----------
let hsOut = null, hsVoices = [];
export function stopHarmonics() {
  const ctx = getCtx(), now = ctx.currentTime;
  for (const v of hsVoices) { try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.08); v.o.stop(now + 0.5); } catch {} }
  hsVoices = [];
}
// mode: 'one' (single partial h), 'series' (partials enter one by one and stay), 'chord'
export function playHarmonics(f0, { mode = 'series', h = 1, count = 8, volume = 0.5 } = {}) {
  const ctx = getCtx();
  stopHarmonics();
  if (!hsOut) { hsOut = ctx.createGain(); hsOut.connect(master()); }
  hsOut.gain.value = volume;
  const now = ctx.currentTime + 0.03;
  const list = mode === 'one' ? [h] : Array.from({ length: count }, (_, i) => i + 1);
  const stepT = mode === 'series' ? 0.7 : 0;
  const total = mode === 'one' ? 2.2 : mode === 'series' ? list.length * stepT + 2 : 3.5;
  list.forEach((k, i) => {
    const f = f0 * k;
    if (f > 12000) return;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0;
    const start = now + i * stepT;
    const level = (mode === 'one' ? 0.55 : 0.42 / Math.sqrt(list.length)) * (k === 1 && mode !== 'one' ? 1.1 : 1);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(level, start + 0.08);
    g.gain.setTargetAtTime(0, now + total - 0.4, 0.15);
    o.connect(g).connect(hsOut);
    o.start(start); o.stop(now + total + 0.5);
    hsVoices.push({ o, g, k, start });
  });
  return { start: now, step: stepT, total };
}

// ---------------- Drone ----------------
function wave(ctx, kind) {
  const n = 24;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    let a = 0;
    if (kind === 'cello') a = Math.pow(k, -1.2) * (k === 2 ? 0.8 : 1) * (k % 5 === 0 ? 0.6 : 1);
    else if (kind === 'organ') a = ({ 1: 1, 2: 0.55, 3: 0.35, 4: 0.28, 6: 0.14, 8: 0.1 })[k] || 0;
    else a = k === 1 ? 1 : 0;
    im[k] = a;
  }
  return ctx.createPeriodicWave(re, im);
}

export class Drone {
  constructor() {
    this.ref = 442; this.pc = 9; this.octave = 2; this.sound = 'cello';
    this.fifth = true; this.lowOct = false; this.third = false; this.minor = false; this.volume = 0.5;
    this.running = false; this.voices = [];
  }
  get midi() { return 12 * (this.octave + 1) + this.pc; }
  label() { return NOTE_NAMES[this.pc] + this.octave + (this.third ? (this.minor ? ' minor' : ' major') : this.fifth ? ' + 5th' : ''); }
  _freqs() {
    const f = noteFreq(this.midi, this.ref);
    const out = [[f, 1]];
    if (this.fifth || this.third) out.push([f * 1.5, 0.55]);
    if (this.third) out.push([f * (this.minor ? 6 / 5 : 5 / 4), 0.45]);
    if (this.lowOct) out.push([f / 2, 0.7]);
    return out;
  }
  start() {
    const ctx = getCtx();
    if (this.running) this._stopVoices(0.15);
    if (!this.out) { this.out = ctx.createGain(); this.out.connect(master()); }
    this.out.gain.setTargetAtTime(this.volume * 0.5, ctx.currentTime, 0.05);
    const pw = this.sound === 'pure' ? null : wave(ctx, this.sound);
    const now = ctx.currentTime;
    this.voices = this._freqs().map(([f, a]) => {
      const o = ctx.createOscillator();
      if (pw) o.setPeriodicWave(pw); else o.type = 'sine';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.min(9000, f * (this.sound === 'cello' ? 6 : 12)); lp.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(a / 1.8, now, 0.15);
      o.connect(lp).connect(g).connect(this.out);
      o.start(now);
      return { o, g };
    });
    this.running = true;
  }
  _stopVoices(t = 0.3) {
    const ctx = getCtx(), now = ctx.currentTime;
    for (const v of this.voices) { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, t / 3); v.o.stop(now + t + 0.2); }
    this.voices = [];
  }
  stop() { if (!this.running) return; this._stopVoices(); this.running = false; }
  refresh() { if (this.running) this.start(); }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.5, getCtx().currentTime, 0.05); }
}

// One soft reference tone (for tapping a string in the tuner).
export function playRefTone(freq, dur = 2.2, volume = 0.45) {
  const ctx = getCtx();
  const now = ctx.currentTime + 0.02;
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave(ctx, 'cello'));
  o.frequency.value = freq;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(8000, freq * 6);
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setTargetAtTime(volume * 0.5, now, 0.06); g.gain.setTargetAtTime(0, now + dur - 0.3, 0.12);
  o.connect(lp).connect(g).connect(master());
  o.start(now); o.stop(now + dur + 0.6);
}
