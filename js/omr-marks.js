// The music reader, part two: what sits around the notes. Ties and slurs (the thin curves),
// staccato dots, accents, tenuto lines, marcato, fermatas, trills, mordents and turns, and the
// little 3 of a triplet. Works on the reader's picture with the staff lines taken away, after the
// notes of every staff have been found.
import { shapeOf, classifyLoose } from './omr.js';
import { MARKS } from './omr-marks-shapes.js';
import { CHARS2 } from './omr-chars2.js';

// Templates for the signs, drawn from the music font (Bravura, SIL Open Font License) at the
// reader's scale the first time they are needed.
const GLYPHS = { acc: ['', ''], ten: ['', ''], marc: ['', ''], ferm: ['', ''], trill: [''],
  mord: [''], prall: [''], turn: [''], d3: [''], d5: [''], d6: [''] , O8: ['\uE510', '\uE511', '\uE512'] };
let TEMPL = null;
export async function markTemplates() {
  if (TEMPL) return TEMPL;
  try { await document.fonts.load('80px Bravura'); } catch {}
  const SPX = 20, out = {};
  for (const [k, list] of Object.entries(GLYPHS)) {
    out[k] = [];
    for (const g of list) {
      const c = document.createElement('canvas'); c.width = SPX * 8; c.height = SPX * 8;
      const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#000'; x.font = `${SPX * 4}px Bravura`; x.textBaseline = 'alphabetic';
      x.fillText(g, SPX * 2, SPX * 5);
      const d = x.getImageData(0, 0, c.width, c.height).data, b = new Uint8Array(c.width * c.height);
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let i = 0; i < b.length; i++) if (d[i * 4 + 3] > 110) { b[i] = 1; const px = i % c.width, py = (i - px) / c.width; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      if (x1 < 0) continue;   // the font is not there: that sign is simply not looked for
      out[k].push(shapeOf(b, c.width, x0, y0, x1, y1, SPX));
    }
  }
  // fingering digits and dynamics letters in the fonts of this device, as printed music uses them
  const cutText = (font, ch, wantH) => {
    const c = document.createElement('canvas'); c.width = SPX * 8; c.height = SPX * 8;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.font = `100px ${font}`; const m = x.measureText(ch); const hh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 70;
    x.fillStyle = '#000'; x.font = `${(wantH * SPX * 100) / hh}px ${font}`; x.fillText(ch, SPX * 2, SPX * 5);
    const d = x.getImageData(0, 0, c.width, c.height).data, b = new Uint8Array(c.width * c.height);
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let i = 0; i < b.length; i++) if (d[i * 4 + 3] > 110) { b[i] = 1; const px = i % c.width, py = (i - px) / c.width; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    return x1 < 0 ? null : shapeOf(b, c.width, x0, y0, x1, y1, SPX);
  };
  for (const fam of ['"Times New Roman", Times, serif', 'Georgia, serif', 'Helvetica, Arial, sans-serif']) for (const wt of ['', 'bold ']) for (const hgt of [0.9, 1.25, 1.6]) for (let n = 0; n <= 5; n++) {
    const sh = cutText(wt + fam, String(n), hgt); if (sh) (out['F' + n] = out['F' + n] || []).push(sh);
  }
  // (the 8 of an octave line, as engravers set it: an italic or plain figure)
  for (const fam of ['"Times New Roman", Times, serif', 'Georgia, serif']) for (const wt of ['italic ', 'bold italic ', '', 'bold ']) for (const hgt of [1.2, 1.6]) {
    const sh = cutText(wt + fam, '8', hgt); if (sh) (out.T8 = out.T8 || []).push(sh);
  }
  for (const fam of ['"Times New Roman", Times, serif', 'Georgia, serif']) for (const hgt of [1.5, 2.0]) for (const L of 'pmfrsz') {
    const sh = cutText('bold italic ' + fam, L, L === 'f' ? hgt * 1.25 : L === 'p' ? hgt : hgt * 0.62); if (sh) (out['D' + L] = out['D' + L] || []).push(sh);
  }
  // the same signs in more music fonts, and dynamics, fingering and guitar fingers
  for (const [k, list] of Object.entries(MARKS)) out[k] = [...(out[k] || []), ...list];
  TEMPL = out;
  return out;
}
const decode = (s) => { const t = atob(s.m); const a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; };
// How many white areas a shape closes in (an 8 two, a 6 or 9 one, a 3 none).
function holesIn(C, w, h, g) {
  const x0 = Math.max(0, g.x0 - 1), y0 = Math.max(0, g.y0 - 1), x1 = Math.min(w - 1, g.x1 + 1), y1 = Math.min(h - 1, g.y1 + 1);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, seen = new Uint8Array(W * H);
  const ink = (x, y) => C[(y + y0) * w + x + x0];
  const fill = (sx, sy) => { const q = [sx, sy]; seen[sy * W + sx] = 1; let n = 0; while (q.length) { const y = q.pop(), x = q.pop(); n++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || seen[yy * W + xx] || ink(xx, yy)) continue; seen[yy * W + xx] = 1; q.push(xx, yy); } } return n; };
  for (let x = 0; x < W; x++) { if (!ink(x, 0) && !seen[x]) fill(x, 0); if (!ink(x, H - 1) && !seen[(H - 1) * W + x]) fill(x, H - 1); }
  for (let y = 0; y < H; y++) { if (!ink(0, y) && !seen[y * W]) fill(0, y); if (!ink(W - 1, y) && !seen[y * W + W - 1]) fill(W - 1, y); }
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!seen[y * W + x] && !ink(x, y)) { const a = fill(x, y); if (a >= 3) n++; }
  return n;
}
function nearest(shape, classes, sizeW = 0.35) {
  if (!TEMPL) return { cls: null, d: 9 };
  const g = decode(shape);
  let best = { cls: null, d: 9 };
  for (const cls of classes) for (const ref of TEMPL[cls] || []) {
    const r = ref._g || (ref._g = decode(ref));
    let d = 0; for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - r[i]);
    d /= g.length * 255;
    d += 0.45 * Math.abs(Math.log((shape.ws / shape.hs) / (ref.ws / ref.hs))) + sizeW * Math.abs(shape.hs - ref.hs) / Math.max(shape.hs, ref.hs);
    if (d < best.d) best = { cls, d };
  }
  return best;
}

// ---- curves: the middle of a thin stroke, column by column. Where something thick crosses it
// (a stem, a head) the column is skipped; where two strokes share a column the one nearer the
// line so far is followed.
function centreLine(lab, w, c, maxRun) {
  const xs = [], ys = [], runs = [], ths = [];
  let prev = null;
  for (let x = c.x0; x <= c.x1; x++) {
    const rs = []; let y0 = -1;
    for (let y = c.y0; y <= c.y1 + 1; y++) { const on = y <= c.y1 && lab[y * w + x] === c.id; if (on && y0 < 0) y0 = y; if (!on && y0 >= 0) { rs.push([y0, y - 1]); y0 = -1; } }
    if (!rs.length) continue;
    const thin = rs.filter((r) => r[1] - r[0] + 1 <= maxRun);
    if (!thin.length) continue;
    const mid = (r) => (r[0] + r[1]) / 2;
    const pick = prev === null ? thin[0] : thin.reduce((a, b) => (Math.abs(mid(b) - prev) < Math.abs(mid(a) - prev) ? b : a));
    prev = mid(pick); xs.push(x); ys.push(prev); runs.push(rs.length); ths.push(pick[1] - pick[0] + 1);
  }
  return { xs, ys, runs, ths };
}

