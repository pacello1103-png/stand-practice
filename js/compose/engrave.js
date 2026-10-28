// Engraving: lays a score out on pages (spacing by duration, systems, pages) and draws it with
// the Bravura music font, following common engraving rules: stems by position, beams by beat,
// accidentals by bar, ledger lines, ties, slurs, articulations, dynamics, hairpins, tuplets,
// clefs, keys and time signatures, instrument names, bar numbers and multi-bar rests (parts).
// All lengths are in staff spaces (sp); a page is drawn at any scale.
import { INST, PAGE_SIZES } from './instruments.js';
import { voiceView, hasVoice2,
  WHOLE, barTicks, barNumber, timeAt, keyAt, tempoAt, clefAt, clefEnd, ticksOf, CLEFS, keyAlter, keySteps, midiOf, toWritten, writtenKey, staffInfo, isEmptyStaff,
} from './model.js';

// ---------- glyphs (SMuFL code points) ----------
export const GL = {
  orn: { mord: '', prall: '', turn: '', turnInv: '', stopped: '', open: '', snapA: '', snapB: '', fermSA: '', fermSB: '', fermLA: '', fermLB: '', caes: '', trem2: '', trem3: '', arp: '', wiggle: '', tr: '' },
  ott: { '8va': '', '8vb': '', '15ma': '', '15mb': '' }, ped: '', pedUp: '',
  noteWhole: '', noteHalf: '', noteBlack: '', noteX: '', noteDoubleWhole: '',
  // note heads other than the normal ones (SMuFL: X and diamond), by duration: whole, half, black
  headX: { 1: '\uE0A9', 2: '\uE0A9', 4: '\uE0A7' }, headDia: { 1: '\uE0DE', 2: '\uE0DE', 4: '\uE0DB' },
  flagUp: { 8: '', 16: '', 32: '', 64: '' }, flagDown: { 8: '', 16: '', 32: '', 64: '' },
  rest: { 1: '', 2: '', 4: '', 8: '', 16: '', 32: '', 64: '' },
  acc: { '-2': '', '-1': '', 0: '', 1: '', 2: '' },
  dot: '', brace: '',
  ts: (d) => String.fromCharCode(0xE080 + d), common: '', cut: '',
  dyn: { p: '', m: '', f: '', r: '', s: '', z: '', n: '' },
  art: {
    stacc: ['', ''], stacciss: ['', ''], ten: ['', ''], acc: ['', ''], marc: ['', ''],
    ferm: ['', ''], down: ['', ''], up: ['', ''], harm: ['', ''], trill: ['', ''],
    trem: ['', ''], breath: ['', ''],
  },
  tuplet: (n) => String(n).split('').map((d) => String.fromCharCode(0xE880 + +d)).join(''), quarterUp: '', eighthUp: '', halfUp: '',
  repeatDot: '', segno: '', coda: '',
  // note heads: [whole, half, black]
  heads: {
    x: ['\uE0A7', '\uE0A8', '\uE0A9'], diamond: ['\uE0D8', '\uE0D9', '\uE0DC'], harm: ['\uE0D8', '\uE0D9', '\uE0D9'],
    slash: ['\uE102', '\uE103', '\uE100'], tri: ['\uE0BC', '\uE0BD', '\uE0BE'], square: ['\uE0B8', '\uE0B8', '\uE0B9'],
    circlex: ['\uE0B3', '\uE0B3', '\uE0B3'],
  },
  parenL: '\uE0F5', parenR: '\uE0F6',
};
let MUSIC_FONT = 'Bravura';
// for testing the reader against other engravings (dev pages only)
export function setMusicFont(f) { MUSIC_FONT = f; metricCache.clear(); }
export const TEXT_FONT = '"Times New Roman", "Iowan Old Style", Georgia, serif';

// Glyph extents measured from the font itself (in sp, for a font size of 4 sp).
const metricCache = new Map();
let mctx = null;
export function gm(g) {
  let m = metricCache.get(g);
  if (m) return m;
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = `400px ${MUSIC_FONT}`;
  const t = mctx.measureText(g);
  m = { w: t.width / 100, l: -(t.actualBoundingBoxLeft || 0) / 100, r: (t.actualBoundingBoxRight || t.width) / 100, a: (t.actualBoundingBoxAscent || 0) / 100, d: (t.actualBoundingBoxDescent || 0) / 100 };
  metricCache.set(g, m);
  return m;
}
export function clearMetrics() { metricCache.clear(); }

const DYN_LETTERS = (d) => d.split('').map((c) => GL.dyn[c]).join('');
export const DYNAMICS = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sfz', 'sf', 'sffz', 'fz', 'sfp', 'fp', 'rfz'];

// ---------- spacing ----------
const space = (ticks) => 1.3 + 1.65 * Math.log2(1 + (ticks / (WHOLE / 4)) * 2.2);
const HEAD_W = 1.18, STEM_LEN = 3.5, STEM_T = 0.12;

function keyPositions(fifths, clef) {
  if (!fifths || clef === 'perc') return [];
  const sharpT = [8, 5, 9, 6, 3, 7, 4], flatT = [4, 7, 3, 6, 2, 5, 1];
  const tenorS = [2, 6, 3, 7, 4, 8, 5];
  // any clef: the treble clef's pattern moved by how far its bottom line is from the treble clef's
  const bottom = (CLEFS[clef] || CLEFS.treble).bottom;
  let off = (((30 - bottom) % 7) + 7) % 7; if (off > 3) off -= 7;
  const fit = (p) => { while (p < 0) p += 7; while (p > 10) p -= 7; return p; };
  if (fifths > 0) {
    const pat = clef === 'tenor' ? tenorS : clef === 'soprano' ? tenorS.map((p) => p + 1) : sharpT.map((p) => fit(p + off));
    return pat.slice(0, fifths).map((p) => ({ p, g: GL.acc[1] }));
  }
  return flatT.map((p) => fit(p + off)).slice(0, -fifths).map((p) => ({ p, g: GL.acc[-1] }));
}
// room before a note for its accidentals (a reminder accidental in brackets needs more)
const n0acc = (ev) => (ev.notes.some((n) => n.cau) ? 1.8 : 1);
const keyWidth = (fifths) => (fifths ? Math.abs(fifths) * 1.0 + 0.6 : 0);
const timeWidth = (time) => (time ? Math.max(String(time[0]).length, String(time[1]).length) * 1.8 + 1.0 : 0);

// ---------- beams ----------
function beatGroup(time) {
  const [n, d] = time;
  if (d === 8 && n % 3 === 0) return (WHOLE / 8) * 3;
  if (d === 8) return WHOLE / 8 * (n <= 4 ? n : 2);
  if (d === 2) return WHOLE / 4;
  return WHOLE / d;
}

// =====================================================================
// Layout
// =====================================================================
// opts: { partIndex (only this part, as a part), concert, staffMm, page, landscape, multiRests, hideEmpty, width/height override }
export function layoutScore(score, opts = {}) {
  const L = { ...score.layout, ...opts };
  const concert = opts.partIndex !== undefined ? false : L.concert !== false;
  const [pwMm, phMm] = PAGE_SIZES[L.page] || PAGE_SIZES.A4;
  const pageW = L.landscape ? phMm : pwMm, pageH = L.landscape ? pwMm : phMm;
  const spMm = (L.staffMm || 7) / 4;
  const W = pageW / spMm, H = pageH / spMm;
  // (the same margin left and right, as printed music has; a little more at the foot)
  const margin = { l: 12 / spMm, r: 12 / spMm, t: 13 / spMm, b: 15 / spMm };
  // staves on show
  let info = staffInfo(score).map((x, k) => ({ ...x, k }));
  if (opts.partIndex !== undefined) info = info.filter((x) => x.pi === opts.partIndex);
  const nM = score.measures.length;

  // ---- per measure: columns of onsets across the staves on show
  const cols = [];
  for (let m = 0; m < nM; m++) {
    const time = timeAt(score, m);
    const total = barTicks(time);
    const onsets = new Map();
    let hasAcc = false;
    for (const s of info) for (const bar of [s.st.bars[m] || [], hasVoice2(s.st, m) ? s.st.v2[m] : []]) {
      let p = 0;
      for (const ev of bar) {
        const len = ticksOf(ev, time);
        const o = onsets.get(p) || { acc: 0, dots: 0, full: false, grace: 0 };
        if (ev.grace && ev.notes) o.grace = 1;
        if (ev.clef) o.clef = 1;
        if (ev.full) o.full = true;
        if (ev.dots) o.dots = Math.max(o.dots, ev.dots);
        if (ev.notes && ev.notes.some((n) => n.a || n.cau)) { o.acc = Math.max(o.acc, n0acc(ev)); hasAcc = true; }
        if (ev.notes && ev.notes.length > 1) o.acc = Math.max(o.acc, ev.notes.filter((n) => n.a).length > 2 ? 2 : o.acc);
        onsets.set(p, o);
        p += len;
      }
    }
    if (!onsets.size) onsets.set(0, { acc: 0, dots: 0, full: true });
    const times = [...onsets.keys()].sort((a, b) => a - b);
    const segs = times.map((t, i) => {
      const next = i + 1 < times.length ? times[i + 1] : total;
      const o = onsets.get(t);
      return { t, w: space(next - t) + (o.dots ? 0.45 * o.dots : 0), pre: (o.acc ? 1.1 * o.acc : 0) + (o.grace ? 2.3 : 0) + (o.clef ? 2.8 : 0) };
    });
    const allFull = times.length === 1 && onsets.get(0).full;
    let ideal = 1.3 + segs.reduce((a, s) => a + s.w + s.pre, 0);
    if (allFull) ideal = Math.max(ideal, 20);          // empty bars as wide as a written bar of quavers (about four to a line, as Sibelius)
    const ms = score.measures[m];
    // changes drawn inside the line
    const prevKey = m ? keyAt(score, m - 1) : null;
    const keyChange = m > 0 && ms.key !== undefined && ms.key !== null && ms.key !== prevKey;
    const timeChange = m > 0 && !!ms.time;
    const clefChange = m > 0 && info.some((s) => clefAt(s.st, m) !== clefEnd(s.st, m - 1));
    cols.push({ m, time, total, segs, ideal, allFull, keyChange, timeChange, clefChange, hasAcc, ms });
  }
  // ---- multi-bar rests (parts): runs of empty bars with nothing else going on
  const groups = [];
  for (let m = 0; m < nM; m++) {
    if (L.multiRests && cols[m].allFull && !cols[m].ms.tempo && !cols[m].ms.text && !cols[m].ms.rehearsal && !(cols[m].keyChange || cols[m].timeChange || cols[m].clefChange)) {
      let e = m;
      while (e + 1 < nM && cols[e + 1].allFull && !cols[e + 1].keyChange && !cols[e + 1].timeChange && !cols[e + 1].ms.tempo && !cols[e + 1].ms.rehearsal && !cols[e].ms.bar) e++;
      if (e > m) { groups.push({ m, end: e, multi: e - m + 1 }); m = e; continue; }
    }
    groups.push({ m, end: m, multi: 0 });
  }

  // ---- instrument names
  const parts = [...new Set(info.map((x) => x.pi))];
  const nameSize = 1.55;
  const nameW = (txt) => txt.length * nameSize * 0.48;
  const showNames = opts.partIndex === undefined && score.parts.length > 1;
  const indentFirst = showNames ? Math.min(18, Math.max(...parts.map((pi) => nameW(score.parts[pi].name))) + 2) : 3;
  const indentOther = showNames ? Math.min(10, Math.max(...parts.map((pi) => nameW(score.parts[pi].abbr))) + 2) : 0;

  // ---- systems
  const systems = [];
  let gi = 0;
  while (gi < groups.length) {
    const first = !systems.length;
    const indent = first ? indentFirst : indentOther;
    const avail = W - margin.l - margin.r - indent;
    const m0 = groups[gi].m;
    // the start of each line: clef, key, time
    const key0 = keyAt(score, m0);
    const keyW = Math.max(...info.map((s) => keyWidth(concert ? key0 : writtenKey(key0, s.inst))), 0);
    const head = 1 + 3.2 + keyW + (first || cols[m0].timeChange ? timeWidth(cols[m0].time) : 0) + 0.6;
    let used = head, list = [];
    while (gi < groups.length) {
      const g = groups[gi];
      const c = cols[g.m];
      const w = g.multi ? 14 : c.ideal + (c.ms.start === 'repeat' ? 2 : 0) + (c.clefChange && list.length ? 2.8 : 0) + (c.keyChange && list.length ? keyWidth(c.ms.key) + 1 : 0) + (c.timeChange && list.length ? timeWidth(c.time) : 0);
      if (list.length && used + w * 0.86 > avail) break;
      list.push({ ...g, w });
      used += w;
      gi++;
      // a line (or page) break chosen after this bar
      if (score.measures[g.end ?? g.m] && score.measures[g.end ?? g.m].brk) break;
    }
    const lastBar = list.length ? list[list.length - 1] : null;
    const brk = lastBar ? (score.measures[lastBar.end ?? lastBar.m] || {}).brk || null : null;
    systems.push({ groups: list, indent, head, avail, used, first, brk });
  }
  // don't leave one bar alone on the last line: bring the bar before it down too
  if (systems.length > 1) {
    const last = systems[systems.length - 1], prev = systems[systems.length - 2];
    const g = prev.groups[prev.groups.length - 1], c = g && cols[g.m];
    if (last.groups.length === 1 && prev.groups.length >= 3 && !prev.brk && !g.multi && !last.groups[0].multi && c && !c.timeChange && !c.keyChange && !c.clefChange && !cols[last.groups[0].m].timeChange && !cols[last.groups[0].m].keyChange) {
      prev.groups.pop(); prev.used -= g.w;
      last.groups.unshift(g); last.used += g.w;
    }
  }
  // justify each system
  for (const [si, sy] of systems.entries()) {
    const fixed = sy.head;
    const flex = sy.used - fixed;
    const last = si === systems.length - 1;
    const want = sy.avail - fixed;
    const k = (last || sy.brk) && sy.used / sy.avail < 0.62 ? 1 : want / flex;
    let x = margin.l + sy.indent + fixed;
    sy.x0 = margin.l + sy.indent; sy.x1 = (last || sy.brk) && k === 1 ? x + flex : W - margin.r;
    sy.measures = sy.groups.map((g) => {
      const w = g.w * k;
      const mm = { ...g, x0: x, x1: x + w, k };
      x += w;
      return mm;
    });
  }

  // ---- vertical: the same distances everywhere, as engraved music has them
  // Between the staves of one system and between the systems the distance is one standard (or the
  // one chosen in Layout), the same on every line and every page; it only grows (for the whole
  // score, so it stays even) when notes far above or below would otherwise touch the next staff.
  // Distances in staff spaces, from the bottom line of one staff to the top line of the next.
  const pages = [];
  let page = null, y = 0;
  const newPage = () => { page = { n: pages.length, systems: [], W, H }; pages.push(page); y = margin.t + (pages.length === 1 ? titleHeight(score, spMm, opts) : 0); };
  newPage();
  const userStaff = +L.staffGap > 0 ? +L.staffGap : 0, userSys = +L.sysGap > 0 ? +L.sysGap : 0;
  const staffGapSame = userStaff ? Math.max(3, userStaff - 0.8) : 6.2, staffGapOther = userStaff || 7.0;
  // which staves show on each system (empty staves can be hidden in big scores), and how far
  // each reaches above and below
  const plan = systems.map((sy) => {
    let shown = info;
    if (L.hideEmpty && opts.partIndex === undefined && !sy.first) {
      shown = info.filter((s) => sy.measures.some((mm) => { for (let m = mm.m; m <= mm.end; m++) if ((s.st.bars[m] || []).some((e) => !e.rest)) return true; return false; }));
      if (!shown.length) shown = [info[0]];
    }
    return { shown, ext: shown.map((s) => staffExtent(score, s, sy, concert)) };
  });
  // the gap above each staff (by staff), the same in every system: the standard, or more if notes
  // somewhere in the score need it (only a little: an odd high note may come close)
  // (chosen by you: exactly that; the standard: a space and a half more at most)
  const GROW = userStaff || userSys ? 0 : 1.5;
  const gapAbove = new Map();
  for (const { shown, ext } of plan) shown.forEach((s, i) => {
    if (!i) return;
    const base = shown[i - 1].pi === s.pi ? staffGapSame : staffGapOther;
    const need = ext[i - 1].below + ext[i].above + 0.6;
    const g = Math.max(base, Math.min(need, base + GROW));
    gapAbove.set(s.k, Math.max(gapAbove.get(s.k) || 0, g));
  });
  // the distance from one system to the next: one for the whole score
  const nMax = Math.max(...plan.map((q) => q.shown.length));
  const sysBase = userSys || (nMax > 1 ? 11 : 8.5);
  let sysGap = sysBase;
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1].ext, b = plan[i].ext;
    sysGap = Math.max(sysGap, Math.min(a[a.length - 1].below + b[0].above + 1, sysBase + GROW));
  }
  let pageNext = false;
  for (const [si, sy] of systems.entries()) {
    const { shown, ext } = plan[si];
    const tops = [0];
    for (let i = 1; i < shown.length; i++) tops.push(tops[i - 1] + 4 + (gapAbove.get(shown[i].k) || staffGapOther));
    const height = tops[tops.length - 1] + 4;
    // (room above the first system of a page for what stands over it: a tempo, words)
    const above = Math.max(2.5, ext[0].above + (sy.measures.some((mm) => score.measures[mm.m].tempo || score.measures[mm.m].text || score.measures[mm.m].rehearsal) ? 3 : 0.5));
    const below = Math.max(2, ext[ext.length - 1].below);
    const firstOnPage = !page.systems.length;
    const topHere = firstOnPage ? y + above : y + sysGap;
    if (!firstOnPage && (topHere + height + below > H - margin.b || pageNext)) newPage();
    pageNext = sy.brk === 'page';
    const top = page.systems.length ? topHere : y + above;
    page.systems.push({ ...sy, top, staves: shown.map((s, i) => ({ ...s, y: top + tops[i] })), height, above, below, concert });
    y = top + height;
  }
  // spread the systems down the page when the page is mostly full
  // (only when asked for: the distances stay the same on every page otherwise)
  for (const pg of L.justify ? pages : []) {
    if (pg.systems.length < 2) continue;
    const last = pg.systems[pg.systems.length - 1];
    const bottom = last.top + last.height + last.below;
    const free = H - margin.b - bottom;
    const full = bottom / (H - margin.b);
    // (a page ended on purpose, with room left, keeps its systems together)
    if (full < 0.68 && pg !== pages[pages.length - 1]) continue;
    if (last.brk === 'page' && full < 0.85) continue;
    if (pg === pages[pages.length - 1] && full < 0.8) continue;
    // (a little more room between the systems, never so much that they float apart)
    const add = Math.min(free / (pg.systems.length - 1), pg.systems[0].staves.length > 1 ? 3 : 2);
    pg.systems.forEach((s, i) => { const d = add * i; s.top += d; s.staves.forEach((st) => { st.y += d; }); });
  }
  return { pages, W, H, spMm, margin, score, opts: L, concert, partIndex: opts.partIndex };
}

