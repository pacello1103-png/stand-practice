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
//   strings  three slightly detuned bows with a warm body and a breath of bow noise
//   organ    a flue organ: 8' and 4' ranks, perfectly steady (best for intonation)
//   choir    an "ah" vowel sung by two voices with a very small vibrato
//   pure     a sine wave
let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); let b = 0;
  for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
  return noiseBuf;
}
const SAW = Array.from({ length: 48 }, (_, i) => 1 / (i + 1));
export const VOICE_GAIN = { strings: 1, organ: 0.85, choir: 1.15, pure: 0.9 };
export function holdNote(out, freq, voice = 'strings', level = 1) {
  const ctx = getCtx(), t = ctx.currentTime + 0.02;
  const g = ctx.createGain(); g.gain.value = 0; g.connect(out);
  const src = [];
  const osc = (f, waveName, amps, det = 0) => {
    const o = ctx.createOscillator();
    if (amps) o.setPeriodicWave(wave(ctx, waveName, amps)); else o.type = 'sine';
    o.frequency.value = f; o.detune.value = det; o.start(t); src.push(o); return o;
  };
  if (voice === 'strings') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(7000, freq * 5.5); lp.Q.value = 0.6;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 260; body.Q.value = 1.1; body.gain.value = 3;
    lp.connect(body).connect(g);
    for (const [det, lv] of [[-3.5, 0.32], [0, 0.4], [3.5, 0.32]]) { const og = ctx.createGain(); og.gain.value = lv; osc(freq, 'strings', STRINGS, det).connect(og).connect(lp); }
    const n = ctx.createBufferSource(); n.buffer = noise(ctx); n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(4500, freq * 3); bp.Q.value = 1.4;
    const ng = ctx.createGain(); ng.gain.value = 0.012;
    n.connect(bp).connect(ng).connect(g); n.start(t); src.push(n);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 0.025 * level;
    lfo.connect(lg).connect(g.gain); lfo.start(t); src.push(lfo);
  } else if (voice === 'organ') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, freq * 10); lp.connect(g);
    const a = ctx.createGain(); a.gain.value = 0.75; osc(freq, 'organ8', [1, 0.42, 0.22, 0.12, 0.06, 0.04]).connect(a).connect(lp);
    const b = ctx.createGain(); b.gain.value = 0.28; osc(freq * 2, 'organ4', [1, 0.2, 0.08]).connect(b).connect(lp);
  } else if (voice === 'choir') {
    const mix = ctx.createGain(); mix.gain.value = 1;
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6; const vg = ctx.createGain(); vg.gain.value = 3.5; vib.connect(vg); vib.start(t); src.push(vib);
    for (const det of [-5, 5]) { const o = osc(freq, 'saw', SAW, det); vg.connect(o.detune); const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og).connect(mix); }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.connect(g);
    for (const [f, q, gv] of [[700, 6, 1], [1150, 8, 0.55], [2650, 10, 0.22]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const fg = ctx.createGain(); fg.gain.value = gv * 3.2; mix.connect(bp).connect(fg).connect(lp);
    }
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = Math.max(300, freq * 1.5); const lg = ctx.createGain(); lg.gain.value = 0.35; mix.connect(low).connect(lg).connect(lp);
  } else {
    osc(freq).connect(g);
  }
  g.gain.setTargetAtTime(0.3 * level * (VOICE_GAIN[voice] || 1), t, 0.18);
  return {
    stop(at = getCtx().currentTime) {
      g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, 0.12);
      for (const n of src) { try { n.stop(at + 0.9); } catch {} }
    },
  };
}

// One tanpura string: a plucked note whose upper partials bloom and shimmer (jawari).
export function pluckTanpura(out, freq, t, level = 1) {
  const ctx = getCtx();
  const g = ctx.createGain(); g.gain.value = 0.2 * level; g.connect(out);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, freq * 14); lp.connect(g);
  for (let k = 1; k <= 16; k++) {
    const f = freq * k; if (f > 9000) break;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = (((k * 37) % 7) - 3) * 0.5;
    const pg = ctx.createGain(); const a = (k === 1 ? 0.6 : 1) / Math.pow(k, 0.55);
    pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(a * (k > 3 ? 0.4 : 1), t + 0.006);
    if (k > 3) pg.gain.setTargetAtTime(a, t + 0.006, 0.22);
    pg.gain.setTargetAtTime(0, t + 0.35, 2.4 / (1 + 0.06 * k));
    o.connect(pg).connect(lp); o.start(t); o.stop(t + 8);
  }
}
