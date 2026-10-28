// Sampled instruments for Compose and the Studio: real recorded notes (MusyngKite sound set;
// the solo strings from VSCO 2 Community Edition, CC0, with soft and loud layers and their own
// sustained, spiccato, pizzicato and tremolo recordings),
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
const DECAYING = new Set(['piano', 'grand', 'epiano', 'harpsichord', 'celesta', 'pizz', 'harp', 'guitar', 'steelguitar', 'eguitar', 'ebass', 'jazzbass',
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

// Body EQ for the sampled instruments: [type, Hz, dB, Q]
// (cello: Starker, Cassadó and a 1995 recording of the 3rd Suite's Sarabande; violin: Shaham's
// Siciliana and Ricci's Sarabande; viola: between the two)
const BODY = {
  cello: [['lowshelf', 400, 4], ['peaking', 120, 3, 1], ['peaking', 3000, -4, 0.8]],
  violin: [['peaking', 3500, -9, 0.6], ['highshelf', 7000, -5], ['peaking', 1800, -2, 1]],
  viola: [['lowshelf', 350, 2], ['peaking', 3200, -6, 0.6], ['highshelf', 7000, -3]],
  cello_solo: [['peaking', 400, 4.5, 0.7], ['peaking', 3500, -5, 0.8], ['highshelf', 7000, -2]],
  viola_solo: [['peaking', 3200, -4, 0.7], ['highshelf', 7000, -2]],
  // (the grand was recorded close to its strings: heard from the hall, its top is softer)
  piano: [['highshelf', 2500, -4], ['highshelf', 7000, -4]],
};
export const DEFAULT_MIX = () => ({ vol: 0.8, pan: null, low: 0, high: 0, bright: 0.5, attack: 0, release: 1, reverb: 0.35, mute: false, solo: false });

const ROOMS = {
  studio: { decay: 0.9, pre: 0.01, damp: 0.5, label: 'Studio' },
  hall: { decay: 2.3, pre: 0.024, damp: 0.42, label: 'Concert hall' },
  church: { decay: 4.2, pre: 0.035, damp: 0.36, label: 'Church' },
  chamber: { decay: 1.4, pre: 0.016, damp: 0.46, label: 'Chamber hall' },
};
export const ROOM_LABELS = Object.fromEntries(Object.entries(ROOMS).map(([k, v]) => [k, v.label]));

// The strings recorded for real in each way of playing (bowed, spiccato, pizzicato, tremolo), each
// at two strengths: the right recording is chosen for each note instead of shaping one sound.
const REAL = { violin: 'vl', viola: 'va', cello: 'vc', bass: 'cb' };
export const realSet = (sid, kind = 'sus') => (REAL[sid] ? REAL[sid] + '_' + kind : null);
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

// Every recorded note played at an even loudness: recordings differ (one note of a set twice as
// loud as its neighbour, the soft recordings five to ten times quieter than the loud ones), which
// made sudden jumps from one note to the next, and from mp to mf where the soft recording gives way
// to the loud one. Each is brought to the loudness of the set's typical loud note; how loud a note
// is then comes only from the music (its dynamic), and the soft recording only gives its colour.
// (Ringing instruments only half way: their high notes are meant to be lighter.)
const MED = new Map();
const XF = [0.4, 0.66];   // (the velocities over which the soft and loud recordings blend)
function evenGain(I, sid, m, layer, rings) {
  const R = I.R && I.R[sid]; if (!R) return layer === 'p' ? ((I.P || {})[sid] || 1) : 1;
  const r = R[m + (layer ? '_' + layer : '')]; if (!r) return layer === 'p' ? ((I.P || {})[sid] || 1) : 1;
  let ref = MED.get(sid);
  if (ref === undefined) {
    const vals = Object.entries(R).filter(([k]) => !k.endsWith('_p')).map(([, v]) => v).sort((a, b) => a - b);
    ref = vals.length ? vals[vals.length >> 1] : r; MED.set(sid, ref);
  }
  // (the grand piano: its three strengths as loud as each other, the register only half evened, as
  // a piano's treble is lighter by nature)
  if (sid === 'grand') {
    const rf = R[m + '_f'] || r;
    const k = Math.pow(ref / rf, 0.5) * (rf / r);
    return Math.max(0.4, Math.min(9, k));
  }
  const ringing = DECAYING.has(sid) || rings;
  const k = Math.pow(ref / r, ringing ? 0.5 : 0.9);
  // (a soft recording speaks more slowly: a little more of it, so it is even as the note begins)
  return Math.max(0.4, Math.min(layer === 'p' ? 9 : 3, k * (layer === 'p' ? (globalThis.__pBoost ?? 1.25) : 1)));
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
    if (globalThis.__noComp) this.out.connect(dest); else this.out.connect(comp).connect(dest);
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

  async sampleFor(sid, midi, kind = 'sus', vel = 0.7) {
    const I = await loadIndex();
    // a real recording of this way of playing, at the nearest strength
    // a real solo cello or viola, every note recorded (in place of the section recordings)
    const SOLO = { cello: 'vc_solo', viola: 'va_solo' };
    if (kind === 'sus' && SOLO[sid] && I.n[SOLO[sid]] && !this.plain && (globalThis.__solo ?? 1)) {
      const list = I.n[SOLO[sid]]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      return this.load(SOLO[sid], best, 'f', kind);
    }
    const set = realSet(sid, kind);
    if (set && I.n[set] && I.n[set].length && !this.plain) {
      const list = I.n[set]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      const L = (I.L && I.L[set]) || ['f'];
      // between mp and mf both recordings sound together, the soft one giving way to the loud one
      // little by little (no sudden change of colour)
      if (L.includes('p') && L.includes('f') && vel > XF[0] && vel < XF[1]) {
        const [a, b] = await Promise.all([this.load(set, best, 'p', kind), this.load(set, best, 'f', kind)]);
        const w = (vel - XF[0]) / (XF[1] - XF[0]);
        return Object.assign(Object.create(b), { pair: a, w });
      }
      const layer = L.includes('p') && vel < 0.52 ? 'p' : L.includes('f') ? 'f' : L[0];
      return this.load(set, best, layer, kind);
    }
    // the grand piano: a real concert grand recorded at three strengths, blended by the dynamic
    const LAYERED = { piano: 'grand' };
    if (LAYERED[sid] && I.n[LAYERED[sid]] && !this.plain && (globalThis.__grand ?? 1)) {
      const set2 = LAYERED[sid], list = I.n[set2]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      const L = I.L[set2];
      // (soft below about p, loud above about f, and blended across each boundary)
      const B = [0.47, 0.73], W = 0.07;
      for (let i = 0; i < B.length; i++) {
        if (Math.abs(vel - B[i]) < W) {
          const [a, b] = await Promise.all([this.load(set2, best, L[i], 'sus'), this.load(set2, best, L[i + 1], 'sus')]);
          return Object.assign(Object.create(b), { pair: a, w: (vel - (B[i] - W)) / (2 * W) });
        }
      }
      const li = vel < B[0] ? 0 : vel < B[1] ? 1 : 2;
      return this.load(set2, best, L[li], 'sus');
    }
    if (kind === 'pizz' && REAL[sid]) sid = 'pizz';
    // real winds and brass (University of Iowa recordings), in place of the general sound set
    const WIND = { flute: 'w_flute', oboe: 'w_oboe', clarinet: 'w_clarinet', bassoon: 'w_bassoon', horn: 'w_horn', trumpet: 'w_trumpet' };
    if (WIND[sid] && I.n[WIND[sid]] && !this.plain && (globalThis.__iowaW ?? 1)) {
      const lst = I.n[WIND[sid]];
      if (midi >= lst[0] - 2 && midi <= lst[lst.length - 1] + 3) sid = WIND[sid];
    }
    const index = I.n;
    if (!index[sid] || !index[sid].length) sid = FALLBACK[sid] && index[FALLBACK[sid]] ? FALLBACK[sid] : 'piano';
    const list = index[sid];
    let best = list[0];
    for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
    return this.load(sid, best);
  }
  load(sid, m, layer = null, kind = null) {
    const key = sid + ':' + m + (layer ? ':' + layer : '');
    if (!this.buffers.has(key)) {
      const ctx = getCtx();
      const rings = kind === 'pizz' || kind === 'spic';
      const p = fetch(new URL(`../vendor/sounds/${sid}/${m}${layer ? '_' + layer : ''}.mp3`, import.meta.url))
        .then((r) => { if (!r.ok) throw new Error('missing sample'); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => { const q = ctx.decodeAudioData(ab, res, rej); if (q && q.then) q.then(res, rej); }))
        .then(async (buf) => ({ buf, midi: m, gain: (((await loadIndex()).g || {})[sid] || 4) * evenGain(await loadIndex(), sid, m, layer, rings), loop: DECAYING.has(sid) || rings ? null : makeLoop(buf, m), kind, real: !!kind && !!layer, layer, set: sid, oneLayer: /_solo$/.test(sid), tc: (((await loadIndex()).T || {})[sid] || {})[m] || 0, ownVib: /^w_(flute|oboe|trumpet|bassoon)$/.test(sid), atk: (((await loadIndex()).A || {})[sid] || {})[m + (layer ? '_' + layer : '')] || null, atkT: (await loadIndex()).AT || null }));
      p.catch(() => this.buffers.delete(key));
      this.buffers.set(key, p);
    }
    return this.buffers.get(key);
  }
  // Load every sample a list of notes needs, before playing starts.
  async prepare(list) {
    const jobs = new Map();
    for (const { sid, midi, kind, vel } of list) jobs.set(sid + ':' + midi + ':' + (kind || '') + ':' + Math.round((vel ?? 0.7) * 20), this.sampleFor(sid, midi, kind || 'sus', vel ?? 0.7).catch(() => null));
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
      // the instrument's body: the warmth recordings of the real instrument have and the samples
      // lack (fitted against recordings of real players, see BODY)
      let node = ch.input;
      ch.body = [];
      const bk = (sid === 'cello' || sid === 'viola') && !this.plain && (globalThis.__solo ?? 1) ? sid + '_solo' : sid;
      for (const [type, f, gdb, q] of (globalThis.__bodyEq || BODY)[bk] || []) {
        const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gdb; if (q) b.Q.value = q;
        node.connect(b); node = b; ch.body.push(b);
      }
      node.connect(ch.low).connect(ch.high).connect(ch.bright).connect(ch.gain).connect(ch.pan).connect(this.out);
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
    // two recordings blended (soft and loud): each played, their levels sharing the note (equal power)
    if (sample.pair && !opts.blend) {
      const hu = (Math.random() - 0.5) * 4;   // (the two in tune with each other)
      this.noteOn(ch, sample.pair, midi, t, dur, vel, { ...opts, blend: Math.cos(sample.w * Math.PI / 2), human: hu });
      opts = { ...opts, blend: Math.sin(sample.w * Math.PI / 2), human: hu };
    }
    const ctx = this.ctx, sid = ch.sid, mix = ch.mix || DEFAULT_MIX();
    const src = ctx.createBufferSource(); src.buffer = sample.buf;
    // no two notes quite the same: a touch of pitch and level variation, as with a real player
    const human = (opts.human ?? (Math.random() - 0.5) * 4) + (opts.tune || 0);
    const cents = (midi - sample.midi) * 100 + 1200 * Math.log2(this.tuning / 440) + human + (sample.tc || 0);
    src.playbackRate.value = Math.pow(2, cents / 1200);
    // (a real recording played short, or plucked: it rings as recorded)
    const decaying = DECAYING.has(sid) || sample.kind === 'pizz' || sample.kind === 'spic';
    const real = !!sample.real;
    if (!decaying && sample.loop) { src.loop = true; src.loopStart = sample.loop.start; src.loopEnd = sample.loop.end; }
    // softer notes are darker as well as quieter, like a real instrument
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.3;
    // (a real soft or loud recording already has its own colour: only a little more shaping)
    // (the grand piano's three recordings already have the colour of each strength)
    const ownColour = sample.set === 'grand';
    // (one loud recording only: softer is also darker, as with the general sounds, a little less so)
    tone.frequency.value = ownColour ? 20000 : sample.oneLayer ? 1400 + Math.pow(vel, 1.6) * 16000 : real ? 3000 + Math.pow(vel, 1.4) * 17000 : 900 + Math.pow(vel, 1.7) * 17000;
    // bowed strings: no hard, bright edge at the start. The tone opens as the bow settles (a
    // quick sweep up from a warm sound), and the top is kept smooth.
    const bowed = BOWED.has(sid) && !real;
    if (bowed) {
      const top = Math.min(9000, 2200 + Math.pow(vel, 1.4) * 7500 + (midi - 48) * 40);
      tone.frequency.setValueAtTime(Math.min(top, 1400 + midi * 8), t);
      tone.frequency.setTargetAtTime(top, t + 0.01, opts.art === 'acc' || opts.art === 'marc' ? 0.025 : 0.06);
    }
    const g = ctx.createGain(); g.gain.value = 0;
    // A real recording's own start: the soft ones take up to half a second to reach their held sound
    // (the player easing the bow in), the loud ones overshoot it at first. In a line of notes both
    // sounded wrong (a dip, or an accent on every note): unless the note is accented, the slow start
    // is skipped and the overshoot evened out, so the next note arrives at once, at its level.
    let cg = null;
    const accentedNote = opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'stacc' || opts.art === 'stacciss';
    let skip = 0;
    const AT = sample.atkT;
    if (real && sample.atk && AT && !accentedNote && !DECAYING.has(sid) && (globalThis.__atkFix ?? 1)) {
      const lv = sample.atk[1], st = sample.atk[0];
      // (start where the recording is within 9 dB of its held sound, at most 0.45 s in)
      let i0 = lv.findIndex((v) => v >= -9); if (i0 < 0) i0 = lv.length - 2;
      skip = Math.min(0.45, st + Math.max(0, AT[i0] - 0.005));
      // then even out what is left of its start: the note reaches its level in about 50 ms
      const RISE = globalThis.__atkRise ?? 0.05;
      cg = ctx.createGain();
      let first = true;
      for (let i = i0; i < lv.length; i++) {
        const tt = AT[i] - AT[i0];
        const target = -9 + 9 * Math.min(1, tt / RISE);
        const c = Math.max(-8, Math.min(9, target - lv[i]));
        const gv = Math.pow(10, c / 20);
        if (first) { cg.gain.setValueAtTime(gv, t); first = false; } else cg.gain.linearRampToValueAtTime(gv, t + tt);
      }
      const lastT = AT[lv.length - 1] - AT[i0];
      cg.gain.linearRampToValueAtTime(1, t + lastT + 0.12);
    }
    if (cg) src.connect(tone).connect(cg).connect(g).connect(ch.input); else src.connect(tone).connect(g).connect(ch.input);
    // (real recordings, now all as loud as each other: the dynamic gives the whole range, from a
    // true pp to ff, in even steps of about 3.5 dB from one dynamic to the next)
    let level = (sample.real ? Math.pow(10, (-26 + 26 * Math.max(0, Math.min(1.1, vel))) / 20) : 0.12 + Math.pow(vel, 1.5) * 0.88) * (sample.gain || 4) * 0.55 * (0.97 + Math.random() * 0.06) * (opts.blend ?? 1);
    if (opts.art === 'acc' || opts.art === 'marc') level = Math.min(1.15, level * 1.3);
    // a connected (slurred) note starts past the sample's attack and fades in: no new bow or tongue
    const connect = !!opts.connect && !decaying;
    // long notes start gently and grow (a bow settling, a breath filling); short ones speak at once
    const accented = opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'stacc' || opts.art === 'stacciss';
    const shape = !decaying && !accented && !connect;
    const lenAtk = shape ? (dur > 1.2 ? 0.075 : dur > 0.6 ? 0.045 : dur > 0.25 ? 0.02 : 0.006) * (1.15 - vel * 0.5) * (real ? (globalThis.__lenAtkF ?? 0.4) : 1) : 0;
    const atk = Math.max(bowed && !connect ? 0.018 : 0.004, mix.attack * 0.25 + (opts.art === 'legato' ? 0.03 : 0) + (connect ? 0.045 : 0) + lenAtk);
    let hold = dur;
    if (opts.art === 'stacc') hold = Math.min(dur, Math.max(0.07, dur * 0.42));
    else if (opts.art === 'stacciss') hold = Math.min(dur, Math.max(0.05, dur * 0.25));
    else if (opts.art === 'ten' || opts.art === 'legato') hold = dur * 1.02;
    else hold = Math.max(0.05, dur * (BOWED.has(sid) || BLOWN.has(sid) ? (globalThis.__holdF ?? 1) : 0.94));
    // a sharp, bright edge for accents
    let offset = 0;
    if ((opts.art === 'stacc' || opts.art === 'acc' || opts.art === 'marc') && !decaying && !bowed) offset = 0.02;
    if (connect) offset = Math.min(0.09, (sample.buf.duration || 1) * 0.1);
    offset = Math.max(offset, skip);
    if (opts.legato && !decaying) hold = Math.max(hold, dur + 0.05);
    // vibrato: comes in after the start of the note, like a player's
    if (opts.vib && !decaying && (!real || sample.oneLayer) && !sample.ownVib && dur > 0.3) {   // (the real strings play their own vibrato)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2 + Math.random() * 0.8;
      const depth = ctx.createGain(); depth.gain.value = 0;
      // more intense playing, wider vibrato; quiet long notes keep it narrow
      const amt = src.playbackRate.value * (Math.pow(2, (opts.vib * (globalThis.__vibDepth ?? 1) * (0.55 + vel * 0.65)) / 1200) - 1);
      lfo.frequency.value = (globalThis.__vibRate ?? 4.9) + vel * 1.0 + Math.random() * 0.4;
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
    // a glissando: after a moment on the note, the pitch slides to the next note through the whole length
    if (opts.glissTo !== undefined && !decaying) {
      const r0 = src.playbackRate.value, r1 = r0 * Math.pow(2, (opts.glissTo - midi) / 12);
      src.playbackRate.setValueAtTime(r0, t + Math.min(0.15, dur * 0.25));
      src.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, r1), t + dur);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * (shape && dur > 0.6 ? 0.86 : 1), t + atk);
    if (shape && dur > 0.6 && !(opts.env && opts.env.length)) g.gain.linearRampToValueAtTime(level, t + atk + Math.min(0.35, dur * 0.3));
    // the sound of the bow catching the string or the breath starting the note
    if ((BOWED.has(sid) || BLOWN.has(sid)) && !connect && !real && this.noise) {
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
        if (!ownColour) tone.frequency.linearRampToValueAtTime(Math.min(20000, (900 + Math.pow(Math.min(1, vel * ev), 1.7) * 17000)), et);
      }
    }
    if ((opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'fp') && !decaying && hold > 0.25) {
      g.gain.setTargetAtTime(level * (opts.art === 'fp' ? 0.35 : 0.62), t + 0.08, 0.06);
    }
    const rel = (RELEASE[sid] ?? 0.2) * (mix.release ?? 1);
    const end = t + hold;
    if (decaying) {
      // ringing instruments: the note sounds on until it is damped (or rings out)
      const ringFor = sid === 'harp' || sid === 'vibraphone' || sid === 'bells' || sid === 'glockenspiel' || sid === 'celesta' ? Math.max(hold, 1.8) : sample.kind === 'pizz' ? Math.max(hold, 0.6) : hold;
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
    src.onended = () => { this.voices.delete(v); try { g.disconnect(); tone.disconnect(); if (cg) cg.disconnect(); } catch {} };
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
    const sample = await this.sampleFor(sid, midi, 'sus', vel).catch(() => null);
    const ch = this.channel('preview:' + sid, sid, mix || { ...DEFAULT_MIX(), reverb: 0.25 });
    return this.noteOn(ch, sample, midi, this.ctx.currentTime + 0.01, dur, vel);
  }
}

export const sampler = new Sampler();
