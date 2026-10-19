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

const SP = 20;                  // working size of a staff space, in pixels
const GW = 12, GH = 20;         // shape grid
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
  const th = Math.max(95, Math.min(215, otsu(v)));
  const th2 = Math.max(80, Math.min(th, Math.round((ink + 245) / 2)));
  const b = new Uint8Array(w * h);
  for (let i = 0; i < b.length; i++) b[i] = v[i] < th ? 1 : 0;
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
  return { sp: best, T, votes: pair[best] };
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
function findStaves(b, w, h, sp, T) {
  const SW = Math.max(40, Math.round(sp * 6));
  const groups = [];
  for (let xs = 0; xs + SW * 0.5 < w; xs += Math.round(SW / 2)) {
    const xe = Math.min(w, xs + SW), n = xe - xs;
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) { let c = 0; const row = y * w; for (let x = xs; x < xe; x++) c += b[row + x]; prof[y] = c / n; }
    const lines = [], strength = [];
    for (let y = 0; y < h; y++) {
      if (prof[y] < 0.45) continue;
      let e = y; while (e + 1 < h && prof[e + 1] >= 0.45) e++;
      if (e - y + 1 <= Math.max(3, T * 2.6)) {
        // centre weighted by darkness
        let s = 0, sw = 0, pk = 0; for (let k = y; k <= e; k++) { s += k * prof[k]; sw += prof[k]; pk = Math.max(pk, prof[k]); }
        lines.push(s / sw); strength.push(pk);
      }
      y = e;
    }
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
      groups.push({ xc: xs + n / 2, xs, ys: c.chain.map((k) => lines[k]), score: c.score });
    }
  }
  // link the pieces strip by strip
  groups.sort((a, b2) => a.xc - b2.xc);
  const tracks = [];
  for (const gr of groups) {
    const mid = (gr.ys[0] + gr.ys[4]) / 2;
    let best = null, bd = Infinity;
    for (const t of tracks) {
      const last = t[t.length - 1];
      if (gr.xc - last.xc > SW * 4 || last.xc === gr.xc) continue;
      let pred = (last.ys[0] + last.ys[4]) / 2;
      if (t.length > 1) { const p2 = t[t.length - 2]; const slope = (pred - (p2.ys[0] + p2.ys[4]) / 2) / (last.xc - p2.xc); if (Math.abs(slope) < 0.15) pred += slope * (gr.xc - last.xc); }
      const d = Math.abs(mid - pred);
      if (d < sp * 0.9 && d < bd) { bd = d; best = t; }
    }
    if (best) best.push(gr); else tracks.push([gr]);
  }
  const staves = [];
  for (const t of tracks) {
    if (t.length < 2 && w > SW * 2.5) continue;
    const span = t[t.length - 1].xc - t[0].xc;
    if (span < sp * 6 && w > sp * 20) continue;
    staves.push(makeStaff(t, b, w, h, T));
  }
  // drop a staff that overlaps a better one
  staves.sort((a, b2) => a.top - b2.top);
  const out = [];
  for (const s of staves) { const l = out[out.length - 1]; if (l && s.top < l.bottom + s.sp * 0.5) { if (s.samples.length > l.samples.length) out[out.length - 1] = s; continue; } out.push(s); }
  return out;
}
function makeStaff(samples, b, w, h, T) {
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
  let miss = 0; while (x0 > 0 && miss < 4) { x0--; if (on(x0)) miss = 0; else miss++; } x0 += miss;
  miss = 0; while (x1 < w - 1 && miss < 4) { x1++; if (on(x1)) miss = 0; else miss++; } x1 -= miss;
  const sps = samples.map((q) => (q.ys[4] - q.ys[0]) / 4);
  const sp = sps.reduce((a, q) => a + q, 0) / sps.length;
  const xm = Math.round((x0 + x1) / 2);
  return { L, x0, x1, sp, thick: T, top: L[0][xm], bottom: L[4][xm], lines: [0, 1, 2, 3, 4].map((k) => L[k][xm]), samples };
}
// the height of staff position p (0 = bottom line, 2 = next line up...) at x
const yAt = (s, p, x) => { const xi = Math.max(0, Math.min(s.L[0].length - 1, Math.round(x))); const top = s.L[0][xi], bot = s.L[4][xi]; return bot - (p * (bot - top)) / 8; };
const pAt = (s, y, x) => { const xi = Math.max(0, Math.min(s.L[0].length - 1, Math.round(x))); const top = s.L[0][xi], bot = s.L[4][xi]; return ((bot - y) * 8) / (bot - top); };

