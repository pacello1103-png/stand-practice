// Chromatic tuner (McLeod pitch method via FFT autocorrelation), overtone analysis,
// harmonic-series playback and an intonation drone.
import { getCtx, master, acquireMic, releaseMic, ensureRunning, wantAudio, freshSound } from './audio.js';
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
export function detectPitch(buf, sr, minRms = 0.003) {
  const N = buf.length;
  let ms = 0;
  for (let i = 0; i < N; i++) ms += buf[i] * buf[i];
  const rms = Math.sqrt(ms / N);
  if (rms < minRms) return null;
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
  constructor() { this.floor = 0.0008; this.reset(); }
  reset() { this.cur = 0; this.hist = []; this.cand = null; this.lastHeard = 0; }
  feed(r, rms, now) {
    // the noise floor follows the quiet moments quickly and loud noise only slowly (and never far),
    // so talking, a fan or a page turn cannot make the tuner deaf to the next note
    const gate = Math.min(0.008, Math.max(0.0007, this.floor * 1.8));
    // real strings carry bow and breath noise: a clear note keeps being followed at a lower clarity;
    // a clearly pitched sound counts even when it is not much louder than the noise around it
    // and while a note sounds, a reading near it is believed even through noise (continuity)
    const near = r && this.cur && Math.abs(1200 * Math.log2(r.freq / this.cur)) < 50;
    const valid = r && ((r.clarity >= (this.cur ? 0.6 : 0.7) && (r.rms > gate || r.clarity >= 0.8)) || (near && r.clarity >= 0.4));
    if (!valid) {
      const x = Math.max(0.0003, Math.min(0.05, rms));
      this.floor = x < this.floor ? 0.85 * this.floor + 0.15 * x : 0.996 * this.floor + 0.004 * x;
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
      const need = octave ? (r.clarity < 0.95 ? 5 : 3) : r.clarity >= 0.9 ? 2 : 3;
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
    // Playing with others: the instrument is the loudest thing near the microphone, and it can only
    // play in its own range. Sounds well below the loudest recent level, or outside the range, are
    // left out, so the tuner stays on you.
    this.focus = true; this.range = null; this.peak = 0;
  }
  // the lowest and highest pitch the instrument plays (Hz), or null for any
  setRange(lo, hi) { this.range = lo && hi ? [lo, hi] : null; if (this.hp) this.hp.frequency.value = this.range ? Math.max(30, lo * 0.7) : 30; }
  // on, or on its way (the microphone is still opening)
  get active() { return this.running || !!this._starting; }
  start() {
    this._cancel = false;                 // a start after a stop that came while opening still counts
    if (this.running) return Promise.resolve();
    if (!this._starting) {
      this._cancel = false;
      this._starting = this._start().finally(() => { this._starting = null; });
    }
    return this._starting;
  }
  async _start() {
    if (!this._wired) {
      this._wired = true;
      window.addEventListener('stand-audio-new', () => { if (this.running) this.restart(); });
    }
    await ensureRunning();
    const src = await acquireMic();
    const ctx = src.context || getCtx();
    if (this._cancel) { releaseMic(); return; }   // stopped while the microphone was opening
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = this.range ? Math.max(30, this.range[0] * 0.7) : 30; this.hp.Q.value = 0.6;
    src.connect(this.hp).connect(this.analyser);
    // a shorter window answers faster (quick passages); only very low notes need the long one
    this.buf = new Float32Array(this.long ? 4096 : 2048);
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
    let n = freqToNote(f, this.ref);
    // Hold on to the note you are on until you are clearly on the next one, so a note near a
    // quarter tone (or with wide vibrato) does not flip the display between two notes.
    const mf = 69 + 12 * Math.log2(f / this.ref);
    if (this.lastMidi !== undefined && n.midi !== this.lastMidi && Math.abs(mf - this.lastMidi) < 0.68) {
      const m = this.lastMidi;
      n = { midi: m, pc: ((m % 12) + 12) % 12, name: NOTE_NAMES[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1, cents: (mf - m) * 100 };
    }
    this.lastMidi = n.midi;
    for (const s of this.strings) {
      const c = 1200 * Math.log2(f / s.freq);
      if (Math.abs(c) < 45) return { ...n, cents: c, target: s.freq, string: s.label };
    }
    const off = centsOffset(n.pc, this.key, this.system);
    const cents = n.cents - off;
    return { ...n, cents, target: noteFreq(n.midi, this.ref) * Math.pow(2, off / 1200), offset: off };
  }
  // A metronome click in what the microphone just heard (its window, and the way out and back in):
  // the reading is held over it, so the clicks never show as notes or move the needle.
  _inClick(ctx) {
    const c = globalThis.__clicks; if (!c || !c.length) return false;
    // (clicks very close together would leave almost nothing to hear: then they are not left out)
    if (c.length > 1 && c[c.length - 1].t - c[c.length - 2].t < 0.28) return false;
    const now = ctx.currentTime, lat = Math.min(0.25, (ctx.outputLatency || 0) + (ctx.baseLatency || 0)) + 0.02;
    const win = this.buf.length / ctx.sampleRate;
    for (const k of c) if (k.ctx === ctx && now >= k.t && now - win - lat <= k.t + Math.min(k.d, 0.06)) return true;
    return false;
  }
  _analyse(sr) {
    this.analyser.getFloatTimeDomainData(this.buf);
    if (this.ignoreClicks !== false && this._inClick(this.analyser.context)) return;
    let ms = 0; for (let i = 0; i < this.buf.length; i++) ms += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(ms / this.buf.length);
    // Kept alive: a sound system that was interrupted is woken up, and a microphone that went
    // silent for good (a call, another app took it) is opened again.
    // (Only a running sound system with a silent microphone is rebuilt, and not more than once in
    // a few seconds: reopening the microphone over and over upset the metronome.)
    if (rms === 0) {
      this._zero = (this._zero || 0) + 1;
      const ctx = getCtx();
      if (ctx.state !== 'running') { if (this._zero % 30 === 0) ensureRunning().catch(() => {}); }
      else if (this._zero > 150 && performance.now() - (this._restartAt || -1e9) > 6000) { this._zero = 0; this._restartAt = performance.now(); this.restart(); return; }
    } else this._zero = 0;
    // the loudest note of the last seconds (falls slowly). Only notes count: a knock, talking or
    // any noise without a pitch never raises it, so noise cannot hide your playing.
    this.peak *= 0.985;
    // much quieter than you just played (more than 18 dB): another player, not you. A sudden
    // piano of your own still shows within a moment, as the level of the last loud note fades.
    // (soft playing must always be heard: only much quieter sounds, -28 dB, count as someone else)
    const quietOther = this.focus && this.peak > 0.02 && rms < this.peak * 0.04;
    let r = rms > 0.00035 && !quietOther ? detectPitch(this.buf, sr, 0.00035) : null;
    if (r && r.clarity >= 0.8) this.peak = Math.max(this.peak, rms);
    // a low note the short window cannot hold: look again with the long one
    if (!r && !quietOther && !this.long && rms > 0.00035) { if (!this.big) this.big = new Float32Array(4096); this.analyser.getFloatTimeDomainData(this.big); r = detectPitch(this.big, sr, 0.00035); }
    // outside what the instrument can play: someone else (or an octave slip of the detector)
    if (r && this.range) {
      const [lo, hi] = this.range;
      if (r.freq < lo * 0.94) { const f2 = r.freq * 2; r = f2 >= lo * 0.94 && f2 <= hi ? { ...r, freq: f2 } : null; }
      else if (r.freq > hi * 1.06) r = null;
    }
    const now = this.clock ? this.clock() : performance.now();
    const out = this.tracker.feed(r, rms, now);
    if (!out) { this.lastMidi = undefined; if (!this.wasNull) { this.wasNull = true; this.onReading && this.onReading(null); } return; }
    this.wasNull = false;
    const t = this._target(out.f);
    if (!out.held) {
      this.lastBuf = this.buf.slice(); this.lastF0 = out.f; this.lastSr = sr;
      this.trace.push({ t: now, cents: t.cents, name: t.name });
      while (this.trace.length && now - this.trace[0].t > 10000) this.trace.shift();
    }
    this.onReading && this.onReading({ freq: out.f, held: out.held, ...t });
  }
  // Rebuild the listening (a new sound system, a lost microphone) without closing the microphone
  // in between when it is still good: closing and opening it disturbs the sound on iOS.
  async restart() {
    if (!this.running || this._restarting) return;
    this._restarting = true;
    let held = false;
    try {
      try { await acquireMic(); held = true; } catch {}
      this.stop(); this._cancel = false; this.peak = 0;
      await this.start();
    } catch {} finally {
      if (held) releaseMic();
      this._restarting = false;
      // (the buttons show whether it listens again: it may not, the microphone being taken)
      window.dispatchEvent(new Event('stand-tuner-state'));
    }
  }
  harmonics(n = 10) { return this.lastBuf ? harmonicProfile(this.lastBuf, this.lastSr, this.lastF0, n) : null; }
  stop() {
    if (this._starting) this._cancel = true;
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
export function playHarmonics(f0, opts = {}) {
  const { mode = 'series', h = 1, count = 8, volume = 0.5 } = opts;
  // (the microphone just closed: a sound system it spoilt is replaced first)
  freshSound();
  const ctx = getCtx();
  stopHarmonics();
  if (!hsOut || hsOut.context !== ctx) { hsOut = ctx.createGain(); hsOut.connect(master()); }   // (a new sound system: a new way out)
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
  // a sound system that does not wake (after the microphone, a call…) is woken or replaced, and
  // the harmonics played again in the new one
  if (ctx.state !== 'running' && !opts.again) ensureRunning(400, { force: true }).then((c) => { if (c !== ctx && hsVoices.length) playHarmonics(f0, { ...opts, again: true }); });
  return { start: now, step: stepT, total };
}

// ---------------- Drone ----------------
export const DRONE_VOICES = { organ: 'Organ', pure: 'Soft', bow: 'Bow', horn: 'Horn' };
export const DRONE_CHORDS = {
  root: { label: 'Root', r: [1] }, fifth: { label: '+ Fifth', r: [1, 3 / 2] }, octave: { label: '+ Octave', r: [1, 2] },
  open: { label: 'Fifth + octave', r: [1, 3 / 2, 2] }, major: { label: 'Major', r: [1, 5 / 4, 3 / 2] }, minor: { label: 'Minor', r: [1, 6 / 5, 3 / 2] },
};
const TANPURA = { slow: 5.2, medium: 4, fast: 2.8 };
// how loud the drone is at full volume: it sits under your playing, so it needs to be clearly
// heard (the limiter on the way out keeps it clean at the top)
const DRONE_LEVEL = 2.0;
// The drone's own way out, made to carry on a small speaker: the lowest rumble the iPad cannot play
// is taken away, the sound is kept dense (a slow compressor lifts the quiet parts of the wave)
// and gently warmed (a soft saturation adds the overtones the ear uses to hear a low note), so
// it sounds big and full without being any harsher. The limiter on the way out keeps it clean.
// The volume comes after all this, so the slider still goes from a whisper to full.
function droneBus(ctx, vol) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55; hp.Q.value = 0.6;
  const drive = ctx.createGain(); drive.gain.value = 2.0;
  const sh = ctx.createWaveShaper(); const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(1.4 * x) / Math.tanh(1.4); }
  sh.curve = curve; sh.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -28; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.03; comp.release.value = 0.4;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 1100; pres.Q.value = 0.7; pres.gain.value = 2.5;
  const makeup = ctx.createGain(); makeup.gain.value = 2.5;
  // the topmost overtones are softened: they add no weight, only sharpness in headphones
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 4000; air.gain.value = -5;
  // and the level is set for the note (droneTrim): full for the low notes, safe for the high ones
  const trim = ctx.createGain(); trim.gain.value = 0.5;
  hp.connect(drive).connect(sh).connect(comp).connect(pres).connect(air).connect(makeup).connect(trim).connect(vol).connect(master());
  return { input: hp, trim, drive };
}
// How loud a drone may be, by its pitch and its sound. The ear is far more sensitive to high notes
// (most of all from 1 to 5 kHz) than to low ones, and each sound carries a different share of
// its energy where the ear hears best, so the same level is a whisper for a low soft drone and
// painful for a high bright one in headphones. Each sound was measured note by note (how loud it
// sounds at the same level, A-weighted, dB) and is brought to one loudness: about that of ordinary
// music in an app at full volume, a little more for low notes (they need it on a small speaker),
// never more than a little under full scale.
const DRONE_SENS = {
  pure: [-21.2, -13.6, -8.2, -3.8, 0.3, 0.3],
  organ: [-14.0, -7.7, -4.7, -2.3, -1.2, -2.7],
  bow: [-12.7, -6.6, -4.6, -2.1, 0.5, -0.1],
  horn: [-13.0, -7.1, -4.0, -1.9, -0.7, -2.0],
  tanpura: [-9.4, -4.2, -2.5, -2.4, -3.0, -3.6],
};
function droneTrim(f, sound = 'organ') {
  const t = DRONE_SENS[sound] || DRONE_SENS.organ;
  const x = Math.max(0, Math.min(5, Math.log2(Math.max(20, f) / 55)));   // 55, 110 … 1760 Hz
  const k = Math.min(4, Math.floor(x)), sens = t[k] + (t[k + 1] - t[k]) * (x - k);
  const lf = Math.log2(Math.max(20, f));
  const allowed = f >= 330 ? -16 : f <= 110 ? -12 : -12 - 4 * (lf - Math.log2(110)) / (Math.log2(330) - Math.log2(110));
  return Math.pow(10, Math.min(-4, allowed - sens) / 20);
}
const volCurve = (v) => Math.pow(Math.max(0, Math.min(1, v)), 0.6);
export class Drone {
  constructor() {
    this.ref = 442; this.pc = 9; this.octave = 2; this.sound = 'pure'; this.chord = 'fifth';
    this.lowOct = false; this.volume = 0.5; this.speed = 'medium';
    this.running = false; this.voices = [];
  }
  get midi() { return 12 * (this.octave + 1) + this.pc; }
  label() { return NOTE_NAMES[this.pc] + this.octave + (this.sound === 'tanpura' ? ' tanpura' : this.chord === 'root' ? '' : ' ' + DRONE_CHORDS[this.chord].label.replace('+ ', '+')); }
  ratios() { const r = (DRONE_CHORDS[this.chord] || DRONE_CHORDS.root).r; return this.lowOct ? [0.5, ...r] : r; }
  _out(f0) {
    const ctx = getCtx();
    if (this.out && this.out.context !== ctx) this.out = null;   // a new sound system
    if (!this.out) { this.vol = ctx.createGain(); this.vol.gain.value = volCurve(this.volume); this.out = ctx.createGain(); this.bus = droneBus(ctx, this.vol); this.out.connect(this.bus.input); }
    this.out.gain.setTargetAtTime(DRONE_LEVEL, ctx.currentTime, 0.05);
    // the level for this note (see droneTrim); high notes are also driven less, so they stay clean
    if (f0) {
      this.bus.trim.gain.setTargetAtTime(globalThis.__trimOne ? 1 : droneTrim(f0, this.sound), ctx.currentTime, 0.04);
      this.bus.drive.gain.setTargetAtTime(f0 > 330 ? 1 : f0 > 200 ? 1.5 : 2, ctx.currentTime, 0.04);
    }
    this.vol.gain.setTargetAtTime(volCurve(this.volume), ctx.currentTime, 0.05);
    return this.out;
  }
  start() {
    // when iOS replaces the sound system, the drone starts again in the new one
    if (!this._wired) { this._wired = true; window.addEventListener('stand-audio-new', () => { if (this.running) { for (const v of this.voices) { try { v.stop(0, 0.01); } catch {} } this.voices = []; this.out = null; this.start(); } }); }
    const again = this.running && this.voices.length;
    if (this.running) this._stopVoices(again);
    else freshSound();   // a sound system spoilt by a Bluetooth change or the microphone is replaced first
    const f0 = noteFreq(this.midi, this.ref), out = this._out(f0);
    wantAudio(true, 'drone');
    if (this.sound === 'tanpura') this._tanpura(f0, out);
    else this.voices = again ? this._voicesAt(f0, out, getCtx().currentTime + 0.07, 0.05) : this._voicesAt(f0, out);
    this.running = true;
    // a sound system that does not wake at once (the iPhone after a call, Bluetooth, the
    // microphone…) is woken, or replaced; the drone then starts again in the new one by itself
    const c0 = getCtx(), me = this._startId = (this._startId || 0) + 1;
    if (c0.state !== 'running') {
      c0.resume().catch(() => {});
      setTimeout(() => { if (this.running && this._startId === me && getCtx() === c0 && c0.state !== 'running') ensureRunning(400, { force: true }); }, 250);
    }
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
  // the notes of the chord; a low drone also sounds softly an octave up, so a small speaker (which
  // cannot play the low note itself) still gives it its full weight
  _voicesAt(f0, out, at, attack) {
    const vs = this.ratios().map((k, i) => holdNote(out, f0 * k, this.sound, i === 0 || k === 0.5 ? 1 : 0.62, at, attack));
    if (f0 < 190 && this.sound !== 'pure') vs.push(holdNote(out, f0 * 2, this.sound, 0.34, at, attack));
    return vs;
  }
  _stopVoices(fast) { const now = getCtx().currentTime; for (const v of this.voices) v.stop(now, fast ? 0.018 : 0.12); this.voices = []; }
  // move to another note while sounding: the new note fades in as the old one fades out
  change(pc) {
    this.pc = pc;
    if (!this.running || this.sound === 'tanpura') { this.refresh(); return; }
    const ctx = getCtx(), now = ctx.currentTime, old = this.voices;
    const f0 = noteFreq(this.midi, this.ref), out = this._out(f0);
    // a clean change: the old note goes away quickly, then the new one comes in (never both at once)
    for (const v of old) v.stop(now, 0.018);
    this.voices = this._voicesAt(f0, out, now + 0.07, 0.05);
  }
  stop() {
    if (!this.running) return;
    this._stopVoices(); this.running = false; wantAudio(false, 'drone');
    if (this.sound === 'tanpura' && this.out) {
      // let the ringing strings fade instead of cutting them
      const g = this.out, ctx = getCtx(); g.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
      this.out = null; setTimeout(() => { try { g.disconnect(); } catch {} }, 2500);
    }
  }
  refresh() { if (this.running) this.start(); }
  setVolume(v) { this.volume = v; if (this.vol) this.vol.gain.setTargetAtTime(volCurve(v), getCtx().currentTime, 0.05); }
}

// One soft reference tone (for tapping a string in the tuner).
export function playRefTone(freq, dur = 2.2, volume = 0.6) {
  const ctx = getCtx();
  const g = ctx.createGain(); g.gain.value = volume; g.connect(master());
  playNote(g, freq, ctx.currentTime + 0.02, dur, 'strings', 1);
}