function titleHeight(score, spMm, opts) {
  let h = 0;
  if (score.title) h += 13 / spMm;
  if (score.subtitle) h += 6 / spMm;
  if (score.composer || opts.partIndex !== undefined) h += 7 / spMm;
  return h ? h + 4 / spMm : 0;
}

// How far notes reach above and below the staff in a system (sp beyond the staff).
function staffExtent(score, s, sy, concert) {
  let above = 0, below = 0, notesBelow = 0, hasLyr = false, hasDyn = false;
  for (const mm of sy.measures) for (let m = mm.m; m <= mm.end; m++) {
    const clef0 = clefAt(s.st, m);
    const time = timeAt(score, m), all = [];
    for (const bar of [s.st.bars[m] || [], hasVoice2(s.st, m) ? s.st.v2[m] : []]) { let pos = 0, c = clef0; for (const ev of bar) { if (ev.clef) c = ev.clef; all.push([ev, pos, c]); pos += ticksOf(ev, time); } }
    for (const [ev, pos, clef] of all) {
      const ott = ottavaAt(score, s.st.id, m, pos);
      if (ev.dyn || ev.hp || (ev.txt && ev.txtBelow)) { below = Math.max(below, 3.2); hasDyn = true; }
      if (ev.txt) above = Math.max(above, 2.8);
      if (ev.fing || ev.str) above = Math.max(above, 1.6 + (ev.fing ? 1.45 * String(ev.fing).split(/[\s,]+/).filter(Boolean).length : 0) + (ev.str ? 1.6 : 0));
      if (ev.chord) above = Math.max(above, ev.txt ? 5.2 : 3.4);
      if (ev.lyric) hasLyr = true;
      if (!ev.notes) continue;
      for (const n0 of ev.notes) {
        const n = concert ? n0 : toWritten(n0, s.inst);
        const p = n.s - ott - CLEFS[clef].bottom;
        if (p > 8) above = Math.max(above, (p - 8) / 2 + (p >= 6 ? 0.5 : STEM_LEN));
        if (p < 0) below = Math.max(below, -p / 2 + (p <= 2 ? 0.6 : STEM_LEN));
        if (p < 0) notesBelow = Math.max(notesBelow, -p / 2 + 0.6);
        if (p >= 4 && p < 9) below = Math.max(below, 0);
        if (p < 4 && p > 0) above = Math.max(above, 0);
      }
      // a tuplet's number sits beyond the stems (above for stems up, below for stems down)
      if (ev.tup) {
        const ps = ev.notes.map((n0) => (concert ? n0 : toWritten(n0, s.inst)).s - ott - CLEFS[clef].bottom);
        const hi = Math.max(...ps), lo = Math.min(...ps);
        if ((hi + lo) / 2 < 4) above = Math.max(above, hi / 2 + STEM_LEN - 4 + 2.6);
        else below = Math.max(below, STEM_LEN - lo / 2 + 2.6);
      }
    }
  }
  // lines over the notes take room too
  const mA = sy.measures[0].m, mB = sy.measures[sy.measures.length - 1].end ?? sy.measures[sy.measures.length - 1].m;
  for (const sp of score.spans || []) {
    if (sp.b.m < mA || sp.a.m > mB) continue;
    if (sp.kind === 'volta') { if (s.pi === 0 && s.part && s.part.staves[0] === s.st) above = Math.max(above, 3.6); continue; }
    if (sp.st !== s.st.id) continue;
    if (['trill', '8va', '15ma', 'rit', 'accel'].includes(sp.kind)) above += 2.6;
    if (['8vb', '15mb', 'ped', 'cresc', 'dim'].includes(sp.kind)) below += 2.8;
    if (['8vb', '15mb'].includes(sp.kind)) below += 1.2;
    if (sp.kind === 'hairpin') { below = Math.max(below, 3.2); hasDyn = true; }
    if (sp.kind === 'slur') { above = Math.max(above + 1.0, 1.4); below = Math.max(below + 0.8, 1.2); }
  }
  for (let m = mA; m <= mB; m++) { const ms = score.measures[m]; if (ms && (ms.mark || ms.jump)) above = Math.max(above, 3.2); }
  // lyrics run on one line for the whole system, under the lowest note (and the dynamics)
  let lyr = 0;
  if (hasLyr) { lyr = Math.max(4.2, notesBelow + 2.6, hasDyn ? Math.max(3.0, notesBelow + 2.9) + 2.6 : 0); below = Math.max(below, lyr + 1.2); }
  s.lyr = lyr;
  // dynamics and hairpins sit under the lowest note, so they need that room as well
  if (hasDyn) below = Math.max(below, Math.max(3.0, notesBelow + 2.9) + 0.9);
  return { above: above + 0.8, below: below + 0.8, lyr };
}

// =====================================================================
// Drawing
// =====================================================================
// Draws one page. ctx is already scaled so that 1 unit = 1 sp. Returns the hit map of the page.
export function drawPage(ctx, lay, pageIndex, opts = {}) {
  const page = lay.pages[pageIndex];
  const score = lay.score;
  const ink = opts.ink || '#16181d';
  const hit = { staves: [], events: [], spans: [], marks: [] }; CUR_HIT = hit;
  ctx.save();
  ctx.fillStyle = opts.paper || '#ffffff'; ctx.fillRect(0, 0, lay.W, lay.H);
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  ctx.textBaseline = 'alphabetic';
  if (pageIndex === 0) drawTitle(ctx, lay);
  else text(ctx, String(pageIndex + 1), lay.W - lay.margin.r, lay.margin.t * 0.6, 1.5, TEXT_FONT, '', 'right');
  if (lay.partIndex !== undefined && pageIndex > 0) text(ctx, score.parts[lay.partIndex].name, lay.margin.l, lay.margin.t * 0.6, 1.4, TEXT_FONT, 'italic');
  for (const sys of page.systems) drawSystem(ctx, lay, sys, hit, opts);
  ctx.restore();
  return hit;
}

function drawTitle(ctx, lay) {
  const s = lay.score, sp = lay.spMm;
  let y = lay.margin.t;
  if (s.title) { y += 9 / sp; text(ctx, s.title, lay.W / 2, y, 8.5 / sp, TEXT_FONT, '600', 'center'); }
  if (s.subtitle) { y += 6 / sp; text(ctx, s.subtitle, lay.W / 2, y, 4.4 / sp, TEXT_FONT, '', 'center'); }
  y += 7 / sp;
  if (s.composer) text(ctx, s.composer, lay.W - lay.margin.r, y, 3.9 / sp, TEXT_FONT, '', 'right');
  if (lay.partIndex !== undefined) text(ctx, s.parts[lay.partIndex].name, lay.margin.l, y, 4.2 / sp, TEXT_FONT, '600', 'left');
}

// while a marking (articulation, ornament, dynamic) is drawn, where it lands is kept, so it can be tapped
let CUR_MARK = null;
// a box that can be tapped to choose what is drawn there (a clef, a time signature, a tempo...)
const hitBox = (o, x0, x1, y0, y1) => { if (CUR_HIT && CUR_HIT.marks) CUR_HIT.marks.push({ ...o, x0, x1, y0, y1 }); };
export const glyph = (ctx, g, x, y, size = 4) => { if (CUR_MARK && CUR_HIT && CUR_HIT.marks) { const m = gm(g), k = size / 4; CUR_HIT.marks.push({ ...CUR_MARK, x0: x + m.l * k, x1: x + m.r * k, y0: y - m.a * k, y1: y + m.d * k }); } ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100); ctx.font = `100px ${MUSIC_FONT}`; ctx.textAlign = 'left'; ctx.fillText(g, 0, 0); ctx.restore(); };
// Text in sp units: font is a CSS font without size, e.g. 'italic 600' + family
export function text(ctx, str, x, y, size, font = TEXT_FONT, style = '', align = 'left') {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100);
  ctx.font = `${style} 100px ${font}`.trim(); ctx.textAlign = align; ctx.fillText(str, 0, 0); ctx.restore();
}
export function textWidth(ctx, str, size, font = TEXT_FONT, style = '') {
  ctx.save(); ctx.font = `${style} 100px ${font}`.trim(); const w = ctx.measureText(str).width * size / 100; ctx.restore(); return w;
}
const line = (ctx, x0, y0, x1, y1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };

