// The score: parts (instruments) with staves, and staves with bars of events (notes, chords,
// rests). Pitches are stored at concert pitch as a letter step and an alteration, so spelling
// is kept (F♯ is not G♭). Every bar of every staff always adds up to its time signature:
// writing a note overwrites what was there, and gaps are filled with rests.
import { INST, FAMILY_ORDER, defaultStaffSize } from './instruments.js';

export const WHOLE = 1920, QUARTER = 480;
export const STEP_SEMI = [0, 2, 4, 5, 7, 9, 11];
export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
let seq = 0;
export const newId = () => (Date.now() % 1e8).toString(36) + (seq++).toString(36);

// ---------- durations ----------
export const baseTicks = (t) => WHOLE / t;
export function evTicks(ev) {
  let d = baseTicks(ev.t) * (2 - Math.pow(0.5, ev.dots || 0));
  if (ev.tup) {
    // a tuplet whose notes don't divide the ticks evenly (septuplets, nonuplets): each note knows its
    // place in the group (i), and the rounding is spread so the group always adds up exactly
    const q = (d * ev.tup.m) / ev.tup.n, i = ev.tup.i;
    if (i !== undefined && i !== null) return Math.round((i + 1) * q) - Math.round(i * q);
    d = q;
  }
  return Math.round(d);
}
export const barTicks = (time) => (time[0] * WHOLE) / time[1];
// Standard values that fit, longest first: [ticks, t, dots]
const VALUES = [];
for (const t of [1, 2, 4, 8, 16, 32, 64]) { VALUES.push([baseTicks(t) * 1.75, t, 2], [baseTicks(t) * 1.5, t, 1], [baseTicks(t), t, 0]); }
VALUES.sort((a, b) => b[0] - a[0]);
export function valueOf(ticks) { const v = VALUES.find((x) => x[0] === ticks); return v ? { t: v[1], dots: v[2] } : null; }

// Split a length at a position into notated values that respect the beat.
export function decompose(pos, len, time, forRest) {
  const out = [];
  const compound = time[1] === 8 && time[0] % 3 === 0 && time[0] > 3;
  const beat = compound ? (WHOLE / 8) * 3 : WHOLE / time[1];
  const bar = barTicks(time);
  let p = pos, r = len;
  let guard = 0;
  while (r > 0 && guard++ < 64) {
    let pick = null;
    for (const [ticks, t, dots] of VALUES) {
      if (ticks > r) continue;
      let aligned;
      if (!dots) aligned = p % ticks === 0;
      else if (forRest) aligned = compound && dots === 1 && p % beat === 0 && ticks <= beat * 2;
      else aligned = dots === 1 && p % Math.min(baseTicks(t) * 2, beat) === 0;
      if (!aligned) continue;
      // rests do not cross the middle of a 4/4 bar unless they fill it
      if (forRest && time[0] === 4 && time[1] === 4 && p < bar / 2 && p + ticks > bar / 2 && !(p === 0 && ticks === bar)) continue;
      pick = [ticks, t, dots]; break;
    }
    if (!pick) pick = [r, 64, 0];
    out.push({ ticks: pick[0], t: pick[1], dots: pick[2] });
    p += pick[0]; r -= pick[0];
  }
  return out;
}

