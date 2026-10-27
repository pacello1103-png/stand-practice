// Listening to playing as music: when a new note or chord starts (onsets), which pitches sound
// (a 12-step chroma), and, for one-note-at-a-time instruments, the exact note. Shared by the
// page follower and Studio. Works for chords and the piano as well as single lines.
import { detectPitch, PitchTracker } from './tuner.js';

// ---------- chroma ----------
// magnitudes (linear) of an FFT of size N at sample rate sr -> 12 pitch classes (C = 0)
const binPc = new Map();
function pcTable(nBins, sr, N) {
  const key = nBins + ':' + sr + ':' + N;
  if (binPc.has(key)) return binPc.get(key);
  const pc = new Int8Array(nBins).fill(-1), wt = new Float32Array(nBins);
  for (let k = 1; k < nBins; k++) {
    const f = (k * sr) / N;
    if (f < 50 || f > 4200) continue;
    const m = 12 * Math.log2(f / 440) + 69, r = Math.round(m);
    const off = Math.abs(m - r);                       // between two notes: counts less
    pc[k] = ((r % 12) + 12) % 12; wt[k] = Math.max(0, 1 - off * 1.6) * (f < 120 ? 0.6 : f > 2500 ? 0.5 : 1);
  }
  const t = { pc, wt }; binPc.set(key, t); return t;
}
export function chromaOf(mag, sr, N) {
  const { pc, wt } = pcTable(mag.length, sr, N);
  // the noise floor: a running low value under the spectrum, taken out first
  const c = new Float32Array(12);
  let floor = 0, n = 0; for (let k = 0; k < mag.length; k += 8) { floor += mag[k]; n++; } floor = (floor / Math.max(1, n)) * 1.5;
  for (let k = 2; k < mag.length - 1; k++) {
    if (pc[k] < 0) continue;
    const v = mag[k];
    if (v <= floor || v < mag[k - 1] || v < mag[k + 1]) continue;  // peaks only
    c[pc[k]] += Math.log1p((v - floor) * 40) * wt[k];
  }
  return c;
}
export function norm(c) { let s = 0; for (const v of c) s += v * v; s = Math.sqrt(s); return s ? c.map((v) => v / s) : c; }
export function cosine(a, b) { let s = 0, na = 0, nb = 0; for (let i = 0; i < 12; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? s / Math.sqrt(na * nb) : 0; }
// what a set of pitch classes should look like in a chroma (its overtones add a little)
export function template(pcs) {
  const t = new Float32Array(12);
  for (const p of pcs) { t[p] += 1; t[(p + 7) % 12] += 0.22; t[(p + 4) % 12] += 0.1; }
  return t;
}

// ---------- the live listener ----------
// onEvent({ t, chroma, pc, mono, rms }) for every new note or chord heard.
export class Listener {
  constructor(onEvent) { this.onEvent = onEvent; this.on = false; }
  attach(ctx, src) {
    this.ctx = ctx;
    this.an = ctx.createAnalyser(); this.an.fftSize = 4096; this.an.smoothingTimeConstant = 0;
    src.connect(this.an); this.src = src;
    this.td = new Float32Array(2048); this.fd = new Float32Array(this.an.frequencyBinCount);
    this.mag = new Float32Array(this.an.frequencyBinCount); this.prevLog = null;
    this.tracker = new PitchTracker();
    this.flux = []; this.lastOnset = -1e9; this.pending = null; this.prevChroma = new Float32Array(12);
    this.lastMonoPc = null; this.lastObs = -1e9; this.monoSince = 0; this.monoCand = null;
    this.on = true;
    this.timer = setInterval(() => this.tick(), 30);
  }
  detach() { if (!this.on) return; this.on = false; clearInterval(this.timer); try { this.src.disconnect(this.an); } catch {} }
  tick() {
    const now = performance.now(), sr = this.ctx.sampleRate, N = this.an.fftSize;
    this.an.getFloatFrequencyData(this.fd);
    // (the loudness steps are needed only up to 5 kHz, and the two working arrays are kept, not
    // made anew 33 times a second)
    const kTop = Math.min(this.fd.length, Math.ceil((5000 * N) / sr) + 2);
    if (!this.logA) { this.logA = new Float32Array(this.fd.length); this.logB = new Float32Array(this.fd.length); }
    const logm = this.prevLog === this.logA ? this.logB : this.logA;
    const mag = this.mag, fd = this.fd;
    for (let k = 0; k < fd.length; k++) { const db = fd[k]; mag[k] = db > -160 ? Math.exp(db * 0.1151292546) : 0; }
    for (let k = 0; k < kTop; k++) logm[k] = Math.log1p(mag[k] * 1000);
    // spectral flux: how much new energy appeared (positive changes only, 80 Hz .. 5 kHz)
    let fl = 0;
    if (this.prevLog) { const k0 = Math.floor((80 * N) / sr), k1 = Math.floor((5000 * N) / sr); for (let k = k0; k < k1; k++) { const d = logm[k] - this.prevLog[k]; if (d > 0) fl += d; } }
    this.prevLog = logm;
    const chroma = chromaOf(this.mag, sr, N);
    this.an.getFloatTimeDomainData(this.td);
    let ms = 0; for (let i = 0; i < this.td.length; i++) ms += this.td[i] * this.td[i];
    const rms = Math.sqrt(ms / this.td.length);
    const r = rms > 0.0015 ? detectPitch(this.td, sr) : null;
    const tr = this.tracker.feed(r, rms, now);
    // adaptive threshold from recent flux
    this.flux.push(fl); if (this.flux.length > 40) this.flux.shift();
    const sorted = [...this.flux].sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 0;
    const thr = med * 2.2 + 4;
    const isOnset = fl > thr && rms > 0.002 && now - this.lastOnset > 90;
    if (isOnset) { this.lastOnset = now; this.pending = { t: now, before: this.prevChroma.slice(), acc: new Float32Array(12), n: 0, rms }; }
    // collect the sound just after the onset, then report it
    if (this.pending && now - this.pending.t >= 30) {
      const p = this.pending; for (let i = 0; i < 12; i++) p.acc[i] += chroma[i]; p.n++;
      if (now - p.t >= 85) {
        const c = new Float32Array(12);
        for (let i = 0; i < 12; i++) c[i] = Math.max(0, p.acc[i] / p.n - 0.55 * p.before[i]);
        const mono = tr && !tr.held && tr.clarity >= 0.85;
        const pc = mono ? ((Math.round(12 * Math.log2(tr.f / 440) + 69) % 12) + 12) % 12 : null;
        this.pending = null;
        // the attack of a note whose pitch was already reported (pitch is often heard first)
        const same = this.legato && p.t - this.legato.t < 380 && (pc === this.legato.pc || (!mono && c[this.legato.pc] >= Math.max(...c) * 0.7));
        this.legato = null;
        if (same) return;
        this.lastObs = now; if (mono) this.lastMonoPc = pc;
        this.onEvent({ t: p.t, chroma: c, pc, mono, rms: p.rms });
      }
    }
    // a new note without a new attack (legato on strings, winds, voice): the pitch moved and stayed
    if (tr && !tr.held && tr.clarity >= 0.8 && !this.pending) {
      const pc = ((Math.round(12 * Math.log2(tr.f / 440) + 69) % 12) + 12) % 12;
      if (pc !== this.lastMonoPc) {
        if (!this.monoCand || this.monoCand.pc !== pc) { this.monoCand = { pc, since: now }; this.monoCandStart = now; }
        else if (now - this.monoCand.since > 60 && now - this.lastObs > 110) {
          this.lastMonoPc = pc; this.lastObs = now; this.monoCand = null;
          this.legato = { t: this.monoCandStart || now, pc };
          const c = new Float32Array(12); c[pc] = 1;
          this.onEvent({ t: now, chroma: c, pc, mono: true, rms, legato: true });
        }
      } else this.monoCand = null;
    } else if (!tr) { this.lastMonoPc = null; this.monoCand = null; }
    // keep a slowly moving picture of what was sounding, for the next onset
    for (let i = 0; i < 12; i++) this.prevChroma[i] = this.prevChroma[i] * 0.6 + chroma[i] * 0.4;
  }
}

// ---------- a whole recording at once (Studio) ----------
function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j], ai = im[i + j], br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float32Array(n / 2); for (let k = 0; k < n / 2; k++) out[k] = Math.hypot(re[k], im[k]) / n; return out;
}
// Every note or chord started in pcm between a and b seconds: [{ t, chroma }]
export async function onsetsOf(pcm, sr, a = 0, b = Infinity, onProgress) {
  const N = 4096, hop = Math.round(sr * 0.0116) * 2;
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(pcm.length - N, Math.floor(Math.min(b, pcm.length / sr) * sr));
  const frames = [];
  let prev = null, k = 0;
  for (let i = i0; i < i1; i += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let ms = 0; for (let j = 0; j < N; j++) { const v = pcm[i + j]; re[j] = v * win[j]; ms += v * v; }
    const mag = fftMag(re, im);
    const logm = new Float32Array(mag.length); for (let q = 0; q < mag.length; q++) logm[q] = Math.log1p(mag[q] * 4000);
    let fl = 0; if (prev) { const k0 = Math.floor((80 * N) / sr), k1 = Math.floor((5000 * N) / sr); for (let q = k0; q < k1; q++) { const d = logm[q] - prev[q]; if (d > 0) fl += d; } }
    prev = logm;
    frames.push({ t: (i + N / 2) / sr, fl, rms: Math.sqrt(ms / N), chroma: chromaOf(mag, sr, N) });
    if (++k % 150 === 0) { onProgress && onProgress((i - i0) / (i1 - i0)); await new Promise((r) => setTimeout(r, 0)); }
  }
  // peaks of the flux above a running threshold
  const out = [];
  const peak = Math.max(...frames.map((f) => f.rms), 1e-6);
  for (let j = 1; j < frames.length - 1; j++) {
    const lo = Math.max(0, j - 20), hi = Math.min(frames.length, j + 20);
    const loc = frames.slice(lo, hi).map((f) => f.fl).sort((x, y) => x - y);
    const thr = loc[loc.length >> 1] * 1.8 + 3;
    const f = frames[j];
    if (f.fl > thr && f.fl >= frames[j - 1].fl && f.fl >= frames[j + 1].fl && f.rms > peak * 0.03 && (!out.length || f.t - out[out.length - 1].t > 0.08)) {
      // what sounds just after, less what was already sounding
      const after = new Float32Array(12), before = frames[Math.max(0, j - 3)].chroma;
      let n = 0; for (let q = j + 1; q <= Math.min(frames.length - 1, j + 4); q++) { for (let c = 0; c < 12; c++) after[c] += frames[q].chroma[c]; n++; }
      const chroma = new Float32Array(12); for (let c = 0; c < 12; c++) chroma[c] = Math.max(0, after[c] / Math.max(1, n) - 0.5 * before[c]);
      out.push({ t: f.t - (N / 2) / sr * 0.5, chroma, fl: f.fl, w: chroma.reduce((a2, v) => a2 + v, 0) });
    }
  }
  // echoes of an attack (a second bump of the same sound) bring almost nothing new: drop them
  const ws = out.map((o) => o.w).sort((x, y) => x - y), mw = ws[ws.length >> 1] || 0;
  return out.filter((o, i) => !(o.w < mw * 0.4 && i > 0 && o.t - out[i - 1].t < 0.35));
}