function drawSystem(ctx, lay, sys, hit, opts) {
  const score = lay.score;
  const x0 = sys.x0, x1 = sys.x1;
  const staves = sys.staves;
  const top = staves[0].y, bottom = staves[staves.length - 1].y + 4;
  ctx.lineCap = 'butt';
  // staff lines
  for (const s of staves) for (let l = 0; l < 5; l++) line(ctx, x0, s.y + l, x1, s.y + l, 0.13);
  // system line, brackets and braces
  if (staves.length > 1) line(ctx, x0, top, x0, bottom, 0.16);
  drawBrackets(ctx, sys, staves);
  // instrument names
  if (lay.partIndex === undefined && score.parts.length > 1) {
    const done = new Set();
    const nx = sys.x0 - (staves.length > 1 ? 2.6 : 1.4);
    for (const s of staves) {
      if (done.has(s.pi)) continue; done.add(s.pi);
      const ps = staves.filter((x) => x.pi === s.pi);
      const yy = (ps[0].y + ps[ps.length - 1].y + 4) / 2 + 0.55;
      text(ctx, sys.first ? s.part.name : s.part.abbr, nx - (ps[0].inst.brace && ps.length > 1 ? 1.2 : 0), yy, 1.55, TEXT_FONT, '', 'right');
    }
  }
  // bar number at the start of each line (not the first)
  const m0 = sys.measures[0].m;
  if (m0 > 0) text(ctx, String(barNumber(score, m0)), x0, top - 1.6, 1.3, TEXT_FONT, 'italic');
  // start of the line: clef, key, time
  const key0 = keyAt(score, m0), time0 = timeAt(score, m0);
  const showTime = sys.first || score.measures[m0].time;
  const maxKW = Math.max(0, ...staves.map((q) => keyWidth(lay.concert ? key0 : writtenKey(key0, q.inst))));
  for (const s of staves) {
    const clef = clefAt(s.st, m0);
    CUR_MARK = { id: s.st.id + '@' + m0, kind: 'clef', name: clef, m: m0, st: s.st.id };
    drawClef(ctx, clef, x0 + 1, s.y); if (clef === 'perc') hitBox(CUR_MARK, x0 + 0.6, x0 + 2.2, s.y + 0.6, s.y + 3.4);
    const k = lay.concert ? key0 : writtenKey(key0, s.inst);
    CUR_MARK = k ? { id: 'key' + m0, kind: 'key', name: String(key0), m: m0 } : null;
    drawKey(ctx, k, clef, x0 + 4.4, s.y);
    CUR_MARK = showTime ? { id: 'time' + m0, kind: 'time', name: time0.join('/'), m: m0 } : null;
    if (showTime) drawTime(ctx, time0, x0 + 4.4 + maxKW + 0.2, s.y, score.measures[m0].timeSym);
    CUR_MARK = null;
  }
  const hitStaves = staves.map((s) => ({ k: s.k, st: s.st, part: s.part, inst: s.inst, y: s.y, x0, x1, measures: [] }));
  hit.staves.push(...hitStaves);
  // measures
  for (const [mi, mm] of sys.measures.entries()) {
    drawMeasure(ctx, lay, sys, mm, mi, hitStaves, hit, opts);
  }
  // one level for the dynamics and hairpins of each staff on this line
  for (const [i, hs] of hitStaves.entries()) {
    let low = 0; for (const hm of hs.measures) low = Math.max(low, hm.dynLow || 0);
    // (a slur under the notes here, where every stem is up: the dynamics go under it, not through it)
    const mA = sys.measures[0].m, mB = sys.measures[sys.measures.length - 1].end ?? sys.measures[sys.measures.length - 1].m;
    const evAll = hs.measures.flatMap((hm) => (hm.events || []).map((q) => ({ ...q, m: hm.m })));
    const slurUnder = (score.spans || []).some((q) => q.kind === 'slur' && q.st === hs.st.id && !(q.b.m < mA || q.a.m > mB) && (() => { const ev = evAll.filter((e) => (e.m > q.a.m || (e.m === q.a.m && e.pos >= q.a.pos)) && (e.m < q.b.m || (e.m === q.b.m && e.pos <= q.b.pos)) && e.notes && e.notes.length); return ev.length && ev.every((e) => e.up); })());
    hs.dynLine = Math.max(3.0, low + 2.9 + (slurUnder ? 2.0 : 0));
    // the upper staff of a piano (or harp, organ…): dynamics go in the middle, between the two staves
    const next = hitStaves[i + 1];
    if (next && next.part === hs.part) {
      const gap = next.y - (hs.y + 4);
      hs.dynLine = Math.max(hs.dynLine, gap / 2 + 0.75);
      // …unless that would reach into the staff below; then they stay just under the notes
      if (hs.dynLine > gap - 0.6) hs.dynLine = Math.max(3.0, low + 2.9);
      hs.dynMax = Math.max(hs.dynLine, gap - 1.2);
    }
    for (const hm of hs.measures) for (const d of hm.dyns || []) {
      if (d.c) { ctx.save(); ctx.fillStyle = d.c; }
      if (d.txt) { CUR_MARK = d.id ? { id: d.id, kind: 'txt', name: d.txt } : null; text(ctx, d.txt, d.x, hs.y + 4 + hs.dynLine, 1.7, TEXT_FONT, d.it ? 'italic' : ''); CUR_MARK = null; if (d.c) ctx.restore(); continue; }
      CUR_MARK = d.id ? { id: d.id, kind: 'dyn', name: d.dyn } : null; glyph(ctx, DYN_LETTERS(d.dyn), d.x, hs.y + 4 + hs.dynLine); CUR_MARK = null;
      if (d.c) ctx.restore();
    }
  }
  drawSpans(ctx, lay, sys, hitStaves);
  drawMarks(ctx, lay, sys, hitStaves);
  // the barline at the end of the line
}

