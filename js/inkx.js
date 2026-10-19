// The notebook's drawing materials: pens of different kinds (fountain pen, ballpoint, pencil,
// marker, brush, calligraphy nib, watercolour), photos you place, crop and adjust, and text boxes
// for titles and notes. Everything is in page fractions, like the other markings.
import { db } from './db.js';
import { drawElement, ELEMENT_BY_KEY } from './elements.js';

export const PEN_KINDS = [
  { k: 'fountain', label: 'Fountain pen' },
  { k: 'ball', label: 'Ballpoint' },
  { k: 'pencil', label: 'Pencil' },
  { k: 'marker', label: 'Marker' },
  { k: 'brush', label: 'Brush' },
  { k: 'calli', label: 'Calligraphy' },
  { k: 'water', label: 'Watercolour' },
  { k: 'neon', label: 'Neon' },
  { k: 'rainbow', label: 'Rainbow' },
  { k: 'glitter', label: 'Glitter' },
];
// how much wider than the plain pen each kind draws, at the same thickness setting
export const PEN_WIDTH = { fountain: 1, ball: 0.75, pencil: 1.35, marker: 3.4, brush: 3, calli: 2.6, water: 4.2, neon: 1.6, rainbow: 2.4, glitter: 2.2 };

export const PALETTE = [
  '#16181d', '#3d4350', '#7a808c', '#b9bec7', '#ffffff',
  '#7a1520', '#d12f2f', '#ef6b5b', '#f4a3a3', '#c2185b',
  '#a8440f', '#ea7a17', '#f5a742', '#e6b800', '#f3dd6d',
  '#1f5c2e', '#2f9e55', '#7cc47f', '#0f8f8f', '#7fd1cc',
  '#1f3a8f', '#2b6fd6', '#6fa8ec', '#7b3fc4', '#b493e0',
  '#7a4b2a', '#b98a5e', '#d9c3a0', '#c9a227', '#4b5d73',
];

// colour palettes that belong together, like a designer's mood board
export const PALETTES = [
  ['Navy & sky', ['#2f4156', '#567c8d', '#c8d9e6', '#f5efeb', '#ffffff']],
  ['Sage & bloodstone', ['#5d0d18', '#9fb2ac', '#fff9eb', '#3e4a46', '#d9cbb3']],
  ['Olive', ['#2c3527', '#475540', '#6b7b5a', '#98a581', '#d4dbc4']],
  ['Burgundy & cream', ['#4a0d16', '#7d1f2c', '#b98389', '#e7dcd2', '#f6f0ea']],
  ['Sand & gold', ['#3d2e22', '#8a6a4a', '#c9a96e', '#e8d9bf', '#f8f3ea']],
  ['Blush', ['#7d3346', '#d1798e', '#f0b3bf', '#fbe1e4', '#fff6f6']],
  ['Ocean', ['#0b3c5d', '#1d6a96', '#5fb3d4', '#bfe3ef', '#f1f8fb']],
  ['Sunset', ['#3a1c4a', '#b23a48', '#f26b38', '#f7b267', '#ffe3b3']],
  ['Ink & paper', ['#111317', '#3b3f47', '#8b8f97', '#e9e6df', '#faf8f3']],
];
// metal finishes: a gradient with a shine in it
export const METALS = { gold: ['#a87b25', '#f3d98b', '#c99a3a', '#f8e6a6', '#9c7020'], rose: ['#a8645a', '#f4c7bb', '#c98273', '#fbdcd3', '#99564c'], silver: ['#7d838c', '#f1f3f6', '#a5abb3', '#ffffff', '#6f757d'], copper: ['#8a4a22', '#eaa775', '#b4642f', '#f6c39a', '#7a3f1b'] };
export function metalGradient(ctx, metal, x0, y0, x1, y1) {
  const st = METALS[metal] || METALS.gold, g = ctx.createLinearGradient(x0, y0, x1, y1);
  st.forEach((c, i) => g.addColorStop(i / (st.length - 1), c)); return g;
}

// ---------- pencil grain ----------
const grains = new Map();
let grainNoise = null;
function grainPattern(ctx, color) {
  let p = grains.get(color);
  if (p) return p;
  if (!grainNoise) {
    grainNoise = document.createElement('canvas'); grainNoise.width = grainNoise.height = 96;
    const g = grainNoise.getContext('2d'), d = g.createImageData(96, 96);
    let s = 7;
    for (let i = 0; i < 96 * 96; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const r = s / 0x7fffffff; d.data[i * 4 + 3] = r < 0.18 ? 40 : r < 0.5 ? 150 : 235; }
    g.putImageData(d, 0, 0);
  }
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 96, 96);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(grainNoise, 0, 0);
  p = ctx.createPattern(c, 'repeat');
  grains.set(color, p);
  return p;
}

