// Chromatic tuner (McLeod pitch method via FFT autocorrelation), overtone analysis,
// harmonic-series playback and an intonation drone.
import { getCtx, master, acquireMic, releaseMic } from './audio.js';
import { NOTE_NAMES, centsOffset } from './temperament.js';
import { playNote, holdNote, pluckTanpura } from './synth.js';
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
  if (b < 0.5) return null;
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

// Turns raw per-frame pitch estimates into a steady reading: an adaptive noise gate,
// hysteresis on clarity, median smoothing, protection against octave jumps, and a short hold
// after the sound stops so the display does not flicker.
export class PitchTracker {
  constructor() { this.floor = 0.002; this.reset(); }
  reset() { this.cur = 0; this.hist = []; this.cand = null; this.lastHeard = 0; }
  feed(r, rms, now) {
    const gate = Math.max(0.0035, this.floor * 2.8);
    const valid = r && r.rms > gate && r.clarity >= (this.cur ? 0.7 : 0.85);
    if (!valid) {
      this.floor = 0.97 * this.floor + 0.03 * Math.max(0.0008, Math.min(0.05, rms));
      if (this.cur && now - this.lastHeard < 1100) return { f: this.cur, held: true, clarity: 0 };
      if (this.cur) this.reset();
      this.cand = null;
      return null;
    }
    const f = r.freq;
    this.lastHeard = now;
    if (this.cur) {
      const d = 1200 * Math.log2(f / this.cur);
      if (Math.abs(d) < 60) {
        this.cand = null;
        this.hist.push(f); if (this.hist.length > 5) this.hist.shift();
        const med = [...this.hist].sort((a, b) => a - b)[this.hist.length >> 1];
        this.cur += 0.35 * (med - this.cur);
        return { f: this.cur, held: false, clarity: r.clarity };
      }
      // a jump: only believe it when it repeats (octave jumps need more proof)
      const octave = Math.abs(Math.abs(d) - 1200) < 70 || Math.abs(Math.abs(d) - 1902) < 70;
      const need = octave && r.clarity < 0.95 ? 6 : 3;
      if (this.cand && Math.abs(1200 * Math.log2(f / this.cand.f)) < 45) this.cand.n++; else this.cand = { f, n: 1 };
      if (this.cand.n >= need) { this.cur = this.cand.f; this.hist = [this.cand.f]; this.cand = null; return { f: this.cur, held: false, clarity: r.clarity }; }
      return { f: this.cur, held: false, clarity: r.clarity };
    }
    if (this.cand && Math.abs(1200 * Math.log2(f / this.cand.f)) < 45) this.cand.n++; else this.cand = { f, n: 1 };
    if (this.cand.n >= 2) { this.cur = this.cand.f; this.hist = [this.cur]; this.cand = null; return { f: this.cur, held: false, clarity: r.clarity }; }
    return null;
  }
}