// ---------- lines over several notes: trills, octave lines, pedal, endings, rit./accel., gliss. ----------
export const OTT_SHIFT = { '8va': 7, '8vb': -7, '15ma': 14, '15mb': -14 };
const before = (a, b) => a.m < b.m || (a.m === b.m && a.pos <= b.pos);
function ottavaAt(score, stId, m, pos) {
  for (const sp of score.spans || []) if (OTT_SHIFT[sp.kind] && sp.st === stId && before(sp.a, { m, pos }) && before({ m, pos }, sp.b)) return OTT_SHIFT[sp.kind];
  return 0;
}
function findEv(score, id) { for (const p of score.parts) for (const st of p.staves) for (const bar of st.bars) for (const e of bar) if (e.id === id) return e; return null; }
function spanX(hs, at, end) {
  // the x of a note (its left edge, or its right edge for the end of a line)
  const hm = hs.measures.find((q) => q.m === at.m); if (!hm) return null;
  const ev = (hm.events || []).filter((q) => q.pos <= at.pos).pop();
  if (ev) return end ? ev.x + HEAD_W + 0.2 : ev.x - 0.2;
  return end ? hm.x1 - 0.6 : hm.cx0;
}
function dashed(ctx, x0, x1, y, dash = 0.7, gapL = 0.6, w = 0.13) { ctx.save(); ctx.lineWidth = w; ctx.setLineDash([dash, gapL]); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore(); }
const spanHit = (sp, x0, x1, y0, y1) => { if (CUR_HIT) CUR_HIT.spans.push({ id: sp.id, kind: sp.kind, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) }); };
function drawSpans(ctx, lay, sys, hitStaves) {
  const score = lay.score;
  const spans = score.spans || []; if (!spans.length) return;
  const mA = sys.measures[0].m, mB = sys.measures[sys.measures.length - 1].end ?? sys.measures[sys.measures.length - 1].m;
  const contentX = sys.x0 + sys.head;
  for (const q of hitStaves) q.slurTops = [];
  // slurs and hairpins first, endings last (an ending goes above any slur under it)
  for (const sp of [...spans].sort((p, q) => (p.kind === 'volta') - (q.kind === 'volta'))) {
    if (sp.b.m < mA || sp.a.m > mB) continue;
    const hs = sp.kind === 'volta' ? hitStaves[0] : hitStaves.find((q) => q.st.id === sp.st);
    if (!hs) continue;
    const startsHere = sp.a.m >= mA, endsHere = sp.b.m <= mB;
    let x0 = startsHere ? spanX(hs, sp.a, false) : contentX;
    let x1 = endsHere ? spanX(hs, sp.b, true) : sys.x1;
    if (x0 === null || x1 === null) continue;
    // how high or low the notes under the line reach
    const evs = hs.measures.flatMap((q) => q.events || []).filter((q) => q.x >= x0 - 0.5 && q.x <= x1 + 0.5);
    let top = hs.y - 1.6, bot = hs.y + 5.6;
    for (const q of evs) for (const n of q.notes) { top = Math.min(top, n.y - (q.up ? STEM_LEN + 0.6 : 1.4)); bot = Math.max(bot, n.y + (q.up ? 1.4 : STEM_LEN + 0.6)); }
    // above words and ornaments of those notes
    let dynUnder = false;
    for (const q of evs) { const f = findEv(score, q.id); if (!f) continue; if (f.txt) top = Math.min(top, hs.y - 3.6); if (f.art && f.art.some((a) => ['mord', 'prall', 'turn', 'turnInv', 'stopped', 'open', 'snap', 'ferm', 'fermS', 'fermL', 'trill', 'up', 'down', 'harm'].includes(a))) top = Math.min(top, hs.y - 3.4); if (f.dyn || f.hp) { bot = Math.max(bot, hs.y + 7.6); dynUnder = true; } }
    // (a hairpin of its own under these notes counts as a dynamic too)
    if (!dynUnder) dynUnder = spans.some((q) => q.kind === 'hairpin' && q.st === sp.st && !(q.b.m < sp.a.m || q.a.m > sp.b.m));
    const k = sp.kind;
    if (k === 'slur' || k === 'hairpin') { drawSlurOrHairpin(ctx, lay, sys, hs, sp, startsHere, endsHere, contentX); continue; }
    if (k === 'trill') {
      const y = Math.min(top, hs.y - 1.8) - 0.4;
      glyph(ctx, GL.orn.tr, x0, y + 0.6);
      const w = gm(GL.orn.wiggle).r || 0.9; let x = x0 + 2.1;
      if (!startsHere) x = x0;
      while (x + w < x1) { glyph(ctx, GL.orn.wiggle, x, y); x += w; }
      spanHit(sp, x0, x1, y - 1.6, y + 0.9);
    } else if (OTT_SHIFT[k]) {
      const above = OTT_SHIFT[k] > 0;
      // (an octave line below goes under the dynamics there, clear of their tails)
      const y = above ? Math.min(top, hs.y - 2.2) - 0.3 : Math.max(bot, hs.y + 6.2) + 2.0 + (dynUnder ? 1.2 : 0);
      const g = GL.ott[k]; const m = gm(g);
      if (startsHere) glyph(ctx, g, x0, y + (above ? 0 : 0), 3.4);
      const tx = startsHere ? x0 + (m.r || 2) * 0.85 + 0.4 : x0;
      dashed(ctx, tx, x1, above ? y - 0.9 : y - 1.3, 0.55, 0.55);
      if (endsHere) { ctx.save(); ctx.lineWidth = 0.13; ctx.beginPath(); ctx.moveTo(x1, above ? y - 0.9 : y - 1.3); ctx.lineTo(x1, above ? y + 0.3 : y - 2.5); ctx.stroke(); ctx.restore(); }
      spanHit(sp, x0, x1, y - 2.4, y + 0.6);
    } else if (k === 'ped') {
      const y = Math.max(bot, hs.y + 6.4) + 1.9;
      if (startsHere) glyph(ctx, GL.ped, x0, y, 3.6);
      if (sp.line === false) { if (endsHere) glyph(ctx, GL.pedUp, x1 - 1.2, y, 3.6); }
      else {
        const lx = startsHere ? x0 + 3.6 : x0;
        ctx.save(); ctx.lineWidth = 0.14; ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(x1, y); if (endsHere) ctx.lineTo(x1, y - 1.2); ctx.stroke(); ctx.restore();
      }
      spanHit(sp, x0, x1, y - 2.2, y + 0.6);
    } else if (k === 'rit' || k === 'accel' || k === 'cresc' || k === 'dim') {
      const word = { rit: 'rit.', accel: 'accel.', cresc: 'cresc.', dim: 'dim.' }[k];
      const below = k === 'cresc' || k === 'dim';
      const y = below ? Math.max(bot, hs.y + 6.4) + 1.6 : Math.min(top, hs.y - 1.8) - 0.4;
      const style = below ? 'italic' : 'italic';
      let x = x0;
      if (startsHere) { text(ctx, word, x0, y, 1.9, TEXT_FONT, style); x = x0 + textWidth(ctx, word, 1.9, TEXT_FONT, style) + 0.6; }
      if (x1 - x > 1.5) dashed(ctx, x, x1, y - 0.5, 0.5, 1.0);
      spanHit(sp, x0, Math.max(x1, x0 + 2.5), y - 1.8, y + 0.5);
    } else if (k === 'gliss') {
      const a = evs[0], b = evs[evs.length - 1];
      if (!a || !b || a === b) continue;
      const ya = a.notes[0] ? a.notes[a.notes.length - 1].y : hs.y + 2, yb = b.notes[0] ? b.notes[b.notes.length - 1].y : hs.y + 2;
      const xa = a.x + HEAD_W + 0.35, xb = b.x - 0.35 - (b.notes.length ? 0 : 0);
      ctx.save(); ctx.lineWidth = 0.14; ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
      const ang = Math.atan2(yb - ya, xb - xa); ctx.translate((xa + xb) / 2, (ya + yb) / 2 - 0.35); ctx.rotate(ang);
      const w = textWidth(ctx, 'gliss.', 1.3, TEXT_FONT, 'italic'); if (w < Math.hypot(xb - xa, yb - ya) - 0.6) text(ctx, 'gliss.', -w / 2, 0, 1.3, TEXT_FONT, 'italic');
      ctx.restore();
      spanHit(sp, xa, xb, Math.min(ya, yb) - 0.8, Math.max(ya, yb) + 0.5);
    } else if (k === 'volta') {
      const hsTop = hitStaves[0];
      const ma = hsTop.measures.find((q) => q.m === Math.max(sp.a.m, mA)), mb = hsTop.measures.find((q) => q.m === Math.min(sp.b.m, mB));
      if (!ma || !mb) continue;
      const vx0 = ma.x0 + 0.3, vx1 = mb.x1 - 0.5;
      let y = hsTop.y - 3.2;
      for (let m = Math.max(sp.a.m - 1, 0); m <= sp.b.m; m++) { const ms = score.measures[m]; if (ms && (ms.jump || ms.mark)) y = Math.min(y, hsTop.y - 5.6); }
      for (const q of hsTop.measures.filter((q) => q.m >= sp.a.m && q.m <= sp.b.m).flatMap((q) => q.events || [])) for (const n of q.notes) y = Math.min(y, n.y - (q.up ? STEM_LEN + 1.0 : 2.0));
      for (const t of hsTop.slurTops || []) if (t.x1 > vx0 && t.x0 < vx1) y = Math.min(y, t.y - 0.9);
      ctx.save(); ctx.lineWidth = 0.14; ctx.beginPath();
      if (startsHere) { ctx.moveTo(vx0, y + 2); ctx.lineTo(vx0, y); } else ctx.moveTo(vx0, y);
      ctx.lineTo(vx1, y); if (endsHere && sp.closed !== false) ctx.lineTo(vx1, y + 2);
      ctx.stroke(); ctx.restore();
      if (startsHere) text(ctx, (sp.n || 1) + '.', vx0 + 0.5, y + 1.6, 1.6, TEXT_FONT, '');
      spanHit(sp, vx0, vx1, y - 0.5, y + 2.2);
    }
  }
}
// the event of a voice at a place in a bar on show
function evAt(hs, at, v) {
  const hm = hs.measures.find((q) => q.m === at.m); if (!hm) return null;
  const list = (hm.events || []).filter((q) => (q.voice || 1) === (v || 1));
  let best = null; for (const q of list) if (q.pos <= at.pos) best = q;
  return best || list[0] || null;
}
// how far a note reaches below the staff (with a tuplet number under its stem)
const lowestOf = (q) => { let h = 0; for (const n of q.notes) h = Math.max(h, -n.p / 2 + (!q.up ? STEM_LEN + (q.tup ? 2.3 : 0) : 0.5)); return h; };
let CUR_HIT = null;   // the hit map of the page being drawn (slurs and hairpins can be dragged)
// A slur or a hairpin over any number of notes, across bars and from one line to the next.
function drawSlurOrHairpin(ctx, lay, sys, hs, sp, startsHere, endsHere, contentX) {
  const v = sp.v || 1;
  let a = startsHere ? evAt(hs, sp.a, v) : null, b = endsHere ? evAt(hs, sp.b, v) : null;
  // the notes under the line on this system
  const inRange = (q) => (q.voice || 1) === v && (q.m > sp.a.m || (q.m === sp.a.m && q.pos >= sp.a.pos)) && (q.m < sp.b.m || (q.m === sp.b.m && q.pos <= sp.b.pos));
  const evs = hs.measures.flatMap((q) => q.events || []).filter(inRange);
  if (sp.kind === 'hairpin') {
    let dyn = hs.dynLine || 3.0;
    for (const q of evs) if (q.notes.length) dyn = Math.max(dyn, lowestOf(q) + 2.9);
    if (hs.dynMax) dyn = Math.min(dyn, hs.dynMax);   // never into the staff below (piano)
    const yy = hs.y + 4 + dyn - 0.55 + (sp.off || 0);
    const f = a ? findEv(lay.score, a.id) : null;
    let xa = a ? a.x + (f && f.dyn ? 3.6 : 0) : contentX - 0.4;
    // it ends just before the next dynamic, or at the end of its last note
    let xb = sys.x1 - 0.6;
    if (b) {
      const nextEv = hs.measures.flatMap((q) => q.events || []).filter((q) => (q.voice || 1) === v && (q.m > b.m || (q.m === b.m && q.pos > b.pos)))[0];
      const nf = nextEv ? findEv(lay.score, nextEv.id) : null;
      const bf = findEv(lay.score, b.id);
      if (a && a.id === b.id) {
        // over one note: through the note, to just before what follows
        xb = nf && nf.dyn ? nextEv.x - 0.8 : nextEv ? nextEv.x - 0.9 : (hs.measures.find((q) => q.m === b.m) || { x1: b.x + 3 }).x1 - 0.8;
      } else if (bf && bf.dyn) {
        // to a dynamic: it stops just before the dynamic's letters (under the note head)
        xb = b.x - 0.9;
      } else {
        // to a note: it ends under that note's head, as engravers do
        xb = b.x + HEAD_W + 0.15;
      }
    }
    if (startsHere) xa += sp.ax || 0;
    if (endsHere) xb += sp.bx || 0;
    if (!startsHere && xb - xa < 2.2) return;   // only a stub left before the dynamic that ends it
    if (xb - xa < 1.2) xb = xa + 1.2;
    const open = 0.75;
    // across a line break the opening continues where it left off
    const o0 = sp.dir === '<' ? (startsHere ? 0 : open * 0.45) : (startsHere ? open : open * 0.55);
    const o1 = sp.dir === '<' ? (endsHere ? open : open * 0.55) : (endsHere ? 0 : open * 0.45);
    ctx.save(); ctx.lineWidth = 0.14; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(xa, yy - o0); ctx.lineTo(xb, yy - o1); ctx.moveTo(xa, yy + o0); ctx.lineTo(xb, yy + o1); ctx.stroke(); ctx.restore();
    if (CUR_HIT) CUR_HIT.spans.push({ id: sp.id, kind: 'hairpin', x0: xa, x1: xb, y0: yy - open - 0.4, y1: yy + open + 0.4 });
    return;
  }
  // slur: below when every stem points up, otherwise above (a second voice: always on its side)
  const withNotes = evs.filter((q) => q.notes.length);
  if (!withNotes.length) return;
  // an end on a rest (a note was deleted): the slur takes the nearest note inside it instead
  if (startsHere && !(a && a.notes.length)) a = withNotes[0];
  if (endsHere && !(b && b.notes.length)) b = withNotes[withNotes.length - 1];
  if (startsHere && endsHere && a === b && withNotes.length < 2 && sp.a.m === sp.b.m && sp.a.pos !== sp.b.pos) return;
  const twoVoices = hs.measures.some((q) => (q.events || []).some((e) => e.voice === 2));
  const above = v === 2 ? false : twoVoices ? true : !withNotes.every((q) => q.up);
  const dir = above ? -1 : 1;
  const topY = (q) => q.notes.reduce((m2, n) => Math.min(m2, n.y), 1e9);
  const botY = (q) => q.notes.reduce((m2, n) => Math.max(m2, n.y), -1e9);
  // how far a note (with its stem, articulations) reaches on the slur's side
  const reach = (q) => {
    const stemSide = above ? q.up : !q.up;
    if (stemSide && q.stemTip !== undefined) return q.stemTip;
    return above ? topY(q) - 0.5 : botY(q) + 0.5;
  };
  // the ends: at the note head (off the stem side), or by the end of the stem (on it), as engravers do
  const endPt = (q, isStart) => {
    const stemSide = above ? q.up : !q.up;
    if (stemSide && q.stemTip !== undefined) {
      const sx = q.stemX ?? (q.up ? q.x + HEAD_W : q.x);
      // a short slur starting at a stem-up note sits just right of the stem tip; ending, just left
      return { x: isStart ? sx + 0.15 : sx - 0.15, y: q.stemTip + dir * 0.55 };
    }
    // (clear of the staccato, tenuto or accent on that side: the slur goes round them)
    const f = findEv(lay.score, q.id), arts = (f && f.art) || [];
    const near = arts.filter((x) => ['stacc', 'stacciss', 'ten', 'acc', 'marc'].includes(x)).length;
    const y = (above ? topY(q) - 0.75 : botY(q) + 0.75) + dir * (near ? near * 1.3 + 0.55 : 0);
    return { x: q.x + HEAD_W / 2 + (isStart ? 0.1 : -0.1), y };
  };
  const inner0 = withNotes.filter((q) => q !== a && q !== b);
  let A = a && a.notes.length ? endPt(a, true) : null, B = b && b.notes.length ? endPt(b, false) : null;
  // a slur broken by the end of the line: it runs to the line's edge, level with the notes there
  if (!A) { const f0 = inner0[0] || b; A = { x: contentX - 0.4, y: f0 ? reach(f0) + dir * 0.9 : (above ? hs.y - 1 : hs.y + 5) }; }
  if (!B) { const l0 = inner0[inner0.length - 1] || a; B = { x: sys.x1 - 0.3, y: l0 ? reach(l0) + dir * 0.9 : A.y }; }
  if (B.x - A.x < 1.2) B.x = A.x + 1.2;
  const len = B.x - A.x;
  // keep the slope gentle: very uneven ends are pulled towards each other
  const maxSlope = Math.min(0.5, 2.5 / Math.max(1, len) + 0.12);
  const slope = (B.y - A.y) / len;
  if (Math.abs(slope) > maxSlope) {
    const fix = (Math.abs(slope) - maxSlope) * len;
    // move the end that sits nearer the staff further out
    if ((B.y - A.y) * dir > 0) A.y += dir * fix; else B.y += dir * fix;
  }
  // height grows with length, like Sibelius' default slurs
  let h = Math.min(2.0, 0.45 + 0.2 * Math.sqrt(len));
  // clear every note in between: first by lifting the curve, then by moving the whole slur out
  let shift = 0;
  for (const q of inner0) {
    const x = q.x + HEAD_W / 2, tt = (x - A.x) / len; if (tt <= 0.02 || tt >= 0.98) continue;
    const lin = A.y + (B.y - A.y) * tt;
    const bez = 3 * tt * (1 - tt) * 0.75 + 0.0;                 // the curve's lift there per unit of height (approx.)
    const need = (lin - (reach(q) + dir * 0.6)) * -dir;         // > 0: the note pokes through the straight line
    const lift = h * bez * 1.0;
    if (need + 0.35 > lift) {
      const more = need + 0.35 - lift;
      // up to a point the curve gets taller; beyond that the ends move out too
      const dh = Math.min(more / Math.max(0.3, bez), Math.max(0, 3.2 - h));
      h += dh; const rest = more - dh * bez; if (rest > 0) shift = Math.max(shift, rest);
    }
  }
  A.y += dir * shift; B.y += dir * shift;
  // moved by hand (dragged up or down; each end; the height of the curve)
  if (sp.off) { A.y += sp.off; B.y += sp.off; }
  if (startsHere) { A.x += sp.ax || 0; A.y += sp.ay || 0; }
  if (endsHere) { B.x += sp.bx || 0; B.y += sp.by || 0; }
  if (B.x - A.x < 1) B.x = A.x + 1;
  if (sp.hd) h = Math.max(0.25, h + sp.hd);
  // the tips never sit on a staff line (they would seem to touch it): just off it, outwards
  const offLine = (y) => { const r = y - hs.y; if (r < -0.3 || r > 4.3) return y; const k = Math.round(r); return Math.abs(r - k) < 0.22 ? hs.y + k + dir * 0.25 : y; };
  A.y = offLine(A.y); B.y = offLine(B.y);
  drawSlur(ctx, A.x, A.y, B.x, B.y, above, h);
  if (CUR_HIT) CUR_HIT.spans.push({ id: sp.id, kind: 'slur', above, x0: A.x, x1: B.x, y0: Math.min(A.y, B.y) - (above ? h : 0) - 0.4, y1: Math.max(A.y, B.y) + (above ? 0 : h) + 0.4 });
  // remembered, so endings (voltas) above go over the slur instead of through it
  if (above) (hs.slurTops = hs.slurTops || []).push({ x0: Math.min(A.x, B.x), x1: Math.max(A.x, B.x), y: Math.min(A.y, B.y) - h - 0.2 });
}
// segno and coda signs, D.C. / D.S. / To Coda / Fine
const JUMP_TEXT = { dc: 'D.C.', dcfine: 'D.C. al Fine', dccoda: 'D.C. al Coda', ds: 'D.S.', dsfine: 'D.S. al Fine', dscoda: 'D.S. al Coda', tocoda: 'To Coda', fine: 'Fine' };
function drawMarks(ctx, lay, sys, hitStaves) {
  const score = lay.score, hs = hitStaves[0]; if (!hs) return;
  for (const mm of hs.measures) {
    const ms = score.measures[mm.m]; if (!ms) continue;
    let top = hs.y - 2.4;
    for (const q of mm.events || []) for (const n of q.notes) top = Math.min(top, n.y - (q.up ? STEM_LEN + 1.0 : 2.0));
    if (ms.mark === 'segno' || ms.mark === 'coda') { CUR_MARK = { id: 'mk' + mm.m, kind: 'mmark', name: ms.mark, m: mm.m }; glyph(ctx, ms.mark === 'segno' ? GL.segno : GL.coda, mm.x0 + 0.4, top - 0.4, 3.2); CUR_MARK = null; }
    if (ms.jump) {
      const t = JUMP_TEXT[ms.jump] || ms.jump;
      const w = textWidth(ctx, t, 1.9, TEXT_FONT, 'italic');
      const x = mm.x1 - w - 0.4;
      text(ctx, t, x, top - 0.3, 1.9, TEXT_FONT, 'italic'); hitBox({ id: 'jp' + mm.m, kind: 'jump', name: ms.jump, m: mm.m }, x - 0.3, x + w + 0.3, top - 2.2, top + 0.4);
      if (ms.jump === 'tocoda') { const cm = gm(GL.coda); glyph(ctx, GL.coda, x - (cm.r || 2) * 0.65 - 0.6, top - 0.15, 2.6); }
    }
  }
}

function drawBrackets(ctx, sys, staves) {
  // brace for keyboards and harps; bracket for groups of the same family
  const byPart = new Map();
  for (const s of staves) { if (!byPart.has(s.pi)) byPart.set(s.pi, []); byPart.get(s.pi).push(s); }
  for (const ps of byPart.values()) {
    if (ps.length > 1 && ps[0].inst.brace) {
      const t = ps[0].y, b = ps[Math.min(ps.length, ps[0].inst.braceStaves || ps.length) - 1].y + 4;
      const h = b - t;
      const bw = gm(GL.brace).r * (h / 4);
      ctx.save(); ctx.translate(sys.x0 - 0.45 - bw, b); ctx.scale(h / 4, h / 4); glyph(ctx, GL.brace, 0, 0, 4); ctx.restore();
      line(ctx, sys.x0, t, sys.x0, b, 0.16);
    }
  }
  if (staves.length < 2) return;
  let i = 0;
  while (i < staves.length) {
    const fam = staves[i].inst.fam;
    let j = i;
    while (j + 1 < staves.length && staves[j + 1].inst.fam === fam && !['keys', 'pluck'].includes(fam)) j++;
    const multiParts = new Set(staves.slice(i, j + 1).map((s) => s.pi)).size > 1;
    if (multiParts || (j > i && !staves[i].inst.brace)) {
      const t = staves[i].y - 0.5, b = staves[j].y + 4.5, x = sys.x0 - 1.0;
      ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, b); ctx.stroke();
      ctx.lineWidth = 0.18;
      ctx.beginPath(); ctx.moveTo(x - 0.25, t); ctx.quadraticCurveTo(x + 0.6, t - 0.1, x + 1.6, t - 1.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 0.25, b); ctx.quadraticCurveTo(x + 0.6, b + 0.1, x + 1.6, b + 1.1); ctx.stroke();
    }
    i = j + 1;
  }
}