// stroke options for perfect-freehand by kind
export function strokeOptions(kind, size, hasPressure, live) {
  // little streamline: the line stays right under the Pencil's tip (it smooths without lagging)
  const base = { size, smoothing: 0.55, streamline: 0.25, easing: (t) => t, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: !live };
  switch (kind) {
    case 'ball': return { ...base, thinning: 0.12, simulatePressure: false, streamline: 0.3 };
    case 'pencil': return { ...base, thinning: hasPressure ? 0.28 : 0.1, simulatePressure: !hasPressure };
    case 'neon': case 'rainbow': return { ...base, thinning: 0.05, simulatePressure: false, smoothing: 0.6, streamline: 0.5 };
    case 'glitter': return { ...base, thinning: 0.2, simulatePressure: false };
    case 'marker': return { ...base, thinning: 0, simulatePressure: false, smoothing: 0.5, streamline: 0.5 };
    case 'brush': return { ...base, thinning: 0.82, simulatePressure: !hasPressure, smoothing: 0.7, streamline: 0.45, start: { taper: size * 3, cap: true }, end: { taper: size * 4, cap: true } };
    case 'water': return { ...base, thinning: 0.5, simulatePressure: !hasPressure, smoothing: 0.8, streamline: 0.55 };
    default: return { ...base, thinning: hasPressure ? 0.55 : 0.3, simulatePressure: !hasPressure };
  }
}
// paint a pen outline the way its kind looks
const hexRgb = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const lighten = (c, f) => { const [r, g, b] = hexRgb(c); return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`; };
export function paintKind(ctx, kind, color, alpha, pathFn, size, pts) {
  if (kind === 'neon') {
    // a glowing tube: the colour shines around a bright core
    ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = Math.max(4, size * 2.2);
    pathFn(); ctx.fill(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.75; ctx.fillStyle = lighten(color, 0.7); ctx.fill();
    return;
  }
  if (kind === 'rainbow' && pts && pts.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const gr = ctx.createLinearGradient(x0, y0, Math.max(x1, x0 + 1), Math.max(y1, y0 + 1));
    ['#ff4d4d', '#ff9f1c', '#ffd60a', '#3ddc84', '#2ec4ff', '#5b6cff', '#c86bfa'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
    ctx.globalAlpha = alpha; ctx.fillStyle = gr; pathFn(); ctx.fill();
    return;
  }
  if (kind === 'glitter' && pts && pts.length) {
    ctx.globalAlpha = alpha * 0.9; ctx.fillStyle = color; pathFn(); ctx.fill();
    // sparkles that stay where they are (the same every time the page is drawn)
    let seed = Math.round(pts[0][0] * 7 + pts[0][1] * 13) || 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const light = lighten(color, 0.75);
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      for (let k = 0; k < 2; k++) {
        const a = rnd() * Math.PI * 2, r = rnd() * size * 0.45, d = Math.max(0.6, size * (0.06 + rnd() * 0.1));
        ctx.globalAlpha = alpha * (0.5 + rnd() * 0.5); ctx.fillStyle = rnd() < 0.4 ? '#ffffff' : light;
        ctx.beginPath(); ctx.arc(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, d, 0, Math.PI * 2); ctx.fill();
      }
    }
    return;
  }
  if (kind === 'pencil') {
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = grainPattern(ctx, color);
    pathFn(); ctx.fill();
    ctx.globalAlpha = alpha * 0.5; ctx.fillStyle = color; ctx.fill();
    return;
  }
  if (kind === 'water') {
    ctx.globalAlpha = alpha * 0.32;
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = Math.max(2, size * 0.5);
    pathFn(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.18; ctx.fill();
    return;
  }
  if (kind === 'marker') { ctx.globalAlpha = alpha * 0.92; ctx.fillStyle = color; pathFn(); ctx.fill(); return; }
  ctx.globalAlpha = alpha; ctx.fillStyle = color; pathFn(); ctx.fill();
}
// A broad nib held at 40°: thick going one way, thin the other.
export function drawNib(ctx, pts, size, color, alpha) {
  if (!pts.length) return;
  const a = -0.7, nx = Math.cos(a), ny = Math.sin(a);
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  const half = (p) => (size / 2) * (0.45 + (p[2] ?? 0.5) * 1.1);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], hp = half(p), hq = half(q);
    const quad = [[p[0] + nx * hp, p[1] + ny * hp], [q[0] + nx * hq, q[1] + ny * hq], [q[0] - nx * hq, q[1] - ny * hq], [p[0] - nx * hp, p[1] - ny * hp]];
    // the same winding for every piece, so the pieces join into one shape
    let area = 0; for (let k = 0; k < 4; k++) { const u = quad[k], v = quad[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
    if (area < 0) quad.reverse();
    ctx.moveTo(quad[0][0], quad[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(quad[k][0], quad[k][1]); ctx.closePath();
  }
  if (pts.length === 1) { const p = pts[0], h = half(p); ctx.moveTo(p[0] + nx * h, p[1] + ny * h); ctx.lineTo(p[0] - nx * h, p[1] - ny * h); ctx.lineTo(p[0] - nx * h + 1, p[1] - ny * h + 1); ctx.closePath(); }
  ctx.fill('nonzero');
}

// ---------- shapes: hold the pen at the end and a drawn shape becomes a clean one ----------
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let md = -1, mi = 0;
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L;
    if (d > md) { md = d; mi = i; }
  }
  if (md < eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)];
}
// pts in screen pixels (x, y); returns { kind, pts } in the same units, or null
export function recogniseShape(pts) {
  if (pts.length < 8) return null;
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const a = pts[0], b = pts[pts.length - 1];
  const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h);
  if (diag < 30) return null;
  // open stroke: arrow (a line with a hook at the end) is left alone; only closed shapes here
  if (gap > Math.max(0.22 * len / 4, diag * 0.28)) return null;
  // a smooth loop is an ellipse; a loop with corners is a polygon (simplified in two halves,
  // split at the point farthest from the start, since the loop ends where it began)
  let far = 0, fd = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); if (d > fd) { fd = d; far = i; } });
  const eps = diag * 0.075;
  const poly = [...rdp(pts.slice(0, far + 1), eps).slice(0, -1), ...rdp([...pts.slice(far), pts[0]], eps)];
  let corners = poly.length - 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // how well an ellipse in the box fits
  let err = 0; for (const p of pts) { const r = Math.hypot((p[0] - cx) / (w / 2 || 1), (p[1] - cy) / (h / 2 || 1)); err += Math.abs(r - 1); }
  err /= pts.length;
  if (err < 0.12 || corners > 6) {
    const n = 64, out = [];
    for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; out.push([cx + Math.cos(t) * w / 2, cy + Math.sin(t) * h / 2]); }
    return { kind: 'ellipse', pts: out };
  }
  if (corners === 4 || corners === 5) {
    // nearly level sides: an upright rectangle
    const c = poly.slice(0, 4);
    const level = c.every((p, i) => { const q = c[(i + 1) % 4]; const ang = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) * 180 / Math.PI; return Math.min(ang % 90, 90 - (ang % 90)) < 14; });
    const quad = level ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : c;
    return { kind: 'rect', pts: densify([...quad, quad[0]]) };
  }
  if (corners === 3) { const t = poly.slice(0, 3); return { kind: 'triangle', pts: densify([...t, t[0]]) }; }
  return null;
}
function densify(poly) {
  const out = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(poly[poly.length - 1]);
  return out;
}

// ---------- photos ----------
// The picture itself is kept once in the store ('img:<id>'); the page keeps where it is, its
// crop, rotation, look and frame.
const pics = new Map();       // id -> { img, ready, failed }
const looks = new Map();      // id|crop|look -> canvas
let onReady = null;
export function setAssetReady(fn) { onReady = fn; }
export async function putPicture(blob) {
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // keep at most 2400 px on the long side, as a good JPEG (PNG when it has transparency)
  const bmp = await loadBitmap(blob);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const png = /png|gif|webp/.test(blob.type) && hasAlpha(c);
  const out = await new Promise((res) => c.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.9));
  await db.put('kv', { k: 'img:' + id, v: out });
  const im = new Image(); const url = URL.createObjectURL(out);
  await new Promise((r) => { im.onload = r; im.onerror = r; im.src = url; });
  pics.set(id, { img: im, ready: true });
  return { id, w: c.width, h: c.height };
}
function hasAlpha(c) {
  const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) return true;
  return false;
}
function loadBitmap(blob) {
  return new Promise((res, rej) => { const im = new Image(); const u = URL.createObjectURL(blob); im.onload = () => res(im); im.onerror = rej; im.src = u; });
}
function picture(id) {
  if (!id) return { ready: false, failed: true };
  let p = pics.get(id);
  if (!p) {
    p = { img: new Image(), ready: false };
    pics.set(id, p);
    db.get('kv', 'img:' + id).then((r) => {
      if (!r || !r.v) { p.failed = true; return; }
      p.img.onload = () => { p.ready = true; onReady && onReady(); };
      p.img.src = URL.createObjectURL(r.v);
    }).catch(() => { p.failed = true; });
  }
  return p;
}
export async function preloadAssets(items) {
  const ids = items.filter((s) => s.t === 'img').map((s) => s.id);
  await Promise.all(ids.map((id) => new Promise((res) => {
    const p = picture(id);
    if (p.ready || p.failed) return res();
    const t0 = Date.now();
    const iv = setInterval(() => { if (p.ready || p.failed || Date.now() - t0 > 5000) { clearInterval(iv); res(); } }, 40);
  })));
}
export const LOOK_DEFAULT = { b: 0, c: 0, s: 0, w: 0, bw: 0 };
// the photo cropped and with its look, at most 1800 px; kept while in use
function lookCanvas(s, p) {
  const f = s.f || LOOK_DEFAULT, cr = s.cr || [0, 0, 1, 1];
  const key = `${s.id}|${cr.join(',')}|${f.b},${f.c},${f.s},${f.w},${f.bw}`;
  let c = looks.get(key);
  if (c) return c;
  const iw = p.img.naturalWidth, ih = p.img.naturalHeight;
  const sx = cr[0] * iw, sy = cr[1] * ih, sw = Math.max(1, (cr[2] - cr[0]) * iw), sh = Math.max(1, (cr[3] - cr[1]) * ih);
  const k = Math.min(1, 1800 / Math.max(sw, sh));
  c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(p.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (f.b || f.c || f.s || f.w || f.bw) {
    const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
    const bright = 1 + f.b * 0.8, con = 1 + f.c, sat = f.bw ? 0 : 1 + f.s, warm = f.w * 22;
    for (let i = 0; i < a.length; i += 4) {
      let r = a[i] * bright, gg = a[i + 1] * bright, b = a[i + 2] * bright;
      r = (r - 128) * con + 128; gg = (gg - 128) * con + 128; b = (b - 128) * con + 128;
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = l + (r - l) * sat + warm; gg = l + (gg - l) * sat + warm * 0.25; b = l + (b - l) * sat - warm;
      a[i] = r; a[i + 1] = gg; a[i + 2] = b;
    }
    g.putImageData(d, 0, 0);
  }
  if (looks.size > 24) looks.delete(looks.keys().next().value);
  looks.set(key, c);
  return c;
}
export function picSize(id) { const p = pics.get(id); return p && p.ready ? [p.img.naturalWidth, p.img.naturalHeight] : null; }

export const FRAMES = [['', 'None'], ['shadow', 'Shadow'], ['white', 'White border'], ['polaroid', 'Instant photo'], ['tape', 'Tape']];
export function drawPicture(ctx, s, W, H) {
  const p = picture(s.id);
  const cx = s.x * W, cy = s.y * H, w = s.w * W, h = s.h * H;
  ctx.translate(cx, cy); if (s.rot) ctx.rotate(s.rot);
  ctx.globalAlpha = s.a ?? 1;
  const fr = s.fr || '', m = Math.min(w, h);
  // frame behind the picture
  if (fr === 'white' || fr === 'polaroid') {
    const pad = m * 0.045, bottom = fr === 'polaroid' ? m * 0.2 : pad;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = m * 0.04; ctx.shadowOffsetY = m * 0.012;
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad + bottom); ctx.restore();
  }
  const rr = (s.rr || 0) * m / 2;
  ctx.save();
  if (s.fx || s.fy) ctx.scale(s.fx ? -1 : 1, s.fy ? -1 : 1);
  if (fr === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = m * 0.05; ctx.shadowOffsetY = m * 0.02; }
  // the photo shows through the letters of a word (and stripes under it)
  if (s.mask === 'word' || s.mask === 'bloom') {
    if (s.fx || s.fy) ctx.scale(s.fx ? -1 : 1, s.fy ? -1 : 1);   // the letters never mirror
    if (fr === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = m * 0.05; ctx.shadowOffsetY = m * 0.02; }
    const T = ctx.getTransform(), k = Math.min(3, Math.hypot(T.a, T.b) || 1);
    ctx.drawImage(wordCanvas(s, p.ready ? p : null, w, h, k), -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }
  // the photo can sit in a shape (circle, heart, arch...)
  if (s.mask) shapePath(ctx, s.mask, w, h);
  else { ctx.beginPath(); if (rr > 0.5) ctx.roundRect(-w / 2, -h / 2, w, h, rr); else ctx.rect(-w / 2, -h / 2, w, h); }
  if (p.ready) {
    if (fr === 'shadow') { ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent'; }
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(lookCanvas(s, p), -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = 'rgba(140,150,170,.16)'; ctx.fill();
    if (!s.id) { ctx.setLineDash([m * 0.04, m * 0.03]); ctx.strokeStyle = 'rgba(90,100,130,.55)'; ctx.lineWidth = Math.max(1, m * 0.008); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(70,80,110,.7)'; ctx.font = `600 ${Math.max(10, m * 0.07)}px -apple-system, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Photo', 0, 0); }
  }
  ctx.restore();
  if (fr === 'tape') {
    const tw = m * 0.34, th = m * 0.09;
    for (const [x, y, a] of [[-w / 2, -h / 2, -0.75], [w / 2, -h / 2, 0.75]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.globalAlpha = 0.62; ctx.fillStyle = '#efe3b8';
      ctx.fillRect(-tw / 2, -th / 2, tw, th); ctx.restore();
    }
  }
}

