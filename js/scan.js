// Scanning a page from a photo: find the sheet of paper in the picture, flatten the perspective so
// the page is a true rectangle again, straighten it by its staff lines, and make the paper white
// and the ink black. Everything works on canvases and runs on the iPad itself.

const lumOf = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function small(src, side) {
  const k = Math.min(1, side / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function boxBlur(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) { let s = 0, n = 0; for (let x = -r; x < w + r; x++) { if (x + r < w) { s += a[y * w + x + r]; n++; } if (x - r - 1 >= 0) { s -= a[y * w + x - r - 1]; n--; } if (x >= 0 && x < w) t[y * w + x] = s / n; } }
  for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let y = -r; y < h + r; y++) { if (y + r < h) { s += t[(y + r) * w + x]; n++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * w + x]; n--; } if (y >= 0 && y < h) o[y * w + x] = s / n; } }
  return o;
}
function otsu(a) {
  const hist = new Float64Array(256); for (const v of a) hist[Math.max(0, Math.min(255, v | 0))]++;
  const N = a.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = i; } }
  return t;
}
// least squares line through points, as v = a*u + b, dropping the worst points twice
function fitLine(pts) {
  let P = pts;
  for (let pass = 0; pass < 3; pass++) {
    if (P.length < 4) return null;
    let su = 0, sv = 0, suu = 0, suv = 0; for (const [u, v] of P) { su += u; sv += v; suu += u * u; suv += u * v; }
    const n = P.length, den = n * suu - su * su; if (Math.abs(den) < 1e-9) return null;
    const a = (n * suv - su * sv) / den, b = (sv - a * su) / n;
    if (pass === 2) return { a, b };
    const res = P.map(([u, v]) => Math.abs(v - (a * u + b))).sort((x, y) => x - y);
    const cut = Math.max(1.5, res[Math.floor(res.length * 0.8)] * 1.5);
    P = P.filter(([u, v]) => Math.abs(v - (a * u + b)) <= cut);
  }
  return null;
}

