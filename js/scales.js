// Scale and arpeggio player with selectable tuning system and a soft, unobtrusive tone.
import { getCtx, master } from './audio.js';
import { tunedFreq, centsOffset, NOTE_NAMES, midiName } from './temperament.js';
import { playNote, holdNote } from './synth.js';

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

export class ScalePlayer {
  constructor() {
    this.tonic = 0; this.octave = 2; this.octaves = 2; this.type = 'major'; this.direction = 'updown';
    this.system = 'equal'; this.ref = 442; this.bpm = 60; this.perBeat = 1; this.repeat = false;
    this.sound = 'piano'; this.volume = 0.6; this.click = false; this.drone = false; this.legato = true;
    this.playing = false; this.onNote = null; this.onEnd = null;
    this.countIn = true; this.onCount = null;   // one bar of count-in before the scale: 4, 3, 2, 1
  }
  notes() { return buildScale(this); }
  freqOf(m) { return tunedFreq(m, this.ref, keyFor(this.tonic, this.type), this.system); }
  cents(m) { return centsOffset(((m % 12) + 12) % 12, keyFor(this.tonic, this.type), this.system); }
  title() { return NOTE_NAMES[this.tonic] + ' ' + SCALE_TYPES[this.type].label.toLowerCase(); }

  _outFresh() {
    const ctx = getCtx();
    if (!this.out) {
      this.out = ctx.createGain();
      this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 7500; this.lp.Q.value = 0.4;
      this.out.connect(this.lp).connect(master());
    }
    this.out.gain.setTargetAtTime(this.volume * 0.55, ctx.currentTime, 0.03);
    return this.out;
  }
  _out() { return this._outFresh(); }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v * 0.55, getCtx().currentTime, 0.03); }

  _voice(freq, t, dur, level = 1) {
    playNote(this._out(), freq, t, this.legato ? dur * 0.98 : dur * 0.75, this.sound, level);
  }
  // a short, clean click (a little louder and higher on the first beat of each note or bar)
  _click(t, accent) {
    const ctx = getCtx();
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.32 : 0.18, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    o.connect(g).connect(hp).connect(master()); o.start(t); o.stop(t + 0.045);
  }

  start(at = 0) {
    const ctx = getCtx();
    this.stop(true);
    this._nodes = [];
    this._list = this.notes();
    this._i = 0; this._queue = []; this._end = undefined;
    this.playing = true;
    // one bar of count-in: four beats at the scale's tempo, shown as 4 3 2 1 and clicked
    let t0 = at && at > ctx.currentTime ? at : ctx.currentTime + 0.12;
    const beat = 60 / this.bpm;
    if (this.countIn) {
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * beat;
        if (!this.click) this._click(t, i === 0);   // with the metronome on, its own clicks are heard
        this._queue.push({ time: t, count: 4 - i });
      }
      t0 += 4 * beat;
    }
    this._next = t0;
    this._beat0 = t0; this._beatN = 0; this._noteStarts = [];
    if (this.drone) this._startDrone();
    this._tick();
    this._timer = setInterval(() => this._tick(), 25);
    const loop = () => { this._drain(); if (this.playing) this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  _startDrone() {
    const f = this.freqOf(12 * (this.octave + 1) + this.tonic);
    const a = holdNote(this._out(), f, 'flute', 0.4);
    this._drone = { stop: (t) => a.stop(t) };
  }
  // seconds per note: perBeat notes in one beat (2, 3, 4), or one note over 1/perBeat beats (2, 3, 4 beats)
  _dur() { return 60 / this.bpm / this.perBeat; }
  _tick() {
    const ctx = getCtx();
    const dur = this._dur(), beat = 60 / this.bpm;
    const horizon = ctx.currentTime + 0.15;
    while (this.playing && this._next < horizon) {
      if (this._i >= this._list.length) {
        if (!this.repeat) {
          const end = this._next;
          this._queue.push({ time: end, end: true });
          this._end = end;
          clearInterval(this._timer); this._timer = null;
          break;
        }
        this._i = 0;
        // a breath between repeats: one beat (or one note when notes are longer than a beat)
        this._next += Math.max(beat, dur);
        // the beats stay on the grid
        this._next = this._beat0 + Math.ceil((this._next - this._beat0) / beat - 1e-6) * beat;
      }
      const m = this._list[this._i];
      const last = this._i === this._list.length - 1 && !this.repeat;
      // the last note rings at least two beats (and never less than a normal note)
      const d = last ? Math.max(dur, 2 * beat) : dur;
      this._voice(this.freqOf(m), this._next, d, 1);
      this._queue.push({ time: this._next, midi: m, index: this._i });
      this._noteStarts.push(this._next);
      this._next += d;
      this._i++;
    }
    // the click: every beat while the scale sounds, in the same clock as the notes
    const stopAt = this._end !== undefined ? this._end : Infinity;
    while (this.playing && this._beat0 + this._beatN * beat < Math.min(horizon, stopAt - 1e-4)) {
      const t = this._beat0 + this._beatN * beat;
      // the first beat of each note (long notes), or of each bar of four (quick notes)
      const onNote = this._noteStarts.some((x) => Math.abs(x - t) < 0.002);
      const accent = this.perBeat < 1 ? onNote : this._beatN % 4 === 0;
      const inNote = this.perBeat < 1 ? Math.round((t - (this._noteStarts.filter((x) => x <= t + 0.002).pop() ?? t)) / beat) + 1 : (this._beatN % 4) + 1;
      if (this.click) this._click(t, accent);
      this._queue.push({ time: t, beat: inNote, accent });
      this._beatN++;
    }
    while (this._noteStarts.length > 8) this._noteStarts.shift();
  }
  _drain() {
    const now = getCtx().currentTime;
    while (this._queue.length && this._queue[0].time <= now) {
      const ev = this._queue.shift();
      if (ev.count) { this.onCount && this.onCount(ev.count); continue; }
      if (ev.end) { setTimeout(() => { if (!this._timer) this.stop(); }, 600); continue; }
      if (ev.beat) { this.onBeat && this.onBeat(ev); continue; }
      this.onNote && this.onNote(ev);
    }
  }
  stop(silent) {
    clearInterval(this._timer); this._timer = null;
    cancelAnimationFrame(this._raf);
    const ctx = getCtx(), now = ctx.currentTime;
    if (this.out) { this.out.gain.cancelScheduledValues(now); this.out.gain.setTargetAtTime(0, now, 0.03); this.out = null; }
    if (this._drone) { this._drone.stop(now); this._drone = null; }
    const was = this.playing;
    this.playing = false; this._queue = [];
    if (was && !silent && this.onEnd) this.onEnd();
  }
}

export { midiName };
export const isMinorish = (t) => MINORISH.has(t);
