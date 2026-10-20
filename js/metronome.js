// Sample-accurate metronome: Web Audio lookahead scheduler with a smooth or stepped tempo ramp.
import { getCtx, master, ensureRunning, wantAudio } from './audio.js';

const LOOKAHEAD = 0.12;      // seconds scheduled ahead
const TICK_MS = 25;          // scheduler wake-up

// ---------- click sounds, synthesised once per sample rate ----------
function synth(ctx, dur, fn) {
  const sr = ctx.sampleRate, n = Math.ceil(dur * sr);
  const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) { const t = i / sr; d[i] = fn(t, i); peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
  // 1 ms fade-in and fade-out: no clicks on the click.
  const f = Math.min(n >> 2, Math.round(sr * 0.001));
  for (let i = 0; i < f; i++) { d[i] *= i / f; d[n - 1 - i] *= i / f; }
  return buf;
}
const TAU = Math.PI * 2;
let seed = 12345;
const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };

const VOICES = {
  // A round, clear "tock": a small bright wooden knock. The pitch falls a little as it
  // sounds (the way a struck block rings), a second mode adds body, and a tiny
  // transient gives the attack a crisp edge without any hiss.
  click: (ctx, f) => synth(ctx, 0.07, (t) => {
    const glide = f * 0.06 * (1 - Math.exp(-t * 180)) / 180;
    const body = Math.sin(TAU * (f * t + glide)) * Math.exp(-t * 105);
    const ring = 0.4 * Math.sin(TAU * f * 2.1 * t) * Math.exp(-t * 170);
    const tick = 0.22 * noise() * Math.exp(-t * 900);
    return body + ring + tick;
  }),
  // Woodblock: two resonant modes and a short knock
  wood: (ctx, f) => synth(ctx, 0.07, (t) => Math.sin(TAU * f * t) * Math.exp(-t * 70) + 0.5 * Math.sin(TAU * f * 2.42 * t) * Math.exp(-t * 120) + 0.15 * noise() * Math.exp(-t * 900)),
  // Plain beep
  beep: (ctx, f) => synth(ctx, 0.06, (t) => Math.sin(TAU * f * t) * Math.min(1, t / 0.0015) * Math.exp(-t * 45)),
};
const PITCH = { click: [1750, 1250, 1250], wood: [1180, 860, 860], beep: [1500, 1000, 1000] };
const GAINS = [1, 0.62, 0.32]; // accent, beat, subdivision

// ---------- tempo names, as printed in scores ----------
const MARKS = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [92, 'Andante'], [108, 'Andantino'],
  [120, 'Moderato'], [140, 'Allegretto'], [168, 'Allegro'], [200, 'Vivace'], [240, 'Presto'], [999, 'Prestissimo']];
export function tempoMarking(bpm) { for (const [lim, name] of MARKS) if (bpm < lim) return name; return 'Prestissimo'; }

// Meter values: beats per bar; compound meters (6/8 etc.) group in 3.
export function meterInfo(v) {
  const n = +v;
  if (n === 6) return { beats: 6, label: '6/8', accents: [2, 1, 1, 2, 1, 1] };
  if (n === 9) return { beats: 9, label: '9/8', accents: Array.from({ length: 9 }, (_, i) => (i % 3 === 0 ? 2 : 1)) };
  if (n === 12) return { beats: 12, label: '12/8', accents: Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? 2 : 1)) };
  if (n === 7) return { beats: 7, label: '7/8', accents: [2, 1, 2, 1, 2, 1, 1] };
  return { beats: n, label: n + '/4', accents: Array.from({ length: n }, (_, i) => (i === 0 ? 2 : 1)) };
}

export class Metronome {
  constructor() {
    this.bpm = 80;
    this.beats = 4;
    this.accents = [2, 1, 1, 1];
    this.subdiv = 1;
    this.sound = 'click';
    this.volume = 0.8;
    this.ramp = { on: false, mode: 'smooth', from: 60, to: 100, bars: 32, step: 4, every: 4, repeat: false };
    this.gap = { on: false, play: 2, mute: 2 };
    this.running = false;
    this.onBeat = null;     // (beat, accent, bpm, time) when a beat is heard
    this.onStop = null;
    this._buffers = null; this._bufKey = '';
    this._timer = null; this._queue = []; this._raf = 0;
  }

  _ensureBuffers() {
    const ctx = getCtx();
    const key = this.sound + ctx.sampleRate + (ctx._id || (ctx._id = Math.random()));
    if (this._bufKey === key) return;
    if (!VOICES[this.sound]) this.sound = 'click';
    const p = PITCH[this.sound];
    this._buffers = p.map((f) => VOICES[this.sound](ctx, f));
    this._bufKey = key;
  }