// ---------- pitch ----------
export const midiOf = (s, a) => 12 * (Math.floor(s / 7) + 1) + STEP_SEMI[((s % 7) + 7) % 7] + (a || 0);
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
export function keyAlter(fifths, step) {
  const sc = ((step % 7) + 7) % 7;
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(sc) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(sc) ? -1 : 0;
  return 0;
}
export const keySteps = (fifths) => (fifths > 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths));
// Spell a MIDI note in a key: prefer the key's own notes, then sharps (sharp keys) or flats.
export function spell(midi, fifths = 0) {
  const pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1;
  const cands = [];
  for (let sc = 0; sc < 7; sc++) for (const a of [0, 1, -1, 2, -2]) {
    if ((((STEP_SEMI[sc] + a) % 12) + 12) % 12 !== pc) continue;
    let o = oct; const raw = STEP_SEMI[sc] + a; if (raw < 0) o += 1; if (raw > 11) o -= 1;
    cands.push({ s: o * 7 + sc, a });
  }
  const score = (c) => (keyAlter(fifths, c.s) === c.a ? 0 : 1) * 10 + Math.abs(c.a) * 3 + (c.a > 0 && fifths < 0 ? 2 : 0) + (c.a < 0 && fifths >= 0 ? 2 : 0);
  cands.sort((x, y) => score(x) - score(y));
  return cands[0];
}
export const noteName = (s, a) => STEP_NAMES[((s % 7) + 7) % 7] + (a === 1 ? '♯' : a === -1 ? '♭' : a === 2 ? '𝄪' : a === -2 ? '𝄫' : '') + (Math.floor(s / 7) - 1 + 1);
// Interval helpers for transposing instruments
export function fifthsOfInterval(steps, semis) {
  for (let f = -14; f <= 14; f++) if ((((f * 7) % 12) + 12) % 12 === ((semis % 12) + 12) % 12 && (((f * 4) % 7) + 7) % 7 === ((steps % 7) + 7) % 7) return f;
  return 0;
}
// Concert pitch <-> written pitch for an instrument
export function toWritten(n, inst) {
  const tr = inst.tr; if (!tr || (!tr.steps && !tr.semis)) return n;
  const s = n.s - tr.steps; const m = midiOf(n.s, n.a) - tr.semis;
  return { ...n, s, a: m - midiOf(s, 0) };
}
export function toConcert(n, inst) {
  const tr = inst.tr; if (!tr || (!tr.steps && !tr.semis)) return n;
  const s = n.s + tr.steps; const m = midiOf(n.s, n.a) + tr.semis;
  return { ...n, s, a: m - midiOf(s, 0) };
}
export function writtenKey(fifths, inst) {
  const tr = inst.tr; if (!tr || (!tr.steps && !tr.semis)) return fifths;
  let k = fifths - fifthsOfInterval(tr.steps, tr.semis);
  while (k > 7) k -= 12; while (k < -7) k += 12;
  return k;
}

// ---------- clefs: the step on the bottom line ----------
export const CLEFS = {
  treble: { bottom: 30, glyph: '', line: 1, name: 'Treble' },
  bass: { bottom: 18, glyph: '', line: 3, name: 'Bass' },
  alto: { bottom: 24, glyph: '', line: 2, name: 'Alto' },
  tenor: { bottom: 22, glyph: '', line: 3, name: 'Tenor' },
  treble8: { bottom: 23, glyph: '', line: 1, name: 'Treble 8vb' },
  bass8: { bottom: 11, glyph: '', line: 3, name: 'Bass 8vb' },
  perc: { bottom: 30, glyph: '', line: 2, name: 'Percussion' },
};