// Find the four corners of the page in a photo, as fractions of the picture (TL, TR, BR, BL),
// or null when the page already fills the picture or no clear page is seen.
export function detectPage(src) {
  const c = small(src, 480), w = c.width, h = c.height;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h), S = new Float32Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) {
    L[j] = lumOf(d, i);
    const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
    S[j] = mx ? (mx - mn) / mx : 0;
  }
  // paper: bright and without much colour; ink is filled in by a wide blur
  const B = boxBlur(L, w, h, Math.max(3, Math.round(Math.max(w, h) / 70)));
  const t = otsu(B);
  const bright = new Uint8Array(w * h);
  for (let j = 0; j < w * h; j++) bright[j] = B[j] > t && S[j] < 0.45 ? 1 : 0;
  // the largest bright region
  const lab = new Int32Array(w * h); let best = 0, bestN = 0, cur = 0;
  const stack = new Int32Array(w * h);
  for (let j = 0; j < w * h; j++) {
    if (!bright[j] || lab[j]) continue;
    cur++; let sp = 0, n = 0; stack[sp++] = j; lab[j] = cur;
    while (sp) {
      const q = stack[--sp]; n++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && bright[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack[sp++] = q - 1; }
      if (x < w - 1 && bright[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack[sp++] = q + 1; }
      if (y > 0 && bright[q - w] && !lab[q - w]) { lab[q - w] = cur; stack[sp++] = q - w; }
      if (y < h - 1 && bright[q + w] && !lab[q + w]) { lab[q + w] = cur; stack[sp++] = q + w; }
    }
    if (n > bestN) { bestN = n; best = cur; }
  }
  if (bestN < w * h * 0.12) return null;
  // its outline: the first and last pixel in every row and column
  const rowL = [], rowR = [], colT = [], colB = [];
  for (let y = 0; y < h; y++) { let a = -1, b = -1; for (let x = 0; x < w; x++) if (lab[y * w + x] === best) { if (a < 0) a = x; b = x; } if (a >= 0) { rowL.push([y, a]); rowR.push([y, b]); } }
  for (let x = 0; x < w; x++) { let a = -1, b = -1; for (let y = 0; y < h; y++) if (lab[y * w + x] === best) { if (a < 0) a = y; b = y; } if (a >= 0) { colT.push([x, a]); colB.push([x, b]); } }
  // rough corners from the extremes, then each side fitted as a straight line between them
  const all = [...rowL.map(([y, x]) => [x, y]), ...rowR.map(([y, x]) => [x, y])];
  const ext = (f) => all.reduce((m, p) => (f(p) > f(m) ? p : m), all[0]);
  const tl = ext(([x, y]) => -(x + y)), br = ext(([x, y]) => x + y), tr = ext(([x, y]) => x - y), bl = ext(([x, y]) => y - x);
  const inner = (pts, lo, hi) => { const a = Math.min(lo, hi), b = Math.max(lo, hi), m = (b - a) * 0.12; return pts.filter(([u]) => u > a + m && u < b - m); };
  const top = fitLine(inner(colT, tl[0], tr[0])), bottom = fitLine(inner(colB, bl[0], br[0]));
  const left = fitLine(inner(rowL, tl[1], bl[1])), right = fitLine(inner(rowR, tr[1], br[1]));
  if (!top || !bottom || !left || !right) return null;
  // y = a x + b (top, bottom) and x = a y + b (left, right)
  const meet = (H, V) => { const y = (H.a * V.b + H.b) / (1 - H.a * V.a); return [V.a * y + V.b, y]; };
  let q = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)];
  q = refineEdges(q, L, w, h);
  if (!q) return null;
  // sanity: inside the picture (with a little slack), convex, big enough, and not just the frame
  for (const [x, y] of q) if (x < -0.04 * w || x > 1.04 * w || y < -0.04 * h || y > 1.04 * h) return null;
  const area = Math.abs(q.reduce((s, [x, y], i) => { const [x2, y2] = q[(i + 1) % 4]; return s + x * y2 - x2 * y; }, 0)) / 2;
  if (area < w * h * 0.15) return null;
  let sign = 0;
  for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4]; const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx); const sg = Math.sign(z); if (!sign) sign = sg; else if (sg !== sign) return null; }
  // a sheet of paper seen at an angle still looks roughly like a rectangle
  for (let i = 0; i < 4; i++) {
    const [px, py] = q[(i + 3) % 4], [ax, ay] = q[i], [nx, ny] = q[(i + 1) % 4];
    const ux = px - ax, uy = py - ay, vx = nx - ax, vy = ny - ay;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    if (Math.abs(cos) > 0.55) return null;                      // corners between about 57 and 123 degrees
  }
  const side = (i) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]);
  if (Math.min(side(0), side(2)) / Math.max(side(0), side(2)) < 0.55 || Math.min(side(1), side(3)) / Math.max(side(1), side(3)) < 0.55) return null;
  const nearFrame = q.every(([x, y]) => (x < 0.025 * w || x > 0.975 * w) && (y < 0.025 * h || y > 0.975 * h));
  if (nearFrame) return null;
  return q.map(([x, y]) => [Math.max(0, Math.min(1, x / w)), Math.max(0, Math.min(1, y / h))]);
}

// Move each side onto the strongest step from light (paper) to darker (table) near it, then
// fit the sides again. Shadows across the page change the paper's brightness but not that step.
function refineEdges(q, L, w, h) {
  const at = (x, y) => { const xi = Math.max(0, Math.min(w - 1, Math.round(x))), yi = Math.max(0, Math.min(h - 1, Math.round(y))); return L[yi * w + xi]; };
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const reach = Math.max(w, h) * 0.05;
  const sides = [];
  for (let s = 0; s < 4; s++) {
    const A = q[s], B = q[(s + 1) % 4];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]); if (len < 10) return q;
    let nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
    // the normal points out of the page
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const pts = [];
    for (let k = 1; k < 40; k++) {
      const t = 0.08 + (0.84 * k) / 40;
      const px = A[0] + (B[0] - A[0]) * t, py = A[1] + (B[1] - A[1]) * t;
      let best = 0, bd = null;
      for (let d = -reach; d <= reach; d += 0.5) {
        const x = px + nx * d, y = py + ny * d;
        let inn = 0, out = 0; for (let e = 1; e <= 3; e++) { inn += at(x - nx * e, y - ny * e); out += at(x + nx * e, y + ny * e); }
        const step = (inn - out) / 3;
        if (step > best) { best = step; bd = d; }
      }
      if (bd !== null && best > 12) pts.push([px + nx * bd, py + ny * bd]);
    }
    if (pts.length < 12) { sides.push(null); continue; }
    // horizontal-ish sides as y = a x + b, vertical-ish as x = a y + b
    const horiz = Math.abs(B[0] - A[0]) > Math.abs(B[1] - A[1]);
    const ln = fitLine(horiz ? pts.map(([x, y]) => [x, y]) : pts.map(([x, y]) => [y, x]));
    sides.push(ln ? { ...ln, horiz } : null);
  }
  // every side must show a real edge (paper against something darker), or there is no page here
  if (sides.some((x) => !x) || !sides[0].horiz || !sides[2].horiz || sides[1].horiz || sides[3].horiz) return null;
  const meet = (H, V) => { const y = (H.a * V.b + H.b) / (1 - H.a * V.a); return [V.a * y + V.b, y]; };
  const [top, right, bottom, left] = sides;
  const r = [meet(top, left), meet(top, right), meet(bottom, right), meet(bottom, left)];
  // keep the refinement only if it stays close
  if (!r.every(([x, y], i) => Math.hypot(x - q[i][0], y - q[i][1]) < reach * 1.6)) return null;
  // and the page must be clearly lighter than what is around it
  let inS = 0, inN = 0, outS = 0, outN = 0;
  const inside = (x, y) => { let sg = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = r[i], [bx, by] = r[(i + 1) % 4]; const z = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (z === 0) continue; const s2 = Math.sign(z); if (!sg) sg = s2; else if (s2 !== sg) return false; } return true; };
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const v = L[y * w + x]; if (inside(x, y)) { inS += v; inN++; } else { outS += v; outN++; } }
  if (outN < w * h * 0.02 / 9) return null;
  if (outS / outN > (inS / inN) * 0.82) return null;
  return r;
}

