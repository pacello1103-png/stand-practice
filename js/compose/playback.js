// Playing a score with the sampled instruments: tempo changes, repeats, ties, dynamics and
// hairpins, articulations, fermatas and a light human touch. Also renders the score to audio.
import { WHOLE, barTicks, timeAt, tempoAt, ticksOf, midiOf, staffInfo, keyAlter, keyAt, voiceView } from './model.js';
import { INST } from './instruments.js';
import { sampler, Sampler, DEFAULT_MIX, realSet } from '../sampler.js';
import { getCtx, wantAudio } from '../audio.js';
import { encodeWav } from '../recorder.js';

export const DYN_VEL = { pppp: 0.08, ppp: 0.14, pp: 0.24, p: 0.36, mp: 0.5, mf: 0.62, f: 0.76, ff: 0.88, fff: 0.97, ffff: 1, sfz: 0.9, sf: 0.88, sffz: 0.97, fz: 0.9, sfp: 0.8, fp: 0.78, rfz: 0.85 };

// The order bars are played in: repeats (twice), first and second endings, D.C. / D.S. with
// Fine and To Coda.
export function playOrder(score, from = 0) {
  const ms = score.measures, n = ms.length;
  const voltas = (score.spans || []).filter((q) => q.kind === 'volta');
  const voltaAt = (m) => voltas.find((v) => m >= v.a.m && m <= v.b.m);
  const order = [];
  let start = 0, pass = 1, jumped = false, guard = 0;
  const done = new Set();
  const segno = ms.findIndex((q) => q.mark === 'segno');
  const coda = ms.findIndex((q) => q.mark === 'coda');
  for (let m = 0; m < n && guard++ < n * 6; m++) {
    const q = ms[m];
    if (q.start === 'repeat' && m !== start) { start = m; pass = 1; }
    const v = voltaAt(m);
    if (v && (v.n || 1) !== pass && !(v.n === 12 && pass <= 2)) {
      // this ending is for another time through: skip it
      m = v.b.m; continue;
    }
    order.push(m);
    if (jumped && q.jump === 'fine') break;
    if (jumped && q.jump === 'tocoda' && coda > m) { m = coda - 1; continue; }
    if (q.bar === 'repeat' && !done.has(m)) { done.add(m); pass++; m = start - 1; continue; }
    if (q.bar === 'repeat') { pass = 1; start = m + 1; }   // (a later repeat without its own start goes back to here)
    if (!jumped && q.jump && q.jump !== 'fine' && q.jump !== 'tocoda') {
      jumped = true;
      const to = q.jump.startsWith('ds') && segno >= 0 ? segno : 0;
      for (const k of [...done]) done.add(k);
      m = to - 1; pass = 2; start = to; continue;
    }
  }
  const i = order.indexOf(from);
  return i > 0 ? order.slice(i) : order;
}

// ---------- phrases (how a musician hears the line) ----------
// From the melody (the staff with the most notes), where its phrases end: before a rest, on a
// fermata, at the end of a slur on a longer note, or on a long note after shorter ones. Each phrase
// then gets what players do without thinking, and only a little of it (the score stays the score):
// a gentle arch of loudness towards its middle, a slight easing of the tempo into its last note, and
// the smallest breath after it. Positions are counted in the order the bars are played.
function phrasesOf(score, order, info) {
  let best = null, most = -1;
  for (const x of info) { let n = 0; for (const m of order) for (const ev of x.st.bars[m] || []) if (ev.notes && !ev.rest) n++; if (n > most) { most = n; best = x; } }
  if (!best || most < 6) return [];
  const evs = [];
  order.forEach((m, k) => { const time = timeAt(score, m); let p = 0; for (const ev of best.st.bars[m] || []) { const len = ticksOf(ev, time); evs.push({ ev, k, pos: p, len, bar: barTicks(time) }); p += len; } });
  const lens = evs.filter((q) => q.ev.notes && !q.ev.rest).map((q) => q.len).sort((a, b) => a - b);
  const med = lens[lens.length >> 1] || 480;
  const out = []; let start = 0;
  for (let i = 0; i < evs.length; i++) {
    const q = evs[i], nx = evs[i + 1];
    if (!q.ev.notes || q.ev.rest) { if (i > start) { /* (a rest after notes: the phrase ended on the note before) */ } start = i + 1; continue; }
    const arts = q.ev.art || [];
    const restNext = !nx || (nx.ev.rest && nx.len >= Math.min(240, med));
    const ferm = arts.some((a) => a === 'ferm' || a === 'fermS' || a === 'fermL' || a === 'breath' || a === 'caes');
    const slurEndLong = q.ev.slur === 'end' && q.len >= med * 1.5;
    const longAfterShort = q.len >= med * 2 && i > start + 3 && nx && nx.ev.notes && !nx.ev.rest && !q.ev.notes.some((n) => n.tie);
    if (restNext || ferm || slurEndLong || longAfterShort) {
      if (i - start >= 3) out.push({ a: { k: evs[start].k, pos: evs[start].pos }, e: { k: q.k, pos: q.pos, len: q.len }, breath: !restNext && !ferm && !q.ev.notes.some((n) => n.tie) });
      start = i + 1;
    }
  }
  return out;
}
const BOWED_SET = /violin|viola|cello|^bass$|^basses$|strings/;
const secPerTick = (tempo) => 60 / (tempo.bpm * (WHOLE / (tempo.beat || 4)) * (tempo.dotted ? 1.5 : 1));
const SUSTAIN = /violin|viola|cello|^bass$|^basses$|strings|choir|oohs|flute|piccolo|recorder|oboe|englishhorn|clarinet|bassoon|sax|horn|trumpet|trombone|tuba|brass|organ|accordion/;
const VIBRATO = { violin: 14, viola: 13, cello: 12, bass: 8, violins: 9, violas: 9, cellos: 9, basses: 7, strings: 9, choir: 9, oohs: 8, flute: 7, piccolo: 6, oboe: 8, englishhorn: 7, bassoon: 5, sopsax: 9, altosax: 10, tenorsax: 10, barisax: 8, horn: 4, trumpet: 5, trombone: 4 };
export const PLAY_STYLES = { expressive: 'Expressive', straight: 'Exact' };

