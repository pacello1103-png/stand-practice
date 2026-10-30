// Sampled instruments for Compose and the Studio: real recorded notes (MusyngKite sound set;
// the solo strings from VSCO 2 Community Edition, CC0, with soft and loud layers and their own
// sustained, spiccato, pizzicato and tremolo recordings),
// one sample every three semitones, pitched to the exact note. Sustaining instruments loop a
// seamless part of the held note, so a note can last as long as the music needs. Each instrument
// plays through its own channel: volume, pan, tone (low, high, brightness), attack, release and
// how much of the shared concert-hall reverb it gets.
import { getCtx, master } from './audio.js';
import { makeImpulse, loadRefIR, refReady } from './recorder.js';

export const SOUND_LABELS = {
  piano: 'Grand piano', epiano: 'Electric piano', harpsichord: 'Harpsichord', organ: 'Church organ', accordion: 'Accordion', celesta: 'Celesta',
  violin: 'Violin (solo)', viola: 'Viola (solo)', cello: 'Cello (solo)', bass: 'Double bass (solo)', violins: 'Violins (section)', violas: 'Violas (section)', cellos: 'Cellos (section)', basses: 'Double basses (section)', strings: 'String section (classic)', tremolo: 'Strings tremolo', pizz: 'Strings pizzicato',
  harp: 'Harp', guitar: 'Classical guitar', steelguitar: 'Steel guitar', eguitar: 'Electric guitar', ebass: 'Electric bass', jazzbass: 'Jazz bass',
  banjo: 'Banjo', flute: 'Flute', piccolo: 'Piccolo', recorder: 'Recorder', oboe: 'Oboe', englishhorn: 'English horn',
  clarinet: 'Clarinet', bassoon: 'Bassoon', sopsax: 'Soprano sax', altosax: 'Alto sax', tenorsax: 'Tenor sax', barisax: 'Baritone sax',
  horn: 'Horn', trumpet: 'Trumpet', trombone: 'Trombone', tuba: 'Tuba', brass: 'Brass section', choir: 'Choir (aah)', oohs: 'Voices (ooh)',
  timpani: 'Timpani', marimba: 'Marimba', vibraphone: 'Vibraphone', xylophone: 'Xylophone', glockenspiel: 'Glockenspiel', bells: 'Tubular bells',
  woodblock: 'Woodblock', drum: 'Drum', snare: 'Snare drum', bassdrum: 'Bass drum', toms: 'Tom-toms', cymbals: 'Crash cymbals', suspcymbal: 'Suspended cymbal', triangle: 'Triangle', tambourine: 'Tambourine', bongos: 'Bongos',
};
// Sounds that ring and fade by themselves (no loop): they keep ringing after a short note
// only as long as a real player would let them.
const DECAYING = new Set(['piano', 'grand', 'grand2', 'epiano', 'harpsichord', 'celesta', 'pizz', 'harp', 'guitar', 'steelguitar', 'eguitar', 'ebass', 'jazzbass',
  'banjo', 'timpani', 'marimba', 'vibraphone', 'xylophone', 'glockenspiel', 'bells', 'woodblock', 'drum',
  'snare', 'bassdrum', 'toms', 'cymbals', 'suspcymbal', 'triangle', 'tambourine', 'bongos']);
// natural release after the note ends (seconds)
// instruments that can slide between slurred notes (strings, voices, trombone, winds a little)
const SLIDES = new Set(["violin", "viola", "cello", "bass", "violins", "violas", "cellos", "basses", "strings", "choir", "voice", "trombone", "flute", "oboe", "clarinet", "altosax", "tenorsax", "horn"]);
// families, for the touches that make a sample sound played: bow or breath at the start of a
// note, and a fuller section sound for ensembles
const BOWED = new Set(['violin', 'viola', 'cello', 'bass', 'violins', 'violas', 'cellos', 'basses', 'strings', 'tremolo']);
const BLOWN = new Set(['flute', 'piccolo', 'recorder', 'oboe', 'englishhorn', 'clarinet', 'bassoon', 'sopsax', 'altosax', 'tenorsax', 'barisax', 'horn', 'trumpet', 'trombone', 'tuba', 'brass']);
const SECTION = new Set(['strings', 'choir', 'oohs', 'brass']);
const RELEASE = { piano: 0.35, epiano: 0.4, harpsichord: 0.25, organ: 0.18, accordion: 0.12, celesta: 0.6, violin: 0.28, viola: 0.3, cello: 0.32, bass: 0.35, violins: 0.4, violas: 0.42, cellos: 0.45, basses: 0.45,
  strings: 0.45, tremolo: 0.35, pizz: 0.4, harp: 1.4, guitar: 0.8, steelguitar: 0.8, eguitar: 0.5, ebass: 0.25, jazzbass: 0.3, banjo: 0.4, mandolin: 0.4,
  flute: 0.14, piccolo: 0.12, recorder: 0.1, oboe: 0.12, englishhorn: 0.14, clarinet: 0.13, bassoon: 0.15, sopsax: 0.12, altosax: 0.12, tenorsax: 0.14, barisax: 0.16,
  horn: 0.25, trumpet: 0.16, trombone: 0.2, tuba: 0.25, brass: 0.25, choir: 0.4, oohs: 0.4, timpani: 1.2, marimba: 0.6, vibraphone: 1.6, xylophone: 0.4,
  glockenspiel: 1.2, bells: 2.5, woodblock: 0.1, drum: 0.2, snare: 0.3, bassdrum: 1.2, toms: 0.5, cymbals: 2.5, suspcymbal: 2.5, triangle: 2, tambourine: 0.4, bongos: 0.3 };
// Where each family sits on a concert stage (pan -1 left .. 1 right) when nothing is set.
export const DEFAULT_PAN = { violin: -0.45, viola: 0.15, cello: 0.35, bass: 0.55, violins: -0.45, violas: 0.15, cellos: 0.35, basses: 0.55, strings: -0.2, tremolo: -0.2, pizz: -0.2, flute: -0.15, piccolo: -0.2,
  oboe: 0.1, englishhorn: 0.12, clarinet: -0.1, bassoon: 0.15, horn: -0.4, trumpet: 0.25, trombone: 0.4, tuba: 0.5, harp: -0.6, timpani: 0.3, piano: 0, choir: 0,
  snare: 0.15, bassdrum: 0.2, toms: 0.2, cymbals: 0.1, suspcymbal: 0.15, triangle: 0.05, tambourine: 0.1, bongos: 0.1 };

