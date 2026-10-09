// Apple Pencil markings. Strokes are stored in page-relative coordinates (0..1) so they stay
// in place at any zoom. Item types:
//   pen / hl    freehand strokes rendered with perfect-freehand
//   stamp       a music symbol or text placed at a point
//   white       a whiteout brush stroke (covers the printed score with paper colour)
//   mask        a precise whiteout of printed shapes found by the smart eraser
import { getStroke } from '../vendor/perfect-freehand.mjs';
import { db } from './db.js';

export const COLORS = ['#16181d', '#5b616e', '#d12f2f', '#ea7a17', '#e6b800', '#2f9e55', '#0f8f8f', '#2b6fd6', '#1f3a8f', '#7b3fc4', '#d23c8f', '#7a4b2a'];

// SMuFL code points (Bravura)
const G = { p: '', m: '', f: '', s: '', z: '', r: '' };
export const STAMPS = [
  { k: 'pp', label: G.p + G.p, font: 'music' }, { k: 'p', label: G.p, font: 'music' }, { k: 'mp', label: G.m + G.p, font: 'music' },
  { k: 'mf', label: G.m + G.f, font: 'music' }, { k: 'f', label: G.f, font: 'music' }, { k: 'ff', label: G.f + G.f, font: 'music' },
  { k: 'sfz', label: G.s + G.f + G.z, font: 'music' }, { k: 'fp', label: G.f + G.p, font: 'music' },
  { k: 'cresc', label: '<', font: 'shape' }, { k: 'dim', label: '>', font: 'shape' },
  { k: 'down', label: '', font: 'music' }, { k: 'up', label: '', font: 'music' },
  { k: 'fermata', label: '', font: 'music' }, { k: 'breath', label: '', font: 'music' }, { k: 'tick', label: '', font: 'music' }, { k: 'caesura', label: '', font: 'music' },
  { k: 'accent', label: '', font: 'music' }, { k: 'tenuto', label: '', font: 'music' }, { k: 'stacc', label: '', font: 'music' }, { k: 'harm', label: '', font: 'music' },
  { k: 'sharp', label: '', font: 'music' }, { k: 'flat', label: '', font: 'music' }, { k: 'natural', label: '', font: 'music' },
  { k: '0', label: '0', font: 'finger' }, { k: '1', label: '1', font: 'finger' }, { k: '2', label: '2', font: 'finger' }, { k: '3', label: '3', font: 'finger' }, { k: '4', label: '4', font: 'finger' },
  { k: 'I', label: 'I', font: 'roman' }, { k: 'II', label: 'II', font: 'roman' }, { k: 'III', label: 'III', font: 'roman' }, { k: 'IV', label: 'IV', font: 'roman' },
  { k: 'rit', label: 'rit.', font: 'text' }, { k: 'atempo', label: 'a tempo', font: 'text' }, { k: 'pizz', label: 'pizz.', font: 'text' }, { k: 'arco', label: 'arco', font: 'text' },
  { k: 'glasses', label: '👓', font: 'emoji' }, { k: 'circle', label: '○', font: 'shape' }, { k: 'box', label: '▢', font: 'shape' },
];
const STAMP_BY_KEY = Object.fromEntries(STAMPS.map((s) => [s.k, s]));

let fontReady = null;
export function loadMusicFont() {
  if (!fontReady) fontReady = document.fonts ? document.fonts.load('40px Bravura').catch(() => {}) : Promise.resolve();
  return fontReady;
}

let paperColor = '#ffffff';
export function setPaperColor(c) { paperColor = c; }

// Accept strokes saved by older versions of the app.
function normalise(s) {
  if (s.t) return s;
  return { t: s.tool === 'hl' ? 'hl' : 'pen', c: s.color, a: s.tool === 'hl' ? 0.35 : 1, s: s.tool === 'hl' ? 0.018 : 0.0034, p: s.pts };
}

function outlinePath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
}