// ---------- score creation ----------
export function newPart(instId) {
  const inst = INST[instId] || INST.piano;
  return { id: newId(), inst: inst.id, name: inst.name, abbr: inst.abbr, mix: null,
    staves: inst.clefs.map((clef) => ({ id: newId(), clef, bars: [] })) };
}
export function newScore({ title = 'Untitled', composer = '', insts = ['piano'], time = [4, 4], key = 0, bpm = 96, bars = 32, page = 'A4' } = {}) {
  const parts = insts.map(newPart);
  // number repeated instruments: Violin 1, Violin 2
  const count = {}; for (const p of parts) count[p.inst] = (count[p.inst] || 0) + 1;
  const seen = {};
  for (const p of parts) if (count[p.inst] > 1 && !INST[p.inst].section) { seen[p.inst] = (seen[p.inst] || 0) + 1; p.name += ' ' + seen[p.inst]; p.abbr += ' ' + seen[p.inst]; }
  const nStaves = parts.reduce((n, p) => n + p.staves.length, 0);
  const score = {
    v: 1, _v2spans: 1, title, subtitle: '', composer, created: Date.now(),
    layout: { page, landscape: false, staffMm: defaultStaffSize(nStaves), concert: true, hideEmpty: false },
    sound: { room: 'hall', roomMix: 1, tuning: 440 },
    measures: [], parts,
  };
  for (let m = 0; m < bars; m++) score.measures.push(m === 0 ? { time: time.slice(), key, tempo: { bpm, beat: 4, text: '' } } : {});
  for (const st of allStaves(score)) for (let m = 0; m < bars; m++) st.bars.push(restBar(time));
  score.measures[bars - 1].bar = 'final';
  return score;
}
export const restBar = (time) => [{ id: newId(), rest: true, full: true, t: 1, dots: 0, ticks: barTicks(time) }];
export const allStaves = (score) => score.parts.flatMap((p) => p.staves);
export function staffInfo(score) {
  const out = [];
  score.parts.forEach((p, pi) => p.staves.forEach((st, si) => out.push({ st, part: p, pi, si, inst: INST[p.inst] || INST.piano })));
  return out;
}
export function timeAt(score, m) { for (let i = Math.min(m, score.measures.length - 1); i >= 0; i--) if (score.measures[i].time) return score.measures[i].time; return [4, 4]; }
export function keyAt(score, m) { for (let i = Math.min(m, score.measures.length - 1); i >= 0; i--) if (score.measures[i].key !== undefined && score.measures[i].key !== null) return score.measures[i].key; return 0; }
export function tempoAt(score, m) { for (let i = Math.min(m, score.measures.length - 1); i >= 0; i--) if (score.measures[i].tempo) return score.measures[i].tempo; return { bpm: 96, beat: 4 }; }
export function clefAt(st, m) { let c = st.clef; if (st.clefs) for (const [k, v] of Object.entries(st.clefs)) if (+k <= m) c = v; return c; }

// ---------- event lengths ----------
export const ticksOf = (ev, time) => (ev.full ? barTicks(time) : evTicks(ev));
export function eventStarts(bar, time) { let p = 0; return bar.map((ev) => { const s = p; p += ticksOf(ev, time); return s; }); }
const makeRest = (piece) => ({ id: newId(), rest: true, t: piece.t, dots: piece.dots });
export function restsFor(pos, len, time) { return decompose(pos, len, time, true).map(makeRest); }

// Merge neighbouring rests and spell them again, so a bar never holds odd rest values.
export function tidyBar(bar, time) {
  const total = barTicks(time);
  const out = []; let p = 0, restFrom = -1;
  const flush = (to) => {
    if (restFrom < 0) return;
    if (restFrom === 0 && to === total) out.push({ id: newId(), rest: true, full: true, t: 1, dots: 0 });
    else out.push(...restsFor(restFrom, to - restFrom, time));
    restFrom = -1;
  };
  for (const ev of bar) {
    const len = ticksOf(ev, time);
    if (p + len > total) {
      // too long for the bar (a new time signature): a rest is cut short, a note is shortened
      if (ev.rest) { if (restFrom < 0) restFrom = p; p = total; break; }
      flush(p);
      if (total - p > 0) out.push(...pieceList(ev, p, total - p, time).map((x) => x.ev));
      p = total; break;
    }
    if (ev.rest && !ev.tup && !ev.keep) { if (restFrom < 0) restFrom = p; }
    else { flush(p); out.push(ev.full ? { ...ev, full: false, ...(valueOf(len) || {}) } : ev); }
    p += len;
  }
  if (p < total) { if (restFrom < 0) restFrom = p; p = total; }
  flush(p);
  return out;
}