export function drawClef(ctx, clef, x, sy, size = 4) {
  const c = CLEFS[clef] || CLEFS.treble;
  if (clef === 'perc') { const yy = sy + 2; line(ctx, x + 0.6, yy - 1, x + 0.6, yy + 1, 0.45); line(ctx, x + 1.4, yy - 1, x + 1.4, yy + 1, 0.45); return; }
  glyph(ctx, c.glyph, x, sy + 4 - c.line, size);
}
export function drawKey(ctx, fifths, clef, x, sy) {
  keyPositions(fifths, clef).forEach((k, i) => glyph(ctx, k.g, x + i * 1.0, sy + 4 - k.p / 2));
}
export function drawTime(ctx, time, x, sy, sym) {
  if (!time) return;
  if (sym === 'common' && time[0] === 4 && time[1] === 4) { glyph(ctx, GL.common, x, sy + 2); return; }
  if (sym === 'cut' && time[0] === 2 && time[1] === 2) { glyph(ctx, GL.cut, x, sy + 2); return; }
  const digits = (n) => String(n).split('').map((d) => GL.ts(+d)).join('');
  const a = digits(time[0]), b = digits(time[1]);
  const wa = String(time[0]).length * 1.8, wb = String(time[1]).length * 1.8, w = Math.max(wa, wb);
  glyph(ctx, a, x + (w - wa) / 2, sy + 1);
  glyph(ctx, b, x + (w - wb) / 2, sy + 3);
}

// positions on the staff: 0 = bottom line, 8 = top line
const yOf = (sy, p) => sy + 4 - p / 2;

function drawMeasure(ctx, lay, sys, mm, mi, hitStaves, hit, opts) {
  const score = lay.score;
  const m = mm.m;
  const ms = score.measures[m];
  const time = timeAt(score, m);
  const lastInSys = mi === sys.measures.length - 1;
  let cx = mm.x0;
  // key and time changes inside the line
  const isFirst = mi === 0;
  if (isFirst) cx = sys.x0 + sys.head - 0.4; else {
    // a change of clef: a smaller clef before the key and time
    let clefMoved = false;
    for (const s of sys.staves) { const c2 = clefAt(s.st, m); if (m > 0 && c2 !== clefEnd(s.st, m - 1)) { CUR_MARK = { id: s.st.id + '@' + m, kind: 'clef', name: c2, m, st: s.st.id }; drawClef(ctx, c2, cx + 0.5, s.y, 3); CUR_MARK = null; clefMoved = true; } }
    if (clefMoved) cx += 2.8;
    const key = keyAt(score, m), prevKey = keyAt(score, m - 1);
    if (ms.key !== undefined && ms.key !== null && key !== prevKey && m > 0) {
      CUR_MARK = { id: 'key' + m, kind: 'key', name: String(key), m };
      for (const s of sys.staves) {
        const clef = clefAt(s.st, m);
        // cancel the old key with naturals when going to C
        if (key === 0) keyPositions(lay.concert ? prevKey : writtenKey(prevKey, s.inst), clef).forEach((kp, i) => glyph(ctx, GL.acc[0], cx + 0.6 + i * 1.0, yOf(s.y, kp.p)));
        else drawKey(ctx, lay.concert ? key : writtenKey(key, s.inst), clef, cx + 0.6, s.y);
      }
      CUR_MARK = null;
      cx += keyWidth(key || prevKey) + 1;
    }
    if (ms.time) { CUR_MARK = { id: 'time' + m, kind: 'time', name: ms.time.join('/'), m }; for (const s of sys.staves) drawTime(ctx, ms.time, cx + 0.5, s.y, ms.timeSym); CUR_MARK = null; cx += timeWidth(ms.time); }
  }
  const contentX0 = cx + 1.3 + (ms.start === 'repeat' ? 2 : 0);
  // ---- barline at the end of the bar
  const top = sys.staves[0].y, bot = sys.staves[sys.staves.length - 1].y + 4;
  const bx = mm.x1;
  drawBarline(ctx, ms.bar || (lastInSys && mm.end === score.measures.length - 1 ? 'final' : 'single'), bx, sys.staves, lay);
  if (ms.bar && ms.bar !== 'single' && !(ms.bar === 'final' && m === score.measures.length - 1)) hitBox({ id: 'bar' + m, kind: 'barline', name: ms.bar, m }, bx - 2.4, bx + 0.25, top, bot);
  if (ms.start === 'repeat') { const rx = isFirst ? sys.x0 + sys.head - 1.2 : mm.x0; drawRepeatStart(ctx, rx, sys.staves); hitBox({ id: 'rs' + m, kind: 'repstart', name: 'repeat', m }, rx - 0.2, rx + 2.4, top, bot); }
  // ---- above the bar: tempo, rehearsal marks, text
  if (ms.tempo && (ms.tempo.text || (ms.tempo.bpm && ms.tempo.show !== false))) { const tx = isFirst ? sys.x0 + sys.head : contentX0 - 0.8, ty = top - Math.max(3.2, sys.above - 0.6); const tw = drawTempo(ctx, ms.tempo, tx, ty); hitBox({ id: 'tempo' + m, kind: 'tempo', name: ms.tempo.text || String(ms.tempo.bpm), m }, tx - 0.2, tx + Math.max(2, tw || 6), ty - 2.2, ty + 0.6); }
  if (ms.rehearsal) { const tx = mm.x0 + 0.2, ty = top - Math.max(3.5, sys.above - 0.6); const w = textWidth(ctx, ms.rehearsal, 2.1, TEXT_FONT, '700'); ctx.lineWidth = 0.15; ctx.strokeRect(tx - 0.4, ty - 2, w + 0.8, 2.5); text(ctx, ms.rehearsal, tx, ty, 2.1, TEXT_FONT, '700'); hitBox({ id: 'reh' + m, kind: 'rehearsal', name: ms.rehearsal, m }, tx - 0.5, tx + w + 0.5, ty - 2.1, ty + 0.6); }

  // ---- multi-bar rest
  if (mm.multi) {
    for (const [k, s] of sys.staves.entries()) {
      const xa = contentX0 + 0.5, xb = mm.x1 - 1.8;
      ctx.fillRect(xa, s.y + 1.5, xb - xa, 1); line(ctx, xa, s.y + 1, xa, s.y + 3, 0.16); line(ctx, xb, s.y + 1, xb, s.y + 3, 0.16);
      const n = String(mm.multi).split('').map((d) => GL.ts(+d)).join('');
      glyph(ctx, n, (xa + xb) / 2 - String(mm.multi).length * 0.9, s.y - 1.4);
      hitStaves[k].measures.push({ m, x0: mm.x0, x1: mm.x1, cx0: contentX0, onsets: [{ t: 0, x: contentX0 }], total: barTicks(time), end: mm.end });
    }
    return;
  }
  // ---- onset positions shared by every staff
  const col = layColumns(lay, m);
  const xs = new Map();
  let x = contentX0;
  for (const sg of col.segs) { x += sg.pre * mm.k; xs.set(sg.t, x); x += sg.w * mm.k; }
  const onsets = [...xs.entries()].map(([t, xx]) => ({ t, x: xx }));
  for (const [k, s] of sys.staves.entries()) {
    const hs = hitStaves[k];
    const hm = { m, x0: mm.x0, x1: mm.x1, cx0: contentX0, onsets, total: barTicks(time), events: [] };
    hs.measures.push(hm);
    // two voices: the first with stems up, the second with stems down
    if (hasVoice2(s.st, m)) {
      drawStaffBar(ctx, lay, sys, s, m, time, xs, mm, hm, hit, { ...opts, voiceDir: 'up' });
      drawStaffBar(ctx, lay, sys, { ...s, st: voiceView(s.st, 2, lay.score) }, m, time, xs, mm, hm, hit, { ...opts, voiceDir: 'down', voice2: true });
    } else drawStaffBar(ctx, lay, sys, s, m, time, xs, mm, hm, hit, opts);
  }
}
function layColumns(lay, m) {
  if (!lay._cols) lay._cols = new Map();
  if (!lay._cols.has(m)) {
    // recompute like the layout did
    const score = lay.score, time = timeAt(score, m), total = barTicks(time);
    const onsets = new Map();
    let info = staffInfo(score);
    if (lay.partIndex !== undefined) info = info.filter((x) => x.pi === lay.partIndex);
    for (const s of info) for (const bb of [s.st.bars[m] || [], hasVoice2(s.st, m) ? s.st.v2[m] : []]) { let p = 0; for (const ev of bb) { const o = onsets.get(p) || { acc: 0, dots: 0 }; if (ev.dots) o.dots = Math.max(o.dots, ev.dots); if (ev.notes && ev.notes.some((n) => n.a || n.cau)) o.acc = Math.max(o.acc, n0acc(ev)); onsets.set(p, o); p += ticksOf(ev, time); } }
    if (!onsets.size) onsets.set(0, { acc: 0, dots: 0 });
    const times = [...onsets.keys()].sort((a, b) => a - b);
    lay._cols.set(m, { segs: times.map((t, i) => ({ t, w: space((i + 1 < times.length ? times[i + 1] : total) - t) + (onsets.get(t).dots ? 0.45 * onsets.get(t).dots : 0), pre: onsets.get(t).acc ? 1.1 * onsets.get(t).acc : 0 })) });
  }
  return lay._cols.get(m);
}

function drawBarline(ctx, type, x, staves, lay) {
  // barlines run through the staves of one instrument family group; simple: through every staff of a part
  const groups = [];
  let cur = null;
  for (const s of staves) {
    const join = cur && (cur.pi === s.pi || (cur.fam === s.inst.fam && !['keys', 'pluck', 'voice'].includes(s.inst.fam)));
    if (join) { cur.b = s.y + 4; cur.pi = s.pi; } else { cur = { t: s.y, b: s.y + 4, pi: s.pi, fam: s.inst.fam }; groups.push(cur); }
  }
  for (const g of groups) {
    if (type === 'final') { line(ctx, x - 1.15, g.t, x - 1.15, g.b, 0.16); ctx.fillRect(x - 0.5, g.t, 0.5, g.b - g.t); }
    else if (type === 'double') { line(ctx, x - 0.75, g.t, x - 0.75, g.b, 0.16); line(ctx, x, g.t, x, g.b, 0.16); }
    else if (type === 'repeat') {
      line(ctx, x - 1.15, g.t, x - 1.15, g.b, 0.16); ctx.fillRect(x - 0.5, g.t, 0.5, g.b - g.t);
      for (const s of staves) if (s.y >= g.t - 0.1 && s.y + 4 <= g.b + 0.1) { glyph(ctx, GL.repeatDot, x - 2.1, s.y + 1.5); glyph(ctx, GL.repeatDot, x - 2.1, s.y + 2.5); }
    } else line(ctx, x, g.t, x, g.b, 0.16);
  }
}
function drawRepeatStart(ctx, x, staves) {
  const t = staves[0].y, b = staves[staves.length - 1].y + 4;
  ctx.fillRect(x, t, 0.5, b - t); line(ctx, x + 1.15, t, x + 1.15, b, 0.16);
  for (const s of staves) { glyph(ctx, GL.repeatDot, x + 1.7, s.y + 1.5); glyph(ctx, GL.repeatDot, x + 1.7, s.y + 2.5); }
}
function drawTempo(ctx, tempo, x, y) {
  let xx = x;
  if (tempo.text) { text(ctx, tempo.text, xx, y, 2.0, TEXT_FONT, '700'); xx += textWidth(ctx, tempo.text, 2.0, TEXT_FONT, '700') + 1.0; }
  if (tempo.bpm && tempo.show !== false) {
    const g = tempo.beat === 2 ? GL.halfUp : tempo.beat === 8 ? GL.eighthUp : GL.quarterUp;
    if (tempo.text) { text(ctx, '(', xx, y, 2.0); xx += 0.7; }
    glyph(ctx, g, xx, y - 0.1, 3); xx += 1.4;
    if (tempo.dotted) { glyph(ctx, GL.dot, xx - 0.2, y - 0.3, 3); xx += 0.6; }
    text(ctx, ' = ' + tempo.bpm + (tempo.text ? ')' : ''), xx, y, 2.0);
    xx += textWidth(ctx, ' = ' + tempo.bpm + (tempo.text ? ')' : ''), 2.0);
  }
  return xx - x;
}