// read: the staves as readStaff returned them (work coordinates); ctx: the reader's pictures.
// An accent ( > ) under or over a head, matched as a shape in the printed page: the pixels of a
// drawn wedge must be ink, the space around and between its arms must be paper; pixels of the
// staff lines (ink in the page, gone once the lines are taken out) count for neither.
const WEDGES = new Map();
function wedgeTpl(wd, ht, th) {
  const key = wd + ':' + ht + ':' + th; if (WEDGES.has(key)) return WEDGES.get(key);
  const ink = [], bg = [];
  const seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
  for (let y = 0; y < ht; y++) for (let x = 0; x < wd; x++) {
    const d = Math.min(seg(x + 0.5, y + 0.5, 0.5, 0.5, wd - 0.5, ht / 2), seg(x + 0.5, y + 0.5, 0.5, ht - 0.5, wd - 0.5, ht / 2));
    if (d <= th / 2) ink.push([x, y]); else if (d > th / 2 + 1.6) bg.push([x, y]);
  }
  const t = { ink, bg }; WEDGES.set(key, t); return t;
}
function wedgeAt(ctx, hd, below, sp, w, h) {
  const B = ctx.B, C0 = ctx.C0;
  const masked = (i) => B[i] && !C0[i];   // a staff line here
  const yA = Math.round(below ? hd.cy + sp * 0.5 : hd.cy - sp * 2.7), yB = Math.round(below ? hd.cy + sp * 2.7 : hd.cy - sp * 0.5);
  const m = Math.max(2, Math.round(sp * 0.2));
  // (a frame around it: the wedge stands clear, no other ink running into its ends)
  const touchOf = (x0, y0, wd, ht) => { let t = 0; for (let y = y0 - 1; y <= y0 + ht; y++) for (const x of [x0 - m, x0 + wd + m - 1]) { const i = y * w + x; if (B[i] && !masked(i)) t++; } return t; };
  let best = null, loose = null;
  const strict = !globalThis.__accProbe;
  for (const k of [1.1, 1.25, 1.4, 1.55]) for (const tk of [0.14, 0.2, 0.26]) {
    const wd = Math.round(sp * k), ht = Math.max(5, Math.round(wd * 0.58)), th = Math.max(2, sp * tk);
    const T2 = wedgeTpl(wd, ht, th);
    for (let y0 = yA; y0 + ht <= yB; y0++) for (let x0 = Math.round(hd.cx - wd / 2 - sp * 0.3); x0 <= Math.round(hd.cx - wd / 2 + sp * 0.3); x0++) {
      if (x0 < m + 1 || y0 < 2 || x0 + wd + m >= w - 1 || y0 + ht >= h - 2) continue;
      let ni = 0, hi = 0, nb = 0, hb = 0;
      // (given up as soon as it cannot be a wedge: too many of its pixels paper, too much ink round it;
      // the answer is the same, found sooner)
      const missMax = (strict ? 0.15 : 0.4) * T2.ink.length, bgMax = 0.1 * T2.bg.length;
      let miss = 0, out = false;
      for (const [x, y] of T2.ink) { const i = (y0 + y) * w + x0 + x; if (masked(i)) continue; ni++; if (B[i]) hi++; else if (++miss > missMax) { out = true; break; } }
      if (out || ni < T2.ink.length * 0.45 || hi < ni * 0.6) continue;
      for (const [x, y] of T2.bg) { const i = (y0 + y) * w + x0 + x; if (masked(i)) continue; nb++; if (B[i] && ++hb > bgMax && strict) { out = true; break; } }
      if (out || !nb) continue;
      const ink = hi / ni, bg = hb / nb, sc = ink - bg * 2;
      if (!loose || sc > loose.sc) loose = { sc: +sc.toFixed(2), ink: +ink.toFixed(2), bg: +bg.toFixed(2), k, tk };
      if (ink < 0.85 || bg > 0.1 || (best && sc <= best.sc)) continue;
      const touch = touchOf(x0, y0, wd, ht);
      if (touch <= 2) best = { sc, x0, y0, wd, ht, ink: +ink.toFixed(2), bg: +bg.toFixed(2), k, tk };
    }
  }
  if (globalThis.__accProbe) globalThis.__accProbe.push({ wedge: best, loose, hd: [Math.round(hd.cx), Math.round(hd.cy)] });
  return best;
}
export function readMarks(read, ctx) {
  const { w, h, staffOf } = ctx;
  const staffIdx = new Map(read.map((s, i) => [s, i]));
  const sp0 = read[0].sp;
  // the ink without the staff lines, piece by piece: anything wide and not too tall may hold a curve
  const lab = ctx.labC;
  // (a thick stroke all along, a page printed heavy or with a grey halo, is followed too)
  const enough = (c, cl) => cl.xs.length >= Math.max(2, (c.x1 - c.x0 + 1) * 0.55);
  let pieces = ctx.rawC.filter((c) => c.w >= sp0 * 0.6 && c.h <= sp0 * 4.5 && c.h >= 2).map((c) => {
    let cl = centreLine(lab, w, c, Math.max(3, sp0 * 0.42));
    if (!enough(c, cl)) {
      const cl2 = centreLine(lab, w, c, Math.max(3, sp0 * 0.62));
      const th = cl2.ths.slice().sort((a, b) => a - b), med = th.length ? th[th.length >> 1] : 0;
      // (and nothing upright in it: a beam with its stems is no curve)
      let tall = false;
      if (enough(c, cl2) && med >= sp0 * (globalThis.__thickMed ?? 0.45)) for (let x = c.x0; x <= c.x1 && !tall; x++) { let run = 0; for (let y = c.y0; y <= c.y1; y++) { if (lab[y * w + x] === c.id) { if (++run > sp0 * 0.9) { tall = true; break; } } else run = 0; } }
      if (enough(c, cl2) && med >= sp0 * (globalThis.__thickMed ?? 0.45) && !tall) cl = cl2;
    }
    return { ...c, cl, ids: [c.id] };
  }).filter((p) => enough(p, p.cl))
    // (a fingering digit by the slur's end is no part of the curve)
    .filter((p) => !((globalThis.__digitPiece ?? 1) && p.h >= sp0 * 0.6 && p.h <= sp0 * 1.7 && p.w <= sp0 * 1.15 && nearest(shapeOf(ctx.C, w, p.x0, p.y0, p.x1, p.y1, sp0, ctx.labC, p.id), ['F0', 'F1', 'F2', 'F3', 'F4', 'F5']).d < 0.3));
  // (a slur or tie run into a note's head or stem is one shape with it: its thin stroke alone)
  if (ctx.thinComps && (globalThis.__thinSlur ?? 1)) {
    for (const c of ctx.thinComps) {
      if (c.w < sp0 * 1.0 || c.h > sp0 * 3 || c.h < 2) continue;
      const cl = centreLine(ctx.thinLab, w, c, Math.max(3, sp0 * 0.42));
      if (cl.xs.length < (c.x1 - c.x0 + 1) * 0.7) continue;
      pieces.push({ ...c, id: 'T' + c.id, cl, ids: ['T' + c.id], thin: true });
    }
  }
  pieces.sort((a, b) => a.x0 - b.x0);
  const joined = [];
  for (const p of pieces) {
    const yEndOf = (q) => q.cl.ys[q.cl.ys.length - 1], yStartOf = (q) => q.cl.ys[0];
    let host = null, bestD = Infinity;
    for (const q of joined) {
      const gx = p.x0 - q.x1; if (gx < -sp0 * 0.1) continue;
      const dy = Math.abs(yStartOf(p) - yEndOf(q)); if (dy > sp0 * 0.55) continue;
      // (a longer break, where the curve passed a stem or a digit and lost its ink: only between two
      // long, thin pieces that carry on at the same height and slope)
      if (gx > sp0 * 0.9) {   // (off unless asked: it changed the readings of real pages for the worse)
        const G = globalThis.__slurGap ?? 0;
        if (gx > sp0 * G || dy > sp0 * 0.35 || q.x1 - q.x0 < sp0 * 1.5 || p.x1 - p.x0 < sp0 * 1.5 || q.y1 - q.y0 > sp0 * 2.2 || p.y1 - p.y0 > sp0 * 2.2) continue;
        const nq = q.cl.ys.length, np = p.cl.ys.length; if (nq < 6 || np < 6) continue;
        const sq = (q.cl.ys[nq - 1] - q.cl.ys[nq - 6]) / Math.max(1, q.cl.xs[nq - 1] - q.cl.xs[nq - 6]), spp = (p.cl.ys[5] - p.cl.ys[0]) / Math.max(1, p.cl.xs[5] - p.cl.xs[0]);
        const pred = yEndOf(q) + sq * gx; if (Math.abs(pred - yStartOf(p)) > sp0 * 0.35 || Math.abs(sq - spp) > 0.5) continue;
      }
      const d = gx + dy * 2; if (d < bestD) { bestD = d; host = q; }
    }
    if (host) {
      host.x1 = Math.max(host.x1, p.x1); host.y0 = Math.min(host.y0, p.y0); host.y1 = Math.max(host.y1, p.y1); host.n += p.n; host.ids.push(p.id);
      host.cl = { xs: [...host.cl.xs, ...p.cl.xs], ys: [...host.cl.ys, ...p.cl.ys], runs: [...host.cl.runs, ...p.cl.runs] };
    } else joined.push({ ...p, cl: { ...p.cl } });
  }
  if (globalThis.__slurDbg) globalThis.__slurDbg.push({ joined: joined.filter((c) => c.x1 - c.x0 > sp0 * 2).map((c) => [c.x0, c.x1, c.y0, c.y1, c.ids.length, c.cl.xs.length]) });
  const curves = [];
  for (const c of joined) {
    const cw = c.x1 - c.x0 + 1; if (cw < sp0 * 1.0) continue;
    const { xs, ys, runs } = c.cl;
    // one stroke (a hairpin is two)
    if (runs.filter((r) => r > 1).length > runs.length * 0.3) continue;
    const yL = ys[0], yR = ys[ys.length - 1];
    let sag = 0, at = 0;
    for (let i = 0; i < xs.length; i++) { const lin = yL + ((yR - yL) * (xs[i] - xs[0])) / Math.max(1, xs[xs.length - 1] - xs[0]); const d = ys[i] - lin; if (Math.abs(d) > Math.abs(sag)) { sag = d; at = i; } }
    // a curve: it bends (straight thin strokes are ledger lines, hairpins, the end of a beam)
    // (a thin stroke on its own, a short flat slur, bends less)
    const thinOnly = c.ids.every((q) => String(q)[0] === 'T');
    if (Math.abs(sag) < Math.max(sp0 * (thinOnly ? 0.1 : 0.16), cw * 0.035)) continue;
    // and bends once, about in the middle, with both ends on the same side
    const f = (xs[at] - xs[0]) / Math.max(1, xs[xs.length - 1] - xs[0]); if (f < 0.12 || f > 0.88) continue;
    if (Math.abs(sag) > cw * 0.6) continue;
    // (the same curve seen twice, alone and with what it touches: once)
    if (curves.some((q) => Math.abs(q.x0 - xs[0]) < sp0 * 0.6 && Math.abs(q.x1 - xs[xs.length - 1]) < sp0 * 0.6 && Math.abs(q.yL - yL) < sp0 * 0.6 && Math.abs(q.yR - yR) < sp0 * 0.6)) continue;
    curves.push({ x0: xs[0], x1: xs[xs.length - 1], yL, yR, sag, below: sag > 0, w: cw, thinOnly });
  }
  // (a piece of a longer curve, cut off by the stems it crosses: part of that one)
  {
    const yOn = (q, x) => q.yL + ((q.yR - q.yL) * (x - q.x0)) / Math.max(1, q.x1 - q.x0);
    for (let i = curves.length - 1; i >= 0; i--) {
      const c = curves[i]; if (!c.thinOnly) continue;
      if (curves.some((q) => q !== c && q.w > c.w * 1.3 && q.x0 <= c.x0 + sp0 * 0.3 && q.x1 >= c.x1 - sp0 * 0.3 && Math.abs(yOn(q, (c.x0 + c.x1) / 2) + (q.below ? 1 : -1) * Math.abs(q.sag) * 0.5 - (c.yL + c.yR) / 2) < sp0 * 1.6)) curves.splice(i, 1);
    }
  }
  // ---- every head, with the staff it is on
  const all = [];
  read.forEach((s, si) => s.heads.forEach((hd, hi) => { hd.id = si * 1000 + hi; hd.art = []; all.push({ hd, s, si }); }));
  const reach = (hd, below) => {
    // the far side of the note on the curve's side: the stem's end if the stem is there
    if (hd.stem && hd.stem.up !== below) return below ? hd.stem.bot : hd.stem.top;
    return below ? hd.cy + hd.s * 0.45 : hd.cy - hd.s * 0.45;
  };
  for (const a of all) a.hd.s = a.s.sp;
  const endHead = (x, y, below, left, far = 2.0, dyMax = 2.6) => {
    let best = null, bd = Infinity;
    for (const a of all) {
      const hd = a.hd, sp = a.s.sp;
      const dx = left ? x - hd.cx : hd.cx - x;            // the curve starts just after (or ends just before) the head's middle
      if (dx < -sp * 1.6 || dx > sp * far) continue;
      const r = reach(hd, below);
      const dyHead = below ? y - (hd.cy + sp * 0.3) : (hd.cy - sp * 0.3) - y;
      const dyStem = below ? y - r : r - y;
      const dy = Math.min(Math.abs(dyHead), Math.abs(dyStem));
      if (dy > sp * dyMax || dyHead < -sp * 0.8) continue;
      const d = Math.abs(dx) * 0.8 + dy;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  };
  const slurs = read.map(() => []);
  // (a long slur whose flat top lay along a ledger line's place lost it with the line: a rising half
  // that starts at a note and a falling half that ends at one, one after the other at the same
  // height, are one slur)
  if (globalThis.__slurHalves ?? 1) {
    curves.sort((p, q) => p.x0 - q.x0);
    const ends = curves.map((cv) => ({ A: endHead(cv.x0, cv.yL, cv.below, true), B: endHead(cv.x1, cv.yR, cv.below, false) }));
    for (let i = 0; i < curves.length; i++) {
      const P = curves[i], eP = ends[i]; if (!P || !eP.A || eP.B) continue;
      if (!(P.below ? P.yR > P.yL + sp0 * 0.4 : P.yR < P.yL - sp0 * 0.4)) continue;
      for (let j = i + 1; j < curves.length; j++) {
        const Q = curves[j], eQ = ends[j]; if (!Q || Q.below !== P.below) continue;
        const gap = Q.x0 - P.x1; if (gap < -sp0 * 0.5) continue; if (gap > sp0 * 9) break;
        if (!eQ.B || eQ.A || Math.abs(Q.yL - P.yR) > sp0 * 0.9) continue;
        if (!(P.below ? Q.yR < Q.yL - sp0 * 0.4 : Q.yR > Q.yL + sp0 * 0.4)) continue;
        if (eP.A.si !== eQ.B.si) continue;
        curves[i] = { x0: P.x0, x1: Q.x1, yL: P.yL, yR: Q.yR, sag: P.below ? Math.abs(P.yR - P.yL) : -Math.abs(P.yR - P.yL), below: P.below, w: Q.x1 - P.x0 + 1, thinOnly: false };
        curves[j] = null; break;
      }
    }
    for (let i = curves.length - 1; i >= 0; i--) if (!curves[i]) curves.splice(i, 1);
  }
  for (const cv of curves) {
    let A = endHead(cv.x0, cv.yL, cv.below, true), B = endHead(cv.x1, cv.yR, cv.below, false);
    // the thin end of a slur is often lost where it runs along a staff line: with one end found,
    // the other may start a little further from where the curve was seen
    // (and a little further off the note too: a staccato or tenuto under the slur's end lifts it)
    if (A && !B) B = endHead(cv.x1, cv.yR, cv.below, false, 4.2) || endHead(cv.x1, cv.yR, cv.below, false, 2.0, 3.6);
    else if (B && !A) A = endHead(cv.x0, cv.yL, cv.below, true, 4.2) || endHead(cv.x0, cv.yL, cv.below, true, 2.0, 3.6);
    if (globalThis.__slurDbg) globalThis.__slurDbg.push({ x0: Math.round(cv.x0), x1: Math.round(cv.x1), yL: Math.round(cv.yL), yR: Math.round(cv.yR), below: cv.below, A: A && [Math.round(A.hd.cx), Math.round(A.hd.cy)], B: B && [Math.round(B.hd.cx), Math.round(B.hd.cy)], near: all.filter((q) => Math.abs(q.hd.cx - cv.x0) < 60 || Math.abs(q.hd.cx - cv.x1) < 60).map((q) => [Math.round(q.hd.cx), Math.round(q.hd.cy), q.hd.stem ? (q.hd.stem.up ? 'up' : 'dn') : '-']) });
    if (!A && !B) continue;
    // (a thin stroke found on its own: only when it runs from one note to another)
    if (cv.thinOnly && !(A && B)) continue;
    // (the beam between two beamed notes, a thick one, is no curve)
    if (A && B && A.hd.bg != null && A.hd.bg === B.hd.bg && A.hd.stem && B.hd.stem && A.hd.stem.up === B.hd.stem.up && cv.below !== A.hd.stem.up && Math.abs(cv.yL - A.hd.stem.end) < A.s.sp * 0.7 && Math.abs(cv.yR - B.hd.stem.end) < A.s.sp * 0.7) continue;
    const s = (A || B).s, si = (A || B).si;
    if (A && B && A.si !== B.si) continue;
    if (A && B && A.hd === B.hd) continue;
    // a tie: the same note, the very next one on the staff
    if (A && B && A.hd.p === B.hd.p) {
      const between = s.heads.some((q) => q.cx > A.hd.cx + s.sp * 0.6 && q.cx < B.hd.cx - s.sp * 0.6) || (s.rests || []).some((r) => r.x > A.hd.cx + s.sp * 0.4 && r.x < B.hd.cx - s.sp * 0.4);
      if (!between) { A.hd.tieTo = B.hd.id; continue; }
    }
    // a slur from one note to another (or to the end or start of the line)
    const heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
    const a = A ? A.hd : heads.find((q) => q.cx > cv.x0 - s.sp), b = B ? B.hd : heads.slice().reverse().find((q) => q.cx < cv.x1 + s.sp);
    if (!a || !b || a === b || b.cx <= a.cx) continue;
    slurs[si].push({ a: a.id, b: b.id, below: cv.below });
  }
  // ---- ties, looked for directly: between two notes of the same pitch, one after the other, a
  // thin arc just under (or over) them
  for (const s of read) {
    const sp = s.sp, C = ctx.C, heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
    const si0 = read.indexOf(s), byId = new Map(heads.map((q) => [q.id, q]));
    // (repeated notes under a slur: its arc passes over them, and is no tie)
    const restBetween = (A, B) => (s.rests || []).some((r) => r.x > A.cx + sp * 0.4 && r.x < B.cx - sp * 0.4);
    const underSlur = (A, B, below) => slurs[si0].some((q) => { const a = byId.get(q.a), b = byId.get(q.b); return a && b && q.below === below && a.cx <= A.cx + 1 && b.cx >= B.cx - 1 && (a !== A || b !== B); });
    for (const A of heads) {
      if (A.tieTo !== undefined) continue;
      const next = heads.find((q) => q.cx > A.cx + sp * 0.6);
      if (!next) continue;
      const B = heads.find((q) => q.cx >= next.cx - sp * 0.3 && q.cx < next.cx + sp * 0.5 && q.p === A.p);
      if (!B) continue;
      const xa = Math.round(A.cx + sp * 0.45), xb = Math.round(B.cx - sp * 0.45);
      if (xb - xa < sp * 0.5) continue;
      for (const below of [true, false]) {
        const ys = [];
        for (let x = xa; x <= xb; x++) {
          let found = null;
          for (let k = Math.round(sp * 0.1); k <= Math.round(sp * 1.9); k++) {
            const y = Math.round(A.cy + (below ? k : -k)); if (y < 0 || y >= h) break;
            // where the arc runs along a staff line, the line was taken away with it: there the
            // line is simply thicker than a line
            let onLine = false;
            if (!C[y * w + x] && ctx.B[y * w + x]) {
              let a2 = y, z2 = y; while (a2 > 0 && ctx.B[(a2 - 1) * w + x]) a2--; while (z2 < h - 1 && ctx.B[(z2 + 1) * w + x]) z2++;
              const len = z2 - a2 + 1; if (len > ctx.T + Math.max(1, sp * 0.06) && len <= ctx.T + sp * 0.45) { onLine = true; }
              if (onLine) { found = (a2 + z2) / 2; break; }
              k += len; continue;
            }
            if (C[y * w + x]) {
              // a thin stroke here (not a stem or a head running through)
              let e = y; while (e >= 0 && e < h && C[e * w + x] && Math.abs(e - y) < sp) e += below ? 1 : -1;
              if (Math.abs(e - y) <= sp * 0.42) found = (y + e) / 2;
              break;
            }
          }
          if (found !== null) ys.push([x, found]);
        }
        if (ys.length < (xb - xa + 1) * 0.45) continue;
        const yEnd = (ys[0][1] + ys[ys.length - 1][1]) / 2;
        const mid = ys.filter(([x]) => Math.abs(x - (xa + xb) / 2) < (xb - xa) * 0.2).map(([, y]) => y);
        if (!mid.length) continue;
        const yMid = mid.reduce((a, b) => a + b, 0) / mid.length;
        const bow = below ? yMid - yEnd : yEnd - yMid;
        if (underSlur(A, B, below) || restBetween(A, B)) continue;
        if (bow >= sp * 0.1 || (xb - xa < sp * 1.6 && bow >= 0)) { A.tieTo = B.id; break; }
      }
    }
    // ---- short slurs from one note to the next (a small arc under or over the two heads, on the
    // side away from the stems), looked for directly: too short and thin to be seen as a curve
    if (globalThis.__shortSlur ?? 1) for (let i = 0; i + 1 < heads.length; i++) {
      const A = heads[i]; if (A.tieTo !== undefined) continue;
      const B = heads.find((q) => q.cx > A.cx + sp * 0.6); if (!B || B.p === A.p) continue;
      // (single notes only: a chord on either side is left alone)
      if (heads.some((q) => q !== A && Math.abs(q.cx - A.cx) < sp * 0.5) || heads.some((q) => q !== B && Math.abs(q.cx - B.cx) < sp * 0.5)) continue;
      if (B.cx - A.cx > sp * 4.5 || restBetween(A, B)) continue;
      if (slurs[si0].some((q) => { const a = byId.get(q.a), b = byId.get(q.b); return a && b && a.cx <= A.cx + 1 && b.cx >= B.cx - 1; })) continue;
      const upA = A.stem ? A.stem.up : null, upB = B.stem ? B.stem.up : null;
      if (upA !== null && upB !== null && upA !== upB) continue;
      const below = (upA ?? upB ?? true) === true;
      const xa = Math.round(A.cx + sp * 0.5), xb = Math.round(B.cx - sp * 0.5);
      if (xb - xa < sp * 0.6) continue;
      const ys = [], lns = [];
      for (let x = xa; x <= xb; x++) {
        const yl = A.cy + ((B.cy - A.cy) * (x - xa)) / Math.max(1, xb - xa);
        let found = null; const lines = [];
        for (let k = Math.round(sp * 0.25); k <= Math.round(sp * 2.2); k++) {
          const y = Math.round(yl + (below ? k : -k)); if (y < 0 || y >= h) break;
          if (!C[y * w + x] && ctx.B[y * w + x]) {
            let a2 = y, z2 = y; while (a2 > 0 && ctx.B[(a2 - 1) * w + x]) a2--; while (z2 < h - 1 && ctx.B[(z2 + 1) * w + x]) z2++;
            const len = z2 - a2 + 1; if (len > ctx.T + Math.max(1, sp * 0.06) && len <= ctx.T + sp * 0.45) { found = (a2 + z2) / 2; break; }
            lines.push((a2 + z2) / 2 - yl);
            k += len; continue;
          }
          if (C[y * w + x]) {
            let e = y; while (e >= 0 && e < h && C[e * w + x] && Math.abs(e - y) < sp) e += below ? 1 : -1;
            if (Math.abs(e - y) <= sp * 0.45) { found = (y + e) / 2; break; }
            // (the edge of one of the two heads: the arc is past it)
            if (Math.min(Math.abs(x - A.cx), Math.abs(x - B.cx)) < sp * 0.8 && Math.abs(e - y) < sp * 0.9) { k += Math.abs(e - y); continue; }
            break;
          }
        }
        // (where the arc runs inside a staff line it cannot be told from it: the line's place, as a guess)
        ys.push(found !== null ? [x, found - yl] : null); lns.push(lines);
      }
      for (let q = 0; q < ys.length; q++) {
        if (ys[q] || !lns[q].length) continue;
        let l = q - 1; while (l >= 0 && (!ys[l] || ys[l][2])) l--;
        let r = q + 1; while (r < ys.length && !ys[r]) r++;
        if (l < 0 || r >= ys.length) continue;
        const want = ys[l][1] + ((ys[r][1] - ys[l][1]) * (q - l)) / (r - l);
        const ln = lns[q].find((v) => Math.abs(v - want) < sp * 0.3);
        if (ln !== undefined) ys[q] = [xa + q, ln, 1];
      }
      // (and on from a found end, along the line, while it stays where the arc was going)
      for (const dir of [1, -1]) for (let q = dir > 0 ? 1 : ys.length - 2; q >= 0 && q < ys.length; q += dir) {
        const pv = ys[q - dir]; if (ys[q] || !pv || !lns[q].length) continue;
        const ln = lns[q].find((v) => Math.abs(v - pv[1]) < sp * 0.2);
        if (ln !== undefined) ys[q] = [xa + q, ln, 1];
      }
      const got = ys.filter(Boolean), seen = got.filter((q) => !q[2]).length;
      { const D = globalThis.__slurDbg || globalThis.__shortLog; if (D) D.push({ shortTry: [Math.round(A.cx), Math.round(A.cy), Math.round(B.cx), Math.round(B.cy)], below, cover: +(got.length / ys.length).toFixed(2), ds: ys.map((q, k) => q ? Math.round(q[1]) + (q[2] ? 'L' : '') : '_' + lns[k].map(Math.round).join('/')).join(',') }); }
      if (got.length < ys.length * 0.8 || seen < ys.length * 0.3) continue;
      // smooth: no jumps from column to column (one stroke), bowing out in the middle
      let jumps = 0; for (let j = 1; j < got.length; j++) if (Math.abs(got[j][1] - got[j - 1][1]) > sp * 0.25) jumps++;
      if (jumps > 1) continue;
      const n3 = Math.max(1, Math.floor(got.length / 4));
      const endsD = (got.slice(0, n3).reduce((a, q) => a + q[1], 0) + got.slice(-n3).reduce((a, q) => a + q[1], 0)) / (2 * n3);
      const mid = got.filter(([x]) => Math.abs(x - (xa + xb) / 2) < (xb - xa) * 0.2).map(([, d]) => d); if (!mid.length) continue;
      const midD = mid.reduce((a, b) => a + b, 0) / mid.length;
      const bow = below ? midD - endsD : endsD - midD;
      if (globalThis.__slurDbg) globalThis.__slurDbg.push({ short: [Math.round(A.cx), Math.round(B.cx)], cover: +(got.length / ys.length).toFixed(2), jumps, bow: +(bow / sp).toFixed(2) });
      const midDepth = mid.slice().sort((a, b) => a - b)[mid.length >> 1] * (below ? 1 : -1);
      // (a long stroke running on past the two notes at the same depth, a slur or a hairpin seen
      // in part, is no short slur)
      const runsOn = (x0, x1, yAt, d) => { let n = 0, t = 0; for (let x = x0; x <= x1; x++) { t++; const lo = Math.round(yAt + (below ? 1 : -1) * (d - sp * 1.0)), hi = Math.round(yAt + (below ? 1 : -1) * (d + sp * 0.8)); for (let y = Math.min(lo, hi); y <= Math.max(lo, hi); y++) { if (y < 0 || y >= h || !C[y * w + x]) continue; let e = y; while (e < h && C[e * w + x]) e++; if (e - y <= sp * 0.55) { n++; break; } y = e; } } return t && n > t * 0.5; };
      const d0 = midDepth + (A.cy - B.cy) / 2 * (below ? -1 : 1), d1 = midDepth + (B.cy - A.cy) / 2 * (below ? -1 : 1);
      const on = runsOn(Math.round(A.cx - sp * 1.3), Math.round(A.cx - sp * 0.5), A.cy, d0) || runsOn(Math.round(B.cx + sp * 0.5), Math.round(B.cx + sp * 1.3), B.cy, d1);
      { const D = globalThis.__slurDbg || globalThis.__shortLog; if (D) D.push({ shortOk: [Math.round(A.cx), Math.round(B.cx)], bow: +(bow / sp).toFixed(2), depth: +(midDepth / sp).toFixed(2), on }); }
      if (on || bow > sp * 1.2 || midDepth < sp * 1.0 || !(bow >= sp * 0.15 || (bow > -sp * 0.1 && midDepth >= sp * 1.1))) continue;
      slurs[si0].push({ a: A.id, b: B.id, below });
    }
  }
  // ---- signs over and under the notes
  // small dots on their own (a dot just over a head is often joined to it across a staff line), and
  // the other signs as the reader grouped them
  // (a small piece of a bigger sign, such as a tuplet's 3 cut by the beam, is not a dot)
  const inBig = new Set();
  // (a dot put together with the note head across a staff line is still a dot: groups holding a
  // head do not count)
  const headIn = (g) => read.some((s) => s.heads.some((hd) => hd.cx > g.x0 && hd.cx < g.x1 && hd.cy > g.y0 && hd.cy < g.y1));
  for (const g of ctx.compsC) {
    if (!Array.isArray(g.id) || !(g.w > read[0].sp * 0.5 || g.h > read[0].sp * 0.5)) continue;
    if (!headIn(g)) { for (const id of g.id) inBig.add(id); continue; }
    // with a head: only a piece cut off by a staff line (not one touching the rest) may be a dot
    const parts = g.id.map((id) => ctx.rawC[id]).filter(Boolean);
    for (const a of parts) {
      const touches = parts.some((b) => b !== a && a.x0 <= b.x1 + 2 && b.x0 <= a.x1 + 2 && a.y0 <= b.y1 + 1 && b.y0 <= a.y1 + 1);
      if (touches) inBig.add(a.id);
    }
  }
  // (and a sign the reader grouped with a long stroke running by it, a slur or a hairpin line: the
  // sign's own piece, on its own)
  const sp00 = read[0].sp;
  const fromBig = (globalThis.__signPieces ?? 1) ? ctx.rawC.filter((c) => {
    if (c.w < sp00 * 0.6 || c.w > sp00 * 3 || c.h > sp00 * 2.4 || ctx.groupOf === undefined) return false;
    const grp = ctx.compsC[ctx.groupOf[c.id]];
    return grp && Array.isArray(grp.id) && grp.id.length > 1 && (grp.w > sp00 * 3 || grp.h > sp00 * 2.4) && !headIn(c);
  }) : [];
  const comps = [...ctx.rawC.filter((c) => c.w <= read[0].sp * 0.7 && c.h <= read[0].sp * 0.7 && !inBig.has(c.id)), ...ctx.compsC.filter((c) => c.w > read[0].sp * 0.55)];
  const bigPiece = new Set(fromBig);
  const taken = new Set();
  // letters packed close together in a row, outside the staff, are words (dolce, cresc.): no sign
  // or digit is read in them
  const wordish = new Set();
  {
    const sp0 = read[0].sp;
    const cand = ctx.compsC.filter((g) => g.h >= sp0 * 0.3 && g.h <= sp0 * 2.2 && g.w <= sp0 * 2.6 && !read.some((s) => (g.y0 + g.y1) / 2 > s.top - sp0 * 0.3 && (g.y0 + g.y1) / 2 < s.bottom + sp0 * 0.3) && !read.some((s) => s.heads.some((hd) => hd.cx > g.x0 && hd.cx < g.x1 && hd.cy > g.y0 && hd.cy < g.y1))).sort((a, b) => a.x0 - b.x0);
    const used = new Set();
    const runs = [];
    for (const a of cand) {
      if (used.has(a)) continue;
      const run = [a];
      let last = a;
      for (const b of cand) {
        if (b.x0 <= last.x0 || used.has(b) || run.includes(b)) continue;
        if (b.x0 - last.x1 > sp0 * 0.45) { if (b.x0 > last.x1 + sp0 * 0.45) break; continue; }
        const oy = Math.min(b.y1, last.y1) - Math.max(b.y0, last.y0);
        if (oy < Math.min(b.h, last.h) * 0.4) continue;
        run.push(b); last = b;
      }
      for (const g of run) used.add(g);
      runs.push(run);
    }
    // words one after another on a line ('avec beaucoup de couleur'): the line is words when one of
    // them is a word of three letters or more (fingerings in a row are single digits)
    const box = (r) => ({ x0: Math.min(...r.map((g) => g.x0)), x1: Math.max(...r.map((g) => g.x1)), y0: Math.min(...r.map((g) => g.y0)), y1: Math.max(...r.map((g) => g.y1)) });
    runs.sort((p, q) => box(p).x0 - box(q).x0);
    const lines = [];
    for (const r of runs) {
      const b = box(r);
      const l = lines.find((L) => b.x0 - L.x1 <= sp0 * 1.3 && b.x0 >= L.x0 && Math.min(b.y1, L.y1) - Math.max(b.y0, L.y0) >= Math.min(b.y1 - b.y0, L.y1 - L.y0) * 0.4);
      if (l) { l.runs.push(r); l.x1 = Math.max(l.x1, b.x1); l.y0 = Math.min(l.y0, b.y0); l.y1 = Math.max(l.y1, b.y1); }
      else lines.push({ ...b, runs: [r] });
    }
    for (const L of lines) {
      const all = L.runs.flat();
      const word = L.runs.some((r) => r.length >= 3 && box(r).x1 - box(r).x0 > sp0 * 1.5) || L.runs.some((r) => r.length >= 4 && box(r).x1 - box(r).x0 > sp0 * 2.5);
      if (!(word && all.length >= 4 && L.x1 - L.x0 > sp0 * 2.5)) continue;
      for (const g of all) wordish.add(g);
      // and the small bits among the letters (dots of i, accents, pieces of thin strokes)
      const m = sp0 * 0.25;
      for (const g of [...ctx.rawC, ...ctx.compsC]) if (g.x0 >= L.x0 - m && g.x1 <= L.x1 + m && g.y0 >= L.y0 - m && g.y1 <= L.y1 + m && g.w <= sp0 * 0.7 && g.h <= sp0 * 0.7) wordish.add(g);
    }
  }
  const rawById = new Map(ctx.rawC.map((r) => [r.id, r]));
  for (const s of read) {
    const sp = s.sp;
    const heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
    for (const hd of heads) {
      // the notes of a chord share their signs: only the outermost head looks
      const chord = heads.filter((q) => Math.abs(q.cx - hd.cx) < sp * 0.5);
      const hi = Math.min(...chord.map((q) => q.cy)), lo = Math.max(...chord.map((q) => q.cy));
      if (hd.cy !== hi && hd.cy !== lo) continue;
      for (const below of [false, true]) {
        if (below ? hd.cy !== lo : hd.cy !== hi) continue;
        const stemThere = hd.stem && hd.stem.up !== below;
        const edge = below ? Math.max(lo + sp * 0.35, stemThere ? hd.stem.bot : -Infinity) : Math.min(hi - sp * 0.35, stemThere ? hd.stem.top : Infinity);
        // near the note for staccato and accents; further out (above the staff) for trills and fermatas
        const yFar = below ? Math.max(edge + sp * 3.2, s.bottom + sp * 3.5) : Math.min(edge - sp * 3.2, s.top - sp * 3.5);
        for (const g of [...comps, ...fromBig]) {
          if (globalThis.__signDbg && g.w > sp * 1.2 && g.h < sp * 2 && g.y1 < hd.cy && Math.abs((g.x0 + g.x1) / 2 - hd.cx) < sp * 1.5) globalThis.__signDbg.push({ why: [Math.round(g.x0), Math.round(g.y0), g.w, g.h], taken: taken.has(g), wordish: wordish.has(g), head: [Math.round(hd.cx), Math.round(hd.cy)], below, edge: Math.round(edge), yFar: Math.round(yFar) });
          if (taken.has(g) || wordish.has(g)) continue;
          const gx = (g.x0 + g.x1) / 2, gw = g.w / sp, gh = g.h / sp;
          // (a mordent or a turn can be nearly three spaces wide)
          if (gw > 3.0 || gh > 2.4) continue;
          if (Math.abs(gx - hd.cx) > sp * (gw > 1 ? 1.1 : 0.7)) continue;
          // (an ornament over a beam may stand a little further off: only an ornament there)
          const yFar2 = below ? yFar + sp * 1.4 : yFar - sp * 1.4;
          if (below ? !(g.y0 >= edge - sp * 0.15 && g.y1 <= yFar2) : !(g.y1 <= edge + sp * 0.15 && g.y0 >= yFar2)) continue;
          const farOnly = below ? g.y1 > yFar : g.y0 < yFar;
          if (ctx.staves && Math.abs(((g.y0 + g.y1) / 2) - hd.cy) > sp * 4) { const o = staffOf((g.y0 + g.y1) / 2, gx); if (o && ctx.staves.indexOf(o) !== read.indexOf(s)) continue; }
          // not a head or the inside of the staff's own symbols
          if (s.heads.some((q) => q !== hd && Math.abs(q.cx - gx) < sp * 0.6 && Math.abs(q.cy - (g.y0 + g.y1) / 2) < sp * 0.6)) continue;
          let kind = null, lastD = 9;
          const round = Math.min(gw, gh) >= 0.15 && Math.max(gw, gh) >= 0.26 && gw <= 0.46 && gh <= 0.46 && gw / gh > 0.45 && gw / gh < 2.2 && (g.n === undefined || g.n >= g.w * g.h * 0.5);   // a staccato dot is small (a tuplet's 3 is not)   // (a dot on a staff line is cut in two by it)
          const near = below ? g.y0 - edge < sp * 1.3 : edge - g.y1 < sp * 1.3;
          if (round && near) kind = 'stacc';
          else if (gw >= 0.6) {
            // the sign alone, or with a piece just beside it (the t and the r of a trill)
            const SIGNS = ['acc', 'ten', 'marc', 'ferm', 'trill', 'mord', 'prall', 'turn', 'd3', 'up', 'down', 'breath'];
            let k = nearest(shapeOf(ctx.C, w, g.x0, g.y0, g.x1, g.y1, sp, ctx.labC, g.id), SIGNS);
            for (const q of ctx.compsC) {
              if (q === g || taken.has(q) || q.x0 > g.x1 + sp * 0.5 || q.x1 < g.x0 - sp * 0.5) continue;
              const oy = Math.min(q.y1, g.y1) - Math.max(q.y0, g.y0); if (oy < Math.min(q.h, g.h) * 0.4) continue;
              const u = { x0: Math.min(g.x0, q.x0), y0: Math.min(g.y0, q.y0), x1: Math.max(g.x1, q.x1), y1: Math.max(g.y1, q.y1) };
              if ((u.x1 - u.x0) / sp > 2.6) continue;
              const ids = [...(Array.isArray(g.id) ? g.id : [g.id]), ...(Array.isArray(q.id) ? q.id : [q.id])];
              const k2 = nearest(shapeOf(ctx.C, w, u.x0, u.y0, u.x1, u.y1, sp, ctx.labC, ids), SIGNS);
              if (k2.d < k.d) { k = k2; taken.add(q); }
            }
            // (a group of pieces, a bowing and a bit of a slur that touches it: each piece alone)
            if (k.d > 0.28 && Array.isArray(g.id) && g.id.length > 1) {
              for (const id of g.id) {
                const r = rawById.get(id); if (!r || r.w < sp * 0.6 || r.h > sp * 1.6) continue;
                const k3 = nearest(shapeOf(ctx.C, w, r.x0, r.y0, r.x1, r.y1, sp, ctx.labC, id), ['up', 'down']);
                if (k3.d < k.d && k3.d <= 0.28) k = k3;
              }
            }
              if (globalThis.__signDbg) globalThis.__signDbg.push({ x: Math.round(gx), y: Math.round((g.y0 + g.y1) / 2), gw: +gw.toFixed(2), gh: +gh.toFixed(2), cls: k.cls, d: +k.d.toFixed(3) });
              if (k.d < 0.36) kind = k.cls;
              lastD = k.d;
            // (a piece out of a bigger group: only an ornament, and only a close likeness)
            if (bigPiece.has(g) && !((['mord', 'prall', 'turn', 'trill'].includes(k.cls) && k.d < 0.26) || (k.cls === 'acc' && k.d < (globalThis.__accBig ?? 0.2)))) kind = null;
            // (bowings and breath marks look like parts of other signs: only a close likeness counts)
            if ((kind === 'up' || kind === 'down' || kind === 'breath') && k.d > 0.28) kind = null;
            if (kind === 'ten' && !(gh < 0.35 && gw > 0.8)) kind = null;
            if (kind === 'ten' && !near) kind = null;
          }
          if (kind && farOnly && (!['trill', 'mord', 'prall', 'turn', 'ferm'].includes(kind) || !(lastD < 0.2))) kind = null;
          if (!kind) continue;
          // a 3 is left for the tuplets (read below, with its bracket or beam)
          if (kind === 'd3') continue;
          // a dot that is part of an accent or a fermata already read is not a staccato
          if (kind === 'stacc' && (hd._signs || []).some((q) => g.x0 >= q.x0 - 2 && g.x1 <= q.x1 + 2 && g.y0 >= q.y0 - 2 && g.y1 <= q.y1 + 2)) continue;
          if (kind !== 'stacc' && kind !== 'd3') {
            (hd._signs = hd._signs || []).push(g);
            const i0 = hd.art.indexOf('stacc');
            if (i0 >= 0 && hd._stacc && g.x0 <= hd._stacc.x0 + 2 && g.x1 >= hd._stacc.x1 - 2 && g.y0 <= hd._stacc.y0 + 2 && g.y1 >= hd._stacc.y1 - 2) hd.art.splice(i0, 1);
          }
          if (kind === 'stacc') { hd._stacc = g; if (globalThis.__signDbg) globalThis.__signDbg.push({ stacc: [g.x0, g.y0, g.x1, g.y1], n: g.n, id: g.id, head: [Math.round(hd.cx), Math.round(hd.cy)] }); }
          taken.add(g);
          if (kind === 'd3') { hd.tup3 = true; continue; }
          if (!hd.art.includes(kind)) hd.art.push(kind);
        }
      }
    }
  }
  // ---- staccato dots looked for directly: a small round blob where the dot goes (on the side away
  // from the stem, a space or so from the head), whatever it touches on the way
  {
    const CB = ctx.Cb || ctx.C;
    for (const s of read) {
      const sp = s.sp;
      const heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
      for (const hd of heads) {
        if (hd.art.some((a) => ['stacc', 'ten', 'acc', 'marc', 'ferm', 'stacciss'].includes(a))) continue;
        const chord = heads.filter((q) => Math.abs(q.cx - hd.cx) < sp * 0.5);
        const hi = Math.min(...chord.map((q) => q.cy)), lo = Math.max(...chord.map((q) => q.cy));
        // the dot is on the side away from the stem; without a stem, above
        const below = hd.stem ? hd.stem.up : false;
        if (below ? hd.cy !== lo : hd.cy !== hi) continue;
        const x0 = Math.round(hd.cx - sp * 0.55), x1 = Math.round(hd.cx + sp * 0.55);
        const yA = Math.round(below ? hd.cy + sp * 0.62 : hd.cy - sp * 2.1), yB = Math.round(below ? hd.cy + sp * 2.1 : hd.cy - sp * 0.62);
        if (yA < 1 || yB >= h - 1 || x0 < 1 || x1 >= w - 1) continue;
        const seen = new Set();
        let found = null;
        for (let y = yA; y <= yB && !found; y++) for (let x = x0; x <= x1 && !found; x++) {
          const k = y * w + x; if (!CB[k] || seen.has(k)) continue;
          // the blob, kept within a box a little bigger than a dot
          const q = [k], loc = new Set([k]); let bx0 = x, bx1 = x, by0 = y, by1 = y, n = 0, big = false;
          while (q.length) {
            const kk = q.pop(), xx = kk % w, yy = (kk - xx) / w; n++;
            if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (yy < by0) by0 = yy; if (yy > by1) by1 = yy;
            if (bx1 - bx0 > sp * 0.6 || by1 - by0 > sp * 0.6 || n > sp * sp) { big = true; break; }
            for (const d of [-1, 1, -w, w]) { const k2 = kk + d; if (!loc.has(k2) && CB[k2]) { loc.add(k2); q.push(k2); } }
          }
          for (const p of loc) seen.add(p);
          if (big) continue;
          const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
          if (bw < sp * 0.18 || bh < sp * 0.18 || bw / bh > 1.8 || bh / bw > 1.8 || n < bw * bh * 0.55) { if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], bx: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1], n, why: 'shape' }); continue; }
          // not the dot of a dotted note (that sits beside a head, right of it, in a space)
          if (heads.some((q2) => q2 !== hd && Math.abs((by0 + by1) / 2 - q2.cy) < sp * 0.45 && bx0 > q2.cx + sp * 0.5 && bx0 < q2.cx + sp * 1.6)) continue;
          if (Math.abs((bx0 + bx1) / 2 - hd.cx) > sp * 0.42) { if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], bx: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1], n, why: 'off' }); continue; }
          // a dot stands alone: nothing else close around it (a piece of an accent, a fermata or a
          // digit has the rest of its sign right beside it)
          const m = Math.max(2, Math.round(sp * 0.2)); let near = 0;
          for (let yy = by0 - m; yy <= by1 + m; yy++) for (let xx = bx0 - m; xx <= bx1 + m; xx++) {
            if (yy >= by0 && yy <= by1 && xx >= bx0 && xx <= bx1) continue;
            if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
            if (CB[yy * w + xx] && !loc.has(yy * w + xx)) near++;
          }
          if (near > 2) { if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], bx: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1], n, why: 'near' + near }); continue; }
          // and is not a piece of a bigger sign (a digit, a letter) the reader put together
          let partOf = false;
          for (let yy = by0; yy <= by1 && !partOf; yy++) for (let xx = bx0; xx <= bx1; xx++) {
            const id = ctx.labC[yy * w + xx]; if (id < 0) continue;
            const gq = ctx.compsC[ctx.groupOf[id]]; if (gq && (gq.w > sp * 0.62 || gq.h > sp * 0.62) && !(gq.x0 >= bx0 - 1 && gq.x1 <= bx1 + 1 && gq.y0 >= by0 - 1 && gq.y1 <= by1 + 1) && !(gq.x0 <= hd.cx && gq.x1 >= hd.cx && gq.y0 <= hd.cy && gq.y1 >= hd.cy)) { partOf = [gq.x0, gq.y0, gq.w, gq.h, Array.isArray(gq.id) ? gq.id.length : 1]; break; }
          }
          if (partOf) { if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], bx: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1], n, why: 'partOf', g: partOf }); continue; }
          // the dot of a fermata has its arc over it (under it, below the note), on both sides
          {
            const ya = below ? by1 + Math.round(sp * 0.15) : by0 - Math.round(sp * 1.0), yb = below ? by1 + Math.round(sp * 1.0) : by0 - Math.round(sp * 0.15);
            let L = false, R = false;
            for (let yy = Math.max(0, ya); yy <= Math.min(h - 1, yb); yy++) {
              for (let xx = Math.max(0, Math.round(bx0 - sp * 1.1)); xx < bx0 - sp * 0.25; xx++) if (CB[yy * w + xx]) { L = true; break; }
              for (let xx = Math.round(bx1 + sp * 0.25); xx <= Math.min(w - 1, bx1 + sp * 1.1); xx++) if (CB[yy * w + xx]) { R = true; break; }
            }
            // a slur passing over a staccato dot runs on much further; a fermata's arc ends close by
            let far = false;
            for (let yy = Math.max(0, ya - Math.round(sp * 0.4)); yy <= Math.min(h - 1, yb + Math.round(sp * 0.4)) && !far; yy++) {
              for (const xx of [Math.round(bx0 - sp * 1.75), Math.round(bx1 + sp * 1.75)]) if (xx > 0 && xx < w && (CB[yy * w + xx] || CB[yy * w + xx - 1] || CB[yy * w + xx + 1])) { far = true; break; }
            }
            // (only away from the staff, where its lines cannot pass for an arc)
            if (L && R && !far && (below ? by0 > s.bottom + sp * 0.2 : by1 < s.top - sp * 0.2)) {
              if (!hd.art.includes('ferm')) hd.art.push('ferm');
              found = 'ferm'; break;
            }
          }
          found = { bx0, by0, bx1, by1, n, near };
        }
        if (found && found !== 'ferm') hd.art.push('stacc');
        if (found && globalThis.__signDbg) globalThis.__signDbg.push({ probeStacc: found, head: [Math.round(hd.cx), Math.round(hd.cy)] });
      }
    }
    // accents and tenuto lines looked for the same way: a wedge open to the left ( > ), or a short
    // flat line, centred over (or under) the head
    for (const s of read) {
      const sp = s.sp;
      const heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
      for (const hd of heads) {
        if (hd.art.some((a) => ['ten', 'acc', 'marc', 'ferm'].includes(a))) continue;
        const chord = heads.filter((q) => Math.abs(q.cx - hd.cx) < sp * 0.5);
        const hi = Math.min(...chord.map((q) => q.cy)), lo = Math.max(...chord.map((q) => q.cy));
        const below = hd.stem ? hd.stem.up : false;
        if (below ? hd.cy !== lo : hd.cy !== hi) continue;
        const x0 = Math.round(hd.cx - sp * 0.5), x1 = Math.round(hd.cx + sp * 0.5);
        const yA = Math.round(below ? hd.cy + sp * 0.55 : hd.cy - sp * 2.6), yB = Math.round(below ? hd.cy + sp * 2.6 : hd.cy - sp * 0.55);
        if (yA < 1 || yB >= h - 1 || x0 < 2 || x1 >= w - 2) continue;
        const seen = new Set();
        let kind = null;
        for (let y = yA; y <= yB && !kind; y++) for (let x = x0; x <= x1 && !kind; x++) {
          const k = y * w + x; if (!CB[k] || seen.has(k)) continue;
          const q = [k], loc = new Set([k]); const px = []; let bx0 = x, bx1 = x, by0 = y, by1 = y, big = false;
          while (q.length) {
            const kk = q.pop(), xx = kk % w, yy = (kk - xx) / w; px.push(kk);
            if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (yy < by0) by0 = yy; if (yy > by1) by1 = yy;
            if (bx1 - bx0 > sp * 1.5 || by1 - by0 > sp * 0.95 || px.length > sp * sp * 1.2) { big = true; break; }
            for (const d of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]) { const k2 = kk + d; if (!loc.has(k2) && CB[k2]) { loc.add(k2); q.push(k2); } }
          }
          for (const p of loc) seen.add(p);
          if (big) continue;
          const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
          if (bw < sp * 0.7 || Math.abs((bx0 + bx1) / 2 - hd.cx) > sp * 0.45) continue;
          // nothing else touching close around it (a letter, a hairpin, a slur)
          const m = Math.max(2, Math.round(sp * 0.18)); let near = 0;
          for (let yy = by0 - m; yy <= by1 + m; yy++) for (let xx = bx0 - m; xx <= bx1 + m; xx++) {
            if (yy >= by0 && yy <= by1 && xx >= bx0 && xx <= bx1) continue;
            if (CB[yy * w + xx] && !loc.has(yy * w + xx)) near++;
          }
          if (near > 3) { if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], nearRej: near, bw: +(bw / sp).toFixed(2), bh: +(bh / sp).toFixed(2) }); continue; }
          const fill = px.length / (bw * bh);
          if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], bw: +(bw / sp).toFixed(2), bh: +(bh / sp).toFixed(2), fill: +fill.toFixed(2), near });
          // (a tenuto sits in the space next to the head: further off, a flat bit is the bottom of a slur)
          if (bh <= sp * 0.3 && bw <= sp * 1.45 && fill > 0.6 && Math.abs((by0 + by1) / 2 - hd.cy) < sp * 1.5) { kind = 'ten'; break; }
          if (bh < sp * 0.38 || bh > sp * 1.12 || bw / bh < 1.15 || fill > 0.5) continue;
          // a wedge: tall at the left, closing to a point at the right, edges running straight
          const cols = []; for (let i = 0; i < bw; i++) cols.push([1e9, -1]);
          for (const kk of px) { const xx = kk % w - bx0, yy = (kk - kk % w) / w; if (yy < cols[xx][0]) cols[xx][0] = yy; if (yy > cols[xx][1]) cols[xx][1] = yy; }
          const ext = (i) => cols[i][1] - cols[i][0];
          const L = Math.max(ext(0), ext(1), ext(2)), R = Math.max(ext(bw - 1), ext(bw - 2), ext(bw - 3));
          const mid = cols[Math.round(bw / 2)], midC = (mid[0] + mid[1]) / 2, cy0 = (by0 + by1) / 2;
          // the middle column has ink at top and bottom with a gap between (two arms), not one stroke
          let gap = false; { const xm = bx0 + Math.round(bw / 2); let run = 0, best = 0; for (let yy = mid[0]; yy <= mid[1]; yy++) { if (CB[yy * w + xm]) run = 0; else { run++; best = Math.max(best, run); } } gap = best >= bh * 0.18; }
          if (globalThis.__accProbe) globalThis.__accProbe.push({ hd: [Math.round(hd.cx), Math.round(hd.cy)], L: +(L / bh).toFixed(2), R: +(R / bh).toFixed(2), gap, mid: +((midC - cy0) / bh).toFixed(2) });
          if (L >= bh * 0.65 && R <= bh * 0.42 && gap && Math.abs(midC - cy0) < bh * 0.22) kind = 'acc';
        }
        if (kind) hd.art.push(kind);
        // not found in the picture without lines: an accent across a staff line (inside the staff)
        // loses pieces there. Looked for again in the page as printed, as the wedge it is, the
        // staff lines left out of the comparison
        if (!kind && (globalThis.__accWedge ?? 1) && ctx.B && ctx.C0) { const a2 = wedgeAt(ctx, hd, below, sp, w, h); if (a2) hd.art.push('acc'); }
      }
    }
  }
  // ---- a fermata over a note whose stem goes up: its dot and arc sit above the end of the stem
  {
    const CB = ctx.Cb || ctx.C;
    for (const s of read) {
      const sp = s.sp;
      for (const hd of s.heads) {
        if (hd.art.includes('ferm')) continue;
        if (s.heads.some((q) => q !== hd && Math.abs(q.cx - hd.cx) < sp * 0.5 && q.cy < hd.cy)) continue;
        // (over the stem's end with the stem up; over the head, or the staff, with it down)
        const top = Math.min(hd.stem && hd.stem.up ? hd.stem.top : hd.cy - sp * 0.6, s.top);
        const xa = Math.round(hd.cx - sp * 0.9), xb = Math.round(hd.cx + sp * 0.9), ya = Math.round(top - sp * 3.6), yb = Math.round(top - sp * 0.15);
        if (ya < 1 || xa < 1 || xb >= w - 1) continue;
        let found = false;
        for (const g of ctx.rawC) {
          if (found || g.x0 < xa || g.x1 > xb || g.y0 < ya || g.y1 > yb) continue;
          if (g.w < sp * 0.18 || g.h < sp * 0.18 || g.w > sp * 0.6 || g.h > sp * 0.6 || g.w / g.h > 1.8 || g.h / g.w > 1.8) continue;
          // the arc: a curve just over the dot, reaching down on both sides of it
          const arc = ctx.rawC.find((q) => q !== g && q.y0 < g.y0 - sp * 0.3 && q.y1 < g.y1 + sp * 0.5 && q.y1 > g.y0 - sp * 0.9 && q.x0 < g.x0 - sp * 0.4 && q.x1 > g.x1 + sp * 0.4 && q.w < sp * 3 && q.h < sp * 1.6 && q.h > sp * 0.4);
          if (!arc) {
            // (the arc run into something, a slur that starts at it: its ink looked for directly over the dot)
            if (!(globalThis.__fermPix ?? 1)) continue;
            const ink = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < ctx.h && CB[y * w + x]; };
            const dcx = (g.x0 + g.x1) / 2, dcy = (g.y0 + g.y1) / 2;
            const colInk = (x, ya, yb) => { for (let y = ya; y <= yb; y++) if (ink(x, y)) return y; return -1; };
            // the top of the arc over the dot, then its two sides coming down beside it
            const apex = colInk(dcx, dcy - sp * 1.5, dcy - sp * 0.45);
            if (apex < 0) continue;
            // each side: ink lower than the top, a thin stroke (not a stem or a head)
            const vlen = (x, y) => { let a = y, c = y; while (ink(x, a - 1) && y - a < sp) a--; while (ink(x, c + 1) && c - y < sp) c++; return c - a + 1; };
            let lft = false, rgt = false;
            for (let dx = sp * 0.6; dx <= sp * 1.05 && !(lft && rgt); dx += 1) {
              for (const side of [-1, 1]) {
                if (side < 0 ? lft : rgt) continue;
                const x = dcx + side * dx, y = colInk(x, dcy - sp * 0.45, dcy + sp * 0.35);
                if (y >= 0 && y > apex + sp * 0.3 && vlen(Math.round(x), y) <= sp * 0.6) { if (side < 0) lft = true; else rgt = true; }
              }
            }
            if (!(lft && rgt) || apex > g.y0 - 2) continue;
            // (a slur running on over the dot to both sides is no fermata)
            let fl = false, fr = false;
            for (let y = Math.round(apex - sp * 0.3); y <= Math.round(dcy + sp * 0.4); y++) { if (ink(dcx - sp * 1.8, y)) fl = true; if (ink(dcx + sp * 1.8, y)) fr = true; }
            if (fl && fr) continue;
            hd.art.push('ferm'); taken.add(g); found = true; continue;
          }
          // its two ends reach down near the dot's height
          const endsLow = (x) => { for (let y = arc.y1; y >= arc.y0; y--) if (CB[y * w + x] && ctx.labC[y * w + x] >= 0) return y; return -1; };
          const l = endsLow(arc.x0 + 1), r = endsLow(arc.x1 - 1);
          if (l < 0 || r < 0 || l < g.y0 - sp * 0.5 || r < g.y0 - sp * 0.5) continue;
          hd.art.push('ferm'); taken.add(arc); taken.add(g); found = true;
        }
      }
    }
  }
  // ---- tuplets: a number (3, 5, 6, 7…) over or under a group of notes, with a bracket or a beam
  // showing which notes. The notes it covers are marked with the number and the group; whether it
  // is believed is decided when the bar's rhythm is put together.
  {
    let tg = 0;
    const tupNums = [];
    for (const s of read) {
      const sp = s.sp;
      // (a number close to the beam may have been put together with it: its own piece too)
      const own = ctx.rawC.filter((g) => !comps.includes(g) && g.h >= sp * 0.6 && g.h <= sp * 2.3 && g.w >= sp * 0.25 && g.w <= sp * 1.6);
      // (or the number run into its bracket, all one shape: the tall part in the middle of a long
      // flat shape is the number, the rest the bracket)
      const inBracket = [];
      for (const c of ctx.compsC) {
        if (taken.has(c) || c.w < sp * 2.2 || c.w > sp * 14 || c.h < sp * 0.6 || c.h > sp * 2.4) continue;
        const cy = (c.y0 + c.y1) / 2; if (cy > s.top - sp * 0.3 && cy < s.bottom + sp * 0.3) continue;
        const ids = Array.isArray(c.id) ? c.id : [c.id];
        const ext = []; for (let x = c.x0; x <= c.x1; x++) { let a = -1, z = -1; for (let y = c.y0; y <= c.y1; y++) if (ctx.C[y * w + x] && ids.includes(ctx.labC[y * w + x])) { if (a < 0) a = y; z = y; } ext.push(a < 0 ? 0 : z - a + 1); }
        const runs = []; let r0 = -1;
        for (let i = 0; i <= ext.length; i++) { const tall = i < ext.length && ext[i] > sp * 0.55; if (tall && r0 < 0) r0 = i; if (!tall && r0 >= 0) { runs.push([r0, i - 1]); r0 = -1; } }
        const mid = (c.x1 - c.x0) / 2;
        const cand = runs.filter(([a, z]) => z - a + 1 >= sp * 0.4 && z - a + 1 <= sp * 1.4 && a > sp * 0.6 && z < ext.length - sp * 0.6).sort((p2, q2) => Math.abs((p2[0] + p2[1]) / 2 - mid) - Math.abs((q2[0] + q2[1]) / 2 - mid))[0];
        if (!cand) continue;
        const x0 = c.x0 + cand[0], x1 = c.x0 + cand[1];
        let y0 = Infinity, y1 = -1; for (let y = c.y0; y <= c.y1; y++) for (let x = x0; x <= x1; x++) if (ctx.C[y * w + x] && ids.includes(ctx.labC[y * w + x])) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (y1 - y0 < sp * 0.6) continue;
        inBracket.push({ id: c.id, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n: 0, bracketOf: c });
      }
      for (const g of [...comps, ...own, ...inBracket]) {
        if (taken.has(g) || wordish.has(g) || g.w > sp * 1.6 || g.h > sp * 2.3 || g.h < sp * 0.6 || g.w < sp * 0.25) continue;
        const gx = (g.x0 + g.x1) / 2, gy = (g.y0 + g.y1) / 2;
        if (gy > s.top - sp * 0.3 && gy < s.bottom + sp * 0.3) continue;
        const above = gy < s.top;
        if (Math.abs(gy - (above ? s.top : s.bottom)) > sp * 7.5) continue;
        if (ctx.staffOf && ctx.staffOf(gy, gx) !== ctx.staves[read.indexOf(s)]) continue;
        const sh = shapeOf(ctx.C, w, g.x0, g.y0, g.x1, g.y1, sp, ctx.labC, g.id);
        const exact = nearest(sh, ['d3', 'd5', 'd6', 'd7', 'trill', 'acc', 'F1', 'F2', 'F4']);
        const loose = classifyLoose(sh, ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd1', 'd0']);
        // the holes in the shape tell digits apart that look alike loosely (3 has none, 8 two, 6 one…)
        const holes = holesIn(ctx.C, w, ctx.h, g);
        const HOLES = { d0: 1, d1: 0, d2: 0, d3: 0, d4: [0, 1], d5: 0, d6: 1, d7: 0, d8: 2, d9: 1 };
        const fits = (cls) => { const hh = HOLES[cls]; return Array.isArray(hh) ? hh.includes(holes) : hh === holes; };
        const lz = loose.filter((q) => fits(q.cls));
        let n = 0;
        if (exact.cls && /^d[3567]$/.test(exact.cls) && exact.d < 0.3 && (fits(exact.cls) || exact.d < 0.22)) n = +exact.cls.slice(1);
        // (unless the close look says it is another digit, a fingering: a 2 is no 3)
        else if (lz[0] && /^d[3567]$/.test(lz[0].cls) && lz[0].d < 0.2 && (!lz[1] || lz[1].d - lz[0].d > 0.008) && !(exact.cls && exact.cls[0] === 'F' && exact.d < 0.3 && exact.cls.slice(1) !== lz[0].cls.slice(1))) n = +lz[0].cls.slice(1);
        // (a handwritten 3 whose ends curl into a closed loop reads as a 9 by its holes: it still counts
        // when it is one of the two nearest and the notes under it are just that many)
        let weak = false;
        if (!n && (globalThis.__weakTup ?? 1) && !(exact.cls && exact.cls[0] === 'F' && exact.d < 0.3)) { const t2 = loose.slice(0, 2).map((q) => q.cls), c2 = loose.slice(0, 2).find((q) => q.cls === 'd3' && q.d < 0.24); if (c2 && (t2[0] === 'd3' || t2[0] === 'd9')) { n = 3; weak = true; } }
        if (globalThis.__tupDbg) globalThis.__tupDbg.push({ cand: [Math.round(gx), Math.round(gy)], n, weak, e: [exact.cls, +exact.d.toFixed(3)], l: loose.slice(0, 2).map((q) => [q.cls, +q.d.toFixed(3)]) });
        if (!n) continue;
        // a bracket: thin straight strokes level with the number, either side of it
        // (a thin line: in each column only a little ink, at about the same height all along)
        const row = (y, x, dir) => {
          let run = 0, gap = 0, lastY = null, bad = 0, pre = 0;
          for (let k = 0; k < sp * 12; k++) {
            const x2 = x + dir * k; if (x2 < 0 || x2 >= w) break;
            let n = 0, ys = 0;
            for (let dy = -Math.round(sp * 0.6); dy <= Math.round(sp * 0.6); dy++) { const yy = Math.round(y) + dy; if (yy >= 0 && yy < ctx.h && ctx.C[yy * w + x2]) { n++; ys += yy; } }
            if (n) {
              const yc = ys / n;
              if (n > sp * 0.35 || (lastY !== null && Math.abs(yc - lastY) > sp * 0.15)) { if (run > sp * 0.8) break; if (++bad > Math.max(3, sp * 0.5)) return null; run = 0; lastY = null; continue; }
              lastY = yc; run++; gap = 0;
            } else if (run > 0 && ++gap > sp * 0.3) break; else if (run === 0 && k > sp * 1.4) break;
          }
          return run > sp * 0.8 ? x + dir * (run + gap) : null;
        };
        const bl = row(gy, g.x0 - 2, -1), br = row(gy, g.x1 + 2, 1);
        if (globalThis.__tupDbg) globalThis.__tupDbg.push({ brk: [Math.round(gx), Math.round(gy)], bl, br });
        let span = null;
        if (g.bracketOf) span = [g.bracketOf.x0 - sp * 0.3, g.bracketOf.x1 + sp * 0.3];
        else if (bl !== null && br !== null) span = [bl - sp * 0.5, br + sp * 0.5];
        // (one side only, the other broken by a staff line or a stem: as far again the other way)
        else if (bl !== null && gx - bl > sp * 2) span = [bl - sp * 0.5, gx + (gx - bl) + sp * 0.5];
        else if (br !== null && br - gx > sp * 2) span = [gx - (br - gx) - sp * 0.5, br + sp * 0.5];
        const heads = s.heads.slice().sort((p, q) => p.cx - q.cx);
        let group = [];
        // a beam group the number is centred on comes first (a beam near the number can look like
        // a bracket); a bracket otherwise
        {
          const byBg = new Map();
          for (const q of heads) if (q.bg !== undefined && q.bg !== null) { if (!byBg.has(q.bg)) byBg.set(q.bg, []); byBg.get(q.bg).push(q); }
          let best = null;
          for (const list of byBg.values()) {
            const x0 = Math.min(...list.map((q) => q.cx)), x1 = Math.max(...list.map((q) => q.cx));
            if (gx < x0 - sp * 0.5 || gx > x1 + sp * 0.5) continue;
            const d = Math.abs(gx - (x0 + x1) / 2);
            if (d > (x1 - x0) * 0.35 + sp * 0.6) continue;
            if (!best || d < best.d) best = { list, d };
          }
          // (a bracket over part of a beam is believed over the beam)
          const nEv = (list) => { let k = 0, lx = -1e9; for (const q of list.slice().sort((a, b) => a.cx - b.cx)) { if (q.cx - lx > sp * 0.5) k++; lx = q.cx; } return k; };
          if (best && (!span || nEv(best.list) === n)) { group = best.list; span = null; }
        }
        if (!group.length && span) group = heads.filter((q) => q.cx >= span[0] && q.cx <= span[1]);
        else if (!group.length) {
          // the beam group the number is centred on
          const byBg = new Map();
          for (const q of heads) if (q.bg !== undefined && q.bg !== null) { if (!byBg.has(q.bg)) byBg.set(q.bg, []); byBg.get(q.bg).push(q); }
          let best = null;
          for (const list of byBg.values()) {
            const x0 = Math.min(...list.map((q) => q.cx)), x1 = Math.max(...list.map((q) => q.cx));
            if (gx < x0 - sp * 0.8 || gx > x1 + sp * 0.8) continue;
            const d = Math.abs(gx - (x0 + x1) / 2);
            if (!best || d < best.d) best = { list, d };
          }
          if (best) group = best.list;
        }
        // the notes as events (a chord counts once)
        const evs = []; for (const q of group) { const l = evs[evs.length - 1]; if (l && Math.abs(l[0].cx - q.cx) < sp * 0.5) l.push(q); else evs.push([q]); }
        // (a number that looks a little like another: the one the notes under it count, when close)
        if (evs.length !== n && evs.length >= 3 && evs.length <= 7) { const alt = lz.find((q) => q.cls === 'd' + evs.length); if (alt && lz[0] && alt.d < lz[0].d + 0.03) n = evs.length; }
        if (evs.length < 2 || evs.length > n * 3) continue;
        // (a number by a beam over a group that is not a multiple of it, a 3 over four sixteenths:
        // a fingering, not a tuplet)
        if (!span && (globalThis.__tupMult ?? 1) && n === 3 && (evs.length === 4 || evs.length === 8)) continue;
        // (and fewer notes under it than the number, with no bracket: a fingering, or the 96 of a tempo)
        if (!span && (globalThis.__tupFew ?? 1) && evs.length < n) continue;
        if (weak && evs.length !== n) continue;
        // (a piece taken out of a bigger shape: only as the number of a group of just that many notes)
        if (own.includes(g) && (evs.length !== n || !((exact.cls === 'd' + n && exact.d < 0.3) || (lz[0] && lz[0].cls === 'd' + n && lz[0].d < 0.12)))) continue;
        // without a bracket the number is printed by the beam, at the ends of the stems: on the side
        // of the heads it is a fingering
        if (!span) {
          const st = group.filter((q) => q.stem);
          const up = st.filter((q) => q.stem.up).length;
          if (st.length && ((up * 2 < st.length && above) || (up * 2 > st.length && !above))) continue;
        }
        // one number to a group: of two (a fingering over the beam), the one nearer the beam
        {
          const st = group.filter((q) => q.stem), endY = st.length ? (above ? Math.min(...st.map((q) => q.stem.top)) : Math.max(...st.map((q) => q.stem.bot))) : gy;
          const dist = Math.abs(gy - endY);
          const prev = tupNums.find((t) => t.list.some((q) => group.includes(q)));
          if (prev) {
            if (prev.dist <= dist || span) continue;
            taken.delete(prev.g); for (const q of prev.list) { delete q.tup3; delete q.tupN; delete q.tupG; }
            tupNums.splice(tupNums.indexOf(prev), 1);
          }
          tupNums.push({ g, dist, list: group.slice() });
        }
        taken.add(g); if (g.bracketOf) taken.add(g.bracketOf); tg++;
        // the bracket's strokes are not hairpins or anything else
        if (span) for (const c of comps) if (!taken.has(c) && c.x0 >= span[0] - sp && c.x1 <= span[1] + sp && Math.abs((c.y0 + c.y1) / 2 - gy) < sp * 0.9 && c.h < sp * 1.6) taken.add(c);
        // (a bracket not followed all the way, beside its number: its straight pieces too, which are
        // no hairpin)
        const gx0 = Math.min(...group.map((q) => q.cx)) - sp, gx1 = Math.max(...group.map((q) => q.cx)) + sp;
        for (const c of [...comps, ...ctx.compsC]) if (!taken.has(c) && c !== g && c.w > sp * 0.8 && c.h < sp * 1.2 && c.x0 >= gx0 - sp && c.x1 <= gx1 + sp && Math.abs((c.y0 + c.y1) / 2 - gy) < sp * 0.7 && (c.x1 < g.x0 + 2 || c.x0 > g.x1 - 2)) taken.add(c);
        for (const list of evs) for (const q of list) { q.tup3 = n === 3; q.tupN = n; q.tupG = tg; }
        if (globalThis.__tupDbg) globalThis.__tupDbg.push({ n, at: [Math.round(gx), Math.round(gy)], bracket: !!span, notes: evs.length });
      }
    }
  }
  // a picture of what was seen, for checking the reader (only when asked for)
  if (globalThis.__markImg !== undefined) {
    try {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g2 = cv.getContext('2d');
      const im = g2.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = ctx.C[i] ? 0 : ctx.B[i] ? 170 : 255; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } g2.putImageData(im, 0, 0);
      g2.lineWidth = 1;
      for (const c of comps) { g2.strokeStyle = taken.has(c) ? 'red' : 'orange'; g2.strokeRect(c.x0 - 1, c.y0 - 1, c.w + 2, c.h + 2); }
      for (const s of read) for (const hd of s.heads) { g2.strokeStyle = 'lime'; g2.strokeRect(hd.cx - s.sp * 0.6, hd.cy - s.sp * 0.5, s.sp * 1.2, s.sp); if (hd.art.length) { g2.fillStyle = 'blue'; g2.font = '12px sans-serif'; g2.fillText(hd.art.join(','), hd.cx - 10, hd.cy + s.sp * 1.8); } }
      globalThis.__markImg = cv.toDataURL('image/png');
    } catch {}
  }
  // ---- octave lines: an 8 above the staff (below for an octave lower) with a dashed line after it
  // to where the notes go back (often a short hook at its end)
  const ottavas = read.map(() => []);
  if (globalThis.__ottava ?? 1) {
    try { readOttavas(read, ctx, ottavas); } catch (err) { console.warn('ottava', err); }
  }
  // ---- dynamics (p, mf, sfz…), fingering (small digits by the notes) and hairpins
  const hairpins = read.map(() => []);
  try { readWords(read, ctx, comps, taken, hairpins); } catch (err) { console.warn('words', err); }
  if (globalThis.__marksDbg !== undefined) globalThis.__marksDbg = { near: ctx.rawC.filter((c) => c.w < 20 && c.h < 20).map((c) => [c.x0, c.y0, c.x1, c.y1]), pieces: pieces.length, joined: joined.map((c) => ({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, w: c.x1 - c.x0 })), curves, slurs, heads: all.map((a) => ({ id: a.hd.id, cx: Math.round(a.hd.cx), cy: Math.round(a.hd.cy), p: a.hd.p, tieTo: a.hd.tieTo, art: a.hd.art, stem: a.hd.stem && { up: a.hd.stem.up, top: Math.round(a.hd.stem.top), bot: Math.round(a.hd.stem.bot) } })), sp: sp0 };
  void staffIdx; void h;
  return { slurs, hairpins, ottavas, texts: ctx.texts || read.map(() => []) };
}