const words = new Map();
function wordCanvas(s, p, w, h, k) {
  const sc = Math.min(k, 2400 / Math.max(w, h, 1)), Wc = Math.max(8, Math.round(w * sc)), Hc = Math.max(8, Math.round(h * sc));
  const f = s.f || LOOK_DEFAULT, word = (s.word || (s.mask === 'bloom' ? 'BLOOM' : 'MUSIC')).trim().slice(0, 16) || ' ';
  const key = [s.id, p ? 1 : 0, s.mask, word, s.wf, Wc, Hc, (s.cr || []).join(), f.b, f.c, f.s, f.w, f.bw, s.fx, s.fy].join('|');
  let c = words.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = Wc; c.height = Hc;
  const g = c.getContext('2d'), css = (FONTS[s.wf || 'condensed'] || FONTS.condensed).css, bold = s.wf === 'script' ? 400 : 800;
  // fit the word across the box, then stretch it to the height it may take
  // the word across the whole box: as wide as it can be, as tall as the box allows (a poster
  // letter may be stretched a little, never squashed out of shape)
  const fitWord = (bandH, top) => {
    let px = bandH; g.font = `${bold} ${px}px ${css}`;
    let m = g.measureText(word); px *= Math.min(6, (Wc * 0.96) / Math.max(1, m.width)); g.font = `${bold} ${px}px ${css}`; m = g.measureText(word);
    const asc = m.actualBoundingBoxAscent || px * 0.72, desc = m.actualBoundingBoxDescent || 0, th = Math.max(1, asc + desc);
    const sy = Math.max(0.6, Math.min(2.2, bandH / th)), hh = th * sy;
    g.save(); g.translate(Wc / 2, top + (bandH - hh) / 2); g.scale(1, sy); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(word, 0, asc); g.restore();
  };
  g.fillStyle = '#000';
  fitWord(Hc * 0.96, Hc * 0.02);
  g.globalCompositeOperation = 'source-in';
  if (p) {
    g.save(); if (s.fx || s.fy) { g.translate(s.fx ? Wc : 0, s.fy ? Hc : 0); g.scale(s.fx ? -1 : 1, s.fy ? -1 : 1); }
    g.imageSmoothingQuality = 'high'; g.drawImage(lookCanvas(s, p), 0, 0, Wc, Hc); g.restore();
  } else { g.fillStyle = 'rgba(120,132,160,.4)'; g.fillRect(0, 0, Wc, Hc); }
  if (words.size > 10) words.delete(words.keys().next().value);
  words.set(key, c);
  return c;
}

