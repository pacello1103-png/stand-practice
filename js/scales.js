// Scale and arpeggio player with selectable tuning system and a soft, unobtrusive tone.
import { getCtx, master } from './audio.js';
import { tunedFreq, centsOffset, NOTE_NAMES, midiName } from './temperament.js';

export const SCALE_TYPES = {
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  natural: { label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  melodic: { label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11], down: [0, 2, 3, 5, 7, 8, 10] },
  chromatic: { label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  majArp: { label: 'Major arpeggio', steps: [0, 4, 7] },
  minArp: { label: 'Minor arpeggio', steps: [0, 3, 7] },
  dom7: { label: 'Dominant 7th arpeggio', steps: [0, 4, 7, 10], keyShift: 5 },
  dim7: { label: 'Diminished 7th arpeggio', steps: [0, 3, 6, 9] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  pentatonic: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  wholetone: { label: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
};
const MINORISH = new Set(['natural', 'harmonic', 'melodic', 'minArp', 'dorian']);

// Build the note list (MIDI numbers) for a scale.
export function buildScale({ tonic, octave, octaves, type, direction }) {
  const def = SCALE_TYPES[type];
  const base = 12 * (octave + 1) + tonic;
  const up = [];
  for (let o = 0; o < octaves; o++) for (const s of def.steps) up.push(base + 12 * o + s);
  up.push(base + 12 * octaves);
  const downSteps = def.down || def.steps;
  const down = [];
  for (let o = octaves - 1; o >= 0; o--) for (let i = downSteps.length - 1; i >= 0; i--) down.push(base + 12 * o + downSteps[i]);
  // down: from top (excluded, already in up) to bottom tonic
  const downFull = [base + 12 * octaves, ...down];
  if (direction === 'up') return up;
  if (direction === 'down') return downFull;
  return [...up, ...down];
}

// The tuning key for just/Pythagorean: the scale's tonic. For a minor scale we tune
// relative to the tonic too (just minor third 6:5), which is what string players aim for.
export function keyFor(tonic, type) { return tonic; }

// Soft tone: a few gentle partials, slow attack, lowpassed; no buzz.
function toneWave(ctx, kind) {
  const n = 16, re = new Float32Array(n), im = new Float32Array(n);
  const sets = {
    soft: [1, 0.18, 0.06, 0.03],
    warm: [1, 0.45, 0.28, 0.16, 0.1, 0.06, 0.04],
    clear: [1, 0.3, 0.12, 0.08, 0.05],
  };
  (sets[kind] || sets.soft).forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im);
}

export class ScalePlayer {
  constructor() {
    this.tonic = 0; this.octave = 2; this.octaves = 2; this.type = 'major'; this.direction = 'updown';
    this.system = 'equal'; this.ref = 442; this.bpm = 60; this.perBeat = 1; this.repeat = false;
    this.sound = 'soft'; this.volume = 0.6; this.click = false; this.drone = false; this.legato = true;
    this.playing = false; this.onNote = null; this.onEnd = null;
  }
  notes() { return buildScale(this); }
  freqOf(m) { return tunedFreq(m, this.ref, keyFor(this.tonic, this.type), this.system); }
  cents(m) { return centsOffset(((m % 12) + 12) % 12, keyFor(this.tonic, this.type), this.system); }
  title() { return NOTE_NAMES[this.tonic] + ' ' + SCALE_TYPES[this.type].label.toLowerCase(); }

  _out() {
    const ctx = getCtx();
    if (!this.out) {
      this.out = ctx.createGain();
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 3200; this.lp.Q.value = 0.4;
      this.out.connect(this.lp).connect(master());
    }
    this.out.gain.setTargetAtTime(this.volume * 0.55, ctx.currentTime, 0.03);
    return this.out;
  }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.55, getCtx().currentTime, 0.03); }

  _voice(freq, t, dur, level = 1) {
    const ctx = getCtx();
    const o = ctx.createOscillator(); o.setPeriodicWave(this._wave);
    o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = 0;
    const atk = Math.min(0.07, dur * 0.25), rel = Math.min(0.18, dur * 0.4);
    const hold = this.legato ? dur : dur * 0.75;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * level, t + atk);
    g.gain.setTargetAtTime(0.42 * level, t + atk, 0.15);
    g.gain.setTargetAtTime(0, t + hold - rel * 0.3, rel / 3);
    o.connect(g).connect(this._out());
    o.start(t); o.stop(t + hold + rel * 2);
    this._nodes.push(o);
  }
  _click(t, accent) {
    const ctx = getCtx();
    const o = ctx.createOscillator(); o.frequency.value = accent ? 1500 : 1100;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.14, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(master()); o.start(t); o.stop(t + 0.05);
  }

  start() {
    const ctx = getCtx();
    this.stop(true);
    this._wave = toneWave(ctx, this.sound);
    this._nodes = [];
    this._list = this.notes();
    this._i = 0; this._next = ctx.currentTime + 0.12; this._queue = [];
    this.playing = true;
    if (this.drone) this._startDrone();
    this._tick();
    this._timer = setInterval(() => this._tick(), 25);
    const loop = () => { this._drain(); if (this.playing) this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  _startDrone() {
    const ctx = getCtx();
    const f = this.freqOf(12 * (this.octave + 1) + this.tonic);
    const o = ctx.createOscillator(); o.setPeriodicWave(toneWave(ctx, 'warm')); o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.setPeriodicWave(toneWave(ctx, 'soft')); o2.frequency.value = f * 1.5;
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.16, ctx.currentTime, 0.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    o.connect(g); o2.connect(g2).connect(g); g.connect(this._out());
    o.start(); o2.start();
    this._drone = { o, o2, g };
  }
  _tick() {
    const ctx = getCtx();
    const dur = 60 / this.bpm / this.perBeat;
    while (this.playing && this._next < ctx.currentTime + 0.15) {
      if (this._i >= this._list.length) {
        if (!this.repeat) {
          const end = this._next;
          this._queue.push({ time: end, end: true });
          clearInterval(this._timer); this._timer = null;
          return;
        }
        this._i = 0;
        this._next += dur; // a breath between repeats
      }
      const m = this._list[this._i];
      const last = this._i === this._list.length - 1;
      const d = last ? dur * Math.max(2, this.perBeat) : dur;
      this._voice(this.freqOf(m), this._next, d, 1);
      if (this.click && this._i % this.perBeat === 0) this._click(this._next, this._i % (this.perBeat * 4) === 0);
      this._queue.push({ time: this._next, midi: m, index: this._i });
      this._next += d;
      this._i++;
    }
  }
  _drain() {
    const now = getCtx().currentTime;
    while (this._queue.length && this._queue[0].time <= now) {
      const ev = this._queue.shift();
      if (ev.end) { setTimeout(() => { if (!this._timer) this.stop(); }, 600); continue; }
      this.onNote && this.onNote(ev);
    }
  }
  stop(silent) {
    clearInterval(this._timer); this._timer = null;
    cancelAnimationFrame(this._raf);
    const ctx = getCtx(), now = ctx.currentTime;
    if (this._nodes) for (const o of this._nodes) { try { o.stop(now + 0.05); } catch {} }
    this._nodes = [];
    if (this._drone) { const d = this._drone; d.g.gain.setTargetAtTime(0, now, 0.1); d.o.stop(now + 0.6); d.o2.stop(now + 0.6); this._drone = null; }
    const was = this.playing;
    this.playing = false; this._queue = [];
    if (was && !silent && this.onEnd) this.onEnd();
  }
}

export { midiName };
export const isMinorish = (t) => MINORISH.has(t);