// ---------------------------------------------------------------------
// One bar of one staff
// ---------------------------------------------------------------------
function drawStaffBar(ctx, lay, sys, s, m, time, xs, mm, hm, hit, opts) {
  const score = lay.score;
  const bar = s.st.bars[m] || [];
  const clef = clefAt(s.st, m);
  let bottom = CLEFS[clef].bottom;
  // (a clef change in the middle of the bar, before an event: from there on, in the voice that has it)
  let curClef = clef;
  const key = lay.concert ? keyAt(score, m) : writtenKey(keyAt(score, m), s.inst);
  const sel = opts.selection || new Set();
  const selBars = opts.selBars;
  // a captured bar to check
  if (!opts.voice2 && opts.doubt && opts.doubt.stId === (s.st.base || s.st).id && opts.doubt.bars.has(m)) {
    ctx.save(); ctx.fillStyle = 'rgba(232,140,20,0.2)'; ctx.fillRect(mm.x0 + 0.1, s.y - 1.5, mm.x1 - mm.x0 - 0.2, 7); ctx.restore();
  }
  // the bar selection box
  if (!opts.voice2 && selBars && (selBars.sts ? selBars.sts.some((q) => (q.base || q) === (s.st.base || s.st)) : (selBars.st.base || selBars.st) === (s.st.base || s.st)) && m >= selBars.from && m <= selBars.to) {
    ctx.save(); ctx.fillStyle = opts.selColor || 'rgba(43,111,214,0.13)'; ctx.fillRect(mm.x0 + 0.1, s.y - 1, mm.x1 - mm.x0 - 0.2, 6); ctx.restore();
  }
  // accidentals in force in this bar
  const state = new Map();
  const accFor = (n) => {
    const cur = state.has(n.s) ? state.get(n.s) : keyAlter(key, n.s);
    if (n.tieIn) return null;
    state.set(n.s, n.a);
    return cur === n.a ? null : n.a;
  };
  // gather events with x and notes
  let p = 0;
  const evs = [];
  let tiedIn = (hm._prevTies) || null;
  for (const ev of bar) {
    const len = ticksOf(ev, time);
    const ott = ottavaAt(score, s.st.id, m, p);
    const x = ev.full ? (hm.cx0 + mm.x1) / 2 - 0.9 : xs.get(p) ?? hm.cx0;
    const e = { ev, pos: p, len, x, notes: [] };
    if (ev.clef && ev.clef !== curClef && CLEFS[ev.clef]) {
      curClef = ev.clef; bottom = CLEFS[ev.clef].bottom;
      const accW = ev.notes && ev.notes.some((n) => n.a) ? 1.1 : 0;
      CUR_MARK = { id: ev.id, kind: 'evclef', name: ev.clef, m, st: s.st.id }; drawClef(ctx, ev.clef, x - accW - 2.9, s.y, 3); CUR_MARK = null;
    }
    if (ev.notes) {
      const ns = ev.notes.map((n0) => {
        const n = lay.concert ? n0 : toWritten(n0, s.inst);
        return { ...n, p: s.inst.unpitched ? 4 : n.s - bottom - ott, src: n0 };
      }).sort((a, b) => a.p - b.p);
      e.notes = ns;
    }
    evs.push(e);
    p += len;
  }
  // ties coming in from the previous bar mark notes that need no accidental
  const prevBar = m > 0 ? s.st.bars[m - 1] : null;
  if (prevBar && prevBar.length) {
    const last = prevBar[prevBar.length - 1];
    if (last.notes && evs[0] && evs[0].notes.length) for (const n of evs[0].notes) if (last.notes.some((q) => q.tie && q.s === n.src.s)) n.tieIn = true;
  }
  for (let i = 1; i < evs.length; i++) {
    const prev = evs[i - 1].ev;
    if (prev.notes) for (const n of evs[i].notes) if (prev.notes.some((q) => q.tie && q.s === n.src.s)) n.tieIn = true;
  }
  // stems and beams
  const groups = beamGroups(evs, time);
  for (const e of evs) if (e.notes.length) {
    const avg = (e.notes[0].p + e.notes[e.notes.length - 1].p) / 2;
    e.up = e.ev.stem ? e.ev.stem === 'up' : avg < 4;
  }
  if (opts.voiceDir) for (const e of evs) { e.up = opts.voiceDir === 'up'; e.restDy = opts.voiceDir === 'up' ? -2 : 2; }
  if (opts.voice2) {
    // a second-voice note a step from (or on) a first-voice note at the same moment moves aside
    const base = s.st.base; const b1 = base.bars[m] || []; let q = 0; const at = new Map();
    for (const ev of b1) { if (ev.notes && !ev.rest) at.set(q, ev.notes.map((n) => n.s)); q += ticksOf(ev, time); }
    for (const e of evs) { const ss = at.get(e.pos); if (ss && e.notes.some((n) => ss.some((x) => Math.abs(x - n.src.s) <= 1))) e.x += HEAD_W * 1.05; }
  }
  for (const g of groups) {
    if (opts.voiceDir) { for (const e of g) { e.up = opts.voiceDir === 'up'; e.beamed = g; } continue; }
    const ps = g.flatMap((e) => e.notes.map((n) => n.p));
    const far = ps.reduce((a, q) => (Math.abs(q - 4) > Math.abs(a - 4) ? q : a), 4);
    let up = far < 4 || (far === 4 && ps.reduce((a, q) => a + q, 0) / ps.length < 4);
    // a stem turned by hand turns the whole beamed group
    const forced = g.find((e) => e.ev.stem);
    if (forced) up = forced.ev.stem === 'up';
    for (const e of g) { e.up = up; e.beamed = g; }
  }
  // draw events
  const color = (e) => (sel.has(e.ev.id) ? (opts.selInk || '#2b6fd6') : (opts.playing && opts.playing.has(e.ev.id) ? (opts.playInk || '#1e8e55') : null));
  for (const e of evs) {
    const c = color(e);
    if (c) { ctx.save(); ctx.fillStyle = c; ctx.strokeStyle = c; }
    if (e.ev.rest) drawRest(ctx, e, s.y + (e.restDy || 0) / 2, time);
    else {
      // notes the instrument cannot play are shown in red while writing (never in print)
      if (opts.ranges && s.inst && s.inst.range && !s.inst.unpitched) { const [lo, hi] = s.inst.range; e.outOf = new Set(e.notes.filter((n) => { const md = midiOf(n.src.s, n.src.a); return md < lo || md > hi; }).map((n) => n)); }
      drawChord(ctx, e, s.y, accFor);
    }
    if (c) ctx.restore();
    const hx = e.ev.rest ? e.x : e.x;
    const ev = { id: e.ev.id, m, pos: e.pos, len: e.len, x: hx, staff: s.k, y: s.y + (e.ev.rest ? (e.restDy || 0) / 2 : 0), up: e.up, voice: opts.voice2 ? 2 : 1, notes: e.notes.map((n) => ({ p: n.p, y: yOf(s.y, n.p), s: n.src.s })), rest: !!e.ev.rest, tup: !!e.ev.tup };
    e.hitRef = ev;
    hm.events.push(ev); hit.events.push(ev);
  }
  // beams
  for (const g of groups) drawBeam(ctx, g, s.y, sel, opts);
  // flags and stems for unbeamed notes
  for (const e of evs) if (e.notes.length && !e.beamed) drawStemFlag(ctx, e, s.y, color(e));
  for (const e of evs) if (e.notes.length && e.ev.art) drawTrem(ctx, e, s.y);
  // where each stem ends (slurs on the stem side attach there)
  for (const e of evs) if (e.hitRef && e.stemTip !== undefined) { e.hitRef.stemTip = e.stemTip; e.hitRef.stemX = e.stemX; }
  // tuplet brackets
  drawTuplets(ctx, evs, s.y);
  // ties
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    for (const n of e.notes) {
      if (!n.src.tie) continue;
      const nx = evs[i + 1];
      const below = e.up;
      const x0 = e.x + HEAD_W + 0.15, y0 = yOf(s.y, n.p) + (below ? 0.45 : -0.45);
      const x1 = nx ? nx.x - 0.15 : mm.x1 - 0.4;
      drawTie(ctx, x0, x1, y0, below);
      hitBox({ id: ev0Id(e), kind: 'tie', name: 'tie', m }, x0, x1, y0 + (below ? 0 : -1.0), y0 + (below ? 1.0 : 0));
    }
  }
  // a tie arriving at the start of the line from the previous system
  if (mm.x0 === hm.x0 && hm.cx0 > mm.x0 && m > 0 && sys.measures[0].m === m && prevBar && prevBar.length) {
    const last = prevBar[prevBar.length - 1];
    if (last.notes) for (const n of evs[0] ? evs[0].notes : []) if (n.tieIn) drawTie(ctx, hm.cx0 - 1.5, evs[0].x - 0.15, yOf(s.y, n.p) + (evs[0].up ? 0.45 : -0.45), evs[0].up);
  }
  // articulations, dynamics, hairpins, text, slurs (dynamics and hairpins share one line per bar)
  let dynLine = 3.0;
  const hpSpans = (score.spans || []).filter((q) => q.kind === 'hairpin' && q.st === (s.st.base || s.st).id && (q.v || 1) === (opts.voice2 ? 2 : 1) && q.a.m <= m && q.b.m >= m);
  const underHp = (e) => hpSpans.some((q) => (q.a.m < m || q.a.pos <= e.pos) && (q.b.m > m || q.b.pos >= e.pos));
  for (const e of evs) if (e.ev.dyn || e.ev.hp || underHp(e) || (e.ev.txt && e.ev.txtBelow)) dynLine = Math.max(dynLine, lowestBelow(e, s.y) + 2.9);
  for (const e of evs) if (e.ev.dyn || underHp(e)) hm.dynLow = Math.max(hm.dynLow || 0, lowestBelow(e, s.y));
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    const ev = e.ev;
    if (ev.art && ev.art.length && e.notes.length) { try { drawArts(ctx, e, s.y); } finally { CUR_MARK = null; } }
    if (ev.art && ev.art.includes('ferm') && ev.rest) glyph(ctx, GL.art.ferm[0], e.x, s.y - 1);
    // dynamics are drawn once the whole line is known, all on one level with the hairpins
    if (ev.dyn) (hm.dyns = hm.dyns || []).push({ x: e.x - 0.3, dyn: ev.dyn, c: color(e), id: ev.id });
    // words under the staff (dolce, cresc.), on the line of the dynamics, after one if there is one
    if (ev.txt && ev.txtBelow) (hm.dyns = hm.dyns || []).push({ x: e.x - 0.3 + (ev.dyn ? 0.9 + 1.1 * ev.dyn.length : 0), txt: ev.txt, it: ev.txtStyle !== 'tech' && ev.txtStyle !== 'plain', c: color(e), id: ev.id });
    if (ev.fing && e.notes.length) {
      // fingering: small upright numbers over the note (several, one over the other, for a chord)
      const parts = String(ev.fing).split(/[\s,]+/).filter(Boolean);
      // above the articulations and ornaments that are over the note (never on top of them)
      const arts = ev.art || [];
      const nearUp = !e.up && arts.some((a) => ['stacc', 'stacciss', 'ten', 'acc', 'marc'].includes(a));
      const far = arts.filter((a) => ['ferm', 'fermS', 'fermL', 'trill', 'mord', 'prall', 'turn', 'turnInv', 'up', 'down', 'harm', 'stopped', 'open', 'snap'].includes(a)).length;
      const topNote = (e.notes[e.notes.length - 1].p - 8) / 2;
      const cxF = e.x + HEAD_W / 2, base = s.y - Math.max(1.0, highestAbove(e, s.y) + 0.6, nearUp ? topNote + 2.6 : 0) - far * 2.9;
      parts.forEach((d, k) => {
        const fy = base - k * 1.45, fw = textWidth(ctx, d, 1.45, TEXT_FONT, '600');
        text(ctx, d, cxF - fw / 2, fy, 1.45, TEXT_FONT, '600');
      });
      if (CUR_HIT && CUR_HIT.marks) CUR_HIT.marks.push({ id: ev.id, kind: 'fing', name: String(ev.fing), x0: cxF - 0.7, x1: cxF + 0.7, y0: base - parts.length * 1.45 - 0.1, y1: base + 0.3 });
    }
    if (ev.str && e.notes.length) {
      // the string to play it on (I to IV), above the fingering
      const arts = ev.art || [];
      const nearUp = !e.up && arts.some((a) => ['stacc', 'stacciss', 'ten', 'acc', 'marc'].includes(a));
      const far = arts.filter((a) => ['ferm', 'fermS', 'fermL', 'trill', 'mord', 'prall', 'turn', 'turnInv', 'up', 'down', 'harm', 'stopped', 'open', 'snap'].includes(a)).length;
      const topNote = (e.notes[e.notes.length - 1].p - 8) / 2;
      const nF = ev.fing ? String(ev.fing).split(/[\s,]+/).filter(Boolean).length : 0;
      const yS = s.y - Math.max(1.0, highestAbove(e, s.y) + 0.6, nearUp ? topNote + 2.6 : 0) - far * 2.9 - nF * 1.45 - (nF ? 0.25 : 0);
      const word = String(ev.str), sw = textWidth(ctx, word, 1.5, TEXT_FONT, '600');
      text(ctx, word, e.x + HEAD_W / 2 - sw / 2, yS, 1.5, TEXT_FONT, '600');
    }
    if (ev.txt && !ev.txtBelow) {
      const ty = s.y - Math.max(1.6, highestAbove(e, s.y) + 1.2) - (ev.fing ? 1.5 * String(ev.fing).split(/[\s,]+/).filter(Boolean).length : 0) - (ev.str ? 1.6 : 0);
      const st2 = ev.txtStyle === 'plain' || ev.txtStyle === 'tech' || ev.txtStyle === 'box' ? '' : 'italic';
      text(ctx, ev.txt, e.x, ty, 1.7, TEXT_FONT, st2);
      if (CUR_HIT && CUR_HIT.marks) CUR_HIT.marks.push({ id: ev.id, kind: 'txt', name: ev.txt, x0: e.x - 0.2, x1: e.x + Math.max(1.5, String(ev.txt).length * 0.8), y0: ty - 1.5, y1: ty + 0.5 });
      if (ev.txtStyle === 'box') { const w = textWidth(ctx, ev.txt, 1.7, TEXT_FONT, st2); ctx.lineWidth = 0.13; ctx.strokeRect(e.x - 0.45, ty - 1.65, w + 0.9, 2.2); }
    }
    if (ev.chord) {
      // a chord symbol above the staff
      const cy = s.y - Math.max(2.6, highestAbove(e, s.y) + (ev.txt ? 3.4 : 1.6));
      text(ctx, prettyChord(ev.chord), e.x, cy, 2.0, '"Helvetica Neue", Arial, sans-serif', '600');
      hitBox({ id: ev.id, kind: 'chord', name: ev.chord, m }, e.x - 0.3, e.x + textWidth(ctx, prettyChord(ev.chord), 2.0, '"Helvetica Neue", Arial, sans-serif', '600') + 0.3, cy - 2.0, cy + 0.5);
    }
    if (ev.lyric) {
      // a syllable under the note, centred; a hyphen joins it to the next one
      const ly = s.y + 4 + Math.max(s.lyr || 4.2, dynLine + (evs.some((q) => q.ev.dyn || q.ev.hp) ? 2.6 : 0));
      const w = textWidth(ctx, ev.lyric.replace(/-$/, ''), 1.8);
      text(ctx, ev.lyric.replace(/-$/, ''), e.x + HEAD_W / 2 - w / 2, ly, 1.8);
      hitBox({ id: ev.id, kind: 'lyric', name: ev.lyric, m }, e.x + HEAD_W / 2 - w / 2 - 0.3, e.x + HEAD_W / 2 + w / 2 + 0.3, ly - 1.7, ly + 0.5);
      if (/-$/.test(ev.lyric)) {
        const nx = evs.slice(i + 1).find((q) => q.ev.lyric);
        const x0 = e.x + HEAD_W / 2 + w / 2 + 0.3, x1 = nx ? nx.x + HEAD_W / 2 - textWidth(ctx, nx.ev.lyric.replace(/-$/, ''), 1.8) / 2 - 0.3 : mm.x1 - 0.4;
        if (x1 - x0 > 0.6) { const mx = (x0 + x1) / 2; ctx.fillRect(mx - 0.4, ly - 0.55, 0.8, 0.13); }
      }
    }
    if (ev.hp === '<' || ev.hp === '>') {
      // hairpin to the event that ends it (or the end of the bar)
      let end = null;
      for (let j = i + 1; j < evs.length; j++) if (evs[j].ev.hp === 'end' || evs[j].ev.dyn) { end = evs[j]; break; }
      const xa = e.x + (ev.dyn ? 3.5 : 0), xb = end ? end.x - 0.8 : mm.x1 - 0.8;
      const yy = s.y + 4 + dynLine - 0.55;
      ctx.lineWidth = 0.14; ctx.beginPath();
      if (ev.hp === '<') { ctx.moveTo(xb, yy - 0.7); ctx.lineTo(xa, yy); ctx.lineTo(xb, yy + 0.7); } else { ctx.moveTo(xa, yy - 0.7); ctx.lineTo(xb, yy); ctx.lineTo(xa, yy + 0.7); }
      ctx.stroke();
    }
    if (ev.slur === 'start') {
      let end = null;
      for (let j = i + 1; j < evs.length; j++) if (evs[j].ev.slur === 'end') { end = evs[j]; break; }
      if (e.notes.length) {
        const above = !e.up;
        const ya = slurY(e, s.y, above), xa = e.x + HEAD_W / 2;
        const xb = end ? end.x + HEAD_W / 2 : mm.x1 - 0.6, yb = end && end.notes.length ? slurY(end, s.y, above) : ya;
        drawSlur(ctx, xa, ya, xb, yb, above);
      }
    }
  }
}
// "C#m7/Bb" with real sharp and flat signs
export const prettyChord = (c) => c.replace(/([A-G])#/g, '$1♯').replace(/([A-G])b/g, '$1♭').replace(/maj/i, 'maj').replace(/\bo\b/, '°');
const highestAbove = (e, sy) => { let h = 0; for (const n of e.notes) h = Math.max(h, (n.p - 8) / 2 + (e.up ? STEM_LEN : 0.5)); if (e.up && e.stemTip !== undefined) h = Math.max(h, sy - e.stemTip + 0.2); return h; };
const lowestBelow = (e, sy) => { let h = 0; for (const n of e.notes) h = Math.max(h, -n.p / 2 + (!e.up ? STEM_LEN + (e.ev.tup ? 2.3 : 0) : 0.5)); const near = (e.ev.art || []).filter((a) => ['stacc', 'stacciss', 'ten', 'acc', 'marc'].includes(a)).length; if (near && e.up) h += near * 1.0; return h; };
function slurY(e, sy, above) {
  const ns = e.notes; if (!ns.length) return sy;
  if (above) { const top = ns[ns.length - 1]; return yOf(sy, top.p) - (e.up ? STEM_LEN + 0.6 : 1.0); }
  const b = ns[0]; return yOf(sy, b.p) + (e.up ? 1.0 : STEM_LEN + 0.6);
}

function beamGroups(evs, time) {
  const unit = beatGroup(time);
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length > 1) groups.push(cur); cur = []; };
  for (const e of evs) {
    const beamable = !e.ev.rest && e.ev.t >= 8 && e.notes.length && !e.ev.nobeam;
    if (!beamable) { flush(); continue; }
    const g = Math.floor(e.pos / unit);
    if (cur.length) {
      const last = cur[cur.length - 1];
      // a tuplet group beams on its own: a new group (its first note) starts a new beam
      const newGroup = e.ev.tup && (e.ev.tup.i === 0 || !last.ev.tup || last.ev.tup.n !== e.ev.tup.n);
      const sameTup = e.ev.tup && last.ev.tup && !newGroup;
      if (newGroup || (!!e.ev.tup !== !!last.ev.tup) || (!sameTup && Math.floor(cur[0].pos / unit) !== g)) flush();
    }
    cur.push(e);
  }
  flush();
  return groups;
}