// Every note of the score as { part, sid, midi, t, dur, vel, art, ids, m, pos }.
// The "expressive" style plays like a musician: it shapes phrases and long notes, leans on strong
// beats, connects slurred notes, adds vibrato where players would, plays ornaments, rolls
// arpeggios, follows rit. and accel., and slows a little at the very end.
// The written dynamic (0..1, as DYN_VEL) as a pianist's key force (of 127): pp 38, p 46, mf 66,
// f 84, ff 94 — a real pianist's range, which the concert grand's recordings then colour.
const PIANO_KEY = [[0, 20], [DYN_VEL.pppp, 26], [DYN_VEL.ppp, 31], [DYN_VEL.pp, 38], [DYN_VEL.p, 46], [DYN_VEL.mp, 56], [DYN_VEL.mf, 66], [DYN_VEL.f, 84], [DYN_VEL.ff, 94], [DYN_VEL.fff, 104], [1, 110], [1.3, 118]];
function pianoKey(x) {
  for (let i = 1; i < PIANO_KEY.length; i++) if (x <= PIANO_KEY[i][0]) { const [a, va] = PIANO_KEY[i - 1], [b, vb] = PIANO_KEY[i]; return (va + (vb - va) * (x - a) / Math.max(1e-6, b - a)) / 127; }
  return 118 / 127;
}
export function buildTimeline(score, { from = 0, humanize = true } = {}) {
  const style = (score.sound && score.sound.style) || 'expressive';
  const expr = style !== 'straight';
  if (!expr) humanize = false;
  const order = playOrder(score, from);
  const fullOrder = playOrder(score, 0);
  const info = staffInfo(score);
  // a second voice plays like one more staff of the same instrument
  for (const x of [...info]) for (const v of [2, 3, 4]) { const vb = x.st['v' + v]; if (vb && vb.some((b) => b && b.some((e) => !e.rest))) info.push({ ...x, st: voiceView(x.st, v, score) }); }
  const spans = score.spans || [];
  // ---- the time map: tempo, rit./accel., fermatas, caesuras, a closing ritardando
  const tempoSpans = spans.filter((q) => q.kind === 'rit' || q.kind === 'accel');
  const PHR = expr && (globalThis.__phrasing ?? 1) ? phrasesOf(score, order, info) : [];
  // (the last beat or so of each phrase eases a little; the bar's own beat is the unit)
  const easeAt = (k, x, beatT) => {
    let f = 1;
    for (const ph of PHR) {
      if (ph.e.k !== k) continue;
      const from = Math.max(0, ph.e.pos - beatT), to = ph.e.pos + ph.e.len;
      if (x < from || x >= to) continue;
      const w = Math.min(1, (x - from) / Math.max(1, ph.e.pos + Math.min(ph.e.len, beatT) - from));
      f = Math.min(f, 1 - (globalThis.__phrEase ?? 0.06) * w);
    }
    return f;
  };
  const lastM = fullOrder[fullOrder.length - 1];
  const STEP = 30;
  let factor = 1;   // speed relative to the written tempo
  const barStart = [], barMap = []; let t = 0;
  const fermatas = [];
  order.forEach((m, k) => {
    barStart.push(t);
    const time = timeAt(score, m), tempo = tempoAt(score, m), total = barTicks(time);
    if (score.measures[m].tempo) factor = 1;
    for (const { st } of info) for (const ev of st.bars[m] || []) if (ev.txt && /a tempo|tempo i/i.test(ev.txt)) factor = 1;
    let extra = 0, caes = 0;
    for (const { st } of info) for (const ev of st.bars[m] || []) if (ev.art) {
      if (ev.art.includes('ferm')) extra = Math.max(extra, 60 / tempo.bpm * 1.0);
      if (ev.art.includes('fermS')) extra = Math.max(extra, 60 / tempo.bpm * 0.5);
      if (ev.art.includes('fermL')) extra = Math.max(extra, 60 / tempo.bpm * 2.0);
      if (ev.art.includes('caes')) caes = Math.max(caes, 0.4);
    }
    if (extra) fermatas.push({ m, extra });
    // the smallest breath after a phrase that runs straight into the next (a player's breath, a new bow)
    for (const ph of PHR) if (ph.breath && ph.e.k === k && ph.e.pos + ph.e.len >= total - 1) caes = Math.max(caes, globalThis.__phrBreath ?? 0.035);
    const cum = [0];
    let acc = 0;
    for (let x = 0; x < total; x += STEP) {
      let f = factor;
      if (expr || tempoSpans.length) {
        for (const sp of tempoSpans) {
          const inA = sp.a.m < m || (sp.a.m === m && sp.a.pos <= x), inB = sp.b.m > m || (sp.b.m === m && sp.b.pos + 480 >= x);
          if (inA && inB) {
            const span = Math.max(1, (sp.b.m - sp.a.m) * total + (sp.b.pos + 480 - sp.a.pos));
            const done = (m - sp.a.m) * total + (x - sp.a.pos);
            const target = sp.kind === 'rit' ? 0.72 : 1.3;
            f = factor * (1 + (target - 1) * Math.max(0, Math.min(1, done / span)));
            if (done + STEP >= span) sp._end = f;
          }
        }
        if (expr && m === lastM && k === order.length - 1) f *= 1 - 0.16 * Math.pow(x / total, 1.6);
        if (PHR.length) f *= easeAt(k, x, WHOLE / time[1]);
      }
      acc += STEP * secPerTick(tempo) / f;
      cum.push(acc);
    }
    for (const sp of tempoSpans) if (sp.b.m === m && sp._end) { factor = sp._end; delete sp._end; }
    barMap.push({ cum, total });
    t += acc + extra + caes;
  });
  const tAt = (k, pos) => { const bm = barMap[k]; const i = Math.min(bm.cum.length - 1, Math.floor(pos / STEP)); const fr = pos / STEP - i; const a = bm.cum[i], b = bm.cum[Math.min(bm.cum.length - 1, i + 1)]; return barStart[k] + a + (b - a) * fr; };
  const total = t;
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; }; const rnd2 = () => rnd() + 0.5; const IOWA_STR = !!(globalThis.__iowaS ?? 1);
  const notes = [];
  const marks = [];   // onsets for the moving cursor: {t, m, pos, ids}
  // ---- the pianist's pedal, where the score marks none (expressive style): held through each
  // harmony and changed as the bass moves (a new bass note, a rest, or a bar's length at most), so
  // the piano rings as a played piano does. Lightly in quick passages (no blur of scales).
  const AUTO_PED = new Map();
  if (expr && (globalThis.__autoPed ?? 1)) {
    const byPart = new Map();
    for (const x of info) { if (!byPart.has(x.part)) byPart.set(x.part, []); byPart.get(x.part).push(x); }
    for (const [part, xs] of byPart) {
      const sid0 = part.sound || xs[0].inst.sound;
      if (!/^(piano|epiano)$/.test(sid0)) continue;
      if (spans.some((q) => q.kind === 'ped' && part.staves.some((y) => y.id === q.st))) continue;
      // every staff's events in time (the lowest staff gives the bass)
      // the harmony, half a bar at a time (a bar in 3/4, 3/8, 2/4): its bass and its notes
      const winOf = (time) => { const bt = barTicks(time); const halves = time[0] === 4 || time[0] === 6 || time[0] === 12 || (time[0] === 2 && time[1] === 2); return halves ? bt / 2 : bt; };
      const wins = new Map();
      for (const x of xs) order.forEach((m, k) => {
        const time = timeAt(score, m), W = winOf(time); let p = 0;
        for (const ev of x.st.bars[m] || []) {
          const len = ticksOf(ev, time), wi = Math.floor(p / W), key = k + ':' + wi;
          let w = wins.get(key); if (!w) { w = { k, t: tAt(k, wi * W), end: tAt(k, Math.min(barMap[k].total, (wi + 1) * W)), low: null, pcs: new Set(), any: false }; wins.set(key, w); }
          if (ev.notes && !ev.rest) for (const n of ev.notes) { const mm = midiOf(n.s, n.a); w.any = true; w.pcs.add(mm % 12); if (x === xs[xs.length - 1] && (w.low === null || mm < w.low)) w.low = mm; }
          p += len;
        }
      });
      const segs = []; let cur = null;
      for (const w of [...wins.values()].sort((x, y) => x.t - y.t)) {
        if (!w.any) { if (cur) { cur.t1 = w.t; segs.push(cur); cur = null; } continue; }
        // the same harmony goes on (the same bass, mostly the same notes): one pedal, a bar at most
        let same = false;
        if (cur) { const inter = [...w.pcs].filter((q) => cur.pcs.has(q)).length, uni = new Set([...w.pcs, ...cur.pcs]).size; same = (w.low === null || cur.bass === null || w.low % 12 === cur.bass % 12) && inter / Math.max(1, uni) >= 0.5 && w.end - cur.t0 <= cur.barDur * 1.01; }
        if (cur && !same) { cur.t1 = w.t; segs.push(cur); cur = null; }
        if (!cur) cur = { t0: w.t, bass: w.low, pcs: new Set(w.pcs), t1: w.end, barDur: tAt(w.k, barMap[w.k].total) - tAt(w.k, 0) };
        cur.t1 = Math.max(cur.t1, w.end);
      }
      if (cur) segs.push(cur);
      const all = xs.map((x) => { const out = []; order.forEach((m, k) => { const time = timeAt(score, m); let p = 0; for (const ev of x.st.bars[m] || []) { if (ev.notes && !ev.rest) out.push({ t: tAt(k, p), low: 1 }); p += ticksOf(ev, time); } }); return out; });
      // (quick notes under one pedal: only a touch of it)
      const onsets = all.flat().filter((e) => e.low !== null).map((e) => e.t);
      for (const g of segs) { const n = onsets.filter((t) => t >= g.t0 - 1e-3 && t < g.t1).length; g.light = n / Math.max(0.05, g.t1 - g.t0) > 7; }
      AUTO_PED.set(part.id, segs);
    }
  }
  for (const { st, part, inst, si } of info) {
    const sid = part.sound || inst.sound;
    const sustained = SUSTAIN.test(sid);
    const keyed = !sustained;
    // ---- first pass: every event with its time, velocity and phrase context
    const flat = [];
    order.forEach((m, k) => {
      const time = timeAt(score, m);
      let p = 0;
      for (const ev of st.bars[m] || []) {
        const len = ticksOf(ev, time);
        const t0 = tAt(k, p);
        flat.push({ ev, m, k, pos: p, len, t: t0, dur: tAt(k, Math.min(barMap[k].total, p + len)) - t0, time });
        p += len;
      }
    });
    let vel = DYN_VEL.mf;
    for (let i = 0; i < flat.length; i++) {
      const f = flat[i];
      // (sfz, sffz, fz: a strong accent on the note; fp, sfp: loud then soft at once)
      const dk = f.ev.dyn === 'sffz' || f.ev.dyn === 'fz' ? 'sfz' : f.ev.dyn === 'sfp' ? 'fp' : f.ev.dyn;
      // (sf, sfz, fz, rfz: an accent on that one note, stronger than what is around it, and then
      // the music goes on at the level it had: in a p passage, sf is a p player's accent)
      const oneNote = (dk === 'sfz' || dk === 'sf' || dk === 'rfz') && (globalThis.__sfOne ?? 1);
      if (oneNote) { f.vel = Math.min(1, Math.max(vel + 0.24, DYN_VEL.mf)); }
      else {
        if (f.ev.dyn && DYN_VEL[f.ev.dyn] !== undefined) vel = DYN_VEL[f.ev.dyn] * (dk === 'sfz' || dk === 'fp' ? 0.8 : 1);
        f.vel = vel;
      }
      f.accent = dk === 'sfz' || dk === 'sf' || dk === 'rfz' ? 'sfz' : dk === 'fp' ? 'fp' : null;
      if (dk === 'fp' || (dk === 'sfz' && !oneNote)) vel = DYN_VEL.p + (dk === 'sfz' ? 0.2 : 0);
      if (f.ev.hp === '<' || f.ev.hp === '>') {
        let j = i + 1;
        while (j < flat.length && !flat[j].ev.dyn && flat[j].ev.hp !== 'end') j++;
        const target = j < flat.length && flat[j].ev.dyn ? DYN_VEL[flat[j].ev.dyn] ?? vel : Math.max(0.1, Math.min(1, vel + (f.ev.hp === '<' ? 1 : -1) * (globalThis.__hpStep ?? 0.14)));
        const t0 = f.t, t1 = j < flat.length ? flat[j].t : f.t + f.dur;
        for (let k = i; k < j && k < flat.length; k++) flat[k].vel = vel + (target - vel) * ((flat[k].t - t0) / Math.max(0.01, t1 - t0));
        f.env = [[t1, target / Math.max(0.05, vel)]];
        vel = target;
      }
    }
    // hairpins drawn as lines over notes: the level moves smoothly from the first note to the end
    const vNo = st.voice >= 2 ? st.voice : 1;
    const inSp = (f, sp) => (f.m > sp.a.m || (f.m === sp.a.m && f.pos >= sp.a.pos)) && (f.m < sp.b.m || (f.m === sp.b.m && f.pos <= sp.b.pos));
    for (const sp of spans.filter((q) => q.kind === 'hairpin' && q.st === st.id && (q.v || 1) === vNo)) {
      // every pass through the music (repeats) gets its own swell
      const cont = (x, y) => inSp(x, sp) && inSp(y, sp) && (y.m > x.m || (y.m === x.m && y.pos > x.pos));
      for (let i = 0; i < flat.length; i++) {
        if (!inSp(flat[i], sp) || (i > 0 && cont(flat[i - 1], flat[i]))) continue;
        let j = i; while (j + 1 < flat.length && cont(flat[j], flat[j + 1])) j++;
        const start = flat[i].vel;
        // (the next note after it, past any rests: a dynamic there is where the hairpin goes)
        let ka = j + 1; while (ka < flat.length && (!flat[ka].ev.notes || flat[ka].ev.rest) && !flat[ka].ev.dyn) ka++;
        const after = flat[ka];
        const up = sp.dir === '<';
        // the level it arrives at: a dynamic on its last note, or on the note just after it
        const endDyn = j > i && flat[j].ev.dyn && DYN_VEL[flat[j].ev.dyn] !== undefined ? DYN_VEL[flat[j].ev.dyn] : null;
        let target = endDyn ?? (after && after.ev.dyn && DYN_VEL[after.ev.dyn] !== undefined ? DYN_VEL[after.ev.dyn] : Math.max(0.1, Math.min(1, start + (up ? 1 : -1) * (globalThis.__hpStep ?? 0.14))));
        if (up && target <= start) target = Math.min(1, start + 0.14); if (!up && target >= start) target = Math.max(0.08, start - 0.14);
        // over several notes it arrives on the last one (as Sibelius plays it); over one note it swells through it
        const single = j === i;
        const last = single ? j : j - 1;
        const t0 = flat[i].t, t1 = single ? flat[j].t + flat[j].dur : flat[j].t;
        for (let k2 = i; k2 <= j; k2++) flat[k2].hpIn = true;
        for (let k2 = i; k2 <= last; k2++) {
          const fr = (flat[k2].t - t0) / Math.max(0.01, t1 - t0);
          flat[k2].vel = start + (target - start) * fr;
          // each note keeps growing (or fading) while it sounds
          const fr2 = Math.min(1, (flat[k2].t + flat[k2].dur - t0) / Math.max(0.01, t1 - t0));
          flat[k2].env = [[flat[k2].t + flat[k2].dur * 0.98, (start + (target - start) * fr2) / Math.max(0.05, flat[k2].vel)]];
        }
        if (!single) { flat[j].vel = target; flat[j].env = null; flat[j].hpEnd = true; }
        // the level after the hairpin carries on from where it ended
        for (let k2 = j + 1; k2 < flat.length && !flat[k2].ev.dyn; k2++) flat[k2].vel = target;
        i = j;
      }
    }
    // text cresc./dim. lines
    for (const sp of spans.filter((q) => (q.kind === 'cresc' || q.kind === 'dim') && q.st === st.id)) {
      const inSpan = flat.filter((f) => (f.m > sp.a.m || (f.m === sp.a.m && f.pos >= sp.a.pos)) && (f.m < sp.b.m || (f.m === sp.b.m && f.pos <= sp.b.pos)));
      inSpan.forEach((f, i) => { f.vel = Math.max(0.08, Math.min(1, f.vel + (sp.kind === 'cresc' ? 0.24 : -0.24) * (i / Math.max(1, inSpan.length - 1)))); });
    }
    // slurs: which notes connect to the next
    let inSlur = false;
    const slurs = spans.filter((q) => q.kind === 'slur' && q.st === st.id && (q.v || 1) === vNo);
    for (const f of flat) {
      if (f.ev.slur === 'start') inSlur = true;
      f.legato = inSlur && f.ev.slur !== 'end';
      f.slurred = inSlur;
      if (f.ev.slur === 'end') inSlur = false;
      for (const sp of slurs) if (inSp(f, sp)) { f.slurred = true; if (f.m < sp.b.m || f.pos < sp.b.pos) f.legato = true; }
    }
    // phrase shaping: lean on strong beats, follow the line up and down, taper phrase ends
    if (expr) {
      let mean = null;
      for (let i = 0; i < flat.length; i++) {
        const f = flat[i]; if (!f.ev.notes || f.ev.rest) { mean = null; continue; }
        const beat = WHOLE / f.time[1];
        const strong = f.pos === 0 ? 0.06 : (f.time[0] % 2 === 0 && f.pos === barTicks(f.time) / 2) ? 0.03 : f.pos % beat === 0 ? 0.0 : -0.03;
        const top = Math.max(...f.ev.notes.map((n) => midiOf(n.s, n.a)));
        mean = mean === null ? top : mean * 0.8 + top * 0.2;
        const CT = globalThis.__contour ?? 0.016, CM = CT * 5;
        const contour = Math.max(-CM, Math.min(CM, (top - mean) * CT));
        const next = flat[i + 1];
        const end = !next || !next.ev.notes || next.ev.rest || f.ev.slur === 'end';
        f.vel = Math.max(0.05, Math.min(1, f.vel * (1 + strong + contour) * (end && f.dur < 1.2 ? 0.94 : 1)));
        f.phraseEnd = end;
      }
    }
    // each phrase rises a little towards its middle and settles at its end (on top of the written
    // dynamics: a soft phrase stays soft, it only breathes)
    if (expr && PHR.length) {
      const A = globalThis.__phrArch ?? ((globalThis.__iowaS ?? 1) && /^(violin|viola|cello)$/.test(sid) ? 0.16 : 0.1);
      const spans2 = PHR.map((ph) => { const ka = ph.a.k, ke = ph.e.k; return { t0: tAt(ka, ph.a.pos), t1: tAt(ke, Math.min(barMap[ke].total, ph.e.pos + ph.e.len)) }; });
      for (const f of flat) {
        if (!f.ev.notes || f.ev.rest) continue;
        const ph = spans2.find((q) => f.t >= q.t0 - 1e-6 && f.t < q.t1);
        if (!ph) continue;
        const pr = Math.max(0, Math.min(1, (f.t - ph.t0) / Math.max(0.05, ph.t1 - ph.t0)));
        f.phr = pr;
        f.vel = Math.max(0.05, Math.min(1, f.vel * (1 + A * Math.sin(Math.PI * Math.pow(pr, 0.8)) - A * 0.4 * Math.max(0, pr - 0.85) / 0.15)));
      }
    }
    // pedal: piano notes ring on to the end of the pedal
    const peds = spans.filter((q) => q.kind === 'ped' && part.staves.some((x) => x.id === q.st));
    const pedEnd = (f) => { for (const pd of peds) { if ((f.m > pd.a.m || (f.m === pd.a.m && f.pos >= pd.a.pos)) && (f.m < pd.b.m || (f.m === pd.b.m && f.pos <= pd.b.pos))) { const k = order.indexOf(pd.b.m); if (k >= 0) { const bf = flat.find((q) => q.m === pd.b.m && q.pos >= pd.b.pos) || null; return bf ? bf.t + bf.dur : tAt(k, barMap[k].total); } } } return null; };
    const trillSpans = spans.filter((q) => q.kind === 'trill' && q.st === st.id);
    // a glissando: from the note where it starts, the pitch slides all the way to the note it ends on
    const glissFrom = new Map();
    for (const q of spans) if (q.kind === 'gliss' && q.st === st.id) {
      const i = flat.findIndex((x) => x.m === q.a.m && x.pos === q.a.pos);
      const j = flat.findIndex((x) => (x.m > q.a.m || (x.m === q.a.m && x.pos > q.a.pos)) && x.ev.notes && !x.ev.rest);
      if (i >= 0 && j > i) { const top = (e) => Math.max(...e.ev.notes.map((n) => midiOf(n.s, n.a))); glissFrom.set(flat[i], top(flat[j])); }
    }
    const inTrill = (f) => trillSpans.some((q) => (f.m > q.a.m || (f.m === q.a.m && f.pos >= q.a.pos)) && (f.m < q.b.m || (f.m === q.b.m && f.pos <= q.b.pos)));
    // pizz. and arco written over the notes of a string instrument: plucked until arco
    if (/violin|viola|cello|^bass$|^basses$|strings/.test(sid)) {
      let pz = false;
      for (const f of flat) { const w = String(f.ev.txt || '').toLowerCase(); if (/\barco\b|\bord\./.test(w)) pz = false; if (/pizz/.test(w)) pz = true; f.pizz = pz; }
    }
    // ---- second pass: notes, with ties joined and ornaments written out
    const open = new Map();
    let drift = 0;
    const add = (n) => notes.push(n);
    for (const f of flat) {
      const ev = f.ev;
      if (!ev.notes || ev.rest) { open.clear(); continue; }
      const ids = [ev.id];
      const arts = ev.art || [];
      // (the strings recorded for real keep their own instrument, plucked or bowed)
      const sidF = f.pizz && !realSet(sid, 'pizz') ? 'pizz' : sid, susF = sustained && !f.pizz;
      const fer = arts.some((a) => a === 'ferm' || a === 'fermS' || a === 'fermL') ? fermatas.find((q) => q.m === f.m) : null;
      let dur = f.dur + (fer ? fer.extra : 0);
      const art = arts.find((a) => ['stacc', 'stacciss', 'ten', 'acc', 'marc'].includes(a)) || null;
      let pe = keyed ? pedEnd(f) : null;
      // (the pianist's own pedal: the note rings until the pedal changes, a little after it)
      if (!pe && keyed && AUTO_PED.has(part.id)) {
        const g = AUTO_PED.get(part.id).find((q) => f.t >= q.t0 - 0.01 && f.t < q.t1 - 0.005);
        if (g) pe = g.light ? Math.min(g.t1, f.t + dur + 0.18) : g.t1 + 0.03;
      }
      if (pe && pe > f.t + dur) dur = pe - f.t;
      if (arts.includes('breath')) dur = Math.max(0.06, dur - 0.18);
      const roll = arts.includes('arp');
      let gOff = 0;
      if (ev.grace && !inst.unpitched && ev.notes.length) {
        // a grace note just before the beat (an appoggiatura takes a little of the beat instead)
        const gq = Math.min(0.08, dur / 3), gm2 = midiOf(ev.grace.s, ev.grace.a || 0);
        const lead = ev.grace.slash === false ? 0 : gq;
        add({ part: part.id, sid: sidF, midi: gm2, t: Math.max(0, f.t - lead), dur: gq * 1.05, vel: f.vel * 0.85, art: null, env: null, ids, m: f.m, pos: f.pos, connect: false });
        if (!lead) { gOff = gq; dur -= gq; }
      }
      const sorted = ev.notes.slice().sort((x, y) => midiOf(x.s, x.a) - midiOf(y.s, y.a));
      sorted.forEach((n, ni) => {
        const midi = inst.unpitched ? (n.perc || inst.unpitched) : midiOf(n.s, n.a);
        const held = open.get(n.s);
        if (held && held.midi === midi) {
          held.dur = f.t + dur - held.t;
          held.ids.push(ev.id);
          if (!n.tie) open.delete(n.s);
          return;
        }
        // (the small unevenness of a player is not random from note to note: it drifts, and each
        // instrument of an ensemble drifts on its own)
        if (humanize && ni === 0) drift = drift * 0.65 + rnd() * 0.7;
        const h = humanize ? drift : 0;
        const t0 = Math.max(0, f.t + gOff + h * (expr ? 0.008 : 0.012) + (roll ? ni * 0.045 : 0));
        // (a keyboard's written dynamics as a pianist's key velocities: f about 86, p about 46)
        // (the piano: the written dynamics as a pianist's key force, p about 46 and f about 86 of 127)
        const kv = (x) => (sid === 'piano' && (globalThis.__keyMap ?? 1) ? pianoKey(x) : x);
        let v = Math.max(0.05, Math.min(1, kv(f.vel) * (1 + (humanize ? rnd() * 0.05 : 0))));
        const head = n.head || ev.head;
        // an artificial harmonic: the stopped note sounds two octaves up, the touched note is silent
        if (head === 'harm' && !inst.unpitched) return;
        const harmBelow = !inst.unpitched && sorted.some((q) => (q.head || ev.head) === 'harm') ? true : false;
        let pm = midi;
        if (harmBelow && ni === 0 && sorted.length > 1) pm = midi + 24;
        if (head === 'ghost') v *= 0.5;
        // a pianist's balance: in the right hand the top of a chord sings and the inner notes are
        // under it, the left hand stays under the right with its bass a little out, and quick
        // accompanying figures are lighter (the steps of a MIDI velocity, as a pianist plays them)
        let lead = 0;
        if (expr && keyed && !inst.unpitched && (globalThis.__voicing ?? 1)) {
          const lower = (si || 0) > 0 && part.staves.length > 1, top = ni === sorted.length - 1, bot = ni === 0;
          let dv = 0;
          if (sorted.length > 1) dv += lower ? (bot ? 3 : -5) : (top ? 5 : -6);
          else if (f.len <= WHOLE / 16) dv -= lower ? 6 : 4;
          if (lower) dv -= 3;
          v = Math.max(0.05, Math.min(1, v + dv / 127));
          if (!lower && top && sorted.length > 1) lead = 0.008;   // (the melody a touch before the chord)
        } else if (expr && keyed && sorted.length > 1 && !inst.unpitched) v *= ni === sorted.length - 1 ? 1.07 : 0.95;
        if (head === 'x' && !inst.unpitched) v *= 0.75;
        const base = { part: part.id, sid: sidF, midi: pm, t: Math.max(0, t0 - lead), dur: dur - (roll ? ni * 0.045 : 0), vel: v, art: f.accent || art, env: f.env, ids, m: f.m, pos: f.pos };
        if (glissFrom.has(f) && ni === sorted.length - 1 && !inst.unpitched) { base.glissTo = glissFrom.get(f); base.dur = dur + 0.03; base.legato = true; }
        // which recording: plucked, short and bouncing (spiccato), or the bow held
        base.kind = f.pizz ? 'pizz' : (art === 'stacc' || art === 'stacciss') && dur < 0.5 ? 'spic' : 'sus';
        if (head === 'x' && !inst.unpitched) { base.dur = Math.min(base.dur, 0.12); base.art = 'stacciss'; }
        if (harmBelow && ni === 0) { base.harm = true; base.vel = v * 0.7; }
        if (expr && susF) {
          if (f.legato && !art) { base.dur = dur + 0.06; base.legato = true; }
          if (f.slurred && flat[flat.indexOf(f) - 1] && flat[flat.indexOf(f) - 1].legato) {
            base.connect = true;
            // the note it comes from (for a little slide between them, as players make)
            const pv = flat[flat.indexOf(f) - 1].ev; if (pv && pv.notes && pv.notes.length === 1 && ev.notes.length === 1) base.from = midiOf(pv.notes[0].s, pv.notes[0].a);
          }
          // separate bows (or tonguings) without a slur: the sound hardly stops between notes, only
          // the change of bow is heard (players keep the line; the old 13% gap sounded like a keyboard)
          // (the solo strings recorded without vibrato: a separate bow is heard as a small break, larger than a slur's)
          const DT = globalThis.__detache ?? ((globalThis.__iowaS ?? 1) && /^(violin|viola|cello)$/.test(sid) ? [0.9, 0.95] : BOWED_SET.test(sid) ? [0.97, 0.99] : [0.9, 0.95]);
          if (!f.slurred && !art && dur > 0.12) base.dur = dur * (dur < 0.4 ? DT[0] : DT[1]);
          if (VIBRATO[sid] && dur > 0.32 && art !== 'stacc' && art !== 'stacciss') base.vib = VIBRATO[sid];
          // long notes breathe: a little swell, then ease off
          if (IOWA_STR && /^(violin|viola|cello)$/.test(sid)) {
            // a string player's swell: every note of some length grows into its middle and gives a
            // little back, each a bit differently (the peak earlier or later, larger on longer notes)
            base.phraseEnd = !!f.phraseEnd; base.phr = f.phr ?? 0.5;
            if (dur > 0.5 && !f.env && !f.hpEnd) {
              const sw = Math.min(0.24, 0.08 + dur * 0.06) * (0.7 + rnd2() * 0.6), pk = 0.35 + rnd2() * 0.25;
              base.env = [[t0 + dur * pk, 1 + sw], [t0 + dur * 0.95, f.phraseEnd ? 0.78 : 0.93 + rnd2() * 0.06]];
            }
          } else if (dur > 0.9 && !f.env && !f.hpEnd) base.env = [[t0 + dur * 0.45, 1.12], [t0 + dur * 0.95, f.phraseEnd ? 0.8 : 0.96]];
        }
        // ornaments, written out
        const upper = (k2) => midiOf(n.s + k2, keyAlterAt(score, f.m, n.s + k2));
        const tremN = arts.includes('trem3') ? 0 : arts.includes('trem2') ? 4 : arts.includes('trem') ? 2 : null;
        if (!inst.unpitched && (arts.includes('trill') || inTrill(f))) {
          const u = upper(1); const step = 0.065; let x = t0, i2 = 0;
          while (x < t0 + dur - 0.04) { add({ ...base, midi: i2 % 2 ? u : midi, t: x, dur: step * 1.1, vel: v * (i2 % 2 ? 0.88 : 0.95), env: null, vib: 0, art: null }); x += step; i2++; }
        } else if (!inst.unpitched && (arts.includes('mord') || arts.includes('prall'))) {
          const o = arts.includes('mord') ? midiOf(n.s - 1, keyAlterAt(score, f.m, n.s - 1)) : upper(1);
          const q = Math.min(0.07, dur / 4);
          add({ ...base, t: t0, dur: q, vib: 0 }); add({ ...base, midi: o, t: t0 + q, dur: q, vel: v * 0.9, vib: 0 }); add({ ...base, t: t0 + 2 * q, dur: dur - 2 * q });
        } else if (!inst.unpitched && (arts.includes('turn') || arts.includes('turnInv'))) {
          const hi = upper(1), lo = midiOf(n.s - 1, keyAlterAt(score, f.m, n.s - 1));
          const seq = arts.includes('turn') ? [hi, midi, lo, midi] : [lo, midi, hi, midi];
          const q = Math.min(0.09, dur / 6);
          seq.forEach((mm, i3) => add({ ...base, midi: mm, t: t0 + i3 * q, dur: i3 === 3 ? dur - 3 * q : q, vel: v * (i3 ? 0.9 : 1), vib: i3 === 3 ? base.vib : 0 }));
        } else if (tremN !== null) {
          // the strokes add to the note's own flags: a quarter with one stroke plays eighths, an eighth with one stroke sixteenths
          const flags = ev.t >= 8 ? Math.log2(ev.t) - 2 : 0, strokes = arts.includes('trem3') ? 3 : arts.includes('trem2') ? 2 : 1;
          const subT = Math.pow(2, 2 + flags + strokes);
          const step = strokes >= 3 && subT >= 32 && f.dur / f.len * (WHOLE / subT) < 0.05 ? 0.05 : f.dur / Math.max(1, f.len / (WHOLE / subT));
          // an unmeasured tremolo of a string: its own recording, held
          if (strokes >= 3 && realSet(sid, 'trem') && !f.pizz) add({ ...base, kind: 'trem', vib: 0 });
          else for (let x = t0; x < t0 + dur - 0.02; x += Math.max(0.04, step)) add({ ...base, t: x, dur: Math.max(0.04, step) * 0.95, vel: v * (0.9 + rnd() * 0.1), env: null, vib: 0, kind: base.kind === 'sus' && step < 0.3 ? 'spic' : base.kind });
        } else {
          add(base);
          if (n.tie) open.set(n.s, base); else open.delete(n.s);
        }
      });
      for (const k of [...open.keys()]) if (!ev.notes.some((n) => n.s === k)) open.delete(k);
    }
    for (const f of flat) marks.push({ t: f.t, m: f.m, pos: f.pos, id: f.ev.id, dur: f.dur });
  }
  notes.sort((a, b) => a.t - b.t);
  marks.sort((a, b) => a.t - b.t);
  return { notes, marks, total, order, barStart };
}
function keyAlterAt(score, m, s) { return keyAlter(keyAt(score, m), s); }

