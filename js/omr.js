// Reading printed music from a picture (optical music recognition).
//
// The picture is first brought to a standard size (a staff space of about 20 pixels) and its
// light evened out. Staff lines are followed across the page in strips, so slightly tilted,
// bent or keystoned photos still line up, then taken away. Note heads are found by their shape
// (an oval about one staff space high, whatever the music font), hollow heads by the hole in
// their middle. Stems, beams, flags and dots give the rhythm. Clefs, key signatures, time
// signatures, accidentals and rests are compared with the same symbols drawn in several music
// fonts (js/omr-shapes.js), and with where they sit on the staff. Finally each bar's rhythm is
// checked against the time signature and small misreadings are mended.
//
// Pitches come out as staff positions (0 = bottom line, 8 = top line); the caller applies the
// clef and key that were found (or chosen).

import { SHAPES } from './omr-shapes.js';
import { MARKS } from './omr-marks-shapes.js';
// rests from more fonts (old engravings have rests of many shapes)
for (const k of ['r4', 'r8', 'r16', 'r32']) SHAPES[k] = [...(SHAPES[k] || []), ...(MARKS[k] || [])];
// and clefs, accidentals, time digits and rests in handwritten (jazz) and other fonts
import { SHAPES2 } from './omr-shapes2.js';
// (accidentals stay with the printed fonts: the handwritten ones' flats and naturals look too alike)
for (const [k, v] of Object.entries(SHAPES2)) if (!['sharp', 'flat', 'natural', 'dflat', 'dsharp'].includes(k)) SHAPES[k] = [...(SHAPES[k] || []), ...v];
// and LilyPond's own shapes (Emmentaler: Mutopia, and many printed editions), accidentals too
import { SHAPES3 } from './omr-shapes3.js';
for (const [k, v] of Object.entries(SHAPES3)) if (!globalThis.__noShapes3) SHAPES[k] = [...(SHAPES[k] || []), ...v];

const SP = 20;                  // working size of a staff space, in pixels
const GW = 12, GH = 20;         // shape grid
import { markTemplates, readMarks } from './omr-marks.js';
export const WHOLE = 1920;

// ---------- picture ----------
function grayAt(src, f) {
  const w = Math.max(1, Math.round(src.width * f)), h = Math.max(1, Math.round(src.height * f));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const a = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < a.length; i++, j += 4) a[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  return { g: a, w, h, canvas: c };
}
// Even out the light: divide by the paper's brightness, estimated in blocks larger than any symbol.
function flatten({ g, w, h }, block) {
  const B = Math.max(16, Math.round(block));
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const m = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    // a high percentile of the block, so a little noise does not decide it
    const hist = new Uint16Array(256); let n = 0;
    for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2) for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) { hist[g[y * w + x]]++; n++; }
    let k = 255, acc = 0; const want = n * 0.06; while (k > 0 && acc + hist[k] < want) acc += hist[k--];
    m[by * bw + bx] = k;
  }
  // spread the brightest neighbours, then smooth
  const m2 = new Float32Array(m.length);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let v = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = by + dy, xx = bx + dx; if (yy >= 0 && xx >= 0 && yy < bh && xx < bw) v = Math.max(v, m[yy * bw + xx]); }
    m2[by * bw + bx] = v;
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? m : m2, dst = pass ? m2 : m;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = by + dy, xx = bx + dx; if (yy >= 0 && xx >= 0 && yy < bh && xx < bw) { s += src[yy * bw + xx]; c++; } }
      dst[by * bw + bx] = s / c;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, y / B - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1.001, Math.max(0, x / B - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
      const y1 = Math.min(bh - 1, y0 + 1), x1 = Math.min(bw - 1, x0 + 1);
      const bg = (m2[y0 * bw + x0] * (1 - tx) + m2[y0 * bw + x1] * tx) * (1 - ty) + (m2[y1 * bw + x0] * (1 - tx) + m2[y1 * bw + x1] * tx) * ty;
      out[y * w + x] = Math.min(255, (g[y * w + x] * 255) / Math.max(30, bg));
    }
  }
  return out;
}
// an unsharp mask: the picture plus k times its difference from a blurred copy (two box blurs of
// radius r), so soft edges (a photo a little out of focus) come back to a clear step
function sharpen(v, w, h, r, k) {
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < v.length; i++) a[i] = v[i];
  const pass = (src, dst, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let j = 0; j < m; j++) {
      let s = 0, c = 0; const at = (t) => (horiz ? j * w + t : t * w + j);
      for (let t = 0; t <= Math.min(r, n - 1); t++) { s += src[at(t)]; c++; }
      for (let t = 0; t < n; t++) {
        dst[at(t)] = s / c;
        if (t + r + 1 < n) { s += src[at(t + r + 1)]; c++; }
        if (t - r >= 0) { s -= src[at(t - r)]; c--; }
      }
    }
  };
  pass(a, b, true); pass(b, a, false); pass(a, b, true); pass(b, a, false);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(v[i] + k * (v[i] - a[i]))));
  return out;
}
function otsu(g) {
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i += 3) hist[g[i]]++;
  let sum = 0, total = 0; for (let i = 0; i < 256; i++) { sum += i * hist[i]; total += hist[i]; }
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = t; }
  }
  return th;
}
function binarize(norm, w, h, smooth) {
  let v = norm;
  if (smooth) {
    // a light 3×3 average takes the edge off grain and jpeg blocks
    v = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += norm[yy * w + xx]; c++; } }
      v[y * w + x] = s / c;
    }
  }
  // halfway between the ink and the paper (Otsu leans toward the paper when edges are soft,
  // which closes up the holes of half notes)
  const hist = new Uint32Array(256); for (let i = 0; i < v.length; i += 3) hist[v[i]]++;
  let total = 0; for (const q of hist) total += q;
  let ink = 0, acc = 0; const want = total * 0.008; while (ink < 255 && acc + hist[ink] < want) acc += hist[ink++];
  let th = Math.max(95, Math.min(215, otsu(v)));
  if (lightBin) th = Math.round(th + (250 - th) * 0.55);
  const th2 = Math.max(80, Math.min(th, Math.round((ink + 245) / 2)));
  // a grey halo round the ink (a dark scan, a copy of a copy): most of the grey stands apart from
  // the dark ink, and with the threshold halfway to the paper the strokes swell into each other
  // (beams into one, heads into stems): the threshold nearer the ink
  const haloK = globalThis.__haloK ?? 1;
  if (haloK < 1) {
    let far = 0, grey = 0;
    for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) { const i = y * w + x, q = v[i]; if (q <= th2 || q >= 235) continue; grey++; let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (v[i + dy * w + dx] <= th2) { near = true; break; } if (!near) far++; }
    if (grey > 500 && far / grey > (globalThis.__haloF ?? 0.6)) th = Math.round(th2 + (th - th2) * haloK);
  }
  const b = new Uint8Array(w * h);
  for (let i = 0; i < b.length; i++) b[i] = v[i] < th ? 1 : 0;
  // a grey halo round the ink (a scan made darker, a copy of a copy): the halo is lighter than the
  // ink and wide; the ink is what is dark, with at most a pixel of its soft edge
  const core = globalThis.__core ?? 0;
  if (core) {
    const t2 = Math.round((th2 + th) / 2), keep = new Uint8Array(w * h);
    for (let i = 0; i < b.length; i++) if (v[i] < t2) keep[i] = 1;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!b[i] || keep[i]) continue; if (!(keep[i - 1] || keep[i + 1] || keep[i - w] || keep[i + w])) b[i] = 0; }
  }
  // a thin stroke a little lighter than the threshold (a stem in a faded or tinted part of the page,
  // which never reaches full black): its middle, clearly darker than the paper on both sides of it
  const ridge = globalThis.__ridge ?? 0;
  if (ridge) {
    const hi = th + (250 - th) * 0.5, dk = 22;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, q = v[i]; if (b[i] || q >= hi) continue;
      if ((q < v[i - 2] - dk && q < v[i + 2] - dk && q <= v[i - 1] && q <= v[i + 1]) || (q < v[i - 2 * w] - dk && q < v[i + 2 * w] - dk && q <= v[i - w] && q <= v[i + w])) b[i] = 2;
    }
    for (let i = 0; i < b.length; i++) if (b[i] === 2) b[i] = 1;
  }
  b.th = th; b.th2 = th2; b.gray = v;
  return b;
}
// The distance from one staff line to the next, and the thickness of a line, from the lengths of
// the black and white runs down the columns (staff lines are the most common thing in music).
function staffMetrics(b, w, h) {
  const pair = new Uint32Array(400), blk = new Uint32Array(80);
  const step = Math.max(1, Math.floor(w / 600));
  for (let x = 0; x < w; x += step) {
    let y = 0, lastBlack = -1;
    while (y < h) {
      const v = b[y * w + x]; let e = y; while (e < h && b[e * w + x] === v) e++;
      const L = e - y;
      if (v) { if (L < 80) blk[L]++; lastBlack = L; }
      else if (lastBlack > 0 && y > 0 && e < h) { const s = lastBlack + L; if (s < 400) pair[s]++; }
      y = e;
    }
  }
  let T = 1; for (let i = 1; i < 80; i++) if (blk[i] > blk[T]) T = i;
  let S = 4; for (let i = 4; i < 400; i++) if (pair[i] > pair[S]) S = i;
  // smooth the peak a little
  const near = (i) => (pair[i - 1] || 0) + pair[i] + (pair[i + 1] || 0);
  let best = S; for (let i = Math.max(4, S - 2); i <= Math.min(398, S + 2); i++) if (near(i) > near(best)) best = i;
  // a second, smaller staff size (a cue staff: the solo part above a piano part)
  let sp2 = 0;
  {
    let b2 = 0;
    for (let i = Math.max(5, Math.round(best * 0.5)); i <= Math.round(best * 0.82); i++) if (!b2 || near(i) > near(b2)) b2 = i;
    if (b2 && near(b2) > near(best) * 0.12 && near(b2) > near(b2 - 3) * 1.3 && near(b2) > near(b2 + 3) * 1.3) sp2 = b2;
  }
  return { sp: best, T, votes: pair[best], sp2 };
}
// Small skews: the angle that makes the dark pixels stack up into the sharpest rows.
function skewOf(b, w, h) {
  const pts = [];
  const step = Math.max(2, Math.round(Math.sqrt((w * h) / 400000)));
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += step) if (b[y * w + x]) pts.push(x, y);
  const score = (a) => {
    const t = Math.tan((a * Math.PI) / 180);
    const off = Math.abs(t) * w + 2;
    const H = new Float32Array(Math.ceil(h + 2 * off));
    for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] - pts[i] * t + off); if (yy >= 0 && yy < H.length) H[yy]++; }
    let v = 0; for (const q of H) v += q * q; return v;
  };
  let best = 0, bestV = -1;
  for (let a = -6; a <= 6.001; a += 0.25) { const v = score(a); if (v > bestV) { bestV = v; best = a; } }
  let fine = best;
  for (let a = best - 0.25; a <= best + 0.25; a += 0.05) { const v = score(a); if (v > bestV) { bestV = v; fine = a; } }
  return fine;
}
function rotateCanvas(src, deg) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate((-deg * Math.PI) / 180); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// ---------- staves, followed across the page ----------
function findStaves(b, w, h, sp, T, gaps = false) {
  const SW = Math.max(40, Math.round(sp * 6));
  const groups = [];
  for (let xs = 0; xs + SW * 0.5 < w; xs += Math.round(SW / 2)) {
    const xe = Math.min(w, xs + SW), n = xe - xs;
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) { let c = 0; const row = y * w; for (let x = xs; x < xe; x++) c += b[row + x]; prof[y] = c / n; }
    const lines = [], strength = [], thick = [];
    for (let y = 0; y < h; y++) {
      if (prof[y] < 0.45) continue;
      let e = y; while (e + 1 < h && prof[e + 1] >= 0.45) e++;
      if (e - y + 1 <= Math.max(3, T * 2.6)) {
        // centre weighted by darkness
        let s = 0, sw = 0, pk = 0; for (let k = y; k <= e; k++) { s += k * prof[k]; sw += prof[k]; pk = Math.max(pk, prof[k]); }
        lines.push(s / sw); strength.push(pk);
      } else if ((globalThis.__thickLine ?? 1) && e - y + 1 <= sp * 0.9) {
        // (a beam lying along a line makes it look thick: the line is at one edge or the other;
        // looked at only for a staff not found without them)
        thick.push(y + T / 2, e - T / 2);
      }
      y = e;
    }
    const chainsIn = (lines, strength, weak = false) => {
      // chains of five lines, evenly spaced about one staff space apart; where a ledger line makes
      // six, the five strongest win
      const chains = [];
      for (let i = 0; i < lines.length; i++) {
        const chain = [i];
        let gap = null;
        for (let j = i + 1; j < lines.length && chain.length < 5; j++) {
          const d = lines[j] - lines[chain[chain.length - 1]];
          if (d < sp * 0.7) continue;
          if (d > sp * 1.35) break;
          if (gap === null || Math.abs(d - gap) < sp * 0.22) { chain.push(j); gap = gap === null ? d : (gap + d) / 2; }
        }
        if (chain.length === 5) chains.push({ chain, score: chain.reduce((a, k) => a + strength[k], 0) });
      }
      chains.sort((a, b2) => b2.score - a.score);
      const used = new Set();
      for (const c of chains) {
        if (c.chain.some((k) => used.has(k))) continue;
        const y0 = lines[c.chain[0]], y4 = lines[c.chain[4]];
        if (groups.some((g2) => g2.xs === xs && g2.ys[4] > y0 - sp * 0.5 && g2.ys[0] < y4 + sp * 0.5)) continue;
        c.chain.forEach((k) => used.add(k));
        groups.push({ xc: xs + n / 2, xs, ys: c.chain.map((k) => lines[k]), score: c.score, weak });
      }
    };
    chainsIn(lines, strength);
    if (thick.length) {
      const all = [...lines.map((y, k) => [y, strength[k]]), ...thick.map((y) => [y, 0.45])].sort((a, b2) => a[0] - b2[0]);
      chainsIn(all.map((q) => q[0]), all.map((q) => q[1]), true);
    }
  }
  // link the pieces strip by strip (the staves found with the usual lines first; the pieces that
  // needed the thick lines make staves only where none of those is)
  groups.sort((a, b2) => a.xc - b2.xc);
  const tracksOf = (list) => {
    const tracks = [];
    for (const gr of list) {
      const mid = (gr.ys[0] + gr.ys[4]) / 2;
      let best = null, bd = Infinity;
      for (const t of tracks) {
        const last = t[t.length - 1];
        if (gr.xc - last.xc > SW * (globalThis.__trackGap ?? 4) || last.xc === gr.xc) continue;
        let pred = (last.ys[0] + last.ys[4]) / 2;
        if (t.length > 1) { const p2 = t[t.length - 2]; const slope = (pred - (p2.ys[0] + p2.ys[4]) / 2) / (last.xc - p2.xc); if (Math.abs(slope) < 0.15) pred += slope * (gr.xc - last.xc); }
        const d = Math.abs(mid - pred);
        if (d < sp * 0.9 && d < bd) { bd = d; best = t; }
      }
      if (best) best.push(gr); else tracks.push([gr]);
    }
    return tracks;
  };
  const tracks = tracksOf(groups.filter((g2) => !g2.weak));
  if (globalThis.__fsDbg) globalThis.__fsDbg.push({ sp, SW, groups: groups.map((g2) => [Math.round(g2.xc), g2.ys.map(Math.round), +g2.score.toFixed(2), g2.weak]), tracks: tracks.map((t) => [Math.round(t[0].xc), Math.round(t[t.length - 1].xc), Math.round(t[0].ys[0]), t.length]) });
  if (groups.some((g2) => g2.weak)) for (const t of tracksOf(groups)) { if (t.some((g2) => g2.weak)) { t.mixed = true; tracks.push(t); } }
  const staves = [];
  for (const t of tracks) {
    if (t.length < 2 && w > SW * 2.5) continue;
    const span = t[t.length - 1].xc - t[0].xc;
    if (span < sp * 6 && w > sp * 20) continue;
    let st = makeStaff(t, b, w, h, T, gaps);
    if (t.mixed) st.mixed = true;
    // a staff found one line too low (its top line hidden in a beam lying along it, a ledger line
    // below taken instead): a line above all along, the 'bottom line' only in short pieces
    {
      const cov = (dy, k) => { let n = 0, tot = 0; for (let x = Math.round(st.x0); x <= Math.round(st.x1); x += 2) { const y = Math.round(st.L[k][x] + dy); tot++; let any = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < h) any |= b[yy * w + x]; } n += any; } return tot ? n / tot : 0; };
      for (let it = 0; it < 2; it++) {
        const g = st.sp, above = cov(-g, 0), bottom = cov(0, 4);
        if (!(above > 0.88 && above - bottom > 0.22)) break;
        const t2 = t.map((q) => ({ ...q, ys: [q.ys[0] - (q.ys[4] - q.ys[0]) / 4, q.ys[0], q.ys[1], q.ys[2], q.ys[3]] }));
        t.splice(0, t.length, ...t2); st = makeStaff(t, b, w, h, T, gaps);
      }
      // and one found too high: high notes all along a line (a cellist's thumb positions, a
      // violin's top) have rows of ledger lines over the staff, taken for its top lines; a line
      // below all along, the 'top line' only in short pieces
      if (globalThis.__staffDown ?? 1) for (let it = 0; it < 3; it++) {
        const g = st.sp, below = cov(g, 4), top = cov(0, 0);
        if (!(below > 0.88 && below - top > 0.22)) break;
        const t2 = t.map((q) => ({ ...q, ys: [q.ys[1], q.ys[2], q.ys[3], q.ys[4], q.ys[4] + (q.ys[4] - q.ys[0]) / 4] }));
        t.splice(0, t.length, ...t2); st = makeStaff(t, b, w, h, T, gaps);
      }
    }
    staves.push(st);
  }
  // drop a staff that overlaps a better one
  staves.sort((a, b2) => a.top - b2.top);
  if (globalThis.__fsDbg) globalThis.__fsDbg.push({ staves: staves.map((q) => [Math.round(q.top), Math.round(q.x0), Math.round(q.x1), q.samples.length, !!q.mixed]) });
  const out = [];
  const strongN = (st) => st.samples.filter((q) => !q.weak).length;
  // (two pieces of the same staff, side by side, found apart where beams lie along its lines: one staff)
  const joinable = (a, c) => {
    if (!(globalThis.__staffJoin ?? 1)) return false;
    const ov = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0), short = Math.min(a.x1 - a.x0, c.x1 - c.x0);
    if (ov > short * 0.3) return false;
    const xm = Math.round((Math.max(a.x0, c.x0) + Math.min(a.x1, c.x1)) / 2);
    // at the place between them, each one's lines where the other's are
    return [0, 4].every((k) => Math.abs(a.L[k][xm] - c.L[k][xm]) < Math.min(a.sp, c.sp) * 0.45);
  };
  for (const s of staves) {
    const l = out[out.length - 1];
    if (l && s.top < l.bottom + s.sp * 0.5 && joinable(l, s)) {
      const sam = [...l.samples, ...s.samples].sort((a, b2) => a.xc - b2.xc).filter((q, i, arr) => i === 0 || q.xc !== arr[i - 1].xc);
      const mid = (q) => (q.ys[0] + q.ys[4]) / 2, med = sam.map(mid).sort((a, b2) => a - b2)[sam.length >> 1];
      const keep = sam.filter((q) => Math.abs(mid(q) - med) < Math.min(l.sp, s.sp) * 0.5);
      if (keep.length >= 2) { const j = makeStaff(keep, b, w, h, T, gaps); if (l.mixed && s.mixed) j.mixed = true; out[out.length - 1] = j; continue; }
    }
    if (l && s.top < l.bottom + s.sp * 0.5) { if ((l.mixed && !s.mixed) || (!!l.mixed === !!s.mixed && (strongN(s) > strongN(l) || (strongN(s) === strongN(l) && s.samples.length > l.samples.length)))) out[out.length - 1] = s; continue; } out.push(s);
  }
  return out;
}
function makeStaff(samples, b, w, h, T, gaps = false) {
  // each line's height at every x: straight between samples, level beyond them
  const L = [0, 1, 2, 3, 4].map(() => new Float32Array(w));
  const xs = samples.map((q) => q.xc);
  for (let k = 0; k < 5; k++) {
    const ys = samples.map((q) => q.ys[k]);
    let j = 0;
    for (let x = 0; x < w; x++) {
      while (j + 1 < xs.length && xs[j + 1] < x) j++;
      let y;
      if (x <= xs[0]) y = ys[0];
      else if (x >= xs[xs.length - 1]) y = ys[ys.length - 1];
      else { const t = (x - xs[j]) / (xs[j + 1] - xs[j]); y = ys[j] + (ys[j + 1] - ys[j]) * t; }
      L[k][x] = y;
    }
  }
  // where the lines really start and end
  const on = (x) => { let n = 0; for (let k = 0; k < 5; k++) { const y = Math.round(L[k][x]); let any = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < h) any |= b[yy * w + x]; } n += any; } return n >= 4; };
  let x0 = Math.round(xs[0]), x1 = Math.round(xs[xs.length - 1]);
  // (a gap of a few pixels in the lines, where a symbol covers them, does not end them)
  const gapMax = gaps ? Math.max(4, Math.round(((samples[0].ys[4] - samples[0].ys[0]) / 4) * 0.8)) : 4;
  // (past the last sample the lines are followed as they drift up or down, a slanted or curved page)
  const onAt = (x, off) => { let n = 0; for (let k = 0; k < 5; k++) { const y = Math.round(L[k][x] + off); let any = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < h) any |= b[yy * w + x]; } n += any; } return n; };
  const follow = (dir) => {
    let x = dir < 0 ? x0 : x1, miss = 0, off = 0;
    while (x + dir > 0 && x + dir < w - 1 && miss < gapMax) {
      x += dir;
      let best = -1, bo = off;
      for (const d of [0, -1, 1, -2, 2]) { const n = onAt(x, off + d); if (n > best) { best = n; bo = off + d; } }
      if (best >= 4) { miss = 0; off = bo; } else miss++;
      for (let k = 0; k < 5; k++) L[k][x] += off;
    }
    return x - dir * miss;
  };
  x0 = follow(-1); x1 = follow(1);
  const sps = samples.map((q) => (q.ys[4] - q.ys[0]) / 4);
  const sp = sps.reduce((a, q) => a + q, 0) / sps.length;
  const xm = Math.round((x0 + x1) / 2);
  return { L, x0, x1, sp, thick: T, top: L[0][xm], bottom: L[4][xm], lines: [0, 1, 2, 3, 4].map((k) => L[k][xm]), samples };
}
// the height of staff position p (0 = bottom line, 2 = next line up...) at x
const yAt = (s, p, x) => { const xi = Math.max(0, Math.min(s.L[0].length - 1, Math.round(x))); const top = s.L[0][xi], bot = s.L[4][xi]; return bot - (p * (bot - top)) / 8; };
// a C clef's line, from the middle of its shape (in steps above the bottom line)
const cLine = (mid) => (mid < 1 ? 'soprano' : mid < 3 ? 'mezzo' : mid < 5 ? 'alto' : 'tenor');
const pAt = (s, y, x) => { const xi = Math.max(0, Math.min(s.L[0].length - 1, Math.round(x))); const top = s.L[0][xi], bot = s.L[4][xi]; return ((bot - y) * 8) / (bot - top); };

// Take staff lines (and ledger lines) away where nothing crosses them.
function removeLines(b, w, h, staves, T, keep = false) {
  const o = b.slice();
  const maxRun = T + 2;
  // A small piece of ink on its own, not flat like a line (a staccato dot, a fingering digit, an
  // accent): above and below the staff it is not cut where a ledger line could be. Pieces joined to
  // a head, or long thin ones (a ledger line, even broken), are.
  const small = new Map();
  const smallMark = (k0, sp) => {
    if (small.has(k0)) return small.get(k0);
    const lim = sp * 1.3, q = [k0], seen = [k0]; const mark = new Set([k0]);
    let x0 = k0 % w, x1 = x0, y0 = (k0 - x0) / w, y1 = y0, big = false;
    while (q.length) {
      const k = q.pop(), x = k % w, y = (k - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > lim || y1 - y0 > lim || seen.length > lim * lim) { big = true; break; }
      for (const d of [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1]) { const k2 = k + d; if (k2 >= 0 && k2 < b.length && b[k2] && !mark.has(k2)) { mark.add(k2); seen.push(k2); q.push(k2); } }
    }
    const res = !big && (y1 - y0 + 1) > T + 2 && (y1 - y0 + 1) >= sp * 0.25;
    for (const k of seen) small.set(k, res);
    return res;
  };
  const crowdedAt = (s, x, y, sp) => staves.some((o) => o !== s && y > yAt(o, 16, x) - sp * 2.5 && y < yAt(o, -8, x) + sp * 2.5);
  const vrun = (x, y) => { let a = y, c = y; while (a > 0 && b[(a - 1) * w + x] && y - a < maxRun + 2) a--; while (c < h - 1 && b[(c + 1) * w + x] && c - y < maxRun + 2) c++; return c - a + 1; };
  for (const s of staves) {
    const half = T / 2 + 0.7;
    for (let p = -10; p <= 18; p += 2) {
      const ledger = p < 0 || p > 8;
      const xa = Math.max(0, s.x0 - (ledger ? 0 : 2)), xb = Math.min(w - 1, s.x1 + (ledger ? 0 : 2));
      // (above and below the staff only real ledger lines go: a short flat bit of ink there, a
      // staccato dot, the stroke of a fingering digit or of an accent, is kept whole)
      // (only for reading the signs around the notes: the notes themselves are read as before)
      const keepSmall = keep && ledger && (globalThis.__ledgerRun ?? 1);
      for (let x = xa; x <= xb; x++) {
        const yc = yAt(s, p, x);
        for (let y = Math.floor(yc - half); y <= Math.ceil(yc + half); y++) {
          if (y < 0 || y >= h || !b[y * w + x]) continue;
          if (keepSmall) {
            const sp = s.sp || T * 8;
            if (smallMark(y * w + x, sp)) continue;
            // a short flat bit (a slur crossing the place, a stroke of a sign) is kept too, unless a
            // real ledger line is there beside it (the bar of a sharp by its note)
            let a = x, c = x; while (a > 0 && b[y * w + a - 1] && x - a < sp * 3.2) a--; while (c < w - 1 && b[y * w + c + 1] && c - x < sp * 3.2) c++;
            // (a ledger line is never this long: the line of a hairpin, the top of a slur)
            if ((globalThis.__longKeep ?? 1) && c - a + 1 > sp * 3 && !crowdedAt(s, x, y, sp)) continue;
            // (a ledger line always has its note on it or by it: a flat stretch with nothing thick
            // through or beside it is a slur or a hairpin passing)
            if ((globalThis.__noHeadKeep ?? 1) && (p <= -4 || p >= 12) && c - a + 1 >= sp * 0.95 && !crowdedAt(s, x, y, sp)) {
              let thick = false;
              for (let xx = a; xx <= c && !thick; xx++) { let u = y, d = y; while (u > 0 && b[(u - 1) * w + xx] && y - u < sp) u--; while (d < h - 1 && b[(d + 1) * w + xx] && d - y < sp) d++; if (d - u + 1 >= sp * 0.5) thick = true; }
              if (!thick) continue;
            }
            // (not between two staves close together, where the notes of one sit by the other's ledger lines)
            const crowded = crowdedAt(s, x, y, sp);
            if ((globalThis.__shortRun ?? 1) && !crowded && (p <= -4 || p >= 12) && c - a + 1 < sp * 0.95) {
              let ledgerNear = false;
              for (const dir of [-1, 1]) {
                let xx = dir < 0 ? a - 2 : c + 2, run = 0;
                for (let k = 0; k < sp * 1.6 && !ledgerNear; k++, xx += dir) { if (xx < 0 || xx >= w) break; if (b[y * w + xx] && vrun(xx, y) <= maxRun) { if (++run >= sp * 0.6) ledgerNear = true; } else run = 0; }
              }
              if (!ledgerNear) continue;
            }
          }
          if (vrun(x, y) <= maxRun) o[y * w + x] = 0;
        }
      }
    }
  }
  // put back the bits of line inside a symbol that crosses it (a stroke above and below), so
  // clefs, flats and slanted strokes stay in one piece
  const dark = (x, y) => x >= 0 && y >= 0 && x < w && y < h && o[y * w + x];
  const back = [];
  for (const s of staves) {
    const half = T / 2 + 0.7;
    for (let p = -10; p <= 18; p += 2) {
      for (let x = Math.max(1, s.x0 - 2); x <= Math.min(w - 2, s.x1 + 2); x++) {
        const yc = yAt(s, p, x);
        const ya = Math.floor(yc - half), yb = Math.ceil(yc + half);
        let up = false, dn = false;
        for (let k = 1; k <= 2 && !up; k++) up = dark(x, ya - k) && (dark(x - 1, ya - k) || dark(x + 1, ya - k));
        for (let k = 1; k <= 2 && !dn; k++) dn = dark(x, yb + k) && (dark(x - 1, yb + k) || dark(x + 1, yb + k));
        if (!up || !dn) continue;
        for (let y = ya; y <= yb; y++) if (y >= 0 && y < h && b[y * w + x] && !o[y * w + x]) back.push(y * w + x);
      }
    }
  }
  for (const k of back) o[k] = 1;
  if (globalThis.__omrDbg) globalThis.__omrDbg.restored = back.length;
  return o;
}

// ---------- connected shapes ----------
function label(b, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const comps = [];
  const q = new Int32Array(w * h);
  for (let i = 0; i < b.length; i++) {
    if (!b[i] || lab[i] >= 0) continue;
    const id = comps.length; let qh = 0, qt = 0; q[qt++] = i; lab[i] = id;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    while (qh < qt) {
      const k = q[qh++]; const x = k % w, y = (k - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const kk = yy * w + xx; if (b[kk] && lab[kk] < 0) { lab[kk] = id; q[qt++] = kk; } } }
    }
    comps.push({ id, x0, y0, x1, y1, n, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return { lab, comps };
}
// Pieces of one symbol that taking the lines away cut apart (or that only just touch) are put
// back together: shapes that touch, or sit one above the other across a staff line.
function groupComps(comps, sp, T) {
  const par = comps.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const order = comps.map((c, i) => i).sort((a, b) => comps[a].x0 - comps[b].x0);
  const touch = sp * 0.06, lineGap = T + 3;
  for (let a = 0; a < order.length; a++) {
    const A = comps[order[a]];
    if (A.n < 2) continue;
    for (let b = a + 1; b < order.length; b++) {
      const Bc = comps[order[b]];
      if (Bc.x0 > A.x1 + touch) break;
      const ox = Math.min(A.x1, Bc.x1) - Math.max(A.x0, Bc.x0);
      const gy = Math.max(A.y0, Bc.y0) - Math.min(A.y1, Bc.y1);
      if ((ox >= -touch && gy <= touch) || (ox >= Math.min(A.w, Bc.w) * 0.15 && gy >= 0 && gy <= lineGap)) par[find(order[a])] = find(order[b]);
    }
  }
  const groups = new Map();
  comps.forEach((c, i) => {
    const r = find(i); let g = groups.get(r);
    if (!g) { g = { ids: [], x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, n: 0 }; groups.set(r, g); }
    g.ids.push(c.id); g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1); g.n += c.n;
  });
  const out = [...groups.values()].map((g, i) => ({ ...g, id: g.ids.length === 1 ? g.ids[0] : g.ids, gi: i, w: g.x1 - g.x0 + 1, h: g.y1 - g.y0 + 1 }));
  return out;
}
// Holes: white areas closed in by ink, the size of the inside of a half or whole note.
function holeMask(b, w, h, sp) {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const push = (k) => { if (!b[k] && !seen[k]) { seen[k] = 1; q[qt++] = k; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) { const k = q[qh++]; const x = k % w, y = (k - x) / w; if (x > 0) push(k - 1); if (x < w - 1) push(k + 1); if (y > 0) push(k - w); if (y < h - 1) push(k + w); }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < b.length; i++) {
    if (b[i] || seen[i]) continue;
    qh = 0; qt = 0; seen[i] = 1; q[qt++] = i;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (qh < qt) { const k = q[qh++]; const x = k % w, y = (k - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; for (const kk of [k - 1, k + 1, k - w, k + w]) { if (kk < 0 || kk >= b.length || b[kk] || seen[kk]) continue; if (Math.abs((kk % w) - x) > 1) continue; seen[kk] = 1; q[qt++] = kk; } }
    const hw = x1 - x0 + 1, hh = y1 - y0 + 1, n = qt;
    // the inside of a hollow head: small, roundish (not the gap between two beams)
    const ok = hw <= sp * 1.05 && hh <= sp * 0.9 && hh >= Math.max(2, sp * 0.12) && hw / hh <= 3.4 && n >= 3 && n <= sp * sp * 0.75 && !(hh >= sp * 0.62 && n > hw * hh * 0.88);
    if (ok) for (let j = 0; j < qt; j++) mask[q[j]] = 1;
  }
  return mask;
}
// Opening with an upright oval: keeps only parts of the ink taller and wider than the oval (note
// heads), so stems, beams (even blurred ones), lines, slurs and most symbols fall away.
function openOval(m, w, h, rx, ry) {
  const INF = 1e9;
  const v = rx / ry, dg = Math.sqrt(1 + v * v);     // vertical steps count less: the oval becomes a circle
  const pass = (dst, inside) => {
    for (let i = 0; i < dst.length; i++) dst[i] = inside(i) ? INF : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!dst[i]) continue;
      let q = dst[i];
      q = x > 0 ? Math.min(q, dst[i - 1] + 1) : Math.min(q, 1);
      if (y > 0) { q = Math.min(q, dst[i - w] + v); if (x > 0) q = Math.min(q, dst[i - w - 1] + dg); if (x < w - 1) q = Math.min(q, dst[i - w + 1] + dg); } else q = Math.min(q, v);
      dst[i] = q;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!dst[i]) continue;
      let q = dst[i];
      q = x < w - 1 ? Math.min(q, dst[i + 1] + 1) : Math.min(q, 1);
      if (y < h - 1) { q = Math.min(q, dst[i + w] + v); if (x < w - 1) q = Math.min(q, dst[i + w + 1] + dg); if (x > 0) q = Math.min(q, dst[i + w - 1] + dg); } else q = Math.min(q, v);
      dst[i] = q;
    }
  };
  const d = new Float32Array(w * h);
  pass(d, (i) => m[i]);
  const core = new Uint8Array(w * h); for (let i = 0; i < d.length; i++) core[i] = d[i] > rx ? 1 : 0;
  const d2 = new Float32Array(w * h);
  pass(d2, (i) => !core[i]);
  const o = new Uint8Array(w * h); for (let i = 0; i < d2.length; i++) o[i] = m[i] && d2[i] <= rx + 0.5 ? 1 : 0;
  return o;
}