// Write an event (note, chord or rest) over [pos, pos+len) in bar m of a staff. Anything there is
// replaced; a note that sticks out of the bar continues in the next bar, tied.
export function writeEvent(score, st, m, pos, ev) {
  const time = timeAt(score, m);
  const total = barTicks(time);
  const len = evTicks(ev);
  if (len <= 0) return null;
  const fit = Math.min(len, total - pos);
  let pieces;
  if (fit === len) pieces = [ev];
  else {
    // split into notated values; tie the parts together (rests just split)
    pieces = decompose(pos, fit, time, !!ev.rest).map((pc, i) => ({ ...clone(ev), id: i ? newId() : ev.id, t: pc.t, dots: pc.dots, tup: null,
      notes: ev.notes ? ev.notes.map((n) => ({ ...n, tie: true })) : undefined }));
    if (ev.rest) pieces.forEach((p) => { delete p.notes; });
  }
  replaceRange(st, m, pos, fit, pieces, time);
  if (fit < len) {
    // carry over into the next bar
    if (m + 1 >= score.measures.length) addBars(score, 1);
    const rest = len - fit;
    const nextTime = timeAt(score, m + 1);
    const carry = decompose(0, Math.min(rest, barTicks(nextTime)), nextTime, !!ev.rest).map((pc, i, arr) => ({ ...clone(ev), id: newId(), t: pc.t, dots: pc.dots, tup: null,
      art: [], dyn: null, txt: null, slur: null, hp: null,
      notes: ev.notes ? ev.notes.map((n) => ({ ...n, tie: i < arr.length - 1 ? true : !!n.tie })) : undefined }));
    replaceRange(st, m + 1, 0, carry.reduce((a, c) => a + evTicks(c), 0), carry, nextTime);
  }
  return pieces[0];
}
function replaceRange(st, m, pos, len, pieces, time) {
  const bar = st.bars[m] || restBar(time);
  const starts = eventStarts(bar, time);
  const out = [];
  const end = pos + len;
  bar.forEach((e, i) => {
    const s = starts[i], l = ticksOf(e, time), eEnd = s + l;
    if (eEnd <= pos || s >= end) { out.push({ s, ev: e }); return; }
    // the part before the new event stays (a note keeps its pitch, shortened)
    if (s < pos) out.push(...pieceList(e, s, pos - s, time));
    if (eEnd > end) out.push(...restsFor(end, eEnd - end, time).map((r, k, arr) => ({ s: end + arr.slice(0, k).reduce((a, x) => a + evTicks(x), 0), ev: r })));
  });
  let p = pos; for (const pc of pieces) { out.push({ s: p, ev: pc }); p += evTicks(pc); }
  out.sort((a, b) => a.s - b.s);
  st.bars[m] = tidyBar(out.map((x) => x.ev), time);
}
function pieceList(e, s, len, time) {
  if (e.rest) return restsFor(s, len, time).map((r, k, arr) => ({ s: s + arr.slice(0, k).reduce((a, x) => a + evTicks(x), 0), ev: r }));
  const parts = decompose(s, len, time, false);
  let p = s;
  return parts.map((pc, i) => { const ev = { ...clone(e), id: i ? newId() : e.id, t: pc.t, dots: pc.dots, tup: null, notes: e.notes.map((n) => ({ ...n, tie: i < parts.length - 1 ? true : false })) }; const o = { s: p, ev }; p += pc.ticks; return o; });
}
export const clone = (o) => JSON.parse(JSON.stringify(o));

// Make an event at a position a rest (keeps the bar full).
export function clearEvent(score, st, m, evId) {
  const time = timeAt(score, m), bar = st.bars[m];
  const i = bar.findIndex((e) => e.id === evId); if (i < 0) return;
  const prev = bar[i - 1];
  bar[i] = { id: newId(), rest: true, t: bar[i].t, dots: bar[i].dots, tup: bar[i].tup, keep: !!bar[i].tup };
  if (prev && prev.notes) prev.notes.forEach((n) => { n.tie = false; });
  st.bars[m] = tidyBar(bar, time);
}