// ---------- live playback ----------
// (the range of strength a note passes through: its own, and where its swell or fade takes it)
const envSpan = (n) => (n.env && n.env.length ? [n.vel, ...n.env.map(([, ev]) => n.vel * ev)] : null);
export class ScorePlayer {
  constructor() { this.playing = false; this.onTick = null; this.onEnd = null; }
  async play(score, { from = 0, pos = 0 } = {}) {
    this.stop();
    const tok = this._tok;
    const tl = buildTimeline(score, { from });
    this.tl = tl;
    // (from a note in the middle of the bar: the music before it in that bar is left out)
    let skip = 0;
    if (pos > 0) { const mk = tl.marks.find((q) => q.m === from && q.pos >= pos); if (mk) skip = Math.max(0, mk.t - 0.005); }
    let first = 0; while (first < tl.notes.length && tl.notes[first].t < skip) first++;
    this.skip = skip;
    sampler.live();
    applyScoreSound(sampler, score);
    this.loading = true;
    await sampler.prepare(tl.notes.slice(first, first + 400).flatMap((n) => [n.vel, ...(envSpan(n) || []).slice(1)].map((vel) => ({ sid: n.sid, midi: n.midi, kind: n.kind, vel }))));
    // (Stop pressed while the sounds were loading: it does not start after all)
    if (tok !== this._tok) return;
    sampler.prepare(tl.notes.slice(first + 400).flatMap((n) => [n.vel, ...(envSpan(n) || []).slice(1)].map((vel) => ({ sid: n.sid, midi: n.midi, kind: n.kind, vel }))));
    this.loading = false;
    const ctx = getCtx();
    this.t0 = ctx.currentTime + 0.12 - skip;
    this.next = first; this.playing = true; wantAudio(true, 'compose');
    const pump = async () => {
      if (!this.playing) return;
      // (iOS replaced the sound system meanwhile: playing stops here rather than going on silent)
      if (getCtx() !== ctx) { this.stop(); if (this.onEnd) this.onEnd(); return; }
      const now = ctx.currentTime - this.t0;
      while (this.next < tl.notes.length && tl.notes[this.next].t < now + 0.6) {
        const n = tl.notes[this.next++];
        const ch = sampler.channels.get(n.part) || sampler.channel(n.part, n.sid, DEFAULT_MIX());
        const smp = await sampler.sampleFor(n.sid, n.midi, n.kind, n.vel, envSpan(n)).catch(() => null);
        if (!this.playing) return;
        sampler.noteOn(ch, smp, n.midi, this.t0 + n.t, n.dur, n.vel, { art: n.art, env: n.env ? n.env.map(([et, ev]) => [this.t0 + et, ev]) : null, vib: n.vib, legato: n.legato, connect: n.connect, from: n.from, harm: n.harm, glissTo: n.glissTo });
      }
      if (this.onTick) {
        const sounding = new Set();
        for (const mk of tl.marks) { if (mk.t > now) break; if (now < mk.t + mk.dur) sounding.add(mk.id); }
        const cur = tl.marks.filter((mk) => mk.t <= now).pop();
        this.onTick({ now, sounding, mark: cur });
      }
      if (now > tl.total + 0.3) { this.stop(); if (this.onEnd) this.onEnd(); return; }
      this.timer = setTimeout(pump, 40);
    };
    pump();
  }
  stop() {
    this._tok = (this._tok || 0) + 1; this.loading = false;
    if (this.playing) wantAudio(false, 'compose');
    this.playing = false; clearTimeout(this.timer);
    sampler.stopAll(0.12);
  }
}

