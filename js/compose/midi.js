// Standard MIDI file (type 1) of a score: one track for each instrument, played as Stand plays it
// (repeats, endings, D.C., dynamics, articulations, ornaments written out, rit. and accel.).
// The time is kept exactly by counting in seconds: one quarter note of the file is one second
// (60 beats a minute), so every slowing and speeding comes out as it sounds.
import { buildTimeline } from './playback.js';

// the General MIDI program for each of Stand's sounds
const PROGRAM = {
  piano: 0, epiano: 4, harpsichord: 6, celesta: 8, organ: 19, accordion: 21,
  guitar: 24, steelguitar: 25, eguitar: 27, ebass: 33, jazzbass: 32, banjo: 105,
  violin: 40, viola: 41, cello: 42, bass: 43, tremolo: 44, pizz: 45, harp: 46, timpani: 47, strings: 48,
  choir: 52, oohs: 53, trumpet: 56, trombone: 57, tuba: 58, horn: 60, brass: 61,
  sopsax: 64, altosax: 65, tenorsax: 66, barisax: 67, oboe: 68, englishhorn: 69, bassoon: 70, clarinet: 71,
  piccolo: 72, flute: 73, recorder: 74,
  glockenspiel: 9, vibraphone: 11, marimba: 12, xylophone: 13, bells: 14, woodblock: 115, drum: 118,
};
const PPQ = 480;
const vlq = (n) => { n = Math.max(0, Math.round(n)); const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const str = (s) => [...new TextEncoder().encode(s)];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];
function chunk(type, data) { return [...str(type), ...u32(data.length), ...data]; }
function track(events) {
  // events: [tick, order, bytes]; note-offs before note-ons at the same moment
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const data = []; let last = 0;
  for (const [t, , bytes] of events) { data.push(...vlq(t - last), ...bytes); last = t; }
  data.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', data);
}

export function toMidi(score) {
  const tl = buildTimeline(score, { humanize: false });
  const tick = (sec) => Math.round(sec * PPQ);
  const tracks = [];
  // the first track: the name, the time (60 beats a minute: a beat is a second) and the first metre
  const t0 = (score.measures[0] && score.measures[0].time) || [4, 4];
  const meta = [
    [0, 0, [0xff, 0x03, ...vlq(str(score.title || 'Score').length), ...str(score.title || 'Score')]],
    [0, 0, [0xff, 0x51, 3, 0x0f, 0x42, 0x40]],
    [0, 0, [0xff, 0x58, 4, t0[0], Math.round(Math.log2(t0[1])), 24, 8]],
  ];
  tracks.push(track(meta));
  // one track per instrument, each on its own channel (10 is kept for drums)
  let ch = 0;
  score.parts.forEach((p) => {
    const mine = tl.notes.filter((n) => n.part === p.id);
    const unpitched = mine.length && /drum|woodblock/.test(mine[0].sid);
    const c = unpitched ? 9 : ch;
    if (!unpitched) { ch++; if (ch === 9) ch++; if (ch > 15) ch = 15; }
    const ev = [];
    const name = p.name || 'Part';
    ev.push([0, 0, [0xff, 0x03, ...vlq(str(name).length), ...str(name)]]);
    // the sound may change along the way (pizz. and arco): a program change each time
    let prog = -1;
    const lastOff = new Map();   // key → its note-off, moved earlier when the same key sounds again
    for (const n of mine.slice().sort((a, b) => a.t - b.t)) {
      const pr = n.kind === 'pizz' ? PROGRAM.pizz : n.kind === 'trem' ? PROGRAM.tremolo : PROGRAM[n.sid] ?? 0;
      if (pr !== prog && !unpitched) { ev.push([tick(n.t), 1, [0xc0 | c, pr]]); prog = pr; }
      const on = tick(n.t), off = Math.max(on + 1, tick(n.t + Math.max(0.02, n.dur)));
      const key = Math.max(0, Math.min(127, Math.round(n.midi)));
      const vel = Math.max(1, Math.min(127, Math.round(20 + (n.vel || 0.6) * 107)));
      const prev = lastOff.get(key);
      if (prev && prev[0] > on) prev[0] = on;
      const offEv = [off, 0, [0x80 | c, key, 0]];
      ev.push([on, 2, [0x90 | c, key, vel]], offEv);
      lastOff.set(key, offEv);
    }
    if (prog < 0 && !unpitched) ev.push([0, 1, [0xc0 | c, 0]]);
    tracks.push(track(ev));
  });
  const head = chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]);
  return new Blob([new Uint8Array([...head, ...tracks.flat()])], { type: 'audio/midi' });
}
