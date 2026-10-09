// Shared, simple instrument voices for scales, reference tones and the drone.
// piano: struck string with slightly stretched partials that each fade at their own speed
// soft:  a pure, flute-like tone
// strings: a warm bowed tone with a gentle attack, no vibrato (good for intonation)
import { getCtx } from './audio.js';

export const VOICES = { piano: 'Piano', soft: 'Soft', strings: 'Strings' };

const waveCache = new Map();
function wave(ctx, name, amps) {
  const key = name + ctx.sampleRate;
  if (waveCache.has(key)) return waveCache.get(key);
  const n = amps.length + 1, re = new Float32Array(n), im = new Float32Array(n);
  amps.forEach((a, i) => { im[i + 1] = a; });
  const w = ctx.createPeriodicWave(re, im);
  waveCache.set(key, w);
  return w;
}
const STRINGS = Array.from({ length: 24 }, (_, i) => { const k = i + 1; return Math.pow(k, -1.1) * (k % 2 ? 1 : 0.8) * Math.exp(-k / 18); });
const SOFT = [1, 0.12, 0.04, 0.015];

// Play one note. t: start time, dur: how long it is held. Returns the end time.
export function playNote(out, freq, t, dur, voice = 'piano', vel = 1) {
  const ctx = getCtx();
  if (voice === 'piano') {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(out);
    const len = Math.min(4.5, 1.6 + 2.4 * Math.pow(220 / freq, 0.5));
    const release = 0.18;
    const end = t + Math.min(dur, len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.004);
    g.gain.setValueAtTime(0.5 * vel, end);
    g.gain.setTargetAtTime(0, end, release / 3);
    const B = 0.00035;
    for (let k = 1; k <= 9; k++) {
      const f = freq * k * Math.sqrt(1 + B * k * k);
      if (f > 9000) break;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const pg = ctx.createGain();
      const a = (k === 1 ? 1 : 0.62 / Math.pow(k, 1.15)) * (1 + 0.15 * Math.sin(k * 2.3));
      const decay = len / (1 + 0.55 * (k - 1));
      pg.gain.setValueAtTime(a, t);
      pg.gain.setTargetAtTime(a * 0.35, t + 0.01, 0.12 / Math.sqrt(k));
      pg.gain.setTargetAtTime(0, t + 0.15, decay / 4);
      o.connect(pg).connect(g);
      o.start(t); o.stop(end + release * 2 + 0.05);
    }
    // a soft felt "thump" for the hammer
    const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.03), ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.006));
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = Math.min(4000, freq * 3); nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.06 * vel;
    ns.connect(nf).connect(ng).connect(g); ns.start(t);
    return end + release;
  }
  const o = ctx.createOscillator();
  o.setPeriodicWave(voice === 'strings' ? wave(ctx, 'strings', STRINGS) : wave(ctx, 'soft', SOFT));
  o.frequency.value = freq;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
  lp.frequency.value = voice === 'strings' ? Math.min(6000, freq * 7) : Math.min(8000, freq * 6);
  const g = ctx.createGain(); g.gain.value = 0;
  const atk = voice === 'strings' ? Math.min(0.09, dur * 0.3) : Math.min(0.03, dur * 0.2);
  const rel = voice === 'strings' ? 0.16 : 0.08;
  const level = (voice === 'strings' ? 0.32 : 0.42) * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + atk);
  g.gain.setValueAtTime(level, t + Math.max(atk, dur - rel * 0.3));
  g.gain.setTargetAtTime(0, t + Math.max(atk, dur - rel * 0.3), rel / 3);
  o.connect(lp).connect(g).connect(out);
  o.start(t); o.stop(t + dur + rel * 2);
  return t + dur + rel;
}

// A sustained voice (drone). Returns { stop(time) }.
export function holdNote(out, freq, voice = 'strings', level = 1) {
  const ctx = getCtx(), t = ctx.currentTime + 0.02;
  const o = ctx.createOscillator();
  if (voice === 'pure') o.type = 'sine';
  else o.setPeriodicWave(voice === 'organ' ? wave(ctx, 'organ', [1, 0.5, 0.3, 0.22, 0, 0.12, 0, 0.08]) : wave(ctx, 'strings', STRINGS));
  o.frequency.value = freq;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(8000, freq * (voice === 'strings' ? 6 : 10)); lp.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setTargetAtTime(0.3 * level, t, 0.15);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  return { stop(at = getCtx().currentTime) { g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, 0.1); o.stop(at + 0.6); } };
}