// ---------- shapes compared with the font library ----------
export function shapeOf(b, w, x0, y0, x1, y1, sp, labArr, id) {
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const grid = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const ax = x0 + (gx * cw) / GW, bx = x0 + ((gx + 1) * cw) / GW, ay = y0 + (gy * ch) / GH, by = y0 + ((gy + 1) * ch) / GH;
    let s = 0, n = 0;
    for (let y = Math.floor(ay); y < Math.max(Math.floor(ay) + 1, Math.ceil(by)); y++) for (let x = Math.floor(ax); x < Math.max(Math.floor(ax) + 1, Math.ceil(bx)); x++) {
      n++; const k = y * w + x; if (b[k] && (!labArr || id === undefined || (Array.isArray(id) ? id.includes(labArr[k]) : labArr[k] === id))) s++;
    }
    grid[gy * GW + gx] = Math.round((255 * s) / Math.max(1, n));
  }
  let bin = ''; for (const v of grid) bin += String.fromCharCode(v);
  return { m: btoa(bin), ws: cw / sp, hs: ch / sp };
}
const decoded = new Map();
function gridOf(s) { if (!decoded.has(s.m)) { const t = atob(s.m); const a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); decoded.set(s.m, a); } return decoded.get(s.m); }
function classify(shape, classes) {
  const g = gridOf(shape);
  let best = null;
  for (const cls of classes) {
    for (const ref of SHAPES[cls] || []) {
      const r = gridOf(ref);
      let d = 0; for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - r[i]);
      d /= g.length * 255;
      d += 0.45 * Math.abs(Math.log((shape.ws / shape.hs) / (ref.ws / ref.hs))) + 0.35 * Math.abs(shape.hs - ref.hs) / Math.max(shape.hs, ref.hs);
      if (!best || d < best.d) best = { cls, d };
    }
  }
  return best || { cls: null, d: 9 };
}

// The same comparison made tolerant of the thickness of the strokes and of small shifts (digits
// written by hand, or in a font unlike any in the library): the ink of each shape is compared with
// how far it lies from the ink of the other (both ways), on the same grid.
const dtCache = new Map();
function inkOf(g) { const pts = []; for (let i = 0; i < g.length; i++) if (g[i] > 100) pts.push(i % GW, (i / GW) | 0); return pts; }
function distField(g) {
  const pts = inkOf(g), d = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let m = 99; for (let i = 0; i < pts.length; i += 2) { const dx = (pts[i] - x) * 1.6, dy = pts[i + 1] - y; const q = dx * dx + dy * dy; if (q < m) m = q; }
    d[y * GW + x] = Math.sqrt(m);
  }
  return d;
}
function fieldOf(s) { let f = dtCache.get(s.m); if (!f) { const g = gridOf(s); f = { d: distField(g), ink: inkOf(g) }; dtCache.set(s.m, f); } return f; }
// How many white areas a shape closes in, inside its box (only its own ink: ids).
function holesInBox(C, w, h, bx) {
  const x0 = Math.max(0, bx.x0 - 1), y0 = Math.max(0, bx.y0 - 1), x1 = Math.min(w - 1, bx.x1 + 1), y1 = Math.min(h - 1, bx.y1 + 1);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, seen = new Uint8Array(W * H);
  const ink = (x, y) => C[(y + y0) * w + x + x0];
  const fill = (sx, sy) => { const q = [sx, sy]; seen[sy * W + sx] = 1; let n = 0; while (q.length) { const y = q.pop(), x = q.pop(); n++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || seen[yy * W + xx] || ink(xx, yy)) continue; seen[yy * W + xx] = 1; q.push(xx, yy); } } return n; };
  for (let x = 0; x < W; x++) { if (!ink(x, 0) && !seen[x]) fill(x, 0); if (!ink(x, H - 1) && !seen[(H - 1) * W + x]) fill(x, H - 1); }
  for (let y = 0; y < H; y++) { if (!ink(0, y) && !seen[y * W]) fill(0, y); if (!ink(W - 1, y) && !seen[y * W + W - 1]) fill(W - 1, y); }
  let n = 0;
  // (a sliver closed in where a stroke touches a staff line is not a hole)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!seen[y * W + x] && !ink(x, y)) { if (fill(x, y) >= Math.max(4, W * H * 0.035)) n++; }
  return n;
}
export function classifyLoose(shape, classes) {
  const A = fieldOf(shape);
  if (!A.ink.length) return [];
  const out = [];
  for (const cls of classes) {
    let best = Infinity;
    for (const ref of SHAPES[cls] || []) {
      const R = fieldOf(ref);
      if (!R.ink.length) continue;
      let a = 0; for (let i = 0; i < A.ink.length; i += 2) a += R.d[A.ink[i + 1] * GW + A.ink[i]];
      let b = 0; for (let i = 0; i < R.ink.length; i += 2) b += A.d[R.ink[i + 1] * GW + R.ink[i]];
      const d = (a / (A.ink.length / 2) + b / (R.ink.length / 2)) / 2 / 6 + 0.3 * Math.abs(Math.log((shape.ws / shape.hs) / (ref.ws / ref.hs)));
      if (d < best) best = d;
    }
    out.push({ cls, d: best });
  }
  return out.sort((x, y) => x.d - y.d);
}

