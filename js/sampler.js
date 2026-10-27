// Sampled instruments for Compose and the Studio: real recorded notes (MusyngKite sound set),
// one sample every three semitones, pitched to the exact note. Sustaining instruments loop a
// seamless part of the held note, so a note can last as long as the music needs. Each instrument
// plays through its own channel: volume, pan, tone (low, high, brightness), attack, release and
// how much of the shared concert-hall reverb it gets.
import { getCtx, master } from './audio.js';
import { makeImpulse } from './recorder.js';

export const SOUND_LABELS = {
  piano: 'Grand piano', epiano: 'Electric piano', harpsichord: 'Harpsichord', organ: 'Church organ', accordion: 'Accordion', celesta: 'Celesta',
  violin: 'Violin', viola: 'Viola', cello: 'Cello', bass: 'Double bass', strings: 'String section', tremolo: 'Strings tremolo', pizz: 'Strings pizzicato',
  harp: 'Harp', guitar: 'Classical guitar', steelguitar: 'Steel guitar', eguitar: 'Electric guitar', ebass: 'Electric bass', jazzbass: 'Jazz bass',
  banjo: 'Banjo', flute: 'Flute', piccolo: 'Piccolo', recorder: 'Recorder', oboe: 'Oboe', englishhorn: 'English horn',
  clarinet: 'Clarinet', bassoon: 'Bassoon', sopsax: 'Soprano sax', altosax: 'Alto sax', tenorsax: 'Tenor sax', barisax: 'Baritone sax',
  horn: 'Horn', trumpet: 'Trumpet', trombone: 'Trombone', tuba: 'Tuba', brass: 'Brass section', choir: 'Choir (aah)', oohs: 'Voices (ooh)',
  timpani: 'Timpani', marimba: 'Marimba', vibraphone: 'Vibraphone', xylophone: 'Xylophone', glockenspiel: 'Glockenspiel', bells: 'Tubular bells',
  woodblock: 'Woodblock', drum: 'Drum',
};
// Sounds that ring and fade by themselves (no loop): they keep ringing after a short note
// only as long as a real player would let them.
const DECAYING = new Set(['piano', 'epiano', 'harpsichord', 'celesta', 'pizz', 'harp', 'guitar', 'steelguitar', 'eguitar', 'ebass', 'jazzbass',
  'banjo', 'timpani', 'marimba', 'vibraphone', 'xylophone', 'glockenspiel', 'bells', 'woodblock', 'drum']);
// natural release after the note ends (seconds)
// instruments that can slide between slurred notes (strings, voices, trombone, winds a little)
const SLIDES = new Set(["violin", "viola", "cello", "bass", "strings", "choir", "voice", "trombone", "flute", "oboe", "clarinet", "altosax", "tenorsax", "horn"]);
// families, for the touches that make a sample sound played: bow or breath at the start of a
// note, and a fuller section sound for ensembles
const BOWED = new Set(['violin', 'viola', 'cello', 'bass', 'strings', 'tremolo']);
const BLOWN = new Set(['flute', 'piccolo', 'recorder', 'oboe', 'englishhorn', 'clarinet', 'bassoon', 'sopsax', 'altosax', 'tenorsax', 'barisax', 'horn', 'trumpet', 'trombone', 'tuba', 'brass']);
const SECTION = new Set(['strings', 'choir', 'oohs', 'brass']);
const RELEASE = { piano: 0.35, epiano: 0.4, harpsichord: 0.25, organ: 0.18, accordion: 0.12, celesta: 0.6, violin: 0.28, viola: 0.3, cello: 0.32, bass: 0.35,
  strings: 0.45, tremolo: 0.35, pizz: 0.4, harp: 1.4, guitar: 0.8, steelguitar: 0.8, eguitar: 0.5, ebass: 0.25, jazzbass: 0.3, banjo: 0.4, mandolin: 0.4,
  flute: 0.14, piccolo: 0.12, recorder: 0.1, oboe: 0.12, englishhorn: 0.14, clarinet: 0.13, bassoon: 0.15, sopsax: 0.12, altosax: 0.12, tenorsax: 0.14, barisax: 0.16,
  horn: 0.25, trumpet: 0.16, trombone: 0.2, tuba: 0.25, brass: 0.25, choir: 0.4, oohs: 0.4, timpani: 1.2, marimba: 0.6, vibraphone: 1.6, xylophone: 0.4,
  glockenspiel: 1.2, bells: 2.5, woodblock: 0.1, drum: 0.2 };