// ---------- bars ----------
export function addBars(score, n, at = score.measures.length) {
  const time = timeAt(score, Math.max(0, at - 1));
  for (let k = 0; k < n; k++) {
    score.measures.splice(at, 0, {});
    for (const st of allStaves(score)) { st.bars.splice(at, 0, restBar(time)); if (st.v2) st.v2.splice(at, 0, restBar(time)); }
  }
  // lines (slurs, hairpins, endings, 8va…) stay on their notes
  for (const sp of score.spans || []) { if (sp.a.m >= at) sp.a = { ...sp.a, m: sp.a.m + n }; if (sp.b.m >= at) sp.b = { ...sp.b, m: sp.b.m + n }; }
  // the final barline moves to the new end
  for (const ms of score.measures) if (ms.bar === 'final') delete ms.bar;
  score.measures[score.measures.length - 1].bar = 'final';
}
export function deleteBars(score, from, n) {
  if (score.measures.length - n < 1) return;
  // lines inside the deleted bars go; lines reaching into them are cut back to the bars that remain
  if (score.spans) {
    const to = from + n - 1;
    score.spans = score.spans.filter((sp) => !(sp.a.m >= from && sp.b.m <= to));
    for (const sp of score.spans) {
      if (sp.a.m > to) sp.a = { ...sp.a, m: sp.a.m - n }; else if (sp.a.m >= from) sp.a = { m: from, pos: 0 };
      if (sp.b.m > to) sp.b = { ...sp.b, m: sp.b.m - n }; else if (sp.b.m >= from) sp.b = { m: Math.max(0, from - 1), pos: barTicks(timeAt(score, Math.max(0, from - 1))) - 1 };
    }
    score.spans = score.spans.filter((sp) => sp.b.m > sp.a.m || (sp.b.m === sp.a.m && sp.b.pos >= sp.a.pos));
  }
  const keepTime = score.measures[from].time, keepKey = score.measures[from].key;
  score.measures.splice(from, n);
  for (const st of allStaves(score)) { st.bars.splice(from, n); if (st.v2) st.v2.splice(from, n); }
  if (from < score.measures.length) {
    if (keepTime && !score.measures[from].time) score.measures[from].time = keepTime;
    if (keepKey !== undefined && score.measures[from].key === undefined) score.measures[from].key = keepKey;
  }
  if (!score.measures[0].time) score.measures[0].time = [4, 4];
  if (score.measures[0].key === undefined) score.measures[0].key = 0;
  for (const ms of score.measures) if (ms.bar === 'final') delete ms.bar;
  score.measures[score.measures.length - 1].bar = 'final';
}
// A new time signature: bars from here until the next change are fitted to it.
export function setTime(score, m, time) {
  score.measures[m].time = time.slice();
  for (let i = m; i < score.measures.length; i++) {
    if (i > m && score.measures[i].time) break;
    for (const st of allStaves(score)) { st.bars[i] = tidyBar(st.bars[i].map((e) => (e.full ? { ...e } : e)), time); if (st.v2) st.v2[i] = tidyBar(st.v2[i].map((e) => (e.full ? { ...e } : e)), time); }
  }
}

// ---------- parts ----------
export function addPart(score, instId) {
  const part = newPart(instId);
  const fam = FAMILY_ORDER.indexOf(INST[instId].fam);
  let at = score.parts.length;
  for (let i = 0; i < score.parts.length; i++) { const f = FAMILY_ORDER.indexOf(INST[score.parts[i].inst].fam); if (f > fam) { at = i; break; } }
  score.parts.splice(at, 0, part);
  for (const st of part.staves) for (let m = 0; m < score.measures.length; m++) st.bars.push(restBar(timeAt(score, m)));
  const same = score.parts.filter((p) => p.inst === instId);
  if (same.length > 1 && !INST[instId].section) same.forEach((p, i) => { p.name = INST[instId].name + ' ' + (i + 1); p.abbr = INST[instId].abbr + ' ' + (i + 1); });
  return part;
}
export function removePart(score, partId) {
  if (score.parts.length <= 1) return false;
  score.parts = score.parts.filter((p) => p.id !== partId);
  return true;
}