function headGlyph(ev, unpitched, head) {
  const k = ev.t === 1 ? 0 : ev.t === 2 ? 1 : 2;
  if (head && GL.heads[head]) return GL.heads[head][k];
  if (unpitched && !head) return GL.noteX;
  return ev.t === 1 ? GL.noteWhole : ev.t === 2 ? GL.noteHalf : GL.noteBlack;
}
export { headGlyph };
function drawChord(ctx, e, sy, accFor) {
  const ev = e.ev;
  const g = headGlyph(ev, e.unpitched, ev.head);
  const hw = ev.t === 1 ? 1.69 : HEAD_W;
  const gOf = (n) => { const h = n.src.head || ev.head; return h && h !== 'ghost' ? headGlyph(ev, e.unpitched, h) : g; };
  // seconds in a chord: put the upper (stem up) or lower (stem down) note on the other side of the stem
  const side = new Map();
  for (let i = 1; i < e.notes.length; i++) if (e.notes[i].p - e.notes[i - 1].p === 1 && !side.get(i - 1)) side.set(e.up ? i : i - 1, true);
  // ledger lines
  const ps = e.notes.map((n) => n.p);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  ctx.lineWidth = 0.16;
  for (let p = -2; p >= lo; p -= 2) line(ctx, e.x - 0.4, yOf(sy, p), e.x + hw + 0.4, yOf(sy, p), 0.16);
  for (let p = 10; p <= hi; p += 2) line(ctx, e.x - 0.4, yOf(sy, p), e.x + hw + 0.4, yOf(sy, p), 0.16);
  // accidentals (columns from the right when they would collide)
  let accCol = [];
  e.notes.forEach((n, i) => {
    let a = accFor(n);
    // a reminder accidental (chosen on the note): shown even when not needed, in brackets
    const cau = !!(n.src && n.src.cau) && !n.tieIn;
    if ((a === null || a === undefined) && cau) a = n.a || 0;
    if (a === null || a === undefined) return;
    const ag = GL.acc[a];
    let col = 0;
    while (accCol.some((q) => q.col === col && Math.abs(q.p - n.p) < 6)) col++;
    accCol.push({ col, p: n.p });
    const w = gm(ag).w;
    const ax = e.x - 0.35 - w - col * 1.05 - (side.get(i) && !e.up ? hw : 0) - (cau ? 0.45 : 0);
    glyph(ctx, ag, ax, yOf(sy, n.p));
    if (cau) { glyph(ctx, GL.parenL, ax - 0.5, yOf(sy, n.p)); glyph(ctx, GL.parenR, ax + w + 0.05, yOf(sy, n.p)); }
  });
  if (ev.grace && e.notes.length) drawGrace(ctx, e, sy, accCol.length ? 0.35 + gm(GL.acc[1]).w + Math.max(...accCol.map((q) => q.col)) * 1.05 : 0);
  e.notes.forEach((n, i) => {
    const off = side.get(i) ? (e.up ? hw - 0.02 : -(hw - 0.02)) : 0;
    const gn = gOf(n);
    // a head of another shape is centred on the normal head's place, so the stem still meets it
    const dw = gn === g ? 0 : (hw - gm(gn).w) / 2;
    if (e.outOf && e.outOf.has(n)) { ctx.save(); ctx.fillStyle = '#d0302f'; glyph(ctx, gn, e.x + off + dw, yOf(sy, n.p)); ctx.restore(); }
    else glyph(ctx, gn, e.x + off + dw, yOf(sy, n.p));
    if ((n.src.head || ev.head) === 'ghost') { glyph(ctx, GL.parenL, e.x + off - 0.55, yOf(sy, n.p)); glyph(ctx, GL.parenR, e.x + off + hw + 0.12, yOf(sy, n.p)); }
    // dots sit in a space
    for (let d = 0; d < (ev.dots || 0); d++) {
      const dp = n.p % 2 === 0 ? n.p + 1 : n.p;
      glyph(ctx, GL.dot, e.x + hw + 0.45 + d * 0.55 + (side.get(i) && e.up ? hw : 0), yOf(sy, dp));
    }
  });
}
function stemEnds(e, sy) {
  const lo = e.notes[0].p, hi = e.notes[e.notes.length - 1].p;
  if (e.up) {
    const x = e.x + HEAD_W - STEM_T / 2;
    let yEnd = yOf(sy, hi) - STEM_LEN; if (yOf(sy, hi) - STEM_LEN > sy + 2 && hi < -2) yEnd = sy + 2;
    if (e.ev.t >= 32) yEnd -= 0.75 * (Math.log2(e.ev.t) - 4);
    return { x, y0: yOf(sy, lo) - 0.17, y1: yEnd };
  }
  const x = e.x + STEM_T / 2;
  let yEnd = yOf(sy, lo) + STEM_LEN; if (yOf(sy, lo) + STEM_LEN < sy + 2 && lo > 10) yEnd = sy + 2;
  if (e.ev.t >= 32) yEnd += 0.75 * (Math.log2(e.ev.t) - 4);
  return { x, y0: yOf(sy, hi) + 0.17, y1: yEnd };
}
function drawStemFlag(ctx, e, sy) {
  if (e.ev.t <= 1) return;
  const st = stemEnds(e, sy);
  e.stemTip = st.y1; e.stemX = st.x;
  line(ctx, st.x, st.y0, st.x, st.y1, STEM_T);
  if (e.ev.t >= 8) {
    const fg = (e.up ? GL.flagUp : GL.flagDown)[Math.min(64, e.ev.t)];
    glyph(ctx, fg, st.x - STEM_T / 2, st.y1);
  }
}
// Tremolo strokes: across the stem (also on beamed notes), or over a whole note
function drawTrem(ctx, e, sy) {
  const a = e.ev.art; if (!a) return;
  const tg = a.includes('trem3') ? GL.orn.trem3 : a.includes('trem2') ? GL.orn.trem2 : a.includes('trem') ? GL.art.trem[0] : null;
  if (!tg) return;
  const m = gm(tg), w = (m.r - m.l) || 1.2;
  if (e.ev.t <= 1) {
    const lo = e.notes[0].p, hi = e.notes[e.notes.length - 1].p;
    const mid = e.up === false ? yOf(sy, lo) + 2.2 : yOf(sy, hi) - 2.2;
    glyph(ctx, tg, e.x + HEAD_W / 2 - w / 2 - m.l, mid + (m.a - m.d) / 2);
    return;
  }
  const st = stemEnds(e, sy);
  const tip = e.stemTip !== undefined ? e.stemTip : st.y1;
  // between the note head and the end of the stem (or the beam)
  const mid = st.y0 + (tip - st.y0) * 0.55;
  glyph(ctx, tg, st.x - w / 2 - m.l, mid + (m.a - m.d) / 2);
}
function drawBeam(ctx, g, sy, sel, opts) {
  const ends = g.map((e) => ({ e, ...stemEnds(e, sy) }));
  const up = g[0].up;
  const first = ends[0], last = ends[ends.length - 1];
  // a gentle slant, as engravers do: at most a space, less for small steps; flat when the
  // middle notes push towards the beam or the ends are the same note
  const dx = last.x - first.x;
  const pOf = (e) => (up ? e.notes[e.notes.length - 1].p : e.notes[0].p);
  const steps = Math.abs(pOf(last.e) - pOf(first.e));
  const maxRise = steps === 0 ? 0 : steps === 1 ? 0.25 : steps === 2 ? 0.5 : steps <= 4 ? 0.75 : 1.0;
  let rise = Math.max(-maxRise, Math.min(maxRise, last.y1 - first.y1));
  const inner = ends.slice(1, -1);
  const extreme = (q) => (up ? q.y1 : -q.y1);
  if (inner.length && inner.some((q) => extreme(q) < Math.min(extreme(first), extreme(last)) - 0.01)) rise = 0;
  let slope = dx > 0.01 ? rise / dx : 0;
  // the beam must clear every note by a full stem
  let y0 = first.y1;
  const at = (x) => y0 + slope * (x - first.x);
  for (const s of ends) {
    const need = up ? s.y1 : s.y1;
    const cur = at(s.x);
    if (up && cur > need) y0 -= cur - need;
    if (!up && cur < need) y0 += need - cur;
  }
  const levels = (e) => Math.max(1, Math.log2(e.ev.t) - 2);
  const thick = 0.5, gap = 0.75;
  // stems up to the beam
  for (const s of ends) {
    s.e.stemTip = at(s.x) + (up ? -0.25 : 0.25); s.e.stemX = s.x;
    const c = sel.has(s.e.ev.id) ? (opts.selInk || '#2b6fd6') : null;
    if (c) { ctx.save(); ctx.strokeStyle = c; }
    line(ctx, s.x, s.y0, s.x, at(s.x), STEM_T);
    if (c) ctx.restore();
  }
  const bar = (xa, xb, lvl) => {
    const dy = (up ? 1 : -1) * lvl * gap;
    const ya = at(xa) + dy, yb = at(xb) + dy;
    const t = up ? thick : -thick;
    ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.lineTo(xb, yb + t); ctx.lineTo(xa, ya + t); ctx.closePath(); ctx.fill();
  };
  bar(first.x - STEM_T / 2, last.x + STEM_T / 2, 0);
  const maxL = Math.max(...g.map(levels));
  for (let lvl = 1; lvl < maxL; lvl++) {
    let i = 0;
    while (i < ends.length) {
      if (levels(ends[i].e) <= lvl) { i++; continue; }
      let j = i; while (j + 1 < ends.length && levels(ends[j + 1].e) > lvl) j++;
      if (j > i) bar(ends[i].x - STEM_T / 2, ends[j].x + STEM_T / 2, lvl);
      else { // a short stub, pointing into the group
        const right = i === 0 || (i < ends.length - 1 && ends[i].e.pos % (WHOLE / 4) === 0);
        bar(right ? ends[i].x : ends[i].x - 1.1, right ? ends[i].x + 1.1 : ends[i].x, lvl);
      }
      i = j + 1;
    }
  }
}
function drawRest(ctx, e, sy, time) {
  const ev = e.ev;
  if (ev.full) { glyph(ctx, GL.rest[1], e.x, yOf(sy, 6)); return; }
  const t = ev.t;
  const g = GL.rest[Math.min(64, t)];
  const p = t === 1 ? 6 : t === 2 ? 4 : 4;
  glyph(ctx, g, e.x, yOf(sy, p));
  for (let d = 0; d < (ev.dots || 0); d++) glyph(ctx, GL.dot, e.x + gm(g).w + 0.4 + d * 0.55, yOf(sy, 5));
}
const ev0Id = (e) => (e.ev && e.ev.id) || '';
function drawTie(ctx, x0, x1, y, below) {
  if (x1 - x0 < 0.4) x1 = x0 + 0.8;
  const h = Math.min(1.1, 0.35 + (x1 - x0) * 0.08) * (below ? 1 : -1);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.25, y + h, x0 + (x1 - x0) * 0.75, y + h, x1, y);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.75, y + h * 0.72, x0 + (x1 - x0) * 0.25, y + h * 0.72, x0, y);
  ctx.fill();
}
function drawSlur(ctx, xa, ya, xb, yb, above, height) {
  // a bezier whose control points sit a quarter in from each end, lifted along the slur's normal;
  // the inner edge is lower by the thickness, so the slur is thin at the tips and full in the middle
  const H = (height || Math.min(1.5, 0.55 + Math.abs(xb - xa) * 0.04)) / 0.75;   // low and flat, as engravers draw them
  const dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy) || 1;
  const nx = (dy / L) * (above ? 1 : -1), ny = (-dx / L) * (above ? 1 : -1);   // unit normal towards the curve's outside
  const ux = dx / L, uy = dy / L;
  const k = Math.min(0.34, 0.24 + 0.8 / Math.max(4, L));   // the middle stays flat; short slurs a little rounder
  const c1 = [xa + ux * L * k, ya + uy * L * k], c2 = [xb - ux * L * k, yb - uy * L * k];
  const T = Math.min(0.19, 0.1 + L * 0.003);                // thickness in the middle (sp)
  const o = H, i2 = H - T / 0.75;
  ctx.beginPath();
  ctx.moveTo(xa, ya);
  ctx.bezierCurveTo(c1[0] + nx * o, c1[1] + ny * o, c2[0] + nx * o, c2[1] + ny * o, xb, yb);
  ctx.bezierCurveTo(c2[0] + nx * i2, c2[1] + ny * i2, c1[0] + nx * i2, c1[1] + ny * i2, xa, ya);
  ctx.closePath();
  ctx.fill();
  // round the very tips a touch
  ctx.save(); ctx.lineWidth = 0.05; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
}
const ART_ORDER = ['stacc', 'stacciss', 'ten', 'acc', 'marc'];
function drawArts(ctx, e, sy) {
  // staccato and tenuto sit nearest the note head, accents outside them
  const arts = [...e.ev.art].sort((a, b) => (ART_ORDER.indexOf(a) + 1 || 99) - (ART_ORDER.indexOf(b) + 1 || 99));
  // close to the head, on the side away from the stem; fermata and bowings above the staff
  let yNear = e.up ? yOf(sy, e.notes[0].p) + 1.3 : yOf(sy, e.notes[e.notes.length - 1].p) - 1.3;
  const nearSide = e.up ? 1 : 0;   // 1 = below
  const cx = e.x + HEAD_W / 2;
  let aboveStack = 0;
  // (over the stem's real end: a beam may lift it above its usual length)
  const tipAbove = e.up && e.stemTip !== undefined ? e.stemTip - 1.4 : Infinity;
  const topY = Math.min(sy - 1.2, yOf(sy, e.notes[e.notes.length - 1].p) - (e.up ? STEM_LEN + 1.2 : 1.6), tipAbove);
  for (const a of arts) {
    CUR_MARK = { id: e.ev.id, kind: 'art', name: a };
    // ornaments and string or brass signs: above the staff, one over the other
    const orn = { mord: 'mord', prall: 'prall', turn: 'turn', turnInv: 'turnInv', stopped: 'stopped', open: 'open', snap: 'snapA', fermS: 'fermSA', fermL: 'fermLA' }[a];
    if (orn) { const g = GL.orn[orn], m = gm(g); glyph(ctx, g, cx - (m.l + m.r) / 2, topY - aboveStack); aboveStack += Math.max(1.4, m.a + m.d + 0.5); continue; }
    if (a === 'caes') { glyph(ctx, GL.orn.caes, e.x + 2.4, sy + 1); continue; }
    if (a === 'arp') {
      // a wavy line up the left of the chord
      const yLo = yOf(sy, e.notes[0].p) + 0.6, yHi = yOf(sy, e.notes[e.notes.length - 1].p) - 0.6;
      const xa = e.x - 1.1 - (e.notes.some((n) => n.acc !== undefined && n.acc !== null) ? 1.2 : 0);
      ctx.save(); ctx.translate(xa, yLo); ctx.rotate(-Math.PI / 2);
      const segW = gm(GL.orn.arp).r || 1; for (let x = 0; x < yLo - yHi; x += segW) glyph(ctx, GL.orn.arp, x, 0.4);
      ctx.restore(); continue;
    }
    if (!GL.art[a] || a === 'trem') continue;
    const farAbove = a === 'ferm' || a === 'up' || a === 'down' || a === 'trill' || a === 'harm' || a === 'breath';
    if (farAbove) {
      // (and above any staccato, tenuto or accent already on that side)
      const yy = Math.min(sy - 1.2, yOf(sy, e.notes[e.notes.length - 1].p) - (e.up ? STEM_LEN + 1.2 : 1.6), tipAbove, nearSide ? Infinity : yNear - 1.0) - aboveStack;
      const g = GL.art[a][0];
      const m = gm(g);
      glyph(ctx, g, a === 'breath' ? e.x + 2.2 : cx - (m.l + m.r) / 2, yy);
      if (a !== 'breath') aboveStack += Math.max(1.4, m.a + m.d + 0.5);
      continue;
    }
    const g = GL.art[a][nearSide];
    const m = gm(g);
    let yy = yNear;
    // inside the staff, keep off the lines
    const rel = (sy + 4 - yy) * 2;
    if (rel > 0 && rel < 8 && Math.abs(rel - Math.round(rel)) < 0.3 && Math.round(rel) % 2 === 0) yy += nearSide ? 0.5 : -0.5;
    glyph(ctx, g, cx - (m.l + m.r) / 2, nearSide ? yy + m.a : yy + m.d);
    yNear += nearSide ? 1.0 : -1.0;
  }
}
function drawTuplets(ctx, evs, sy) {
  let i = 0;
  while (i < evs.length) {
    const e = evs[i];
    if (!e.ev.tup) { i++; continue; }
    // a tuplet group covers n of its base value
    const n = e.ev.tup.n;
    let j = i, acc = 0;
    const target = e.ev.tup.m * (WHOLE / (e.ev.tup.base || e.ev.t));
    while (j < evs.length && evs[j].ev.tup && evs[j].ev.tup.n === n) { acc += evs[j].len; j++; if (target && acc >= target) break; }
    const grp = evs.slice(i, j);
    const up = grp.filter((q) => q.notes.length).reduce((a, q) => a + (q.up ? 1 : -1), 0) >= 0;
    const xa = grp[0].x - 0.2, xb = grp[grp.length - 1].x + HEAD_W + 0.2;
    let y = up ? sy - 1.6 : sy + 5.6;
    for (const q of grp) for (const nn of q.notes) {
      const ny = yOf(sy, nn.p);
      if (up) y = Math.min(y, ny - (q.up ? STEM_LEN + 1.3 : 1.6)); else y = Math.max(y, ny + (q.up ? 1.6 : STEM_LEN + 1.3));
    }
    const num = GL.tuplet(n);
    const mx = (xa + xb) / 2;
    const beamed = grp.length > 1 && grp.every((q) => q.beamed && q.beamed === grp[0].beamed);
    if (!beamed) {
      ctx.lineWidth = 0.12; ctx.beginPath();
      const hook = up ? 0.6 : -0.6;
      ctx.moveTo(xa, y + hook); ctx.lineTo(xa, y); ctx.lineTo(mx - 0.9, y); ctx.moveTo(mx + 0.9, y); ctx.lineTo(xb, y); ctx.lineTo(xb, y + hook); ctx.stroke();
    }
    glyph(ctx, num, mx - gm(num).w * 0.75 / 2, y + 0.6, 3);
    i = j;
  }
}