// the projective map that takes the unit square to the quad (TL, TR, BR, BL)
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, hh = 0;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dx3 * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
}
// The page inside the quad (fractions of src), flattened to a rectangle at most maxSide pixels.
export function warpPage(src, quad, maxSide) {
  const W0 = src.width, H0 = src.height;
  // a hair inside the edges, so no sliver of the table shows
  const cx = quad.reduce((s2, p) => s2 + p[0], 0) / 4, cy = quad.reduce((s2, p) => s2 + p[1], 0) / 4;
  const q = quad.map(([x, y]) => [(x + (cx - x) * 0.008) * W0, (y + (cy - y) * 0.008) * H0]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), oh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1.25, maxSide / Math.max(ow, oh)); ow = Math.round(ow * k); oh = Math.round(oh * k);
  const sd = src.getContext ? src.getContext('2d').getImageData(0, 0, W0, H0).data : null;
  let data = sd;
  if (!data) { const t = document.createElement('canvas'); t.width = W0; t.height = H0; t.getContext('2d').drawImage(src, 0, 0); data = t.getContext('2d').getImageData(0, 0, W0, H0).data; }
  const [a, b, c, d, e, f, g, h] = squareToQuad(q);
  const out = document.createElement('canvas'); out.width = ow; out.height = oh;
  const og = out.getContext('2d'), img = og.createImageData(ow, oh), o = img.data;
  for (let y = 0; y < oh; y++) {
    const v = (y + 0.5) / oh;
    for (let x = 0; x < ow; x++) {
      const u = (x + 0.5) / ow;
      const den = g * u + h * v + 1;
      let sx = (a * u + b * v + c) / den - 0.5, sy = (d * u + e * v + f) / den - 0.5;
      if (sx < 0) sx = 0; if (sy < 0) sy = 0; if (sx > W0 - 1.001) sx = W0 - 1.001; if (sy > H0 - 1.001) sy = H0 - 1.001;
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const i00 = (iy * W0 + ix) * 4, i10 = i00 + 4, i01 = i00 + W0 * 4, i11 = i01 + 4;
      const oi = (y * ow + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        o[oi + ch] = (data[i00 + ch] * (1 - fx) + data[i10 + ch] * fx) * (1 - fy) + (data[i01 + ch] * (1 - fx) + data[i11 + ch] * fx) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// How far (degrees) the staff lines lean: the angle at which the rows of ink line up best.
export function estimateSkew(src) {
  const c = small(src, 900), w = c.width, h = c.height;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h); for (let i = 0, j = 0; j < w * h; i += 4, j++) L[j] = lumOf(d, i);
  const bg = boxBlur(L, w, h, 12);
  const xs = [], ys = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x += 1) { const j = y * w + x; if (L[j] < bg[j] * 0.7) { xs.push(x - w / 2); ys.push(y); } }
  if (xs.length < 500) return 0;
  const step = Math.max(1, Math.floor(xs.length / 60000));
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180), rows = new Float32Array(h + w);
    for (let i = 0; i < xs.length; i += step) { const r = Math.round(ys[i] + xs[i] * t + w / 2); if (r >= 0 && r < rows.length) rows[r]++; }
    let s = 0; for (const v of rows) s += v * v; return s;
  };
  let best = 0, bs = -1;
  for (let a = -5; a <= 5.001; a += 0.25) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  for (let a = best - 0.25; a <= best + 0.25; a += 0.05) { const s = score(a); if (s > bs) { bs = s; best = a; } }
  // rows line up when sheared by -tan(lean), so `best` is minus the lean: turning by it straightens
  return Math.abs(best) < 0.08 ? 0 : best;
}
// Turn a canvas by a small angle around its middle, filling the new corners with paper.
export function rotateSmall(src, deg) {
  if (!deg) return src;
  const r = (deg * Math.PI) / 180;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  // the new corners take the colour of the paper (white corners on grey paper confuse the reader)
  const pv = inkLevels(src).paper;
  g.fillStyle = `rgb(${pv},${pv},${pv})`; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate(r); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// The paper made white: brightness measured on a grid (the light paper between the ink) and every
// pixel scaled to it, so shadows and uneven light disappear. Returns the canvas.
export function whitenPaper(c) {
  const w = c.width, h = c.height, g = c.getContext('2d');
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const cell = Math.max(6, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let bg = new Float32Array(gw * gh);
  const vals = [];
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    vals.length = 0;
    for (let y = cy * cell; y < Math.min(h, cy * cell + cell); y += 2) for (let x = cx * cell; x < Math.min(w, cx * cell + cell); x += 2) vals.push(lumOf(d, (y * w + x) * 4));
    vals.sort((p, q) => p - q);
    bg[cy * gw + cx] = vals[Math.floor(vals.length * 0.9)] || 255;            // the paper, not the ink
  }
  // cells with a lot of ink read too dark: lift them to their brighter neighbours, then smooth
  for (let pass = 0; pass < 3; pass++) {
    const nb = new Float32Array(bg.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let m = 0, s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue; const v = bg[yy * gw + xx]; m = Math.max(m, v); s += v; n++; }
      nb[y * gw + x] = pass === 0 ? Math.max(bg[y * gw + x], m * 0.92) : s / n;
    }
    bg = nb;
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const b = (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) + (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
      const k = 250 / Math.max(b, 50), i = (y * w + x) * 4;
      d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The darkest ink and the paper, from the histogram of a whitened page.
export function inkLevels(c) {
  const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 16) { hist[Math.round(lumOf(d, i))]++; n++; }
  const at = (f) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= n * f) return v; } return 255; };
  // ink is a small share of a page: the 0.4th percentile is solid ink, the 60th is paper
  const ink = at(0.004), paper = Math.max(ink + 40, at(0.6));
  return { ink, paper };
}
// Paper to white and ink to near black (a scanner's levels); contrast 0..100 bends the middle.
export function levels(c, contrast = 55, grey = false) {
  const { ink, paper } = inkLevels(c);
  const w = c.width, h = c.height, g = c.getContext('2d'), img = g.getImageData(0, 0, w, h), d = img.data;
  const lo = ink + (paper - ink) * 0.04, hi = paper - (paper - ink) * 0.04;
  const gamma = 1 + (contrast - 50) / 60;            // above 1 darkens the middle (faint ink shows more)
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { let t = (v - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; lut[v] = Math.round(16 + 239 * Math.pow(t, gamma)); }
  for (let i = 0; i < d.length; i += 4) {
    if (grey) { const y = lut[Math.round(lumOf(d, i))]; d[i] = d[i + 1] = d[i + 2] = y; }
    else { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Crisp black and white, as from a good scanner: ink black, paper white, edges kept smooth.
// The line between them follows this page's own ink and paper; `strength` 0..100 moves it
// (higher keeps fainter marks).
export function crispInk(c, strength = 55) {
  const { ink, paper } = inkLevels(c);
  const w = c.width, h = c.height, g = c.getContext('2d');
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const L = new Float32Array(w * h); for (let i = 0, j = 0; j < w * h; i += 4, j++) L[j] = lumOf(d, i);
  // a light sharpening first, so thin staff lines stay whole
  const B = boxBlur(L, w, h, 1);
  const f = 0.5 + (strength / 100) * 0.38;              // where between ink and paper the line falls
  const mid = ink + (paper - ink) * f, soft = Math.max(6, (paper - ink) * 0.12);
  for (let j = 0, i = 0; j < w * h; j++, i += 4) {
    const v = L[j] + 0.8 * (L[j] - B[j]);
    let o = (v - (mid - soft)) / (2 * soft); o = o < 0 ? 0 : o > 1 ? 1 : o;
    o = o * o * (3 - 2 * o);
    const p = Math.round(14 + o * 241);
    d[i] = d[i + 1] = d[i + 2] = p;
  }
  g.putImageData(img, 0, 0);
  return c;
}