// Light smoothing of the raw pointer samples: removes the small zig-zags of fast, coalesced
// Pencil events while keeping corners.
function smoothPoints(pts) {
  if (pts.length < 4) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const maskImages = new Map();
let onMaskReady = null;
export function setMaskReadyHandler(fn) { onMaskReady = fn; }
function maskImage(src) {
  let m = maskImages.get(src);
  if (!m) {
    m = { img: new Image(), ready: false };
    m.img.onload = () => { m.ready = true; onMaskReady && onMaskReady(); };
    m.img.src = src;
    maskImages.set(src, m);
  }
  return m;
}
let tintCanvas = null;

export function drawItem(ctx, s, W, H, live) {
  ctx.save();
  if (s.t === 'stamp') { drawStamp(ctx, s, W, H); ctx.restore(); return; }
  if (s.t === 'mask') {
    const m = maskImage(s.d);
    if (m.ready) {
      const w = Math.max(1, Math.round(s.w * W)), h = Math.max(1, Math.round(s.h * H));
      if (!tintCanvas) tintCanvas = document.createElement('canvas');
      tintCanvas.width = w; tintCanvas.height = h;
      const t = tintCanvas.getContext('2d');
      t.clearRect(0, 0, w, h);
      t.imageSmoothingEnabled = true;
      t.drawImage(m.img, 0, 0, w, h);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = paperColor; t.fillRect(0, 0, w, h);
      ctx.drawImage(tintCanvas, Math.round(s.x * W), Math.round(s.y * H));
    }
    ctx.restore();
    return;
  }
  const raw = s.p.map((p) => [p[0] * W, p[1] * H, p[2] ?? 0.5]);
  if (!raw.length) { ctx.restore(); return; }
  const pts = s.t === 'pen' ? smoothPoints(raw) : raw;
  const size = Math.max(1, s.s * W);
  const hasPressure = s.t === 'pen' && pts.some((p) => Math.abs(p[2] - 0.5) > 0.01);
  const outline = getStroke(pts, {
    size,
    thinning: s.t === 'pen' ? (hasPressure ? 0.55 : 0.3) : 0,
    smoothing: 0.62,
    streamline: s.t === 'pen' ? 0.42 : 0.55,
    simulatePressure: s.t === 'pen' && !hasPressure,
    easing: (t) => t,
    start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 },
    last: !live,
  });
  ctx.fillStyle = s.t === 'white' ? paperColor : s.c;
  ctx.globalAlpha = s.t === 'white' ? 1 : (s.a ?? 1);
  if (s.t === 'hl') ctx.globalCompositeOperation = 'multiply';
  outlinePath(ctx, outline);
  ctx.fill();
  ctx.restore();
}