// =====================================================================
// Hit testing: which staff, bar, time and staff position is under a point (page coordinates in sp)
// =====================================================================
export function hitTest(hitmap, x, y) {
  let best = null, bd = 1e9;
  for (const s of hitmap.staves) {
    if (x < s.x0 - 2 || x > s.x1 + 1) continue;
    const mid = s.y + 2;
    const d = Math.abs(y - mid);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd > 12) return null;
  const meas = best.measures.find((mm) => x >= mm.x0 && x < mm.x1) || (x < best.measures[0].x0 ? best.measures[0] : best.measures[best.measures.length - 1]);
  if (!meas) return null;
  const p = Math.round((best.y + 4 - y) * 2);
  return { staff: best, meas, p, x, y };
}
// Snap a point in a bar to a time: the onsets on show, plus a grid of the chosen value.
export function timeAtX(meas, x, grid) {
  const pts = meas.onsets.slice().sort((a, b) => a.t - b.t);
  if (!pts.length) return 0;
  // interpolate between onsets (and the bar end)
  const ext = [...pts, { t: meas.total, x: meas.x1 - 1 }];
  let t = 0;
  if (x <= ext[0].x) t = 0;
  else {
    for (let i = 0; i < ext.length - 1; i++) {
      if (x >= ext[i].x && x <= ext[i + 1].x) { const f = (x - ext[i].x) / Math.max(0.01, ext[i + 1].x - ext[i].x); t = ext[i].t + f * (ext[i + 1].t - ext[i].t); break; }
      if (i === ext.length - 2) t = meas.total;
    }
  }
  // snap: prefer the onset under the pen, else the grid
  const near = pts.find((o) => Math.abs(o.x - x) < 1.3);
  if (near) return near.t;
  const g = grid || WHOLE / 8;
  let snapped = Math.round(t / g) * g;
  if (t < snapped) snapped = Math.floor(t / g) * g;
  return Math.max(0, Math.min(meas.total - g, snapped));
}
export function xAtTime(meas, t) {
  const ext = [...meas.onsets.slice().sort((a, b) => a.t - b.t), { t: meas.total, x: meas.x1 - 1 }];
  for (let i = 0; i < ext.length - 1; i++) if (t >= ext[i].t && t <= ext[i + 1].t) return ext[i].x + ((t - ext[i].t) / Math.max(1, ext[i + 1].t - ext[i].t)) * (ext[i + 1].x - ext[i].x);
  return ext[0].x;
}
export { yOf, HEAD_W, DYN_LETTERS, drawBarline, drawRepeatStart, line as drawLine };
// a grace note: a small eighth note before the main note, slashed for an acciaccatura, slurred to it
function drawGrace(ctx, e, sy, accW) {
  const gr = e.ev.grace, k = 0.64, sz = 4 * k, hw = HEAD_W * k;
  const n = e.notes[0], p = n.p + (gr.s - n.src.s);
  const x = e.x - accW - 0.75 - hw - 0.9, y = yOf(sy, p);
  for (let q = -2; q >= p; q -= 2) line(ctx, x - 0.3, yOf(sy, q), x + hw + 0.3, yOf(sy, q), 0.13);
  for (let q = 10; q <= p; q += 2) line(ctx, x - 0.3, yOf(sy, q), x + hw + 0.3, yOf(sy, q), 0.13);
  if (gr.acc !== undefined && gr.acc !== null) glyph(ctx, GL.acc[gr.acc], x - 0.25 - gm(GL.acc[gr.acc]).w * k, y, sz);
  glyph(ctx, GL.noteBlack, x, y, sz);
  const sx = x + hw - 0.05, top = y - STEM_LEN * 0.78;
  line(ctx, sx, y - 0.1, sx, top, 0.1);
  glyph(ctx, GL.flagUp[8], sx - 0.05, top, sz);
  if (gr.slash !== false) line(ctx, sx - 0.65, top + 1.55, sx + 0.95, top + 0.35, 0.11);
  // the little slur, under the heads
  const ty = Math.max(y, yOf(sy, n.p)) + 0.75, x0 = x + hw * 0.5, x1 = e.x + HEAD_W * 0.3;
  ctx.beginPath(); ctx.moveTo(x0, ty); ctx.bezierCurveTo(x0 + 0.3, ty + 0.75, x1 - 0.3, ty + 0.75, x1, ty);
  ctx.bezierCurveTo(x1 - 0.3, ty + 0.55, x0 + 0.3, ty + 0.55, x0, ty); ctx.fill();
}
// Draw a single note head (ghost note while writing) with ledger lines and accidental.
export function drawGhost(ctx, x, sy, p, t, acc, color) {
  ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color;
  const g = t === 1 ? GL.noteWhole : t === 2 ? GL.noteHalf : GL.noteBlack;
  for (let q = -2; q >= p; q -= 2) line(ctx, x - 0.4, yOf(sy, q), x + HEAD_W + 0.4, yOf(sy, q), 0.16);
  for (let q = 10; q <= p; q += 2) line(ctx, x - 0.4, yOf(sy, q), x + HEAD_W + 0.4, yOf(sy, q), 0.16);
  glyph(ctx, g, x, yOf(sy, p));
  if (acc !== null && acc !== undefined) glyph(ctx, GL.acc[acc], x - 0.35 - gm(GL.acc[acc]).w, yOf(sy, p));
  if (t > 1) { const up = p < 4; const sx = up ? x + HEAD_W - STEM_T / 2 : x + STEM_T / 2; line(ctx, sx, yOf(sy, p), sx, yOf(sy, p) + (up ? -STEM_LEN : STEM_LEN), STEM_T); if (t >= 8) glyph(ctx, (up ? GL.flagUp : GL.flagDown)[Math.min(64, t)], sx - STEM_T / 2, yOf(sy, p) + (up ? -STEM_LEN : STEM_LEN)); }
  ctx.restore();
}
void isEmptyStaff; void midiOf; void tempoAt; void INST; void keySteps;