export function applyScoreSound(smp, score) {
  const snd = score.sound || {};
  smp.setRoom(snd.room || 'hall');
  smp.setRoomMix(snd.roomMix ?? 1);
  smp.tuning = snd.tuning || 440;
  smp.plain = snd.plainStrings === true;   // (the classic string sounds, chosen in the mixer)
  const anySolo = score.parts.some((p) => p.mix && p.mix.solo);
  for (const p of score.parts) {
    const sid = p.sound || (INST[p.inst] || INST.piano).sound;
    const ch = smp.channel(p.id, sid, p.mix || DEFAULT_MIX());
    smp.applyMix(ch, p.mix || DEFAULT_MIX(), anySolo);
  }
}

// ---------- render the score to a sound file ----------
export async function renderAudio(score, onProgress) {
  const tl = buildTimeline(score, { from: 0 });
  sampler.live();
  sampler.plain = (score.sound || {}).plainStrings === true;
  await sampler.prepare(tl.notes.flatMap((n) => [n.vel, ...(envSpan(n) || []).slice(1)].map((vel) => ({ sid: n.sid, midi: n.midi, kind: n.kind, vel }))));
  // studio quality: 48 kHz, 24-bit, with the room's whole tail (a very long piece: CD quality,
  // so the iPad's memory is never at risk)
  const long = tl.total > 420, sr = long ? 44100 : 48000;
  const len = Math.ceil((tl.total + 5) * sr);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(2, len, sr);
  const s2 = new Sampler();
  s2.buffers = sampler.buffers;
  s2.attach(off, off.destination);
  applyScoreSound(s2, score);
  let i = 0;
  const one = async (n) => {
    const smp = await s2.sampleFor(n.sid, n.midi, n.kind, n.vel, envSpan(n)).catch(() => null);
    s2.noteOn(s2.channels.get(n.part), smp, n.midi, 0.2 + n.t, n.dur, n.vel, { art: n.art, env: n.env ? n.env.map(([et, ev]) => [0.2 + et, ev]) : null, vib: n.vib, legato: n.legato, connect: n.connect, from: n.from, harm: n.harm, glissTo: n.glissTo });
  };
  // A long or full score: its notes are added a few seconds ahead of the rendering (a graph of every
  // note at once renders very slowly: an orchestral movement took many minutes)
  const chunked = typeof off.suspend === 'function' && tl.notes.length > 400 && (globalThis.__chunkRender ?? 1);
  let buf;
  if (chunked) {
    const notes = tl.notes.slice().sort((a, b) => a.t - b.t), BLOCK = 4;
    const addUntil = async (tEnd) => { while (i < notes.length && 0.2 + notes[i].t < tEnd) await one(notes[i++]); };
    await addUntil(BLOCK);
    const T = len / sr;
    for (let b = 1; b * BLOCK < T; b++) off.suspend(b * BLOCK - 0.5).then(async () => { await addUntil((b + 1) * BLOCK); if (onProgress) onProgress(0.05 + 0.9 * Math.min(1, (b * BLOCK) / T)); off.resume(); });
    buf = await off.startRendering();
  } else {
    for (const n of tl.notes) { await one(n); if (++i % 200 === 0 && onProgress) onProgress(0.3 * (i / tl.notes.length)); }
    if (onProgress) onProgress(0.35);
    buf = await off.startRendering();
  }
  if (onProgress) onProgress(1);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // the silence after the last sound goes (the tail of the room stays), then a short fade
  let end = L.length, peak = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; }
  const quiet = Math.max(1e-5, peak * 0.0003);   // about -70 dB under the loudest moment
  while (end > sr && Math.abs(L[end - 1]) < quiet && Math.abs(R[end - 1]) < quiet) end--;
  end = Math.min(L.length, end + Math.round(sr * 0.3));
  const fade = Math.round(sr * 0.25);
  for (let i = 0; i < fade && end - 1 - i >= 0; i++) { const g = i / fade; L[end - 1 - i] *= g; R[end - 1 - i] *= g; }
  // as loud as it can be without ever clipping: the loudest moment at -1 dB
  const gain = globalThis.__noNorm ? 1 : peak > 0 ? Math.min(4, 0.891 / peak) : 1;
  const l = L.subarray(0, end), r = R.subarray(0, end);
  if (gain !== 1) for (let i = 0; i < end; i++) { l[i] *= gain; r[i] *= gain; }
  return encodeWav([l, r], sr, long ? 16 : 24);
}