// ---------- a second voice on a staff ----------
// Voice 2 lives in st.v2 (bars like st.bars). A "view" of a staff for one voice behaves like
// the staff itself, so the same editing functions work on either voice.
export function voiceView(st, v, score) {
  if (v !== 2) return st.base || st;
  const base = st.base || st;
  if (!base.v2) base.v2 = base.bars.map((b, m) => restBar(score ? timeAt(score, m) : [4, 4]));
  const view = Object.create(base);
  Object.defineProperty(view, 'bars', { value: base.v2, enumerable: true });
  view.voice = 2; view.base = base;
  return view;
}
export function hasVoice2(st, m) { return !!(st.v2 && st.v2[m] && st.v2[m].some((e) => !e.rest)); }
// ---------- finding things ----------
export function findEvent(score, evId) {
  for (const { st, part, inst } of staffInfo(score)) {
    for (let m = 0; m < st.bars.length; m++) {
      const i = st.bars[m].findIndex((e) => e.id === evId);
      if (i >= 0) return { st, part, inst, m, i, ev: st.bars[m][i], pos: eventStarts(st.bars[m], timeAt(score, m))[i] };
      if (st.v2 && st.v2[m]) {
        const j = st.v2[m].findIndex((e) => e.id === evId);
        if (j >= 0) { const vst = voiceView(st, 2, score); return { st: vst, part, inst, m, i: j, ev: st.v2[m][j], pos: eventStarts(st.v2[m], timeAt(score, m))[j], voice: 2 }; }
      }
    }
  }
  return null;
}
export function nextEvent(score, st, m, i) {
  if (i + 1 < st.bars[m].length) return { m, i: i + 1, ev: st.bars[m][i + 1] };
  if (m + 1 < st.bars.length) return { m: m + 1, i: 0, ev: st.bars[m + 1][0] };
  return null;
}
export function prevEvent(score, st, m, i) {
  if (i > 0) return { m, i: i - 1, ev: st.bars[m][i - 1] };
  if (m > 0) return { m: m - 1, i: st.bars[m - 1].length - 1, ev: st.bars[m - 1][st.bars[m - 1].length - 1] };
  return null;
}
export function isEmptyStaff(st) { return st.bars.every((b) => b.every((e) => e.rest)); }