// ---------- one staff ----------
function readStaff(s, ctx, header) {
  const { B, C, F, O, holes, w, h, compsC, labC, T } = ctx;
  const sp = s.sp;
  const TR = globalThis.__headTrack, trk = (stage, list) => { if (TR) TR.log.push([stage, list.filter((q) => Math.abs(q.cx - TR.x) < sp * 0.8).map((q) => [Math.round(q.cx), q.p, q.wRow && +(q.wRow / sp).toFixed(2), !!q.ringHead, q.wide])]); };
  const band = (y) => y > s.top - sp * 6.5 && y < s.bottom + sp * 6.5;
  // ---- note heads: ovals left after the opening
  const rx = sp * 0.56, ry = sp * 0.4;
  const pts = [];
  for (let dy = -ry * 0.85; dy <= ry * 0.85; dy += Math.max(1, sp / 10)) for (let dx = -rx * 0.85; dx <= rx * 0.85; dx += Math.max(1, sp / 10)) if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 0.75) pts.push(Math.round(dx), Math.round(dy));
  const ring = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) { const dx = Math.cos(a) * rx * 1.05, dy = Math.sin(a) * ry * 1.45; if (Math.abs(Math.sin(a)) > 0.5) ring.push(Math.round(dx), Math.round(dy)); }
  const outside = (cx, cy) => { let n = 0; const icx = Math.round(cx), icy = Math.round(cy); for (let i = 0; i < ring.length; i += 2) { const x = icx + ring[i], y = icy + ring[i + 1]; if (x >= 0 && y >= 0 && x < w && y < h && O.img[y * w + x]) n++; } return n / (ring.length / 2); };
  const fill = (cx, cy) => { let n = 0; const icx = Math.round(cx), icy = Math.round(cy); for (let i = 0; i < pts.length; i += 2) { const x = icx + pts[i], y = icy + pts[i + 1]; if (x >= 0 && y >= 0 && x < w && y < h && O.img[y * w + x]) n++; } return n / (pts.length / 2); };
  const cands = [];
  for (const c of O.comps) {
    if (c.h < sp * 0.55 || c.w < sp * 0.7 || c.x1 < s.x0 - sp || c.x0 > s.x1 + sp) continue;
    const cyc = (c.y0 + c.y1) / 2; if (!band(cyc)) continue;
    // belongs to this staff, not the next one
    if (ctx.staffOf(cyc, (c.x0 + c.x1) / 2) !== s) continue;
    const pLo = Math.ceil(pAt(s, c.y1 - ry * 0.7, c.x0)), pHi = Math.floor(pAt(s, c.y0 + ry * 0.7, c.x0));
    for (let p = Math.max(-14, pLo - 1); p <= Math.min(22, pHi + 1); p++) {
      for (let x = c.x0 + rx * 0.7; x <= c.x1 - rx * 0.7; x += 1) {
        const cy = yAt(s, p, x);
        if (cy < c.y0 + ry * 0.6 || cy > c.y1 - ry * 0.6) continue;
        const f = fill(x, cy);
        if (f >= 0.86) cands.push({ cx: x, cy, p, sc: f, fit: f - 0.35 * outside(x, cy), comp: c });
      }
    }
  }
  cands.sort((a, b2) => b2.fit - a.fit || b2.sc - a.sc);
  let heads = [];
  for (const c of cands) {
    if (heads.some((q) => Math.abs(q.cx - c.cx) < sp * 0.95 && Math.abs(q.p - c.p) < 2)) continue;
    heads.push(c);
  }
  if (TR && typeof heads !== 'undefined') trk(501, heads);
  // the height of a head from the middle of its ink (a slanted or handwritten head may fit a
  if (TR && typeof heads !== 'undefined') trk(502, heads);
  // place above or below about as well): only for a head standing alone (not a chord)
  for (const hd of heads) {
    if (!hd.comp || heads.some((q) => q !== hd && q.comp === hd.comp && Math.abs(q.cy - hd.cy) < sp * 1.6)) continue;
    let sy = 0, n = 0;
    const xa = Math.round(hd.cx - rx * 0.8), xb = Math.round(hd.cx + rx * 0.8), ya = Math.round(hd.cy - sp * 0.95), yb = Math.round(hd.cy + sp * 0.95);
    for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) if (O.img[y * w + x] && O.lab[y * w + x] === hd.comp.id) { sy += y; n++; }
    if (n < sp * sp * 0.25) continue;
    const p2 = Math.round(pAt(s, sy / n, hd.cx));
    if (Math.abs(p2 - hd.p) === 1) { hd.p = p2; hd.cy = yAt(s, p2, hd.cx); }
  }
  if (TR && typeof heads !== 'undefined') trk(512, heads);
  // hollow heads read from the grey picture: a dark oval ring around a light middle. This finds
  if (TR && typeof heads !== 'undefined') trk(513, heads);
  // half and whole notes whose hole closed up when the picture was blurred or enlarged
  {
    const G = B.gray, th = B.th;
    // two sizes: a half note's head, and the wider whole note (its sides are further out)
    for (const kx of [1, 1.45]) {
    const rxK = rx * kx;
    const ringPts = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) ringPts.push(Math.cos(a) * rxK * 0.86, Math.sin(a) * ry * (kx > 1 ? 1.2 : 0.95));
    const dark = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && G[yi * w + xi] < th + 12; };
    // the middle, just above and below the centre row (a staff line may run through the centre)
    const lightAt = (x, y) => { let sum = 0, n = 0; for (const dy of [-1, 1]) for (let dx = -2; dx <= 2; dx++) { const xi = Math.round(x + dx * rxK * 0.12), yi = Math.round(y + dy * Math.max(ry * 0.38, T * 0.5 + 1.5)); if (xi >= 0 && yi >= 0 && xi < w && yi < h) { sum += G[yi * w + xi]; n++; } } return n ? sum / n : 0; };
    const ring = [];
    for (let p = -8; p <= 16; p++) {
      for (let x = Math.round(s.x0 + sp); x <= Math.round(s.x1 - sp * 0.5); x++) {
        const cy = yAt(s, p, x);
        if (!dark(x - rxK * 0.86, cy) || !dark(x + rxK * 0.86, cy)) continue;
        // not the space between two stems or barlines (they run on above and below)
        const runs = (xx) => dark(xx, cy - sp * 1.3) && dark(xx, cy + sp * 1.3);
        if (runs(x - rxK * 0.86) || runs(x + rxK * 0.86)) continue;
        // nor the middle of a sharp: strokes go on above and below it on both sides
        const inkC = (xx, yy) => { const xi = Math.round(xx), yi = Math.round(yy); if (xi < 1 || yi < 0 || xi >= w - 1 || yi >= h) return false; return !!(C[yi * w + xi] || C[yi * w + xi - 1] || C[yi * w + xi + 1]); };
        const tallSide = (xx) => inkC(xx, cy - sp * 0.75) && inkC(xx, cy + sp * 0.75);
        const tallNear = (dir) => { for (let k = 0.25; k <= 1.0; k += 0.125) if (tallSide(x + dir * rxK * k)) return true; return false; };
        if (tallNear(-1) && tallNear(1)) continue;
        const vlen = (xx) => { const xi = Math.round(xx); let u = Math.round(cy), d = u; while (u > 0 && (C[(u - 1) * w + xi] || C[(u - 1) * w + xi + 1] || C[(u - 1) * w + xi - 1])) u--; while (d < h - 1 && (C[(d + 1) * w + xi] || C[(d + 1) * w + xi + 1] || C[(d + 1) * w + xi - 1])) d++; return d - u; };
        if (vlen(x - rxK * 0.86) > sp * 1.7 && vlen(x + rxK * 0.86) > sp * 1.7) continue;
        const mid = lightAt(x, cy); if (mid < th + 28) continue;
        let n = 0; for (let i = 0; i < ringPts.length; i += 2) if (dark(x + ringPts[i], cy + ringPts[i + 1])) n++;
        const f = n / (ringPts.length / 2);
        if (f >= 0.72) ring.push({ cx: x, cy, p, sc: f + (mid - th) / 600, fit: f, comp: null, ringHead: true, wide: kx > 1 });
      }
    }
    ring.sort((a, b2) => b2.sc - a.sc);
    // centre each ring on its hole (without the staff lines, which may cross it)
    for (const c of ring) {
      const x = Math.round(c.cx); let u = Math.round(c.cy), d = u;
      while (u > c.cy - sp && !C[(u - 1) * w + x]) u--;
      while (d < c.cy + sp && !C[(d + 1) * w + x]) d++;
      if (u > c.cy - sp && d < c.cy + sp) { const p2 = Math.round(pAt(s, (u + d) / 2, x)); if (p2 !== c.p) { c.p = p2; c.cy = yAt(s, p2, x); } }
    }
    for (const c of ring) {
      if (heads.some((q) => Math.abs(q.cx - c.cx) < sp * (c.wide || q.wide ? 1.3 : 0.95) && Math.abs(q.p - c.p) < 2)) continue;
      heads.push(c);
    }
    }
  }
  if (TR && typeof heads !== 'undefined') trk(553, heads);
  // hollow heads drawn with a thin, slanted outline (old engravings): their hole is still a closed
  // white oval. Each such hole that no head was found at becomes a hollow head
  if (ctx.holeComps) {
    // (a hollow head on a ledger line has its hole cut in two by the line: the halves together)
    const hcs = ctx.holeComps.filter((c) => c.w >= sp * 0.3 && c.w <= sp * 1.25 && c.h <= sp * 0.5);
    const halves = [];
    for (const a of hcs) for (const b of hcs) {
      if (a === b || b.y0 - a.y1 < 1 || b.y0 - a.y1 > T + 2) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (ox < Math.min(a.w, b.w) * 0.5) continue;
      const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = a.y0, y1 = b.y1;
      halves.push({ x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n: a.n + b.n });
    }
    for (const c of [...ctx.holeComps, ...halves]) {
      if (c.w < sp * 0.35 || c.w > sp * 1.25 || c.h < sp * 0.12 || c.h > sp * 0.75 || c.n < 6) continue;
      const cx = (c.x0 + c.x1) / 2, cy0 = (c.y0 + c.y1) / 2;
      if (cx < s.x0 + sp || cx > s.x1 || ctx.staffOf(cy0, cx) !== s || !band(cy0)) continue;
      const p = Math.round(pAt(s, cy0, cx));
      if (p < -8 || p > 16) continue;
      if (heads.some((q) => Math.abs(q.cx - cx) < sp * 0.9 && Math.abs(q.p - p) < 2)) continue;
      // ink all round it, not far out (the ring of a head, not the inside of a letter or a clef)
      let ring = 0, n = 0;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        n++;
        let hit = false;
        for (let r = 1; r <= Math.max(3, sp * 0.35) && !hit; r++) { const x = Math.round(cx + Math.cos(a) * (c.w / 2 + r)), y = Math.round(cy0 + Math.sin(a) * (c.h / 2 + r)); if (x >= 0 && y >= 0 && x < w && y < h && B[y * w + x]) hit = true; }
        if (hit) ring++;
      }
      if (ring < n * 0.9) continue;
      // the outside of the ring: about a head's size (not a big shape with a hole, like a clef or a 0)
      const id = labC[Math.round(cy0) * w + Math.round(c.x0 - 2)] >= 0 ? labC[Math.round(cy0) * w + Math.round(c.x0 - 2)] : labC[Math.round(cy0 - c.h / 2 - 2) * w + Math.round(cx)];
      const grp = id >= 0 ? compsC[ctx.groupOf[id]] : null;
      if (grp && grp.h > sp * 1.6 && grp.w > sp * 1.9) continue;
      heads.push({ cx, cy: yAt(s, p, cx), p, sc: 0.9, fit: 0.9, comp: null, ringHead: true, holeHead: true });
    }
  }
  // hollow heads found from their stems: a stem with no head at either end, but a ring of ink
  // (however thin or broken) where its head should be: a half note in a fine old engraving
  {
    const G = B.gray, th = B.th;
    const dk = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && G[yi * w + xi] < th + 40; };
    const colsDone = new Set();
    for (let x = Math.round(s.x0 + sp * 3); x < Math.round(s.x1 - sp * 0.5); x++) {
      // a thin vertical stroke of 2.5 spaces or more crossing the staff band
      for (const y0 of [yAt(s, 6, x), yAt(s, 2, x)]) {
        const yi = Math.round(y0); if (!C[yi * w + x] || colsDone.has(x)) continue;
        let a = yi, z = yi; while (a > 0 && (C[(a - 1) * w + x] || C[(a - 1) * w + x - 1] || C[(a - 1) * w + x + 1])) a--; while (z < h - 1 && (C[(z + 1) * w + x] || C[(z + 1) * w + x - 1] || C[(z + 1) * w + x + 1])) z++;
        if (z - a < sp * 2.5 || z - a > sp * 4.8) continue;
        let wd = 0; { const ym = Math.round((a + z) / 2); let l = x, r = x; while (l > 0 && C[ym * w + l - 1]) l--; while (r < w - 1 && C[ym * w + r + 1]) r++; wd = r - l + 1; }
        if (wd > sp * 0.3) continue;
        colsDone.add(x); colsDone.add(x + 1); colsDone.add(x - 1);
        // already a note's stem
        if (heads.some((hd) => Math.abs(hd.cx - x) < sp * 1.3 && hd.cy > a - sp * 0.8 && hd.cy < z + sp * 0.8)) continue;
        // a barline runs the whole staff from line to line, a stem ends at its head
        const tryHead = (cx, cy) => {
          const p = Math.round(pAt(s, cy, cx)); const cyy = yAt(s, p, cx);
          let n = 0, tot = 0;
          for (let t = 0; t < Math.PI * 2; t += Math.PI / 10) { tot++; if (dk(cx + Math.cos(t) * rx * 0.9, cyy + Math.sin(t) * ry * 1.05) || dk(cx + Math.cos(t) * rx * 0.7, cyy + Math.sin(t) * ry * 0.85)) n++; }
          let light = 0, lt = 0; for (let dx = -0.25; dx <= 0.25; dx += 0.125) { lt++; if (!dk(cx + dx * rx, cyy)) light++; }
          return n / tot >= 0.75 && light / lt >= 0.8 ? { cx, cy: cyy, p } : null;
        };
        // a half note's stem ends free: no beam or flag at its other end
        const freeEnd = (yy, dir) => { for (let k = 0; k <= sp * 1.0; k++) { const y = Math.round(yy + dir * k); if (y < 0 || y >= h) continue; let run = 0; for (const sd of [-1, 1]) for (let q = 2; q <= sp * 0.9; q++) { const xx = x + sd * q; if (xx >= 0 && xx < w && C[y * w + xx]) run++; else break; } if (run >= sp * 0.45) return false; } return true; };
        const up = tryHead(x + rx * 0.95, a), dn = tryHead(x - rx * 0.95, z);
        const hd2 = (up && freeEnd(z, -1)) ? up : (dn && freeEnd(a, 1)) ? dn : null;
        if (!hd2 || heads.some((q) => Math.abs(q.cx - hd2.cx) < sp * 0.9 && Math.abs(q.p - hd2.p) < 2)) continue;
        heads.push({ ...hd2, sc: 0.8, fit: 0.8, comp: null, ringHead: true, fromStem: true });
      }
    }
  }
  // how wide is each head (whole notes are wider)
  for (const hd of heads) {
    if (hd.fromStem) { hd.wRow = Math.round(rx * 2.1); hd.left = Math.round(hd.cx - rx * 1.05); hd.right = Math.round(hd.cx + rx * 1.05); continue; }
    if (hd.ringHead) {
      // out from the light middle, across the ring, to the paper; measured just above and below
      // the centre, because on a line the centre row is the staff line itself and never ends
      let best = null;
      for (const dy of [-0.2, 0.2]) {
        const y = Math.round(hd.cy + dy * sp); if (y < 0 || y >= h) continue;
        let a = Math.round(hd.cx), z = a;
        while (a > 0 && !B[y * w + a]) a--; while (a > 0 && B[y * w + a - 1]) a--;
        while (z < w - 1 && !B[y * w + z]) z++; while (z < w - 1 && B[y * w + z + 1]) z++;
        // the wider of the two rows (on a line a row may run on along it: then the narrower)
        if (z - a > sp * 2.4) continue;
        if (!best || z - a > best[1] - best[0]) best = [a, z];
      }
      if (!best) { const y = Math.round(hd.cy); best = [Math.round(hd.cx - rx), Math.round(hd.cx + rx)]; }
      hd.wRow = best[1] - best[0] + 1; hd.left = best[0]; hd.right = best[1]; continue;
    }
    let y = Math.round(hd.cy), a = Math.round(hd.cx), z = a;
    while (a > 0 && O.img[y * w + a - 1]) a--; while (z < w - 1 && O.img[y * w + z + 1]) z++;
    // (the row through the staff position may cross the head off its middle: a narrow cut. The
    // rows a little above and below too)
    if (z - a + 1 < sp * 1.05) for (const dy of [-0.2, 0.2]) {
      const y2 = Math.round(hd.cy + dy * sp); let a2 = Math.round(hd.cx), z2 = a2; if (y2 < 0 || y2 >= h || !O.img[y2 * w + a2]) continue;
      while (a2 > 0 && O.img[y2 * w + a2 - 1]) a2--; while (z2 < w - 1 && O.img[y2 * w + z2 + 1]) z2++;
      if (z2 - a2 > z - a && z2 - a2 + 1 <= sp * 1.6) { a = a2; z = z2; }
    }
    hd.wRow = z - a + 1; hd.left = a; hd.right = z;
    // a curve running into the head (a tie, a slur) pulls the middle found from its shape to one
    // side: the row through the head shows where it really is
    // (only when that finds the head its stem, which it missed off centre)
    if (hd.wRow >= sp * 1.0 && hd.wRow <= sp * 1.6 && Math.abs((a + z) / 2 - hd.cx) > sp * 0.15 && !stemOf(C, w, h, hd, rx, sp) && stemOf(C, w, h, { ...hd, cx: (a + z) / 2 }, rx, sp)) hd.cx = (a + z) / 2;
  }
  if (ctx.dbg) ctx.allHeads = heads.map((hd) => ({ cx: Math.round(hd.cx), p: hd.p, wRow: +(hd.wRow / sp).toFixed(2), sc: +hd.sc.toFixed(2) }));
  if (TR && typeof heads !== 'undefined') trk(576, heads);
  // a head stuck to the accidental in front of it (both read as one wide oval): keep the head end,
  if (TR && typeof heads !== 'undefined') trk(577, heads);
  // when the extra part on the left is tall like an accidental
  for (const hd of heads) {
    if (hd.wRow <= sp * 1.7) continue;
    const cx2 = hd.right - rx * 1.02;
    if (fill(cx2, hd.cy) < 0.86) continue;
    // (the right end is the next note, a step away, touching this one: nothing to trim)
    if (heads.some((q) => q !== hd && Math.abs(q.cx - cx2) < sp * 0.7 && Math.abs(q.p - hd.p) === 1 && Math.abs(q.cx - hd.cx) > sp * 1.2)) continue;
    // the tallest stroke in the extra part on the left (the stem of a flat, the uprights of a sharp)
    let tall = 0;
    for (let xl = Math.round(hd.left + sp * 0.1); xl <= Math.round(cx2 - rx * 0.9); xl += Math.max(1, Math.round(sp * 0.1))) {
      let a2 = Math.round(hd.cy), z2 = a2;
      while (a2 > 0 && (C[(a2 - 1) * w + xl] || C[(a2 - 1) * w + xl + 1])) a2--;
      while (z2 < h - 1 && (C[(z2 + 1) * w + xl] || C[(z2 + 1) * w + xl + 1])) z2++;
      tall = Math.max(tall, z2 - a2);
    }
    if (tall < sp * 1.5) continue;
    hd.cx = cx2; hd.left = Math.round(hd.right - rx * 2.04); hd.wRow = hd.right - hd.left + 1; hd.trimmed = true;
  }
  if (TR && typeof heads !== 'undefined') trk(595, heads);
  // two readings of the same head (trimmed to one place): keep one
  heads = heads.filter((hd, i) => !heads.some((q, j) => j < i && q.p === hd.p && Math.abs(q.cx - hd.cx) < sp * 0.5));
  if (TR && typeof heads !== 'undefined') trk(597, heads);
  // inside a beam: ink runs straight on well past both sides of the 'head', over several rows
  if (TR && typeof heads !== 'undefined') trk(598, heads);
  // (a note head ends; a ledger line is a single thin row)
  heads = heads.filter((hd) => {
    let k = 0;
    for (const dy of [-0.2, 0, 0.2]) {
      const y = Math.round(hd.cy + dy * sp); if (y < 0 || y >= h) continue;
      let a = Math.round(hd.cx), z = a; if (!C[y * w + a]) continue;
      while (a > 0 && C[y * w + a - 1]) a--; while (z < w - 1 && C[y * w + z + 1]) z++;
      if (hd.cx - a > sp * 1.6 && z - hd.cx > sp * 1.6) k++;
    }
    return k < 2;
  });
  if (TR && typeof heads !== 'undefined') trk(609, heads);
  // narrower than a note head: the bowl of a flat, a dot, a letter
  heads = heads.filter((hd) => hd.wRow >= sp * 1.0);
  if (TR && typeof heads !== 'undefined') trk(611, heads);
  // wider than a note head: thick or blurred beams (unless it is two heads side by side, a second)
  if (TR && typeof heads !== 'undefined') trk(612, heads);
  // hollow: a hole in the middle of the head, not one beside it (a flag curling back to the head)
  const holeAt = (hd) => {
    let inn = 0, out = 0;
    // the hole of a head stacked just above or below (a chord) is not 'beside' this one
    const others = heads.filter((q) => q !== hd && Math.abs(q.cx - hd.cx) < sp * 1.6 && Math.abs(q.cy - hd.cy) < sp * 1.6);
    // (the pieces of the head's own hole, a staff line across it, count as inside wherever they reach)
    // (only for a head on a staff line: the line splits its hole in two, above and below it)
    const onLine = ((hd.p % 2) + 2) % 2 === 0 && hd.p >= 0 && hd.p <= 8, lineY = onLine ? yAt(s, hd.p, hd.cx) : 0;
    const own = new Set(), HLab = onLine ? ctx.holeLab : null, HC = ctx.holeComps;
    if (HLab) for (let dy = -Math.round(ry); dy <= Math.round(ry); dy++) for (let dx = -Math.round(rx); dx <= Math.round(rx); dx++) {
      const x = Math.round(hd.cx) + dx, y = Math.round(hd.cy) + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const id = HLab[y * w + x]; if (id < 0 || own.has(id)) continue;
      const c = HC[id]; if (!c) continue;
      const ccx = (c.x0 + c.x1) / 2, ccy = (c.y0 + c.y1) / 2;
      if (((ccx - hd.cx) / (rx * 0.9)) ** 2 + ((ccy - hd.cy) / (ry * 1.3)) ** 2 <= 1 && c.w <= rx * 1.7 && c.h <= ry * 1.7 && c.x0 >= hd.cx - rx * 1.1 && c.x1 <= hd.cx + rx * 1.1 && c.y0 >= hd.cy - ry * 1.6 && c.y1 <= hd.cy + ry * 1.6 && (Math.abs(c.y1 - lineY) <= T + 2 || Math.abs(c.y0 - lineY) <= T + 2)) own.add(id);
    }
    // (both halves, one each side of the line)
    if (own.size) { const cs = [...own].map((id) => HC[id]); if (!(cs.some((c) => Math.abs(c.y1 - lineY) <= T + 2 && c.y0 < lineY) && cs.some((c) => Math.abs(c.y0 - lineY) <= T + 2 && c.y1 > lineY))) own.clear(); }
    for (let dy = -Math.round(sp * 0.9); dy <= Math.round(sp * 0.9); dy++) for (let dx = -Math.round(sp * 1.0); dx <= Math.round(sp * 1.0); dx++) {
      const x = Math.round(hd.cx) + dx, y = Math.round(hd.cy) + dy; if (x < 0 || y < 0 || x >= w || y >= h || !holes[y * w + x]) continue;
      if ((dx / (rx * 0.85)) ** 2 + (dy / (ry * 1.1)) ** 2 <= 1 || (HLab && own.has(HLab[y * w + x]))) inn++;
      else if (!others.some((q) => ((x - q.cx) / (rx * 0.85)) ** 2 + ((y - q.cy) / (ry * 1.1)) ** 2 <= 1)) out++;
    }
    if (TR && Math.abs(hd.cx - TR.x) < sp * 0.8) TR.log.push(['holeAt', inn, out, Math.round(hd.cx), Math.round(hd.cy), rx, ry]);
    return inn >= Math.max(3, sp * sp * 0.025) && out < inn * 0.7;
  };
  for (const hd of heads) hd.hollow = hd.ringHead || holeAt(hd);
  if (TR && typeof heads !== 'undefined') trk(625, heads);
  // (two heads a step apart that touch read as one wide run: then each is still a head, when each
  if (TR && typeof heads !== 'undefined') trk(626, heads);
  if (TR) for (const hd of heads) if (Math.abs(hd.cx - TR.x) < sp * 0.8) TR.log.push(['wide?', heads.filter((q) => q !== hd && Math.abs(q.cx - hd.cx) < sp * 3).map((q) => ({ cx: Math.round(q.cx), p: q.p, l: q.left, r: q.right, hl: hd.left, hr: hd.right, st: !!stemOf(C, w, h, hd, rx, sp), sq: !!stemOf(C, w, h, q, rx, sp) }))]);
  // has a stem of its own or they sit side by side as a second)
  heads = heads.filter((hd) => hd.wRow <= sp * (hd.hollow ? 2.15 : 1.7) || heads.some((q) => q !== hd && Math.abs(q.p - hd.p) === 1 && Math.abs(q.cx - hd.cx) > sp * 0.75 && (Math.abs(q.cx - hd.cx) < sp * 1.5 || (Math.abs(q.cx - hd.cx) < sp * 2.6 && hd.wRow <= sp * 3.4 && q.left >= hd.left - sp * 0.4 && q.right <= hd.right + sp * 0.4 && stemOf(C, w, h, hd, rx, sp) && stemOf(C, w, h, q, rx, sp)))));
  if (TR && typeof heads !== 'undefined') trk(628, heads);
  // a wide oval read as two heads side by side is one whole note
  heads.sort((a, b2) => a.cx - b2.cx);
  heads = heads.filter((hd, i) => !heads.some((q, j) => j !== i && q.p === hd.p && q.comp === hd.comp && Math.abs(q.cx - hd.cx) < sp * 1.5 && q.wRow > sp * 1.45 && (q.sc > hd.sc || (q.sc === hd.sc && j < i))));
  if (TR && typeof heads !== 'undefined') trk(631, heads);
  // notes above or below the staff need their ledger lines
  heads = heads.filter((hd) => {
    if (hd.p >= -1 && hd.p <= 9) return true;
    const lp = hd.p < 0 ? -2 : 10;
    const ly = yAt(s, lp, hd.cx);
    let best = 0, sides = 0;
    for (let dy = -Math.ceil(T / 2) - 1; dy <= Math.ceil(T / 2) + 1; dy++) {
      const y = Math.round(ly + dy); if (y < 0 || y >= h) continue;
      let run = 0; for (let x = Math.round(hd.cx - rx - sp * 0.25); x <= Math.round(hd.cx + rx + sp * 0.25); x++) if (B[y * w + x]) run++;
      best = Math.max(best, run);
      // or a short ledger line: it still sticks out on both sides of the head
      let l = 0, r = 0; const ext = Math.max(2, Math.round(sp * 0.18));
      for (let k = 1; k <= ext; k++) { if (B[y * w + Math.round(hd.cx - rx * 0.9 - k)]) l++; if (B[y * w + Math.round(hd.cx + rx * 0.9 + k)]) r++; }
      if (l >= ext * 0.7 && r >= ext * 0.7) sides++;
    }
    return best >= (2 * rx + sp * 0.5) * 0.85 || sides >= 1;
  });
  if (TR && typeof heads !== 'undefined') trk(648, heads);
  // ---- hollow or filled, stem, beams, dot
  for (const hd of heads) {
    hd.stem = stemOf(C, w, h, hd, rx, sp);
    // no stem: perhaps the head was found off its middle (a hole beside it, between it and a barline,
    // taken for part of it): the ink of the row through it, a little to either side
    if (!hd.stem && hd.hollow && !hd.ringHead && (globalThis.__offc ?? 1)) {
      const y = Math.round(hd.cy);
      for (const d of [-0.3, 0.3, -0.45, 0.45, -0.6, 0.6]) {
        const x = Math.round(hd.cx + d * sp); if (x < 1 || x >= w - 1 || !C[y * w + x]) continue;
        let a = x, z = x; while (a > 0 && C[y * w + a - 1]) a--; while (z < w - 1 && C[y * w + z + 1]) z++;
        if (z - a + 1 < sp * 0.9 || z - a + 1 > sp * 1.6) continue;
        // (a blob there, not the thin bar of a sharp: ink down the middle through most rows of it)
        let rows = 0, inkR = 0; const xm = Math.round((a + z) / 2);
        for (let yy = Math.round(hd.cy - sp * 0.3); yy <= Math.round(hd.cy + sp * 0.3); yy++) { rows++; if (yy >= 0 && yy < h && C[yy * w + xm]) inkR++; }
        if (inkR < rows * 0.8) continue;
        const h2 = { ...hd, cx: (a + z) / 2 }, st = stemOf(C, w, h, h2, rx, sp);
        // (a solid row of ink across it: a filled head, the 'hole' was beside it)
        if (st) { hd.cx = h2.cx; hd.left = a; hd.right = z; hd.wRow = z - a + 1; hd.stem = st; hd.hollow = false; hd.ringHead = false; break; }
      }
    }
    // no stem: perhaps a faint one (a faded or tinted part of the page), seen with a lighter
    // threshold; its ink there is taken into the picture, with what is at its end (beam, flag)
    if (!hd.stem && !hd.hollow && ctx.lite && (globalThis.__liteStem ?? 1)) {
      const L = ctx.lite(), st = stemOf(L, w, h, hd, rx, sp);
      if (st && st.len >= sp * 2.5 && st.back < sp * 0.8) {
        const xa = Math.max(0, Math.round(st.x - sp * 1.4)), xb = Math.min(w - 1, Math.round(st.x + sp * 1.4));
        for (let y = Math.max(0, Math.round(st.top - sp * 0.3)); y <= Math.min(h - 1, Math.round(st.bot + sp * 0.3)); y++) {
          const nearEnd = Math.abs(y - st.end) < sp * 1.6;
          for (let x = nearEnd ? xa : Math.round(st.x) - 2; x <= (nearEnd ? xb : Math.round(st.x) + 2); x++) if (L[y * w + x]) C[y * w + x] = 1;
        }
        hd.stem = stemOf(C, w, h, hd, rx, sp);
      }
    }
    // a stem that runs up into the staff above (its notes' stems, beams) is not this note's: the
    // other one, when there is one
    if (hd.stem && hd.stem.alt && hd.stem.alt.len >= sp * 2.5 && ctx.staffAbove(s) && (hd.stem.up ? hd.stem.end < s.top - sp * 3 && hd.stem.end < ctx.staffAbove(s).bottom + sp * 2.5 : false)) hd.stem = { ...hd.stem.alt, alt: hd.stem };
  }
  // no stem: perhaps one broken in the print, a short gap in it, toward another head of the chord
  // on that stem (the stem is theirs, its print broken)
  if (globalThis.__stemGap ?? 1) for (const hd of heads) {
    if (hd.stem || hd.hollow) continue;
    const st = stemOf(C, w, h, hd, rx, sp, 0.75);
    if (globalThis.__gapDbg) (globalThis.__gapDbgL = globalThis.__gapDbgL || []).push({ cx: Math.round(hd.cx), cy: Math.round(hd.cy), st: st && [Math.round(st.x), Math.round(st.top), Math.round(st.bot), st.up], near: heads.filter((q) => q !== hd && q.stem && Math.abs(q.cx - hd.cx) < sp * 1.5).map((q) => [Math.round(q.cx), Math.round(q.cy), Math.round(q.stem.x), q.stem.up]) });
    if (st && st.len >= sp * 2.5 && heads.some((q) => q !== hd && q.stem && !q.gapStem && Math.abs(q.stem.x - st.x) < sp * 0.35 && (q.cy > st.top - sp * 0.3 && q.cy < st.bot + sp * 0.3 || (q.stem.up === st.up && Math.min(Math.abs(q.stem.bot - st.top), Math.abs(st.bot - q.stem.top)) < sp * 1.6)))) { hd.stem = st; hd.gapStem = true; }
  }
  // the stem its neighbours' stems agree with: where theirs end (on one beam), not a long stroke the
  // other way into whatever is above or below the staff
  for (const hd of heads) {
    const st = hd.stem, alt = st && st.alt;
    if (!alt || alt.len < sp * 2.2 || st.up === alt.up) continue;
    const far = st.up ? st.end < s.top - sp * 2.5 : st.end > s.bottom + sp * 2.5;
    if (!far) continue;
    const nb = heads.filter((q) => q !== hd && q.stem && q.stem.up === alt.up && Math.abs(q.cx - hd.cx) < sp * 2.6 && Math.abs(q.stem.end - alt.end) < sp * 0.7);
    if (nb.length) hd.stem = { ...alt, alt: st };
  }
  if (TR) for (const hd of heads) if (Math.abs(hd.cx - TR.x) < sp * 0.8) TR.log.push(['stemA', hd.stem && [Math.round(hd.stem.x), Math.round(hd.stem.end), hd.stem.up, hd.stem.alt && Math.round(hd.stem.alt.end)]]);
  for (const hd of heads) {
    hd.beams = hd.stem ? beamsOf(C, w, h, hd.stem, sp) : 0;
    hd.dots = dotOf(C, w, h, hd, s, sp, labC, ctx.rawC);
    hd.kind = hd.hollow ? (hd.stem ? 'half' : 'whole') : (hd.wRow > sp * 1.6 && !hd.stem ? 'whole' : 'black');
    hd.x = hd.left; hd.y = hd.cy; hd.w = hd.right - hd.left + 1;
  }
  // a stem run on past its beams into something beyond (a dynamic, a note below): its beams are
  // where its beamed neighbours' stems end
  for (const hd of heads) {
    if (!hd.stem || hd.hollow) continue;
    const q = heads.filter((o) => o !== hd && o.stem && o.beams && o.stem.up === hd.stem.up && Math.abs(o.cx - hd.cx) < sp * 2.6).sort((a, b2) => Math.abs(a.cx - hd.cx) - Math.abs(b2.cx - hd.cx))[0];
    if (!q) continue;
    const beyond = hd.stem.up ? q.stem.end - hd.stem.end : hd.stem.end - q.stem.end;
    if (beyond < sp * 0.3 || beyond > sp * 2.5) continue;
    const st2 = { ...hd.stem, end: q.stem.end, len: Math.abs(q.stem.end - hd.cy) };
    st2.top = Math.min(st2.end, hd.cy); st2.bot = Math.max(st2.end, hd.cy);
    const b2 = beamsOf(C, w, h, st2, sp);
    if (b2 && b2 > hd.beams) { hd.stem = st2; hd.beams = b2; }
  }
  if (TR) for (const hd of heads) if (Math.abs(hd.cx - TR.x) < sp * 0.8) TR.log.push(['stemB', hd.stem && [Math.round(hd.stem.x), Math.round(hd.stem.end), hd.beams]]);
  if (TR && typeof heads !== 'undefined') trk(656, heads);
  // a 'hollow head' squeezed in beside a filled one, with no proper stem of its own: the gap between
  // that head and an accidental or another sign, not a half note
  heads = heads.filter((hd) => !(hd.ringHead && (!hd.stem || hd.stem.len < sp * 2.8) && heads.some((q) => q !== hd && !q.hollow && Math.abs(q.cx - hd.cx) < sp * 1.4 && Math.abs(q.p - hd.p) <= 1)));
  // two 'heads' a third apart on one stem, at one place, where there is ink for only one (a head
  // hanging from a ledger line read once with the line and once below it): one head, where its ink is
  {
    const gone = new Set();
    for (const hd of heads) for (const q of heads) {
      if (hd === q || gone.has(hd) || gone.has(q) || !hd.stem || !q.stem || Math.abs(hd.stem.x - q.stem.x) > sp * 0.3 || Math.abs(hd.cx - q.cx) > sp * 0.35 || Math.abs(hd.p - q.p) !== 2) continue;
      if (hd.p >= 0 && hd.p <= 8 && q.p >= 0 && q.p <= 8) continue;
      const x = Math.round((hd.cx + q.cx) / 2), y0 = Math.round(Math.min(hd.cy, q.cy) - sp * 0.8), y1 = Math.round(Math.max(hd.cy, q.cy) + sp * 0.8);
      let a = -1, z = -1, bestA = -1, bestZ = -1, pieces = 0; const wd = new Map();
      for (let y = y0; y <= y1 + 1; y++) {
        let on = false;
        if (y <= y1 && y >= 0 && y < h && C[y * w + x]) { let l = x, r = x; while (l > 0 && C[y * w + l - 1]) l--; while (r < w - 1 && C[y * w + r + 1]) r++; on = r - l + 1 <= sp * 1.6; wd.set(y, r - l + 1); }
        if (on) { if (a < 0) a = y; z = y; } else if (a >= 0) { if (z - a + 1 >= sp * 0.5) pieces++; if (z - a > bestZ - bestA) { bestA = a; bestZ = z; } a = -1; }
      }
      // (two pieces of ink, one each side of a ledger line: two notes, a chord)
      if (pieces > 1) continue;
      if (bestA < 0 || bestZ - bestA + 1 > sp * 1.55 || bestZ - bestA + 1 < sp * 0.6) continue;
      // (one oval: no narrow waist across its middle, as two heads stacked have)
      { let mx = 0; for (let y = bestA; y <= bestZ; y++) mx = Math.max(mx, wd.get(y) || 0); let waist = false; const m0 = bestA + (bestZ - bestA) * 0.3, m1 = bestA + (bestZ - bestA) * 0.7; for (let y = Math.round(m0); y <= Math.round(m1); y++) if ((wd.get(y) || 0) < mx * 0.72) waist = true; if (waist) continue; }
      const cy = (bestA + bestZ) / 2;
      hd.cy = cy; hd.p = Math.round(pAt(s, cy, hd.cx)); hd.y = cy; gone.add(q);
    }
    if (gone.size) heads = heads.filter((hd) => !gone.has(hd));
  }
  // (or one on another note's stem, the curl of its flag)
  heads = heads.filter((hd) => !(hd.ringHead && (!hd.stem || hd.stem.len < sp * 2.8) && heads.some((q) => q !== hd && !q.hollow && q.stem && Math.abs(q.stem.x - hd.cx) < rx + sp * 0.3 && hd.cy > q.stem.top + sp * 0.5 && hd.cy < q.stem.bot - sp * 0.5 && Math.abs(q.cy - hd.cy) > sp * 1.5)));
  // (a 'hollow head' whose stem is another note's, it sitting part way along it: a flag's curl)
  heads = heads.filter((hd) => !(hd.hollow && hd.stem && hd.stem.len < sp * 3 && heads.some((q) => q !== hd && !q.hollow && q.stem && Math.abs(q.stem.x - hd.stem.x) < sp * 0.35 && q.stem.up !== hd.stem.up && hd.cy > q.stem.top + sp * 0.5 && hd.cy < q.stem.bot - sp * 0.5 && Math.abs(q.cy - hd.cy) > sp * 1.5)));
  // the beam group of each beamed note: the next beamed stem along is joined to it when ink runs
  if (TR && typeof heads !== 'undefined') trk(657, heads);
  // straight from the end of one stem to the end of the other (a beam)
  {
    const bm = heads.filter((hd) => hd.stem && hd.beams).sort((a, b2) => a.stem.x - b2.stem.x);
    let g = 0;
    // (the notes of a chord share a stem)
    const stems = []; for (const hd of bm) { const l = stems[stems.length - 1]; if (l && Math.abs(l.x - hd.stem.x) < sp * 0.3) l.hs.push(hd); else stems.push({ x: hd.stem.x, end: hd.stem.end, up: hd.stem.up, hs: [hd] }); }
    const joined = (A, Bs) => {
      if (Bs.x - A.x > sp * 6) return false;
      let ok = 0, n = 0;
      for (let k = 1; k < 10; k++) {
        const t = k / 10, x = Math.round(A.x + (Bs.x - A.x) * t), y = A.end + (Bs.end - A.end) * t;
        n++;
        let ink = false; for (let dy = -Math.round(sp * 0.45); dy <= Math.round(sp * 0.45) && !ink; dy++) { const yy = Math.round(y) + dy; if (yy >= 0 && yy < h && C[yy * w + x]) ink = true; }
        if (ink) ok++;
      }
      return ok >= n - 1;
    };
    stems.forEach((st, i) => { if (i === 0 || !joined(stems[i - 1], st)) g++; st.g = g; for (const hd of st.hs) hd.bg = g; });
    // a stem with no beam found at its end that a thick beam joins straight to the next beamed stem
    // along (the last of a group, its beams slanting off): one of the group, with as many beams
    {
      const thick = (A, Bs) => { const x = Math.round((A.x + Bs.x) / 2), y = Math.round((A.end + Bs.end) / 2); let best = 0, run = 0; for (let yy = Math.round(y - sp * 0.8); yy <= Math.round(y + sp * 0.8); yy++) { if (yy >= 0 && yy < h && C[yy * w + x]) { run++; best = Math.max(best, run); } else run = 0; } return best >= sp * 0.3; };
      for (const hd of heads) {
        if (!hd.stem || hd.beams || hd.hollow) continue;
        const me = { x: hd.stem.x, end: hd.stem.end, up: hd.stem.up };
        const nb = stems.filter((st) => st.up === me.up && Math.abs(st.x - me.x) < sp * 2.6 && Math.abs(st.x - me.x) > sp * 0.6).sort((a, b2) => Math.abs(a.x - me.x) - Math.abs(b2.x - me.x))[0];
        if (!nb) continue;
        const [A, Bs] = nb.x < me.x ? [nb, me] : [me, nb];
        if (!joined(A, Bs) || !thick(A, Bs)) continue;
        hd.beams = Math.max(...nb.hs.map((q) => q.beams)); hd.bg = nb.g;
      }
    }
    // one note of a group with one beam more than all the others (a blurred beam read twice): as
    // many as the others (a lone shorter note would leave the group short of a whole beat)
    for (let gi = 1; gi <= g; gi++) {
      const sts = stems.filter((st) => st.g === gi);
      if (sts.length < 4) continue;
      const bs = sts.map((st) => Math.max(...st.hs.map((hd) => hd.beams)));
      const m = bs.slice().sort((a, b2) => bs.filter((v) => v === b2).length - bs.filter((v) => v === a).length)[0];
      const odd = bs.map((v, k) => (v === m + 1 ? k : -1)).filter((k) => k >= 0);
      if (odd.length === 1 && bs.filter((v) => v === m).length === sts.length - 1) for (const hd of sts[odd[0]].hs) hd.beams = m;
    }
    // a note between two of its group with two beams or more than either (something below the beam,
    // a tuplet's number, read as beams): as many as its neighbours
    for (let gi = 1; gi <= g; gi++) {
      const sts = stems.filter((st) => st.g === gi);
      for (let k = 1; k + 1 < sts.length; k++) {
        const b = (st) => Math.max(...st.hs.map((hd) => hd.beams));
        const nb = Math.max(b(sts[k - 1]), b(sts[k + 1]));
        if (b(sts[k]) >= nb + 2 && nb >= 1) for (const hd of sts[k].hs) hd.beams = nb;
      }
    }
    // a 'flag' on a stem beamed to no other: a flag goes off to the right of its stem only; a thin
    // curve (a slur) passing the end of the stem runs on to the left of it as well
    for (const st of stems) {
      if (stems.some((q) => q !== st && q.g === st.g)) continue;
      const thinAt = (x) => { if (x < 0 || x >= w) return false; let best = 0, run = 0; for (let y = Math.round(st.end - sp * 0.6); y <= Math.round(st.end + sp * 0.6); y++) { if (y >= 0 && y < h && C[y * w + x]) { run++; best = Math.max(best, run); } else run = 0; } return best > 0 && best <= sp * 0.35; };
      if (thinAt(Math.round(st.x - sp * 0.6)) && thinAt(Math.round(st.x - sp * 1.0))) for (const hd of st.hs) { hd.beams = 0; hd.bg = null; }
    }
  }
  if (TR && typeof heads !== 'undefined') trk(676, heads);
  // a stroke through the 'head' both ways is no stem: the middle of a sharp or a natural
  for (const hd of heads) {
    const st = hd.stem; if (!st || st.back < sp * 1.15) continue;
    let carried = heads.some((q) => q !== hd && Math.abs(q.cy - st.backEnd) < sp * 0.9 && Math.abs(q.cx - hd.cx) < sp * 1.4 && (st.up ? q.cy > hd.cy : q.cy < hd.cy));
    // (the other head of a chord may be a hollow one with a thin outline, unseen so far: a ring of
    // ink at the end of the stem, light inside)
    // (well apart: the strokes of a sharp or a natural run on only a little past its middle)
    if (!carried && hd.hollow && st.back > sp * 1.6) {
      const G = B.gray, th = B.th;
      const dk = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && G[yi * w + xi] < th + 40; };
      const p0 = Math.round(pAt(s, st.backEnd, hd.cx));
      for (const p of [p0, p0 + (st.up ? 1 : -1)]) {
        if (Math.abs(p - hd.p) < 3) continue;
        const cyy = yAt(s, p, hd.cx), cx = hd.cx;
        let n = 0, tot = 0;
        for (let t = 0; t < Math.PI * 2; t += Math.PI / 10) { tot++; if (dk(cx + Math.cos(t) * rx * 0.9, cyy + Math.sin(t) * ry * 1.05) || dk(cx + Math.cos(t) * rx * 0.7, cyy + Math.sin(t) * ry * 0.85)) n++; }
        let light = 0, lt = 0; for (let dx = -0.25; dx <= 0.25; dx += 0.125) { lt++; if (!dk(cx + dx * rx, cyy - ry * 0.3) || !dk(cx + dx * rx, cyy + ry * 0.3)) light++; }
        if (n / tot >= 0.75 && light / lt >= 0.8) { heads.push({ cx, cy: cyy, p, sc: 0.8, fit: 0.8, comp: null, ringHead: true, hollow: true, kind: 'half', fromStem: true, wRow: Math.round(rx * 2.1), left: Math.round(cx - rx * 1.05), right: Math.round(cx + rx * 1.05), stem: { ...st, back: 0 }, beams: 0, dots: 0, bg: null }); carried = true; break; }
      }
    }
    if (!carried) { hd.stem = null; hd.beams = 0; hd.kind = hd.hollow ? 'whole' : 'black'; }
  }
  if (TR && typeof heads !== 'undefined') trk(682, heads);
  // the curl of a flag read as a head: it sits on another note's stem, between that head and the
  if (TR && typeof heads !== 'undefined') trk(683, heads);
  // stem's end, with its 'stem' the other way (two voices cross the other way round)
  heads = heads.filter((hd) => !heads.some((q) => {
    // a hollow 'head' in the curl of a flag: at the end of another note's stem, to its right
    if (q !== hd && q.stem && hd.hollow && hd.cx > q.stem.x - sp * 0.2 && hd.cx < q.stem.x + sp * 1.4 && Math.abs(hd.cy - q.stem.end) < sp * 2.8 && Math.abs(hd.cy - q.cy) > sp * 1.5 && (!hd.stem || Math.abs(hd.stem.x - q.stem.x) < sp * 0.3)) return true;
    if (q === hd || !q.stem || hd.hollow || Math.abs(hd.cx - q.cx) > sp * 0.75) return false;
    const between = q.stem.up ? hd.cy < q.cy - sp * 0.6 && hd.cy > q.stem.end - sp * 0.3 : hd.cy > q.cy + sp * 0.6 && hd.cy < q.stem.end + sp * 0.3;
    if (!between) return false;
    if (q.stem.len < sp * 2.6) return false;
    return hd.stem ? hd.stem.up !== q.stem.up && hd.stem.len < q.stem.len * 0.85 : q.beams > 0;
  }));
  // the end of a beam read as a head, its 'stem' the stem of the note at the other end: on one
  // stroke with that note, where that note's beams are
  const beamSide = (hd) => [-1, 1].some((sd) => { let n = 0, t = 0; for (let k = 0.3; k <= 1.2; k += 0.1) { t++; const x = Math.round(sd < 0 ? hd.left - k * sp : hd.right + k * sp); let hit = false; for (let dy = -0.25; dy <= 0.25 && !hit; dy += 0.125) { const y = Math.round(hd.cy + dy * sp); if (x >= 0 && x < w && y >= 0 && y < h && C[y * w + x]) hit = true; } if (hit) n++; } return n >= t * 0.75; });
  // (or one lying on the beams between two stems of a group)
  const onBeams = (hd) => heads.some((a) => a !== hd && a.stem && a.bg != null && heads.some((b) => b !== hd && b !== a && b.stem && b.bg === a.bg && a.stem.x < hd.cx - sp * 0.2 && b.stem.x > hd.cx + sp * 0.2 && b.stem.x - a.stem.x < sp * 4 && Math.abs(hd.cy - (a.stem.end + ((b.stem.end - a.stem.end) * (hd.cx - a.stem.x)) / (b.stem.x - a.stem.x))) < sp * 0.8 && beamInk(a, b)));
  // (ink all the way along the beam line from one stem to the other)
  function beamInk(a, b) { for (let x = Math.round(a.stem.x) + 2; x <= Math.round(b.stem.x) - 2; x++) { const y = Math.round(a.stem.end + ((b.stem.end - a.stem.end) * (x - a.stem.x)) / (b.stem.x - a.stem.x)); let hit = false; for (let dy = -Math.round(sp * 0.35); dy <= Math.round(sp * 0.35) && !hit; dy++) { const yy = y + dy; if (yy >= 0 && yy < h && C[yy * w + x]) hit = true; } if (!hit) return false; } return true; }
  heads = heads.filter((hd) => !(hd.stem && (beamSide(hd) || (hd.beams >= 1 && onBeams(hd))) && heads.some((q) => q !== hd && q.stem && q.beams >= 1 && q.beams >= (hd.beams || 0) && Math.abs(q.stem.x - hd.stem.x) < sp * 0.35 && q.stem.up !== hd.stem.up && Math.abs(hd.cy - q.stem.end) < sp * 2.2 && (q.stem.up ? hd.cy < q.cy : hd.cy > q.cy) && Math.abs(q.cy - hd.stem.end) < sp * 1.0)));
  if (TR && typeof heads !== 'undefined') trk(693, heads);
  // a hollow 'head' (a ring of ink) whose 'stem' is another note's stem, ending at that note's head:
  if (TR && typeof heads !== 'undefined') trk(694, heads);
  // the curl of a flag or a gap between strokes, not a note
  heads = heads.filter((hd) => !(hd.ringHead && hd.stem && heads.some((q) => q !== hd && q.stem && Math.abs(q.stem.x - hd.stem.x) < sp * 0.35 && q.stem.up !== hd.stem.up && Math.abs(q.cy - hd.stem.end) < sp * 0.9)));
  if (TR && typeof heads !== 'undefined') trk(696, heads);
  // a 'head' just left of a note and a step above it, without its own stem: part of an accidental
  if (TR && typeof heads !== 'undefined') trk(697, heads);
  // (a head with a stem of its own, as long as a stem, is a note: in a run of sixteenths the notes
  if (TR && typeof heads !== 'undefined') trk(698, heads);
  // stand that close)
  heads = heads.filter((hd) => (hd.stem && hd.stem.len > sp * 2.2) || !heads.some((q) => q !== hd && q.cx - hd.cx > sp * 0.55 && q.cx - hd.cx < sp * 1.45 && hd.p - q.p === 1 && q.stem && (!hd.stem || Math.abs(hd.stem.x - q.stem.x) > sp * 0.45)));
  if (TR && typeof heads !== 'undefined') trk(700, heads);
  // a stemless 'whole note' right next to a note with a stem is that note's accidental and head read together
  heads = heads.filter((hd) => hd.stem || !heads.some((q) => q !== hd && q.stem && Math.abs(q.cx - hd.cx) < sp * 1.1 && Math.abs(q.p - hd.p) <= 2));
  if (TR && typeof heads !== 'undefined') trk(702, heads);
  // a 'whole note' that is part of a taller shape is a sign: the C (or cut C) of the time, a clef's curl
  heads = heads.filter((hd) => {
    if (hd.stem || !hd.hollow) return true;
    let tallest = 0;
    for (const fx of [-0.8, 0.8]) for (const fy of [-0.3, 0, 0.3]) {
      const x = Math.round(hd.cx + fx * rx), y = Math.round(hd.cy + fy * sp); if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const id = labC[y * w + x]; if (id < 0) continue;
      const g = compsC[ctx.groupOf[id]]; if (g) tallest = Math.max(tallest, g.h);
    }
    return tallest <= sp * 1.5;
  });
  if (TR && typeof heads !== 'undefined') trk(713, heads);
  // without a stem only a whole note (wide) is a note
  heads = heads.filter((hd) => hd.stem || hd.wRow >= sp * (hd.ringHead ? 1.45 : hd.hollow ? 1.3 : 1.45));
  if (TR) trk(839, heads);
  // ---- barlines: tall thin strokes from the top line to the bottom line that are not stems
  const bars = [], pendingBars = [];
  const yTop = (x) => Math.round(yAt(s, 8, x)), yBot = (x) => Math.round(yAt(s, 0, x));
  for (let x = Math.round(s.x0); x <= Math.round(s.x1); x++) {
    const cover = (xx) => { const a = yTop(xx), z = yBot(xx); let n = 0; for (let y = a; y <= z; y++) n += B[y * w + xx] || 0; return n / (z - a + 1); };
    if (cover(x) < 0.9) continue;
    let e = x; while (e + 1 <= s.x1 && cover(e + 1) >= 0.9) e++;
    const width = e - x + 1, cx = (x + e) / 2;
    // a barline stands alone: just beside it the staff is empty (unlike the digits of a time signature)
    const side = (xx) => { const a = yTop(xx), z = yBot(xx); let n = 0; for (let y = a; y <= z; y++) n += C[y * w + xx] || 0; return n / (z - a + 1); };
    const beside = Math.min(side(Math.round(x - sp * 0.22)), side(Math.round(e + sp * 0.22)));
    if (beside > 0.45) { if (ctx.dbg) (ctx.barTrace = ctx.barTrace || []).push({ x, why: 'beside', beside }); x = e + 1; continue; }
    // and straight: hardly anything joins it sideways (digits and clefs have strokes off their sides)
    {
      const a0 = yTop(cx), z0 = yBot(cx); let wide = 0, tot = 0;
      for (let y = a0 + 2; y <= z0 - 2; y++) {
        let l = x, r = e; while (l > 0 && C[y * w + l - 1]) l--; while (r < w - 1 && C[y * w + r + 1]) r++;
        tot++; if (r - l + 1 > (e - x + 1) + sp * 0.35) wide++;
      }
      if (tot && wide / tot > 0.3) { if (ctx.dbg) (ctx.barTrace = ctx.barTrace || []).push({ x, why: 'wide', r: wide / tot }); x = e + 1; continue; }
    }
    const stemOfHead = heads.some((hd) => hd.stem && Math.abs(hd.stem.x - cx) < sp * 0.45);
    // a stem from the top line to the bottom line looks like a barline, but has a head (or a beam)
    // at one end, against one side
    const blobAt = (y, side) => {
      let n = 0, tot = 0;
      for (let yy = Math.round(y - sp * 0.3); yy <= Math.round(y + sp * 0.3); yy++) for (let k = 0.2; k <= 1.0; k += 0.1) {
        const xx = Math.round(side > 0 ? e + k * sp : x - k * sp); if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        tot++; n += C[yy * w + xx] || 0;
      }
      // and it touches the stroke (a note just before or after a barline stands clear of it)
      let t = 0, tt = 0;
      for (let yy = Math.round(y - sp * 0.3); yy <= Math.round(y + sp * 0.3); yy++) { const xx = side > 0 ? e + 1 : x - 1; if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue; tt++; t += C[yy * w + xx] || C[yy * w + xx + side] || 0; }
      return tot && tt && t / tt > 0.4 ? n / tot : 0;
    };
    const capped = [yTop(cx), yBot(cx)].some((y) => blobAt(y, 1) > 0.6 || blobAt(y, -1) > 0.6);
    if (capped) { if (ctx.dbg) (ctx.barTrace = ctx.barTrace || []).push({ x, why: 'capped' }); x = e + 1; continue; }
    const ya = yTop(cx), yb = yBot(cx);
    let up = 0; while (ya - up - 1 > 0 && (B[(ya - up - 1) * w + Math.round(cx)])) up++;
    let dn = 0; while (yb + dn + 1 < h && (B[(yb + dn + 1) * w + Math.round(cx)])) dn++;
    const toNext = ctx.staffBelow(s) && dn > (ctx.staffBelow(s).top - s.bottom) * 0.9;
    const toPrev = ctx.staffAbove(s) && up > (s.top - ctx.staffAbove(s).bottom) * 0.9;
    // a barline of the whole system runs on toward the other staff (the scan may break it on the way)
    // (or on to the edge of the picture: a staff cut out of a system, its barlines cut with it)
    const toTop = ya - up - 1 <= 1 && up > sp * 0.9, toBottom = yb + dn + 1 >= h - 2 && dn > sp * 0.9;
    const shaped = width <= sp * 0.75 && (up < sp * 0.9 || toPrev || toTop || (up > sp * 2.2 && dn < sp * 0.9 && ctx.staffAbove(s))) && (dn < sp * 0.9 || toNext || toBottom || (dn > sp * 2.2 && up < sp * 0.9 && ctx.staffBelow(s)));
    if (!stemOfHead && shaped) bars.push({ x: cx, w: width, thick: width > sp * 0.3 });
    // (the 'head' whose stem it seemed to be may turn out to be part of a time signature or a clef
    // just after it: decided once those are read)
    else if (shaped && stemOfHead) { pendingBars.push({ x: cx, w: width, thick: width > sp * 0.3, by: heads.filter((hd) => hd.stem && Math.abs(hd.stem.x - cx) < sp * 0.45) }); x = e + 1; continue; }
    else if (ctx.dbg) (ctx.barTrace = ctx.barTrace || []).push({ x, why: 'ends', stemOfHead, width, up: up / sp, dn: dn / sp, toPrev, toNext });
    x = e + 1;
  }
  const merged = [];
  for (const b of bars) { const l = merged[merged.length - 1]; if (l && b.x - l.x < sp * 1.0) { l.x = b.x; l.w += b.w; l.double = true; l.thick = l.thick || b.thick; } else merged.push({ ...b }); }
  // repeat dots beside thick barlines
  for (const b of merged) {
    const dotAt = (x) => [3, 5].every((p) => { const y = Math.round(yAt(s, p, x)); let n = 0; for (let dx = -sp * 0.25; dx <= sp * 0.25; dx++) n += C[y * w + Math.round(x + dx)] || 0; return n >= sp * 0.2; });
    if (dotAt(b.x - sp * 0.9)) b.endRepeat = true;
    if (dotAt(b.x + sp * 0.9)) b.startRepeat = true;
  }
  // the dots of a repeat sign are not the dot of the note before them
  for (const hd of heads) if (hd.dots && merged.some((b) => b.endRepeat && b.x > hd.cx && b.x - hd.right < sp * 1.9)) hd.dots = 0;
  // ---- the start of the line: clef, key, time
  // (a barline-like stroke can be part of a C clef, so the header is read without them)
  const firstBar = merged.find((b) => b.x > s.x0 + sp * 5.5);
  const zoneEnd = Math.min(firstBar ? firstBar.x : Infinity, s.x0 + sp * 18);
  const inZone = compsC.filter((c) => c.x0 >= s.x0 - sp * 0.5 && c.x1 <= zoneEnd && c.y1 > s.top - sp * 4.5 && c.y0 < s.bottom + sp * 4.5 && ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s && c.n > sp * sp * 0.03)
    .filter((c) => !(c.w < sp * 0.7 && c.h > sp * 3.5 && c.x0 < s.x0 + sp * 0.8))   // the line's opening barline
    .sort((a, b2) => a.x0 - b2.x0);
  const head = readHeader(s, inZone, ctx, header, heads);
  if (ctx.dbg) { head.trace = ctx.trace; ctx.trace = []; }
  if (ctx.dbg) head.zone = inZone.map((c) => ({ x0: c.x0, w: +(c.w / sp).toFixed(2), h: +(c.h / sp).toFixed(2), top: +pAt(s, c.y0, c.x0).toFixed(1), bot: +pAt(s, c.y1, c.x0).toFixed(1), k: classify(shapeOf(C, w, c.x0, c.y0, c.x1, c.y1, sp, labC, c.id), ['treble', 'bass', 'alto', 'sharp', 'flat', 'natural', 'd2', 'd3', 'd4', 'd6', 'd8', 'tC']) }));
  const startX = head.end;
  // barlines inside the clef, key or time signature are part of them
  for (let k = merged.length - 1; k >= 0; k--) if (merged[k].x < startX - sp * 0.2 && merged[k].x > s.x0 + sp * 0.8) merged.splice(k, 1);
  // ---- accidentals in front of notes
  const isAcc = new Set(), accBoxesW = [], accCls = new Map();
  for (const c of compsC) {
    if (c.x0 < startX - sp * 0.2 || c.x1 > s.x1 || c.h < sp * 1.2 || c.h > sp * 3.8 || c.w > sp * 1.7 || c.w < sp * 0.3) continue;
    if (!band((c.y0 + c.y1) / 2)) continue;
    // something with a head in it is not an accidental
    if (globalThis.__accLog && c.h > sp * 1.2) globalThis.__accLog.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, h: +(c.h / sp).toFixed(2), w: +(c.w / sp).toFixed(2), k: ctx.best(c, ['sharp', 'flat', 'natural', 'dflat'], sp * 1.8) });
    if (ctx.dbg && c.h > sp * 1.5 && c.w < sp * 1.2) (ctx.accTrace = ctx.accTrace || []).push({ x0: c.x0, y0: c.y0, h: +(c.h / sp).toFixed(2), w: +(c.w / sp).toFixed(2), headIn: heads.some((hd) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1), k: ctx.best(c, ['sharp', 'flat', 'natural', 'dflat'], sp * 1.8) });
    if (heads.some((hd) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1)) continue;
    // nor one with another note's stem in it (the flag of the note before)
    if (heads.some((q) => q.stem && q.stem.x >= c.x0 + 1 && q.stem.x <= c.x1 - 1 && q.stem.top < c.y1 - sp * 0.5 && q.stem.bot > c.y0 + sp * 0.5)) continue;
    const near = heads.filter((hd) => hd.left - c.x1 > -sp * 0.15 && hd.left - c.x1 < sp * 1.6 && hd.cy > c.y0 - sp * 0.3 && hd.cy < c.y1 + sp * 0.3);
    if (!near.length) continue;
    if (isAcc.has(c.id)) continue;
    const k = ctx.best(c, ['sharp', 'flat', 'natural', 'dflat'], sp * 1.8);
    if (k.d > 0.42) continue;
    const a = { sharp: 1, flat: -1, natural: 0, dflat: -2 }[k.cls];
    // which head: sharps and naturals are centred on their note, a flat's bowl is
    const want = k.cls === 'flat' || k.cls === 'dflat' ? c.y1 - sp * 0.55 : (c.y0 + c.y1) / 2;
    near.sort((p, q) => Math.abs(p.cy - want) - Math.abs(q.cy - want));
    if (Math.abs(near[0].cy - want) < sp * 0.6 && near[0].acc === undefined) { near[0].acc = a; isAcc.add(c.id); accCls.set(c.id, k.cls); if (k.with) isAcc.add(k.with.id); }
  }
  // accidentals that touch their note (close engraving, small print, blur): look in a window just
  // before each head instead of at whole shapes
  const slurAcc = globalThis.__slurAcc ?? 1;
  for (const hd of heads) {
    if (globalThis.__accWin && Math.abs(hd.cx - globalThis.__accWin[0]) < sp * 3 && Math.abs(hd.cy - globalThis.__accWin[1]) < sp * (globalThis.__accWinY ?? 3)) globalThis.__accWin.push(['HEAD', Math.round(hd.cx), Math.round(hd.cy), Math.round(hd.left), hd.acc]);
    if (hd.acc !== undefined || hd.left < startX) continue;
    let bestK = null;
    for (const [cls, W, up, dn] of [['sharp', 1.05, 1.6, 1.6], ...(globalThis.__wideSharp ?? 1 ? [['sharp', 1.25, 1.9, 1.9]] : []), ['natural', 0.8, 1.6, 1.6], ['natural', 0.8, 2.0, 2.0], ['flat', 1.0, 2.15, 0.8], ...(globalThis.__tallFlat ?? 1 ? [['flat', 1.0, 2.7, 0.8]] : [])]) {
      const ya = Math.round(hd.cy - up * sp), yb = Math.round(hd.cy + dn * sp);
      for (let x = Math.round(hd.left - sp * 2.2); x <= Math.round(hd.left - sp * (W + 0.03)); x++) {
        const xb = Math.min(Math.round(x + W * sp), Math.round(hd.left - sp * 0.04));
        const boxIn = (I) => {
          let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
          for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) for (let xx = Math.max(0, x); xx <= xb; xx++) if (I[y * w + xx]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          return [x0, x1, y0, y1];
        };
        let [x0, x1, y0, y1] = boxIn(C);
        // (a slur or tie run into the sign: its box without the thin curves)
        if (x1 >= 0 && (y0 <= ya || y1 >= yb) && slurAcc) { const b = boxIn(ctx.D); if (b[1] >= 0 && b[2] > ya && b[3] < yb) [x0, x1, y0, y1] = b; }
        if (x1 < 0 || x0 > x + sp * 0.2 || (y1 - y0) < sp * (cls === 'flat' ? 1.8 : 2.0) || x1 - x0 < sp * 0.35) continue;
        // not cut off at the edges of the window (then it is part of something bigger)
        let cutK = false;
        if (y0 <= ya || y1 >= yb) { if (!(globalThis.__cutSign ?? 1) || cls === 'flat' || (y0 <= ya && y1 >= yb)) continue; cutK = true; }
        const se = globalThis.__stemEdge ?? 1;
        // (a 'note' sitting at the sign itself, its stroke read as a stem, is part of the sign)
        const atSign = (q) => (globalThis.__atSign ?? 1) && q.cy > y0 && q.cy < y1 && (((q.hollow || !q.stem) && q.cx > x0 - sp * 0.4 && q.cx < x1) || (q.cx > x0 + sp * 0.15 && q.cx < x1 - sp * 0.15));
        if (heads.some((q) => q !== hd && q.stem && !atSign(q) && q.stem.x >= x0 + (se ? -1 : 1) && q.stem.x <= x1 - 1 && q.stem.top < y1 - sp * 0.5 && q.stem.bot > y0 + sp * 0.5)) continue;
        // (nor starting inside the head of the note before: its edge, and a slur or stem by it, can look like a sign)
        if ((globalThis.__winHead ?? 1) && heads.some((q) => q !== hd && !atSign(q) && q.cx < x0 && (q.left ?? q.cx - sp * 0.65) < x0 - sp * 0.5 && Math.max(q.right ?? 0, (q.left ?? q.cx - sp * 0.65) + sp * 1.42) > x0 && q.cy > y0 + sp * 0.2 && q.cy < y1 - sp * 0.2)) continue;
        // (nor the flag of the note just before, hanging off its stem)
        // (a beamed note has no flag: there, only a box reaching up or down to its beam)
        if (cls === 'flat' && heads.some((q) => { if (q === hd || !q.stem || !q.beams || q.cx >= hd.cx || x0 < q.stem.x - 2 || x0 - q.stem.x >= sp * 1.2) return false; const r = q.bg != null && (globalThis.__bgFlag ?? 1) ? (globalThis.__bgR ?? 0.6) : 2.5; return q.stem.up ? y0 < q.stem.top + sp * r : y1 > q.stem.bot - sp * r; })) continue;
        const k = classify(shapeOf(C, w, x0, y0, x1, y1, sp), ['sharp', 'natural', 'flat', 'r4', 'r8', 'r16', 'd4', 'd1']);
        if (globalThis.__accWin && Math.abs(hd.cx - globalThis.__accWin[0]) < sp && Math.abs(hd.cy - globalThis.__accWin[1]) < sp * 2) globalThis.__accWin.push([cls, x, k.cls, +k.d.toFixed(3), +((y1 - y0) / sp).toFixed(2), x0, x1, y0, y1]);
        if (k.cls === cls && k.d < (cutK ? (globalThis.__cutD ?? 0.22) : cls === 'natural' ? (globalThis.__natWin ?? 0.36) : 0.34) && (!bestK || k.d < bestK.d)) bestK = { ...k, x0, x1, y0, y1 };
      }
    }
    if (!bestK) continue;
    // centred on this note (a flat's bowl on it)
    const want = bestK.cls === 'flat' ? bestK.y1 - sp * 0.55 : (bestK.y0 + bestK.y1) / 2;
    if (Math.abs(want - hd.cy) > sp * 0.45) continue;
    hd.acc = { sharp: 1, natural: 0, flat: -1 }[bestK.cls];
    accBoxesW.push(bestK);
  }
  // double sharps: a small x just before the head
  for (const hd of heads) {
    if (hd.acc !== undefined || hd.left < startX) continue;
    for (const c of compsC) {
      if (c.x1 > hd.left || hd.left - c.x1 > sp * 0.8 || c.h > sp * 0.85 || c.h < sp * 0.4 || c.w > sp * 0.9 || c.w < sp * 0.4) continue;
      if (Math.abs((c.y0 + c.y1) / 2 - hd.cy) > sp * 0.35) continue;
      const k = classify(shapeOf(C, w, c.x0, c.y0, c.x1, c.y1, sp, labC, c.id), ['dsharp']);
      if (k.d < 0.33) { hd.acc = 2; isAcc.add(c.id); }
    }
  }
  // a 'head' inside an accidental is the bowl of a flat or the middle of a sharp
  const accBoxes = compsC.filter((c) => isAcc.has(c.id));
  heads = heads.filter((hd) => ![...accBoxes, ...accBoxesW].some((c) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1) && !((globalThis.__accEdge ?? 1) && accBoxesW.some((c) => hd.acc === undefined && hd.cx > c.x0 - sp * 0.35 && hd.cx <= c.x0 && hd.cy > c.y0 && hd.cy < c.y1)));
  if (TR) trk(966, heads);
  // ---- rests
  const rests = [];
  const { D, compsD, labD } = ctx;
  const allAcc = [...accBoxes, ...accBoxesW];
  // whole shapes first; where a slur or tie runs into a shape, its pieces without the thin curves
  const tooBig = compsC.filter((c) => (c.w > sp * 1.8 || c.h > sp * 4.2) && c.x1 > startX && c.x0 < s.x1 && band((c.y0 + c.y1) / 2));
  const restCands = [
    ...compsC.filter((c) => !(c.w > sp * 1.8 || c.h > sp * 4.2)).map((c) => ({ c, img: C, lab: labC })),
    ...compsD.filter((c) => tooBig.some((g) => c.x0 >= g.x0 && c.x1 <= g.x1 && c.y0 >= g.y0 && c.y1 <= g.y1)).map((c) => ({ c, img: D, lab: labD })),
  ];
  for (const { c, img, lab } of restCands) {
    const why = (r) => { if (ctx.dbg && globalThis.__restWhy && Math.abs(c.x0 - globalThis.__restWhy) < sp * 2) (ctx.restTrace = ctx.restTrace || []).push({ why: r, x0: c.x0, y0: c.y0, w: c.w, h: c.h }); };
    why('start');
    if (c.n < sp * sp * 0.08) { why('c1'); continue; }
    if (c.x0 < startX - sp * 0.1 || c.x1 > s.x1 + sp * 0.3) { why('c2'); continue; }
    if (allAcc.some((q) => c.x0 < q.x1 && c.x1 > q.x0 && c.y0 < q.y1 && c.y1 > q.y0)) { why('c3'); continue; }
    const cyc = (c.y0 + c.y1) / 2, pc = pAt(s, cyc, (c.x0 + c.x1) / 2);
    if (pc < -1 || pc > 9) { why('c5'); continue; }
    if (heads.some((hd) => hd.cx > c.x0 - sp * 0.3 && hd.cx < c.x1 + sp * 0.3 && hd.cy > c.y0 - sp * 0.6 && hd.cy < c.y1 + sp * 0.6)) { why('c6'); continue; }
    if (heads.some((hd) => hd.stem && hd.stem.x >= c.x0 - 1 && hd.stem.x <= c.x1 + 1 && ((hd.stem.top <= c.y1 && hd.stem.bot >= c.y0)))) { why('c7'); continue; }
    if (c.w > sp * 1.8 || c.h > sp * 4.2 || c.h < sp * 0.3) { why('c8'); continue; }
    let t = null;
    if (ctx.dbg && c.h > sp * 1.3) (ctx.restTrace = ctx.restTrace || []).push({ x0: c.x0, w: +(c.w / sp).toFixed(2), h: +(c.h / sp).toFixed(2), pc: +pc.toFixed(1), k: classify(shapeOf(img, w, c.x0, c.y0, c.x1, c.y1, sp, lab, c.id), ['r4', 'r8', 'r16', 'r32', 'sharp', 'flat', 'natural', 'treble', 'bass', 'alto', 'd2', 'd3', 'd4', 'd6', 'd8']) });
    if (c.h < sp * 0.95 && c.w > sp * 0.8 && c.w < sp * 1.7 && c.n > c.w * c.h * 0.7) {
      // a block: hanging from the 4th line is a whole rest, sitting on the middle line a half rest
      const l6 = yAt(s, 6, c.x0), l4 = yAt(s, 4, c.x0);
      if (Math.abs(c.y0 - (l6 - T / 2)) < sp * 0.3) t = 1; else if (Math.abs(c.y1 - (l4 + T / 2)) < sp * 0.3) t = 2;
    } else if (c.h > sp * 1.05) {
      const k = classify(shapeOf(img, w, c.x0, c.y0, c.x1, c.y1, sp, lab, c.id), ['r4', 'r8', 'r16', 'r32', 'sharp', 'flat', 'natural', 'treble', 'bass', 'alto', 'd2', 'd3', 'd4', 'd6', 'd8']);
      if (k.d < 0.36 && k.cls[0] === 'r') t = { r4: 4, r8: 8, r16: 16, r32: 32 }[k.cls];
      // (handwritten: the loose comparison, when clear, and where a rest stands, about the middle)
      else if (c.h < sp * 3.2 && pc > 1.5 && pc < 7.5) {
        const lz = classifyLoose(shapeOf(img, w, c.x0, c.y0, c.x1, c.y1, sp, lab, c.id), ['r4', 'r8', 'r16', 'sharp', 'flat', 'natural', 'd2', 'd3', 'd4', 'd7', 'd1']);
        if (lz[0] && lz[0].cls[0] === 'r' && lz[0].d < 0.1 && (!lz[1] || lz[1].d - lz[0].d > 0.015)) t = { r4: 4, r8: 8, r16: 16 }[lz[0].cls];
        if (ctx.dbg) (ctx.restTrace = ctx.restTrace || []).push({ looseRest: c.x0, lz: lz.slice(0, 2) });
      }
    }
    if (t) {
      // a dot just after the rest
      const dot = compsC.some((q) => q !== c && q.x0 > c.x1 && q.x0 < c.x1 + sp * 1.0 && q.w < sp * 0.7 && q.h < sp * 0.7 && q.w > sp * 0.17 && q.h > sp * 0.17 && Math.abs(pAt(s, (q.y0 + q.y1) / 2, q.x0) - 5) < 2.2);
      rests.push({ x: c.x0, t, cx: (c.x0 + c.x1) / 2, w: c.w, dots: dot ? 1 : 0 });
    }
  }
  // ---- clef and time changes along the line (a clef in the middle of a line is drawn smaller)
  const signs = [];
  {
    const onStaffC = (c) => c.y1 > yAt(s, 8, c.x0) + sp * 0.3 && c.y0 < yAt(s, 0, c.x0) - sp * 0.3;
    const used = new Set();
    if ((ctx.dbg || globalThis.__sigDbg) && globalThis.__compX) (ctx.signTrace = ctx.signTrace || []).push({ near: compsC.filter((c) => c.x1 > globalThis.__compX[0] && c.x0 < globalThis.__compX[1] && c.y1 > s.top - sp * 3 && c.y0 < s.bottom + sp * 3).map((c) => [c.x0, c.x1, c.y0, c.y1, c.x0 > startX + sp * 0.5, onStaffC(c), isAcc.has(c.id), ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s]) });
    const clefBar = globalThis.__clefBar ?? 1;
    // (a shape across the staves, a barline with a clef run into it, is looked at below, for its pieces)
    const spans = (c) => clefBar && c.h > sp * 6 && c.w > sp * 1.2 && c.y0 <= s.top + sp * 0.5 && c.y1 >= s.bottom - sp * 0.5;
    const cands = compsC.filter((c) => (c.x0 > startX + sp * 0.5 || (spans(c) && c.x1 > startX + sp * 2)) && c.x1 < s.x1 + sp * 0.5 && onStaffC(c) && !isAcc.has(c.id) && (ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s || spans(c))).map((c) => (ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s ? c : { ...c, spanning: true })).sort((a, b2) => a.x0 - b2.x0);
    // (a note whose head is inside the shape: not a clef. A note just beside it may touch it)
    const noteIn = (x0, x1, y0, y1) => heads.some((hd) => hd.cx > x0 + sp * 0.3 && hd.cx < x1 - sp * 0.3 && hd.cy > y0 && hd.cy < y1 && (hd.stem ? hd.stem.x > x0 + 2 && hd.stem.x < x1 - 2 : true));
    // (a clef touching a barline (its dots run into it, or the barline joins it to the staff above):
    // the shapes the ink of this staff makes once the barlines are taken out of it)
    if (clefBar) for (let ci = cands.length - 1; ci >= 0; ci--) {
      const c = cands[ci];
      if (!(c.w > sp * 3.2 || c.h > sp * 8.5)) continue;
      const tY = Math.round(yAt(s, 8, c.x0)), bY = Math.round(yAt(s, 0, c.x0));
      const ya = Math.max(c.y0, Math.round(tY - sp * 1.5)), yb = Math.min(c.y1, Math.round(bY + sp * 1.5));
      const ids = new Set(Array.isArray(c.id) ? c.id : [c.id]);
      const mine = (k) => C[k] && ids.has(labC[k]);
      const across = (x) => { for (let y = tY + 1; y <= bY - 1; y++) if (!mine(y * w + x)) return false; return true; };
      const cut = new Uint8Array(c.x1 - c.x0 + 1); let nCut = 0;
      for (let x = c.x0; x <= c.x1; x++) if (across(x)) { cut[x - c.x0] = 1; nCut++; }
      if (!nCut) continue;
      const W2 = c.x1 - c.x0 + 1, H2 = yb - ya + 1, seen = new Uint8Array(W2 * H2), pieces = [];
      for (let y = ya; y <= yb; y++) for (let x = c.x0; x <= c.x1; x++) {
        const q = (y - ya) * W2 + (x - c.x0);
        if (seen[q] || cut[x - c.x0] || !mine(y * w + x)) continue;
        let x0 = x, x1 = x, y0 = y, y1 = y, n = 0; const st = [q]; seen[q] = 1;
        while (st.length) { const v = st.pop(), vx = v % W2, vy = (v - vx) / W2; n++; const X = vx + c.x0, Y = vy + ya; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = vx + dx, ny = vy + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; const u = ny * W2 + nx; if (seen[u] || cut[nx] || !mine((ny + ya) * w + nx + c.x0)) continue; seen[u] = 1; st.push(u); } }
        if (x0 > startX + sp * 0.5 && y1 - y0 >= sp * 1.7 && y1 - y0 <= sp * 8.5 && x1 - x0 >= sp * 0.9 && x1 - x0 <= sp * 3.2 && n > sp * sp * 0.5) pieces.push({ ...c, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n, cut: true, spanning: false });
      }
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ pre: c.x0, nCut, pieces: pieces.map((q) => [q.x0, q.x1, q.y0, q.y1]) });
      if (pieces.length) cands.splice(ci, 1, ...pieces);
    }
    const cClefShape = (x0, x1, y0, y1) => {
      if (y1 - y0 < sp * 2.4 || y1 - y0 > sp * 4.6 || x1 - x0 < sp * 1.0 || x1 - x0 > sp * 2.4) return false;
      // (the thick bar: several full columns side by side; a sharp's or a natural's strokes are thin)
      let run = 0, best = 0, runs = 0;
      for (let x = x0; x <= x0 + sp * 0.8; x++) { let n = 0; for (let y = y0; y <= y1; y++) if (C[y * w + x]) n++; if (n >= (y1 - y0 + 1) * 0.88) { if (!run) runs++; run++; best = Math.max(best, run); } else run = 0; }
      const top = pAt(s, y0, (x0 + x1) / 2), bot = pAt(s, y1, (x0 + x1) / 2);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ cBars: x0, runs, best, bestSp: +(best / sp).toFixed(2), wSp: +((x1 - x0) / sp).toFixed(2), hSp: +((y1 - y0) / sp).toFixed(2), top: +top.toFixed(1), bot: +bot.toFixed(1), sp: +sp.toFixed(1) });
      // (a C clef is the same above and below its middle line: a note with its stem and an
      // accidental beside it is not)
      let both = 0, any = 0; const H = y1 - y0;
      for (let yy = 0; yy <= H / 2; yy++) for (let x = x0; x <= x1; x++) { const a1 = C[(y0 + yy) * w + x], b1 = C[(y1 - yy) * w + x]; if (a1 || b1) { any++; if (a1 && b1) both++; } }
      const sym = any ? both / any : 0;
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ cSym: x0, sym: +sym.toFixed(2) });
      if (sym < (globalThis.__cSym ?? 0.7)) return false;
      return runs >= 1 && best >= Math.max(3, sp * (globalThis.__cBarW ?? 0.15)) && x1 - x0 >= sp * 1.3 && top <= 10.5 && bot >= -2.5;
    };
    // (a C clef run into the notes before it, by a ledger line or a beam: its right part, where it
    // stands alone as a C clef)
    if (globalThis.__clefTrail ?? 1) for (let ci = cands.length - 1; ci >= 0; ci--) {
      const c = cands[ci];
      if (c.cut || c.spanning || c.w <= sp * 3.2) continue;
      const ids = Array.isArray(c.id) ? c.id : [c.id], idS = new Set(ids);
      const tY = Math.round(yAt(s, 8, c.x1)), bY = Math.round(yAt(s, 0, c.x1));
      // (inside the staff only: a ledger line above or below may run into the clef)
      const ya = Math.max(c.y0, Math.round(tY - sp * 0.45)), yb = Math.min(c.y1, Math.round(bY + sp * 0.45));
      let found = null;
      for (let xl = Math.round(c.x1 - sp * 2.6); xl <= c.x1 - sp * 1.2 && !found; xl += Math.max(1, Math.round(sp * 0.1))) {
        // a white column (in this shape) just left of it: the clef stands apart from the notes there
        let gap = true; for (let y = ya; y <= yb && gap; y++) { const q = y * w + xl - 1; if (C[q] && idS.has(labC[q])) gap = false; }
        if (!gap) continue;
        let y0 = Infinity, y1 = -1, x1b = -1; for (let y = ya; y <= yb; y++) for (let x = xl; x <= c.x1; x++) { const q = y * w + x; if (C[q] && idS.has(labC[q])) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x > x1b) x1b = x; } }
        if (y1 < 0) continue;
        if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ trTry: c.x0, xl, x1b, w: +((x1b - xl) / sp).toFixed(2), h: +((y1 - y0) / sp).toFixed(2) });
        if (cClefShape(xl, x1b, y0, y1)) found = { x0: xl, x1: x1b, y0, y1 };
      }
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ trail: c.x0, x1: c.x1, ya, yb, found });
      if (found) cands.push({ ...c, ...found, w: found.x1 - found.x0 + 1, h: found.y1 - found.y0 + 1, cut: true, trail: true });
    }
    // (a C clef inside a beamed group, under the beam: a part standing apart, a white column on
    // either side of it within the staff, that reads as a C clef)
    if (globalThis.__clefMid ?? 1) for (let ci = cands.length - 1; ci >= 0; ci--) {
      const c = cands[ci];
      if (c.cut || c.spanning || c.w <= sp * 3.2) continue;
      const ids = Array.isArray(c.id) ? c.id : [c.id], idS = new Set(ids);
      const tY = Math.round(yAt(s, 8, (c.x0 + c.x1) / 2)), bY = Math.round(yAt(s, 0, (c.x0 + c.x1) / 2));
      const ya = Math.max(c.y0, Math.round(tY - sp * 0.45)), yb = Math.min(c.y1, Math.round(bY + sp * 0.45));
      const white = (x) => { for (let y = ya; y <= yb; y++) { const q = y * w + x; if (C[q] && idS.has(labC[q])) return false; } return true; };
      let found = null;
      for (let xl = Math.round(c.x0 + sp * 0.3); xl <= c.x1 - sp * 2.6 && !found; xl++) {
        if (!white(xl - 1) || white(xl)) continue;
        let xr = -1; for (let x = Math.round(xl + sp * 0.9); x <= Math.min(c.x1 - 1, xl + sp * 2.4); x++) if (white(x)) { xr = x - 1; break; }
        if (xr < 0) continue;
        let y0 = Infinity, y1 = -1; for (let y = ya; y <= yb; y++) for (let x = xl; x <= xr; x++) { const q = y * w + x; if (C[q] && idS.has(labC[q])) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        if (y1 < 0) continue;
        if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ midTry: c.x0, xl, xr, w: +((xr - xl) / sp).toFixed(2), h: +((y1 - y0) / sp).toFixed(2) });
        if (cClefShape(xl, xr, y0, y1)) found = { x0: xl, x1: xr, y0, y1 };
      }
      if (found) cands.push({ ...c, ...found, w: found.x1 - found.x0 + 1, h: found.y1 - found.y0 + 1, cut: true, trail: true });
    }
    // (a clef run into the notes after it, a ledger line or a beam: its left part, where that reads
    // clearly as a clef)
    if (globalThis.__clefLead ?? 1) for (let ci = cands.length - 1; ci >= 0; ci--) {
      const c = cands[ci];
      if (c.cut || c.spanning || c.w <= sp * 3.2 || c.x0 <= startX + sp * 0.5) continue;
      const ids = Array.isArray(c.id) ? c.id : [c.id], idS = new Set(ids);
      const tY = Math.round(yAt(s, 8, c.x0)), bY = Math.round(yAt(s, 0, c.x0));
      const ya = Math.max(c.y0, Math.round(tY - sp * 2.5)), yb = Math.min(c.y1, Math.round(bY + sp * 2.5));
      let best = null;
      for (let xr = Math.round(c.x0 + sp * 1.6); xr <= c.x0 + sp * 3.0; xr += Math.max(1, Math.round(sp * 0.1))) {
        let y0 = Infinity, y1 = -1; for (let y = ya; y <= yb; y++) for (let x = c.x0; x <= xr; x++) { const q = y * w + x; if (C[q] && idS.has(labC[q])) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        if (y1 - y0 < sp * 3.4) continue;
        const kk = classify(shapeOf(C, w, c.x0, y0, xr, y1, sp, labC, ids), ['treble', 'bass', 'alto', 'r4', 'd2', 'd3', 'd4', 'd5', 'd6', 'd8']);
        if (kk.cls === 'treble' && (!best || kk.d < best.d)) best = { d: kk.d, xr, y0, y1 };
      }
      const holesIn = (b) => { let n = 0; for (let y = b.y0; y <= b.y1; y++) for (let x = c.x0; x <= b.xr; x++) if (ctx.holes[y * w + x]) n++; return n / (sp * sp); };
      if (best) best.holes = +holesIn(best).toFixed(2);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ lead: c.x0, best });
      if (best && best.d < 0.3 && best.holes >= 0.3) { const tp = pAt(s, best.y0, c.x0 + sp), bp = pAt(s, best.y1, c.x0 + sp); if (tp > 8.6 && bp < 1.2) cands.push({ ...c, x1: best.xr, y0: best.y0, y1: best.y1, w: best.xr - c.x0 + 1, h: best.y1 - best.y0 + 1, cut: true, lead: true }); }
    }
    cands.sort((a2, b2) => a2.x0 - b2.x0);
    for (let ci = cands.length - 1; ci >= 0; ci--) if (cands[ci].spanning) cands.splice(ci, 1);
    for (const c of cands) {
      if ((ctx.dbg || globalThis.__sigDbg) && c.h > sp * 1.7) (ctx.signTrace = ctx.signTrace || []).push({ pre: c.x0, w: +(c.w / sp).toFixed(2), h: +(c.h / sp).toFixed(2), note: noteIn(c.x0, c.x1, c.y0, c.y1) });
      if (used.has(c) || c.h < sp * 1.7 || c.h > sp * 8.5 || c.w > sp * 3.2 || c.w < sp * 0.25) continue;
      // with any pieces of it just beside (the two dots of a bass clef, the bars and the bracket of a C clef)
      const parts = cands.filter((q) => q !== c && !used.has(q) && q.x0 < c.x1 + sp * 0.6 && q.x1 > c.x0 - sp * 0.2 && q.x1 - c.x0 < sp * 3.2 && Math.min(q.y1, c.y1) - Math.max(q.y0, c.y0) > -sp * 0.6 && q.h < sp * 8.5 && !(c.trail && (q.w > sp * 3.2 || q.x0 < c.x0 - sp * 0.2)));
      const all = [c, ...parts.filter((q) => q.h > sp * 0.9)];
      const x0 = Math.min(...all.map((q) => q.x0)), x1 = Math.max(...all.map((q) => q.x1)), y0 = Math.min(...all.map((q) => q.y0)), y1 = Math.max(...all.map((q) => q.y1));
      const ids = all.flatMap((q) => (Array.isArray(q.id) ? q.id : [q.id]));
      const shC = shapeOf(C, w, x0, y0, x1, y1, sp, labC, ids);
      const CLS = ['treble', 'bass', 'alto', 'sharp', 'flat', 'natural', 'r4', 'r8', 'd2', 'd3', 'd4', 'd5', 'd6', 'd8'];
      let k = classify(shC, CLS);
      // (a small clef in the middle of a line is often thicker or thinner than the fonts': the loose
      // comparison decides between the clefs and the rest)
      const lz = classifyLoose(shC, CLS);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ loose: x0, l: lz.slice(0, 3).map((q) => [q.cls, +q.d.toFixed(3)]) });
      // (a bass clef has its two dots: one each side of the 4th line, just right of it)
      const bassDots = () => { const xa = x1 + 1, xb = x1 + sp * 0.9; const dot = (p) => { const y = yAt(s, p, x1); return compsC.some((q) => q.x0 >= xa - 2 && q.x1 <= xb && q.w < sp * 0.6 && q.h < sp * 0.6 && q.w > sp * 0.15 && Math.abs((q.y0 + q.y1) / 2 - y) < sp * 0.35); }; return dot(5) && dot(7); };
      // (a C clef: on its left, a solid upright bar (and a thin one) the whole height of the sign)
      const cBars = () => cClefShape(x0, x1, y0, y1);
      // (a C clef, by its bars, when the likeness puts it among the first few)
      if ((globalThis.__cBars ?? 1) && !(['treble', 'bass', 'alto'].includes(k.cls) && k.d <= 0.38) && lz.slice(0, 3).some((q) => q.cls === 'alto' && q.d < 0.22) && cBars()) k = { cls: 'alto', d: 0.3 };
      if ((!['treble', 'bass', 'alto'].includes(k.cls) || k.d > 0.38) && lz[0] && ['treble', 'bass', 'alto'].includes(lz[0].cls) && lz[0].d < 0.2 && (!lz[1] || lz[1].d - lz[0].d > 0.015 || (lz[0].cls === 'bass' && bassDots()) || (lz[0].cls === 'alto' && (globalThis.__cBars ?? 1) && cBars()))) k = { cls: lz[0].cls, d: 0.3 };
      // (but a bass clef's two dots, either side of its line, are not a note's)
      const inkDots = () => { const tY = yAt(s, 8, x1), bY = yAt(s, 0, x1); const full = (x) => { for (let y = Math.round(tY) + 1; y < bY - 1; y++) if (!C[y * w + x]) return false; return true; };
        const dot = (p) => { const y = Math.round(yAt(s, p, x1)); let n = 0; for (let x = x1 + 1; x <= Math.round(x1 + sp * 0.8); x++) { if (full(x)) continue; for (let yy = y - Math.round(sp * 0.3); yy <= y + Math.round(sp * 0.3); yy++) if (C[yy * w + x]) n++; } return n >= sp * sp * 0.06 && n <= sp * sp * 0.5; };
        const gap = (p) => { const y = Math.round(yAt(s, p, x1)); let n = 0; for (let x = x1 + 1; x <= Math.round(x1 + sp * 0.8); x++) { if (full(x)) continue; if (C[y * w + x]) n++; } return n; };
        return dot(7) && dot(5) && gap(6) <= sp * 0.5; };
      // (a bass clef drawn thinner than the fonts': where a bass clef stands, with its two dots, and
      // like one at least loosely)
      if ((globalThis.__bassGeo ?? 1) && !(['treble', 'bass', 'alto'].includes(k.cls) && k.d <= 0.38)) {
        const tp = pAt(s, y0, (x0 + x1) / 2), bp = pAt(s, y1, (x0 + x1) / 2);
        const lb = lz.slice(0, 3).find((q) => q.cls === 'bass');
        if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ bassGeo: x0, tp: +tp.toFixed(1), bp: +bp.toFixed(1), lb: lb && +lb.d.toFixed(3) });
        if (tp > 7 && tp < 10.3 && bp > 0.3 && bp < 3.6 && x1 - x0 >= sp * 1.2 && x1 - x0 <= sp * 2.8 && lb && lb.d < 0.35 && inkDots()) k = { cls: 'bass', d: 0.3 };
      }
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ cand: x0, w: +((x1 - x0) / sp).toFixed(2), h: +((y1 - y0) / sp).toFixed(2), k: k.cls, d: +k.d.toFixed(3) });
      // a note inside it is believed over a weak likeness

      if (!['treble', 'bass', 'alto'].includes(k.cls) || k.d > 0.38) continue;
      const trustBass = ((globalThis.__bassDots ?? 1) && k.cls === 'bass' && k.d <= 0.38 && inkDots()) || ((globalThis.__cBars ?? 1) && k.cls === 'alto' && k.d <= 0.38 && cBars());
      if (ctx.dbg && k.cls === 'bass') (ctx.signTrace = ctx.signTrace || []).push({ cand: x0, bassTrust: trustBass, x1, y7: Math.round(yAt(s, 7, x1)), y5: Math.round(yAt(s, 5, x1)) });
      // (a shape cut out from a barline is believed only as a clear treble clef or a bass clef with its dots)
      if (c.cut && !trustBass && !(k.cls === 'treble' && k.d < 0.3)) continue;
      if (!trustBass && (k.d > 0.3 || ((globalThis.__looseNote ?? 1) && k.d >= 0.3)) && noteIn(x0, x1, y0, y1)) continue;
      if ((x1 - x0) < sp * 0.9) continue;
      const top = pAt(s, y0, (x0 + x1) / 2), bot = pAt(s, y1, (x0 + x1) / 2);
      let name = null;
      if (k.cls === 'treble' && top > 8.6 && bot < 1.2 && (y1 - y0) > sp * 3.4) name = 'treble';
      else if (k.cls === 'bass' && top > 5 && bot > 0.5) name = 'bass';
      else if (k.cls === 'alto') { const mid = (top + bot) / 2; name = cLine(mid); }
      if (!name) continue;
      for (const q of all) used.add(q);
      for (const q of parts) if (q.w < sp * 0.7 && q.h < sp * 0.7) used.add(q);
      signs.push({ x: x0, x1, clef: name });
      // what was read inside the clef (its curls look like heads, its bars like stems) goes
      for (let k2 = heads.length - 1; k2 >= 0; k2--) if (heads[k2].cx > x0 - sp * 0.1 && heads[k2].cx < x1 + sp * 0.1 && heads[k2].cy > y0 - sp * 0.2 && heads[k2].cy < y1 + sp * 0.2) heads.splice(k2, 1);
      for (let k2 = merged.length - 1; k2 >= 0; k2--) if (merged[k2].x > x0 - sp * 0.2 && merged[k2].x < x1 + sp * 0.2) merged.splice(k2, 1);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ clef: name, x0, d: +k.d.toFixed(3) });
    }
    // time signatures: two digits one above the other, filling the staff, with no note there
    const digitsIn = cands.filter((c) => !used.has(c) && !c.cut && c.h > sp * 1.1 && c.h < sp * 2.8 && c.w > sp * 0.6 && c.w < sp * 2.6 && !noteIn(c.x0, c.x1, c.y0, c.y1));
    for (const a of digitsIn) {
      if (used.has(a)) continue;
      const pa = pAt(s, (a.y0 + a.y1) / 2, a.x0);
      if (pa < 4.5 || pa > 8.5) continue;
      const b2 = digitsIn.find((q) => q !== a && !used.has(q) && Math.abs((q.x0 + q.x1) / 2 - (a.x0 + a.x1) / 2) < sp * 0.8 && pAt(s, (q.y0 + q.y1) / 2, q.x0) < 3.5 && pAt(s, (q.y0 + q.y1) / 2, q.x0) > -0.5);
      if (!b2) continue;
      const rd = (c) => { const cl = readDigitBox(ctx, sp, { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, ids: c.id }); return cl ? cl.filter((q) => q.v)[0] : { v: 0, e: 9, l: 9 }; };
      const u = rd(a), d = rd(b2);
      if (!(u.e < 0.42 || u.l < 0.15) || !(d.e < 0.42 || d.l < 0.15) || ![2, 4, 8, 16].includes(d.v)) continue;
      used.add(a); used.add(b2);
      signs.push({ x: Math.min(a.x0, b2.x0), x1: Math.max(a.x1, b2.x1), time: [u.v, d.v] });
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ time: [u.v, d.v], x0: a.x0 });
    }
    // or the two digits touching, one tall shape the height of the staff: cut where it is thinnest,
    // about the middle line (a head read in a digit's hole is not a note)
    // (also without thin curves: a slur running into the digits joins them to it)
    const candsD = ctx.compsD.filter((c) => c.x0 > startX + sp * 0.5 && c.x1 < s.x1 + sp * 0.5 && onStaffC(c) && ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s);
    for (const [c, img, lab] of [...cands.filter((c) => !c.cut).map((c) => [c, C, labC]), ...candsD.map((c) => [c, ctx.D, ctx.labD])]) {
      if (signs.some((g) => g.time && c.x0 < g.x1 && c.x1 > g.x0)) continue;
      if (used.has(c) || c.h < sp * 3.3 || c.h > sp * 4.8 || c.w < sp * 0.8 || c.w > sp * 2.4) continue;
      const pt = pAt(s, c.y0, c.x0), pb = pAt(s, c.y1, c.x0);
      const why = (r) => { if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ cutNo: c.x0, r }); };
      if (pt < 7.2 || pt > 9.6 || pb > 0.8 || pb < -1.6) { why(['p', pt, pb]); continue; }
      if (heads.some((hd) => hd.stem && !(hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1) && hd.stem.x > c.x0 + 2 && hd.stem.x < c.x1 - 2 && hd.stem.top < c.y1 && hd.stem.bot > c.y0)) continue;
      const ym = yAt(s, 4, (c.x0 + c.x1) / 2);
      let cut = -1, least = Infinity;
      for (let y = Math.round(ym - sp * 0.5); y <= Math.round(ym + sp * 0.5); y++) {
        let n = 0; for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) n++;
        if (n < least) { least = n; cut = y; }
      }
      if (cut < 0 || least > c.w * 0.45) { why(['cut', least]); continue; }
      const box = (y0, y1) => { let a = Infinity, z = -1, t = Infinity, b = -1; for (let y = y0; y <= y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) { if (x < a) a = x; if (x > z) z = x; if (y < t) t = y; if (y > b) b = y; } return z < 0 ? null : { x0: a, x1: z, y0: t, y1: b }; };
      const A = box(c.y0, cut - 1), Bx = box(cut + 1, c.y1);
      if (!A || !Bx || A.y1 - A.y0 < sp * 1.2 || Bx.y1 - Bx.y0 < sp * 1.2 || A.x1 - A.x0 < sp * 0.6 || Bx.x1 - Bx.x0 < sp * 0.6 || Math.abs((A.x0 + A.x1) - (Bx.x0 + Bx.x1)) / 2 > sp * 0.6) continue;
      const rd = (q) => { const cl = readDigitBox(ctx, sp, { ...q, ids: c.id }, img, lab); return cl ? cl.filter((r) => r.v)[0] : { v: 0, e: 9, l: 9 }; };
      const u = rd(A), d = rd(Bx);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ timeCut: c.x0, u, d });
      if (!(u.e < 0.42 || u.l < 0.15) || !(d.e < 0.42 || d.l < 0.15) || ![2, 4, 8, 16].includes(d.v)) continue;
      used.add(c);
      signs.push({ x: c.x0, x1: c.x1, time: [u.v, d.v] });
      for (let k2 = heads.length - 1; k2 >= 0; k2--) if (heads[k2].cx > c.x0 && heads[k2].cx < c.x1 && heads[k2].cy > c.y0 && heads[k2].cy < c.y1) heads.splice(k2, 1);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ time: [u.v, d.v], x0: c.x0, cut: true });
    }
    // (the two digits may touch the middle line, and so each other: one tall shape filling the staff)
    for (const c of cands.filter((q) => !q.cut)) {
      if (used.has(c) || c.w < sp * 0.8 || c.w > sp * 2.6 || c.h < sp * 3.4 || c.h > sp * 4.9) continue;
      const pt = pAt(s, c.y0, c.x0), pb = pAt(s, c.y1, c.x0);
      if (pt < 7.4 || pt > 9.4 || pb > 0.6 || pb < -1.4) continue;
      if (noteIn(c.x0, c.x1, c.y0, c.y1)) continue;
      const ym = yAt(s, 4, (c.x0 + c.x1) / 2);
      const half = (ya, yb) => { const ids = Array.isArray(c.id) ? c.id : [c.id]; let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1; for (let y = Math.max(0, Math.round(ya)); y <= Math.min(h - 1, Math.round(yb)); y++) for (let x = c.x0; x <= c.x1; x++) { const k2 = y * w + x; if (C[k2] && ids.includes(labC[k2])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return x1 < 0 ? null : { x0, x1, y0, y1, ids }; };
      const up = half(c.y0, ym - T / 2 - 1), dn = half(ym + T / 2 + 1, c.y1);
      if (!up || !dn || up.y1 - up.y0 < sp * 1.2 || dn.y1 - dn.y0 < sp * 1.2) continue;
      const rd2 = (bx) => { const sh = shapeOf(C, w, bx.x0, bx.y0, bx.x1, bx.y1, sp, labC, bx.ids); const lz = new Map(classifyLoose(sh, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']).map((q) => [q.cls, q.d])); return ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((d) => ({ v: +d.slice(1), e: classify(sh, [d]).d, l: lz.get(d) })).sort((x, y) => Math.min(x.e, x.l * 1.1 + 0.04) - Math.min(y.e, y.l * 1.1 + 0.04))[0]; };
      const u = rd2(up), d = rd2(dn);
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ tall: c.x0, u, d });
      if (!(u.e < 0.45 || u.l < 0.16) || !(d.e < 0.45 || d.l < 0.16) || ![2, 4, 8, 16].includes(d.v)) continue;
      used.add(c);
      signs.push({ x: c.x0, x1: c.x1, time: [u.v, d.v] });
      for (let k2 = merged.length - 1; k2 >= 0; k2--) if (merged[k2].x > c.x0 - sp * 0.1 && merged[k2].x < c.x1 + sp * 0.1 && !merged[k2].double) merged.splice(k2, 1);
    }
    signs.sort((a, b2) => a.x - b2.x);
    // nothing else is read in them (rests, heads)
    for (const sg of signs) for (let k = rests.length - 1; k >= 0; k--) if (rests[k].cx > sg.x - sp * 0.2 && rests[k].cx < sg.x1 + sp * 0.2) rests.splice(k, 1);
  }
  // a time signature just after a barline, whatever it touches (a slur over it, the note after
  // it): the two digits, each filling half the staff, read from the ink in the box they fill
  for (const bl of [...merged, ...pendingBars]) {
    if (signs.some((g) => g.time && g.x > bl.x && g.x - bl.x < sp * 2.5)) continue;
    const xs = Math.round(bl.x + bl.w / 2 + 1);
    const yT = Math.round(yAt(s, 8, xs) - sp * 0.12), yB = Math.round(yAt(s, 0, xs) + sp * 0.12), yM = yAt(s, 4, xs);
    const colInk = (x) => { let n = 0; for (let y = yT; y <= yB; y++) n += C[y * w + x] || 0; return n; };
    let x0 = -1; for (let x = xs; x < xs + sp * 0.8 && x < w; x++) if (colInk(x) > sp * 0.3) { x0 = x; break; }
    if (x0 < 0) continue;
    // the digits' own box in each half of the staff, for a width from narrow to wide: the best reading
    const tight = (xa, xb, ya, yb) => { let a = Infinity, z = -1, t = Infinity, b = -1; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) if (C[y * w + x]) { if (x < a) a = x; if (x > z) z = x; if (y < t) t = y; if (y > b) b = y; } return z < 0 ? null : { x0: a, x1: z, y0: t, y1: b }; };
    let best = null;
    for (let ww = Math.round(sp * 0.9); ww <= Math.round(sp * 1.9); ww += Math.max(1, Math.round(sp * 0.1))) {
      const x1 = x0 + ww; if (x1 >= w) break;
      // (the digits end where an empty column is, or anywhere when they touch the next thing)
      const A = tight(x0, x1, yT, Math.round(yM - 1)), Bx = tight(x0, x1, Math.round(yM + 1), yB);
      if (!A || !Bx || A.y1 - A.y0 < sp * 1.5 || Bx.y1 - Bx.y0 < sp * 1.5 || A.y0 > yT + sp * 0.4 || Bx.y1 < yB - sp * 0.4 || Math.abs(A.y1 - yM) > sp * 0.45 || Math.abs(Bx.y0 - yM) > sp * 0.45) continue;
      // (two digits of about one width, one over the other)
      if (A.x1 - A.x0 < sp * 0.6 || Bx.x1 - Bx.x0 < sp * 0.6 || Math.abs((A.x1 - A.x0) - (Bx.x1 - Bx.x0)) > sp * 0.5 || Math.abs((A.x0 + A.x1) - (Bx.x0 + Bx.x1)) / 2 > sp * 0.5) continue;
      const u = (readDigitBox(ctx, sp, A) || []).filter((r) => r.v)[0], d = (readDigitBox(ctx, sp, Bx) || []).filter((r) => r.v)[0];
      if (!u || !d) continue;
      const sc = Math.min(u.e, u.l * 1.1 + 0.04) + Math.min(d.e, d.l * 1.1 + 0.04);
      if (!best || sc < best.sc) best = { sc, u, d, x1: Math.max(A.x1, Bx.x1) };
    }
    if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ afterBar: Math.round(bl.x), best: best && { u: best.u.v, d: best.d.v, ue: +best.u.e.toFixed(2), ul: +best.u.l.toFixed(2), de: +best.d.e.toFixed(2), dl: +best.d.l.toFixed(2) } });
    if (!best) continue;
    const { u, d } = best;
    if (!(u.e < 0.32 || u.l < 0.1) || !(d.e < 0.32 || d.l < 0.1) || ![2, 4, 8, 16].includes(d.v)) continue;
    // no note in there (a filled head, or a stem)
    if (heads.some((hd) => !hd.hollow && hd.cx > x0 && hd.cx < best.x1 && hd.cy > yT && hd.cy < yB)) continue;
    if (heads.some((hd) => hd.stem && hd.stem.x > x0 + 2 && hd.stem.x < best.x1 - 2 && !(hd.cx > x0 && hd.cx < best.x1))) continue;
    signs.push({ x: x0, x1: best.x1, time: [u.v, d.v] });
    signs.sort((a, b2) => a.x - b2.x);
    for (let k2 = heads.length - 1; k2 >= 0; k2--) if (heads[k2].cx > x0 && heads[k2].cx < best.x1 && heads[k2].cy > yT && heads[k2].cy < yB) heads.splice(k2, 1);
    for (let k = rests.length - 1; k >= 0; k--) if (rests[k].cx > x0 - sp * 0.2 && rests[k].cx < best.x1 + sp * 0.2) rests.splice(k, 1);
  }
  // barlines that only seemed to be stems: of 'heads' read inside a time signature or a clef
  for (const pb of pendingBars) {
    if (!pb.by.length || pb.by.some((hd) => heads.includes(hd))) continue;
    if (merged.some((b) => Math.abs(b.x - pb.x) < sp * 1.0)) continue;
    if (!signs.some((g) => g.x >= pb.x && g.x - pb.x < sp * 1.6)) continue;
    merged.push({ x: pb.x, w: pb.w, thick: pb.thick });
    merged.sort((a, b2) => a.x - b2.x);
  }
  // ---- a change of key along the line: after a double barline, naturals cancelling the old key
  // and the new key's sharps or flats, read as at the start of a line
  if (globalThis.__keyMid ?? 1) {
    const curKey = head.key || 0;
    for (const bl of merged) {
      if (!bl.double || bl.x > s.x1 - sp * 3) continue;
      const xb = Math.round(bl.x + (bl.w || 0) / 2 + 1);
      const zone = compsC.filter((c) => c.x0 >= xb && c.x1 <= xb + sp * 10 && c.y1 > s.top - sp * 4.5 && c.y0 < s.bottom + sp * 4.5 && ctx.staffOf((c.y0 + c.y1) / 2, (c.x0 + c.x1) / 2) === s && c.n > sp * sp * 0.03).sort((a, b2) => a.x0 - b2.x0);
      // (the naturals first: each the ink from the first inked column to the next clear one)
      let x2 = xb, nNat = 0;
      const yA = Math.round(s.top - sp * 2.5), yB2 = Math.round(s.bottom + sp * 2.5);
      const colInk = (x) => { let n = 0; for (let y = Math.max(0, yA); y <= Math.min(h - 1, yB2); y++) n += C[y * w + x] || 0; return n; };
      for (let guard = 0; guard < Math.abs(curKey); guard++) {
        let xa = x2; while (xa < x2 + sp * 1.2 && !colInk(xa)) xa++;
        if (xa >= x2 + sp * 1.2) break;
        // (its width: where it reads best as a natural, its strokes may have come apart)
        let bestN = null;
        for (let xz = Math.round(xa + sp * 0.4); xz <= xa + sp * 1.0; xz++) {
          let y0 = Infinity, y1 = -1; for (let y = Math.max(0, yA); y <= Math.min(h - 1, yB2); y++) for (let x = xa; x <= xz; x++) if (C[y * w + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
          if (y1 - y0 < sp * 1.5 || y1 - y0 > sp * 3.6) continue;
          const sh = shapeOf(C, w, xa, y0, xz, y1, sp);
          const k = classify(sh, ['natural', 'sharp', 'flat', 'd2', 'd3', 'd4']);
          // (clearly a natural, not a sharp: they look alike)
          if (k.cls === 'natural' && classify(sh, ['sharp']).d - k.d > 0.03 && (!bestN || k.d < bestN.d)) bestN = { d: k.d, xz, y0, y1 };
        }
        if (!bestN || bestN.d > 0.42) break;
        const { xz, y0, y1 } = bestN;
        // (not a note's: no head just after it at its height)
        const yc = (y0 + y1) / 2;
        if (heads.some((hd) => hd.left > xz && hd.left - xz < sp * 0.8 && Math.abs(hd.cy - yc) < sp * 0.6)) break;
        nNat++; x2 = xz + 1;
      }
      const clefNow = (signs.filter((g) => g.clef && g.x < bl.x).pop() || {}).clef || head.clef || 'treble';
      const kctx = { ...ctx, dbg: !!globalThis.__keyMidDbg, trace: [], keyOnly: true };
      const hk = readHeader({ ...s, x0: x2 - sp * 0.5 }, zone.filter((c) => c.x0 >= x2), kctx, { clef: clefNow }, heads);
      if (globalThis.__keyMidDbg) (ctx.signTrace = ctx.signTrace || []).push({ keyMidTrace: kctx.trace.filter((t) => !t.inAccDbg).slice(0, 30) });
      let key = hk.key || 0, end = hk.end;
      if (ctx.dbg || globalThis.__sigDbg) (ctx.signTrace = ctx.signTrace || []).push({ keyMid: xb, nNat, key, end: Math.round(end), cur: curKey, zone: zone.slice(0, 6).map((c) => [c.x0, c.x1, +(c.w / sp).toFixed(2), +(c.h / sp).toFixed(2), classify(shapeOf(C, w, c.x0, c.y0, c.x1, c.y1, sp, labC, c.id), ['natural', 'sharp', 'flat', 'd2', 'd3', 'd4'])]) });
      if (!key) { if (!nNat || !curKey || nNat < Math.min(2, Math.abs(curKey))) continue; end = x2; }
      // (one sign alone, with nothing cancelled before it, is more likely a note's)
      if (Math.abs(key) < 2 && !nNat) continue;
      if (key === curKey && !nNat) continue;
      signs.push({ x: xb, x1: Math.round(end), key });
      signs.sort((a, b2) => a.x - b2.x);
      // (the signs are no note's accidentals, and hold no notes)
      for (const hd of heads) if (hd.left > xb && hd.left < end + sp * 0.9 && hd.acc !== undefined) delete hd.acc;
      for (let k2 = heads.length - 1; k2 >= 0; k2--) if (heads[k2].cx > xb && heads[k2].cx < end - sp * 0.3) heads.splice(k2, 1);
    }
  }
  // ---- bars of rest counted together (a thick bar across the middle of the staff, with the
  // number of bars above it)
  const multis = [];
  for (const c of compsC) {
    if (c.x0 < startX - sp * 0.2 || c.x1 > s.x1 + sp * 0.3 || c.w < sp * 2.4 || c.h > sp * 3.2) continue;
    const xm = Math.round((c.x0 + c.x1) / 2), pm = pAt(s, (c.y0 + c.y1) / 2, xm);
    if (Math.abs(pm - 4) > 1.3) continue;
    // a thick bar: along most of its length the ink is about half a space tall, centred on the middle line
    let ok = 0, tot = 0;
    for (let x = Math.round(c.x0 + c.w * 0.15); x <= Math.round(c.x1 - c.w * 0.15); x += 2) {
      tot++;
      const y4 = Math.round(yAt(s, 4, x)); let a = y4, z = y4;
      if (!C[y4 * w + x]) continue;
      while (a > 0 && C[(a - 1) * w + x]) a--; while (z < h - 1 && C[(z + 1) * w + x]) z++;
      const th = z - a + 1; if (th >= sp * 0.3 && th <= sp * 1.15) ok++;
    }
    if (!tot || ok / tot < 0.75) continue;
    if (heads.some((hd) => hd.cx > c.x0 && hd.cx < c.x1 && Math.abs(pAt(s, hd.cy, hd.cx) - 4) < 3)) continue;
    // the number: digits above the staff over the middle of the bar
    const ds = compsC.filter((q) => q.x1 > c.x0 && q.x0 < c.x1 && q.y1 < yAt(s, 8, q.x0) - sp * 0.2 && q.y1 > yAt(s, 8, q.x0) - sp * 5.5 && q.h > sp * 0.9 && q.h < sp * 3.5 && q.w < sp * 2.5).sort((a, b2) => a.x0 - b2.x0);
    let n = 0;
    for (const q of ds) {
      const k = classifyLoose(shapeOf(C, w, q.x0, q.y0, q.x1, q.y1, sp, labC, q.id), ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'])[0];
      if (k && k.d < 0.45) n = n * 10 + +k.cls.slice(1);
    }
    multis.push({ x: c.x0, x1: c.x1, n: Math.max(1, n || 1) });
    if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ multi: n, x: c.x0 });
  }
  // nothing else is read inside them
  for (const m of multis) for (let k = rests.length - 1; k >= 0; k--) if (rests[k].cx > m.x - sp * 0.3 && rests[k].cx < m.x1 + sp * 0.3) rests.splice(k, 1);
  for (const m of multis) rests.push({ x: m.x, t: 1, cx: (m.x + m.x1) / 2, w: m.x1 - m.x, dots: 0, multi: m.n });
  // ---- grace notes: small filled heads with a short stem, just before a note
  const graces = [];
  {
    const { Os } = ctx;
    const ws = heads.filter((hd) => !hd.hollow && hd.wRow).map((hd) => hd.right - hd.left + 1).sort((a, b2) => a - b2);
    const headW = ws.length >= 3 ? ws[ws.length >> 1] : 0;
    for (const c of Os.comps) {
      const GD = globalThis.__graceDbg, cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
      if (GD && c.h > sp * 0.2 && band(cy)) GD.push({ x: Math.round(cx), y: Math.round(cy), w: +(c.w / sp).toFixed(2), h: +(c.h / sp).toFixed(2) });
      if (c.h < sp * 0.3 || c.h > sp * 1.2 || c.w < sp * 0.5 || c.w > sp * 0.95 || c.x0 < startX || c.x1 > s.x1) continue;
      // the middle of the head: its widest row (a flag or a ledger line may hang on)
      let cyH = cy;
      { let bw = -1; for (let y = c.y0; y <= c.y1; y++) { let n = 0; for (let x = c.x0; x <= c.x1; x++) n += Os.img[y * w + x]; if (n > bw) { bw = n; cyH = y; } } }
      if (!band(cy) || ctx.staffOf(cy, cx) !== s) continue;
      if (heads.some((hd) => Math.abs(hd.cx - cx) < sp * 0.8 && Math.abs(hd.cy - cy) < sp * 0.8)) continue;
      // (not inside a normal head's shape, a beam, a clef or a letter: the ink around stays small)
      // (measured without thin curves: a slur may start at the grace note)
      const idD = ctx.labD[Math.round(cyH) * w + Math.round(cx)]; const grp = idD >= 0 ? ctx.compsD[idD] : null;
      if (grp && (grp.h > sp * 4.2 || grp.w > sp * 2.4)) continue;
      const st = stemOf(C, w, h, { cx, cy: cyH, p: 0 }, (c.w / 2) * 0.95, sp * 0.75);
      if (GD) GD.push({ x: Math.round(cx), st: st && +(st.len / sp).toFixed(2) });
      if (!st || st.len < sp * 1.3 || st.len > sp * 3.4) continue;
      const next = heads.filter((hd) => hd.cx > cx + sp * 0.6 && hd.cx < cx + sp * 3.2).sort((a, b2) => a.cx - b2.cx)[0];
      if (!next) continue;
      // clearly smaller than the notes of this staff
      if (headW && c.w > headW * 0.8) continue;
      // not a piece of an accidental (the thick bar of a sharp, crossed by its two strokes)
      if ([...accBoxes.filter((q) => ['sharp', 'natural'].includes(accCls.get(q.id))), ...accBoxesW.filter((q) => ['sharp', 'natural'].includes(q.cls))].some((q) => cx > q.x0 - 2 && cx < q.x1 + 2 && cyH > q.y0 - 2 && cyH < q.y1 + 2)) continue;
      {
        const vrun = (x, y0, dir) => { let n = 0; for (let k = 1; k < sp; k++) { const y = Math.round(y0 + dir * k); if (y < 0 || y >= h) break; if (C[y * w + x] || C[y * w + x - 1] || C[y * w + x + 1]) n++; else break; } return n; };
        const crossed = (x) => vrun(x, c.y0, -1) > sp * 0.45 && vrun(x, c.y1, 1) > sp * 0.45;
        let L = false, R = false;
        for (let x = c.x0; x <= c.x0 + c.w * 0.45; x++) if (crossed(x)) { L = true; break; }
        for (let x = c.x1; x >= c.x1 - c.w * 0.45; x--) if (crossed(x)) { R = true; break; }
        if (L && R) continue;
        // (nor a blob with a stroke right through it, up and down, at its middle: a natural or a flat)
        if (crossed(Math.round(cx)) && !(L || R)) continue;
      }
      // with a flag (or a beam to another grace note) at the end of its stem: ink running off the
      // stem to the right near its end
      {
        const xs = Math.round(st.x), ye = Math.round(st.end), dir = st.up ? 1 : -1;
        let flag = false;
        for (let k = 0; k <= sp * 1.2 && !flag; k++) { const y = ye + dir * k; if (y < 0 || y >= h) continue; let run = 0; for (let x = xs + 2; x <= xs + Math.round(sp * 0.8); x++) if (C[y * w + x]) run++; if (run >= sp * 0.3) flag = true; }
        if (!flag) continue;
      }
      const p = Math.round(pAt(s, cyH, cx));
      graces.push({ cx, cy: cyH, p, x: c.x0, next });
      if (GD) GD.push({ ok: [Math.round(cx / ctx.f), Math.round(cyH / ctx.f)], w: +(c.w / sp).toFixed(2), headW: +(headW / sp).toFixed(2) });
    }
  }
  for (const g of graces) {
    g.next.grace = { p: g.p };
    // the grace note's stem and flag are not an accidental of the note after it
    if (g.next.acc !== undefined && [...accBoxes, ...accBoxesW].some((c) => c.x0 <= g.cx + sp * 0.6 && c.x1 >= g.cx - sp * 0.6 && c.y0 <= g.cy + sp && c.y1 >= g.cy - sp)) delete g.next.acc;
  }
  if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ graces: graces.map((g) => [Math.round(g.cx), g.p]) });
  // ---- what is left are the notes after the header
  // the space between the two strokes of a double or final barline is not a hollow head
  const notes = heads.filter((hd) => hd.left >= startX - sp * 0.3 && !(hd.ringHead && !hd.stem && merged.some((b) => (b.double || b.thick) && hd.cx > b.x - b.w - sp * 1.6 && hd.cx < b.x + sp * 0.9)));
  if (TR) trk(1175, heads);
  return { signTrace: (() => { const t = ctx.signTrace; ctx.signTrace = []; return t; })(), L: s.L, x0: s.x0, x1: s.x1, sp, top: s.top, bottom: s.bottom, lines: s.lines, thick: T, heads: notes, rests, bars: merged, signs, explicitClef: head.explicitClef, clef: head.clef, key: head.key, time: head.time, timeAlt: head.timeAlt, startX, head, barTrace: (() => { const t = ctx.barTrace; ctx.barTrace = []; return t; })(), accTrace: ctx.accTrace, restTrace: ctx.restTrace, allHeads: ctx.allHeads };
}
function stemOf(C, w, h, hd, rx, sp, gapK = 0.24) {
  const run = (x, y0, dir) => {
    let y = Math.round(y0), gap = 0, last = y;
    const lim = sp * 8.5;   // beams pulled far from the heads make long stems
    while (y > 0 && y < h - 1 && Math.abs(y - y0) < lim) {
      if (C[y * w + x] || C[y * w + x - 1] || C[y * w + x + 1]) { last = y; gap = 0; } else if (++gap > Math.max(2, sp * gapK)) break;
      y += dir;
    }
    return last;
  };
  let best = null;
  const tryCol = (x, dir) => {
    if (x < 1 || x >= w - 1) return;
    const end = run(x, hd.cy + dir * sp * 0.15, dir);
    const len = Math.abs(end - hd.cy);
    if (len < sp * 2.0) return;
    // thin: a stem, not the side of a big shape
    // (measured at a few heights: a flag or a beam may run along part of it)
    let wd = Infinity;
    for (const f of [0.35, 0.5, 0.65]) {
      const ym = Math.round(hd.cy + (end - hd.cy) * f + dir * sp * 0.3); if (ym < 0 || ym >= h) continue;
      let n = 0; for (let dx = -Math.round(sp * 0.6); dx <= Math.round(sp * 0.6); dx++) n += C[ym * w + x + dx] || 0;
      wd = Math.min(wd, n);
    }
    if (wd > sp * 0.5) return;
    // how far the same stroke runs the other way (a stem stops at its head, unless it carries a chord)
    const back = Math.abs(run(x, hd.cy - dir * sp * 0.15, -dir) - hd.cy);
    const c = { x, len, end, up: dir < 0, top: Math.min(end, hd.cy), bot: Math.max(end, hd.cy), back, backEnd: hd.cy - dir * back };
    if (dir < 0) { if (!bestU || len > bestU.len) bestU = c; } else if (!bestD || len > bestD.len) bestD = c;
    if (!best || len > best.len) best = c;
  };
  let bestU = null, bestD = null;
  for (let x = Math.round(hd.cx + rx - sp * 0.3); x <= Math.round(hd.cx + rx + sp * 0.2); x++) tryCol(x, -1);
  for (let x = Math.round(hd.cx - rx - sp * 0.2); x <= Math.round(hd.cx - rx + sp * 0.3); x++) tryCol(x, 1);
  // (a hollow head drawn as a slanted oval may have its stem a little further out)
  // (only a stem joined to the head by ink, along one row near its middle)
  if (!best && hd.hollow) {
    const joined = (x) => {
      const xe = x < hd.cx ? Math.round(hd.cx - rx * 0.5) : Math.round(hd.cx + rx * 0.5);
      for (let y = Math.round(hd.cy - sp * 0.45); y <= Math.round(hd.cy + sp * 0.45); y++) {
        let ok = true; for (let xx = Math.min(x, xe); xx <= Math.max(x, xe) && ok; xx++) if (!(C[y * w + xx] || C[(y - 1) * w + xx] || C[(y + 1) * w + xx])) ok = false;
        if (ok) return true;
      }
      return false;
    };
    for (let x = Math.round(hd.cx + rx + sp * 0.2) + 1; x <= Math.round(hd.cx + rx + sp * 0.35); x++) if (joined(x)) tryCol(x, -1);
    for (let x = Math.round(hd.cx - rx - sp * 0.35); x < Math.round(hd.cx - rx - sp * 0.2); x++) if (joined(x)) tryCol(x, 1);
  }
  // (the other way too, in case the longer one turns out to run into something else)
  if (best) best.alt = best === bestU ? bestD : bestU;
  return best;
}
function beamsOf(C, w, h, stem0, sp) {
  const dir = stem0.up ? 1 : -1;     // from the end of the stem back toward the head
  // a stem in the middle of a beamed group may seem to end at the first beam it meets: its real
  // end is past all the beams (ink, short gaps, ink), along the stem
  let stem = stem0;
  {
    const xs = Math.round(stem0.x); let y = Math.round(stem0.end), last = y, gap = 0;
    const ink = (yy) => yy >= 0 && yy < h && (C[yy * w + xs] || C[yy * w + xs - 1] || C[yy * w + xs + 1]);
    // a beam runs on sideways from the stem (an ornament or a slur above it does not, all the way)
    const beamRow = (yy) => { for (const sd of [-1, 1]) { let n = 0; for (let k = 1; k <= Math.round(sp * 0.9); k++) { const x = xs + sd * k; if (x >= 0 && x < w && (C[yy * w + x] || C[(yy + 1) * w + x] || C[(yy - 1) * w + x])) n++; } if (n >= sp * 0.85) return true; } return false; };
    for (let k = 0; k < sp * 2.6; k++) { y -= dir; if (ink(y) && (gap === 0 || beamRow(y))) { last = y; gap = 0; } else if (ink(y)) break; else if (++gap > sp * 0.4) break; }
    if (last !== Math.round(stem0.end)) stem = { ...stem0, end: last };
  }
  const runs = (x, merge) => {
    if (x < 0 || x >= w) return 0;
    let y = Math.round(stem.end - dir * sp * 0.35), n = 0, inRun = false, len = 0, firstAt = null, gapAfter = 0;
    const count = (L) => (L < sp * 0.2 ? 0 : !merge || L <= sp * 0.95 ? 1 : L <= sp * 1.7 ? 2 : 3);
    for (let k = 0; k < sp * 3; k++, y += dir) {
      if (y < 0 || y >= h) break;
      const d = C[y * w + x] || C[y * w + x + 1];
      if (d) { if (!inRun) { inRun = true; len = 0; if (firstAt === null) firstAt = k; } len++; gapAfter = 0; }
      else { if (inRun) { inRun = false; n += count(len); } if (firstAt !== null && ++gapAfter > sp * 0.7) break; }
    }
    if (inRun) n += count(len);
    if (firstAt === null || firstAt > sp * (merge ? 0.9 : 1.7)) return 0;   // beams and flags start at the end of the stem
    return n;
  };
  // a beam runs on toward the next stem; a flag stops within about a staff space
  const inkNear = (x) => { if (x < 0 || x >= w) return false; for (let k = -sp * 0.6; k < sp * 1.6; k++) { const y = Math.round(stem.end + dir * k); if (y >= 0 && y < h && C[y * w + x]) return true; } return false; };
  let most = 0;
  for (const side of [-1, 1]) {
    const beam = inkNear(Math.round(stem.x + side * sp * 1.2)) && inkNear(Math.round(stem.x + side * sp * 1.7)) && inkNear(Math.round(stem.x + side * sp * 0.6));
    if (beam) { for (const off of [0.4, 0.7]) most = Math.max(most, runs(Math.round(stem.x + side * sp * off), true)); }
    else if (side === 1 && stem.up || side === 1 && !stem.up) { for (const off of [0.5, 0.75]) most = Math.max(most, runs(Math.round(stem.x + side * sp * off), false)); }
  }
  if (globalThis.__omrDbg) (globalThis.__omrDbg.beams = globalThis.__omrDbg.beams || []).push({ x: stem.x, end: stem.end, up: stem.up, most, r5: runs(Math.round(stem.x + sp * 0.5), false), r75: runs(Math.round(stem.x + sp * 0.75), false), n12: inkNear(Math.round(stem.x + sp * 1.2)), n17: inkNear(Math.round(stem.x + sp * 1.7)) });
  return Math.min(3, most);
}
function dotOf(C, w, h, hd, s, sp, lab, comps) {
  const pDot = hd.p % 2 === 0 ? hd.p + 1 : hd.p;
  const y = Math.round(yAt(s, pDot, hd.cx));
  const xa = Math.round(hd.right + sp * 0.1), xb = Math.round(hd.right + sp * 1.3);
  for (let x = xa; x < Math.min(w - 1, xb); x++) {
    for (const yy of [y, y - 1, y + 1, y - 2, y + 2]) {
      const k = yy * w + x; if (yy < 0 || yy >= h || !C[k]) continue;
      const c = comps[lab[k]];
      if (c && c.w >= sp * 0.17 && c.w <= sp * 0.75 && c.h >= sp * 0.17 && c.h <= sp * 0.75 && c.w / c.h > 0.5 && c.w / c.h < 2) return 1;
      // (the edge of the head itself, reaching past where it was measured: look on)
      if (c && c.x0 < xa - 1 && c.x1 < xa + sp * 0.5) continue;
      return 0;
    }
  }
  return 0;
}
// A digit of a time signature (best readings first)
function readDigitBox(ctx, sp, bx, C = ctx.C, labC = ctx.labC) {
  const { w } = ctx;
  if (!bx || (bx.y1 - bx.y0) < sp * 1.1) return null;
  const sh = shapeOf(C, w, bx.x0, bx.y0, bx.x1, bx.y1, sp, labC, bx.ids);
  // the white areas the digit closes in tell 5 from 6, 3 from 8, 0 from…
  const nh = holesInBox(C, w, ctx.h, bx);
  const HOLES = { 0: [1], 1: [0], 2: [0], 3: [0], 4: [0, 1], 5: [0, 1], 6: [1], 7: [0], 8: [2], 9: [1] };
  // both comparisons: the exact one (printed digits) and the loose one (handwritten digits)
  const loose = new Map(classifyLoose(sh, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']).map((q) => [q.cls, q.d]));
  const cl = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((d) => { const v = +d.slice(1), e = classify(sh, [d]).d, l = loose.get(d), pen = HOLES[v].includes(nh) ? 0 : 0.2; return { v, d: Math.min(e, l * 1.1 + 0.04) + pen, e: e + pen, l: l + pen, ok: e + pen < 0.5 || l + pen < 0.16 }; }).sort((a, b2) => a.d - b2.d);
  // a digit is about as wide as a staff space or more (a stem or a note is not a digit)
  if ((bx.x1 - bx.x0) < sp * 0.55 && cl[0].v !== 1) return null;
  // 5 or 6: a 5 has a straight bar across its top, a 6 a round top
  // (and a 9 a round top too)
  if ([5, 6, 9].includes(cl[0].v) && cl.slice(1, 3).some((q) => [5, 6, 9].includes(q.v) && q.v !== cl[0].v && (q.v === 5 || cl[0].v === 5))) {
    let bar = 0;
    for (let y = bx.y0; y <= bx.y0 + (bx.y1 - bx.y0) * 0.18; y++) { let run = 0, best = 0; for (let x = bx.x0; x <= bx.x1; x++) { if (C[y * w + x]) { run++; best = Math.max(best, run); } else run = 0; } bar = Math.max(bar, best); }
    const want = bar >= (bx.x1 - bx.x0 + 1) * 0.55 ? 5 : cl[0].v !== 5 ? cl[0].v : cl.find((q) => q.v === 6 || q.v === 9).v;
    const k = cl.findIndex((q) => q.v === want); if (k > 0) { const q = cl.splice(k, 1)[0]; q.d = Math.min(q.d, cl[0].d); cl.unshift(q); }
  }
  if (globalThis.__digDbg) globalThis.__digDbg.push(cl.slice(0, 4).map((q) => [q.v, +q.d.toFixed(3), +q.l.toFixed(3)]));
  return cl;
}
// The start of a line: clef, then key signature, then time signature.
function readHeader(s, comps, ctx, prev, heads) {
  const { C, w, labC, T } = ctx;
  const sp = s.sp;
  let i = 0, clef = null, end = s.x0 + sp * 0.5;
  const P = (y, x) => pAt(s, y, x);
  // the clef: the first big shape (with any pieces of it)
  // (a bar number or a word above the staff is not the clef: the clef overlaps the staff)
  const onStaff = (c) => c.y1 > yAt(s, 8, c.x0) + sp * 0.3 && c.y0 < yAt(s, 0, c.x0) - sp * 0.3;
  while (i < comps.length && (comps[i].h < sp * 1.2 || !onStaff(comps[i]))) i++;
  // (a shape far taller than a clef is the system's line or brace with the clef run into it: read
  // below, from the ink just after the line)
  const giant = i < comps.length && comps[i].h > sp * (globalThis.__giantH ?? 11);
  if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ firstComps: comps.slice(0, 8).map((c) => [c.x0, c.x1, c.y0, c.y1, +(c.h / sp).toFixed(1), onStaff(c)]), i });
  const giantX0 = giant ? comps[i].x0 : null;
  if (giant) i++;
  if (!ctx.keyOnly && !giant && i < comps.length && comps[i].h >= sp * 2.4) {
    const c = comps[i];
    // the clef may be in pieces (the bars and the bracket shape of a C clef)
    const group = [];
    let gx1 = c.x1;
    for (const q of comps) {
      if (q === c || q.x1 < c.x0) continue;
      // (a bar number above the staff is not part of it)
      if (q.y1 < c.y0 - sp * 0.3 || q.y0 > c.y1 + sp * 0.3) continue;
      const overlapX = q.x0 < gx1 - sp * 0.1 && q.x1 > c.x0 + sp * 0.1;
      const oy = Math.min(q.y1, c.y1) - Math.max(q.y0, c.y0);
      const beside = q.x0 <= gx1 + sp * 0.45 && oy > Math.min(q.h, c.h) * 0.5 && q.h > sp * 1.5 && Math.max(q.x1, gx1) - c.x0 < sp * 3.2;
      if (overlapX || beside) { group.push(q); gx1 = Math.max(gx1, q.x1); }
    }
    const x0 = Math.min(c.x0, ...group.map((q) => q.x0)), x1 = Math.max(c.x1, ...group.map((q) => q.x1));
    const y0 = Math.min(c.y0, ...group.map((q) => q.y0)), y1 = Math.max(c.y1, ...group.map((q) => q.y1));
    const ids = [c.id, ...group.map((q) => q.id)].flat();
    const top = P(y0, (x0 + x1) / 2), bot = P(y1, (x0 + x1) / 2);
    const k = classify(shapeOf(C, w, x0, y0, x1, y1, sp, labC, ids), ['treble', 'bass', 'alto']);
    // two dots to the right at the spaces either side of the 4th line make a bass clef
    // (or both in one shape, run together in a blurred print)
    const dots = comps.filter((q) => q.x0 > x1 - sp * 0.3 && q.x0 < x1 + sp * 0.9 && q.w < sp * 0.7 && (q.h < sp * 0.7 || (q.h < sp * 1.8 && Math.abs(P((q.y0 + q.y1) / 2, q.x0) - 6) < 0.8)));
    const bassDots = dots.filter((q) => { const p = P((q.y0 + q.y1) / 2, q.x0); return Math.abs(p - 7) < 0.8 || Math.abs(p - 5) < 0.8; }).length >= 2;
    let name = null;
    if ((top > 10.3 && bot < -1.2) || (top > 9.4 && bot < -0.9 && (y1 - y0) > sp * 5 && k.cls === 'treble' && k.d < 0.5)) name = 'treble';
    else if (bassDots || (k.cls === 'bass' && k.d < 0.4 && top < 9.8 && bot > 0.6)) name = 'bass';
    else if (top > 7.4 && top < 9.8 && bot > -1.2 && bot < 0.8) name = k.cls === 'bass' && k.d < 0.3 ? 'bass' : 'alto';
    else if (top > 9.6 && top < 11.8 && bot > 1.2 && bot < 2.8) name = 'tenor';
    else if (k.d < 0.33) name = k.cls === 'alto' ? cLine((top + bot) / 2) : k.cls;
    // a C clef run together with a low (or high) note just after it, by its ledger lines: the clef's
    // own shape alone tells on which line it sits (alto on the middle line, tenor on the fourth)
    if (!name && k.cls === 'alto' && k.d < 0.45 && (globalThis.__cClefAlone ?? 1)) {
      // (the ink of its first two spaces' width only: the note after it is further right)
      const xa = c.x0, xb = Math.min(c.x1, Math.round(c.x0 + sp * 2.1));
      let ya = Infinity, yb = -1;
      for (let y = c.y0; y <= c.y1; y++) for (let x = xa; x <= xb; x++) if (C[y * w + x]) { if (y < ya) ya = y; if (y > yb) yb = y; break; }
      const k1 = yb > ya ? classify(shapeOf(C, w, xa, ya, xb, yb, sp), ['treble', 'bass', 'alto']) : { cls: '', d: 9 };
      const t1 = P(ya, (xa + xb) / 2), b1 = P(yb, (xa + xb) / 2), mid = (t1 + b1) / 2;
      if (globalThis.__clefLog) globalThis.__clefLog.push({ alone: [+t1.toFixed(2), +b1.toFixed(2), k1.cls, +(+k1.d).toFixed(3)] });
      if (k1.cls === 'alto' && k1.d < 0.42 && t1 - b1 > 6 && t1 - b1 < 10.5 && mid > -1.5 && mid < 7.5) name = cLine(mid);
    }
    if (globalThis.__clefLog) globalThis.__clefLog.push({ top: +top.toFixed(2), bot: +bot.toFixed(2), cls: k.cls, d: +k.d.toFixed(3), name, bassDots });
    if (name) {
      clef = name; end = Math.max(x1, ...dots.map((q) => q.x1)) + sp * 0.2;
      i = comps.findIndex((q) => q.x0 >= end - sp * 0.1); if (i < 0) i = comps.length;
    }
  }
  // the clef joined to the line's opening barline (a brace, a system line): read from the ink
  // just after the barline, whatever it is joined to
  if (!clef && !ctx.keyOnly) {
    const top = yAt(s, 8, s.x0), bot = yAt(s, 0, s.x0);
    const full = (x) => { let n = 0; for (let y = Math.round(top); y <= Math.round(bot); y++) n += C[y * w + x] || 0; return n >= (bot - top) * 0.85; };
    // (from the line the clef ran into, when it was found)
    const xs = giantX0 !== null && (globalThis.__giantFrom ?? 1) ? Math.min(Math.round(s.x0 - sp * 0.5), giantX0) : Math.round(s.x0 - sp * 0.5);
    const xLim = giantX0 !== null && (globalThis.__giantFrom ?? 1) ? Math.max(s.x0 + sp * 1.2, giantX0 + sp * 1.2) : s.x0 + sp * 1.2;
    let xa = xs;
    while (xa < xLim && !full(xa)) xa++;
    // (the line further left than the staff seemed to start: the last full column before it)
    if (xa >= xLim && (globalThis.__lineLeft ?? 1)) { for (let x = xs - 1; x >= Math.max(0, Math.round(s.x0 - sp * 2.5)); x--) if (full(x)) { xa = x; while (xa > 0 && full(xa - 1)) xa--; break; } }
    if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ clefJoinedXa: xa, sx0: Math.round(s.x0), lim: Math.round(xLim), giantX0 });
    if (xa < xLim) {
      while (full(xa)) xa++;
      xa += 1;
      // the clef: the ink from there to the first gap after about two spaces of it
      const colInk = (x) => { let n = 0; for (let y = Math.round(top - sp * 3); y <= Math.round(bot + sp * 3); y++) if (y >= 0 && y < ctx.h) n += C[y * w + x] || 0; return n; };
      let x0 = xa;
      // (the barline's ragged edge, inked nearly all the way down, is not the clef)
      if (globalThis.__clefEdge ?? 1) { const rows = Math.round(bot + sp * 3) - Math.round(top - sp * 3) + 1; while (x0 < xa + sp * 0.5 && colInk(x0) > rows * (globalThis.__clefEdgeF ?? 0.4)) x0++; }
      while (x0 < xa + sp && !colInk(x0)) x0++;
      // (a sliver of the barline, a clear column after it)
      if (globalThis.__clefEdge ?? 1) { for (let x = x0 + 1; x <= x0 + Math.max(2, Math.round(sp * 0.3)); x++) if (!colInk(x)) { x0 = x; while (x0 < xa + sp * 1.5 && !colInk(x0)) x0++; break; } }
      let x1 = x0 + Math.round(sp * 1.5); while (x1 < x0 + sp * 3.2 && colInk(x1 + 1)) x1++;
      // (the rows of ink, as one band about the staff: a speck clear of it above or below is not the clef's)
      const boxY = (xr) => {
        const ya = Math.max(0, Math.round(top - sp * 3)), yb = Math.min(ctx.h - 1, Math.round(bot + sp * 3));
        const has = (y) => { for (let x = x0; x <= xr; x++) if (C[y * w + x]) return true; return false; };
        const gapMax = (globalThis.__clefBand ?? 1) ? Math.max(2, Math.round(sp * 0.4)) : 1e9;
        const mid = Math.round((top + bot) / 2);
        let a = Infinity, b2 = -1, gap = 0;
        for (let y = mid; y >= ya; y--) { if (has(y)) { a = y; gap = 0; } else if (a !== Infinity && ++gap > gapMax) break; else if (a === Infinity && mid - y > sp * 2) break; }
        gap = 0;
        for (let y = mid; y <= yb; y++) { if (has(y)) { b2 = y; gap = 0; } else if (b2 >= 0 && ++gap > gapMax) break; else if (b2 < 0 && y - mid > sp * 2) break; }
        if (a === Infinity) a = b2; if (b2 < 0) b2 = a === Infinity ? -1 : a;
        return [a, b2];
      };
      // (signs run on into it, a key's flats: the right edge where it reads best as a clef)
      if (x1 > x0 + sp * 2.2) {
        let bestX = x1, bestD = Infinity;
        for (let xr = Math.round(x0 + sp * 1.8); xr <= x1; xr += Math.max(1, Math.round(sp * 0.1))) {
          const [a, b2] = boxY(xr); if (b2 - a < sp * 2.4) continue;
          const kk = classify(shapeOf(C, w, x0, a, xr, b2, sp), ['treble', 'bass', 'alto']);
          if (kk.d < bestD - 0.005) { bestD = kk.d; bestX = xr; }
        }
        x1 = bestX;
      }
      let [y0, y1] = boxY(x1);
      if (y1 > y0 && y1 - y0 >= sp * 2.4) {
        const k = classify(shapeOf(C, w, x0, y0, x1, y1, sp), ['treble', 'bass', 'alto', 'sharp', 'flat', 'r4']);
        const tp = P(y0, (x0 + x1) / 2), bt = P(y1, (x0 + x1) / 2);
        let name = null;
        if (k.cls === 'treble' && k.d < 0.42 && tp > 9.4 && bt < -0.9) name = 'treble';
        else if (k.cls === 'bass' && k.d < 0.42 && tp > 7 && tp < 9.8 && bt > -1.2) name = 'bass';
        else if (k.cls === 'alto' && k.d < 0.42) name = cLine((tp + bt) / 2);
        // (a bass clef read without its two dots: the dots just after it, either side of its line)
        if (!name && k.cls === 'bass' && k.d < 0.6 && tp > 6.5 && tp < 10 && bt > (globalThis.__clefDotBt ?? 0.5) && bt < 4.5) {
          const dotAt = (p) => { const y = Math.round(yAt(s, p, x1)); let n = 0; for (let yy = y - Math.round(sp * 0.3); yy <= y + Math.round(sp * 0.3); yy++) for (let xx = x1 + 1; xx <= Math.round(x1 + sp * 1.0); xx++) if (C[yy * w + xx]) n++; return n >= sp * sp * 0.06 && n <= sp * sp * 0.5; };
          if (dotAt(7) && dotAt(5)) { name = 'bass'; x1 = Math.round(x1 + sp * 0.9); }
        }
        // (something above run into it, a dynamic, a word: a bass clef read from the staff down, with its dots)
        if (!name && tp > 10 && (globalThis.__clefClip ?? 1)) {
          let ya2 = Math.round(yAt(s, 9.6, x0)); while (ya2 < y1) { let any = false; for (let x = x0; x <= x1; x++) if (C[ya2 * w + x]) { any = true; break; } if (any) break; ya2++; }
          let yb2 = Math.min(y1, Math.round(yAt(s, -0.6, x0)));
          if (yb2 - ya2 >= sp * 2.4) {
            const k2 = classify(shapeOf(C, w, x0, ya2, x1, yb2, sp), ['treble', 'bass', 'alto']);
            const tp2 = P(ya2, (x0 + x1) / 2), bt2 = P(yb2, (x0 + x1) / 2);
            const dotAt = (p) => { const y = Math.round(yAt(s, p, x1)); let n = 0; for (let yy = y - Math.round(sp * 0.3); yy <= y + Math.round(sp * 0.3); yy++) for (let xx = x1 + 1; xx <= Math.round(x1 + sp * 1.0); xx++) if (C[yy * w + xx]) n++; return n >= sp * sp * 0.06 && n <= sp * sp * 0.5; };
            if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ clefClip: [ya2, yb2], k2, tp2, bt2, dots: [dotAt(7), dotAt(5)] });
            if (k2.cls === 'bass' && k2.d < 0.5 && tp2 < 10 && dotAt(7) && dotAt(5)) { name = 'bass'; x1 = Math.round(x1 + sp * 0.9); }
          }
        }
        if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ clefJoined: [x0, y0, x1, y1], k, tp, bt, name, xa, cin: Array.from({ length: 12 }, (_, q) => colInk(xa - 2 + q)), win: Math.round(bot + sp * 3) - Math.round(top - sp * 3) + 1, rows: Array.from({ length: Math.min(60, y1 - y0 + 1) }, (_, q) => { let t = ''; for (let x = x0 - 3; x <= x1; x += 2) t += C[(y0 + q * 2) * w + x] ? '#' : '.'; return t; }).filter((_, q) => q * 2 <= y1 - y0) });
        if (name) { clef = name; end = x1 + sp * 0.2; i = comps.findIndex((q) => q.x0 >= end - sp * 0.1); if (i < 0) i = comps.length; }
      }
    }
  }
  const clefName = clef || (prev && prev.clef) || null;
  // key signature: sharps or flats in a row, each at its place in the usual order
  const off = { treble: 0, bass: -2, alto: -1, tenor: 1, soprano: 2, mezzo: -3 }[clefName || 'treble'] ?? 0;
  const ORDER = { 1: [8, 5, 9, 6, 3, 7, 4].map((p) => p + off), '-1': [4, 7, 3, 6, 2, 5, 1].map((p) => p + off) };
  if (clefName === 'tenor') ORDER[1] = [2, 6, 3, 7, 4, 8, 5];
  // (with the rarer C clefs engravers differ on which octave each sign takes: both are looked at)
  if (clefName === 'soprano' || clefName === 'mezzo') for (const a of [1, -1]) ORDER[a] = ORDER[a].map((p) => [p, p >= 5 ? p - 7 : p + 7].filter((q) => q >= -1 && q <= 10));
  // each sharp or flat is looked for where it should be, so ones that touch still count
  const look = (a, p, from, to) => {
    let bestK = null;
    for (const sc of [1, 1.22]) {
    const tall = a > 0 ? [1.55 * sc, 1.55 * sc] : [2.1 * sc, 0.75 * sc];          // staff spaces above and below the note
    for (let x = Math.round(from); x <= Math.round(to); x++) {
      const yc = yAt(s, p, x), ya = Math.round(yc - tall[0] * sp), yb = Math.round(yc + tall[1] * sp), xb = Math.round(x + sp * (a > 0 ? 1.05 : 0.95) * sc);
      let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      const CK = ctx.Cb || C;
      for (let y = Math.max(0, ya); y <= Math.min(ctx.h - 1, yb); y++) for (let xx = x; xx <= xb; xx++) if (CK[y * w + xx]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || x0 > x + sp * 0.25 || (y1 - y0) < sp * 1.2) continue;
      let k = classify(shapeOf(CK, w, x0, y0, x1, y1, sp), ['sharp', 'flat', 'natural', 'd4', 'd2', 'd3', 'd6', 'd8', 'r4']);
      // (handwritten: the loose comparison, when it is clear)
      if (k.cls !== (a > 0 ? 'sharp' : 'flat')) {
        const lz = classifyLoose(shapeOf(CK, w, x0, y0, x1, y1, sp), ['sharp', 'flat', 'natural', 'd4', 'd2', 'd8', 'r4']);
        // (a rest stays inside the staff: a shape reaching well above or below it is no rest)
        const outside = y0 < yAt(s, 8, x) - sp * 0.5 || y1 > yAt(s, 0, x) + sp * 0.5;
        const want = a > 0 ? 'sharp' : 'flat', lw = lz.find((q) => q.cls === want), rest = lz.find((q) => q.cls === 'r4');
        const others = lz.filter((q) => q.cls !== want && !(outside && q.cls === 'r4'));
        if (lw && lw.d < 0.15 && (!others.length || others[0].d - lw.d > 0.012)) k = { cls: want, d: 0.37, loose: true, ld: lw.d, lm: others.length ? others[0].d - lw.d : 1 };
        void rest;
      }
      if (ctx.dbg && globalThis.__keyDbg) globalThis.__keyDbg.push({ a, p, x, box: [x0, y0, x1, y1].map((v) => v), hsp: +((y1 - y0) / sp).toFixed(2), cls: k.cls, d: +k.d.toFixed(3) });
      if (k.cls === (a > 0 ? 'sharp' : 'flat') && (!bestK || k.d < bestK.d)) {
        const sh = shapeOf(CK, w, x0, y0, x1, y1, sp);
        const other = Math.min(...['natural', 'd4', 'r4', a > 0 ? 'flat' : 'sharp'].map((q) => classify(sh, [q]).d));
        bestK = { ...k, x0, x1, margin: k.loose ? 0.1 : other - k.d };
      }
    }
    }
    return bestK;
  };
  let kind = 0, n = 0, lastX = end; const keyHint = {};
  // a note head (a solid or hollow oval) just after a sign, at about its height
  const ovalAfter = (sg) => {
    const OI = ctx.O && ctx.O.img; if (!OI) return false;
    const yc = yAt(s, sg.p, sg.x1);
    let n2 = 0;
    for (let y = Math.round(yc - sp * 0.6); y <= Math.round(yc + sp * 0.6); y++) for (let x = Math.round(sg.x1 + sp * 0.35); x <= Math.round(sg.x1 + sp * 1.3); x++) if (y >= 0 && y < ctx.h && OI[y * w + x]) n2++;
    return n2 > sp * sp * 0.25;
  };
  {
    // (a 'head' inside a sharp or a flat of the key, handwritten, is its middle, not the first note)
    const signCls = new Map();
    const signLike = (c) => { if (!signCls.has(c)) { const k = classify(shapeOf(C, w, c.x0, c.y0, c.x1, c.y1, sp, labC, c.id), ['sharp', 'flat', 'natural', 'd2', 'd3', 'd4', 'd6', 'd8', 'r4']); signCls.set(c, k.d < 0.4 && k.cls !== 'r4'); } return signCls.get(c); };
    const inAcc = (hd) => !hd.stem?.beams && comps.some((c) => c.h > sp * 1.4 && c.h < sp * 3.9 && c.w < sp * 1.6 && Math.min(hd.right, c.x1) - Math.max(hd.left, c.x0) > (hd.right - hd.left) * 0.3 && hd.cy > c.y0 && hd.cy < c.y1 && signLike(c));
    const firstNote = heads.filter((hd) => hd.left > end && (hd.stem || (hd.hollow && hd.wRow > sp * 1.35)) && !inAcc(hd)).reduce((m, hd) => Math.min(m, hd.left), Infinity);
    if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ inAccDbg: heads.filter((hd) => hd.left > end && hd.left < end + sp * 8).map((hd) => [hd.left, hd.right, Math.round(hd.cy), inAcc(hd), comps.filter((c) => Math.min(hd.right, c.x1) - Math.max(hd.left, c.x0) > 0).map((c) => [c.x0, c.x1, c.y0, c.y1, +(c.h / sp).toFixed(2), signLike(c)])]) });
    if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ firstNote, end, heads: heads.filter((hd) => hd.left > end).slice(0, 3).map((hd) => [hd.left, hd.p, hd.kind, hd.stem && [hd.stem.len / sp, hd.stem.back / sp], hd.wRow / sp]) });
    // a bar line straight after the clef (a repeat that starts the line: ‖:) ends the place where a
    // key can be — its thick and thin strokes and its dots are never flats or sharps
    let repX = Infinity;
    if (globalThis.__repKey ?? 1) {
      const CK0 = ctx.Cb || C, ya0 = Math.round(s.top), yb0 = Math.round(s.bottom), need = (yb0 - ya0) * 0.9;
      for (let x = Math.round(end); x < Math.min(w, end + sp * 5, firstNote - sp * 0.3); x++) {
        let run = 0, best = 0; for (let y = ya0 - 1; y <= yb0 + 1; y++) { if (y >= 0 && y < ctx.h && CK0[y * w + x]) { run++; if (run > best) best = run; } else run = 0; }
        if (best >= need) { repX = x; break; }
      }
    }
    let bestFirst = 9, keyFirst = null;
    for (const a of [1, -1]) {
      let cur = end - sp * 0.3, cnt = 0, lx = end, firstD = 9, prevX = 0, step = 0, nLoose = 0, exact = 0, lxExact = end, firstSign = null;
      for (const pp of ORDER[a]) {
        let k = null, p = Array.isArray(pp) ? pp[0] : pp;
        for (const q of Array.isArray(pp) ? pp : [pp]) {
          const kq = look(a, q, cur, cnt ? cur + sp * 1.5 : Math.max(cur + sp * 1.5, Math.min(cur + sp * 2.6, firstNote - sp * 1.6)));
          if (kq && (!k || kq.d < k.d)) { k = kq; p = q; }
        }
        if (!cnt && k && (!keyHint[a] || k.d < keyHint[a])) keyHint[a] = k.d;
        if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ a, p, cur, k: k && { d: +k.d.toFixed(3), x0: k.x0, ld: k.ld, lm: k.lm, mg: k.margin } });
        if (globalThis.__keyLog) globalThis.__keyLog.push({ y: Math.round(s.top), a, p, cur: Math.round(cur), firstNote: Math.round(firstNote), k: k && { d: +k.d.toFixed(3), x0: k.x0, x1: k.x1, m: +(k.margin || 0).toFixed(2), loose: !!k.loose } });
        if (k && k.x1 > repX) break;
        if (!k || !(k.d <= 0.38 || (k.d <= 0.48 && k.margin >= 0.1 && (!cnt || k.d <= firstD + 0.06)))) break;
        // (one beside the other, not on top of each other)
        if (cnt >= 1 && k.x0 - prevX < sp * 0.6) break;
        // (nor a piece of the sign before: most of it inside that one)
        if (cnt >= 1 && (globalThis.__keyOverlap ?? 1) && k.x1 - lx < sp * 0.45) break;
        // evenly spaced
        if (cnt >= 2 && Math.abs((k.x0 - prevX) - step) > step * 0.45) break;
        if (cnt >= 1) step = cnt === 1 ? k.x0 - prevX : step;
        if (!cnt) { firstD = k.d; firstSign = { x0: k.x0, x1: k.x1, p }; }
        prevX = k.x0; cnt++; lx = k.x1; cur = k.x0 + sp * 0.55; if (k.loose && !(k.ld < 0.09 && k.lm > 0.03)) nLoose++; else if (!nLoose) { exact = cnt; lxExact = lx; }
      }
      // (handwritten signs, known only loosely, count when there are several in their order)
      if (nLoose && cnt < 3) { cnt = exact; lx = lxExact; }
      // (one sign right against a note at about its height is that note's accidental, not a key)
      // (nor is a lone 'sign' that is, whole, a time signature's C or cut C)
      if (cnt === 1 && firstSign && (globalThis.__keyNotC ?? 1)) {
        const CK = ctx.Cb || C, ya = Math.round(s.top - sp * 1.5), yb = Math.round(s.bottom + sp * 1.5);
        // the ink there, out to blank columns on either side (small gaps bridged)
        const colInk = (x) => { let y0c = Infinity, y1c = -1; for (let y = Math.max(0, ya); y <= Math.min(ctx.h - 1, yb); y++) if (C[y * w + x]) { if (y < y0c) y0c = y; y1c = y; } return y1c >= 0 ? [y0c, y1c] : null; };
        let bx0 = Math.round((firstSign.x0 + firstSign.x1) / 2), bx1 = bx0, by0 = Infinity, by1 = -1;
        const gapMax = Math.max(2, Math.round(sp * 0.25));
        for (const dir of [-1, 1]) {
          let gap = 0;
          for (let x = bx0 + dir, n2 = 0; n2 < sp * 2.5 && x > 0 && x < w - 1; x += dir, n2++) {
            const ci = colInk(x);
            if (ci) { gap = 0; if (dir < 0) bx0 = x; else bx1 = x; if (ci[0] < by0) by0 = ci[0]; if (ci[1] > by1) by1 = ci[1]; } else if (++gap > gapMax) break;
          }
        }
        { const ci = colInk(Math.round((firstSign.x0 + firstSign.x1) / 2)); if (ci) { by0 = Math.min(by0, ci[0]); by1 = Math.max(by1, ci[1]); } }
        if (bx1 > bx0 && by1 - by0 > sp * 1.5) {
          const k2 = classify(shapeOf(CK, w, bx0, by0, bx1, by1, sp), ['tC', 'tCut', 'sharp', 'flat', 'natural']);
          if (globalThis.__kcDbg) globalThis.__kcDbg.push([a, bx0, bx1, by0, by1, k2.cls, k2.d]);
          if ((k2.cls === 'tC' || k2.cls === 'tCut') && k2.d < 0.4) cnt = 0;
        }
      }
      if (cnt === 1 && firstSign && (heads.some((hd) => hd.left - firstSign.x1 > -sp * 0.2 && hd.left - firstSign.x1 < sp * 0.9 && Math.abs(hd.p - firstSign.p) <= 1) || ovalAfter(firstSign))) cnt = 0;
      if (cnt && (firstD < bestFirst - 0.02 || (Math.abs(firstD - bestFirst) <= 0.02 && cnt > n))) { n = cnt; kind = a; lastX = lx; bestFirst = firstD; keyFirst = firstSign; }
    }
    // signs that touch each other are hard to read one by one: their upright strokes, counted
    // (a flat has one, a sharp two), tell how many there are
    if (n && keyFirst && (globalThis.__keyStrokes ?? 1)) {
      const ya = Math.round(s.top - sp * 2.6), yb = Math.round(s.bottom + sp * 1.6);
      const xEnd = Math.max(keyFirst.x1, Math.min(firstNote - sp * 0.4, keyFirst.x0 + sp * 9));
      const cols = [];
      const CK = ctx.Cb || C;
      for (let x = Math.round((globalThis.__ksFromEnd ?? 1) && keyFirst.x0 - end < sp * 2.5 ? Math.min(keyFirst.x0 - sp * 0.3, end + sp * 0.1) : keyFirst.x0 - sp * 0.3); x <= xEnd && x < w; x++) {
        let best = 0, run = 0, by1 = 0; for (let y = Math.max(0, ya); y <= Math.min(ctx.h - 1, yb); y++) { if (CK[y * w + x]) { run++; if (run > best) { best = run; by1 = y; } } else run = 0; }
        if (best >= sp * 1.3 && best <= sp * 3.8) cols.push([x, by1 - best + 1, by1]);
      }
      const strokes = [];
      for (const [x, y0, y1] of cols) { const l = strokes[strokes.length - 1]; if (l && x - l.x1 <= 2) { l.x1 = x; if (y1 - y0 > l.y1 - l.y0) { l.y0 = y0; l.y1 = y1; } } else strokes.push({ x0: x, x1: x, y0, y1 }); }
      const thin = strokes.filter((q) => q.x1 - q.x0 + 1 <= sp * 0.35);
      // (each stroke where the key's order puts it: a flat's stroke ends just below its line or
      // space, a sharp's two are centred on it)
      const mode = globalThis.__keyStrokes ?? 2;
      let S = 0, lastS = null;
      if (mode === 2) {
        if (kind < 0) {
          for (const q of thin) { const p = ORDER[-1][S]; if (p === undefined) break; const yb2 = yAt(s, p, q.x0) + sp * 0.45; if (Math.abs(q.y1 - yb2) > sp * 0.6 || (lastS && q.x0 - lastS.x1 > sp * 1.7)) break; S++; lastS = q; }
        } else {
          for (let j = 0; j + 1 < thin.length; j += 2) { const a1 = thin[j], a2 = thin[j + 1], p = ORDER[1][S]; if (p === undefined) break; const g = a2.x0 - a1.x1; if (g < sp * 0.15 || g > sp * 0.9 || (lastS && a1.x0 - lastS.x1 > sp * 1.4)) break; const yc = (a1.y0 + a1.y1 + a2.y0 + a2.y1) / 4; if (Math.abs(yc - yAt(s, p, a1.x0)) > sp * 0.6) break; S++; lastS = a2; }
        }
      } else for (const q of thin) { if (lastS && q.x0 - lastS.x1 > sp * 1.7) break; S++; lastS = q; }
      let nS = mode === 2 ? S : kind < 0 ? S : (S % 2 === 0 ? S / 2 : 0);
      // (the kind, from the strokes: a sharp's two stand close side by side, flats' one each further apart)
      let pairs = 0, singles = 0, lastP = null;
      if (globalThis.__keyType ?? 1) {
        for (let j = 0; j < thin.length; ) {
          const a1 = thin[j], a2 = thin[j + 1];
          if (lastP && a1.x0 - lastP.x1 > sp * 1.7) break;
          const yc1 = (a1.y0 + a1.y1) / 2, dx = a2 ? a2.x0 - a1.x0 : 0;
          if (a2 && dx >= sp * 0.25 && dx <= sp * 0.7 && Math.abs((a2.y0 + a2.y1) / 2 - yc1) < sp * 0.7 && Math.min(a1.y1 - a1.y0, a2.y1 - a2.y0) >= Math.max(a1.y1 - a1.y0, a2.y1 - a2.y0) * 0.65) { pairs++; lastP = a2; j += 2; }
          else { singles++; lastP = a1; j++; }
        }
      }
      if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ keyStrokes: S, nS, n, kind, pairs, singles, sp: +sp.toFixed(1), from: Math.round(keyFirst.x0), xEnd: Math.round(xEnd), strokes: strokes.map((q) => [q.x0, q.x1 - q.x0 + 1, Math.round(q.y0), Math.round(q.y1)]) });
      if (nS > n && nS <= 7 && lastS) { n = nS; lastX = lastS.x1 + sp * (kind < 0 ? 0.75 : 0.35); }
      if (kind < 0 && pairs >= 2 && pairs >= singles && lastP) { kind = 1; n = Math.min(7, pairs + Math.ceil(singles / 2)); lastX = Math.max(lastX, lastP.x1 + sp * 0.35); }
      let mF = 0;
      for (const q of thin) { const p = ORDER[-1][mF]; if (p === undefined) break; if (Math.abs(q.y1 - (yAt(s, p, q.x0) + sp * 0.45)) > sp * 0.6 || (mF && q.x0 - thin[mF - 1].x1 > sp * 1.7)) break; mF++; }
      if (kind > 0 && !pairs && singles >= 2 && lastP && mF >= 2) { kind = -1; n = Math.min(7, Math.max(n, singles)); lastX = Math.max(lastX, lastP.x1 + sp * 0.75); }
    }
    if (n) { i = comps.findIndex((q) => q.x0 >= lastX - sp * 0.15); if (i < 0) i = comps.length; }
  }
  if (n) end = lastX + sp * 0.2;
  // time signature: digits in the upper and lower halves of the staff, or C / cut C. The digits
  // are read from the ink in each half (they may touch the middle line and each other).
  let time = null, timeAlt = [];
  const endKey = end;
  const cand = comps.slice(i).filter((c) => c.h > sp * 0.9 && c.x0 < end + sp * 2.5 && c.x0 >= end - sp * 0.3);
  if (cand.length) {
    // columns of overlapping shapes
    cand.sort((a, b2) => a.x0 - b2.x0);
    const cols = [];
    for (const c of cand) { const l = cols[cols.length - 1]; if (l && c.x0 < l.x1 - sp * 0.1) { l.cs.push(c); l.x1 = Math.max(l.x1, c.x1); } else cols.push({ x0: c.x0, x1: c.x1, cs: [c] }); }
    const ids = (cs) => cs.flatMap((c) => (Array.isArray(c.id) ? c.id : [c.id]));
    const inkBox = (col, ya, yb) => {
      const idl = ids(col.cs); let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      for (let y = Math.max(0, Math.round(ya)); y <= Math.round(yb); y++) for (let x = col.x0; x <= col.x1; x++) { const k = y * w + x; if (C[k] && idl.includes(labC[k])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return x1 < 0 ? null : { x0, x1, y0, y1, ids: idl };
    };
    const digits = [];
    for (const col of cols.slice(0, 3)) {
      const xm = (col.x0 + col.x1) / 2;
      // a note is not a time signature (a head with a stem found there)
      if (heads.some((hd) => hd.stem && hd.cx > col.x0 - sp * 0.2 && hd.cx < col.x1 + sp * 0.2)) break;
      const yT = yAt(s, 8, xm), yM = yAt(s, 4, xm), yB = yAt(s, 0, xm);
      const allTop = Math.min(...col.cs.map((c) => c.y0)), allBot = Math.max(...col.cs.map((c) => c.y1));
      // inside the staff (large digits, handwritten above all, may stand out of it by a space or two)
      if (allTop < yT - sp * 2.4 || allBot > yB + sp * 2.4) break;
      let up = inkBox(col, Math.min(yT - sp * 0.3, allTop), yM - T / 2 - 1), dn = inkBox(col, yM + T / 2 + 1, Math.max(yB + sp * 0.3, allBot));
      // two separate digits one above the other: each is itself, wherever the gap between them is
      // (handwritten time signatures are often set lower or higher than the middle line)
      {
        const cs = col.cs.slice().sort((a, b2) => a.y0 - b2.y0);
        let cut = null;
        for (let k = 1; k < cs.length; k++) { const above = Math.max(...cs.slice(0, k).map((c) => c.y1)); if (cs[k].y0 > above && cs[k].y0 - above >= 1) { cut = (cs[k].y0 + above) / 2; break; } }
        if (cut !== null && Math.abs(cut - yM) < sp * 1.6) { up = inkBox(col, allTop, cut); dn = inkBox(col, cut, allBot); }
      }
      digits.push({ col, up, dn, xm });
    }
    const readDigit = (bx) => readDigitBox(ctx, sp, bx);
    const ups = [], dns = [];
    for (const dg of digits) {
      // one shape filling the middle of the staff: C or cut C
      const col = dg.col;
      if (!ups.length) {
        const c0 = col.cs[0];
        const pt = P(c0.y0, c0.x0), pb = P(c0.y1, c0.x0);
        if (col.cs.length === 1 && pt < 7.6 && pb > 0.4 && c0.h > sp * 1.4) {
          const k = classify(shapeOf(C, w, c0.x0, c0.y0, c0.x1, c0.y1, sp, labC, c0.id), ['tC', 'tCut', 'd4', 'd2', 'd3', 'bass', 'alto', 'r4', 'r8', 'r16']);
          if (k.d < 0.4 && (k.cls === 'tC' || k.cls === 'tCut')) { time = k.cls === 'tC' ? [4, 4] : [2, 2]; end = col.x1 + sp * 0.2; }
          break;
        }
      }
      const u = readDigit(dg.up), d = readDigit(dg.dn);
      if (!u && !d) break;
      if (u) ups.push(u); if (d) dns.push(d);
      end = col.x1 + sp * 0.2;
    }
    const denV = dns.reduce((a, q) => a * 10 + q[0].v, 0);
    const okDen = dns.length && [1, 2, 4, 8, 16, 32].includes(denV) && dns.every((q) => q[0].e < 0.42 || q[0].l < 0.15);
    if (!time && ups.length && dns.length && ups.every((q) => q[0].ok) && okDen) {
      const num = (list) => list.reduce((a, q) => a * 10 + q[0].v, 0);
      time = [num(ups), num(dns)];
      timeAlt = { u: ups.map((q) => q.slice(0, 3)), l: dns.map((q) => q.slice(0, 3)) };
    } else if (!time) end = endKey;
  }
  return { clef: clefName, key: kind * n, keyHint, time, timeAlt, end: Math.max(end, s.x0 + sp * 0.5), explicitClef: !!clef };
}

// ---------- the whole picture ----------
// opts.notesOnly: only the notes and bars (turning pages by listening): smaller, and none of the
// signs around the notes, which take much memory
export async function analyse(canvas, dbg, sub = false, opts = {}) {
  const A = await analyseOnce(canvas, dbg, sub, opts);
  // staff lines printed in grey (some editions and notation programs): with the usual threshold
  // they fall away with the paper and no staff is found; looked at again with a lighter one
  if (!A.staves.length && !lightBin && (globalThis.__greyLines ?? 1) && canvas.width * canvas.height > 40000) {
    lightBin = 1;
    try { const A2 = await analyseOnce(canvas, dbg, sub, opts); if (A2.staves.length) return A2; } finally { lightBin = 0; }
  }
  return A;
}
let lightBin = 0;
async function analyseOnce(canvas, dbg, sub = false, opts = {}) {
  const empty = { staves: [], systems: [], w: canvas.width, h: canvas.height, scale: 1, angle: 0, sp: 0 };
  if (!canvas.width || !canvas.height) return empty;
  // a first look, smaller, to measure the staff space
  const f0 = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const G0 = grayAt(canvas, f0);
  const b0 = binarize(flatten(G0, 40), G0.w, G0.h, false);
  let met = staffMetrics(b0, G0.w, G0.h);
  let spSrc = met.sp / f0;
  if (met.sp < 5) {
    // tiny picture: look again at full size, enlarged
    const G1 = grayAt(canvas, Math.min(4, 3 * f0)); const b1 = binarize(flatten(G1, 40), G1.w, G1.h, false);
    met = staffMetrics(b1, G1.w, G1.h); spSrc = met.sp / Math.min(4, 3 * f0);
  }
  if (!(spSrc > 2)) return empty;
  // working size: a staff space of about 20 pixels, within a pixel budget
  let f = SP / spSrc;
  const maxPix = opts.notesOnly ? (globalThis.__followPix ?? 9e6) : 9e6;
  if (canvas.width * canvas.height * f * f > maxPix) f = Math.sqrt(maxPix / (canvas.width * canvas.height));
  f = Math.max(0.15, Math.min(5, f));
  let G = grayAt(canvas, f);
  let norm = flatten(G, SP * 2.6);
  if (softNext === null) { let mid = 0, ink = 0; for (let i = 0; i < norm.length; i += 3) { const q = norm[i]; if (q < 90) ink++; else if (q < 215) mid++; } softNext = mid / Math.max(1, ink); }
  const shK = globalThis.__sharpK ?? sharpNext;
  if (shK) norm = sharpen(norm, G.w, G.h, globalThis.__sharpR ?? 2, shK);
  let B = binarize(norm, G.w, G.h, true);
  const angle = skewOf(B, G.w, G.h);
  let rotated = null;
  if (Math.abs(angle) >= 0.15) {
    // turn the evened-out picture (so the white corners the turn adds match the paper)
    const nc = document.createElement('canvas'); nc.width = G.w; nc.height = G.h;
    const ng = nc.getContext('2d'); const im = ng.createImageData(G.w, G.h);
    for (let i = 0; i < norm.length; i++) { const v = norm[i]; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    ng.putImageData(im, 0, 0);
    rotated = rotateCanvas(nc, angle);
    G = grayAt(rotated, 1); norm = G.g; B = binarize(norm, G.w, G.h, true);
  }
  const { w, h } = G;
  met = staffMetrics(B, w, h);
  const sp0 = met.sp > 6 ? met.sp : SP;
  const T = Math.max(1, Math.min(Math.round(sp0 * 0.3), met.T));
  let staves = findStaves(B, w, h, sp0, T, sub);
  // a staff that stops short is looked at again with a lighter threshold: in a photo a blurred,
  // faint line drops out of the ink and the staff would end where it fades.  The lighter reading
  // only stands in for a staff it matches line for line and that it carries clearly further.
  const lenK = globalThis.__lenient ?? 0.5;
  if (lenK && staves.length) {
    const G2 = B.gray, tl = Math.round(B.th + (250 - B.th) * lenK); const Bs = new Uint8Array(w * h);
    for (let i = 0; i < Bs.length; i++) Bs[i] = G2[i] < tl ? 1 : 0;
    const alt = findStaves(Bs, w, h, sp0, T, sub);
    if (globalThis.__stfDbg) globalThis.__stfDbg.push({ n: staves.map((s) => [s.top, s.bottom, s.x0, s.x1].map(Math.round)), a: alt.map((s) => [s.top, s.bottom, s.x0, s.x1].map(Math.round)) });
    staves = staves.map((s) => {
      const xm = Math.round((s.x0 + s.x1) / 2); const q = alt.find((a) => (Math.abs(a.top - s.top) < s.sp * 0.4 && Math.abs(a.bottom - s.bottom) < s.sp * 0.4) || ((globalThis.__altAt ?? 1) && Math.abs(a.L[0][xm] - s.L[0][xm]) < s.sp * 0.8 && Math.abs(a.L[4][xm] - s.L[4][xm]) < s.sp * 0.8));
      if (globalThis.__stfDbg) globalThis.__stfDbg.push({ s: [s.top, s.x0, s.x1, xm].map(Math.round), q: q && [q.top, q.x0, q.x1].map(Math.round), aL: alt.map((a) => [Math.round(a.L[0][xm]), Math.round(a.L[4][xm])]), sL: [Math.round(s.L[0][xm]), Math.round(s.L[4][xm])] });
      if (!q || q.x1 - q.x0 < s.x1 - s.x0 + s.sp * 3 || q.x0 > s.x0 + s.sp || q.x1 < s.x1 - s.sp) return s;
      return q;
    });
    // a staff only the lighter reading finds, where nothing else is, the same size as the others
    const hs = staves.map((s) => s.bottom - s.top).sort((a, b2) => a - b2), hm = hs[hs.length >> 1];
    const spans = staves.map((s) => s.x1 - s.x0).sort((a, b2) => a - b2), wm = spans[spans.length >> 1];
    const add = alt.filter((a) => !staves.some((s) => a.top < s.bottom + s.sp * 2 && a.bottom > s.top - s.sp * 2)
      && Math.abs(a.bottom - a.top - hm) < hm * 0.08 && a.x1 - a.x0 > wm * 0.3);
    if (add.length) staves = [...staves, ...add].sort((a, b2) => a.top - b2.top);
  }
  if (!staves.length) return { ...empty, angle };
  // Only where the staves are, and which go together (the iPhone's Play cutting a page into its
  // lines): no notes read, many times quicker. The staves and systems are those of the full reading.
  if (opts.stavesOnly) {
    const sysOf = [];
    staves.forEach((s, i) => {
      const prev = sysOf.length ? sysOf[sysOf.length - 1] : null;
      const last = prev ? staves[prev[prev.length - 1]] : null;
      let joined = false;
      if (last && s.top - last.bottom < s.sp * 14) {
        for (const x0 of [s.x0 + 1, s.x0 + s.sp * 0.2]) {
          const x = Math.round(x0); let n = 0, tot = 0;
          for (let y = Math.round(last.bottom); y <= Math.round(s.top); y++) { tot++; n += B[y * w + x] || B[y * w + x + 1] || B[y * w + x - 1] ? 1 : 0; }
          if (tot && n / tot > 0.9) { joined = true; break; }
        }
      }
      if (joined) prev.push(i); else sysOf.push([i]);
    });
    const back = (x, y) => {
      let X = x, Y = y;
      if (rotated) { const a = (angle * Math.PI) / 180, cx = w / 2, cy = h / 2; const dx = x - cx, dy = y - cy; X = cx + dx * Math.cos(a) - dy * Math.sin(a); Y = cy + dx * Math.sin(a) + dy * Math.cos(a); }
      return [X / f, Y / f];
    };
    const outS = staves.map((s) => {
      const xm = (s.x0 + s.x1) / 2;
      const [ax0] = back(s.x0, yAt(s, 8, s.x0)), [ax1] = back(s.x1, yAt(s, 8, s.x1));
      const [, bottom] = back(xm, yAt(s, 0, xm)), [, topM] = back(xm, yAt(s, 8, xm));
      return { sp: s.sp / f, top: topM, bottom, x0: ax0, x1: ax1, lines: [8, 6, 4, 2, 0].map((q) => back(xm, yAt(s, q, xm))[1]), thick: T / f, heads: [], rests: [], bars: [], signs: [], slurs: [], hairpins: [], ottavas: [], texts: [], startX: back(s.x0, s.top)[0] };
    });
    return { staves: outS, systems: sysOf, w: canvas.width, h: canvas.height, scale: 1, angle, sp: outS[0].sp };
  }
  // the staves' own measure is finer than the first guess
  const sp = sp0;
  const C = removeLines(B, w, h, staves, T);
  // holes are looked for with a darker threshold, so the middle of a soft-edged half note stays open
  const Bthin = new Uint8Array(w * h); { const G = B.gray, t2 = B.th2; for (let i = 0; i < Bthin.length; i++) Bthin[i] = B[i] && G[i] < t2 ? 1 : 0; }
  const holes = holeMask(Bthin, w, h, sp);
  const HL = label(holes, w, h), holeComps = HL.comps;
  // filled heads: ink plus holes, without the lines, opened with a disc
  const F0 = new Uint8Array(w * h); for (let i = 0; i < F0.length; i++) F0[i] = B[i] || holes[i] ? 1 : 0;
  const F = removeLines(F0, w, h, staves, T);
  const Oimg = openOval(F, w, h, sp * 0.24, sp * 0.39);
  const O = { img: Oimg, ...label(Oimg, w, h) };
  // the same with a smaller oval: the heads of grace notes (and small cue notes)
  const OsImg = openOval(F, w, h, sp * 0.15, sp * 0.24);
  const Os = { img: OsImg, ...label(OsImg, w, h) };
  const LC = label(C, w, h);
  // the ink with the staff lines put back where a symbol crosses them (ink just above and just
  // below): sharps, flats and rests keep their whole shape for comparing with the fonts
  const Cb = C.slice();
  {
    const r = T + 2;
    for (let y = r; y < h - r; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!B[i] || C[i]) continue;
      let up = false, dn = false;
      for (let k = 1; k <= r && !up; k++) if (C[i - k * w]) up = true;
      for (let k = 1; k <= r && !dn; k++) if (C[i + k * w]) dn = true;
      if (up && dn) Cb[i] = 1;
    }
  }
  // without thin curves (slurs, ties, hairpins), for rests and other symbols they cross
  const D = C.slice();
  {
    const thin = Math.max(2, Math.round(sp * 0.2));
    for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!C[y * w + x]) { y++; continue; } let e = y; while (e < h && C[e * w + x]) e++; if (e - y <= thin) for (let k = y; k < e; k++) D[k * w + x] = 0; y = e; } }
  }
  const LD = label(D, w, h);
  // the thin strokes alone (slurs and ties, apart from the notes they touch)
  const TH = new Uint8Array(w * h); for (let i = 0; i < TH.length; i++) TH[i] = C[i] && !D[i] ? 1 : 0;
  const LT = label(TH, w, h);
  const groups = groupComps(LC.comps, sp, T);
  const groupOf = new Int32Array(LC.comps.length); groups.forEach((g, i) => { for (const id of g.ids) groupOf[id] = i; });
  // close neighbours, which may be pieces of the same symbol
  {
    const ord = groups.slice().sort((a, b2) => a.x0 - b2.x0);
    for (const g of groups) g.nb = [];
    for (let a = 0; a < ord.length; a++) for (let b2 = a + 1; b2 < ord.length; b2++) {
      const A = ord[a], Bg = ord[b2]; if (Bg.x0 > A.x1 + sp * 0.25) break;
      const oy = Math.min(A.y1, Bg.y1) - Math.max(A.y0, Bg.y0);
      if (oy > Math.min(A.h, Bg.h) * 0.3) { A.nb.push(Bg); Bg.nb.push(A); }
    }
  }
  const unite = (list) => { const ids = list.flatMap((g) => (Array.isArray(g.id) ? g.id : [g.id])); return { ids, x0: Math.min(...list.map((g) => g.x0)), y0: Math.min(...list.map((g) => g.y0)), x1: Math.max(...list.map((g) => g.x1)), y1: Math.max(...list.map((g) => g.y1)) }; };
  // the best reading of a shape on its own, or together with a neighbour
  const best = (g, classes, maxW = Infinity) => {
    const tries = [[g], ...(g.nb || []).map((q) => [g, q])];
    let out = null;
    for (const list of tries) {
      const u = unite(list); if ((u.x1 - u.x0) > maxW) continue;
      const k = classify(shapeOf(C, w, u.x0, u.y0, u.x1, u.y1, sp, LC.lab, u.ids), classes);
      const d = k.d + (list.length > 1 ? 0.02 : 0);
      if (!out || d < out.d) out = { ...k, d, ...u, with: list[1] || null };
    }
    return out;
  };
  const mids = staves.map((s) => (s.top + s.bottom) / 2);
  const staffOf = (y, x) => { let bi = 0, bd = Infinity; staves.forEach((s, i) => { const m = (yAt(s, 0, x) + yAt(s, 8, x)) / 2; const d = Math.abs(y - m); if (d < bd) { bd = d; bi = i; } }); return staves[bi]; };
  void mids;
  // a lighter reading of the ink (lines removed), made when first wanted: thin strokes in a faded or
  // tinted part of the page
  let liteC = null;
  const lite = () => { if (!liteC) { const G2 = B.gray, tl = B.th + (250 - B.th) * 0.35, Bl = new Uint8Array(w * h); for (let i = 0; i < Bl.length; i++) Bl[i] = B[i] || G2[i] < tl ? 1 : 0; liteC = removeLines(Bl, w, h, staves, T); } return liteC; };
  const ctx = { lite, f, dbg, best, B, C, Cb, D, compsD: LD.comps, labD: LD.lab, thinComps: LT.comps, thinLab: LT.lab, F, O, Os, holes, holeComps, holeLab: HL.lab, w, h, T, compsC: groups, rawC: LC.comps, labC: LC.lab, groupOf, staffOf, staffBelow: (s) => staves[staves.indexOf(s) + 1], staffAbove: (s) => staves[staves.indexOf(s) - 1] };
  const read = [];
  staves.forEach((s, i) => { read.push(readStaff(s, ctx, null)); void i; });
  // ties, slurs and the signs around the notes
  let marks = { slurs: read.map(() => []), hairpins: read.map(() => []) };
  if (!opts.notesOnly) try {
    await markTemplates();
    // the signs are read from a picture where small signs above and below the staff keep their
    // ink at the places of ledger lines (a staccato dot, a digit, the line of a hairpin)
    let mctx = ctx;
    if (globalThis.__marksPic ?? 1) {
      const Cm = removeLines(B, w, h, staves, T, true);
      const Cbm = Cm.slice();
      { const r = T + 2; for (let y = r; y < h - r; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!B[i] || Cm[i]) continue; let up = false, dn = false; for (let k = 1; k <= r && !up; k++) if (Cm[i - k * w]) up = true; for (let k = 1; k <= r && !dn; k++) if (Cm[i + k * w]) dn = true; if (up && dn) Cbm[i] = 1; } }
      const Dm = Cm.slice();
      { const thin = Math.max(2, Math.round(sp * 0.2)); for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!Cm[y * w + x]) { y++; continue; } let e = y; while (e < h && Cm[e * w + x]) e++; if (e - y <= thin) for (let k = y; k < e; k++) Dm[k * w + x] = 0; y = e; } } }
      const THm = new Uint8Array(w * h); for (let i = 0; i < THm.length; i++) THm[i] = Cm[i] && !Dm[i] ? 1 : 0;
      const LTm = label(THm, w, h), LCm = label(Cm, w, h);
      const groupsM = groupComps(LCm.comps, sp, T);
      const groupOfM = new Int32Array(LCm.comps.length); groupsM.forEach((g, i) => { for (const id of g.ids) groupOfM[id] = i; });
      mctx = { ...ctx, C0: C, C: Cm, Cb: Cbm, D: Dm, thinComps: LTm.comps, thinLab: LTm.lab, compsC: groupsM, rawC: LCm.comps, labC: LCm.lab, groupOf: groupOfM };
    }
    marks = readMarks(read, { ...mctx, label, staves });
  } catch (err) { console.warn('marks', err); }
  // systems: staves joined by a barline that runs between them
  const systems = [];
  read.forEach((s, i) => {
    const prev = systems.length ? systems[systems.length - 1] : null;
    const last = prev ? read[prev[prev.length - 1]] : null;
    let joined = false;
    if (last && s.top - last.bottom < s.sp * 14) {
      const xs = [...s.bars.map((b) => b.x), s.x0 + 1, s.x0 + s.sp * 0.2];
      for (const x0 of xs) {
        const x = Math.round(x0); let n = 0, tot = 0;
        for (let y = Math.round(last.bottom); y <= Math.round(s.top); y++) { tot++; n += B[y * w + x] || B[y * w + x + 1] || B[y * w + x - 1] ? 1 : 0; }
        if (tot && n / tot > 0.9) { joined = true; break; }
      }
    }
    if (joined) prev.push(i); else systems.push([i]);
  });
  // the staves of a system (a piano's two hands) share their key: a staff that found nothing,
  // but saw something like the first sharp or flat, takes the key of the others
  for (const sys of systems) {
    const keys = sys.map((i) => read[i].key || 0).filter((k) => k);
    if (!keys.length) continue;
    const k = keys.sort((a, b2) => keys.filter((x) => x === b2).length - keys.filter((x) => x === a).length)[0];
    for (const i of sys) { const st = read[i]; const hint = st.head && st.head.keyHint, d = hint && hint[Math.sign(k)]; if (!st.key && d !== undefined && d < 0.56) st.key = k; }
  }
  // carry clef, key and time down the staves of the same part (the same place in each system)
  systems.forEach((sys, si) => sys.forEach((idx, k) => {
    const st = read[idx];
    if (si > 0) { const before = read[systems[si - 1][Math.min(k, systems[si - 1].length - 1)]]; if (!st.clef) st.clef = before.clef; if (!st.time) st.time = before.time; }
  }));
  // back to the coordinates of the picture we were given
  const back = (x, y) => {
    let X = x, Y = y;
    if (rotated) { const a = (angle * Math.PI) / 180, cx = w / 2, cy = h / 2; const dx = x - cx, dy = y - cy; X = cx + dx * Math.cos(a) - dy * Math.sin(a); Y = cy + dx * Math.sin(a) + dy * Math.cos(a); }
    return [X / f, Y / f];
  };
  const out = read.map((s) => {
    const xm = (s.x0 + s.x1) / 2;
    const [ax0, top] = back(s.x0, yAt(s, 8, s.x0)), [ax1] = back(s.x1, yAt(s, 8, s.x1));
    const [, bottom] = back(xm, yAt(s, 0, xm));
    const [, topM] = back(xm, yAt(s, 8, xm));
    return {
      sp: s.sp / f, top: topM, bottom, x0: ax0, x1: ax1, lines: [8, 6, 4, 2, 0].map((p) => back(xm, yAt(s, p, xm))[1]), thick: T / f,
      clef: s.clef, key: s.key, time: s.time, timeAlt: s.timeAlt,
      slurs: marks.slurs[read.indexOf(s)] || [], hairpins: (marks.hairpins && marks.hairpins[read.indexOf(s)]) || [],
      ottavas: ((marks.ottavas && marks.ottavas[read.indexOf(s)]) || []).map((o) => ({ x0: back(o.x0, s.top)[0], x1: back(o.x1, s.top)[0], shift: o.shift })),
      texts: ((marks.texts && marks.texts[read.indexOf(s)]) || []).map((t) => { const [x0, y0] = back(t.x0, t.y0), [x1, y1] = back(t.x1, t.y1); return { x0, y0, x1, y1, above: t.above }; }),
      heads: s.heads.map((hd) => { const [x, y] = back(hd.left, hd.cy); return { x, y, p: hd.p, kind: hd.kind, acc: hd.acc, dots: hd.dots, beams: hd.beams, w: hd.w / f, sc: hd.sc, id: hd.id, art: hd.art || [], fing: hd.fing || null, dyn: hd.dyn || null, tieTo: hd.tieTo, grace: hd.grace || null, tup3: !!hd.tup3, tupN: hd.tupN || 0, tupG: hd.tupG || 0, bg: hd.bg ?? null, stem: hd.stem ? { x: back(hd.stem.x, hd.stem.end)[0], up: hd.stem.up, len: hd.stem.len / f, end: back(hd.stem.x, hd.stem.end)[1] } : null }; }),
      rests: s.rests.map((r) => ({ x: back(r.x, s.top)[0], t: r.t, w: r.w / f, dots: r.dots, multi: r.multi || 0 })),
      bars: s.bars.map((b) => ({ ...b, x: back(b.x, (s.top + s.bottom) / 2)[0], w: b.w / f })),
      signs: (s.signs || []).map((g) => ({ ...g, x: back(g.x, (s.top + s.bottom) / 2)[0], x1: back(g.x1, (s.top + s.bottom) / 2)[0] })), explicitClef: !!s.explicitClef,
      startX: back(s.startX, s.top)[0],
      path: dbg ? Array.from({ length: Math.ceil((s.x1 - s.x0) / 20) + 1 }, (_, i) => { const x = Math.min(s.x1, s.x0 + i * 20); return [0, 2, 4, 6, 8].map((p) => back(x, yAt(s, p, x))); }) : undefined,
      _: dbg ? s : undefined,
    };
    void top;
  });
  // smaller staves (a cue staff above a piano part, an ossia) are read on their own, each in a
  // picture of its own enlarged to the working size, and join the others in reading order
  if (!sub && met.sp2) {
    try {
      const small = findStaves(B, w, h, met.sp2, Math.max(1, Math.round(T * met.sp2 / sp0))).filter((q) => !staves.some((p0) => q.top < p0.bottom + sp0 && q.bottom > p0.top - sp0) && q.x1 - q.x0 > sp0 * 20);
      for (const q of small) {
        const m2 = met.sp2;
        // (across the width of the other staves: a small staff in dense music is found only in parts)
        const wx0 = Math.min(q.x0, ...staves.map((p0) => p0.x0)), wx1 = Math.max(q.x1, ...staves.map((p0) => p0.x1));
        const [ax, ay] = back(wx0 - m2 * 3, q.top - m2 * 6), [bx, by] = back(wx1 + m2 * 2, q.bottom + m2 * 6);
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx))), y0 = Math.max(0, Math.floor(Math.min(ay, by)));
        const x1 = Math.min(canvas.width, Math.ceil(Math.max(ax, bx))), y1 = Math.min(canvas.height, Math.ceil(Math.max(ay, by)));
        // (not into the staves around it)
        const above = out.filter((o) => o.bottom < (ay + by) / 2).map((o) => o.bottom).reduce((a, b2) => Math.max(a, b2), 0);
        const below = out.filter((o) => o.top > (ay + by) / 2).map((o) => o.top).reduce((a, b2) => Math.min(a, b2), canvas.height);
        const cy0 = Math.max(y0, Math.ceil(above + 2)), cy1 = Math.min(y1, Math.floor(below - 2));
        if (x1 - x0 < 20 || cy1 - cy0 < 20) continue;
        const c2 = document.createElement('canvas'); c2.width = x1 - x0; c2.height = cy1 - cy0;
        const g2 = c2.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, c2.width, c2.height); g2.drawImage(canvas, -x0, -cy0);
        const A2 = await analyse(c2, false, true);
        if (!A2.staves.length) continue;
        const shift = (st2) => {
          const mv = (o) => ({ ...o, x: o.x + x0 });
          return { ...st2, cue: true, top: st2.top + cy0, bottom: st2.bottom + cy0, x0: st2.x0 + x0, x1: st2.x1 + x0, lines: st2.lines.map((y) => y + cy0),
            heads: st2.heads.map((hd) => ({ ...hd, x: hd.x + x0, y: hd.y + cy0, stem: hd.stem ? { ...hd.stem, x: hd.stem.x + x0, end: hd.stem.end + cy0 } : null })),
            rests: st2.rests.map(mv), bars: st2.bars.map(mv), signs: (st2.signs || []).map((g3) => ({ ...g3, x: g3.x + x0, x1: g3.x1 + x0 })), startX: st2.startX + x0,
            texts: (st2.texts || []).map((t) => ({ ...t, x0: t.x0 + x0, x1: t.x1 + x0, y0: t.y0 + cy0, y1: t.y1 + cy0 })) };
        };
        for (const st2 of A2.staves) out.push(shift(st2));
      }
      if (out.some((o) => o.cue)) {
        // reading order again: top to bottom; a staff that was not joined to others is a line of its own
        const order = out.map((o, i) => i).sort((a, b2) => out[a].top - out[b2].top);
        const remap = new Map(order.map((oldI, newI) => [oldI, newI]));
        const sorted = order.map((i) => out[i]);
        const sys2 = systems.map((sy) => sy.map((i) => remap.get(i)));
        out.forEach((o, i) => { if (o.cue) sys2.push([remap.get(i)]); });
        sys2.sort((a, b2) => sorted[a[0]].top - sorted[b2[0]].top);
        out.length = 0; out.push(...sorted); systems.length = 0; systems.push(...sys2);
      }
    } catch (err) { console.warn('small staves', err); }
  }
  return { staves: out, systems, w: canvas.width, h: canvas.height, scale: 1, angle, sp: out[0].sp, ...(dbg ? { B, C, F, O: Oimg, holes, work: { w, h, f } } : {}) };
}

