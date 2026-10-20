// Hearing which key you are playing in, so a drone can follow a change of key — and only that.
// Each note you play counts once (a long note no more than a short phrase), over the last half
// minute or so. The drone stays where it is until the music clearly lives in another key: enough
// different notes, nearly all of them in the new key's scale, the old key's scale clearly broken,
// the new key clearly better on the 24 major and minor key shapes (Krumhansl–Kessler), and all of
// that for a few seconds. One note held, a passing chromatic note, tuning the strings or a scale
// fragment never moves it.

import { detectPitch } from './tuner.js';
import { getCtx, acquireMic, releaseMic } from './audio.js';
import { chromaOf } from './listen.js';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / 12, mb = b.reduce((s, x) => s + x, 0) / 12;
  let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
};
const rot = (p, k) => Array.from({ length: 12 }, (_, i) => p[(i - k + 12) % 12]);
export const keyScore = (h, pc, minor) => corr(h, rot(minor ? MINOR : MAJOR, pc));
// the best key for a pitch-class weighting: { pc, minor, score, margin }
export function keyOf(h) {
  const all = [];
  for (let k = 0; k < 12; k++) all.push({ pc: k, minor: false, score: keyScore(h, k, false) }, { pc: k, minor: true, score: keyScore(h, k, true) });
  all.sort((a, b) => b.score - a.score);
  return { ...all[0], margin: all[0].score - all[1].score };
}
// relative major and minor share their notes; telling them apart needs more proof
const relative = (a, b) => a.minor !== b.minor && ((a.minor ? a.pc + 3 : b.pc + 3) % 12) === (a.minor ? b.pc : a.pc);