function drawStamp(ctx, s, W, H) {
  const def = STAMP_BY_KEY[s.k] || { label: s.k, font: 'finger' };
  const size = s.s * W;
  const x = s.x * W, y = s.y * H;
  ctx.fillStyle = s.c; ctx.strokeStyle = s.c; ctx.globalAlpha = s.a ?? 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (def.font === 'music') {
    ctx.font = `${size * 1.6}px Bravura`;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(def.label);
    const asc = m.actualBoundingBoxAscent || size * 0.6, desc = m.actualBoundingBoxDescent || 0;
    ctx.fillText(def.label, x, y + (asc - desc) / 2);
  } else if (def.font === 'finger') {
    ctx.font = `700 ${size}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(def.label, x, y);
  } else if (def.font === 'roman') {
    ctx.font = `600 ${size * 0.9}px "Times New Roman", Georgia, serif`;
    ctx.fillText(def.label, x, y);
  } else if (def.font === 'text') {
    ctx.font = `italic 600 ${size * 0.8}px "Times New Roman", Georgia, serif`;
    ctx.fillText(def.label, x, y);
  } else if (def.font === 'emoji') {
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(def.label, x, y);
  } else {
    ctx.lineWidth = Math.max(1.5, size * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (s.k === 'cresc' || s.k === 'dim') {
      const L = size * 2.6, h = size * 0.38;
      if (s.k === 'cresc') { ctx.moveTo(x + L / 2, y - h); ctx.lineTo(x - L / 2, y); ctx.lineTo(x + L / 2, y + h); }
      else { ctx.moveTo(x - L / 2, y - h); ctx.lineTo(x + L / 2, y); ctx.lineTo(x - L / 2, y + h); }
    } else if (s.k === 'circle') ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
    else if (s.k === 'box') { const r = size * 0.7; ctx.rect(x - r * 1.4, y - r, r * 2.8, r * 2); }
    ctx.stroke();
  }
}

// ---------- geometry helpers (selection, eraser) ----------
export function itemBounds(s) {
  if (s.t === 'stamp') { const r = s.s * 1.2; return { x0: s.x - r, y0: s.y - r * 0.8, x1: s.x + r, y1: s.y + r * 0.8 }; }
  if (s.t === 'mask') return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of s.p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const r = s.s / 2;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Items mostly inside a lasso polygon (page coordinates).
export function itemsInLasso(items, poly) {
  const sel = [];
  items.forEach((s, i) => {
    if (s.t === 'stamp') { if (inPoly(s.x, s.y, poly)) sel.push(i); return; }
    if (s.t === 'mask') { if (inPoly(s.x + s.w / 2, s.y + s.h / 2, poly)) sel.push(i); return; }
    let n = 0; for (const p of s.p) if (inPoly(p[0], p[1], poly)) n++;
    if (n >= Math.max(1, s.p.length * 0.5)) sel.push(i);
  });
  return sel;
}
// Move and scale an item about an origin (page coordinates).
export function transformItem(s, dx, dy, k, ox, oy) {
  const tx = (x) => ox + (x - ox) * k + dx, ty = (y) => oy + (y - oy) * k + dy;
  if (s.t === 'stamp') return { ...s, x: tx(s.x), y: ty(s.y), s: s.s * k };
  if (s.t === 'mask') return { ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, h: s.h * k };
  return { ...s, s: s.s * k, p: s.p.map((p) => [+tx(p[0]).toFixed(5), +ty(p[1]).toFixed(5), p[2]]) };
}

export function itemHit(s, x, y, r, W, H) {
  if (s.t === 'stamp') { const d = Math.hypot((s.x - x) * W, (s.y - y) * H); return d < Math.max(r * W, s.s * W); }
  if (s.t === 'mask') return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - r && y <= s.y + s.h + r;
  const rr = r + (s.s || 0) / 2;
  return s.p.some((p) => Math.hypot((p[0] - x) * W, (p[1] - y) * H) < rr * W);
}

// ---------- smart eraser for the printed score ----------
// Finds the printed shapes under a scribble (connected dark pixels) and returns a mask item
// that covers exactly those shapes. Shapes connected to staff lines or large note groups are
// left alone, so the music itself is never erased by accident.
export function smartMask(art, stroke) {
  const W = art.width, H = art.height;
  const g = art.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H).data;
  const dark = (i) => { const o = i * 4; return img[o] + img[o + 1] + img[o + 2] < 3 * 175; };
  const maxW = W * 0.34, maxH = H * 0.055, maxPx = W * H * 0.006;
  const seen = new Uint8Array(W * H);
  const accepted = [];
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0, rejected = 0;
  const seeds = [];
  for (let i = 0; i < stroke.length; i++) {
    const [px, py] = stroke[i];
    const steps = i ? Math.ceil(Math.hypot((px - stroke[i - 1][0]) * W, (py - stroke[i - 1][1]) * H) / 2) : 1;
    for (let k = 0; k < steps; k++) {
      const t = steps === 1 ? 1 : k / steps;
      const x = Math.round((i ? stroke[i - 1][0] + (px - stroke[i - 1][0]) * t : px) * W);
      const y = Math.round((i ? stroke[i - 1][1] + (py - stroke[i - 1][1]) * t : py) * H);
      for (let oy = -3; oy <= 3; oy += 3) for (let ox = -3; ox <= 3; ox += 3) seeds.push([x + ox, y + oy]);
    }
  }
  for (const [sx, sy] of seeds) {
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const s0 = sy * W + sx;
    if (seen[s0] || !dark(s0)) continue;
    // flood fill with limits
    const stack = [s0]; const comp = []; seen[s0] = 1;
    let x0 = sx, x1 = sx, y0 = sy, y1 = sy, ok = true;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > maxW || y1 - y0 > maxH || comp.length > maxPx) { ok = false; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && dark(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    // long thin horizontal shapes are staff lines; never erase them
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (!ok || (w > W * 0.25 && h < 6)) { rejected++; continue; }
    accepted.push(comp);
    if (x0 < bx0) bx0 = x0; if (y0 < by0) by0 = y0; if (x1 > bx1) bx1 = x1; if (y1 > by1) by1 = y1;
  }
  if (!accepted.length) return { item: null, rejected };
  const pad = 3;
  bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(W - 1, bx1 + pad); by1 = Math.min(H - 1, by1 + pad);
  const mw = bx1 - bx0 + 1, mh = by1 - by0 + 1;
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  const mg = mc.getContext('2d');
  const md = mg.createImageData(mw, mh);
  // dilate by 2 px so anti-aliased edges disappear too
  for (const comp of accepted) for (const i of comp) {
    const x = (i % W) - bx0, y = ((i / W) | 0) - by0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
      md.data[(ny * mw + nx) * 4 + 3] = 255;
    }
  }
  mg.putImageData(md, 0, 0);
  return { item: { t: 'mask', x: bx0 / W, y: by0 / H, w: mw / W, h: mh / H, d: mc.toDataURL('image/png') }, rejected, count: accepted.length };
}

export class InkLayer {
  constructor(ink, scoreId, page) {
    this.canvas = ink; this.scoreId = scoreId; this.page = page;
    this.items = []; this.key = scoreId + ':' + page;
    this._saveT = 0; this.loaded = this.load();
  }
  async load() {
    const rec = await db.get('ink', this.key).catch(() => null);
    this.items = rec ? (rec.items || rec.strokes || []).map(normalise) : [];
    if (this.items.some((s) => s.t === 'stamp')) await loadMusicFont();
    this.redraw();
  }
  save() {
    clearTimeout(this._saveT);
    const items = this.items;
    this._saveT = setTimeout(() => db.put('ink', { key: this.key, items }).catch(() => {}), 300);
  }
  redraw(hide) {
    const c = this.canvas, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    this.items.forEach((s, i) => { if (!hide || !hide.has(i)) drawItem(ctx, s, c.width, c.height, false); });
  }
  resize(w, h) { if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.redraw(); } }
  commit(item) {
    this.items = [...this.items, item];
    drawItem(this.canvas.getContext('2d'), item, this.canvas.width, this.canvas.height, false);
    this.save();
  }
  eraseAt(x, y, r) {
    const W = this.canvas.width, H = this.canvas.height;
    const before = this.items.length;
    const keep = this.items.filter((s) => !itemHit(s, x, y, r, W, H));
    if (keep.length !== before) { this.items = keep; this.redraw(); this.save(); return true; }
    return false;
  }
  setItems(items) { this.items = items; this.redraw(); this.save(); }
}

export async function loadItems(key) {
  const rec = await db.get('ink', key).catch(() => null);
  return rec ? (rec.items || rec.strokes || []).map(normalise) : [];
}
export function saveItems(key, items) { return db.put('ink', { key, items }).catch(() => {}); }