// Letters and digits around the notes. Each small shape is compared with the dynamics letters
// and the fingering digits of several fonts; letters side by side make a word (only real
// dynamics count), digits stand alone by a note (or one over the other, for a chord).
const DYN_WORDS = new Set(['p', 'pp', 'ppp', 'mp', 'mf', 'f', 'ff', 'fff', 'sf', 'sfz', 'sffz', 'fz', 'fp', 'rf', 'rfz', 'sfp', 'pf']);
function readWords(read, ctx, comps, taken, hairpins) {
  const { w } = ctx;
  // which staff a shape belongs to. In the gap between two staves a dynamic or a hairpin is below
  // the staff above it (that is where they are written), unless it sits close over the staff below
  // or over one of its high notes (a fingering, a word for that staff)
  const ownerOf = (g) => {
    const gx = (g.x0 + g.x1) / 2, gy = (g.y0 + g.y1) / 2, n = ctx.staffOf(gy, gx);
    if (!(globalThis.__gapAbove ?? 1) || !ctx.staves) return n;
    const ni = ctx.staves.indexOf(n), rn = read[ni], ra = read[ni - 1];
    if (!rn || !ra) return n;
    const spn = rn.sp;
    if (g.y1 >= rn.top - spn * 0.2 || g.y0 <= ra.bottom) return n;
    if (rn.top - g.y1 < spn * 2.6 || gy - ra.bottom > spn * 9) return n;
    if (rn.heads.some((hd) => hd.cy < rn.top && Math.abs(hd.cx - gx) < spn * 1.5 && hd.cy - g.y1 < spn * 3)) return n;
    return ctx.staves[ni - 1];
  };
  for (const s of read) {
    const sp = s.sp, si = read.indexOf(s);
    const heads = s.heads.slice().sort((a, b) => a.cx - b.cx);
    if (!heads.length) continue;
    const startX = s.startX !== undefined ? s.startX : s.x0;
    // the shapes that belong to this staff, outside the staff (or just inside its edge)
    // (and the pieces of a big shape that are digit-sized: a fingering touching a beam or a stem)
    const bigParts = ctx.rawC.filter((g) => {
      if (g.h < sp * 0.6 || g.h > sp * 1.8 || g.w < sp * 0.25 || g.w > sp * 1.4 || ctx.groupOf === undefined) return false;
      const grp = ctx.compsC[ctx.groupOf[g.id]];
      return grp && grp !== g && (grp.w > sp * 2.2 || grp.h > sp * 2.6);
    });
    // (and a digit run into the end of a slur: one shape with the thin curve, its thick strokes stand
    // out of it)
    const thinById = ctx.thinComps ? new Map(ctx.thinComps.map((c) => [c.id, c])) : null;
    if ((globalThis.__digitOffSlur ?? 1) && ctx.D) for (const g of ctx.rawC) {
      if (g.w < sp * 2.2 || g.h > sp * 6 || g.h < sp * 0.6) continue;
      if (g.y1 > s.top + sp * 0.5 && g.y0 < s.bottom - sp * 0.5) continue;
      // (a shape far above or below this staff gives it nothing: what it holds is left out below)
      if (g.y1 < s.top - sp * 7.5 || g.y0 > s.bottom + sp * 7.5) continue;
      const seen = new Set(), bits = [];
      for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) {
        const k0 = y * w + x; if (seen.has(k0) || !ctx.D[k0] || ctx.labC[k0] !== g.id) continue;
        const q = [k0]; seen.add(k0); let x0 = x, x1 = x, y0 = y, y1 = y;
        while (q.length) {
          const k = q.pop(), xx = k % w, yy = (k - xx) / w;
          if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
          for (const d of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]) { const k2 = k + d; if (!seen.has(k2) && ctx.D[k2] && ctx.labC[k2] === g.id) { seen.add(k2); q.push(k2); } }
        }
        if (x1 - x0 + 1 > sp * 1.4 || y1 - y0 + 1 > sp * 1.8) continue;
        bits.push({ x0, x1, y0, y1 });
      }
      // (the thick strokes of one digit, apart where its thin strokes were taken away: together)
      const gap = sp * 0.3;
      for (let changed = true; changed;) {
        changed = false;
        for (let a = 0; a < bits.length && !changed; a++) for (let b = a + 1; b < bits.length; b++) {
          const A = bits[a], Bq = bits[b];
          if (A.x0 > Bq.x1 + gap || Bq.x0 > A.x1 + gap || A.y0 > Bq.y1 + gap || Bq.y0 > A.y1 + gap) continue;
          const u = { x0: Math.min(A.x0, Bq.x0), x1: Math.max(A.x1, Bq.x1), y0: Math.min(A.y0, Bq.y0), y1: Math.max(A.y1, Bq.y1) };
          if (u.x1 - u.x0 + 1 > sp * 1.2 || u.y1 - u.y0 + 1 > sp * 1.6) continue;
          bits[a] = u; bits.splice(b, 1); changed = true; break;
        }
      }
      for (const { x0, x1, y0, y1 } of bits) {
        const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
        if (ph < sp * 0.6 || ph > sp * 1.6 || pw < sp * 0.15 || pw > sp * 1.2) continue;
        // (the whole of the slur's thick middle is no digit: a digit is a small part of the shape)
        if (pw > g.w * 0.5) continue;
        const m = Math.max(1, Math.round(sp * 0.12));
        const bx0 = Math.max(g.x0, x0 - m), bx1 = Math.min(g.x1, x1 + m), by0 = Math.max(g.y0, y0 - m), by1 = Math.min(g.y1, y1 + m);
        // its ink: the thick strokes, and the thin ones that stay by it (not the long curve running off)
        const bits = {}; let nn = 0;
        for (let yy = by0; yy <= by1; yy++) for (let xx = bx0; xx <= bx1; xx++) {
          const k = yy * w + xx; if (ctx.labC[k] !== g.id) continue;
          let keep = !!ctx.D[k];
          if (!keep && ctx.thinLab && thinById) { const tc = thinById.get(ctx.thinLab[k]); keep = !tc || (tc.x0 >= bx0 - sp * 0.3 && tc.x1 <= bx1 + sp * 0.3 && tc.y0 >= by0 - sp * 0.3 && tc.y1 <= by1 + sp * 0.3); }
          if (keep) { bits[k] = 1; nn++; }
        }
        bigParts.push({ id: g.id, x0: bx0, y0: by0, x1: bx1, y1: by1, w: bx1 - bx0 + 1, h: by1 - by0 + 1, n: nn, offSlur: true, bits });
        if (globalThis.__wordDbg) globalThis.__wordDbg.push({ L: 'offSlur', at: [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1], g: [g.x0, g.y0, g.w, g.h] });
      }
    }
    const partSet = new Set(bigParts);
    const mine = [...ctx.compsC, ...bigParts].filter((g) => {
      if (taken.has(g)) return false;
      const gx = (g.x0 + g.x1) / 2, gy = (g.y0 + g.y1) / 2;
      if (g.x0 < startX - sp * 0.2 || g.x1 > s.x1 + sp) return false;
      if (ctx.staves && ownerOf(g) !== ctx.staves[si]) return false;
      if (gy > s.top + sp * 0.6 && gy < s.bottom - sp * 0.6) return false;
      if (gy < s.top - sp * 7 || gy > s.bottom + sp * 7) return false;
      // not part of a note (head, stem, flag, beam)
      if (heads.some((hd) => gx > hd.cx - sp * 0.7 && gx < hd.cx + sp * 0.7 && gy > hd.cy - sp * 0.6 && gy < hd.cy + sp * 0.6)) return false;
      if (heads.some((hd) => hd.stem && Math.abs(hd.stem.x - gx) < g.w / 2 + 1 && gy >= hd.stem.top - 2 && gy <= hd.stem.bot + 2)) return false;
      return true;
    });
    if (globalThis.__wordDbg && globalThis.__dbgRect) { const [rx0, rx1, ry0, ry1] = globalThis.__dbgRect; for (const g of ctx.compsC) if (g.x1 > rx0 && g.x0 < rx1 && g.y1 > ry0 && g.y0 < ry1) globalThis.__wordDbg.push({ L: 'rect', si, g: [g.x0, g.x1, g.y0, g.y1], mine: mine.includes(g), taken: taken.has(g), part: partSet.has(g), owner: ctx.staves ? ctx.staves.indexOf(ownerOf(g)) : null, near: ctx.staves ? ctx.staves.indexOf(ctx.staffOf((g.y0 + g.y1) / 2, (g.x0 + g.x1) / 2)) : null, top: s.top, bottom: s.bottom, sp }); }
    if (globalThis.__wordDbg) for (const g of [...ctx.compsC]) if (g.w > sp * 1.2 && g.w < sp * 4 && g.y0 > s.bottom) globalThis.__wordDbg.push({ L: 'cand', cand: [g.x0, g.y0, g.w, g.h], mine: mine.includes(g), taken: taken.has(g), staff: si });
    // (one hairpin found twice, in two pieces that overlap: one, over both)
    const rawById = new Map(ctx.rawC.map((r) => [r.id, r]));
    const addHp = (si, a, b, dir, hx0, hx1, sp) => {
      const o = hairpins[si].find((q) => q.dir === dir && q.hx0 < hx1 + sp * 0.5 && q.hx1 > hx0 - sp * 0.5);
      if (!o) { hairpins[si].push({ a: a.id, b: b.id, dir, hx0, hx1, ax: a.cx, bx: b.cx }); return; }
      if (a.cx < o.ax) { o.a = a.id; o.ax = a.cx; }
      if (b.cx > o.bx) { o.b = b.id; o.bx = b.cx; }
      o.hx0 = Math.min(o.hx0, hx0); o.hx1 = Math.max(o.hx1, hx1);
    };
    // ---- hairpins: two thin straight lines opening from a point
    for (const g of mine) {
      if (partSet.has(g)) continue;
      const gw = g.w / sp, gh = g.h / sp;
      if (globalThis.__wordDbg && gw >= 1.5) globalThis.__wordDbg.push({ hp: 1, x: g.x0, y: g.y0, gw: +gw.toFixed(2), gh: +gh.toFixed(2), fill: +(g.n / (g.w * g.h)).toFixed(2), ids: Array.isArray(g.id) ? g.id.length : 1 });
      if (gw < 1.3 || gh < 0.35 || gh > 2.4 || g.n > g.w * g.h * 0.5) continue;
      let ids = Array.isArray(g.id) ? g.id : [g.id];
      // (a group with a small piece in it, a digit or a dot beside the wedge: the long pieces only)
      if (ids.length > 1) {
        const long = ids.filter((id) => { const r = rawById.get(id); return !r || r.w >= sp * 1.0; });
        if (long.length && long.length < ids.length) ids = long;
      }
      const cols = [];
      for (let x = g.x0; x <= g.x1; x++) {
        let top = -1, bot = -1;
        for (let y = g.y0; y <= g.y1; y++) { const k = y * w + x; if (ctx.C[k] && ids.includes(ctx.labC[k])) { if (top < 0) top = y; bot = y; } }
        if (top >= 0) cols.push([x, bot - top]);
      }
      if (cols.length < g.w * 0.8) continue;
      const q = Math.max(2, Math.floor(cols.length / 8));
      const avg = (a2) => a2.reduce((t, c) => t + c[1], 0) / Math.max(1, a2.length);
      // the widest place (the open end; a tail of something touching it beyond is ignored)
      let mi = 0, mv = -1; for (let i = 0; i + q <= cols.length; i++) { const v = avg(cols.slice(i, i + q)); if (v > mv) { mv = v; mi = i; } }
      const opensRight = mi + q / 2 > cols.length / 2;
      const span = opensRight ? cols.slice(0, mi + q) : cols.slice(mi);
      if (span.length < sp * 1.6) continue;
      const shut = opensRight ? avg(span.slice(0, q)) : avg(span.slice(-q)), open = mv;
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ hpCols: g.x0, open: +(open / sp).toFixed(2), shut: +(shut / sp).toFixed(2), n: cols.length });
      // (a long, flat wedge may open only a little; it still closes to a point)
      const longFlat = g.w > sp * 4 && shut < sp * 0.12;
      if (open < sp * (longFlat ? 0.36 : 0.45) || shut > sp * 0.35 || open < shut * 2.5) continue;
      // two thin lines: in the open half of a wedge, a column crosses two thin strokes with white
      // between them (a letter, an ff or a pp, crosses thick strokes or one solid shape)
      if (globalThis.__hpTwo ?? 1) {
        let two = 0, tot = 0;
        const half = opensRight ? span.slice(Math.floor(span.length / 2)) : span.slice(0, Math.ceil(span.length / 2));
        for (const [x] of half) {
          let runs = 0, thick = 0, run = 0;
          for (let y = g.y0; y <= g.y1 + 1; y++) {
            const k = y * w + x; const on = y <= g.y1 && ctx.C[k] && ids.includes(ctx.labC[k]);
            if (on) run++; else if (run) { runs++; if (run > sp * 0.32) thick++; run = 0; }
          }
          tot++; if (runs === 2 && !thick) two++;
        }
        if (globalThis.__wordDbg) globalThis.__wordDbg.push({ hpTwo: g.x0, two, tot });
        if (tot && two < tot * 0.33) continue;
      }
      // the opening grows evenly along the wedge (not a slur, a letter or a beam)
      let mono = 0, steps = 0; const seq = opensRight ? span : span.slice().reverse();
      for (let i = q; i + q <= seq.length; i += q) { steps++; if (avg(seq.slice(i, i + q)) >= avg(seq.slice(i - q, i)) - 1) mono++; }
      if (!steps || mono < steps * 0.8) continue;
      // (a wedge closes in no white: letters that touch, a pp, do)
      if ((globalThis.__hpHoles ?? 1) && g.w < sp * 5 && holesIn(ctx.C, w, ctx.h, g) > 0) continue;
      const dir = opensRight ? '<' : '>';
      const hx0 = g.x0, hx1 = g.x1;
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ L: 'hp', hpFound: dir, x: g.x0, hx0, hx1, heads: heads.map((q) => Math.round(q.cx)).join(',') });
      // from the first note at its start to the last note it reaches
      // (a hairpin that starts after a dynamic begins a little right of its note)
      const a = heads.filter((hd) => hd.cx <= hx0 + sp * 0.9 && hd.cx >= hx0 - sp * 4.5).pop() || heads.find((hd) => hd.cx >= hx0 - sp * 0.8);
      const b = heads.slice().reverse().find((hd) => hd.cx <= hx1 + sp * 0.3) || a;
      if (!a || !b) continue;
      addHp(si, a, b, dir, hx0, hx1, sp);
      taken.add(g);
    }
    // ---- hairpins whose two lines do not meet (long or handwritten ones): two thin straight lines,
    // one above the other, drawing apart evenly from one end to the other
    {
      const lines = [];
      for (const g of mine) {
        if (partSet.has(g) || taken.has(g) || g.w < sp * ((globalThis.__hpPieces ?? 1) ? 1.2 : 3) || g.h > sp * 2.2) continue;
        const ids = Array.isArray(g.id) ? g.id : [g.id];
        const pts = []; let thick = 0, nc = 0;
        for (let x = g.x0; x <= g.x1; x += 2) {
          let top = -1, bot = -1;
          for (let y = g.y0; y <= g.y1; y++) { const k = y * w + x; if (ctx.C[k] && ids.includes(ctx.labC[k])) { if (top < 0) top = y; bot = y; } }
          if (top < 0) continue;
          nc++; if (bot - top > sp * 0.4) thick++;
          pts.push([x, (top + bot) / 2]);
        }
        if (globalThis.__wordDbg) globalThis.__wordDbg.push({ lineCand: g.x0, y: g.y0, nc, thick, need: Math.round((g.w / 2) * 0.85) });
        if (pts.length < 4 || thick > nc * 0.15 || nc < (g.w / 2) * 0.85) continue;
        // a straight line through the middles
        const n = pts.length, mx = pts.reduce((a, q) => a + q[0], 0) / n, my = pts.reduce((a, q) => a + q[1], 0) / n;
        let sxy = 0, sxx = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
        const k = sxx ? sxy / sxx : 0;
        let res = 0; for (const [x, y] of pts) res = Math.max(res, Math.abs(y - (my + k * (x - mx))));
        if (globalThis.__wordDbg) globalThis.__wordDbg.push({ lineFit: g.x0, res: +(res / sp).toFixed(2), k: +k.toFixed(3) });
        if (res > sp * 0.25 || Math.abs(k) > 0.25) continue;
        lines.push({ g, gs: [g], x0: g.x0, x1: g.x1, k, at: (x) => my + k * (x - mx) });
      }
      // (a line cut by a stem crossing it: its pieces, one after the other on the same line, joined)
      if (globalThis.__hpPieces ?? 1) {
        lines.sort((a, b) => a.x0 - b.x0);
        for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
          const A = lines[i], Bq = lines[j]; if (!A || !Bq) continue;
          const gapX = Bq.x0 - A.x1;
          if (gapX < -2 || gapX > sp * 0.7) continue;
          const xm = (A.x1 + Bq.x0) / 2;
          if (Math.abs(A.at(xm) - Bq.at(xm)) > sp * 0.22 || Math.abs(A.k - Bq.k) > 0.08) continue;
          const kk = (A.at(Bq.x1) - A.at(A.x0)) / Math.max(1, Bq.x1 - A.x0), x0 = A.x0, y0 = A.at(A.x0), wA = A.x1 - A.x0, wB = Bq.x1 - Bq.x0;
          const k2 = (wA * A.k + wB * Bq.k) / Math.max(1, wA + wB); void kk;
          const y0b = (A.at(A.x0) + (Bq.at(Bq.x0) - k2 * (Bq.x0 - A.x0))) / 2;
          lines[i] = { g: A.g, gs: [...A.gs, ...Bq.gs], x0, x1: Bq.x1, k: k2, at: (x) => y0b + k2 * (x - x0) }; void y0;
          lines.splice(j, 1); j = i;
        }
        for (let i = lines.length - 1; i >= 0; i--) if (lines[i].x1 - lines[i].x0 < sp * 3) lines.splice(i, 1);
      }
      for (let i = 0; i < lines.length; i++) for (let j = 0; j < lines.length; j++) {
        if (i === j) continue;
        const A = lines[i], Bl = lines[j];
        if (A.gs.some((q) => taken.has(q)) || Bl.gs.some((q) => taken.has(q))) continue;
        const xs = Math.max(A.x0, Bl.x0), xe = Math.min(A.x1, Bl.x1);
        if (xe - xs < Math.min(A.x1 - A.x0, Bl.x1 - Bl.x0) * 0.7) continue;
        const dL = Bl.at(xs) - A.at(xs), dR = Bl.at(xe) - A.at(xe);
        if (dL <= 0 || dR <= 0) continue;                 // A above B all along
        const lo = Math.min(dL, dR), hi = Math.max(dL, dR);
        // (a long one may open only a little over its length)
        const long = xe - xs > sp * 12;
        if (hi > sp * 3 || !((lo <= sp * 0.7 && hi >= sp * 0.5 && hi >= lo * 1.6) || (long && lo <= sp * 1.3 && hi - lo >= sp * 0.3))) continue;
        const dir = dR > dL ? '<' : '>';
        const hx0 = Math.min(A.x0, Bl.x0), hx1 = Math.max(A.x1, Bl.x1);
        const a = heads.filter((hd) => hd.cx <= hx0 + sp * 0.9 && hd.cx >= hx0 - sp * 4.5).pop() || heads.find((hd) => hd.cx >= hx0 - sp * 0.8);
        const b = heads.slice().reverse().find((hd) => hd.cx <= hx1 + sp * 0.3) || a;
        if (!a || !b) continue;
        addHp(si, a, b, dir, hx0, hx1, sp);
        for (const q of [...A.gs, ...Bl.gs]) taken.add(q);
        if (globalThis.__wordDbg) globalThis.__wordDbg.push({ L: 'hp', hpPair: dir, hx0, hx1, dL: +(dL / sp).toFixed(2), dR: +(dR / sp).toFixed(2) });
      }
    }
    // ---- letters and digits
    const LET = ['Dp', 'Dm', 'Df', 'Dr', 'Ds', 'Dz'], DIG = ['F0', 'F1', 'F2', 'F3', 'F4', 'F5'];
    // a thin-stroked digit (a 0, a 3) may come in two halves: narrow pieces side by side, as tall
    // as each other, are put together first
    const pool = mine.filter((g) => !taken.has(g) && !partSet.has(g)).sort((a, b) => a.x0 - b.x0);
    // (or broken across its middle): small pieces close together, that make a digit-sized shape
    const merged = [];
    const used2 = new Set();
    const ids = (q) => (Array.isArray(q.id) ? q.id : [q.id]);
    for (let i = 0; i < pool.length; i++) {
      if (used2.has(i)) continue;
      let a = pool[i];
      if (a.w > sp * 0.9 || a.h > sp * 1.7) { merged.push(a); continue; }
      let grown = false;
      for (let j = i + 1; j < pool.length; j++) {
        if (used2.has(j)) continue;
        const b = pool[j]; if (b.x0 > a.x1 + sp * 0.3) break;
        if (b.w > sp * 0.9 || b.h > sp * 1.7) continue;
        const gapX = Math.max(0, b.x0 - a.x1, a.x0 - b.x1), gapY = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
        const ux0 = Math.min(a.x0, b.x0), ux1 = Math.max(a.x1, b.x1), uy0 = Math.min(a.y0, b.y0), uy1 = Math.max(a.y1, b.y1);
        if (gapX > sp * 0.28 || gapY > sp * 0.22 || ux1 - ux0 > sp * 0.95 || uy1 - uy0 > sp * 1.75) continue;
        a = { id: [...ids(a), ...ids(b)], x0: ux0, x1: ux1, y0: uy0, y1: uy1, w: ux1 - ux0 + 1, h: uy1 - uy0 + 1, n: (a.n || 0) + (b.n || 0), parts: [...(a.parts || [a]), b] };
        used2.add(j); grown = true;
      }
      merged.push(a); void grown;
    }
    for (const g of bigParts) if (mine.includes(g) && !taken.has(g)) merged.push(g);
    // (a dynamic run into something above or below it, a tuplet's number: its own piece, when the
    // whole is too big to be a dynamic)
    {
      const byId = new Map(ctx.rawC.map((r) => [r.id, r]));
      for (const g of pool) {
        if (!(globalThis.__dynParts ?? 1) || !Array.isArray(g.id) || g.id.length < 2 || (g.h <= sp * 3.4 && g.w <= sp * 4.6)) continue;
        for (const id of g.id) { const r = byId.get(id); if (r && !taken.has(r) && r.h >= sp * 0.9 && r.h <= sp * 3.4 && r.w >= sp * 0.9 && r.w <= sp * 4.6 && !merged.includes(r)) merged.push(r); }
      }
    }
    const small = [];
    for (const g of merged) {
      if (taken.has(g)) continue;
      const gw = g.w / sp, gh = g.h / sp;
      if (gh < 0.5 || gh > 3.4 || gw < 0.2 || gw > 4.6) continue;   // (handwritten dynamics are big)
      const sh = shapeOf(g.bits || ctx.C, w, g.x0, g.y0, g.x1, g.y1, sp, ctx.labC, g.id);
      const L0 = nearest(sh, LET, 0.12), rc = readChar(g.bits ? { ...ctx, C: g.bits } : ctx, g);
      // the finer comparison decides; the music fonts' own dynamics letters can still win
      const Lr = rc.D ? { cls: rc.D.cls, d: rc.D.d * 1.6 } : L0;
      const L = Lr.d < L0.d ? Lr : L0;
      let D = rc.F ? { cls: rc.F.cls, d: rc.F.d * 1.6 } : { cls: null, d: 9 };
      // a 1 is a narrow upright stroke: a shape about as wide as it is tall is another digit
      if (D.cls === 'F1' && g.w > g.h * 0.55 && rc.Fall) { const alt = Object.entries(rc.Fall).filter(([c]) => c !== 'F1').sort((a, b) => a[1] - b[1])[0]; if (alt) D = { cls: alt[0], d: alt[1] * 1.6 }; }
      const T2 = rc.T ? { cls: rc.T.cls, d: rc.T.d * 1.6 } : { cls: null, d: 9 };
      small.push({ g, L, Lr, D, T: T2, W: rc.W || null, cx: (g.x0 + g.x1) / 2, cy: (g.y0 + g.y1) / 2 });
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ x: Math.round(g.x0), y: Math.round(g.y0), gw: +gw.toFixed(2), gh: +gh.toFixed(2), L: L.cls + ' ' + L.d.toFixed(2), D: D.cls + ' ' + D.d.toFixed(2), T: T2.cls + ' ' + T2.d.toFixed(2) });
    }
    // letters side by side, on one line, make words
    small.sort((a, b) => a.g.x0 - b.g.x0);
    const used = new Set();
    for (let i = 0; i < small.length; i++) {
      if (used.has(i) || partSet.has(small[i].g)) continue;
      const word = [i];
      for (let j = i + 1; j < small.length; j++) {
        const last = small[word[word.length - 1]], q = small[j];
        if (partSet.has(q.g)) continue;
        if (q.g.x0 - last.g.x1 > sp * 0.55) break;
        const oy = Math.min(q.g.y1, last.g.y1) - Math.max(q.g.y0, last.g.y0);
        if (oy < Math.min(q.g.h, last.g.h) * 0.3) continue;
        word.push(j);
      }
      let ls = word.map((k) => small[k]);
      // the end of a longer word (the t of 'vibrant') is not a dynamic of its own
      const a0 = small[i].g;
      if (small.some((q, k) => k < i && !partSet.has(q.g) && a0.x0 - q.g.x1 <= sp * 0.55 && q.g.x1 < a0.x0 + sp * 0.2 && Math.min(q.g.y1, a0.y1) - Math.max(q.g.y0, a0.y0) >= Math.min(q.g.h, a0.h) * 0.3)) continue;
      let str = ls.map((x) => x.L.cls ? x.L.cls[1] : '?').join('');
      // one shape that is a whole dynamic (letters that touch)
      // (unless it is plainly one letter that is a dynamic by itself: a big italic f is wide too)
      const oneLetter = ls.length === 1 && ls[0].L.cls && DYN_WORDS.has(ls[0].L.cls[1]) && ls[0].L.d < 0.12 && ls[0].W && ls[0].L.d <= ls[0].W.d + 0.02;
      if (ls.length === 1 && !oneLetter && ls[0].W && ls[0].W.d < 0.2 && ls[0].g.w > sp * 0.95 && ls[0].W.d < (ls[0].D.d / 1.6) - 0.02) { str = ls[0].W.cls.slice(1); ls[0].L = { cls: 'D' + str, d: 0 }; }
      let ok = DYN_WORDS.has(str) && ls.every((x) => x.L.d === 0 || (x.L.d < 0.34 && x.L.d <= x.D.d + 0.02 && x.L.d <= x.T.d - 0.03));
      // one letter of an otherwise clear dynamic read a little off (the m of mf in another font):
      // it is that letter when it is still nearer to it than to a digit or a text letter
      if (!ok && ls.length >= 2 && ls.length <= 4) {
        for (let k = 0; k < ls.length && !ok; k++) {
          const others = ls.every((x, i) => i === k || x.L.d === 0 || (x.L.d < 0.34 && x.L.d <= x.D.d + 0.02 && x.L.d <= x.T.d - 0.03));
          if (!others) break;
          const x = ls[k];
          let pick = null;
          for (const ch of 'mpsfzr') {
            const s2 = str.slice(0, k) + ch + str.slice(k + 1);
            if (s2 === str || !DYN_WORDS.has(s2)) continue;
            // (an f stands taller than the other letters; the others are no taller than an f)
            const tallest = Math.max(...ls.filter((q, i) => i !== k).map((q) => q.g.h));
            if (ch === 'f' ? x.g.h < tallest * 0.9 && !/f/.test(str.slice(0, k) + str.slice(k + 1)) || ls.some((q, i) => i !== k && q.L.cls !== 'Df' && q.g.h >= x.g.h * 0.87) : ls.some((q, i) => i !== k && q.L.cls === 'Df' && q.g.h < x.g.h * 1.1)) continue;
            // (by width against an f or p of the same word: an m is the widest letter, r s z narrow)
            const ref = ls.find((q, i) => i !== k && (q.L.cls === 'Df' || q.L.cls === 'Dp'));
            if (ref && ((ch === 'm' && x.g.w < ref.g.w * 0.95) || ('rsz'.includes(ch) && x.g.w > ref.g.w * 0.9))) continue;
            const wideM = ch === 'm' && ref && x.g.w >= ref.g.w * 0.95;
            const d2 = nearest(shapeOf(ctx.C, w, x.g.x0, x.g.y0, x.g.x1, x.g.y1, sp, ctx.labC, x.g.id), ['D' + ch], 0.12).d - (wideM ? 0.1 : 0);
            if (d2 < 0.5 && d2 < x.D.d && d2 < x.T.d && (!pick || d2 < pick.d)) pick = { s2, ch, d: d2 };
          }
          if (pick) { str = pick.s2; x.L = { cls: 'D' + pick.ch, d: pick.d }; ok = true; }
        }
      }
      // one handwritten letter in two pieces (the stroke and the bowl of a p): the pieces together
      if (!ok && ls.length === 2) {
        const idsOf = (q) => (Array.isArray(q.id) ? q.id : [q.id]);
        const A = ls[0].g, Bq = ls[1].g;
        const u = { id: [...idsOf(A), ...idsOf(Bq)], x0: Math.min(A.x0, Bq.x0), x1: Math.max(A.x1, Bq.x1), y0: Math.min(A.y0, Bq.y0), y1: Math.max(A.y1, Bq.y1) };
        u.w = u.x1 - u.x0 + 1; u.h = u.y1 - u.y0 + 1;
        if (u.w <= sp * 2.4 && u.h <= sp * 3.4 && u.h >= sp * 1.0 && A.h >= sp * 0.6 && Bq.h >= sp * 0.6 && Bq.x0 - A.x1 < sp * 0.3) {
          const L1 = nearest(shapeOf(ctx.C, w, u.x0, u.y0, u.x1, u.y1, sp, ctx.labC, u.id), LET, 0.12), rc = readChar(ctx, u);
          const Dd = rc.F ? rc.F.d * 1.6 : 9, Td = rc.T ? rc.T.d * 1.6 : 9;
          if (L1.cls && DYN_WORDS.has(L1.cls[1]) && L1.d < 0.22 && L1.d < Dd && L1.d < Td - 0.03) { str = L1.cls[1]; ls = [{ ...ls[0], g: u, L: L1 }]; ok = true; }
        }
      }
      if (!ok) continue;
      // above the staff (where bowings, fingerings and words go in instrumental parts) only a very
      // clear dynamic
      const staffAbove = read.some((o) => o !== s && o.bottom < s.top && s.top - o.bottom < sp * 12);
      if (!staffAbove && ls.every((x) => x.g.y1 < s.top) && !(ls.length >= 2 || ls[0].L.d < 0.15)) continue;
      // an f reaches above and below the others: a small one is a bit of something else
      if (ls.some((x) => x.L.cls === 'Df' && x.g.h < sp * 0.65)) continue;
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ dyn: str, at: ls.map((x) => [x.g.x0, x.g.y0, x.g.w, x.g.h]) });
      // under (or over) the note it starts at
      const x0 = ls[0].g.x0, x1 = ls[ls.length - 1].g.x1, xc = (x0 + x1) / 2;
      const hd = heads.filter((q) => q.cx > x0 - sp * 1.6 && q.cx < x1 + sp * 2.0).sort((p, r) => Math.abs(p.cx - xc) - Math.abs(r.cx - xc))[0];
      if (!hd) continue;
      hd.dyn = str;
      for (const k of word) { used.add(k); taken.add(small[k].g); for (const q of small[k].g.parts || []) taken.add(q); }
    }
    // letters packed close together in a row are a word, not fingering (dolcissimo, cresc.)
    const wordRuns = [];
    {
      const idx = small.map((_, i) => i).filter((i) => !used.has(i) && !partSet.has(small[i].g)).sort((a, b) => small[a].g.x0 - small[b].g.x0);
      // (along one line: a digit above or below the word, at the same place, does not break it)
      const inRun = new Set();
      for (const i0 of idx) {
        if (inRun.has(i0)) continue;
        const run = [i0];
        for (const i of idx) {
          if (inRun.has(i) || run.includes(i)) continue;
          const g = small[i].g, l = small[run[run.length - 1]].g;
          if (g.x0 <= l.x0) continue;
          if (g.x0 - l.x1 > sp * 0.5) break;
          const oy = Math.min(g.y1, l.y1) - Math.max(g.y0, l.y0);
          if (oy < Math.min(g.h, l.h) * 0.35) continue;
          run.push(i);
        }
        if (run.length >= 3) { wordRuns.push(run); for (const k of run) { used.add(k); inRun.add(k); } }
      }
    }
    // digits by the notes: fingering
    for (let i = 0; i < small.length; i++) {
      if (used.has(i)) continue;
      const x = small[i];
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ L: 'fc', fcand: [x.g.x0, x.g.y0], D: x.D, Lr: x.Lr, wh: [+(x.g.w / sp).toFixed(2), +(x.g.h / sp).toFixed(2)], near: heads.filter((q) => Math.abs(q.cx - x.cx) < sp * 1.5).map((q) => [Math.round(q.cx), Math.round(q.cy), q.stem && [q.stem.top, q.stem.bot]]) });
      // (a blurred or heavy print: the loose comparison with the digits, when it is clear and the
      // holes agree)
      if (x.D.d > 0.4 && x.g.h > sp * 0.8 && x.g.h < sp * 1.8) {
        const sh = shapeOf(ctx.C, w, x.g.x0, x.g.y0, x.g.x1, x.g.y1, sp, ctx.labC, x.g.id);
        const holes = holesIn(ctx.C, w, ctx.h, x.g);
        const HOLES = { d0: 1, d1: 0, d2: 0, d3: 0, d4: [0, 1], d5: 0 };
        const lz = classifyLoose(sh, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd8', 'd9']).filter((q) => { const hh = HOLES[q.cls]; return hh === undefined || (Array.isArray(hh) ? hh.includes(holes) : hh === holes); });
        if (lz[0] && /^d[02-5]$/.test(lz[0].cls) && lz[0].d < 0.11 && (!lz[1] || lz[1].d - lz[0].d > 0.01) && x.Lr.d > 0.45) x.D = { cls: 'F' + lz[0].cls[1], d: 0.4 };
      }
      if (!x.D.cls || x.D.d > 0.46 || x.D.d > x.Lr.d - 0.02) continue;
      // (a piece taken out of a bigger shape: only a clear digit)
      if (partSet.has(x.g) && x.T.d < x.D.d + 0.05) continue;
      if (x.D.cls === 'F1' && x.g.w < sp * 0.3) continue;
      // (out of a curve or a bracket only a digit with a shape of its own: a bracket's end is a 1)
      if (x.g.offSlur && (x.D.cls === 'F1' || x.D.d > 0.36)) continue;
      // (a 0 is a closed ring: a down-bow sign or a bit of a slur is open)
      if (x.D.cls === 'F0' && (globalThis.__f0h ?? 0) && Array.isArray(x.g.id) && x.g.id.length > 1 && holesIn(ctx.C, w, ctx.h, x.g) !== 1) continue;
      if (x.g.h > sp * 2 || x.g.w > sp * 1.4) continue;
      const hd = heads.filter((q) => Math.abs(q.cx - x.cx) < sp * 1.0).sort((p, r) => Math.abs(p.cx - x.cx) - Math.abs(r.cx - x.cx))[0];
      if (!hd) continue;
      // near the note: within a few spaces of its head or of the end of its stem
      const ends = [hd.cy, hd.stem ? hd.stem.top : hd.cy, hd.stem ? hd.stem.bot : hd.cy];
      // (above the staff a fingering sits over the bowing, the slur and the accents of the note: further off)
      // (but alone there: not one of the letters of a line of words)
      const alone = !small.some((q) => q !== x && Math.max(q.g.x0 - x.g.x1, x.g.x0 - q.g.x1) < sp * 1.0 && Math.min(q.g.y1, x.g.y1) - Math.max(q.g.y0, x.g.y0) > Math.min(q.g.h, x.g.h) * 0.3);
      if (Math.min(...ends.map((y) => Math.abs(y - x.cy))) > sp * (x.g.y1 < s.top - sp * 0.5 && x.D.d < (globalThis.__farD ?? 0.42) && alone ? 7.5 : 4.2)) continue;
      // (fingerings stand one over the other, never touching side by side like letters: 'et')
      if (small.some((q) => q !== x && Math.max(q.g.x0 - x.g.x1, x.g.x0 - q.g.x1) < sp * 0.35 && Math.min(q.g.y1, x.g.y1) - Math.max(q.g.y0, x.g.y0) > Math.min(q.g.h, x.g.h) * 0.5)) continue;
      (hd.fingD = hd.fingD || []).push({ v: x.D.cls[1], y: x.cy });
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ fing: x.D.cls, at: [x.g.x0, x.g.y0], hd: Math.round(hd.cx) });
      used.add(i); taken.add(x.g); for (const q of x.g.parts || []) taken.add(q);
    }
    for (const hd of heads) if (hd.fingD) { hd.fing = hd.fingD.sort((a, b) => b.y - a.y).map((q) => q.v).join(' '); delete hd.fingD; }
    // ---- words (tempo, expressions: Lent, dolce, cresc., molto legato…): what is left outside the
    // staff, letters side by side on one line. They are read as text later (by the device), so a
    // line that is not words simply reads as nothing
    {
      const inWord = new Set(wordRuns.flat().map((k) => small[k].g));
      const left = mine.filter((g) => !partSet.has(g) && (inWord.has(g) || (!taken.has(g) && !small.some((x, i) => used.has(i) && x.g === g))) && g.h >= sp * 0.3 && g.h <= sp * 2.8 && g.w <= sp * 3 && g.w >= sp * 0.12 && (g.y1 < s.top - sp * 0.4 || g.y0 > s.bottom + sp * 0.4)).sort((a, b) => a.x0 - b.x0);
      if (globalThis.__wordDbg) globalThis.__wordDbg.push({ left: left.map((g) => [g.x0, g.y0, +(g.w / sp).toFixed(2), +(g.h / sp).toFixed(2)]) });
      const lines = [];
      for (const g of left) {
        const cy = (g.y0 + g.y1) / 2;
        const l = lines.find((q) => g.x0 - q.x1 < sp * 1.6 && g.x0 >= q.x0 && Math.abs(cy - q.cy) < Math.max(q.h, g.h) * 0.55);
        if (l) { l.x1 = Math.max(l.x1, g.x1); l.y0 = Math.min(l.y0, g.y0); l.y1 = Math.max(l.y1, g.y1); l.n++; l.h = Math.max(l.h, g.h); l.cy = (l.y0 + l.y1) / 2; }
        else lines.push({ x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, cy, h: g.h, n: 1 });
      }
      (ctx.texts = ctx.texts || read.map(() => []))[si] = lines.filter((l) => l.n >= 2 && l.x1 - l.x0 > sp * 1.2).map((l) => ({ x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1, above: l.y1 < s.top }));
    }
  }
}