// ---------- events ----------
const ticksOf = (t, dots) => (WHOLE / t) * (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
// Turn one staff's heads and rests into bars of events.
export function staffEvents(st) {
  const sp = st.sp;
  const items = [];
  const heads = st.heads.slice().sort((a, b) => a.x - b.x);
  const used = new Set();
  for (let i = 0; i < heads.length; i++) {
    if (used.has(i)) continue;
    const hd = heads[i];
    const group = [hd]; used.add(i);
    for (let j = i + 1; j < heads.length; j++) {
      if (used.has(j)) continue;
      const q = heads[j];
      const sameStem = hd.stem && q.stem && Math.abs(hd.stem.x - q.stem.x) < sp * 0.45 && hd.stem.up === q.stem.up;
      // a second: two heads side by side, the right-hand one higher, on the same stem
      const [lh, rh] = q.x >= hd.x ? [hd, q] : [q, hd];
      const second = Math.abs(q.x - hd.x) >= sp * 0.45 && Math.abs(q.x - hd.x) < sp * 1.35 && Math.abs(q.p - hd.p) === 1 && rh.p > lh.p && (!hd.stem || !q.stem || Math.abs(hd.stem.x - q.stem.x) < sp * 0.45);
      const sameX = Math.abs(q.x - hd.x) < sp * 0.45 || second;
      if (sameStem || (sameX && (q.kind === hd.kind || !q.stem || !hd.stem))) { group.push(q); used.add(j); }
    }
    const lead = group.find((g) => g.stem) || group[0];
    const kinds = group.map((g) => g.kind);
    const kind = kinds.includes('whole') && !lead.stem ? 'whole' : kinds.includes('half') && !kinds.includes('black') ? 'half' : lead.kind;
    let t = kind === 'whole' ? 1 : kind === 'half' ? 2 : 4;
    const beams = Math.max(...group.map((g) => g.beams || 0));
    if (t === 4 && beams) t = 4 * Math.pow(2, beams);
    const acc = {}; for (const g of group) if (g.acc !== undefined) acc[g.p] = g.acc;
    const art = [...new Set(group.flatMap((g) => g.art || []))];
    const fing = group.map((g) => g.fing).filter(Boolean).join(' ') || null, dyn = (group.find((g) => g.dyn) || {}).dyn || null;
    items.push({ x: Math.min(...group.map((g) => g.x)), t, dots: Math.max(...group.map((g) => g.dots || 0)), ps: [...new Set(group.map((g) => g.p))].sort((a, b) => a - b), acc, beamed: beams > 0 && !!lead.stem,
      ids: group.map((g) => g.id), tiesTo: group.filter((g) => g.tieTo !== undefined).map((g) => ({ p: g.p, to: g.tieTo })), art, fing, dyn, tup3: group.some((g) => g.tup3),
      grace: (group.find((g) => g.grace) || {}).grace || null,
      tupN: Math.max(...group.map((g) => g.tupN || 0)), tupG: (group.find((g) => g.tupG) || {}).tupG || 0, bg: beams > 0 && lead.stem ? lead.bg : null });
  }
  // ties and slurs from head to head become marks on the events
  const byHead = new Map(); items.forEach((it) => (it.ids || []).forEach((id) => byHead.set(id, it)));
  for (const it of items) { it.ties = (it.tiesTo || []).filter((t) => byHead.has(t.to) && byHead.get(t.to) !== it).map((t) => t.p); delete it.tiesTo; }
  for (const sl of st.slurs || []) {
    const a = byHead.get(sl.a), b = byHead.get(sl.b); if (!a || !b || a === b) continue;
    a.slurStart = true; b.slurEnd = true;
  }
  for (const hp of st.hairpins || []) {
    const a = byHead.get(hp.a), b = byHead.get(hp.b); if (!a || !b || a === b) continue;
    a.hp = { start: hp.dir }; b.hpEnd = true;
  }
  for (const r of st.rests) items.push({ x: r.x, t: r.t, dots: r.dots || 0, rest: true, ...(r.multi ? { multi: r.multi, full: true } : {}) });
  items.sort((a, b) => a.x - b.x);
  // rest dots
  const bars = [];
  const lines = st.bars.map((b) => b.x).filter((x) => x > (items[0] ? items[0].x - sp * 2 : 0));
  // the clef in force at each note (a clef change along the line), and the changes at the start
  // of each bar (bars.meta: { clef, time }); a change after the last note belongs to the next bar
  // (bars.after)
  const signs = (st.signs || []).slice().sort((a, b) => a.x - b.x);
  let clefNow = st.clef || 'treble';
  for (const it of items) { for (const sg of signs) if (sg.clef && sg.x < it.x) clefNow = sg.clef; it.clef = clefNow; clefNow = st.clef || 'treble'; }
  // under an octave line the notes sound an octave from where they are written
  for (const it of items) { if (it.rest) continue; const o = (st.ottavas || []).find((q) => it.x >= q.x0 && it.x <= q.x1); if (o) it.ott = o.shift; }
  let cur = [], bi = 0, carry = {};
  const startX = [];
  for (const it of items) {
    while (bi < lines.length && it.x > lines[bi]) { if (cur.length) { bars.push(cur); startX.push(cur.x0); } cur = []; carry = {}; bi++; }
    if (!cur.length) cur.x0 = bi > 0 ? lines[bi - 1] : -Infinity;
    if (!it.rest) { for (const p of it.ps) { if (it.acc[p] !== undefined) carry[p] = it.acc[p]; else if (carry[p] !== undefined) it.acc[p] = carry[p]; } }
    cur.push(it);
  }
  if (cur.length) { bars.push(cur); startX.push(cur.x0); }
  const meta = bars.map(() => ({}));
  const after = {};
  let prevClef = st.clef || 'treble';
  bars.forEach((b, i) => {
    const c0 = b[0].clef; if (c0 && c0 !== prevClef) meta[i].clef = c0;
    prevClef = b[b.length - 1].clef || prevClef;
  });
  for (const sg of signs) {
    if (!sg.time) continue;
    // the bar whose first note comes after it
    const i = bars.findIndex((b) => b[0].x > sg.x);
    if (i < 0) after.time = sg.time; else meta[i].time = sg.time;
  }
  for (const sg of signs) {
    if (sg.key === undefined) continue;
    const i = bars.findIndex((b) => b[0].x > sg.x);
    if (i < 0) after.key = sg.key; else meta[i].key = sg.key;
  }
  const lastClef = signs.filter((sg) => sg.clef && (!items.length || sg.x > items[items.length - 1].x)).pop();
  if (lastClef) after.clef = lastClef.clef;
  bars.meta = meta; bars.after = after;
  return bars;
}
// Mend a bar whose note values do not add up to the time signature: the fewest changes of
// a dot, a beam or a hollow head that make it fit.
export function fitBar(bar, total, opts = {}) {
  const sum = (b) => b.reduce((a, it) => a + (it.full ? total : ticksOf(it.t, it.dots) * (it.tup ? it.tup.m / it.tup.n : 1)), 0);
  // tuplets: notes under a number (3, 5, 6, 7…) take the time of fewer (a triplet of three
  // quavers lasts two). A number that was seen is believed when it makes the bar add up (or at
  // least come nearer); then beamed groups of three equal notes without a number, as many as
  // the bar needs.
  {
    const raw = (it) => (it.full ? total : ticksOf(it.t, it.dots));
    const mOf = (n) => (n === 3 ? 2 : n === 2 ? 3 : n <= 7 ? 4 : n <= 15 ? 8 : 16);
    const apply = (b, from, to, n) => {
      const len = b.slice(from, to + 1).reduce((a, it) => a + raw(it), 0);
      const unit = len / n, base = WHOLE / unit;
      const ok = Number.isInteger(base) && [1, 2, 4, 8, 16, 32, 64].includes(base);
      for (let k = from; k <= to; k++) b[k] = { ...b[k], tup: { n, m: mOf(n), i: k - from, ...(ok ? { base } : {}) } };
    };
    let b = bar.slice();
    // the groups that were marked, with any rests between their notes
    const marked = new Map();
    b.forEach((it, i) => { if (it.tupG) { const g = marked.get(it.tupG) || { from: i, to: i, n: it.tupN || 3 }; g.to = i; marked.set(it.tupG, g); } });
    for (const g of marked.values()) {
      if (b.slice(g.from, g.to + 1).some((x) => x.tup || x.full)) continue;
      const t2 = b.slice(); apply(t2, g.from, g.to, g.n);
      const before = Math.abs(sum(b) - total), after = Math.abs(sum(t2) - total);
      if (after < before - 1 || after < 1) b = t2;
    }
    // then unmarked: three equal beamed notes of one beam
    for (let i = 0; i + 2 < b.length; i++) {
      if (sum(b) <= total + 1) break;
      const g = b.slice(i, i + 3);
      if (g.some((x) => x.full || x.tup || x.rest || x.t < 8 || x.t !== g[0].t || x.dots || !x.beamed)) continue;
      if (g[0].bg !== null && g[0].bg !== undefined && !g.every((x) => x.bg === g[0].bg)) continue;
      // (a beam of more than three notes is not a triplet)
      if (g[0].bg !== null && g[0].bg !== undefined && b.filter((x) => x.bg === g[0].bg).length !== 3) continue;
      const t2 = b.slice(); apply(t2, i, i + 2, 3); if (sum(t2) >= total - 1) { b = t2; i += 2; }
    }
    if (Math.abs(sum(b) - total) < Math.abs(sum(bar) - total) || b.some((x) => x.tup)) bar = b;
  }
  const s0 = sum(bar);
  if (opts.tupletsOnly) return bar;
  if (Math.abs(s0 - total) < 1) return bar;
  // a whole rest alone fills the bar, whatever the time
  if (bar.length === 1 && bar[0].rest && bar[0].t === 1) return [{ ...bar[0], full: true }];
  if (opts.pickup && s0 < total) return bar;
  const edits = (it) => {
    const out = [];
    if (it.dots) out.push({ ...it, dots: 0 }); else if (it.t < 32) out.push({ ...it, dots: 1 });
    if (it.t > 1) out.push({ ...it, t: it.t / 2, dots: it.dots });
    if (it.t < 32) out.push({ ...it, t: it.t * 2, dots: it.dots });
    return out;
  };
  const n = bar.length;
  // of the changes that make the bar add up, the likeliest: a dot nobody saw is a guess, while a
  // note beamed with others is most likely as short as they are
  const cost = (it, e) => {
    let c = e.dots !== it.dots ? (e.dots ? 1.0 : 0.9) : 1.0;
    if (it.bg !== null && it.bg !== undefined && !it.rest) {
      const ts = bar.filter((q) => q !== it && q.bg === it.bg && !q.rest).map((q) => q.t);
      if (ts.length) {
        const m = ts.sort((a, b2) => ts.filter((v) => v === b2).length - ts.filter((v) => v === a).length)[0];
        if (e.t === m && it.t !== m) c -= 0.6; else if (it.t === m && e.t !== m) c += 0.4;
      }
    }
    return c;
  };
  let best = null;
  for (let i = 0; i < n; i++) for (const e of edits(bar[i])) { const b = bar.slice(); b[i] = e; if (Math.abs(sum(b) - total) < 1) { const c = cost(bar[i], e); if (!best || c < best.c) best = { b, c }; } }
  // a lone flagged quaver right against the next note (a grace note printed nearly full size): a
  // grace of that note
  if (opts.sp) for (let i = 0; i + 1 < n; i++) {
    const it = bar[i], nx = bar[i + 1];
    if (it.rest || it.full || it.tup || it.t !== 8 || it.dots || it.beamed || (it.ps || []).length !== 1 || nx.rest || nx.grace || nx.full) continue;
    if (!(nx.x - it.x > 0 && nx.x - it.x < opts.sp * 1.5)) continue;
    const b = bar.slice(); b.splice(i, 2, { ...nx, grace: { p: it.ps[0] } });
    if (Math.abs(sum(b) - total) < 1) { const c = 0.8; if (!best || c < best.c) best = { b, c }; }
  }
  if (best) return best.b;
  if (n <= 14) {
    for (let i = 0; i < n; i++) for (const e of edits(bar[i])) for (let j = i + 1; j < n; j++) for (const e2 of edits(bar[j])) {
      const b = bar.slice(); b[i] = e; b[j] = e2; if (Math.abs(sum(b) - total) < 1) { const c = cost(bar[i], e) + cost(bar[j], e2); if (!best || c < best.c) best = { b, c }; }
    }
    if (best) return best.b;
  }
  return bar;
}

// For Compose: read a picture and return bars of one staff per system, in reading order,
// with the clef, key and time that were found.
export async function recognise(canvas, opts = {}) {
  const A = await analyse(canvas, opts.dbg);
  if (!A.staves.length) return null;
  const pick = opts.staff || 0;
  const staffIn = (sys) => A.staves[sys[Math.min(pick, sys.length - 1)]];
  const first = staffIn(A.systems[0]);
  let bars = [], meta = [];
  const barSys = [];
  // each line: its own clef, key and time at its start (when they change), and the changes along it
  let pending = {};
  A.systems.forEach((sys, si) => {
    const st = staffIn(sys);
    const b = staffEvents(st);
    if (!b.length) { Object.assign(pending, b.after || {}); return; }
    const m = b.meta.map((q) => ({ ...q }));
    const head = { ...pending };
    if (si > 0) {
      if (st.explicitClef && st.clef) head.clef = st.clef;
      if (st.key !== undefined && st.key !== null) head.key = st.key;
      if (st.time) head.time = st.time;
    }
    m[0] = { ...head, ...m[0] };
    pending = { ...(b.after || {}) };
    bars.push(...b); meta.push(...m); b.forEach(() => barSys.push(si));
  });
  // a bar of several bars' rest becomes that many empty bars
  {
    const out = [], os = [], om = [];
    bars.forEach((b, i) => { const m = b.length === 1 && b[0].multi; if (m) for (let k = 0; k < m; k++) { out.push([{ rest: true, t: 1, dots: 0, full: true, x: b[0].x }]); os.push(barSys[i]); om.push(k ? {} : meta[i]); } else { out.push(b); os.push(barSys[i]); om.push(meta[i]); } });
    bars = out; meta = om; barSys.length = 0; barSys.push(...os);
  }
  // the time signature: as read, unless the bars clearly say otherwise (only the bars before the
  // first change of time count)
  const firstChange = meta.findIndex((m, i) => i > 0 && m.time);
  const before = firstChange > 0 ? bars.slice(0, firstChange) : bars;
  const time = chooseTime(first, before.filter((b) => !(b.length === 1 && b[0].full)));
  // the time of each bar
  const times = []; { let t = time; meta.forEach((m, i) => { if (i > 0 && m.time) t = m.time; times.push(t); }); }
  const totalOf = (i) => (WHOLE * times[i][0]) / times[i][1];
  const sumOf = (b, total) => b.reduce((a, it) => a + (it.full ? total : ticksOf(it.t, it.dots) * (it.tup ? it.tup.m / it.tup.n : 1)), 0);
  const firstShort = bars.length > 1 && sumOf(bars[0], totalOf(0)) < totalOf(0) - 1;
  // how many bars add up as read (before any repair): a measure of how well the page was read
  const fitsAsRead = (b, i) => Math.abs(sumOf(fitBar(b, totalOf(i), { tupletsOnly: true }), totalOf(i)) - totalOf(i)) < 1;
  const innerIdx = bars.map((_, i) => i).slice(1, -1);
  const fitRead = innerIdx.length ? innerIdx.filter((i) => fitsAsRead(bars[i], i)).length / innerIdx.length : bars.length ? (fitsAsRead(bars[0], 0) ? 1 : 0.5) : 0;
  // the bars to check: those that did not add up as read (a short first or last bar is an upbeat),
  // and any that still do not after the repair
  const doubt = bars.map((b, i) => { const pick = i === 0 || (i === bars.length - 1 && firstShort); if (b.length === 1 && b[0].full) return false; const sm = sumOf(fitBar(b, totalOf(i), { tupletsOnly: true }), totalOf(i)); return pick ? sm > totalOf(i) + 1 : Math.abs(sm - totalOf(i)) >= 1; });
  bars = bars.map((b, i) => fitBar(b, totalOf(i), { pickup: i === 0 || (i === bars.length - 1 && firstShort), sp: first.sp }));
  bars.forEach((b, i) => { const pick = i === 0 || (i === bars.length - 1 && firstShort); const sm = sumOf(b, totalOf(i)); if (b.length === 1 && b[0].full) return; if (pick ? sm > totalOf(i) + 1 : Math.abs(sm - totalOf(i)) >= 1) doubt[i] = true; });
  // the changes, as the caller applies them: the first bar's are the capture's own clef, key, time
  let runClef = first.clef || 'treble', runKey = first.key || 0;
  const changes = meta.map((m, i) => {
    const o = {};
    if (i > 0 && m.time && (m.time[0] !== times[i - 1][0] || m.time[1] !== times[i - 1][1])) o.time = m.time;
    if (i > 0 && m.clef && m.clef !== runClef) { o.clef = m.clef; runClef = m.clef; }
    if (i > 0 && m.key !== undefined && m.key !== null && m.key !== runKey) { o.key = m.key; runKey = m.key; }
    return o;
  });
  const notes = bars.flat().filter((n) => !n.rest);
  // the words seen around each line (read as text later), with the line they belong to
  const texts = [];
  A.systems.forEach((sys, si) => { for (const t of staffIn(sys).texts || []) texts.push({ ...t, sys: si }); });
  return { fitRead, bars, doubt, barSys: barSys.slice(), texts, changes, notes, clef: first.clef || 'treble', key: first.key || 0, time, timeRead: !!first.time, staves: A.staves.length, systems: A.systems.length, analysis: A };
}
// 3/4 or 6/8 (and 3/2 or 6/4 or 12/8)? Where the notes start in the bar tells: in 6/8 the second
// beat is on the 4th quaver, in 3/4 on the 3rd and 5th.
function compoundFeel(bars) {
  // only notes and rests of a beat or longer: runs of quavers start everywhere in both
  let six = 0, three = 0;
  for (const b of bars) {
    let p = 0;
    for (const it of b) {
      const len = ticksOf(it.t, it.dots);
      const e = Math.round((p * 8) / WHOLE);
      if (len >= WHOLE / 4 && Math.abs((p * 8) / WHOLE - e) < 0.01) { if (e === 3) six++; if (e === 2 || e === 4) three++; }
      if (it.t === 4 && it.dots === 1) six += 0.5;
      p += len;
    }
  }
  return six - three;
}
function chooseTime(st, bars) {
  const pick = (t) => {
    // the same length of bar can be simple or compound: the rhythm decides when it is clear
    const feel = compoundFeel(bars.slice(1));
    // digits read clearly are believed unless the rhythm says otherwise again and again
    const need = st.time && st.time[0] === t[0] && st.time[1] === t[1] ? 5 : 3;
    if (t[0] === 3 && t[1] === 4 && feel >= need) return [6, 8];
    if (t[0] === 6 && t[1] === 8 && feel <= -need) return [3, 4];
    return t;
  };
  // how many bars add up in a time (with their tuplets, without other repairs)
  const inner = bars.length > 2 ? bars.slice(1, -1) : bars;
  const sums = inner;
  const fit = (t) => {
    const tot = (WHOLE * t[0]) / t[1];
    if (!inner.length) return 0;
    let n = 0;
    for (const b of inner) { const f = fitBar(b, tot, { tupletsOnly: true }); const s2 = f.reduce((a, it) => a + (it.full ? tot : ticksOf(it.t, it.dots) * (it.tup ? it.tup.m / it.tup.n : 1)), 0); if (Math.abs(s2 - tot) < 1) n++; }
    return n / inner.length;
  };
  const cands = [[4, 4], [3, 4], [2, 4], [6, 8], [2, 2], [3, 8], [9, 8], [12, 8], [5, 4], [6, 4], [3, 2]];
  if (st.time && st.time[0] > 0 && [1, 2, 4, 8, 16].includes(st.time[1])) {
    const read = st.time;
    // digits that were nearly something else
    const alts = [read];
    if (st.timeAlt && st.timeAlt.u) {
      for (const u of st.timeAlt.u[0] || []) for (const l of (st.timeAlt.l && st.timeAlt.l[0]) || []) if (u.d < 0.45 && l.d < 0.45 && [2, 4, 8].includes(l.v) && u.v > 0) alts.push([u.v, l.v]);
    }
    const best = alts.map((t) => ({ t, f: fit(t) + (t === read ? 0.15 : 0) })).sort((a, b) => b.f - a.f)[0];
    return pick(best.t);
  }
  if (!sums.length) return [4, 4];
  const best = cands.map((t, i) => ({ t, f: fit(t) - i * 0.001 })).sort((a, b) => b.f - a.f)[0];
  return best.f > 0 ? pick(best.t) : [4, 4];
}
export const _dbg = { grayAt, flatten, binarize, findStaves, removeLines, holeMask, openOval, label, classify, shapeOf, yAt, pAt, staffMetrics };

// Read a picture twice, as it is and with its paper evened out and its ink darkened, and keep the
// reading whose bars add up best (photos and pale copies often read better the second way).
export async function recogniseBest(canvas, opts = {}) {
  softNext = null;
  const a = await recognise(canvas, opts);
  const soft = softNext ?? 0;
  if (a && a.fitRead >= 0.95) return a;
  let b = null;
  try {
    const { whitenPaper, levels } = await import('./scan.js');
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0); whitenPaper(c); levels(c, 62, true);
    b = await recognise(c, opts);
  } catch (err) { console.warn(err); }
  // and once more with the edges made crisper (a photo a little out of focus)
  // (how soft: the grey edge around the ink against the ink itself; a sharp print stays under
  // about 1.7, a photo out of focus or a worn scan goes well above 2)
  let c2 = null;
  if (soft > 1.9) try { sharpNext = 1; c2 = await recognise(canvas, opts); } catch (err) { console.warn(err); } finally { sharpNext = 0; }
  const score = (r) => r.fitRead + Math.min(r.notes.length, 200) * 0.0004;
  if (globalThis.__rbDbg) globalThis.__rbFits = { soft, a: a && a.fitRead, b: b && b.fitRead, c2: c2 && c2.fitRead };
  let best = a;
  for (const r of [b, c2]) if (r && (!best || score(r) > score(best) + 0.04)) best = r;
  // (clearly soft: the crisper reading is the likelier one, unless it is clearly worse)
  if (c2 && soft > 2.3 && best !== c2 && score(c2) >= score(best) - 0.03) best = c2;
  return best;
}
let sharpNext = 0, softNext = 0;