// the notes of a key: major scale; minor with both the natural and the raised 6th and 7th
const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11], SCALE_MINOR = [0, 2, 3, 5, 7, 8, 9, 10, 11];
export function scaleFit(h, pc, minor) {
  let tot = 0, inK = 0; const sc = minor ? SCALE_MINOR : SCALE_MAJOR;
  for (let i = 0; i < 12; i++) { tot += h[i]; if (sc.includes((i - pc + 12) % 12)) inK += h[i]; }
  return tot ? inK / tot : 1;
}
// the share of what you play that is NOT on the notes the old key has and the new one has not
function scaleFitOf(h, oldK, newK) {
  const so = oldK.minor ? SCALE_MINOR : SCALE_MAJOR, sn = newK.minor ? SCALE_MINOR : SCALE_MAJOR;
  let tot = 0, only = 0;
  for (let i = 0; i < 12; i++) { tot += h[i]; if (so.includes((i - oldK.pc + 12) % 12) && !sn.includes((i - newK.pc + 12) % 12)) only += h[i]; }
  return tot ? 1 - only / tot : 1;
}
const NOTE_CAP = 0.55;     // seconds a single note can count for
export class KeyFollower {
  constructor(onKey, onHear) { this.onKey = onKey; this.onHear = onHear; this.on = false; this.memory = 9; }
  async start() {
    if (this.on) return;
    this.on = true; this.gen = (this.gen || 0) + 1; const gen = this.gen;
    try { this.src = await acquireMic(); } catch { this.on = false; this.onHear && this.onHear(null, 'No microphone'); return; }
    if (!this.on || gen !== this.gen) { releaseMic(); return; }   // stopped while the microphone was opening
    const ctx = getCtx();
    this.an = ctx.createAnalyser(); this.an.fftSize = 4096; this.an.smoothingTimeConstant = 0; this.src.connect(this.an);
    this.buf = new Float32Array(2048); this.fd = new Float32Array(this.an.frequencyBinCount); this.mag = new Float32Array(this.an.frequencyBinCount);
    this._init();
    this.timer = setInterval(() => this._tick(ctx.sampleRate), 40);
    this.mic = true;
  }
  _init() {
    this.h = new Array(12).fill(0); this.r = new Array(12).fill(0); this.last = this._now(); this.cand = null; this.key = this.key || null;
    this.noise = 0.0006; this.prevPc = -1; this.pcRun = 0; this.noteW = 0; this.zero = 0; this.onsets = 0;
  }
  _now() { return this.clock ? this.clock() : performance.now(); }
  stop() {
    if (!this.on) return;
    this.on = false; clearInterval(this.timer);
    if (this.mic) { try { this.src.disconnect(this.an); } catch {} releaseMic(); this.mic = false; }
  }
  // the microphone was taken away (a call, another app): open it again
  async restart() { this.stop(); await this.start(); }
  // tell it the key the drone is in now (you chose it, or it just moved): it starts counting afresh
  set(pc, minor) { this.key = { pc, minor }; this.cand = null; this.onsets = 0; }
  _tick(sr) {
    const now = this._now(), dt = Math.min(0.2, (now - this.last) / 1000); this.last = now;
    // two memories: the last half minute or so, and the last few seconds (what you play now)
    const fade = Math.pow(0.5, dt / this.memory), fadeR = Math.pow(0.5, dt / 3);
    for (let i = 0; i < 12; i++) { this.h[i] *= fade; this.r[i] *= fadeR; }
    this.an.getFloatTimeDomainData(this.buf);
    let ms = 0; for (let i = 0; i < this.buf.length; i++) ms += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(ms / this.buf.length);
    // a microphone that went silent for good (taken by another app) is opened again
    if (rms === 0) { if (++this.zero > 60) { this.zero = 0; this.restart(); } return; } else this.zero = 0;
    // the room's noise: falls quickly to a quiet moment, rises only very slowly
    this.noise = rms < this.noise ? 0.85 * this.noise + 0.15 * Math.max(0.0002, rms) : Math.min(0.02, this.noise * 1.0015);
    const gate = Math.max(0.0007, this.noise * 2.4);
    if (rms < gate) { this.prevPc = -1; return; }
    let heard = false;
    const r = detectPitch(this.buf, sr, gate);
    if (r && r.clarity >= 0.74) {
      const midi = 12 * Math.log2(r.freq / 440) + 69, pc = ((Math.round(midi) % 12) + 12) % 12;
      // the same note twice in a row (80 ms) is a note, not a scrape
      if (pc === this.prevPc) {
        this.pcRun++;
        if (this.pcRun === 1) { this.onsets++; this.noteW = 0; }
        // each note counts once: a little for being played, then for as long as it sounds, up to a cap
        const add = (this.pcRun === 1 ? 0.15 : 0) + (this.noteW < NOTE_CAP ? Math.min(dt, NOTE_CAP - this.noteW) : 0);
        this.noteW += dt;
        const w = add * (midi < 57 ? 1.15 : 1); this.h[pc] += w; this.r[pc] += w;
        heard = true;
      } else { this.prevPc = pc; this.pcRun = 0; }
    } else {
      this.prevPc = -1;
      // chords and double stops (no single pitch): every pitch class that sounds, by its share
      if (rms > gate * 1.5 && this.an.getFloatFrequencyData) {
        this.an.getFloatFrequencyData(this.fd);
        for (let k = 0; k < this.fd.length; k++) this.mag[k] = this.fd[k] > -160 ? Math.pow(10, this.fd[k] / 20) : 0;
        const c = chromaOf(this.mag, sr, this.an.fftSize);
        const sum = c.reduce((a, v) => a + v, 0);
        if (sum > 0) { for (let i = 0; i < 12; i++) { const w = (dt * 0.35 * c[i]) / sum; this.h[i] += w; this.r[i] += w; } heard = true; }
      }
    }
    if (!heard) return;
    this._decide(now);
  }
  _decide(now) {
    const h = this.h, r = this.r, total = h.reduce((s, x) => s + x, 0), totalR = r.reduce((s, x) => s + x, 0);
    let distinct = 0; for (const x of h) if (x >= 0.05 * total) distinct++;
    let distinctR = 0; for (const x of r) if (x >= 0.05 * totalR) distinctR++;
    // too little to say anything yet: a few notes, or a held note, or a fragment
    if (total < 2.2 || distinct < 5) { this.cand = null; this.onHear && this.onHear(null); return; }
    const k = keyOf(h);
    this.onHear && this.onHear(k.score >= 0.55 ? k : null);
    // what you play now: the key it points to, if it is clear
    const kr = totalR >= 1.4 && distinctR >= 5 ? keyOf(r) : null;
    this.dbg = { kr: kr && kr.pc + (kr.minor ? 'm' : ''), score: kr && +kr.score.toFixed(2), totalR: +totalR.toFixed(1), distinctR };
    if (!kr || !this.key || kr.score < 0.55 || (kr.pc === this.key.pc && kr.minor === this.key.minor)) { if (this.cand && now - this.cand.lastOk > 1200) this.cand = null; return; }
    const cur = this.key;
    const rel = relative(cur, kr), sameTonic = cur.pc === kr.pc;
    const gainR = kr.score - keyScore(r, cur.pc, cur.minor), gainH = keyScore(h, kr.pc, kr.minor) - keyScore(h, cur.pc, cur.minor);
    const fitNew = scaleFit(r, kr.pc, kr.minor), fitOld = scaleFit(r, cur.pc, cur.minor);
    // the old key is broken when its scale clearly does not hold what you play: many notes outside
    // it, or some notes outside it while the notes only the old key has (C♯ for D against G) are gone
    const onlyOld = 1 - scaleFitOf(r, cur, kr);
    const clean = 1 - fitOld >= 0.035 && onlyOld <= 0.02;   // the new key's note is there, the old key's note is gone
    const broken = 1 - fitOld >= 0.07 || clean;
    // the new key holds nearly every note you play now; the old key's scale is clearly broken by
    // them — or, between relative or parallel keys (same notes or same tonic), the shape of the
    // music says so very clearly; and the longer memory agrees
    const ok = this.onsets >= 8 && fitNew >= 0.9 && gainH > -0.06 && (
      (rel || sameTonic) ? gainR >= 0.22 : (broken && gainR >= (clean ? 0.05 : 0.1)));
    this.dbg = { kr: kr.pc + (kr.minor ? 'm' : ''), score: +kr.score.toFixed(2), gainR: +gainR.toFixed(2), gainH: +gainH.toFixed(2), fitNew: +fitNew.toFixed(2), fitOld: +fitOld.toFixed(2), onlyOld: +onlyOld.toFixed(3), ok };
    // a moment that does not quite fit (a passing note) does not start the waiting again;
    // more than a second without it does
    if (!ok) { if (this.cand && now - this.cand.lastOk > 1200) this.cand = null; return; }
    const hold = rel || sameTonic ? 4000 : 2500;
    if (!this.cand || this.cand.pc !== kr.pc || this.cand.minor !== kr.minor) { this.cand = { pc: kr.pc, minor: kr.minor, since: now, lastOk: now }; return; }
    this.cand.lastOk = now;
    if (now - this.cand.since >= hold) {
      this.set(kr.pc, kr.minor);
      this.onKey && this.onKey(this.key);
    }
  }
}