// Where each family sits on a concert stage (pan -1 left .. 1 right) when nothing is set.
export const DEFAULT_PAN = { violin: -0.45, viola: 0.15, cello: 0.35, bass: 0.55, strings: -0.2, tremolo: -0.2, pizz: -0.2, flute: -0.15, piccolo: -0.2,
  oboe: 0.1, englishhorn: 0.12, clarinet: -0.1, bassoon: 0.15, horn: -0.4, trumpet: 0.25, trombone: 0.4, tuba: 0.5, harp: -0.6, timpani: 0.3, piano: 0, choir: 0 };

export const DEFAULT_MIX = () => ({ vol: 0.8, pan: null, low: 0, high: 0, bright: 0.5, attack: 0, release: 1, reverb: 0.35, mute: false, solo: false });

const ROOMS = {
  studio: { decay: 0.9, pre: 0.01, damp: 0.5, label: 'Studio' },
  hall: { decay: 2.3, pre: 0.024, damp: 0.42, label: 'Concert hall' },
  church: { decay: 4.2, pre: 0.035, damp: 0.36, label: 'Church' },
  chamber: { decay: 1.4, pre: 0.016, damp: 0.46, label: 'Chamber hall' },
};
export const ROOM_LABELS = Object.fromEntries(Object.entries(ROOMS).map(([k, v]) => [k, v.label]));

let INDEX = null;
const FALLBACK = { mandolin: 'steelguitar', ukulele: 'guitar' };
async function loadIndex() {
  if (!INDEX) INDEX = fetch(new URL('../vendor/sounds/index.json', import.meta.url)).then((r) => r.json()).then((j) => (j.n ? j : { n: j, g: {} }));
  return INDEX;
}
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Find a seamless loop in the held part of the note and blend its end into its start.
function makeLoop(buf, midi) {
  const sr = buf.sampleRate, d = buf.getChannelData(0), n = d.length;
  const P = sr / midiToFreq(midi);
  const X = Math.round(sr * 0.11);
  let s = Math.round(sr * 1.0), e0 = Math.round(n - sr * 0.2);
  if (e0 - s < sr * 0.6) { s = Math.round(n * 0.35); e0 = Math.round(n * 0.92); }
  // choose the end that best matches the waveform just before the start
  const W = Math.max(256, Math.round(P * 6));
  let best = e0, bestC = -2;
  const span = Math.round(P * 3);
  for (let e = e0 - span; e <= e0 + span; e++) {
    if (e >= n || e - W < 0) continue;
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < W; i += 2) { const a = d[s - W + i], b = d[e - W + i]; ab += a * b; aa += a * a; bb += b * b; }
    const c = ab / Math.sqrt(aa * bb + 1e-12);
    if (c > bestC) { bestC = c; best = e; }
  }
  const e = best;
  // bake an equal-power crossfade so the jump from e back to s is continuous
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const c = buf.getChannelData(ch);
    for (let i = 0; i < X; i++) {
      const w = i / X, ga = Math.cos(w * Math.PI / 2), gb = Math.sin(w * Math.PI / 2);
      c[e - X + i] = c[e - X + i] * ga + c[s - X + i] * gb;
    }
  }
  return { start: s / sr, end: e / sr };
}