export class Tuner {
  constructor() {
    this.ref = 442; this.key = 0; this.system = 'equal';
    this.strings = []; // [{freq,label}] open-string targets
    this.running = false;
    this.onReading = null;
    this.trace = []; // {t, cents, name}
    this.lastBuf = null; this.lastF0 = 0;
    this.tracker = new PitchTracker();
  }
  async start() {
    if (this.running) return;
    const ctx = getCtx();
    const src = await acquireMic();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 30; this.hp.Q.value = 0.6;
    src.connect(this.hp).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.tracker.reset(); this.running = true; this.wasNull = true;
    const loop = () => {
      if (!this.running) return;
      this._analyse(ctx.sampleRate);
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
    const cents = n.cents - off;
    return { ...n, cents, target: noteFreq(n.midi, this.ref) * Math.pow(2, off / 1200), offset: off };
  }
  _analyse(sr) {
    this.analyser.getFloatTimeDomainData(this.buf);
    let ms = 0; for (let i = 0; i < this.buf.length; i++) ms += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(ms / this.buf.length);
    const r = rms > 0.0012 ? detectPitch(this.buf, sr) : null;
    const now = performance.now();
    const out = this.tracker.feed(r, rms, now);
    if (!out) { if (!this.wasNull) { this.wasNull = true; this.onReading && this.onReading(null); } return; }
    this.wasNull = false;
    const t = this._target(out.f);
    if (!out.held) {
      this.lastBuf = this.buf.slice(); this.lastF0 = out.f; this.lastSr = sr;
      this.trace.push({ t: now, cents: t.cents, name: t.name });
      while (this.trace.length && now - this.trace[0].t > 10000) this.trace.shift();
    }
    this.onReading && this.onReading({ freq: out.f, held: out.held, ...t });
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

// ---------- natural harmonics on open strings ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const INTERVALS = { 0: 'unison', 1: 'semitone', 2: 'whole tone', 3: 'minor third', 4: 'major third', 5: 'fourth', 6: 'tritone', 7: 'fifth', 8: 'minor sixth', 9: 'major sixth', 10: 'minor seventh', 11: 'major seventh', 12: 'octave' };
export function intervalName(semis) {
  const r = Math.round(semis);
  if (r <= 12) return INTERVALS[r];
  if (r % 12 === 0) return r === 24 ? 'two octaves' : `${r / 12} octaves`;
  return (r < 24 ? 'octave + ' : 'two octaves + ') + INTERVALS[r % 12];
}
// Which natural harmonic(s) on the open strings sound at this frequency?
export function naturalHarmonics(freq, strings, maxN = 10) {
  const out = [];
  for (const s of strings) {
    const n = Math.round(freq / s.freq);
    if (n < 2 || n > maxN) continue;
    const cents = 1200 * Math.log2(freq / (n * s.freq));
    if (Math.abs(cents) > 30) continue;
    const touches = [];
    for (let k = 1; k < n && touches.length < 2; k++) {
      if (gcd(k, n) !== 1) continue;
      const semis = 12 * Math.log2(1 / (1 - k / n));
      touches.push({ k, semis, midi: s.midi + Math.round(semis), off: Math.round((semis - Math.round(semis)) * 100), name: intervalName(semis) });
    }
    out.push({ string: s, n, cents, touches, f: n * s.freq });
  }
  out.sort((a, b) => a.n - b.n);
  return out;
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
export const DRONE_VOICES = { strings: 'Strings', organ: 'Organ', choir: 'Voices', tanpura: 'Tanpura', pure: 'Pure tone' };
export const DRONE_CHORDS = {
  root: { label: 'Root', r: [1] }, fifth: { label: '+ Fifth', r: [1, 3 / 2] }, octave: { label: '+ Octave', r: [1, 2] },
  open: { label: 'Fifth + octave', r: [1, 3 / 2, 2] }, major: { label: 'Major', r: [1, 5 / 4, 3 / 2] }, minor: { label: 'Minor', r: [1, 6 / 5, 3 / 2] },
};
const TANPURA = { slow: 5.2, medium: 4, fast: 2.8 };
export class Drone {
  constructor() {
    this.ref = 442; this.pc = 9; this.octave = 2; this.sound = 'strings'; this.chord = 'fifth';
    this.lowOct = false; this.volume = 0.5; this.speed = 'medium';
    this.running = false; this.voices = [];
  }
  get midi() { return 12 * (this.octave + 1) + this.pc; }
  label() { return NOTE_NAMES[this.pc] + this.octave + (this.sound === 'tanpura' ? ' tanpura' : this.chord === 'root' ? '' : ' ' + DRONE_CHORDS[this.chord].label.replace('+ ', '+')); }
  ratios() { const r = (DRONE_CHORDS[this.chord] || DRONE_CHORDS.root).r; return this.lowOct ? [0.5, ...r] : r; }
  _out() {
    const ctx = getCtx();
    if (!this.out) { this.out = ctx.createGain(); this.out.connect(master()); }
    this.out.gain.setTargetAtTime(this.volume * 0.6, ctx.currentTime, 0.05);
    return this.out;
  }
  start() {
    if (this.running) this._stopVoices();
    const f0 = noteFreq(this.midi, this.ref), out = this._out();
    if (this.sound === 'tanpura') this._tanpura(f0, out);
    else this.voices = this.ratios().map((k, i) => holdNote(out, f0 * k, this.sound, i === 0 || k === 0.5 ? 1 : 0.62));
    this.running = true;
  }
  _tanpura(sa, out) {
    const ctx = getCtx();
    const cycle = TANPURA[this.speed] || 4;
    const pattern = [[0, 3 / 4], [0.3, 1], [0.48, 1], [0.66, 1 / 2]]; // Pa, Sa, Sa, low Sa
    let next = ctx.currentTime + 0.05, step = 0;
    const tick = () => {
      while (next < getCtx().currentTime + 0.3) {
        const [pos, ratio] = pattern[step % 4];
        const base = Math.floor(step / 4) * cycle;
        pluckTanpura(out, sa * ratio, this._t0 + base + pos * cycle, ratio === 1 / 2 ? 1.1 : 1);
        step++;
        const [np] = pattern[step % 4];
        next = this._t0 + Math.floor(step / 4) * cycle + np * cycle;
      }
    };
    this._t0 = next;
    tick();
    const timer = setInterval(tick, 60);
    this.voices = [{ stop: () => clearInterval(timer) }];
  }
  _stopVoices() { const now = getCtx().currentTime; for (const v of this.voices) v.stop(now); this.voices = []; }
  stop() {
    if (!this.running) return;
    this._stopVoices(); this.running = false;
    if (this.sound === 'tanpura' && this.out) {
      // let the ringing strings fade instead of cutting them
      const g = this.out, ctx = getCtx(); g.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      this.out = null; setTimeout(() => { try { g.disconnect(); } catch {} }, 2500);
    }
  }
  refresh() { if (this.running) this.start(); }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.6, getCtx().currentTime, 0.05); }
}

// One soft reference tone (for tapping a string in the tuner).
export function playRefTone(freq, dur = 2.2, volume = 0.6) {
  const ctx = getCtx();
  const g = ctx.createGain(); g.gain.value = volume; g.connect(master());
  playNote(g, freq, ctx.currentTime + 0.02, dur, 'strings', 1);
}