  _out() {
    const ctx = getCtx();
    // a new sound system (after iOS dropped the old one): new connections
    if (this._gain && this._gain.context !== ctx) this._gain = null;
    if (!this._gain) { this._gain = ctx.createGain(); this._gain.connect(master()); }
    this._gain.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.02);
    return this._gain;
  }

  setVolume(v) { this.volume = v; if (this._gain) this._gain.gain.setTargetAtTime(v, getCtx().currentTime, 0.02); }

  // Tempo for the beat at absolute position (bar, beat) since start.
  _tempoAt(beatCount) {
    const r = this.ramp;
    if (!r.on) return this.bpm;
    const perBar = this.beats;
    if (r.mode === 'smooth') {
      const total = Math.max(1, r.bars * perBar);
      let p = beatCount / total;
      if (r.repeat) p = p % 1; else p = Math.min(1, p);
      return r.from + (r.to - r.from) * p;
    }
    const bar = Math.floor(beatCount / perBar);
    const dir = Math.sign(r.to - r.from) || 1;
    const nSteps = Math.ceil(Math.abs(r.to - r.from) / Math.max(1, r.step));
    let s = Math.floor(bar / Math.max(1, r.every));
    if (r.repeat) s = s % (nSteps + 1); else s = Math.min(s, nSteps);
    const v = r.from + dir * r.step * s;
    return dir > 0 ? Math.min(v, r.to) : Math.max(v, r.to);
  }

  get countInBpm() { return this.ramp.on ? this.ramp.from : this.bpm; }

  _play(time, level) {
    const ctx = getCtx();
    const src = ctx.createBufferSource();
    src.buffer = this._buffers[level];
    const g = ctx.createGain(); g.gain.value = GAINS[level];
    src.connect(g).connect(this._out());
    src.start(time);
  }

  start(opts = {}) {
    const ctx = getCtx();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (this.running) this.stop(true);
    this._ensureBuffers();
    this._out();
    this._ctx = ctx;
    if (!this._wired) { this._wired = true; window.addEventListener('stand-audio-new', () => { if (this.running) this._resync(getCtx()); }); }
    this.running = true;
    this._beatCount = 0;
    this._sub = 0;
    this._countIn = opts.countInBars ? opts.countInBars * this.beats : 0;
    this._onCountIn = opts.onCountInDone || null;
    this._stopAfterCountIn = !!opts.stopAfterCountIn;
    // a context that is still waking up (first start) needs a little more time before the first beat
    this._next = opts.at && opts.at > ctx.currentTime + 0.02 ? opts.at : ctx.currentTime + (ctx.state === 'running' ? 0.08 : 0.35);
    this._queue = [];
    wantAudio(true);
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
    // if the sound system has not woken within a moment, wake it (or replace it) and start again
    // from the next beat, so the first start always plays
    const ctx0 = ctx, myStart = this._startId = (this._startId || 0) + 1;
    if (ctx0.state !== 'running') ensureRunning().then((c) => {
      if (!this.running || this._startId !== myStart) return;
      if (c !== ctx0 || this._next < c.currentTime) {
        this._ensureBuffers(); this._out();
        this._next = c.currentTime + 0.12; this._queue = [];
      }
    });
    const loop = () => { this._drain(); if (this.running || this._queue.length) this._raf = requestAnimationFrame(loop); };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(loop);
    return this._next;
  }

  stop(silent) {
    clearInterval(this._timer); this._timer = null;
    this.running = false; wantAudio(false);
    this._queue = [];
    if (!silent && this.onStop) this.onStop();
  }

  // the sound system was replaced (iOS dropped the old one): the beat carries on in the new one
  _resync(ctx) {
    this._ctx = ctx;
    this._ensureBuffers(); this._gain = null; this._out();
    this._next = ctx.currentTime + 0.1; this._queue = [];
  }
  _tick() {
    const ctx = getCtx();
    if (this.running && (this._ctx !== ctx || this._next > ctx.currentTime + 5)) this._resync(ctx);
    // fell behind (the sound system stalled): carry on from now instead of a burst of clicks
    if (this.running && this._next < ctx.currentTime - 0.25) this._next = ctx.currentTime + 0.05;
    // a suspended or interrupted sound system plays nothing: wake it, and do not replay the time that passed
    if (this.running && ctx.state !== 'running') {
      const now = performance.now();
      if (!this._wakeAt || now - this._wakeAt > 400) { this._wakeAt = now; ctx.resume().catch(() => {}); }
      if (this._next < ctx.currentTime) this._next = ctx.currentTime + 0.1;
    }
    while (this.running && this._next < ctx.currentTime + LOOKAHEAD) {
      const inCountIn = this._countIn > 0;
      const bc = this._beatCount;
      const bpm = inCountIn ? this.countInBpm : this._tempoAt(bc);
      const beatInBar = bc % this.beats;
      const bar = Math.floor(bc / this.beats);
      const beatDur = 60 / bpm;
      const subDur = beatDur / this.subdiv;
      const muted = !inCountIn && this.gap.on && (bar % (this.gap.play + this.gap.mute)) >= this.gap.play;
      const acc = this.accents[beatInBar] ?? 1;

      if (this._sub === 0) {
        if (!muted && acc > 0) this._play(this._next, acc === 2 ? 0 : 1);
        this._queue.push({ time: this._next, beat: beatInBar, acc, bpm, muted, countIn: inCountIn });
      } else if (!muted && acc > 0) {
        this._play(this._next, 2);
      }

      this._next += subDur;
      this._sub++;
      if (this._sub >= this.subdiv) {
        this._sub = 0;
        if (inCountIn) {
          this._countIn--;
          if (this._countIn === 0) {
            const t = this._next;
            this._queue.push({ time: t, countInDone: true });
            if (this._stopAfterCountIn) { this.running = false; clearInterval(this._timer); }
          }
        } else {
          this._beatCount++;
        }
      }
    }
  }

  _drain() {
    const now = getCtx().currentTime;
    while (this._queue.length && this._queue[0].time <= now + 0.005) {
      const ev = this._queue.shift();
      if (ev.countInDone) { const f = this._onCountIn; this._onCountIn = null; if (f) f(ev.time); if (!this.running && this.onStop) this.onStop(); continue; }
      if (this.onBeat) this.onBeat(ev);
    }
  }
}

// Tap tempo helper
export function makeTapper(onTempo) {
  let taps = [];
  return () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const iv = [];
      for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
      const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
      onTempo(Math.round(60000 / avg));
    }
  };
}