// ---------- slurs and hairpins as lines over any number of notes (across bars and lines) ----------
// A slur or hairpin is a span: { kind: 'slur' | 'hairpin', st, v, a: {m,pos}, b: {m,pos}, dir }.
// Older scores kept them as marks on the first and last note; those are turned into spans.
const posLE = (a, b) => a.m < b.m || (a.m === b.m && a.pos <= b.pos);
export function migrateScore(score) {
  if (!score || score._v2spans) return score;
  score.spans = score.spans || [];
  for (const st of allStaves(score)) {
    for (const [v, bars] of [[1, st.bars], [2, st.v2 || []]]) {
      const flat = [];
      bars.forEach((bar, m) => { const time = timeAt(score, m); let p = 0; for (const ev of bar) { flat.push({ ev, m, pos: p }); p += ticksOf(ev, time); } });
      for (let i = 0; i < flat.length; i++) {
        const f = flat[i], ev = f.ev;
        if (ev.slur === 'start') {
          let j = i + 1; while (j < flat.length && flat[j].ev.slur !== 'end') j++;
          const b = j < flat.length ? flat[j] : flat[Math.min(flat.length - 1, i + 1)];
          if (b && b !== f) score.spans.push({ id: newId(), kind: 'slur', st: st.id, v, a: { m: f.m, pos: f.pos }, b: { m: b.m, pos: b.pos } });
        }
        if (ev.hp === '<' || ev.hp === '>') {
          let j = i + 1; while (j < flat.length && flat[j].ev.hp !== 'end' && !flat[j].ev.dyn && flat[j].ev.hp !== '<' && flat[j].ev.hp !== '>') j++;
          // the hairpin covers the notes up to the one before its end
          let k = Math.max(i, j - 1);
          if (j >= flat.length) { k = i; while (k + 1 < flat.length && flat[k + 1].m === f.m) k++; }
          const b = flat[k];
          score.spans.push({ id: newId(), kind: 'hairpin', dir: ev.hp, st: st.id, v, a: { m: f.m, pos: f.pos }, b: { m: b.m, pos: b.pos } });
        }
      }
      for (const { ev } of flat) { delete ev.slur; if (ev.hp) delete ev.hp; }
    }
  }
  score._v2spans = 1;
  return score;
}
// The span of a kind on a staff that covers a place (for extending or ending it).
export function spanAt(score, kind, stId, v, at) {
  return (score.spans || []).find((q) => q.kind === kind && q.st === stId && (q.v || 1) === (v || 1) && posLE(q.a, at) && posLE(at, q.b));
}
export function spanStartingAt(score, kind, stId, v, at) {
  return (score.spans || []).find((q) => q.kind === kind && q.st === stId && (q.v || 1) === (v || 1) && q.a.m === at.m && q.a.pos === at.pos);
}
// Turn spans back into marks on notes (MusicXML is written from these).
export function spansToMarks(score) {
  const s = clone(score);
  const find = (st, v, at) => { const bars = v === 2 ? st.v2 : st.bars; if (!bars || !bars[at.m]) return null; const time = timeAt(s, at.m); let p = 0, best = null; for (const ev of bars[at.m]) { if (p <= at.pos) best = ev; p += ticksOf(ev, time); } return best; };
  const after = (st, v, at) => { const bars = v === 2 ? st.v2 : st.bars; if (!bars) return null; const time = timeAt(s, at.m); let p = 0; const bar = bars[at.m] || []; for (let i = 0; i < bar.length; i++) { if (p === at.pos || (p < at.pos && p + ticksOf(bar[i], time) > at.pos)) return bar[i + 1] || (bars[at.m + 1] || [])[0] || null; p += ticksOf(bar[i], time); } return null; };
  for (const sp of s.spans || []) {
    if (sp.kind !== 'slur' && sp.kind !== 'hairpin') continue;
    const st = allStaves(s).find((x) => x.id === sp.st); if (!st) continue;
    const a = find(st, sp.v || 1, sp.a), b = find(st, sp.v || 1, sp.b);
    if (!a || !b) continue;
    if (sp.kind === 'slur') { a.slur = 'start'; if (b !== a) b.slur = 'end'; }
    else { a.hp = sp.dir; const e = after(st, sp.v || 1, sp.b); if (e && !e.dyn && !e.hp) e.hp = 'end'; }
  }
  s.spans = (s.spans || []).filter((q) => q.kind !== 'slur' && q.kind !== 'hairpin');
  return s;
}

// ---------- copy and paste (whole bars or a passage of notes) ----------
// A clip is a list of bars of one staff: [{ time, events }]
export function copyBars(score, st, from, to) {
  const out = [];
  for (let m = from; m <= to; m++) out.push({ time: timeAt(score, m), events: clone(st.bars[m]) });
  return out;
}
export function pasteBars(score, st, at, clip) {
  for (let k = 0; k < clip.length; k++) {
    const m = at + k;
    if (m >= score.measures.length) addBars(score, 1);
    const time = timeAt(score, m);
    const events = clip[k].events.map((e) => ({ ...clone(e), id: newId() }));
    st.bars[m] = tidyBar(events, time);
  }
}