// Body EQ for the sampled instruments: [type, Hz, dB, Q]
// (cello: Starker, Cassadó and a 1995 recording of the 3rd Suite's Sarabande; violin: Shaham's
// Siciliana and Ricci's Sarabande; viola: between the two)
const BODY = {
  cello: [['lowshelf', 400, 4], ['peaking', 120, 3, 1], ['peaking', 3000, -4, 0.8]],
  violin: [['peaking', 3500, -9, 0.6], ['highshelf', 7000, -5], ['peaking', 1800, -2, 1]],
  viola: [['lowshelf', 350, 2], ['peaking', 3200, -6, 0.6], ['highshelf', 7000, -3]],
  cello_solo: [['peaking', 400, 4.5, 0.7], ['peaking', 3500, -5, 0.8], ['highshelf', 7000, -2]],
  viola_solo: [['peaking', 3200, -4, 0.7], ['highshelf', 7000, -2]],
  // (the solo cello at three strengths: thinner recordings, given the body of the other's)
  cello_solo3: [['peaking', 400, 4.5, 0.7], ['lowshelf', 600, 7.5], ['peaking', 520, 4, 1.2], ['peaking', 2000, -3, 0.9], ['highshelf', 7000, 3]],
  // (the grand was recorded close to its strings: heard from the hall, its top is softer)
  piano: [['highshelf', 2500, -4], ['highshelf', 7000, -4]],
  // (the sections: their recordings are already heard from a distance, only the warmth is added;
  // the solo instruments' top cut made a whole orchestra sound muffled next to real recordings)
  // (the solo strings recorded close at Iowa: their own colour, full to the top, only a little warmth)
  // (measured against a real quartet recording: a little wood at 900 Hz, the close microphone's edge
  // at 6 kHz softened, the top kept open; the lower instruments their room's depth)
  violin_iowa: [['peaking', 900, 2.5, 0.8], ['peaking', 6000, -5, 1.3], ['highshelf', 9000, 2]],
  viola_iowa: [['lowshelf', 200, 2], ['peaking', 900, 2.5, 0.8], ['peaking', 6000, -5, 1.3], ['highshelf', 9000, 2]],
  cello_iowa: [['lowshelf', 180, 8], ['peaking', 900, 2.5, 0.8], ['peaking', 6000, -5, 1.3], ['highshelf', 9000, 2]],
  sec_violin: [], sec_viola: [['lowshelf', 350, 2]], sec_cello: [['lowshelf', 400, 4], ['peaking', 120, 3, 1]],
};
// The wood's own resonances of each instrument (the main modes of the body and many smaller ones
// above): fixed while the pitch moves, so the vibrato makes the colour shimmer as on the instrument
const BODY_RES = {
  violin: [[280, 3, 8], [460, 3.5, 10], [540, 3, 12], [720, 2, 12], [1050, 2.5, 14], [1450, 2, 16], [2050, 3, 14], [2600, 3, 16], [3300, 2, 18], [4400, 1.5, 18]],
  viola: [[230, 3, 8], [390, 3.5, 10], [470, 3, 12], [640, 2, 12], [910, 2.5, 14], [1250, 2, 16], [1800, 3, 14], [2300, 2.5, 16], [3000, 2, 18]],
  cello: [[100, 3, 7], [175, 3.5, 9], [205, 3, 10], [290, 2, 12], [420, 2.5, 12], [610, 2, 14], [900, 2.5, 14], [1300, 2, 16], [1900, 2.5, 16], [2600, 2, 18]],
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
// (the sections: the recorded string sections; the solo instruments their own, where there is one)
const REAL = { violin: 'vl', viola: 'va', cello: 'vc', bass: 'cb', violins: 'vl', violas: 'va', cellos: 'vc', basses: 'cb' };
// (the winds and brass recorded the same way, held and short, soft and loud: VSCO 2 CE)
const REAL_W = { englishhorn: 'ob', horn: 'hn', trumpet: 'tr', trombone: 'tb', tuba: 'tu', flute: 'fl', oboe: 'ob', clarinet: 'cl', bassoon: 'bn', piccolo: 'pc', timpani: 'tp', harp: 'hp',
  snare: 'ksn', bassdrum: 'kbd', toms: 'kto', cymbals: 'kcr', suspcymbal: 'ksu', triangle: 'ktr', tambourine: 'ktm', bongos: 'kbo' };
// (the violins as a section: the recorded violin section, where it plays; the solo violin above it)
const ENS = { violins: 've' };
export const realSet = (sid, kind = 'sus') => (ENS[sid] && (globalThis.__ens ?? 1) ? ENS[sid] + '_' + kind : REAL[sid] ? REAL[sid] + '_' + kind : REAL_W[sid] && (globalThis.__vscoW ?? 1) ? REAL_W[sid] + '_' + kind : null);
let INDEX = null;
const FALLBACK = { snare: 'drum', bassdrum: 'drum', toms: 'drum', cymbals: 'drum', suspcymbal: 'drum', triangle: 'woodblock', tambourine: 'drum', bongos: 'drum', mandolin: 'steelguitar', ukulele: 'guitar', violins: 'violin', violas: 'viola', cellos: 'cello', basses: 'bass' };
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
  if (sid === 'grand2') {
    if (globalThis.__pianoPure ?? 1) return 1;   // (each note as loud as it was recorded, like the piano itself)
    let r4 = MED.get('grand2:4');
    if (r4 === undefined) { const v = Object.entries(R).filter(([k]) => k.endsWith('_4')).map(([, x]) => x).sort((a, b) => a - b); r4 = v[v.length >> 1] || 1; MED.set('grand2:4', r4); }
    const rm = R[m + '_4'] || r4;
    return Math.max(0.4, Math.min(4, Math.pow(r4 / rm, 0.5)));
  }
  if (sid === 'grand') {
    const rf = R[m + '_f'] || r;
    const k = Math.pow(ref / rf, 0.5) * (rf / r);
    return Math.max(0.4, Math.min(9, k));
  }
  const ringing = DECAYING.has(sid) || rings;
  const k = Math.pow(ref / r, ringing ? 0.5 : 0.9);
  // (a soft recording speaks more slowly: a little more of it, so it is even as the note begins)
  return Math.max(0.4, Math.min(layer === 'p' || /^(hn|tr|tb|tu|fl|ob|cl|bn|pc|tp|hp|k[a-z]{2})_/.test(sid) ? 9 : 3, k * (layer === 'p' ? (globalThis.__pBoost ?? 1.25) : 1)));
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
    // (the concert hall: the room of the reference renders, heard at its own level)
    const ref = this.room === 'hall' && (globalThis.__irRef ?? 1);
    if (this.ctx) { this.verb.normalize = !ref; this.verb.buffer = makeImpulse(this.ctx, ref ? { ...ROOMS.hall, ref: true } : ROOMS[this.room]); this.verb._ref = ref && refReady(this.ctx.sampleRate); }
  }
  setRoomMix(v) { this.roomMix = v; if (this.verbIn) this.verbIn.gain.value = v; }

  async sampleFor(sid, midi, kind = 'sus', vel = 0.7, span = null) {
    const I = await loadIndex();
    // a real recording of this way of playing, at the nearest strength
    // a real solo cello or viola, every note recorded (in place of the section recordings)
    // tuned percussion recorded at several strengths (VCSL): the recording of the strength played
    const PERC = { marimba: 'p_marimba', xylophone: 'p_xylo', glockenspiel: 'p_glock', vibraphone: 'p_vibes', bells: 'p_chimes' };
    const PL = PERC[sid] && I.NL && I.NL[PERC[sid]];
    if (PL && !this.plain && (globalThis.__percReal ?? 0)) {
      const Ls = I.L[PERC[sid]];
      const want = Ls[Math.min(Ls.length - 1, Math.floor(Math.max(0, Math.min(0.999, vel)) * Ls.length))];
      const list = PL[want]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      return this.load(PERC[sid], best, want, 'sus');
    }
    // the solo strings of a quartet or a sonata: every note recorded at three strengths and without
    // vibrato (University of Iowa), the player's vibrato added, continuous from note to note
    const IOWA = { violin: 'iv_sus', viola: 'ia_sus', cello: 'ic_sus' };
    if (kind === 'sus' && IOWA[sid] && I.n[IOWA[sid]] && !this.plain && (globalThis.__iowaS ?? 1)) {
      const set = IOWA[sid], list = I.n[set]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      if (Math.abs(best - midi) <= 3) {
        // (pp below 0.3, mf about 0.52, ff above 0.74: between two, both recordings, the softer giving way)
        const B = [[0.3, 0.48, 'p', 'm'], [0.56, 0.74, 'm', 'f']];
        const v0 = span ? (Math.min(...span) + Math.max(...span)) / 2 : vel;
        const [lo, hi, la, lb] = v0 < 0.52 ? B[0] : B[1];
        const [a, b] = await Promise.all([this.load(set, best, la, 'sus'), this.load(set, best, lb, 'sus')]);
        return Object.assign(Object.create(b), { pair: a, w: Math.max(0, Math.min(1, (vel - lo) / (hi - lo))), xf: !!span, xfr: [lo, hi], iowa: true });
      }
    }
    const SOLO = { cello: (globalThis.__vc3 ?? 0) && I.n.vc_solo3 ? 'vc_solo3' : 'vc_solo', viola: 'va_solo', ...((globalThis.__vlSolo ?? 1) ? { violin: 'vl_solo' } : {}) };
    // (a solo instrument recorded at three strengths: the recording of the strength played, of the
    // nearest note that has it; a far one gives way to the next strength)
    const NL = I.NL && I.NL[SOLO[sid]];
    if (kind === 'sus' && NL && !this.plain && (globalThis.__solo ?? 1)) {
      const want = vel < 0.45 ? 'p' : vel < 0.7 ? 'm' : 'f';
      const order = want === 'p' ? ['p', 'm', 'f'] : want === 'm' ? ['m', 'f', 'p'] : ['f', 'm', 'p'];
      for (const L of order) {
        const list = NL[L] || []; if (!list.length) continue;
        let best = list[0]; for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
        if (Math.abs(best - midi) <= 2 || L === order[order.length - 1]) return this.load(SOLO[sid], best, L, kind);
      }
    }
    if (kind === 'sus' && SOLO[sid] && I.n[SOLO[sid]] && !this.plain && (globalThis.__solo ?? 1)) {
      const list = I.n[SOLO[sid]]; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      // (a soft and a loud recording: the one nearest the dynamic, never the two mixed)
      const Ls = I.L[SOLO[sid]] || ['f'];
      return this.load(SOLO[sid], best, Ls.includes('p') && vel < 0.5 ? 'p' : 'f', kind);
    }
    let set = realSet(sid, kind);
    // (a way of playing not recorded for a wind or the timpani, a short stroke say: its ordinary recording)
    if (set && REAL_W[sid] && !I.n[set] && kind !== 'gen' && I.n[realSet(sid, 'sus')]) { set = realSet(sid, 'sus'); kind = 'sus'; }
    if (set && I.n[set] && I.n[set].length && !this.plain) {
      // (the English horn: the oboe's recordings a fourth higher, played down: the same reed, its
      // darker, lower voice)
      const SHIFT = { englishhorn: 5 }, want = midi + (SHIFT[sid] || 0);
      const list = I.n[set]; let best = list[0];
      for (const m of list) if (Math.abs(m - want) < Math.abs(best - want) || (Math.abs(m - want) === Math.abs(best - want) && m > best)) best = m;
      if (SHIFT[sid] && Math.abs(best - want) > 4) return this.sampleFor(sid, midi, 'gen', vel);
      // (beyond the section's recordings: the solo instrument's, of the same way of playing)
      if (ENS[sid] && set.startsWith(ENS[sid] + '_') && Math.abs(best - midi) > 2 && I.n[REAL[sid] + '_' + kind]) {
        set = REAL[sid] + '_' + kind; const l2 = I.n[set]; best = l2[0];
        for (const m of l2) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      }
      // (a wind recorded only every few notes: far from one, the general recording of that note instead)
      if (REAL_W[sid] && !SHIFT[sid] && !/^k/.test(REAL_W[sid]) && Math.abs(best - midi) > (sid === 'timpani' ? 7 : 4)) return this.sampleFor(sid, midi, 'gen', vel);   // (a timpani is tuned: any of its drums can be set a few notes away)
      const L = (I.L && I.L[set]) || ['f'];
      // (a short note repeated: the two recorded takes in turn, as a player's two strokes are never alike)
      let take = 1;
      if (I.RR && (I.RR[set] || []).includes(best) && (globalThis.__rr ?? 1)) {
        const rk = set + ':' + best; this.rrc = this.rrc || new Map();
        take = (this.rrc.get(rk) || 0) % 2 + 1; this.rrc.set(rk, take);
        for (const L2 of L) this.load(set, best, L2, kind, 3 - take).catch(() => null);
      }
      // a section is many players, each a little apart in time and tune: the neighbouring recording
      // of the same section (other players, other bows, another vibrato) sounds with it, softer, a
      // moment later; the section grows from a few desks to a full one and its sound evens out
      let alt = null;
      if (/^(violins|violas|cellos|basses)$/.test(sid) && (kind === 'sus' || kind === 'trem') && (globalThis.__ens2 ?? 1) && !this.plain) {
        let am = null; for (const m of list) if (m !== best && Math.abs(m - midi) <= 4 && (am === null || Math.abs(m - midi) < Math.abs(am - midi))) am = m;
        if (am !== null) alt = this.load(set, am, L.includes('p') && vel < 0.52 ? 'p' : L.includes('f') ? 'f' : L[0], kind).catch(() => null);
      }
      const altS = alt ? await alt : null;
      const withAlt = (x) => (altS && x ? Object.assign(Object.create(x), { alt: altS }) : x);
      // between mp and mf both recordings sound together, the soft one giving way to the loud one
      // little by little (no sudden change of colour)
      // (a note that grows or fades across the two: both recordings, the soft giving way to the loud
      // as it grows, the colour changing within the note as a player's does)
      if (L.includes('p') && L.includes('f') && span && (globalThis.__xfEnv ?? 1) && Math.min(...span) < XF[1] && Math.max(...span) > XF[0] && Math.max(...span) - Math.min(...span) > 0.08) {
        const [a, b] = await Promise.all([this.load(set, best, 'p', kind, take), this.load(set, best, 'f', kind, take)]);
        return withAlt(Object.assign(Object.create(b), { pair: a, w: Math.max(0, Math.min(1, (vel - XF[0]) / (XF[1] - XF[0]))), xf: true }));
      }
      if (L.includes('p') && L.includes('f') && vel > XF[0] && vel < XF[1]) {
        const [a, b] = await Promise.all([this.load(set, best, 'p', kind, take), this.load(set, best, 'f', kind, take)]);
        const w = (vel - XF[0]) / (XF[1] - XF[0]);
        return withAlt(Object.assign(Object.create(b), { pair: a, w }));
      }
      const layer = L.includes('p') && vel < 0.52 ? 'p' : L.includes('f') ? 'f' : L[0];
      return withAlt(await this.load(set, best, layer, kind, take));
    }
    // the grand piano: a real concert grand recorded at three strengths, blended by the dynamic
    // (the concert grand: six strengths, each blended into the next as the dynamic grows)
    if (sid === 'piano' && I.n.grand2 && I.LV && I.LV.grand2 && !this.plain && (globalThis.__grand ?? 1) && (globalThis.__grand2 ?? 1)) {
      const list = I.n.grand2; let best = list[0];
      for (const m of list) if (Math.abs(m - midi) < Math.abs(best - midi) || (Math.abs(m - midi) === Math.abs(best - midi) && m > best)) best = m;
      const L = I.L.grand2, C = I.LV.grand2;
      if (vel <= C[0]) return Object.assign(Object.create(await this.load('grand2', best, L[0], 'sus')), { under: vel / C[0] });
      if (vel >= C[C.length - 1]) return this.load('grand2', best, L[L.length - 1], 'sus');
      let i = 0; while (i < C.length - 2 && vel > C[i + 1]) i++;
      const w = (vel - C[i]) / (C[i + 1] - C[i]);
      if (w < 0.08) return this.load('grand2', best, L[i], 'sus');
      if (w > 0.92) return this.load('grand2', best, L[i + 1], 'sus');
      const [a, b] = await Promise.all([this.load('grand2', best, L[i], 'sus'), this.load('grand2', best, L[i + 1], 'sus')]);
      return Object.assign(Object.create(b), { pair: a, w });
    }
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
  load(sid, m, layer = null, kind = null, take = 1) {
    const key = sid + ':' + m + (layer ? ':' + layer : '') + (take > 1 ? ':r' + take : '');
    // (the concert grand's recordings are long and in stereo: kept within a limit, the ones not used
    // for longest let go first, never one used in the last half minute)
    if (sid === 'grand2') {
      const lru = this.lru || (this.lru = new Map());
      const now = Date.now(); const e = lru.get(key); if (e) e.t = now; else lru.set(key, { t: now, bytes: 0 });
      let total = 0; for (const v of lru.values()) total += v.bytes;
      const LIMIT = (globalThis.__grandMB ?? (document.body && document.body.classList.contains('phone') ? 90 : 180)) * 1e6;
      if (total > LIMIT) for (const [k, v] of [...lru.entries()].sort((a, b) => a[1].t - b[1].t)) {
        if (total <= LIMIT * 0.8 || now - v.t < 30000 || k === key) continue;
        this.buffers.delete(k); lru.delete(k); total -= v.bytes;
      }
    }
    if (!this.buffers.has(key)) {
      const ctx = getCtx();
      const rings = kind === 'pizz' || kind === 'spic';
      const p = fetch(new URL(`../vendor/sounds/${sid}/${m}${layer ? '_' + layer : ''}${take > 1 ? '_r' + take : ''}.mp3`, import.meta.url))
        .then((r) => { if (!r.ok) throw new Error('missing sample'); return r.arrayBuffer(); })
        .then((ab) => new Promise((res, rej) => { const q = ctx.decodeAudioData(ab, res, rej); if (q && q.then) q.then(res, rej); }))
        .then(async (buf) => ({ buf, midi: m, gain: (((await loadIndex()).g || {})[sid] || 4) * evenGain(await loadIndex(), sid, m, layer, rings), loop: DECAYING.has(sid) || rings || /^p_/.test(sid) ? null : makeLoop(buf, m), kind, real: !!kind && !!layer, layer, set: sid, oneLayer: /_solo$/.test(sid) && sid !== 'vl_solo' && sid !== 'vc_solo3', tc: ((((await loadIndex()).T || {})[sid] || {})[m + (layer ? '_' + layer : '')] ?? (((await loadIndex()).T || {})[sid] || {})[m]) || 0, ownVib: /^w_(flute|oboe|trumpet|bassoon)$/.test(sid), atk: (((await loadIndex()).A || {})[sid] || {})[m + (layer ? '_' + layer : '')] || null, pc: (((await loadIndex()).PC || {})[sid] || {})[m + (layer ? '_' + layer : '')] || null, pcT: (await loadIndex()).PCT || null, atkT: (await loadIndex()).AT || null }));
      p.catch(() => this.buffers.delete(key));
      if (sid === 'grand2') p.then((x) => { const e = this.lru && this.lru.get(key); if (e && x && x.buf) e.bytes = x.buf.length * x.buf.numberOfChannels * 4; }, () => {});
      this.buffers.set(key, p);
    }
    return this.buffers.get(key);
  }
  // Load every sample a list of notes needs, before playing starts.
  async prepare(list) {
    // (the concert hall's room, for playing here and for a file made at 48 kHz)
    if (globalThis.__irRef ?? 1) {
      const rates = new Set([getCtx().sampleRate, 48000, 44100].filter(Boolean));
      const got = await Promise.all([...rates].map((r) => loadRefIR(r)));
      if (got.some(Boolean) && this.ctx && this.room === 'hall' && this.verb && !this.verb._ref) { this.setRoom(this.room); }
    }
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
      const SEC = { violins: 'violin', violas: 'viola', cellos: 'cello', basses: 'bass' };
      const iowaOn = /^(violin|viola|cello)$/.test(sid) && !this.plain && (globalThis.__iowaS ?? 1);
      const bk = iowaOn ? sid + '_iowa' : SEC[sid] ? ((globalThis.__hiFix ?? 1) ? 'sec_' : '') + SEC[sid] : sid === 'cello' && !this.plain && (globalThis.__solo ?? 1) && (globalThis.__vc3 ?? 0) ? 'cello_solo3' : (sid === 'cello' || sid === 'viola') && !this.plain && (globalThis.__solo ?? 1) ? sid + '_solo' : sid;
      const pureBody = sid === 'piano' && (globalThis.__pianoPure ?? 1) && !this.plain;
      for (const [type, f, gdb, q] of (pureBody && !globalThis.__bodyEq ? [] : ((globalThis.__bodyEq || BODY)[bk] || []))) {
        const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gdb; if (q) b.Q.value = q;
        node.connect(b); node = b; ch.body.push(b);
      }
      // the wood's own resonances, fixed in place while the pitch moves: with the vibrato each harmonic
      // passes across them and the colour shimmers band by band, as a real instrument's does (a
      // recording played faster or slower carries its resonances along with it, and stays flat)
      const RES = (globalThis.__res || ((globalThis.__iowaS ?? 1) && (globalThis.__resOn ?? 1) ? BODY_RES : {}))[sid];
      // the other strings ringing along (sympathetic resonance): the open strings and their first
      // harmonics answer whenever a note shares them, a faint glow around the tone that a sample
      // played alone lacks
      const OPEN = { violin: [55, 62, 69, 76], viola: [48, 55, 62, 69], cello: [36, 43, 50, 57] }[sid];
      if (OPEN && iowaOn && (globalThis.__symp ?? 0)) {
        const sym = ctx.createGain(); sym.gain.value = (globalThis.__symp ?? 1) * 0.5;
        for (const m of OPEN) for (const h of [1, 2, 3]) {
          const f = 440 * Math.pow(2, (m - 69) / 12) * h; if (f > 5000) continue;
          const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 140 / Math.sqrt(h);
          node.connect(b).connect(sym); ch.body.push(b);
        }
        ch.sym = sym;
      }
      if (RES && !this.plain) for (const [f, gdb, q] of RES) { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.gain.value = gdb; b.Q.value = q; node.connect(b); node = b; ch.body.push(b); }
      // (the orchestra's recordings, made close and soft at the top: the air a hall recording keeps)
      const air = (globalThis.__hiFix ?? 1) && !this.plain && (/^(violins|violas|cellos|basses)$/.test(sid) || REAL_W[sid]) ? (globalThis.__air ?? 3) : 0;
      if (air) { const b = ctx.createBiquadFilter(); b.type = 'highshelf'; b.frequency.value = 6000; b.gain.value = air; node.connect(b); node = b; ch.body.push(b); }
      node.connect(ch.low).connect(ch.high).connect(ch.bright).connect(ch.gain).connect(ch.pan).connect(this.out);
      if (ch.sym) ch.sym.connect(ch.low);
      // the orchestra as a pair of microphones above the stage hears it: a player to the right reaches
      // the right microphone a moment sooner and a little louder (not only louder, as a pan control
      // makes it), which is what gives a real orchestra recording its open, wide sound
      if ((globalThis.__stage ?? 1) && !this.plain && ctx.createChannelMerger && (/^(violins|violas|cellos|basses|strings|choir|oohs|brass|timpani|harp|englishhorn|organ)$/.test(sid) || REAL_W[sid] || ((globalThis.__stageSolo ?? 0) && /^(violin|viola|cello|bass)$/.test(sid)))) {
        ch.stage = true;
        ch.gL = ctx.createGain(); ch.gR = ctx.createGain(); ch.dL = ctx.createDelay(0.01); ch.dR = ctx.createDelay(0.01);
        ch.merge = ctx.createChannelMerger(2);
        ch.gain.connect(ch.dL).connect(ch.gL).connect(ch.merge, 0, 0);
        ch.gain.connect(ch.dR).connect(ch.gR).connect(ch.merge, 0, 1);
        ch.gain.disconnect(ch.pan); ch.merge.connect(this.out);
      }
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
    // (the concert grand: its recordings are heard as they are, the brightness control only takes away)
    // (the instruments recorded for real: heard as recorded, the brightness control only takes away)
    const pureCh = ((globalThis.__openAll ?? 0) || ((globalThis.__hiFix ?? 1) && (/^(violins|violas|cellos|basses)$/.test(ch.sid) || REAL_W[ch.sid])) || (((globalThis.__soloOpen ?? 0) || (globalThis.__iowaS ?? 1)) && /^(violin|viola|cello|bass)$/.test(ch.sid))) && !this.plain || ((ch.sid === 'piano' && (globalThis.__pianoPure ?? 1)) || (['marimba', 'xylophone', 'glockenspiel', 'vibraphone', 'bells', 'timpani'].includes(ch.sid) && (globalThis.__percReal ?? 0))) && !this.plain;
    ch.bright.frequency.setTargetAtTime(pureCh ? Math.min(22000, 1500 * Math.pow(14, Math.min(1, mix.bright + 0.5))) : 1500 * Math.pow(14, mix.bright), t, 0.02);
    const pn = mix.pan ?? DEFAULT_PAN[ch.sid] ?? 0;
    if (ch.stage) {
      // (time: up to about a millisecond and a half between the two; level: a gentler law than a pan's)
      const T = (globalThis.__stageMs ?? 1.2) / 1000, k = globalThis.__stageLvl ?? 0.6;
      ch.dL.delayTime.setTargetAtTime(Math.max(0, pn) * T, t, 0.02); ch.dR.delayTime.setTargetAtTime(Math.max(0, -pn) * T, t, 0.02);
      const q = (Math.max(-1, Math.min(1, pn * k)) + 1) * Math.PI / 4;
      ch.gL.gain.setTargetAtTime(Math.cos(q), t, 0.02); ch.gR.gain.setTargetAtTime(Math.sin(q), t, 0.02);
    } else if (ch.pan.pan) ch.pan.pan.setTargetAtTime(pn, t, 0.02);
    ch.send.gain.setTargetAtTime(this.room === 'hall' && (globalThis.__irRef ?? 1) ? mix.reverb * (0.55 / 0.35) * (globalThis.__refWet ?? 1) : mix.reverb * 0.9, t, 0.02);
  }

  // Play one note. vel 0..1 (soft..loud), dur seconds, t start time. Returns the voice.
  // opts: { art: 'stacc'|'ten'|'acc'|'marc'|'legato', env: [[time, level]] (for hairpins) }
  noteOn(ch, sample, midi, t, dur, vel = 0.7, opts = {}) {
    if (!sample) return null;
    // The concert grand plays as a sampler of a real piano should: the one recording of the
    // strength played (never two mixed, which blurs the sound), in tune, at its own level plus the
    // key's force, the damper falling as on the instrument (the method of the reference renders)
    const pure = sample.set === 'grand2' && (globalThis.__pianoPure ?? 1);
    if (pure && sample.pair) sample = sample.w < 0.5 ? sample.pair : Object.assign(Object.create(sample), { pair: null });
    // two recordings blended (soft and loud): each played, their levels sharing the note (equal power)
    if (sample.pair && sample.xf && opts.env && opts.env.length && !opts.blend) {
      // (each recording's share follows the dynamic through the note)
      const R2 = sample.xfr || XF, hu = (Math.random() - 0.5) * 4, W = (v) => Math.max(0, Math.min(1, (v - R2[0]) / (R2[1] - R2[0]))) * Math.PI / 2;
      const ca = Math.max(0.03, Math.cos(W(vel))), cb = Math.max(0.03, Math.sin(W(vel)));
      this.noteOn(ch, sample.pair, midi, t, dur, vel, { ...opts, blend: ca, human: hu, env: opts.env.map(([et, ev]) => [et, ev * Math.max(0.03, Math.cos(W(vel * ev))) / ca]) });
      opts = { ...opts, blend: cb, human: hu, env: opts.env.map(([et, ev]) => [et, ev * Math.max(0.03, Math.sin(W(vel * ev))) / cb]) };
    } else if (sample.pair && !opts.blend) {
      const hu = (Math.random() - 0.5) * 4;   // (the two in tune with each other)
      this.noteOn(ch, sample.pair, midi, t, dur, vel, { ...opts, blend: Math.cos(sample.w * Math.PI / 2), human: hu });
      opts = { ...opts, blend: Math.sin(sample.w * Math.PI / 2), human: hu };
    }
    // (a drum or cymbal without a pitch sounds as recorded, whatever note it is written on; toms are tuned)
    if (/^k(sn|bd|cr|su|tr|tm|bo)_/.test(sample.set || '')) midi = sample.midi;
    const ctx = this.ctx, sid = ch.sid, mix = ch.mix || DEFAULT_MIX();
    const src = ctx.createBufferSource(); src.buffer = sample.buf;
    // no two notes quite the same: a touch of pitch and level variation, as with a real player
    const human = pure ? 0 : (opts.human ?? (Math.random() - 0.5) * 4) + (opts.tune || 0);
    const cents = (midi - sample.midi) * 100 + 1200 * Math.log2(this.tuning / 440) + human + (sample.tc || 0);
    src.playbackRate.value = Math.pow(2, cents / 1200);
    // (a real recording played short, or plucked: it rings as recorded)
    const decaying = DECAYING.has(sid) || sample.kind === 'pizz' || sample.kind === 'spic';
    const real = !!sample.real;
    if (!decaying && sample.loop) { src.loop = true; src.loopStart = sample.loop.start; src.loopEnd = sample.loop.end; }
    // softer notes are darker as well as quieter, like a real instrument
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = globalThis.__toneQ ?? 0.3;
    if (sample.real && (globalThis.__hiFix ?? 1) && globalThis.__toneQ === undefined && (/^(violins|violas|cellos|basses)$/.test(ch.sid) || REAL_W[ch.sid])) tone.Q.value = 0.5;
    // (a real soft or loud recording already has its own colour: only a little more shaping)
    // (the grand piano's three recordings already have the colour of each strength)
    const ownColour = sample.set === 'grand' || sample.set === 'grand2';
    // (one loud recording only: softer is also darker, as with the general sounds, a little less so)
    tone.frequency.value = ownColour ? 20000 : sample.oneLayer ? 1400 + Math.pow(vel, 1.6) * 16000 : real ? (globalThis.__toneLo ?? ((globalThis.__hiFix ?? 1) && (/^(violins|violas|cellos|basses)$/.test(sid) || REAL_W[sid] || /^i[vac]_sus$/.test(sample.set || '')) ? 6000 : 3000)) + Math.pow(vel, 1.4) * 17000 : (globalThis.__toneSyn ? globalThis.__toneSyn[0] + Math.pow(vel, globalThis.__toneSyn[2]) * globalThis.__toneSyn[1] : 900 + Math.pow(vel, 1.7) * 17000);
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
    if (pure) src.connect(g).connect(ch.input);
    else if (cg) src.connect(tone).connect(cg).connect(g).connect(ch.input); else src.connect(tone).connect(g).connect(ch.input);
    // (real recordings, now all as loud as each other: the dynamic gives the whole range, from a
    // true pp to ff, in even steps of about 3.5 dB from one dynamic to the next)
    // (the concert grand: its recordings are already as loud as the strength they were played at;
    // softer than its softest recording, it is turned down)
    const natural = sample.set === 'grand2';
    // (recordings at several strengths keep their own loudness: the dynamic adds less on top)
    const layered3 = sample.set === 'vc_solo3' || /^p_/.test(sample.set || '');
    // (the orchestra's range from pp to ff, as wide as a real one's; the solo instruments keep theirs,
    // set against the piano)
    // (about mf every instrument is as loud as before; from there to pp and ff the range is a real
    // player's, the orchestra's and the soloists' alike: the old one was half of it)
    const dynR = !(globalThis.__hiFix ?? 1) ? 26 : (/^(violins|violas|cellos|basses)$/.test(sid) || REAL_W[sid]) ? (globalThis.__dynR ?? 34) : /^(violin|viola|cello|bass)$/.test(sid) ? (globalThis.__dynRs ?? 26) : 26;
    let level = layered3 ? Math.pow(10, (-(globalThis.__l3Range ?? 8) + (globalThis.__l3Range ?? 8) * Math.max(0, Math.min(1.1, vel))) / 20) * (sample.gain || 4) * 0.55 * (0.97 + Math.random() * 0.06) : pure ? Math.pow(Math.max(0.02, Math.min(1, vel)), globalThis.__g2vt ?? 1.46) * (sample.gain || 4) * 0.9 : (natural ? Math.pow(Math.min(1, sample.under ?? 1), 1.6) * Math.pow(Math.max(0.05, Math.min(1, vel)), globalThis.__g2vt ?? 0) : sample.real ? Math.pow(10, (-11.7 + dynR * (Math.max(0, Math.min(1.1, vel)) - 0.55)) / 20) : 0.12 + Math.pow(vel, 1.5) * 0.88) * (sample.gain || 4) * 0.55 * (0.97 + Math.random() * 0.06) * (opts.blend ?? 1) * (sample.alt && !opts.ens ? (globalThis.__ensMain ?? 0.79) : 1);
    if ((opts.art === 'acc' || opts.art === 'marc') && !pure) level = Math.min(1.15, level * 1.3);
    // a connected (slurred) note starts past the sample's attack and fades in: no new bow or tongue
    const connect = !!opts.connect && !decaying;
    // long notes start gently and grow (a bow settling, a breath filling); short ones speak at once
    const accented = opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'stacc' || opts.art === 'stacciss';
    const shape = !decaying && !accented && !connect;
    const lenAtk = shape ? (dur > 1.2 ? 0.075 : dur > 0.6 ? 0.045 : dur > 0.25 ? 0.02 : 0.006) * (1.15 - vel * 0.5) * (real ? (globalThis.__lenAtkF ?? 0.4) : 1) : 0;
    const iowaS = /^i[vac]_sus$/.test(sample.set || '');
    let atk = pure ? 0.0015 : Math.max(bowed && !connect ? 0.018 : 0.004, mix.attack * 0.25 + (opts.art === 'legato' ? 0.03 : 0) + (connect ? 0.045 : 0) + lenAtk);
    // (a string player's start: the bow takes the string, never a scrape louder than the note; slurred,
    // the new note grows out of the old one)
    if (iowaS) atk = connect ? (globalThis.__legAtk ?? 0.07) : accented ? 0.018 : Math.min(0.09, (globalThis.__bowAtk ?? 0.035) + (dur > 1 ? 0.025 : 0));
    let hold = dur;
    if (opts.art === 'stacc') hold = Math.min(dur, Math.max(0.07, dur * 0.42));
    else if (opts.art === 'stacciss') hold = Math.min(dur, Math.max(0.05, dur * 0.25));
    else if (opts.art === 'ten' || opts.art === 'legato') hold = dur * 1.02;
    else hold = pure ? Math.max(0.03, dur) : Math.max(0.05, dur * (BOWED.has(sid) || BLOWN.has(sid) ? (globalThis.__holdF ?? 1) : 0.94));
    // a sharp, bright edge for accents
    let offset = 0;
    if ((opts.art === 'stacc' || opts.art === 'acc' || opts.art === 'marc') && !decaying && !bowed) offset = 0.02;
    if (connect) offset = Math.min(0.09, (sample.buf.duration || 1) * 0.1);
    offset = Math.max(offset, skip);
    if (iowaS) offset = Math.max(offset, connect ? (globalThis.__legSkip ?? 0.12) : accented ? 0 : 0.015);
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
      // a string player's vibrato (measured on recordings: about ±15-25 cents, 5-6 a second): wider
      // than the old one, never quite even (its width drifts slowly), and the tone swells a little with
      // each swing (the body's resonances), not a pitch wobble on its own
      if (BOWED.has(sid) && (globalThis.__vib2 ?? 0)) {
        const amt2 = src.playbackRate.value * (Math.pow(2, (opts.vib * (globalThis.__vibWide ?? 1.6) * (0.7 + vel * 0.6)) / 1200) - 1);
        lfo.frequency.value = 5.0 + vel * 0.8 + Math.random() * 0.6;
        depth.gain.cancelScheduledValues(t); depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(0, t + Math.min(0.3, dur * 0.25)); depth.gain.linearRampToValueAtTime(amt2, t + Math.min(0.8, dur * 0.6));
        const drift = ctx.createOscillator(); drift.frequency.value = 0.35 + Math.random() * 0.4;
        const dd = ctx.createGain(); dd.gain.value = amt2 * 0.28;
        drift.connect(dd).connect(depth.gain); drift.start(t); drift.stop(t + dur + 1.5);
        const am = ctx.createGain(); am.gain.value = 0;
        am.gain.setValueAtTime(0, t); am.gain.linearRampToValueAtTime(0, t + Math.min(0.3, dur * 0.25)); am.gain.linearRampToValueAtTime(level * (globalThis.__vibAm ?? 0.07), t + Math.min(0.8, dur * 0.6));
        lfo.connect(am).connect(g.gain);
      }
    }
    // the player's vibrato: one, continuous from note to note (each instrument its own), never even:
    // its speed and width wander a little all the time; it opens as the note settles and narrows a
    // touch, unevenly, as the next one comes
    let vibG = null;
    if (iowaS && (globalThis.__cvib ?? 1) && !decaying) {
      // A player's vibrato is part of the phrasing, never the same twice (measured on string players:
      // 5-7 a second, about a quarter of a semitone wide; wider on louder, higher, longer and more
      // expressive notes, narrower at the end of a phrase; it comes in after the bow has taken the
      // string, grows with the note's swell, speeds up a little as the note ends):
      // each note gets its own width and speed, around the instrument's own.
      const V = this.vibFor(ch);
      const R = Math.random;
      const v3 = globalThis.__vib3 ?? 0;
      const base = (v3 ? { violin: 12.5, viola: 12, cello: 11.5 } : { violin: 11, viola: 10.5, cello: 10 })[sid] || 11;
      const centre = { violin: 76, viola: 64, cello: 52 }[sid] || 64;
      const charge = Math.max(-0.15, Math.min(0.2, (midi - centre) * 0.012));
      const lenF = dur < 0.18 ? 0.25 : dur < 0.3 ? 0.55 : dur < 0.6 ? 0.85 : dur < 1.2 ? 1 : 1.1;
      const own = 0.82 + R() * 0.4;   // (this note's own)
      // (and the phrase: it opens towards the phrase's height and settles at its end, the way a
      // player sings a line; now and then a note starts almost plain and blooms)
      const arc = v3 && opts.phr !== undefined ? 0.85 + 0.35 * Math.sin(Math.PI * Math.min(1, Math.max(0, opts.phr))) : 1;
      const cents = base * (globalThis.__vibDepth ?? 1) * (0.55 + Math.min(1, vel) * 0.6) * lenF * own * (1 + charge) * arc * (opts.phraseEnd ? 0.8 : 1);
      const bloom = v3 && !connect && dur > 0.9 && R() < 0.3;
      const k = src.playbackRate.value * (Math.pow(2, cents / 1200) - 1);
      vibG = ctx.createGain(); vibG.gain.value = 0;
      // (it opens as the note settles: slurred, it carries on from the note before)
      const delay = connect ? 0 : (bloom ? 0.18 + R() * 0.15 : 0.05 + R() * 0.1), grow = Math.min(dur * 0.6, (connect ? 0.12 : 0.22) + R() * 0.25 + (dur > 1.5 ? 0.2 : 0) + (bloom ? 0.25 : 0));
      vibG.gain.setValueAtTime(k * (connect ? 0.75 + R() * 0.15 : 0.12 + R() * 0.15), t);
      if (delay) vibG.gain.setValueAtTime(k * 0.2, t + delay);
      vibG.gain.linearRampToValueAtTime(k * (0.9 + R() * 0.1), t + delay + Math.max(0.06, grow));
      // (with the swell of a long note it warms and widens; it eases again, unevenly, as the note ends)
      if (opts.env && opts.env.length) for (const [et, ev] of opts.env) if (et > t + delay + grow && et < t + dur) vibG.gain.linearRampToValueAtTime(k * Math.max(0.6, Math.min(1.3, 0.75 + (ev - 0.85) * 1.5)), et);
      if (dur > 0.45) { const tail = Math.min(0.3, dur * 0.25); vibG.gain.linearRampToValueAtTime(k * (0.9 + R() * 0.15), t + dur - tail); vibG.gain.linearRampToValueAtTime(k * (connect || opts.legato ? 0.7 + R() * 0.2 : 0.5 + R() * 0.3), t + dur); }
      V.connect(vibG).connect(src.playbackRate);
      // its speed: this note's own, a touch faster towards the end of a long note
      if (V.playbackRate && dur > 0.25) {
        const sp = (0.93 + R() * 0.12) * (1 + Math.min(0.06, Math.max(-0.04, vel - 0.55) * 0.12));
        V.playbackRate.setTargetAtTime(sp, t, 0.08);
        if (dur > 0.9) V.playbackRate.setTargetAtTime(sp * (1.05 + R() * 0.06), t + dur * 0.7, 0.15);
      }
      // a fresh bow: the pitch settles from a hair below as the string takes it (only a few cents)
      if (!connect && dur > 0.15 && !(globalThis.__noScoop)) {
        const r0 = src.playbackRate.value, c0 = -(4 + R() * 8) * (accented ? 0.5 : 1);
        src.playbackRate.setValueAtTime(r0 * Math.pow(2, c0 / 1200), t);
        src.playbackRate.setTargetAtTime(r0, t + 0.01, 0.03 + R() * 0.03);
      }
    }
    // the bow hair biting the string at a fresh stroke: rosin and wood, short and well under the note
    if (iowaS && !connect && !decaying && this.noise && (globalThis.__bowNoise ?? 1)) {
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400 + midi * 14 + Math.random() * 400; bp.Q.value = 0.55;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
      const ng = ctx.createGain();
      const nl = level * (globalThis.__bowNoise ?? 1) * 0.028 * (accented ? 1.6 : 1) * (0.5 + Math.min(1, vel) * 0.7) * (0.8 + Math.random() * 0.4);
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(nl, t + 0.006 + Math.random() * 0.006);
      ng.gain.setTargetAtTime(nl * 0.25, t + 0.02, 0.02); ng.gain.setTargetAtTime(0, t + 0.06, 0.03);
      n.connect(bp).connect(lp).connect(ng).connect(ch.input);
      n.start(t, Math.random() * 0.5); n.stop(t + 0.25);
      n.onended = () => { try { ng.disconnect(); } catch {} };
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
    // (a wind player lipping up into the note, recorded: heard in tune from its first moment, as a
    // player in a section plays it, with a little of the movement left)
    if (sample.pc && sample.pcT && /_sus$/.test(sample.set || '') && !(connect && opts.from !== undefined) && opts.glissTo === undefined && (globalThis.__pcFix ?? 1)) {
      const r0 = src.playbackRate.value, P = sample.pcT, C = sample.pc, keep = globalThis.__pcKeep ?? 0.15;
      let first = true;
      for (let i = 0; i < P.length; i++) {
        if (P[i] < offset) continue;
        const c = i === 0 ? C[1] : C[i];
        const at = t + (P[i] - offset) / r0, rate = r0 * Math.pow(2, -(Math.abs(c) < 12 ? 0 : c) * (1 - keep) / 1200);
        if (first) { src.playbackRate.setValueAtTime(rate, t); first = false; } else src.playbackRate.linearRampToValueAtTime(rate, at);
      }
      if (!first) src.playbackRate.linearRampToValueAtTime(r0, t + (P[P.length - 1] - offset) / r0 + 0.1);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * (shape && dur > 0.6 && !pure ? 0.86 : 1), t + atk);
    if (shape && dur > 0.6 && !pure && !(opts.env && opts.env.length)) g.gain.linearRampToValueAtTime(level, t + atk + Math.min(0.35, dur * 0.3));
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
        if (!ownColour) tone.frequency.linearRampToValueAtTime(Math.min(20000, iowaS ? 6000 + Math.pow(Math.min(1, vel * ev), 1.4) * 17000 : (900 + Math.pow(Math.min(1, vel * ev), 1.7) * 17000)), et);
      }
    }
    if ((opts.art === 'acc' || opts.art === 'marc' || opts.art === 'sfz' || opts.art === 'fp') && !decaying && !pure && hold > 0.25) {
      g.gain.setTargetAtTime(level * (opts.art === 'fp' ? 0.35 : 0.62), t + 0.08, 0.06);
    }
    const rel = (RELEASE[sid] ?? 0.2) * (mix.release ?? 1);
    const end = t + hold;
    if (pure) {
      // the damper: about a quarter of a second in the middle, a little longer in the bass; the top
      // strings have no damper and ring on
      const tc = midi >= 89 ? 5 : midi > 60 ? 0.22 : 0.32;
      g.gain.setValueAtTime(level, end);
      g.gain.setTargetAtTime(0, end, tc);
      const stopAt = end + Math.min(tc * 5, 6);
      src.start(t, offset); src.stop(Math.min(stopAt, t + (sample.buf.duration - offset) / Math.max(0.01, src.playbackRate.value) + 0.01));
      const v = { src, g, end: stopAt };
      this.voices.add(v);
      src.onended = () => { this.voices.delete(v); try { g.disconnect(); tone.disconnect(); if (cg) cg.disconnect(); } catch {} };
      return v;
    }
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
    // (the section's other players: the neighbouring recording, softer, a little later and apart in tune)
    if (sample.alt && !opts.ens) {
      const k = globalThis.__ensMix ?? 0.62;
      this.noteOn(ch, sample.alt, midi, t + 0.012 + Math.random() * 0.016, dur, vel, { ...opts, ens: true, blend: k, tune: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4) });
    }
    // a section is many players: a second, slightly later and slightly out of tune, widens it
    if (SECTION.has(sid) && !opts.tune && !opts.single) this.noteOn(ch, sample, midi, t + 0.012 + Math.random() * 0.01, dur, vel * 0.8, { ...opts, tune: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4), single: true });
    const v = { src, g, end: end + rel * 3 };
    this.voices.add(v);
    src.onended = () => { this.voices.delete(v); try { g.disconnect(); tone.disconnect(); if (cg) cg.disconnect(); if (vibG) vibG.disconnect(); } catch {} };
    return v;
  }
  // A channel's vibrato: a slow wave of 5-6 a second whose speed and width wander (a smooth random walk,
  // as a player's), 37 s long before it repeats, each instrument starting at its own place.
  vibFor(ch) {
    const ctx = this.ctx;
    if (ch.vib && ch.vibCtx === ctx) return ch.vib;
    const sr = 3000, secs = 37, n = sr * secs, buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const rate0 = { violin: 5.8, viola: 5.5, cello: 5.3 }[ch.sid] || 5.5;
    let rw = 0, dw = 0, rv = 0, dv = 0, ph = 0;
    const rs = []; for (let i = 0; i < n; i++) { rv += (Math.random() - 0.5) * 0.004; rv *= 0.9995; rw = rw * 0.999 + rv; rs.push(rw); }
    let mx = 1e-9; for (const x of rs) mx = Math.max(mx, Math.abs(x));
    const rate = rs.map((x) => rate0 + 0.45 * x / mx);
    // (whole cycles, so the loop is seamless)
    let tot = 0; for (const r of rate) tot += r / sr; const kf = Math.round(tot) / tot;
    for (let i = 0; i < n; i++) {
      dv += (Math.random() - 0.5) * 0.004; dv *= 0.9995; dw = dw * 0.9993 + dv;
      ph += 2 * Math.PI * rate[i] * kf / sr;
      d[i] = Math.sin(ph) * (1 + Math.max(-0.35, Math.min(0.35, dw * 0.35)));
    }
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(ctx.currentTime, Math.random() * secs);
    ch.vib = s; ch.vibCtx = ctx;
    return s;
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
