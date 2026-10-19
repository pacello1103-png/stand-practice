// Hearing which key you are playing in, so a drone can follow a modulation. The pitches you play
// build a picture of the last few seconds (each note counts for as long as it sounds, new notes
// and low notes a little more, older notes fade out); that picture is compared with the shapes of
// the 24 major and minor keys (Krumhansl–Kessler profiles). It listens to quiet playing too: the
// level it needs follows the room's own noise. A new key is taken when it has been clearly better
// than the current one for a moment, so a passing chromatic note does not move the drone.

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

export class KeyFollower {
  constructor(onKey, onHear) { this.onKey = onKey; this.onHear = onHear; this.on = false; this.memory = 2.4; }
  async start() {
    if (this.on) return;
    this.on = true; this.gen = (this.gen || 0) + 1; const gen = this.gen;
    try { this.src = await acquireMic(); } catch { this.on = false; this.onHear && this.onHear(null, 'No microphone'); return; }
    if (!this.on || gen !== this.gen) { releaseMic(); return; }   // stopped while the microphone was opening
    const ctx = getCtx();
    this.an = ctx.createAnalyser(); this.an.fftSize = 4096; this.an.smoothingTimeConstant = 0; this.src.connect(this.an);
    this.buf = new Float32Array(2048); this.fd = new Float32Array(this.an.frequencyBinCount); this.mag = new Float32Array(this.an.frequencyBinCount);
    this.h = new Array(12).fill(0); this.s = new Array(12).fill(0); this.heardFor = 0; this.last = performance.now(); this.cand = null; this.key = this.key || null;
    this.noise = 0.0006; this.prevPc = -1; this.pcRun = 0; this.zero = 0;
    this.timer = setInterval(() => this._tick(ctx.sampleRate), 40);
    this.mic = true;
  }
  stop() {
    if (!this.on) return;
    this.on = false; clearInterval(this.timer);
    if (this.mic) { try { this.src.disconnect(this.an); } catch {} releaseMic(); this.mic = false; }
  }
  // the microphone was taken away (a call, another app): open it again
  async restart() { this.stop(); await this.start(); }
  // tell it the key the drone is in now (so it does not "change" to where it already is)
  set(pc, minor) { this.key = { pc, minor }; }
  _tick(sr) {
    const now = performance.now(), dt = Math.min(0.2, (now - this.last) / 1000); this.last = now;
    const fade = Math.pow(0.5, dt / this.memory);
    // two memories: the last few seconds, and the last second or so (to hear a change of key sooner)
    const fade2 = Math.pow(0.5, dt / 1.1);
    for (let i = 0; i < 12; i++) { this.h[i] *= fade; this.s[i] *= fade2; }
    this.an.getFloatTimeDomainData(this.buf);
    let ms = 0; for (let i = 0; i < this.buf.length; i++) ms += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(ms / this.buf.length);
    // a microphone that went silent for good (taken by another app) is opened again
    if (rms === 0) { if (++this.zero > 60) { this.zero = 0; this.restart(); } return; } else this.zero = 0;
    // the room's noise, learnt slowly from the quiet moments
    // (falls quickly to a quiet moment, rises only very slowly, so long playing is never taken for noise)
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
        const attack = this.pcRun === 1 ? 0.12 : 0;            // each new note counts a little extra
        const low = midi < 57 ? 1.25 : 1;                       // low notes say more about the key
        this.h[pc] += (dt + attack) * low; this.s[pc] += (dt + attack) * low;
        heard = true;
      } else { this.prevPc = pc; this.pcRun = 0; }
    } else this.prevPc = -1;
    // chords and double stops: every pitch class that sounds, by its share
    if (rms > gate * 1.5) {
      this.an.getFloatFrequencyData(this.fd);
      for (let k = 0; k < this.fd.length; k++) this.mag[k] = this.fd[k] > -160 ? Math.pow(10, this.fd[k] / 20) : 0;
      const c = chromaOf(this.mag, sr, this.an.fftSize);
      const sum = c.reduce((a, v) => a + v, 0);
      if (sum > 0) { const w = heard ? 0.3 : 0.75; for (let i = 0; i < 12; i++) { this.h[i] += (dt * w * c[i]) / sum; this.s[i] += (dt * w * c[i]) / sum; } heard = true; }
    }
    if (!heard) return;
    this.heardFor += dt;
    const total = this.h.reduce((s, x) => s + x, 0);
    if (total < 0.7) return;                                  // not enough heard yet
    const k = keyOf(this.h);
    this.onHear && this.onHear(k);
    // what the last second says, when it is clear about it
    const k2 = keyOf(this.s), sTotal = this.s.reduce((a, x) => a + x, 0);
    const quick = sTotal > 0.6 && k2.score >= 0.62 && k2.margin >= 0.04 ? k2 : null;
    const pick = k.score >= 0.45 ? k : null;
    // the first move needs a little more to go on than later ones
    const first = this.heardFor < 2.4;
    const cands = [pick, quick].filter(Boolean);
    if (!cands.length) { this.cand = null; return; }
    let best = null;
    for (const c of cands) {
      if (this.key && this.key.pc === c.pc && this.key.minor === c.minor) continue;
      const h = c === quick ? this.s : this.h;
      const cur = this.key ? keyScore(h, this.key.pc, this.key.minor) : -1;
      const need = (this.key && relative(this.key, c) ? 0.1 : 0.05) + (first ? 0.04 : 0);
      if (c.score - cur >= need) { best = { ...c, hold: c === pick ? 650 : 1100 }; break; }
    }
    if (!best) { this.cand = null; return; }
    if (!this.cand || this.cand.pc !== best.pc || this.cand.minor !== best.minor) { this.cand = { pc: best.pc, minor: best.minor, since: now }; return; }
    if (now - this.cand.since > best.hold + (first ? 500 : 0)) { this.key = { pc: best.pc, minor: best.minor }; this.cand = null; this.onKey && this.onKey(this.key); }
  }
}