export class Sampler {
  constructor() {
    this.buffers = new Map();   // "sid:midi" -> Promise<{buf, loop}>
    this.channels = new Map();  // id -> channel
    this.room = 'hall'; this.roomMix = 1; this.tuning = 440;
    this.ctx = null; this.out = null; this.voices = new Set();
  }
  // The audio graph lives on one context (the live one, or an offline one for export).
  attach(ctx, dest) {
    this.ctx = ctx;
    this.channels.clear();
    this.out = ctx.createGain(); this.out.gain.value = 1.25;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.out.connect(comp).connect(dest);
    this.verb = ctx.createConvolver();
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = this.roomMix;
    this.verbIn.connect(this.verb).connect(this.out);
    this.setRoom(this.room);
    // soft noise for the start of bowed and blown notes
    const nb = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1), ctx.sampleRate); const nd = nb.getChannelData(0);
    let pv = 0; for (let i = 0; i < nd.length; i++) { pv = pv * 0.6 + (Math.random() * 2 - 1) * 0.4; nd[i] = pv; }
    this.noise = nb;
  }
  live() { const ctx = getCtx(); if (this.ctx !== ctx) this.attach(ctx, master()); return this; }
  setRoom(room) {
    this.room = ROOMS[room] ? room : 'hall';
    if (this.ctx) this.verb.buffer = makeImpulse(this.ctx, ROOMS[this.room]);
  }
  setRoomMix(v) { this.roomMix = v; if (this.verbIn) this.verbIn.gain.value = v; }

  async sampleFor(sid, midi) {
    const index = (await loadIndex()).n;
    if (!index[sid] || !index[sid].length) sid = FALLBACK[sid] && index[FALLBACK[sid]] ? FALLBACK[sid] : 'piano';
    const list = index[sid];
    let best = list[0];
    for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
    return this.load(sid, best);
  }
  load(sid, m) {
    const key = sid + ':' + m;
    if (!this.buffers.has(key)) {
      const ctx = getCtx();
      const p = fetch(new URL(`../vendor/sounds/${sid}/${m}.mp3`, import.meta.url))
        .then((r) => { if (!r.ok) throw new Error('missing sample'); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => { const q = ctx.decodeAudioData(ab, res, rej); if (q && q.then) q.then(res, rej); }))
        .then(async (buf) => ({ buf, midi: m, gain: ((await loadIndex()).g || {})[sid] || 4, loop: DECAYING.has(sid) ? null : makeLoop(buf, m) }));
      p.catch(() => this.buffers.delete(key));
      this.buffers.set(key, p);
    }
    return this.buffers.get(key);
  }
  // Load every sample a list of notes needs, before playing starts.
  async prepare(list) {
    const jobs = new Map();
    for (const { sid, midi } of list) jobs.set(sid + ':' + midi, this.sampleFor(sid, midi).catch(() => null));
    await Promise.all(jobs.values());
  }

  // One mixer channel per instrument (or per staff).
  channel(id, sid, mix) {
    let ch = this.channels.get(id);
    if (!ch) {
      const ctx = this.ctx;
      ch = { id, sid };
      ch.input = ctx.createGain();
      ch.low = ctx.createBiquadFilter(); ch.low.type = 'lowshelf'; ch.low.frequency.value = 220;
      ch.high = ctx.createBiquadFilter(); ch.high.type = 'highshelf'; ch.high.frequency.value = 3500;
      ch.bright = ctx.createBiquadFilter(); ch.bright.type = 'lowpass'; ch.bright.Q.value = 0.5;
      ch.gain = ctx.createGain();
      ch.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      ch.send = ctx.createGain();
      ch.input.connect(ch.low).connect(ch.high).connect(ch.bright).connect(ch.gain).connect(ch.pan).connect(this.out);
      ch.gain.connect(ch.send).connect(this.verbIn);
      this.channels.set(id, ch);
    }
    ch.sid = sid;
    this.applyMix(ch, mix || DEFAULT_MIX());
    return ch;
  }
  applyMix(ch, mix, anySolo = false) {
    const t = this.ctx.currentTime;
    ch.mix = mix;
    const on = !mix.mute && (!anySolo || mix.solo);
    ch.gain.gain.setTargetAtTime(on ? Math.pow(mix.vol, 1.6) * 1.1 : 0, t, 0.02);
    ch.low.gain.setTargetAtTime(mix.low * 12, t, 0.02);
    ch.high.gain.setTargetAtTime(mix.high * 12, t, 0.02);
    ch.bright.frequency.setTargetAtTime(1500 * Math.pow(14, mix.bright), t, 0.02);   // 1.5 kHz .. 21 kHz
    if (ch.pan.pan) ch.pan.pan.setTargetAtTime(mix.pan ?? DEFAULT_PAN[ch.sid] ?? 0, t, 0.02);
    ch.send.gain.setTargetAtTime(mix.reverb * 0.9, t, 0.02);
  }

  // Play one note. vel 0..1 (soft..loud), dur seconds, t start time. Returns the voice.
  // opts: { art: 'stacc'|'ten'|'acc'|'marc'|'legato', env: [[time, level]] (for hairpins) }
  noteOn(ch, sample, midi, t, dur, vel = 0.7, opts = {}) {
    if (!sample) return null;
    const ctx = this.ctx, sid = ch.sid, mix = ch.mix || DEFAULT_MIX();
    const src = ctx.createBufferSource(); src.buffer = sample.buf;
    // no two notes quite the same: a touch of pitch and level variation, as with a real player
    const human = (Math.random() - 0.5) * 4 + (opts.tune || 0);
    const cents = (midi - sample.midi) * 100 + 1200 * Math.log2(this.tuning / 440) + human;
    src.playbackRate.value = Math.pow(2, cents / 1200);
    const decaying = DECAYING.has(sid);
    if (!decaying && sample.loop) { src.loop = true; src.loopStart = sample.loop.start; src.loopEnd = sample.loop.end; }
    // softer notes are darker as well as quieter, like a real instrument
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.3;
    tone.frequency.value = 900 + Math.pow(vel, 1.7) * 17000;
    // bowed strings: no hard, bright edge at the start. The tone opens as the bow settles (a
    // quick sweep up from a warm sound), and the top is kept smooth.
    const bowed = BOWED.has(sid);
    if (bowed) {
      const top = Math.min(9000, 2200 + Math.pow(vel, 1.4) * 7500 + (midi - 48) * 40);
      tone.frequency.setValueAtTime(Math.min(top, 1400 + midi * 8), t);
      tone.frequency.setTargetAtTime(top, t + 0.01, opts.art === 'acc' || opts.art === 'marc' ? 0.025 : 0.06);
    }
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(tone).connect(g).connect(ch.input);
    let level = (0.12 + Math.pow(vel, 1.5) * 0.88) * (sample.gain || 4) * 0.55 * (0.97 + Math.random() * 0.06);
    if (opts.art === 'acc' || opts.art === 'marc') level = Math.min(1.15, level * 1.3);
    // a connected (slurred) note starts past the sample's attack and fades in: no new bow or tongue
    const connect = !!opts.connect && !decaying;
    // long notes start gently and grow (a bow settling, a breath filling); short ones speak at once
    const accented = opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'stacc' || opts.art === 'stacciss';
    const shape = !decaying && !accented && !connect;
    const lenAtk = shape ? (dur > 1.2 ? 0.075 : dur > 0.6 ? 0.045 : dur > 0.25 ? 0.02 : 0.006) * (1.15 - vel * 0.5) : 0;
    const atk = Math.max(bowed && !connect ? 0.018 : 0.004, mix.attack * 0.25 + (opts.art === 'legato' ? 0.03 : 0) + (connect ? 0.045 : 0) + lenAtk);
    let hold = dur;
    if (opts.art === 'stacc') hold = Math.min(dur, Math.max(0.07, dur * 0.42));
    else if (opts.art === 'stacciss') hold = Math.min(dur, Math.max(0.05, dur * 0.25));
    else if (opts.art === 'ten' || opts.art === 'legato') hold = dur * 1.02;
    else hold = Math.max(0.05, dur * 0.94);
    // a sharp, bright edge for accents
    let offset = 0;
    if ((opts.art === 'stacc' || opts.art === 'acc' || opts.art === 'marc') && !decaying && !bowed) offset = 0.02;
    if (connect) offset = Math.min(0.09, (sample.buf.duration || 1) * 0.1);
    if (opts.legato && !decaying) hold = Math.max(hold, dur + 0.05);
    // vibrato: comes in after the start of the note, like a player's
    if (opts.vib && !decaying && dur > 0.3) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2 + Math.random() * 0.8;
      const depth = ctx.createGain(); depth.gain.value = 0;
      // more intense playing, wider vibrato; quiet long notes keep it narrow
      const amt = src.playbackRate.value * (Math.pow(2, (opts.vib * (0.55 + vel * 0.65)) / 1200) - 1);
      lfo.frequency.value = 4.9 + vel * 1.0 + Math.random() * 0.4;
      depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(0, t + Math.min(0.35, dur * 0.3)); depth.gain.linearRampToValueAtTime(amt, t + Math.min(0.9, dur * 0.7));
      lfo.connect(depth).connect(src.playbackRate);
      lfo.start(t); lfo.stop(t + dur + 1.5);
    }
    // a slurred step in strings, winds and voices: the pitch slides in from the note before
    if (connect && opts.from !== undefined && SLIDES.has(sid) && Math.abs(opts.from - midi) >= 2 && Math.abs(opts.from - midi) <= 12) {
      const target = src.playbackRate.value, startRate = target * Math.pow(2, (opts.from - midi) * 0.25 / 12);
      const slide = Math.min(0.08, 0.03 + Math.abs(opts.from - midi) * 0.006);
      src.playbackRate.setValueAtTime(startRate, t); src.playbackRate.exponentialRampToValueAtTime(target, t + slide);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * (shape && dur > 0.6 ? 0.86 : 1), t + atk);
    if (shape && dur > 0.6 && !(opts.env && opts.env.length)) g.gain.linearRampToValueAtTime(level, t + atk + Math.min(0.35, dur * 0.3));
    // the sound of the bow catching the string or the breath starting the note
    if ((BOWED.has(sid) || BLOWN.has(sid)) && !connect && this.noise) {
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      // the bow: a soft, low rosin sound (not a hiss), rising and dying away quickly
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = BOWED.has(sid) ? Math.min(1800, 500 + midi * 9) : 1500 + midi * 10; bp.Q.value = BOWED.has(sid) ? 0.8 : 0.9;
      const ng = ctx.createGain(); const nl = level * (BOWED.has(sid) ? 0.022 : 0.035) * (accented ? 1.5 : 1) * (0.6 + vel * 0.6);
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(nl, t + (BOWED.has(sid) ? 0.02 : 0.008)); ng.gain.setTargetAtTime(0, t + 0.03, BOWED.has(sid) ? 0.04 : 0.05);
      n.connect(bp).connect(ng).connect(ch.input);
      n.start(t, Math.random() * 0.5); n.stop(t + 0.3);
      n.onended = () => { try { ng.disconnect(); } catch {} };
    }
    if (opts.env && opts.env.length) {
      for (const [et, ev] of opts.env) if (et > t + atk && et < t + hold) {
        g.gain.linearRampToValueAtTime(level * ev, et);
        // louder is brighter: the tone opens up in a crescendo and closes in a diminuendo
        tone.frequency.linearRampToValueAtTime(Math.min(20000, (900 + Math.pow(Math.min(1, vel * ev), 1.7) * 17000)), et);
      }
    }
    if ((opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'fp') && !decaying && hold > 0.25) {
      g.gain.setTargetAtTime(level * (opts.art === 'fp' ? 0.35 : 0.62), t + 0.08, 0.06);
    }
    const rel = (RELEASE[sid] ?? 0.2) * (mix.release ?? 1);
    const end = t + hold;
    if (decaying) {
      // ringing instruments: the note sounds on until it is damped (or rings out)
      const ringFor = sid === 'harp' || sid === 'vibraphone' || sid === 'bells' || sid === 'glockenspiel' || sid === 'celesta' ? Math.max(hold, 1.8) : hold;
      g.gain.setValueAtTime(g.gain.value, t + ringFor);
      g.gain.setTargetAtTime(0, t + ringFor, rel / 3);
      src.start(t, offset); src.stop(t + ringFor + rel * 3 + 0.05);
    } else {
      g.gain.cancelScheduledValues(end);
      g.gain.setTargetAtTime(0, end, rel / 3);
      src.start(t, offset); src.stop(end + rel * 3 + 0.05);
    }
    // a section is many players: a second, slightly later and slightly out of tune, widens it
    if (SECTION.has(sid) && !opts.tune && !opts.single) this.noteOn(ch, sample, midi, t + 0.012 + Math.random() * 0.01, dur, vel * 0.8, { ...opts, tune: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4), single: true });
    const v = { src, g, end: end + rel * 3 };
    this.voices.add(v);
    src.onended = () => { this.voices.delete(v); try { g.disconnect(); tone.disconnect(); } catch {} };
    return v;
  }
  stopAll(fade = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, fade / 3); v.src.stop(t + fade * 2); } catch {} }
    this.voices.clear();
  }
  // Quick audition (placing a note, tapping a key): loads on demand and plays at once.
  async preview(sid, midi, vel = 0.7, dur = 0.7, mix) {
    this.live();
    const sample = await this.sampleFor(sid, midi).catch(() => null);
    const ch = this.channel('preview:' + sid, sid, mix || { ...DEFAULT_MIX(), reverb: 0.25 });
    return this.noteOn(ch, sample, midi, this.ctx.currentTime + 0.01, dur, vel);
  }
}

export const sampler = new Sampler();