// ---------- text boxes (like a design app: many typefaces, combinations and effects) ----------
// Fonts that come with the iPad, each with a fallback for elsewhere.
export const FONTS = {
  serif: { label: 'Iowan', css: '"Iowan Old Style", "Palatino", Georgia, serif' },
  sans: { label: 'SF Pro', css: '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif' },
  avenir: { label: 'Avenir Next', css: '"Avenir Next", "Avenir", "Helvetica Neue", sans-serif' },
  condensed: { label: 'Condensed', css: '"Avenir Next Condensed", "Futura-CondensedExtraBold", "Arial Narrow", sans-serif' },
  futura: { label: 'Futura', css: 'Futura, "Century Gothic", "Avenir Next", sans-serif' },
  gill: { label: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
  optima: { label: 'Optima', css: 'Optima, Candara, "Avenir Next", sans-serif' },
  round: { label: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Avenir Next", sans-serif' },
  display: { label: 'Didot', css: 'Didot, "Bodoni 72", "Bodoni MT", Georgia, serif' },
  bodoni: { label: 'Bodoni', css: '"Bodoni 72", "Bodoni MT", Didot, Georgia, serif' },
  baskerville: { label: 'Baskerville', css: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
  hoefler: { label: 'Hoefler', css: '"Hoefler Text", Garamond, Georgia, serif' },
  cochin: { label: 'Cochin', css: 'Cochin, Georgia, serif' },
  rockwell: { label: 'Rockwell', css: 'Rockwell, "Courier New", serif' },
  copper: { label: 'Copperplate', css: 'Copperplate, "Copperplate Gothic Light", fantasy' },
  hand: { label: 'Bradley Hand', css: '"Bradley Hand", "Segoe Print", cursive' },
  note: { label: 'Noteworthy', css: 'Noteworthy, "Comic Sans MS", cursive' },
  marker: { label: 'Marker Felt', css: '"Marker Felt", "Comic Sans MS", cursive' },
  chalk: { label: 'Chalkboard', css: '"Chalkboard SE", "Comic Sans MS", cursive' },
  chalkdust: { label: 'Chalkduster', css: 'Chalkduster, "Comic Sans MS", cursive' },
  script: { label: 'Snell', css: '"Snell Roundhand", "Apple Chancery", cursive' },
  savoye: { label: 'Savoye', css: '"Savoye LET", "Snell Roundhand", cursive' },
  zapfino: { label: 'Zapfino', css: 'Zapfino, "Snell Roundhand", cursive' },
  party: { label: 'Party', css: '"Party LET", "Snell Roundhand", cursive' },
  papyrus: { label: 'Papyrus', css: 'Papyrus, fantasy' },
  mono: { label: 'Typewriter', css: '"American Typewriter", "Courier New", monospace' },
  code: { label: 'Menlo', css: 'Menlo, Consolas, monospace' },
};
// ready-made combinations, like the ones in a design app
export const TEXT_STYLES = [
  { k: 'title', label: 'Title', ff: 'display', fs: 0.062, b: 1, al: 'left' },
  { k: 'heading', label: 'Heading', ff: 'avenir', fs: 0.038, b: 1, al: 'left' },
  { k: 'body', label: 'Text', ff: 'serif', fs: 0.022, b: 0, al: 'left', lh: 1.35 },
  { k: 'note', label: 'Handwritten', ff: 'hand', fs: 0.032, b: 0, al: 'left' },
  { k: 'label', label: 'Label', ff: 'round', fs: 0.024, b: 1, al: 'center', bg: '#ffe9a8', c: '#1d1d1f' },
  { k: 'fancy', label: 'Script', ff: 'script', fs: 0.058, b: 0, al: 'center' },
  { k: 'poster', label: 'POSTER', ff: 'condensed', fs: 0.075, b: 1, al: 'center', caps: 1, ls: 0.02 },
  { k: 'elegant', label: 'Elegant', ff: 'bodoni', fs: 0.05, b: 0, i: 1, al: 'center', ls: 0.04 },
  { k: 'neon', label: 'Neon sign', ff: 'round', fs: 0.05, b: 1, al: 'center', c: '#ff4fd8', fx: 'neon' },
  { k: 'retro', label: 'Retro', ff: 'rockwell', fs: 0.05, b: 1, al: 'center', c: '#e2543a', fx: 'echo', fc: '#2a3d7c' },
  { k: 'chalk', label: 'Chalkboard', ff: 'chalkdust', fs: 0.04, b: 0, al: 'center', c: '#ffffff', bg: '#2f3b33' },
  { k: 'typewriter', label: 'Typewriter', ff: 'mono', fs: 0.026, b: 0, al: 'left' },
  { k: 'outline', label: 'OUTLINE', ff: 'futura', fs: 0.066, b: 1, al: 'center', caps: 1, fx: 'outline' },
  { k: 'shadow', label: 'Shadow', ff: 'avenir', fs: 0.054, b: 1, al: 'center', fx: 'shadow' },
  { k: 'arc', label: 'Curved', ff: 'copper', fs: 0.042, b: 1, al: 'center', caps: 1, ls: 0.08, curve: 45 },
  { k: 'checklist', label: 'Checklist', ff: 'avenir', fs: 0.026, b: 0, al: 'left', lh: 1.7, list: 'check' },
  { k: 'bullets', label: 'Bullet list', ff: 'serif', fs: 0.024, b: 0, al: 'left', lh: 1.5, list: 'bullet' },
  { k: 'sticky', label: 'Sticky note', ff: 'note', fs: 0.03, b: 0, al: 'left', bg: '#fff3a0', c: '#3a3320', pad: 1 },
  { k: 'headline', label: 'HEADLINE', ff: 'futura', fs: 0.07, b: 1, al: 'left', caps: 1, ls: 0.01, lh: 1.02 },
  { k: 'magazine', label: 'Magazine', ff: 'display', fs: 0.085, b: 0, i: 1, al: 'center', lh: 1.0 },
  { k: 'spaced', label: 'S P A C E D', ff: 'gill', fs: 0.03, b: 0, al: 'center', caps: 1, ls: 0.38 },
  { k: 'signature', label: 'Signature', ff: 'savoye', fs: 0.085, b: 0, al: 'center' },
  { k: 'gold', label: 'GOLD FOIL', ff: 'bodoni', fs: 0.064, b: 1, al: 'center', caps: 1, ls: 0.06, fx: 'gold' },
  { k: 'gradient', label: 'Gradient', ff: 'avenir', fs: 0.066, b: 1, al: 'center', c: '#7b3fc4', fx: 'gradient', fc: '#ff6b8b' },
  { k: 'marker', label: 'Highlighted', ff: 'marker', fs: 0.042, b: 0, al: 'left', fx: 'highlight', fc: '#ffe066' },
  { k: 'splice', label: 'Splice', ff: 'futura', fs: 0.07, b: 1, al: 'center', caps: 1, c: '#ffffff', fx: 'splice', fc: '#16181d' },
  { k: 'zapf', label: 'Flourish', ff: 'zapfino', fs: 0.04, b: 0, al: 'center' },
  { k: 'chapter', label: 'Chapter One', ff: 'hoefler', fs: 0.05, b: 0, i: 0, al: 'center', caps: 1, ls: 0.12 },
];
export const TEXT_EFFECTS = [['', 'None'], ['gradient', 'Gradient'], ['shadow', 'Shadow'], ['lift', 'Lift'], ['outline', 'Outline'], ['hollow', 'Hollow'], ['neon', 'Neon'], ['echo', 'Echo'], ['splice', 'Splice'], ['glitch', 'Glitch'], ['highlight', 'Highlight'], ['gold', 'Gold foil']];
export const tbFont = (s, px) => `${s.i ? 'italic ' : ''}${s.b ? 700 : 400} ${px}px ${(FONTS[s.ff] || FONTS.serif).css}`;
const tbText = (s) => {
  let t = s.caps ? String(s.txt || '').toUpperCase() : String(s.txt || '');
  // lists: a box to tick (a line starting with x or ✓ is ticked) or a bullet before every line
  if (s.list === 'check') t = t.split('\n').map((l) => (/^\s*(x|✓|✔)\s+/i.test(l) ? '☑ ' + l.replace(/^\s*(x|✓|✔)\s+/i, '') : '☐ ' + l)).join('\n');
  else if (s.list === 'bullet') t = t.split('\n').map((l) => '•  ' + l).join('\n');
  return t;
};
let mctx = null;
const spaced = (ctx, t, ls) => ctx.measureText(t).width + (t.length > 1 ? ls * (t.length - 1) : 0);
// lines of a text box at a page width W (in pixels)
export function tbLines(s, W) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  const px = s.fs * W, ls = (s.ls || 0) * px, maxW = Math.max(px, s.w * W - pad(s, W) * 2);
  mctx.font = tbFont(s, px);
  const out = [];
  for (const para of tbText(s).split('\n')) {
    let cur = '';
    for (const word of para.split(/(\s+)/)) {
      const t = cur + word;
      if (cur && spaced(mctx, t.trimEnd(), ls) > maxW) { out.push(cur.trimEnd()); cur = word.trimStart(); }
      else cur = t;
      while (spaced(mctx, cur, ls) > maxW && cur.length > 1) {
        let n = cur.length - 1; while (n > 1 && spaced(mctx, cur.slice(0, n), ls) > maxW) n--;
        out.push(cur.slice(0, n)); cur = cur.slice(n);
      }
    }
    out.push(cur);
  }
  return out;
}
const pad = (s, W) => (s.bg ? s.fs * W * (s.pad ? 0.8 : 0.45) : 0);
const lineH = (s) => s.lh || 1.28;
// height of a text box as a fraction of the page height
export function tbHeight(s, W, H) {
  const n = Math.max(1, tbLines(s, W).length), px = s.fs * W;
  const curveExtra = s.curve ? px * Math.min(3, Math.abs(s.curve) / 30) : 0;
  return (n * px * lineH(s) + pad(s, W) * 1.4 + curveExtra) / H;
}
// one line, with letter spacing when asked
function line(ctx, t, x, y, ls, align, stroke) {
  const draw = (tt, xx) => (stroke ? ctx.strokeText(tt, xx, y) : ctx.fillText(tt, xx, y));
  if (!ls) { ctx.textAlign = align; draw(t, x); return; }
  const w = spaced(ctx, t, ls);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  for (const ch of t) { draw(ch, cx); cx += ctx.measureText(ch).width + ls; }
}
// a line along an arc (curved text)
function arcLine(ctx, t, cx, baseY, ls, curve, px, stroke) {
  const chars = [...t], widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + ls * Math.max(0, chars.length - 1);
  const span = (Math.abs(curve) / 100) * Math.PI * 1.5;          // up to 270°
  if (span < 0.01 || total < 1) { line(ctx, t, cx, baseY, ls, 'center', stroke); return; }
  const R = total / span, up = curve > 0;
  const ccy = up ? baseY + R : baseY - R;
  let a = -span / 2;
  ctx.textAlign = 'center';
  chars.forEach((ch, i) => {
    const mid = a + widths[i] / 2 / R;
    ctx.save();
    if (up) { ctx.translate(cx + R * Math.sin(mid), ccy - R * Math.cos(mid)); ctx.rotate(mid); }
    else { ctx.translate(cx + R * Math.sin(-mid), ccy + R * Math.cos(mid)); ctx.rotate(mid); }
    if (stroke) ctx.strokeText(ch, 0, 0); else ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += (widths[i] + ls) / R;
  });
}
export function drawTextBox(ctx, s, W, H) {
  const px = s.fs * W, lines = tbLines(s, W), lh = px * lineH(s), P = pad(s, W), ls = (s.ls || 0) * px;
  const x = s.x * W, y = s.y * H, w = s.w * W, h = tbHeight(s, W, H) * H;
  ctx.translate(x, y); if (s.rot) { ctx.translate(w / 2, h / 2); ctx.rotate(s.rot); ctx.translate(-w / 2, -h / 2); }
  ctx.globalAlpha = s.a ?? 1;
  const color = s.c || '#16181d', fc = s.fc || '#16181d', fx = s.fx || '';
  if (s.bg) {
    ctx.save(); ctx.fillStyle = s.bg;
    if (s.pad) { ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = px * 0.5; ctx.shadowOffsetY = px * 0.15; ctx.fillRect(0, 0, w, h); }
    else { ctx.beginPath(); ctx.roundRect(0, 0, w, h, Math.min(px * 0.5, h / 2)); ctx.fill(); }
    ctx.restore();
  }
  ctx.font = tbFont(s, px); ctx.textBaseline = 'alphabetic';
  const align = s.al === 'center' ? 'center' : s.al === 'right' ? 'right' : 'left';
  const ax = s.al === 'center' ? w / 2 : s.al === 'right' ? w - P : P;
  const top = P * 0.7 + (s.curve > 0 ? px * Math.min(3, Math.abs(s.curve) / 30) : 0);
  const each = (fn) => lines.forEach((l, i) => fn(l, top + i * lh + px));
  const put = (l, yy, dx = 0, dy = 0, stroke = false) => {
    if (s.curve) arcLine(ctx, l, w / 2 + dx, yy + dy, ls, s.curve, px, stroke);
    else line(ctx, l, ax + dx, yy + dy, ls, align, stroke);
  };
  // highlight: a marker band behind each line
  if (fx === 'highlight') {
    ctx.save(); ctx.fillStyle = s.fc || '#ffe066'; ctx.globalAlpha = (s.a ?? 1) * 0.85;
    each((l, yy) => { const lw = spaced(ctx, l, ls); const lx = align === 'center' ? ax - lw / 2 : align === 'right' ? ax - lw : ax; ctx.fillRect(lx - px * 0.15, yy - px * 0.62, lw + px * 0.3, px * 0.78); });
    ctx.restore();
  }
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = 'round';
  if (fx === 'gradient') { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, color); g.addColorStop(1, s.fc && s.fc !== '#16181d' ? s.fc : '#ff7a59'); ctx.fillStyle = g; }
  if (fx === 'gold') ctx.fillStyle = metalGradient(ctx, s.metal || 'gold', 0, 0, w * 0.6, h);
  if (fx === 'shadow') { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = px * 0.18; ctx.shadowOffsetX = px * 0.06; ctx.shadowOffsetY = px * 0.08; }
  if (fx === 'lift') { ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = px * 0.45; ctx.shadowOffsetY = px * 0.12; }
  if (fx === 'neon') {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = px * 0.6; ctx.globalAlpha = (s.a ?? 1) * 0.9;
    each((l, yy) => put(l, yy)); each((l, yy) => put(l, yy)); ctx.restore();
    ctx.fillStyle = lighten(color, 0.55); ctx.globalAlpha = (s.a ?? 1) * 0.9; each((l, yy) => put(l, yy));
    return;
  }
  if (fx === 'echo') {
    ctx.save(); ctx.fillStyle = fc;
    for (const k of [3, 2, 1]) { ctx.globalAlpha = (s.a ?? 1) * (0.25 + 0.15 * (3 - k)); each((l, yy) => put(l, yy, px * 0.05 * k, px * 0.05 * k)); }
    ctx.restore();
  }
  if (fx === 'splice') {
    ctx.save(); ctx.fillStyle = fc === '#16181d' ? '#ffb3c7' : fc; each((l, yy) => put(l, yy, px * 0.07, px * 0.07)); ctx.restore();
    ctx.lineWidth = Math.max(1, px * 0.05); each((l, yy) => put(l, yy, 0, 0, true));
    return;
  }
  if (fx === 'glitch') {
    ctx.save(); ctx.globalAlpha = (s.a ?? 1) * 0.8;
    ctx.fillStyle = '#00e5ff'; each((l, yy) => put(l, yy, -px * 0.04, 0));
    ctx.fillStyle = '#ff2e88'; each((l, yy) => put(l, yy, px * 0.04, 0));
    ctx.restore();
  }
  if (fx === 'outline' || fx === 'hollow') {
    ctx.lineWidth = Math.max(1, px * (fx === 'hollow' ? 0.04 : 0.09));
    if (fx === 'outline') { ctx.save(); ctx.strokeStyle = s.fc && s.fc !== '#16181d' ? s.fc : '#ffffff'; ctx.lineWidth = px * 0.14; each((l, yy) => put(l, yy, 0, 0, true)); ctx.restore(); }
    else { each((l, yy) => put(l, yy, 0, 0, true)); return; }
  }
  each((l, yy) => put(l, yy));
  if (s.u) each((l, yy) => { const m = spaced(ctx, l, ls), ux = align === 'center' ? ax - m / 2 : align === 'right' ? ax - m : ax; ctx.fillRect(ux, yy + px * 0.12, m, Math.max(1, px * 0.06)); });
}

// ---------- washi tape ----------
export const TAPES = [['stripes', 'Stripes'], ['dots', 'Dots'], ['grid', 'Grid'], ['plain', 'Plain'], ['hearts', 'Hearts'], ['notes', 'Notes']];
export function drawTape(ctx, s, W, H) {
  const ax = s.x0 * W, ay = s.y0 * H, bx = s.x1 * W, by = s.y1 * H;
  const L = Math.max(4, Math.hypot(bx - ax, by - ay)), w = s.w * W, ang = Math.atan2(by - ay, bx - ax);
  ctx.translate(ax, ay); ctx.rotate(ang);
  // torn ends: little zig-zags
  const tooth = Math.max(2, w / 7);
  ctx.beginPath(); ctx.moveTo(0, -w / 2);
  ctx.lineTo(L, -w / 2);
  for (let y = -w / 2, i = 0; y < w / 2; y += tooth, i++) ctx.lineTo(L + (i % 2 ? -tooth * 0.5 : 0), Math.min(w / 2, y + tooth));
  ctx.lineTo(0, w / 2);
  for (let y = w / 2, i = 0; y > -w / 2; y -= tooth, i++) ctx.lineTo(i % 2 ? tooth * 0.5 : 0, Math.max(-w / 2, y - tooth));
  ctx.closePath();
  ctx.save(); ctx.clip();
  ctx.globalAlpha = (s.a ?? 1) * 0.72; ctx.fillStyle = s.c; ctx.fillRect(-1, -w / 2 - 1, L + 2, w + 2);
  ctx.globalAlpha = (s.a ?? 1) * 0.55; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff';
  const step = w / 3;
  if (s.pat === 'stripes') { ctx.lineWidth = w / 9; for (let x = -w; x < L + w; x += step) { ctx.beginPath(); ctx.moveTo(x, w / 2); ctx.lineTo(x + w, -w / 2); ctx.stroke(); } }
  else if (s.pat === 'dots') { for (let x = step / 2; x < L; x += step) for (let y = -w / 2 + step / 2, r = 0; y < w / 2; y += step, r++) { ctx.beginPath(); ctx.arc(x + (r % 2) * step / 2, y, w / 14, 0, Math.PI * 2); ctx.fill(); } }
  else if (s.pat === 'grid') { ctx.lineWidth = Math.max(1, w / 24); for (let x = 0; x < L; x += step / 1.5) { ctx.beginPath(); ctx.moveTo(x, -w / 2); ctx.lineTo(x, w / 2); ctx.stroke(); } for (let y = -w / 2; y < w / 2; y += step / 1.5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(L, y); ctx.stroke(); } }
  else if (s.pat === 'hearts' || s.pat === 'notes') {
    ctx.font = `${w * 0.5}px "Apple Color Emoji", "Segoe UI Symbol", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = s.pat === 'hearts' ? '♥' : '♪';
    for (let x = step; x < L; x += w * 0.8) ctx.fillText(glyph, x, 0);
  }
  ctx.restore();
}
export function tapeBounds(s) {
  const r = s.w / 2;
  return { x0: Math.min(s.x0, s.x1) - r, y0: Math.min(s.y0, s.y1) - r * 1.414, x1: Math.max(s.x0, s.x1) + r, y1: Math.max(s.y0, s.y1) + r * 1.414 };
}
// how far a point is from the tape's middle line (page pixels)
export function tapeHit(s, x, y, r, W, H) {
  const ax = s.x0 * W, ay = s.y0 * H, bx = s.x1 * W, by = s.y1 * H, px = x * W, py = y * H;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) < s.w * W / 2 + r * W;
}

// ---------- stickers ----------
export const STICKERS = [
  '🎻', '🎹', '🎸', '🎺', '🎷', '🥁', '🪕', '🎼', '🎵', '🎶', '🎤', '🎧',
  '⭐', '🌟', '✨', '💫', '❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤',
  '🌸', '🌷', '🌻', '🍀', '🌿', '🍂', '🌈', '☀️', '🌙', '☁️', '⚡', '🔥',
  '✅', '❗', '❓', '💡', '📌', '📎', '🎯', '🏆', '🥇', '👏', '💪', '🙌',
  '😀', '😍', '😎', '🤓', '😴', '🤔', '🥳', '😅', '☕', '🍰', '🎉', '🎈',
];

// ---------- shapes (a design app's elements) ----------
// Each shape lives in a box (centre x, y; size w of the page width, h of the page height), can turn,
// flip, be filled (one colour or a gradient), outlined and cast a shadow.
export const SHAPES = [
  ['rect', 'Square'], ['round', 'Rounded'], ['circle', 'Circle'], ['triangle', 'Triangle'], ['star', 'Star'],
  ['heart', 'Heart'], ['hexagon', 'Hexagon'], ['diamond', 'Diamond'], ['arrow', 'Arrow'], ['line', 'Line'],
  ['bubble', 'Speech'], ['cloud', 'Thought'], ['arch', 'Arch'], ['blob', 'Blob'], ['banner', 'Ribbon'],
  ['glass', 'Glass'], ['bars', 'Stripes'],
];
export function shapePath(ctx, k, w, h) {
  const x = -w / 2, y = -h / 2;
  ctx.beginPath();
  switch (k) {
    case 'round': ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.22); break;
    case 'circle': ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(0, y); ctx.lineTo(w / 2, h / 2); ctx.lineTo(x, h / 2); ctx.closePath(); break;
    case 'diamond': ctx.moveTo(0, y); ctx.lineTo(w / 2, 0); ctx.lineTo(0, h / 2); ctx.lineTo(x, 0); ctx.closePath(); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? 'lineTo' : 'moveTo']((Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2); } ctx.closePath(); break;
    case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1; ctx[i ? 'lineTo' : 'moveTo']((Math.cos(a) * r * w) / 2, (Math.sin(a) * r * h) / 2); } ctx.closePath(); break;
    case 'heart': ctx.moveTo(0, h * 0.42); ctx.bezierCurveTo(-w * 0.62, -h * 0.05, -w * 0.32, -h * 0.62, 0, -h * 0.22); ctx.bezierCurveTo(w * 0.32, -h * 0.62, w * 0.62, -h * 0.05, 0, h * 0.42); ctx.closePath(); break;
    case 'arrow': ctx.moveTo(x, -h * 0.17); ctx.lineTo(w * 0.18, -h * 0.17); ctx.lineTo(w * 0.18, y); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.18, h / 2); ctx.lineTo(w * 0.18, h * 0.17); ctx.lineTo(x, h * 0.17); ctx.closePath(); break;
    case 'line': ctx.moveTo(x, 0); ctx.lineTo(w / 2, 0); break;
    case 'bubble': ctx.roundRect(x, y, w, h * 0.78, Math.min(w, h) * 0.18); ctx.moveTo(-w * 0.2, y + h * 0.78 - 1); ctx.lineTo(-w * 0.32, h / 2); ctx.lineTo(-w * 0.02, y + h * 0.78 - 1); break;
    case 'cloud': { const bumps = [[-0.25, -0.12, 0.28], [0.05, -0.22, 0.32], [0.3, -0.05, 0.26], [0.12, 0.16, 0.27], [-0.18, 0.15, 0.27], [-0.36, 0.05, 0.2]];
      for (const [bx, by, br] of bumps) { ctx.moveTo(bx * w + br * w, by * h); ctx.ellipse(bx * w, by * h, br * w, br * h * 1.1, 0, 0, Math.PI * 2); } break; }
    case 'arch': ctx.moveTo(x, h / 2); ctx.lineTo(x, y + w / 2 > h / 2 ? 0 : y + w / 2); ctx.ellipse(0, Math.min(0, y + w / 2), w / 2, Math.min(w / 2, h / 2), 0, Math.PI, 0); ctx.lineTo(w / 2, h / 2); ctx.closePath(); break;
    case 'blob': ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.42, y, w * 0.55, -h * 0.1, w * 0.4, h * 0.22); ctx.bezierCurveTo(w * 0.26, h * 0.52, -w * 0.3, h * 0.52, -w * 0.44, h * 0.15); ctx.bezierCurveTo(-w * 0.58, -h * 0.2, -w * 0.38, y, 0, y); ctx.closePath(); break;
    case 'banner': ctx.moveTo(x, y + h * 0.2); ctx.lineTo(w / 2, y + h * 0.2); ctx.lineTo(w * 0.42, 0 + h * 0.05); ctx.lineTo(w / 2, h / 2 - h * 0.1); ctx.lineTo(x, h / 2 - h * 0.1); ctx.lineTo(x + w * 0.08, h * 0.05); ctx.closePath(); break;
    case 'glass': ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.1); break;
    case 'flower': { const n = 10, R = 0.5, r0 = 0.41; for (let i = 0; i <= n * 8; i++) { const a = (i / (n * 8)) * Math.PI * 2 - Math.PI / 2, rr = r0 + (R - r0) * Math.abs(Math.cos((a * n) / 2)); ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr * w, Math.sin(a) * rr * h); } ctx.closePath(); break; }
    case 'squircle': { const n = 64; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); ctx[i ? 'lineTo' : 'moveTo'](Math.sign(c) * Math.pow(Math.abs(c), 0.5) * w / 2, Math.sign(sn) * Math.pow(Math.abs(sn), 0.5) * h / 2); } ctx.closePath(); break; }
    case 'stamp': { const nx = Math.max(6, Math.round(w / (Math.min(w, h) * 0.09))), ny = Math.max(6, Math.round(h / (Math.min(w, h) * 0.09))), rx = w / nx / 2.6, ry = h / ny / 2.6;
      ctx.moveTo(x, y);
      for (let i = 0; i < nx; i++) { const cx = x + (i + 0.5) * w / nx; ctx.lineTo(cx - rx, y); ctx.arc(cx, y, rx, Math.PI, 0, true); } ctx.lineTo(w / 2, y);
      for (let i = 0; i < ny; i++) { const cy = y + (i + 0.5) * h / ny; ctx.lineTo(w / 2, cy - ry); ctx.arc(w / 2, cy, ry, -Math.PI / 2, Math.PI / 2, true); } ctx.lineTo(w / 2, h / 2);
      for (let i = nx - 1; i >= 0; i--) { const cx = x + (i + 0.5) * w / nx; ctx.lineTo(cx + rx, h / 2); ctx.arc(cx, h / 2, rx, 0, Math.PI, true); } ctx.lineTo(x, h / 2);
      for (let i = ny - 1; i >= 0; i--) { const cy = y + (i + 0.5) * h / ny; ctx.lineTo(x, cy + ry); ctx.arc(x, cy, ry, Math.PI / 2, -Math.PI / 2, true); } ctx.closePath(); break; }
    case 'bars': { const n = 5, gap = w * 0.03, bw = (w - gap * (n - 1)) / n; for (let i = 0; i < n; i++) ctx.roundRect(x + i * (bw + gap), y, bw, h, bw * 0.28); break; }
    default: ctx.rect(x, y, w, h);
  }
}
function fillStyleOf(ctx, s, w, h) {
  if (s.metal) return metalGradient(ctx, s.metal, -w / 2, -h / 2, w / 2, h / 2);
  if (s.g && s.g2) { const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); g.addColorStop(0, s.f || '#ffffff'); g.addColorStop(1, s.g2); return g; }
  return s.f;
}
export function drawShape(ctx, s, W, H) {
  const w = s.w * W, h = s.h * H;
  ctx.translate(s.x * W, s.y * H); if (s.rot) ctx.rotate(s.rot); if (s.fx || s.fy) ctx.scale(s.fx ? -1 : 1, s.fy ? -1 : 1);
  ctx.globalAlpha = s.a ?? 1;
  if (s.k === 'glass') { drawGlass(ctx, s, w, h); return; }
  if (s.k && s.k.startsWith('e:')) { drawElement(ctx, s.k.slice(2), w, h, fillStyleOf(ctx, s, w, h) || s.lc || '#16181d', s.lw ? s.lw * W : 0, s.lc && s.lw ? s.lc : '', s.sh); return; }
  shapePath(ctx, s.k, w, h);
  if (s.sh) { ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = Math.min(w, h) * 0.08; ctx.shadowOffsetY = Math.min(w, h) * 0.03; }
  if (s.f && s.k !== 'line') { ctx.fillStyle = fillStyleOf(ctx, s, w, h); ctx.fill(); }
  ctx.shadowColor = 'transparent';
  if (s.lc && (s.lw || s.k === 'line')) { ctx.strokeStyle = s.lc; ctx.lineWidth = Math.max(1, (s.lw || 0.004) * W); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  if (s.k === 'line' && s.ah) { // arrow head on a line
    const L = w / 2, hw = Math.max(4, (s.lw || 0.004) * W * 3.2);
    ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(L - hw * 1.6, -hw); ctx.lineTo(L - hw * 1.6, hw); ctx.closePath(); ctx.fillStyle = s.lc; ctx.fill();
  }
}

// Frosted glass: whatever is under the card shows through, softly blurred, with a light tint,
// a bright edge and a soft shadow.
const glassScratch = [document.createElement('canvas'), document.createElement('canvas')];
function drawGlass(ctx, s, w, h) {
  const r = Math.min(w, h) * 0.1, a = s.a ?? 1, m = Math.min(w, h);
  const T = ctx.getTransform(), cv = ctx.canvas;
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [T.a * x + T.c * y + T.e, T.b * x + T.d * y + T.f]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0])))), y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1]))));
  const x1 = Math.min(cv.width, Math.ceil(Math.max(...pts.map((q) => q[0])))), y1 = Math.min(cv.height, Math.ceil(Math.max(...pts.map((q) => q[1]))));
  let blurred = null;
  if (x1 - x0 > 4 && y1 - y0 > 4) {
    // blur by shrinking twice and growing back: smooth, fast and it works everywhere
    const bw = x1 - x0, bh = y1 - y0, [c1, c2] = glassScratch;
    c1.width = Math.max(2, Math.round(bw / 4)); c1.height = Math.max(2, Math.round(bh / 4));
    c2.width = Math.max(2, Math.round(bw / 18)); c2.height = Math.max(2, Math.round(bh / 18));
    const g1 = c1.getContext('2d'), g2 = c2.getContext('2d');
    g1.clearRect(0, 0, c1.width, c1.height); g2.clearRect(0, 0, c2.width, c2.height);
    try { g1.drawImage(cv, x0, y0, bw, bh, 0, 0, c1.width, c1.height); g2.drawImage(c1, 0, 0, c2.width, c2.height); blurred = { bw, bh }; } catch { blurred = null; }
  }
  ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.shadowColor = 'rgba(20,24,35,.22)'; ctx.shadowBlur = m * 0.09; ctx.shadowOffsetY = m * 0.03;
  ctx.globalAlpha = a; ctx.fillStyle = '#f7f8fa'; ctx.fill(); ctx.restore();
  if (blurred) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(glassScratch[1], x0, y0, blurred.bw, blurred.bh); ctx.restore();
  }
  ctx.save(); ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.globalAlpha = a * 0.26; ctx.fillStyle = s.f || '#ffffff'; ctx.fill();
  const sh = ctx.createLinearGradient(-w / 2, -h / 2, w * 0.1, h * 0.2); sh.addColorStop(0, 'rgba(255,255,255,.5)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = a; ctx.fillStyle = sh; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, m * 0.007); ctx.stroke(); ctx.restore();
}

// ---------- page backgrounds ----------
export const BACKGROUNDS = [
  ['#ffffff', ''], ['#fbf6ea', ''], ['#fdeef0', ''], ['#eaf4ec', ''], ['#e9f0fb', ''], ['#f1ecfa', ''], ['#fff6d6', ''], ['#1d2233', ''],
  ['#fde2e4', '#e2ece9'], ['#fff1c1', '#ffd6e0'], ['#d6e8ff', '#e9ddff'], ['#e3f2e1', '#fdf6e3'], ['#0f2027', '#2c5364'], ['#ffecd2', '#fcb69f'],
];
export const BG_PATTERNS = [['', 'Plain'], ['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lines'], ['stripes', 'Stripes'], ['staves', 'Staves']];
export function drawBackground(ctx, s, W, H) {
  if (s.c2) { const g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, s.c); g.addColorStop(1, s.c2); ctx.fillStyle = g; } else ctx.fillStyle = s.c;
  ctx.globalAlpha = s.a ?? 1; ctx.fillRect(0, 0, W, H);
  const dark = /^#([0-4])/.test(s.c || '');
  ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(30,40,70,.12)';
  const step = W / 28;
  if (s.pat === 'dots') for (let y = step; y < H; y += step) for (let x = step; x < W; x += step) { ctx.beginPath(); ctx.arc(x, y, Math.max(1, W / 700), 0, Math.PI * 2); ctx.fill(); }
  else if (s.pat === 'grid') { ctx.lineWidth = Math.max(1, W / 1400); for (let x = step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = step; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } }
  else if (s.pat === 'lines') { ctx.lineWidth = Math.max(1, W / 1200); for (let y = step * 3; y < H - step; y += step * 1.2) { ctx.beginPath(); ctx.moveTo(W * 0.06, y); ctx.lineTo(W * 0.94, y); ctx.stroke(); } }
  else if (s.pat === 'stripes') { ctx.lineWidth = step * 0.5; for (let x = -H; x < W; x += step * 1.6) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke(); } }
  else if (s.pat === 'staves') { ctx.lineWidth = Math.max(1, W / 1100); const sp = W / 110; for (let y = H * 0.1; y < H * 0.92; y += sp * 11) for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(W * 0.07, y + k * sp); ctx.lineTo(W * 0.93, y + k * sp); ctx.stroke(); } }
}

// ---------- photo looks (one tap) and photo shapes ----------
export const PHOTO_FILTERS = [
  ['none', 'Original', { b: 0, c: 0, s: 0, w: 0, bw: 0 }], ['vivid', 'Vivid', { b: 0.04, c: 0.18, s: 0.35, w: 0, bw: 0 }],
  ['warm', 'Warm', { b: 0.03, c: 0.06, s: 0.08, w: 0.45, bw: 0 }], ['cool', 'Cool', { b: 0, c: 0.08, s: 0, w: -0.45, bw: 0 }],
  ['vintage', 'Vintage', { b: 0.06, c: -0.15, s: -0.35, w: 0.35, bw: 0 }], ['mono', 'Mono', { b: 0, c: 0.15, s: 0, w: 0, bw: 1 }],
  ['soft', 'Soft', { b: 0.1, c: -0.22, s: -0.1, w: 0.1, bw: 0 }], ['drama', 'Drama', { b: -0.08, c: 0.4, s: 0.1, w: 0, bw: 0 }],
];
export const PHOTO_SHAPES = [['', 'Square'], ['circle', 'Circle'], ['round', 'Rounded'], ['arch', 'Arch'], ['heart', 'Heart'], ['star', 'Star'], ['hexagon', 'Hexagon'], ['blob', 'Blob'], ['flower', 'Flower'], ['squircle', 'Soft square'], ['stamp', 'Postage stamp'], ['diamond', 'Diamond'], ['bars', 'Stripes'], ['word', 'Inside a word']];
export const WORD_FONTS = [['condensed', 'Poster'], ['futura', 'Futura'], ['display', 'Didot'], ['rockwell', 'Slab'], ['script', 'Script'], ['round', 'Rounded']];