// ---- a finer comparison for letters and digits: both pictures on a 16×24 grid, softened a little
// (so a bolder or thinner print still matches), against the characters drawn in many fonts
const GX = 16, GY = 24;
function gridOfBox(get, x0, y0, x1, y1) {
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, g = new Float32Array(GX * GY);
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    const ax = x0 + (gx * cw) / GX, bx = x0 + ((gx + 1) * cw) / GX, ay = y0 + (gy * ch) / GY, by = y0 + ((gy + 1) * ch) / GY;
    let sum = 0, n = 0;
    for (let y = Math.floor(ay); y < Math.max(Math.floor(ay) + 1, Math.ceil(by)); y++) for (let x = Math.floor(ax); x < Math.max(Math.floor(ax) + 1, Math.ceil(bx)); x++) { n++; sum += get(x, y); }
    g[gy * GX + gx] = sum / Math.max(1, n);
  }
  // soften
  const o = new Float32Array(GX * GY);
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) { let t = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GX || yy >= GY) continue; const wgt = dx || dy ? 1 : 2; t += g[yy * GX + xx] * wgt; n += wgt; } o[y * GX + x] = t / n; }
  return { g: o, ar: cw / ch };
}
let CHARS = null;
function charTemplates() {
  if (CHARS) return CHARS;
  CHARS = [];
  const c = document.createElement('canvas'); c.width = 260; c.height = 260;
  const x = c.getContext('2d', { willReadFrequently: true });
  const draw = (cls, font, ch) => {
    x.clearRect(0, 0, 260, 260); x.fillStyle = '#000'; x.font = font; x.textBaseline = 'alphabetic'; x.fillText(ch, 60, 180);
    const d = x.getImageData(0, 0, 260, 260).data;
    let x0 = 260, y0 = 260, x1 = -1, y1 = -1;
    for (let i = 0; i < 260 * 260; i++) if (d[i * 4 + 3] > 110) { const px = i % 260, py = (i - px) / 260; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    if (x1 < 0) return;
    CHARS.push({ cls, ...gridOfBox((xx, yy) => (d[(yy * 260 + xx) * 4 + 3] > 110 ? 1 : 0), x0, y0, x1, y1) });
  };
  const fams = ['"Times New Roman", Times, serif', 'Georgia, serif', 'Baskerville, serif', 'Palatino, "Palatino Linotype", serif', 'Didot, serif', '"Century Schoolbook", "New Century Schoolbook", serif', 'Helvetica, Arial, sans-serif'];
  for (const f of fams) for (const st of ['', 'bold ', 'italic ', 'bold italic ']) {
    for (let n = 0; n <= 5; n++) draw('F' + n, `${st}120px ${f}`, String(n));
    if (st.includes('italic')) for (const L of 'pmfrsz') draw('D' + L, `${st}120px ${f}`, L);
    else for (const L of 'pima') draw('T' + L, `${st}120px ${f}`, L);
  }
  // whole dynamics (their letters often touch): the music font's own, and in bold italic type
  const DYNW = { pp: 'E52B', ppp: 'E52A', mp: 'E52C', mf: 'E52D', ff: 'E52F', fff: 'E530', fp: 'E534', fz: 'E535', sf: 'E536', sfp: 'E537', sfz: 'E539', sffz: 'E53B', rf: 'E53C', rfz: 'E53D' };
  const LET = { p: 0xE520, m: 0xE521, f: 0xE522, r: 0xE523, s: 0xE524, z: 0xE525 };
  for (const [wd, cp] of Object.entries(DYNW)) {
    draw('W' + wd, '160px Bravura', String.fromCodePoint(parseInt(cp, 16)));
    draw('W' + wd, '160px Bravura', [...wd].map((L) => String.fromCodePoint(LET[L])).join(''));
    for (const f of ['"Times New Roman", Times, serif', 'Georgia, serif']) draw('W' + wd, `bold italic 120px ${f}`, wd);
  }
  // the music font's own dynamics letters and fingering digits
  for (const [k, cp] of [['Dp', 0xE520], ['Dm', 0xE521], ['Df', 0xE522], ['Dr', 0xE523], ['Ds', 0xE524], ['Dz', 0xE525], ['F0', 0xED10], ['F1', 0xED11], ['F2', 0xED12], ['F3', 0xED13], ['F4', 0xED14], ['F5', 0xED15]]) draw(k, '160px Bravura', String.fromCodePoint(cp));
  // and the same drawn in more music fonts (handwritten ones too), made ahead of time
  for (const t of CHARS2) { if (t.cls[0] === 'D') continue; const s2 = atob(t.m); const g = new Float32Array(s2.length); for (let i = 0; i < s2.length; i++) g[i] = s2.charCodeAt(i) / 255; CHARS.push({ cls: t.cls, g, ar: t.ar }); }
  return CHARS;
}
// the best of each kind (D: dynamics letters, F: digits, T: other letters) for a shape on the page
function readChar(ctx, g) {
  const { w } = ctx, ids = Array.isArray(g.id) ? g.id : [g.id];
  const get = (x, y) => { const k = y * w + x; return ctx.C[k] && ids.includes(ctx.labC[k]) ? 1 : 0; };
  const a = gridOfBox(get, g.x0, g.y0, g.x1, g.y1);
  if (globalThis.__charDump) { let t = ''; for (let y = g.y0; y <= g.y1; y++) { for (let x = g.x0; x <= g.x1; x++) t += get(x, y) ? '#' : '.'; t += '\n'; } globalThis.__charDump.push({ x: g.x0, y: g.y0, t }); }
  const best = {};
  for (const t of charTemplates()) {
    let d = 0; for (let i = 0; i < a.g.length; i++) d += Math.abs(a.g[i] - t.g[i]);
    d = d / a.g.length + 0.25 * Math.abs(Math.log(a.ar / t.ar));
    const kind = t.cls[0];
    if (!best[kind] || d < best[kind].d) best[kind] = { cls: t.cls, d };
    // (all the digits too, best first: a narrow 1 against a wide digit is told by its shape)
    if (kind === 'F') { const all = best.Fall || (best.Fall = {}); if (!all[t.cls] || d < all[t.cls]) all[t.cls] = d; }
  }
  return best;
}

// Octave lines. The figure (an 8 above the staff for an octave higher, below for an octave lower),
// a dashed line after it, level with it, and where the line stops (a short hook, or the end of the
// staff when it goes on into the next line).
function readOttavas(read, ctx, ottavas) {
  const { w, h, C } = ctx;
  // (the hook at the end of a line: ink going down (up, below the staff) from the line, just there)
  const hookAt = (xEnd, yL, down, sp) => {
    for (let x = Math.round(xEnd - sp * 0.3); x <= Math.round(xEnd + sp * 1.6); x++) {
      let run = 0; for (let k = 0; k <= sp * 1.4; k++) { const y = Math.round(down ? yL + k : yL - k); if (y < 0 || y >= h || !C[y * w + x]) break; run++; }
      if (run >= sp * 0.6) return x;
    }
    return -1;
  };
  const comps = ctx.rawC;
  const dbg = globalThis.__ottDbg ? (globalThis.__ottDbg = []) : null;
  read.forEach((s, si) => {
    const sp = s.sp;
    if (dbg && globalThis.__ottAll) dbg.push({ si, top: s.top, x0: s.x0, all: comps.filter((g) => g.y1 < s.top && g.y1 > s.top - sp * 14 && g.x0 < s.x0 + sp * 15).map((g) => [g.x0, g.y0, g.x1, g.y1]) });
    for (const g of comps) {
      if (g.h < sp * 0.9 || g.h > sp * 2.6 || g.w < sp * 0.5 || g.w > sp * 2.0) continue;
      const above = g.y1 < s.top - sp * 0.3 && g.y0 > s.top - sp * 12, below = g.y0 > s.bottom + sp * 0.3 && g.y1 < s.bottom + sp * 10;
      if (!above && !below) continue;
      if (g.x0 < s.x0 - sp || g.x0 > s.x1) continue;
      // (it belongs to the staff it is nearest)
      const yc = (g.y0 + g.y1) / 2, dist = (o) => Math.min(Math.abs(yc - o.top), Math.abs(yc - o.bottom));
      if (read.some((o) => o !== s && o.x1 > g.x0 && o.x0 < g.x1 && dist(o) < dist(s))) continue;
      const holes = holesIn(C, w, h, g);
      const k = nearest(shapeOf(C, w, g.x0, g.y0, g.x1, g.y1, sp), ['O8', 'T8', 'F3', 'F5', 'F0', 'Dp']);
      if (dbg) dbg.push({ si, g: [g.x0, g.y0, g.x1, g.y1], holes, k });
      // (a scanned 8 may fill in and look like a 3 or a 5: then the line after it has to be a long one)
      const eight = (k.cls === 'O8' || k.cls === 'T8') && k.d <= (globalThis.__ott8D ?? 0.3) && (holes >= 1 || k.d <= 0.22);
      const figure = eight || (['F3', 'F5', 'F0', 'O8', 'T8'].includes(k.cls) && k.d <= 0.32);
      if (!figure) continue;
      // the dashes: short flat strokes in a row, level, at about the height of the figure
      let x = g.x1, yLine = null, n = 0, end = g.x1, hook = false;
      const dashes = comps.filter((q) => q !== g && q.x0 > g.x1 && q.x0 < s.x1 + sp && q.h <= sp * 0.4 && q.w <= sp * 2.4 && q.w >= 2 && q.y1 > g.y0 - sp * 0.4 && q.y0 < g.y1 + sp * 0.4).sort((a, b) => a.x0 - b.x0);
      for (const q of dashes) {
        const qy = (q.y0 + q.y1) / 2;
        // (a dynamic or a word set over the line breaks it for a while)
        if (q.x0 - x > (n >= 3 || (eight && n) ? sp * 4.5 : n ? sp * 2.2 : sp * 3.2)) break;
        if (yLine !== null && Math.abs(qy - yLine) > sp * 0.3) continue;
        yLine = yLine === null ? qy : yLine; n++; x = q.x1; end = q.x1;
      }
      if (n < (eight ? 2 : 4)) {
        // (an 8 by a single note, with no line: that note alone, an octave from where it is written)
        if (eight && (globalThis.__ott1 ?? 1)) {
          const hd = (s.heads || []).filter((q) => Math.abs(q.cx - (g.x0 + g.x1) / 2) < sp * 0.9 && (above ? q.cy > g.y1 && q.cy - g.y1 < sp * 3 : q.cy < g.y0 && g.y0 - q.cy < sp * 3)).sort((a, b) => Math.abs(a.cx - (g.x0 + g.x1) / 2) - Math.abs(b.cx - (g.x0 + g.x1) / 2))[0];
          if (dbg) dbg.push({ si, one: [g.x0, g.y0], hd: hd && [hd.cx, hd.cy] });
          if (hd) ottavas[si].push({ x0: hd.cx - sp * 0.8, x1: hd.cx + sp * 0.6, shift: above ? 1 : -1 });
        }
        continue;
      }
      // (the hook down, or up below the staff, where the line ends)
      const hk = comps.find((q) => q.x0 >= end - sp * 0.3 && q.x0 < end + sp * 1.0 && q.w <= sp * 0.4 && q.h >= sp * 0.4 && q.h <= sp * 2.2 && (above ? Math.abs(q.y0 - yLine) < sp * 0.4 : Math.abs(q.y1 - yLine) < sp * 0.4));
      if (hk) { hook = true; end = hk.x1; }
      else { const hx = hookAt(end, yLine, above, sp); if (hx >= 0) { hook = true; end = hx; } }
      // (a line to the end of the staff goes on into the next one)
      if (end > s.x1 - sp * 1.5) end = s.x1 + sp;
      if (dbg) dbg.push({ si, ott: [g.x0, end], n, hook, above });
      ottavas[si].push({ x0: g.x0 - sp * 0.3, x1: end, shift: above ? 1 : -1 });
    }
    // (a line carried on from the line before: dashes from the start of the staff, with no figure, to
    // the hook where it stops)
    if (globalThis.__ottCont ?? 1) for (const side of [1, -1]) {
      const x0 = (s.startX ?? s.x0) - sp * 1;
      const ds = comps.filter((q) => q.h <= sp * 0.4 && q.w <= sp * 2.4 && q.w >= 2 && q.x0 > x0 - sp * 6 && q.x0 < s.x1 && (side > 0 ? q.y1 < s.top - sp * 1.0 && q.y0 > s.top - sp * 10 : q.y0 > s.bottom + sp * 1.0 && q.y1 < s.bottom + sp * 10)).sort((a, b) => a.x0 - b.x0);
      let best = null;
      for (const f of ds) {
        if (f.x0 > x0 + sp * 3) break;
        const yL = (f.y0 + f.y1) / 2; let n = 1, x = f.x1, gaps = [];
        for (const q of ds) { if (q.x0 <= f.x0) continue; const qy = (q.y0 + q.y1) / 2; if (Math.abs(qy - yL) > sp * 0.3) continue; if (q.x0 - x > (n >= 3 ? sp * 4.5 : sp * 2.2)) break; gaps.push(q.x0 - x); n++; x = q.x1; }
        if (n >= 4 && (!best || n > best.n)) best = { n, x1: x, yL, x0: f.x0 };
      }
      if (!best) continue;
      const hk = comps.find((q) => q.x0 >= best.x1 - sp * 0.3 && q.x0 < best.x1 + sp * 1.0 && q.w <= sp * 0.4 && q.h >= sp * 0.4 && q.h <= sp * 2.2 && (side > 0 ? Math.abs(q.y0 - best.yL) < sp * 0.4 : Math.abs(q.y1 - best.yL) < sp * 0.4));
      const hx = hk ? hk.x1 : hookAt(best.x1, best.yL, side > 0, sp);
      if (dbg) dbg.push({ si, cont: side, best, hook: hx });
      if (hx < 0) continue;
      // (it is this staff's: no other staff nearer it)
      const dist = (o) => Math.min(Math.abs(best.yL - o.top), Math.abs(best.yL - o.bottom));
      if (read.some((o) => o !== s && o.x1 > best.x0 && o.x0 < best.x1 && dist(o) < dist(s))) continue;
      if (!ottavas[si].some((o) => o.x0 < best.x1 && o.x1 > best.x0)) ottavas[si].push({ x0: s.x0 - sp, x1: hx, shift: side });
    }
  });
}