// Take staff lines (and ledger lines) away where nothing crosses them.
function removeLines(b, w, h, staves, T) {
  const o = b.slice();
  const maxRun = T + 2;
  const vrun = (x, y) => { let a = y, c = y; while (a > 0 && b[(a - 1) * w + x] && y - a < maxRun + 2) a--; while (c < h - 1 && b[(c + 1) * w + x] && c - y < maxRun + 2) c++; return c - a + 1; };
  for (const s of staves) {
    const half = T / 2 + 0.7;
    for (let p = -10; p <= 18; p += 2) {
      const ledger = p < 0 || p > 8;
      const xa = Math.max(0, s.x0 - (ledger ? 0 : 2)), xb = Math.min(w - 1, s.x1 + (ledger ? 0 : 2));
      for (let x = xa; x <= xb; x++) {
        const yc = yAt(s, p, x);
        for (let y = Math.floor(yc - half); y <= Math.ceil(yc + half); y++) {
          if (y < 0 || y >= h || !b[y * w + x]) continue;
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

// ---------- one staff ----------
function readStaff(s, ctx, header) {
  const { B, C, F, O, holes, w, h, compsC, labC, T } = ctx;
  const sp = s.sp;
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
  // hollow heads read from the grey picture: a dark oval ring around a light middle. This finds
  // half and whole notes whose hole closed up when the picture was blurred or enlarged
  {
    const G = B.gray, th = B.th;
    const ringPts = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) ringPts.push(Math.cos(a) * rx * 0.86, Math.sin(a) * ry * 0.95);
    const dark = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h && G[yi * w + xi] < th + 12; };
    // the middle, just above and below the centre row (a staff line may run through the centre)
    const lightAt = (x, y) => { let sum = 0, n = 0; for (const dy of [-1, 1]) for (let dx = -2; dx <= 2; dx++) { const xi = Math.round(x + dx * rx * 0.12), yi = Math.round(y + dy * Math.max(ry * 0.38, T * 0.5 + 1.5)); if (xi >= 0 && yi >= 0 && xi < w && yi < h) { sum += G[yi * w + xi]; n++; } } return n ? sum / n : 0; };
    const ring = [];
    for (let p = -8; p <= 16; p++) {
      for (let x = Math.round(s.x0 + sp); x <= Math.round(s.x1 - sp * 0.5); x++) {
        const cy = yAt(s, p, x);
        if (!dark(x - rx * 0.86, cy) || !dark(x + rx * 0.86, cy)) continue;
        // not the space between two stems or barlines (they run on above and below)
        const runs = (xx) => dark(xx, cy - sp * 1.3) && dark(xx, cy + sp * 1.3);
        if (runs(x - rx * 0.86) || runs(x + rx * 0.86)) continue;
        const vlen = (xx) => { const xi = Math.round(xx); let u = Math.round(cy), d = u; while (u > 0 && (C[(u - 1) * w + xi] || C[(u - 1) * w + xi + 1] || C[(u - 1) * w + xi - 1])) u--; while (d < h - 1 && (C[(d + 1) * w + xi] || C[(d + 1) * w + xi + 1] || C[(d + 1) * w + xi - 1])) d++; return d - u; };
        if (vlen(x - rx * 0.86) > sp * 1.7 && vlen(x + rx * 0.86) > sp * 1.7) continue;
        const mid = lightAt(x, cy); if (mid < th + 28) continue;
        let n = 0; for (let i = 0; i < ringPts.length; i += 2) if (dark(x + ringPts[i], cy + ringPts[i + 1])) n++;
        const f = n / (ringPts.length / 2);
        if (f >= 0.72) ring.push({ cx: x, cy, p, sc: f + (mid - th) / 600, fit: f, comp: null, ringHead: true });
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
      if (heads.some((q) => Math.abs(q.cx - c.cx) < sp * 0.95 && Math.abs(q.p - c.p) < 2)) continue;
      heads.push(c);
    }
  }
  // how wide is each head (whole notes are wider)
  for (const hd of heads) {
    if (hd.ringHead) {
      // out from the light middle, across the ring, to the paper
      const y = Math.round(hd.cy); let a = Math.round(hd.cx), z = a;
      while (a > 0 && !B[y * w + a]) a--; while (a > 0 && B[y * w + a - 1]) a--;
      while (z < w - 1 && !B[y * w + z]) z++; while (z < w - 1 && B[y * w + z + 1]) z++;
      hd.wRow = z - a + 1; hd.left = a; hd.right = z; continue;
    }
    const y = Math.round(hd.cy); let a = Math.round(hd.cx), z = a;
    while (a > 0 && O.img[y * w + a - 1]) a--; while (z < w - 1 && O.img[y * w + z + 1]) z++;
    hd.wRow = z - a + 1; hd.left = a; hd.right = z;
  }
  if (ctx.dbg) ctx.allHeads = heads.map((hd) => ({ cx: Math.round(hd.cx), p: hd.p, wRow: +(hd.wRow / sp).toFixed(2), sc: +hd.sc.toFixed(2) }));
  // a head stuck to the accidental in front of it (both read as one wide oval): keep the head end,
  // when the extra part on the left is tall like an accidental
  for (const hd of heads) {
    if (hd.wRow <= sp * 1.7) continue;
    const cx2 = hd.right - rx * 1.02;
    if (fill(cx2, hd.cy) < 0.86) continue;
    const xl = Math.round(hd.left + sp * 0.25);
    let a2 = Math.round(hd.cy), z2 = a2;
    while (a2 > 0 && (C[(a2 - 1) * w + xl] || C[(a2 - 1) * w + xl + 1])) a2--;
    while (z2 < h - 1 && (C[(z2 + 1) * w + xl] || C[(z2 + 1) * w + xl + 1])) z2++;
    if (z2 - a2 < sp * 1.5) continue;
    hd.cx = cx2; hd.left = Math.round(hd.right - rx * 2.04); hd.wRow = hd.right - hd.left + 1; hd.trimmed = true;
  }
  // narrower than a note head: the bowl of a flat, a dot, a letter
  heads = heads.filter((hd) => hd.wRow >= sp * 1.0);
  // wider than a note head: thick or blurred beams (unless it is two heads side by side, a second)
  // hollow: a hole in the middle of the head, not one beside it (a flag curling back to the head)
  const holeAt = (hd) => {
    let inn = 0, out = 0;
    for (let dy = -Math.round(sp * 0.9); dy <= Math.round(sp * 0.9); dy++) for (let dx = -Math.round(sp * 1.0); dx <= Math.round(sp * 1.0); dx++) {
      const x = Math.round(hd.cx) + dx, y = Math.round(hd.cy) + dy; if (x < 0 || y < 0 || x >= w || y >= h || !holes[y * w + x]) continue;
      if ((dx / (rx * 0.85)) ** 2 + (dy / (ry * 1.1)) ** 2 <= 1) inn++; else out++;
    }
    return inn >= Math.max(3, sp * sp * 0.025) && out < inn * 0.7;
  };
  for (const hd of heads) hd.hollow = hd.ringHead || holeAt(hd);
  heads = heads.filter((hd) => hd.wRow <= sp * (hd.hollow ? 2.15 : 1.7) || heads.some((q) => q !== hd && Math.abs(q.p - hd.p) === 1 && Math.abs(q.cx - hd.cx) > sp * 0.75 && Math.abs(q.cx - hd.cx) < sp * 1.5));
  // a wide oval read as two heads side by side is one whole note
  heads.sort((a, b2) => a.cx - b2.cx);
  heads = heads.filter((hd, i) => !heads.some((q, j) => j !== i && q.p === hd.p && q.comp === hd.comp && Math.abs(q.cx - hd.cx) < sp * 1.5 && q.wRow > sp * 1.45 && (q.sc > hd.sc || (q.sc === hd.sc && j < i))));
  // notes above or below the staff need their ledger lines
  heads = heads.filter((hd) => {
    if (hd.p >= -1 && hd.p <= 9) return true;
    const lp = hd.p < 0 ? -2 : 10;
    const ly = yAt(s, lp, hd.cx);
    let best = 0;
    for (let dy = -Math.ceil(T / 2) - 1; dy <= Math.ceil(T / 2) + 1; dy++) {
      const y = Math.round(ly + dy); if (y < 0 || y >= h) continue;
      let run = 0; for (let x = Math.round(hd.cx - rx - sp * 0.25); x <= Math.round(hd.cx + rx + sp * 0.25); x++) if (B[y * w + x]) run++;
      best = Math.max(best, run);
    }
    return best >= (2 * rx + sp * 0.5) * 0.85;
  });
  // ---- hollow or filled, stem, beams, dot
  for (const hd of heads) {
    hd.stem = stemOf(C, w, h, hd, rx, sp);
    hd.beams = hd.stem ? beamsOf(C, w, h, hd.stem, sp) : 0;
    hd.dots = dotOf(C, w, h, hd, s, sp, labC, ctx.rawC);
    hd.kind = hd.hollow ? (hd.stem ? 'half' : 'whole') : (hd.wRow > sp * 1.6 && !hd.stem ? 'whole' : 'black');
    hd.x = hd.left; hd.y = hd.cy; hd.w = hd.right - hd.left + 1;
  }
  // a stroke through the 'head' both ways is no stem: the middle of a sharp or a natural
  for (const hd of heads) {
    const st = hd.stem; if (!st || st.back < sp * 1.15) continue;
    const carried = heads.some((q) => q !== hd && Math.abs(q.cy - st.backEnd) < sp * 0.9 && Math.abs(q.cx - hd.cx) < sp * 1.4 && (st.up ? q.cy > hd.cy : q.cy < hd.cy));
    if (!carried) { hd.stem = null; hd.beams = 0; hd.kind = hd.hollow ? 'whole' : 'black'; }
  }
  // a 'head' just left of a note and a step above it, without its own stem: part of an accidental
  heads = heads.filter((hd) => !heads.some((q) => q !== hd && q.cx - hd.cx > sp * 0.55 && q.cx - hd.cx < sp * 1.45 && hd.p - q.p === 1 && q.stem && (!hd.stem || Math.abs(hd.stem.x - q.stem.x) > sp * 0.45)));
  // a stemless 'whole note' right next to a note with a stem is that note's accidental and head read together
  heads = heads.filter((hd) => hd.stem || !heads.some((q) => q !== hd && q.stem && Math.abs(q.cx - hd.cx) < sp * 1.1 && Math.abs(q.p - hd.p) <= 2));
  // without a stem only a whole note (wide) is a note
  heads = heads.filter((hd) => hd.stem || hd.wRow >= sp * (hd.ringHead ? 1.45 : hd.hollow ? 1.3 : 1.45));
  // ---- barlines: tall thin strokes from the top line to the bottom line that are not stems
  const bars = [];
  const yTop = (x) => Math.round(yAt(s, 8, x)), yBot = (x) => Math.round(yAt(s, 0, x));
  for (let x = Math.round(s.x0); x <= Math.round(s.x1); x++) {
    const cover = (xx) => { const a = yTop(xx), z = yBot(xx); let n = 0; for (let y = a; y <= z; y++) n += B[y * w + xx] || 0; return n / (z - a + 1); };
    if (cover(x) < 0.9) continue;
    let e = x; while (e + 1 <= s.x1 && cover(e + 1) >= 0.9) e++;
    const width = e - x + 1, cx = (x + e) / 2;
    // a barline stands alone: just beside it the staff is empty (unlike the digits of a time signature)
    const side = (xx) => { const a = yTop(xx), z = yBot(xx); let n = 0; for (let y = a; y <= z; y++) n += C[y * w + xx] || 0; return n / (z - a + 1); };
    const beside = Math.min(side(Math.round(x - sp * 0.22)), side(Math.round(e + sp * 0.22)));
    if (beside > 0.45) { x = e + 1; continue; }
    // and straight: hardly anything joins it sideways (digits and clefs have strokes off their sides)
    {
      const a0 = yTop(cx), z0 = yBot(cx); let wide = 0, tot = 0;
      for (let y = a0 + 2; y <= z0 - 2; y++) {
        let l = x, r = e; while (l > 0 && C[y * w + l - 1]) l--; while (r < w - 1 && C[y * w + r + 1]) r++;
        tot++; if (r - l + 1 > (e - x + 1) + sp * 0.35) wide++;
      }
      if (tot && wide / tot > 0.3) { x = e + 1; continue; }
    }
    const stemOfHead = heads.some((hd) => hd.stem && Math.abs(hd.stem.x - cx) < sp * 0.45);
    const ya = yTop(cx), yb = yBot(cx);
    let up = 0; while (ya - up - 1 > 0 && (B[(ya - up - 1) * w + Math.round(cx)])) up++;
    let dn = 0; while (yb + dn + 1 < h && (B[(yb + dn + 1) * w + Math.round(cx)])) dn++;
    const toNext = ctx.staffBelow(s) && dn > (ctx.staffBelow(s).top - s.bottom) * 0.9;
    const toPrev = ctx.staffAbove(s) && up > (s.top - ctx.staffAbove(s).bottom) * 0.9;
    if (!stemOfHead && width <= sp * 0.75 && (up < sp * 0.9 || toPrev) && (dn < sp * 0.9 || toNext)) bars.push({ x: cx, w: width, thick: width > sp * 0.3 });
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
  const isAcc = new Set(), accBoxesW = [];
  for (const c of compsC) {
    if (c.x0 < startX - sp * 0.2 || c.x1 > s.x1 || c.h < sp * 1.2 || c.h > sp * 3.8 || c.w > sp * 1.7 || c.w < sp * 0.3) continue;
    if (!band((c.y0 + c.y1) / 2)) continue;
    // something with a head in it is not an accidental
    if (ctx.dbg && c.h > sp * 1.5 && c.w < sp * 1.2) (ctx.accTrace = ctx.accTrace || []).push({ x0: c.x0, y0: c.y0, h: +(c.h / sp).toFixed(2), w: +(c.w / sp).toFixed(2), headIn: heads.some((hd) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1), k: ctx.best(c, ['sharp', 'flat', 'natural', 'dflat'], sp * 1.8) });
    if (heads.some((hd) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1)) continue;
    const near = heads.filter((hd) => hd.left - c.x1 > -sp * 0.15 && hd.left - c.x1 < sp * 1.6 && hd.cy > c.y0 - sp * 0.3 && hd.cy < c.y1 + sp * 0.3);
    if (!near.length) continue;
    if (isAcc.has(c.id)) continue;
    const k = ctx.best(c, ['sharp', 'flat', 'natural', 'dflat'], sp * 1.8);
    if (k.d > 0.42) continue;
    const a = { sharp: 1, flat: -1, natural: 0, dflat: -2 }[k.cls];
    // which head: sharps and naturals are centred on their note, a flat's bowl is
    const want = k.cls === 'flat' || k.cls === 'dflat' ? c.y1 - sp * 0.55 : (c.y0 + c.y1) / 2;
    near.sort((p, q) => Math.abs(p.cy - want) - Math.abs(q.cy - want));
    if (Math.abs(near[0].cy - want) < sp * 0.6 && near[0].acc === undefined) { near[0].acc = a; isAcc.add(c.id); if (k.with) isAcc.add(k.with.id); }
  }
  // accidentals that touch their note (close engraving, small print, blur): look in a window just
  // before each head instead of at whole shapes
  for (const hd of heads) {
    if (hd.acc !== undefined || hd.left < startX) continue;
    let bestK = null;
    for (const [cls, W, up, dn] of [['sharp', 1.05, 1.6, 1.6], ['natural', 0.8, 1.6, 1.6], ['flat', 1.0, 2.15, 0.8]]) {
      const ya = Math.round(hd.cy - up * sp), yb = Math.round(hd.cy + dn * sp);
      for (let x = Math.round(hd.left - sp * 2.2); x <= Math.round(hd.left - sp * (W + 0.03)); x++) {
        const xb = Math.min(Math.round(x + W * sp), Math.round(hd.left - sp * 0.04));
        let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
        for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) for (let xx = Math.max(0, x); xx <= xb; xx++) if (C[y * w + xx]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0 || x0 > x + sp * 0.2 || (y1 - y0) < sp * (cls === 'flat' ? 1.8 : 2.0) || x1 - x0 < sp * 0.35) continue;
        // not cut off at the edges of the window (then it is part of something bigger)
        if (y0 <= ya || y1 >= yb) continue;
        const k = classify(shapeOf(C, w, x0, y0, x1, y1, sp), ['sharp', 'natural', 'flat', 'r4', 'r8', 'r16', 'd4', 'd1']);
        if (k.cls === cls && k.d < 0.34 && (!bestK || k.d < bestK.d)) bestK = { ...k, x0, x1, y0, y1 };
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
  heads = heads.filter((hd) => ![...accBoxes, ...accBoxesW].some((c) => hd.cx > c.x0 && hd.cx < c.x1 && hd.cy > c.y0 && hd.cy < c.y1));
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
    if (c.n < sp * sp * 0.08) continue;
    if (c.x0 < startX - sp * 0.1 || c.x1 > s.x1 + sp * 0.3) continue;
    if (allAcc.some((q) => c.x0 < q.x1 && c.x1 > q.x0 && c.y0 < q.y1 && c.y1 > q.y0)) continue;
    const cyc = (c.y0 + c.y1) / 2, pc = pAt(s, cyc, (c.x0 + c.x1) / 2);
    if (pc < -1 || pc > 9) continue;
    if (heads.some((hd) => hd.cx > c.x0 - sp * 0.3 && hd.cx < c.x1 + sp * 0.3 && hd.cy > c.y0 - sp * 0.6 && hd.cy < c.y1 + sp * 0.6)) continue;
    if (heads.some((hd) => hd.stem && hd.stem.x >= c.x0 - 1 && hd.stem.x <= c.x1 + 1 && ((hd.stem.top <= c.y1 && hd.stem.bot >= c.y0)))) continue;
    if (c.w > sp * 1.8 || c.h > sp * 4.2 || c.h < sp * 0.3) continue;
    let t = null;
    if (ctx.dbg && c.h > sp * 1.3) (ctx.restTrace = ctx.restTrace || []).push({ x0: c.x0, w: +(c.w / sp).toFixed(2), h: +(c.h / sp).toFixed(2), pc: +pc.toFixed(1), k: classify(shapeOf(img, w, c.x0, c.y0, c.x1, c.y1, sp, lab, c.id), ['r4', 'r8', 'r16', 'r32', 'sharp', 'flat', 'natural', 'treble', 'bass', 'alto', 'd2', 'd3', 'd4', 'd6', 'd8']) });
    if (c.h < sp * 0.8 && c.w > sp * 0.8 && c.w < sp * 1.7 && c.n > c.w * c.h * 0.7) {
      // a block: hanging from the 4th line is a whole rest, sitting on the middle line a half rest
      const l6 = yAt(s, 6, c.x0), l4 = yAt(s, 4, c.x0);
      if (Math.abs(c.y0 - (l6 - T / 2)) < sp * 0.3) t = 1; else if (Math.abs(c.y1 - (l4 + T / 2)) < sp * 0.3) t = 2;
    } else if (c.h > sp * 1.3) {
      const k = classify(shapeOf(img, w, c.x0, c.y0, c.x1, c.y1, sp, lab, c.id), ['r4', 'r8', 'r16', 'r32', 'sharp', 'flat', 'natural', 'treble', 'bass', 'alto', 'd2', 'd3', 'd4', 'd6', 'd8']);
      if (k.d < 0.36 && k.cls[0] === 'r') t = { r4: 4, r8: 8, r16: 16, r32: 32 }[k.cls];
    }
    if (t) {
      // a dot just after the rest
      const dot = compsC.some((q) => q !== c && q.x0 > c.x1 && q.x0 < c.x1 + sp * 1.0 && q.w < sp * 0.7 && q.h < sp * 0.7 && q.w > sp * 0.17 && q.h > sp * 0.17 && Math.abs(pAt(s, (q.y0 + q.y1) / 2, q.x0) - 5) < 2.2);
      rests.push({ x: c.x0, t, cx: (c.x0 + c.x1) / 2, w: c.w, dots: dot ? 1 : 0 });
    }
  }
  // ---- what is left are the notes after the header
  const notes = heads.filter((hd) => hd.left >= startX - sp * 0.3);
  return { L: s.L, x0: s.x0, x1: s.x1, sp, top: s.top, bottom: s.bottom, lines: s.lines, thick: T, heads: notes, rests, bars: merged, clef: head.clef, key: head.key, time: head.time, timeAlt: head.timeAlt, startX, head, accTrace: ctx.accTrace, restTrace: ctx.restTrace, allHeads: ctx.allHeads };
}
function stemOf(C, w, h, hd, rx, sp) {
  const run = (x, y0, dir) => {
    let y = Math.round(y0), gap = 0, last = y;
    const lim = sp * 6;
    while (y > 0 && y < h - 1 && Math.abs(y - y0) < lim) {
      if (C[y * w + x] || C[y * w + x - 1] || C[y * w + x + 1]) { last = y; gap = 0; } else if (++gap > Math.max(2, sp * 0.15)) break;
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
    const ym = Math.round((hd.cy + end) / 2 + dir * sp * 0.3);
    let wd = 0; for (let dx = -Math.round(sp * 0.6); dx <= Math.round(sp * 0.6); dx++) wd += C[ym * w + x + dx] || 0;
    if (wd > sp * 0.5) return;
    // how far the same stroke runs the other way (a stem stops at its head, unless it carries a chord)
    const back = Math.abs(run(x, hd.cy - dir * sp * 0.15, -dir) - hd.cy);
    if (!best || len > best.len) best = { x, len, end, up: dir < 0, top: Math.min(end, hd.cy), bot: Math.max(end, hd.cy), back, backEnd: hd.cy - dir * back };
  };
  for (let x = Math.round(hd.cx + rx - sp * 0.3); x <= Math.round(hd.cx + rx + sp * 0.2); x++) tryCol(x, -1);
  for (let x = Math.round(hd.cx - rx - sp * 0.2); x <= Math.round(hd.cx - rx + sp * 0.3); x++) tryCol(x, 1);
  return best;
}
function beamsOf(C, w, h, stem, sp) {
  const dir = stem.up ? 1 : -1;     // from the end of the stem back toward the head
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
      return 0;
    }
  }
  return 0;
}
// The start of a line: clef, then key signature, then time signature.
function readHeader(s, comps, ctx, prev, heads) {
  const { C, w, labC, T } = ctx;
  const sp = s.sp;
  let i = 0, clef = null, end = s.x0 + sp * 0.5;
  const P = (y, x) => pAt(s, y, x);
  // the clef: the first big shape (with any pieces of it)
  while (i < comps.length && comps[i].h < sp * 1.2) i++;
  if (i < comps.length && comps[i].h >= sp * 2.4) {
    const c = comps[i];
    // the clef may be in pieces (the bars and the bracket shape of a C clef)
    const group = [];
    let gx1 = c.x1;
    for (const q of comps) {
      if (q === c || q.x1 < c.x0) continue;
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
    const dots = comps.filter((q) => q.x0 > x1 - sp * 0.3 && q.x0 < x1 + sp * 0.9 && q.w < sp * 0.7 && q.h < sp * 0.7);
    const bassDots = dots.filter((q) => { const p = P((q.y0 + q.y1) / 2, q.x0); return Math.abs(p - 7) < 0.8 || Math.abs(p - 5) < 0.8; }).length >= 2;
    let name = null;
    if ((top > 10.3 && bot < -1.2) || (top > 9.4 && bot < -0.9 && (y1 - y0) > sp * 5 && k.cls === 'treble' && k.d < 0.5)) name = 'treble';
    else if (bassDots || (k.cls === 'bass' && k.d < 0.4 && top < 9.8 && bot > 0.6)) name = 'bass';
    else if (top > 7.4 && top < 9.8 && bot > -1.2 && bot < 0.8) name = k.cls === 'bass' && k.d < 0.3 ? 'bass' : 'alto';
    else if (top > 9.6 && top < 11.8 && bot > 1.2 && bot < 2.8) name = 'tenor';
    else if (k.d < 0.33) name = k.cls;
    if (name) {
      clef = name; end = Math.max(x1, ...dots.map((q) => q.x1)) + sp * 0.2;
      i = comps.findIndex((q) => q.x0 >= end - sp * 0.1); if (i < 0) i = comps.length;
    }
  }
  const clefName = clef || (prev && prev.clef) || null;
  // key signature: sharps or flats in a row, each at its place in the usual order
  const off = { treble: 0, bass: -2, alto: -1, tenor: 1 }[clefName || 'treble'] ?? 0;
  const ORDER = { 1: [8, 5, 9, 6, 3, 7, 4].map((p) => p + off), '-1': [4, 7, 3, 6, 2, 5, 1].map((p) => p + off) };
  if (clefName === 'tenor') ORDER[1] = [2, 6, 3, 7, 4, 8, 5];
  // each sharp or flat is looked for where it should be, so ones that touch still count
  const look = (a, p, from, to) => {
    let bestK = null;
    for (const sc of [1, 1.22]) {
    const tall = a > 0 ? [1.55 * sc, 1.55 * sc] : [2.1 * sc, 0.75 * sc];          // staff spaces above and below the note
    for (let x = Math.round(from); x <= Math.round(to); x++) {
      const yc = yAt(s, p, x), ya = Math.round(yc - tall[0] * sp), yb = Math.round(yc + tall[1] * sp), xb = Math.round(x + sp * (a > 0 ? 1.05 : 0.95) * sc);
      let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      for (let y = Math.max(0, ya); y <= Math.min(ctx.h - 1, yb); y++) for (let xx = x; xx <= xb; xx++) if (C[y * w + xx]) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0 || x0 > x + sp * 0.25 || (y1 - y0) < sp * 1.6) continue;
      const k = classify(shapeOf(C, w, x0, y0, x1, y1, sp), ['sharp', 'flat', 'natural', 'd4', 'd2', 'd3', 'd6', 'd8', 'r4']);
      if (k.cls === (a > 0 ? 'sharp' : 'flat') && (!bestK || k.d < bestK.d)) {
        const sh = shapeOf(C, w, x0, y0, x1, y1, sp);
        const other = Math.min(...['natural', 'd4', 'r4', a > 0 ? 'flat' : 'sharp'].map((q) => classify(sh, [q]).d));
        bestK = { ...k, x0, x1, margin: other - k.d };
      }
    }
    }
    return bestK;
  };
  let kind = 0, n = 0, lastX = end;
  {
    const firstNote = heads.filter((hd) => hd.left > end && (hd.stem || (hd.hollow && hd.wRow > sp * 1.35))).reduce((m, hd) => Math.min(m, hd.left), Infinity);
    if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ firstNote, end, heads: heads.filter((hd) => hd.left > end).slice(0, 3).map((hd) => [hd.left, hd.p, hd.kind, hd.stem && [hd.stem.len / sp, hd.stem.back / sp], hd.wRow / sp]) });
    let bestFirst = 9;
    for (const a of [1, -1]) {
      let cur = end - sp * 0.3, cnt = 0, lx = end, firstD = 9, prevX = 0, step = 0;
      for (const p of ORDER[a]) {
        const k = look(a, p, cur, cur + sp * 1.5);
        if (ctx.dbg) (ctx.trace = ctx.trace || []).push({ a, p, cur, k: k && { d: +k.d.toFixed(3), x0: k.x0 } });
        if (!k || !(k.d <= 0.38 || (k.d <= 0.48 && k.margin >= 0.1 && (!cnt || k.d <= firstD + 0.06)))) break;
        // evenly spaced
        if (cnt >= 2 && Math.abs((k.x0 - prevX) - step) > step * 0.45) break;
        if (cnt >= 1) step = cnt === 1 ? k.x0 - prevX : step;
        if (!cnt) firstD = k.d;
        prevX = k.x0; cnt++; lx = k.x1; cur = k.x0 + sp * 0.55;
      }
      if (cnt && (firstD < bestFirst - 0.02 || (Math.abs(firstD - bestFirst) <= 0.02 && cnt > n))) { n = cnt; kind = a; lastX = lx; bestFirst = firstD; }
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
      const yT = yAt(s, 8, xm), yM = yAt(s, 4, xm), yB = yAt(s, 0, xm);
      const allTop = Math.min(...col.cs.map((c) => c.y0)), allBot = Math.max(...col.cs.map((c) => c.y1));
      if (allTop < yT - sp * 0.8 || allBot > yB + sp * 0.8) break;            // not inside the staff
      const up = inkBox(col, yT - sp * 0.3, yM - T / 2 - 1), dn = inkBox(col, yM + T / 2 + 1, yB + sp * 0.3);
      digits.push({ col, up, dn, xm });
    }
    const readDigit = (bx) => {
      if (!bx || (bx.y1 - bx.y0) < sp * 1.1) return null;
      const sh = shapeOf(C, w, bx.x0, bx.y0, bx.x1, bx.y1, sp, labC, bx.ids);
      const cl = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9'].map((d) => ({ v: +d.slice(1), d: classify(sh, [d]).d })).sort((a, b2) => a.d - b2.d);
      return cl;
    };
    const ups = [], dns = [];
    for (const dg of digits) {
      // one shape filling the middle of the staff: C or cut C
      const col = dg.col;
      if (!ups.length) {
        const c0 = col.cs[0];
        const pt = P(c0.y0, c0.x0), pb = P(c0.y1, c0.x0);
        if (col.cs.length === 1 && pt < 7.6 && pb > 0.4 && c0.h > sp * 1.4) {
          const k = classify(shapeOf(C, w, c0.x0, c0.y0, c0.x1, c0.y1, sp, labC, c0.id), ['tC', 'tCut', 'd4', 'd2', 'd3', 'bass', 'alto', 'r4']);
          if (k.d < 0.4 && (k.cls === 'tC' || k.cls === 'tCut')) { time = k.cls === 'tC' ? [4, 4] : [2, 2]; end = col.x1 + sp * 0.2; }
          break;
        }
      }
      const u = readDigit(dg.up), d = readDigit(dg.dn);
      if (!u && !d) break;
      if (u) ups.push(u); if (d) dns.push(d);
      end = col.x1 + sp * 0.2;
    }
    if (!time && ups.length && dns.length && ups[0][0].d < 0.5 && dns[0][0].d < 0.5) {
      const num = (list) => list.reduce((a, q) => a * 10 + q[0].v, 0);
      time = [num(ups), num(dns)];
      timeAlt = { u: ups.map((q) => q.slice(0, 3)), l: dns.map((q) => q.slice(0, 3)) };
    } else if (!time) end = endKey;
  }
  return { clef: clefName, key: kind * n, time, timeAlt, end: Math.max(end, s.x0 + sp * 0.5), explicitClef: !!clef };
}

// ---------- the whole picture ----------
export async function analyse(canvas, dbg) {
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
  const maxPix = 9e6;
  if (canvas.width * canvas.height * f * f > maxPix) f = Math.sqrt(maxPix / (canvas.width * canvas.height));
  f = Math.max(0.15, Math.min(5, f));
  let G = grayAt(canvas, f);
  let norm = flatten(G, SP * 2.6);
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
  const staves = findStaves(B, w, h, sp0, T);
  if (!staves.length) return { ...empty, angle };
  // the staves' own measure is finer than the first guess
  const sp = sp0;
  const C = removeLines(B, w, h, staves, T);
  // holes are looked for with a darker threshold, so the middle of a soft-edged half note stays open
  const Bthin = new Uint8Array(w * h); { const G = B.gray, t2 = B.th2; for (let i = 0; i < Bthin.length; i++) Bthin[i] = B[i] && G[i] < t2 ? 1 : 0; }
  const holes = holeMask(Bthin, w, h, sp);
  // filled heads: ink plus holes, without the lines, opened with a disc
  const F0 = new Uint8Array(w * h); for (let i = 0; i < F0.length; i++) F0[i] = B[i] || holes[i] ? 1 : 0;
  const F = removeLines(F0, w, h, staves, T);
  const Oimg = openOval(F, w, h, sp * 0.24, sp * 0.39);
  const O = { img: Oimg, ...label(Oimg, w, h) };
  const LC = label(C, w, h);
  // without thin curves (slurs, ties, hairpins), for rests and other symbols they cross
  const D = C.slice();
  {
    const thin = Math.max(2, Math.round(sp * 0.2));
    for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (!C[y * w + x]) { y++; continue; } let e = y; while (e < h && C[e * w + x]) e++; if (e - y <= thin) for (let k = y; k < e; k++) D[k * w + x] = 0; y = e; } }
  }
  const LD = label(D, w, h);
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
  const ctx = { dbg, best, B, C, D, compsD: LD.comps, labD: LD.lab, F, O, holes, w, h, T, compsC: groups, rawC: LC.comps, labC: LC.lab, groupOf, staffOf, staffBelow: (s) => staves[staves.indexOf(s) + 1], staffAbove: (s) => staves[staves.indexOf(s) - 1] };
  const read = [];
  staves.forEach((s, i) => { read.push(readStaff(s, ctx, null)); void i; });
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
      heads: s.heads.map((hd) => { const [x, y] = back(hd.left, hd.cy); return { x, y, p: hd.p, kind: hd.kind, acc: hd.acc, dots: hd.dots, beams: hd.beams, w: hd.w / f, sc: hd.sc, stem: hd.stem ? { x: back(hd.stem.x, hd.stem.end)[0], up: hd.stem.up, len: hd.stem.len / f, end: back(hd.stem.x, hd.stem.end)[1] } : null }; }),
      rests: s.rests.map((r) => ({ x: back(r.x, s.top)[0], t: r.t, w: r.w / f, dots: r.dots })),
      bars: s.bars.map((b) => ({ ...b, x: back(b.x, (s.top + s.bottom) / 2)[0], w: b.w / f })),
      startX: back(s.startX, s.top)[0],
      path: dbg ? Array.from({ length: Math.ceil((s.x1 - s.x0) / 20) + 1 }, (_, i) => { const x = Math.min(s.x1, s.x0 + i * 20); return [0, 2, 4, 6, 8].map((p) => back(x, yAt(s, p, x))); }) : undefined,
      _: dbg ? s : undefined,
    };
    void top;
  });
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
    items.push({ x: Math.min(...group.map((g) => g.x)), t, dots: Math.max(...group.map((g) => g.dots || 0)), ps: [...new Set(group.map((g) => g.p))].sort((a, b) => a - b), acc, beamed: beams > 0 && !!lead.stem });
  }
  for (const r of st.rests) items.push({ x: r.x, t: r.t, dots: r.dots || 0, rest: true });
  items.sort((a, b) => a.x - b.x);
  // rest dots
  const bars = [];
  const lines = st.bars.map((b) => b.x).filter((x) => x > (items[0] ? items[0].x - sp * 2 : 0));
  let cur = [], bi = 0, carry = {};
  for (const it of items) {
    while (bi < lines.length && it.x > lines[bi]) { if (cur.length) bars.push(cur); cur = []; carry = {}; bi++; }
    if (!it.rest) { for (const p of it.ps) { if (it.acc[p] !== undefined) carry[p] = it.acc[p]; else if (carry[p] !== undefined) it.acc[p] = carry[p]; } }
    cur.push(it);
  }
  if (cur.length) bars.push(cur);
  return bars;
}
// Mend a bar whose note values do not add up to the time signature: the fewest changes of
// a dot, a beam or a hollow head that make it fit.
export function fitBar(bar, total, opts = {}) {
  const sum = (b) => b.reduce((a, it) => a + (it.full ? total : ticksOf(it.t, it.dots)), 0);
  const s0 = sum(bar);
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
  for (let i = 0; i < n; i++) for (const e of edits(bar[i])) { const b = bar.slice(); b[i] = e; if (Math.abs(sum(b) - total) < 1) return b; }
  if (n <= 14) {
    for (let i = 0; i < n; i++) for (const e of edits(bar[i])) for (let j = i + 1; j < n; j++) for (const e2 of edits(bar[j])) {
      const b = bar.slice(); b[i] = e; b[j] = e2; if (Math.abs(sum(b) - total) < 1) return b;
    }
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
  let bars = [];
  const barSys = [];
  A.systems.forEach((sys, si) => { const b = staffEvents(staffIn(sys)); bars.push(...b); b.forEach(() => barSys.push(si)); });
  // the time signature: as read, unless the bars clearly say otherwise
  const time = chooseTime(first, bars);
  const total = (WHOLE * time[0]) / time[1];
  const sumOf = (b) => b.reduce((a, it) => a + ticksOf(it.t, it.dots), 0);
  const firstShort = bars.length > 1 && sumOf(bars[0]) < total - 1;
  // how many bars add up as read (before any repair): a measure of how well the page was read
  const inner = bars.slice(1, -1);
  const fitRead = inner.length ? inner.filter((b) => Math.abs(sumOf(b) - total) < 1).length / inner.length : bars.length ? (Math.abs(sumOf(bars[0]) - total) < 1 ? 1 : 0.5) : 0;
  bars = bars.map((b, i) => fitBar(b, total, { pickup: i === 0 || (i === bars.length - 1 && firstShort) }));
  const notes = bars.flat().filter((n) => !n.rest);
  return { fitRead, bars, notes, clef: first.clef || 'treble', key: first.key || 0, time, timeRead: !!first.time, staves: A.staves.length, systems: A.systems.length, analysis: A };
}
// 3/4 or 6/8 (and 3/2 or 6/4 or 12/8)? Where the notes start in the bar tells: in 6/8 the second
// beat is on the 4th quaver, in 3/4 on the 3rd and 5th.
function compoundFeel(bars) {
  let six = 0, three = 0;
  for (const b of bars) {
    let p = 0;
    for (const it of b) {
      const e = Math.round((p * 8) / WHOLE);
      if (!it.rest && Math.abs((p * 8) / WHOLE - e) < 0.01) { if (e === 3) six++; if (e === 2 || e === 4) three++; }
      if (it.t === 4 && it.dots === 1) six += 0.5;
      p += ticksOf(it.t, it.dots);
    }
  }
  return six - three;
}
function chooseTime(st, bars) {
  const pick = (t) => {
    // the same length of bar can be simple or compound: the rhythm decides when it is clear
    const feel = compoundFeel(bars.slice(1));
    if (t[0] === 3 && t[1] === 4 && feel >= 3) return [6, 8];
    if (t[0] === 6 && t[1] === 8 && feel <= -3) return [3, 4];
    return t;
  };
  const sums = bars.slice(1, -1).map((b) => b.reduce((a, it) => a + ticksOf(it.t, it.dots), 0));
  const fit = (t) => { const tot = (WHOLE * t[0]) / t[1]; return sums.length ? sums.filter((s) => Math.abs(s - tot) < 1).length / sums.length : 0; };
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
  const a = await recognise(canvas, opts);
  if (a && a.fitRead >= 0.95) return a;
  let b = null;
  try {
    const { whitenPaper, levels } = await import('./scan.js');
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0); whitenPaper(c); levels(c, 62, true);
    b = await recognise(c, opts);
  } catch (err) { console.warn(err); }
  if (!a) return b; if (!b) return a;
  const score = (r) => r.fitRead + Math.min(r.notes.length, 200) * 0.0004;
  return score(b) > score(a) + 0.04 ? b : a;
}
