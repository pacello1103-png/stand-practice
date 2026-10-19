// Apple Pencil markings. Strokes are stored in page-relative coordinates (0..1) so they stay
// in place at any zoom. Item types:
//   pen / hl    freehand strokes rendered with perfect-freehand
//   stamp       a music symbol or text placed at a point
//   white       a whiteout brush stroke (covers the printed score with paper colour)
//   mask        a precise whiteout of printed shapes found by the smart eraser
import { getStroke } from '../vendor/perfect-freehand.mjs';
import { db } from './db.js';
import { strokeOptions, paintKind, drawNib, drawPicture, drawTextBox, tbHeight, setAssetReady, PEN_WIDTH, drawTape, tapeBounds, tapeHit, drawShape, drawBackground } from './inkx.js';
export { preloadAssets } from './inkx.js';

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
export function setMaskReadyHandler(fn) { onMaskReady = fn; setAssetReady(fn); }
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

// Passages: a marked part of the music (any instrument). The kind sets the colour.
export const PASSAGE_KINDS = {
  melodic: { label: 'Melodic', color: '#2b6fd6' },
  technical: { label: 'Technical', color: '#d12f2f' },
  shift: { label: 'Shift', color: '#7b3fc4' },
  rhythm: { label: 'Rhythm', color: '#0f8f8f' },
  bowing: { label: 'Bowing & breath', color: '#ea7a17' },
};
function drawPassage(ctx, s, W, H) {
  const c = (PASSAGE_KINDS[s.kind] || PASSAGE_KINDS.melodic).color;
  const x = s.x0 * W, y = s.y0 * H, w = (s.x1 - s.x0) * W, h = (s.y1 - s.y0) * H;
  ctx.globalAlpha = 1;
  ctx.fillStyle = c + '14';
  ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, W / 700);
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  const label = (s.name || PASSAGE_KINDS[s.kind]?.label || 'Passage').slice(0, 28);
  const fs = Math.max(11, Math.round(W / 95));
  ctx.font = `600 ${fs}px -apple-system, "SF Pro Text", Helvetica, Arial, sans-serif`;
  const tw = ctx.measureText(label).width + fs;
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.roundRect(x, y - fs * 1.35, tw, fs * 1.35, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + fs * 0.5, y - fs * 0.68);
}

export function drawItem(ctx, s, W, H, live) {
  ctx.save();
  if (s.t === 'passage') { drawPassage(ctx, s, W, H); ctx.restore(); return; }
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
  if (s.t === 'img') { drawPicture(ctx, s, W, H); ctx.restore(); return; }
  if (s.t === 'tb') { drawTextBox(ctx, s, W, H); ctx.restore(); return; }
  if (s.t === 'tape') { drawTape(ctx, s, W, H); ctx.restore(); return; }
  if (s.t === 'shape') { drawShape(ctx, s, W, H); ctx.restore(); return; }
  if (s.t === 'bg') { drawBackground(ctx, s, W, H); ctx.restore(); return; }
  const raw = s.p.map((p) => [p[0] * W, p[1] * H, p[2] ?? 0.5]);
  if (!raw.length) { ctx.restore(); return; }
  const kind = s.t === 'pen' ? s.pk || 'fountain' : null;
  const pts = s.t === 'pen' && !s.sh ? smoothPoints(raw) : raw;
  const size = Math.max(1, s.s * W);
  const hasPressure = s.t === 'pen' && pts.some((p) => Math.abs(p[2] - 0.5) > 0.01);
  if (kind === 'calli') { drawNib(ctx, pts, size, s.c, s.a ?? 1); ctx.restore(); return; }
  let opts;
  if (s.t === 'pen') {
    opts = strokeOptions(kind, size, hasPressure, live);
    if (s.sh) { opts.smoothing = 0.2; opts.streamline = 0; opts.thinning = Math.min(opts.thinning, 0.2); opts.simulatePressure = false; }
  } else {
    opts = { size, thinning: 0, smoothing: 0.62, streamline: 0.55, simulatePressure: false, easing: (t) => t, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: !live };
  }
  const outline = getStroke(pts, opts);
  if (s.t === 'pen') {
    // a neat shape can be filled with a light wash of its colour
    if (s.sh && s.fill && pts.length > 2) { ctx.save(); ctx.globalAlpha = (s.a ?? 1) * 0.22; ctx.fillStyle = s.c; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); ctx.restore(); }
    paintKind(ctx, kind, s.c, s.a ?? 1, () => outlinePath(ctx, outline), size, pts); ctx.restore(); return;
  }
  ctx.fillStyle = s.t === 'white' ? paperColor : s.c;
  ctx.globalAlpha = s.t === 'white' ? 1 : (s.a ?? 1);
  if (s.t === 'hl') ctx.globalCompositeOperation = 'multiply';
  outlinePath(ctx, outline);
  ctx.fill();
  ctx.restore();
}

function drawStamp(ctx, s, W, H) {
  const def = s.k === 'txt' ? { label: s.txt || '', font: 'words' } : s.k === 'emo' ? { label: s.e || '⭐', font: 'emoji' } : s.k === 'mus' ? { label: s.e || '', font: 'music' } : STAMP_BY_KEY[s.k] || { label: s.k, font: 'finger' };
  const size = s.s * W;
  const x = s.x * W, y = s.y * H;
  ctx.fillStyle = s.c; ctx.strokeStyle = s.c; ctx.globalAlpha = s.a ?? 1;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (def.font === 'words') {
    ctx.font = textFont(size, s.b);
    ctx.textAlign = s.al === 'l' ? 'left' : 'center';
    if (s.bg) {   // a paper box behind the words, for when they cannot sit clear of the notes
      const w = ctx.measureText(def.label).width, pad = size * 0.14;
      ctx.save();
      ctx.globalAlpha = 0.92; ctx.fillStyle = '#fff';
      ctx.fillRect(s.al === 'l' ? x - pad : x - w / 2 - pad, y - size * 0.55, w + pad * 2, size * 1.1);
      ctx.restore();
    }
    ctx.fillText(def.label, x, y);
  } else if (def.font === 'music') {
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

// Words typed with the text tool: the italic serif used for expression marks in printed music.
export const textFont = (size, bold) => `italic ${bold ? 700 : 500} ${size * 0.78}px "Times New Roman", Georgia, serif`;
let measureCtx = null;
function textHalfWidth(s) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = textFont(100, s.b);
  return (measureCtx.measureText(s.txt || '').width / 100) * s.s / 2;
}

// ---------- geometry helpers (selection, eraser) ----------
export function itemBounds(s) {
  if (s.t === 'passage') return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
  if (s.t === 'stamp' && s.k === 'txt') {
    const hw = textHalfWidth(s) + s.s * 0.15, hh = s.s * 0.55;
    const cx = s.al === 'l' ? s.x + hw - s.s * 0.15 : s.x;   // words that start at the tap run to the right
    return { x0: cx - hw, y0: s.y - hh, x1: cx + hw, y1: s.y + hh };
  }
  if (s.t === 'stamp') { const r = s.s * 1.2; return { x0: s.x - r, y0: s.y - r * 0.8, x1: s.x + r, y1: s.y + r * 0.8 }; }
  if (s.t === 'mask') return { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  if (s.t === 'img') {
    // a white border or instant-photo frame is part of what you select
    const m = Math.min(s.w, s.h * 1.414), pad = s.fr === 'white' || s.fr === 'polaroid' ? m * 0.045 : 0, bot = s.fr === 'polaroid' ? m * 0.2 : pad;
    if (!pad) return rotBounds(s.x, s.y, s.w, s.h, s.rot || 0);
    const dy = (bot - pad) / 2 / 1.414, c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
    return rotBounds(s.x - sn * dy * 1.414, s.y + c * dy, s.w + pad * 2, s.h + (pad + bot) / 1.414, s.rot || 0);
  }
  if (s.t === 'tb') { const h = s.h || 0.04; return s.rot ? rotBounds(s.x + s.w / 2, s.y + h / 2, s.w, h, s.rot) : { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + h }; }
  if (s.t === 'tape') return tapeBounds(s);
  if (s.t === 'shape') return rotBounds(s.x, s.y, s.w, s.h, s.rot || 0);
  if (s.t === 'bg') return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of s.p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const r = s.s / 2;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}
// the box around a rotated rectangle given by its centre (page fractions; the page is about 1:1.41)
function rotBounds(cx, cy, w, h, rot) {
  if (!rot) return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
  const A = 1.414, c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hw = (w / 2) * c + (h * A / 2) * s, hh = ((w / 2) * s) / A + (h / 2) * c;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}
// the height of a text box at the shape of the page
export function measureTextBox(s, W = 1000, H = 1414) { return { ...s, h: +tbHeight(s, W, H).toFixed(5) }; }
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
    if (s.t === 'passage') return;
    if (s.t === 'stamp') { if (inPoly(s.x, s.y, poly)) sel.push(i); return; }
    if (s.t === 'mask') { if (inPoly(s.x + s.w / 2, s.y + s.h / 2, poly)) sel.push(i); return; }
    if (s.t === 'bg' || s.lock) return;
    if (s.t === 'shape') { if (inPoly(s.x, s.y, poly)) sel.push(i); return; }
    if (s.t === 'tape') { if (inPoly((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, poly)) sel.push(i); return; }
    if (s.t === 'img' || s.t === 'tb') { const b = itemBounds(s); if (inPoly((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, poly)) sel.push(i); return; }
    let n = 0; for (const p of s.p) if (inPoly(p[0], p[1], poly)) n++;
    if (n >= Math.max(1, s.p.length * 0.5)) sel.push(i);
  });
  return sel;
}
// Move and scale an item about an origin (page coordinates).
export function transformItem(s, dx, dy, k, ox, oy) {
  const tx = (x) => ox + (x - ox) * k + dx, ty = (y) => oy + (y - oy) * k + dy;
  if (s.t === 'passage') return { ...s, x0: tx(s.x0), y0: ty(s.y0), x1: tx(s.x1), y1: ty(s.y1) };
  if (s.t === 'stamp') return { ...s, x: tx(s.x), y: ty(s.y), s: s.s * k };
  if (s.t === 'mask') return { ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, h: s.h * k };
  if (s.t === 'img') return { ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, h: s.h * k };
  if (s.t === 'shape') return { ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, h: s.h * k };
  if (s.t === 'bg') return s;
  if (s.t === 'tape') return { ...s, x0: tx(s.x0), y0: ty(s.y0), x1: tx(s.x1), y1: ty(s.y1), w: s.w * k };
  if (s.t === 'tb') return measureTextBox({ ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, fs: s.fs * k });
  return { ...s, s: s.s * k, p: s.p.map((p) => [+tx(p[0]).toFixed(5), +ty(p[1]).toFixed(5), p[2]]) };
}

export function itemHit(s, x, y, r, W, H) {
  if (s.t === 'passage') return false;
  if (s.t === 'stamp' && s.k === 'txt') { const b = itemBounds(s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
  if (s.t === 'stamp') { const d = Math.hypot((s.x - x) * W, (s.y - y) * H); return d < Math.max(r * W, s.s * W); }
  if (s.t === 'mask') return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - r && y <= s.y + s.h + r;
  if (s.t === 'img' || s.t === 'tb') { const b = itemBounds(s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
  if (s.t === 'tape') return tapeHit(s, x, y, r, W, H);
  if (s.t === 'bg') return false;
  if (s.t === 'shape') { const b = itemBounds(s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
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
    const stored = rec ? (rec.items || rec.strokes || []).map(normalise) : [];
    // anything added while loading is kept on top of what was stored
    this.items = this.touched ? [...stored, ...this.items] : stored;
    if (this.items.some((s) => s.t === 'stamp')) await loadMusicFont();
    this.ready = true;
    this.redraw();
  }
  save() {
    this.touched = true;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      if (!this.ready) { this.loaded.then(() => this.save()); return; }   // never overwrite markings not yet loaded
      db.put('ink', { key: this.key, items: this.items }).catch(() => {});
    }, 300);
  }
  // The canvas can hold the whole page, or (zoomed in) only the part on screen at full sharpness:
  // view is that part as page fractions { x, y, w, h }.
  get fullW() { return this.canvas.width / (this.view ? this.view.w : 1); }
  get fullH() { return this.canvas.height / (this.view ? this.view.h : 1); }
  prep(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.view) ctx.translate(-this.view.x * this.fullW, -this.view.y * this.fullH);
  }
  redraw(hide) {
    const c = this.canvas, ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const W = this.fullW, H = this.fullH;
    this.prep(ctx);
    const v = this.view;
    this.items.forEach((s, i) => {
      if (hide && hide.has(i)) return;
      // zoomed in: what is off the part on show is not drawn at all
      if (v && s.t !== 'bg' && s.t !== 'passage') { const b = itemBounds(s); if (b && (b.x1 < v.x - 0.02 || b.x0 > v.x + v.w + 0.02 || b.y1 < v.y - 0.02 || b.y0 > v.y + v.h + 0.02)) return; }
      drawItem(ctx, s, W, H, false);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  resize(w, h) { const had = !!this.view; this.view = null; if (had || this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.redraw(); } }
  setView(view, w, h) { this.view = view; this.canvas.width = Math.max(1, Math.round(w)); this.canvas.height = Math.max(1, Math.round(h)); this.redraw(); }
  commit(item) {
    this.items = [...this.items, item];
    const ctx = this.canvas.getContext('2d');
    this.prep(ctx); drawItem(ctx, item, this.fullW, this.fullH, false); ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.save();
  }
  // Erases like a real eraser: the part of a pen or highlighter stroke under the eraser goes,
  // the rest of the stroke stays. Symbols, words and whiteouts go as a whole.
  eraseAt(x, y, r, whole) { return this.eraseMany([[x, y]], r, whole); }
  // Rub out along several points at once (one redraw for a whole move of the Pencil).
  eraseMany(pts, r, whole) {
    const W = this.fullW, H = this.fullH;
    let changed = false, items = this.items;
    for (const [x, y] of pts) {
      let hit = false; const out = [];
      for (const s of items) {
        if (s.t === 'img' || s.t === 'tb' || s.t === 'shape' || s.t === 'bg' || s.lock || !itemHit(s, x, y, r, W, H)) { out.push(s); continue; }
        hit = true;
        if (whole || !s.p || s.p.length < 2) continue;
        for (const part of cutStroke(s.p, x, y, r + (s.s || 0) * 0.35, W, H)) out.push({ ...s, p: part });
      }
      if (hit) { items = out; changed = true; }
    }
    if (changed) { this.items = items; this.redraw(); this.save(); }
    return changed;
  }
  setItems(items) { this.items = items; this.redraw(); this.save(); }
}

// Remove the part of a stroke inside a circle; returns the pieces that remain.
function cutStroke(pts, x, y, r, W, H) {
  // add points along long segments so a quick stroke can be cut in its middle
  const dense = [pts[0]];
  const step = Math.max(r * 0.4, 0.001);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.ceil(Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) / (step * W));
    for (let k = 1; k < n; k++) { const t = k / n; dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    dense.push(b);
  }
  const parts = []; let cur = [];
  for (const p of dense) {
    if (Math.hypot((p[0] - x) * W, (p[1] - y) * H) < r * W) { if (cur.length > 1) parts.push(cur); cur = []; }
    else cur.push([+p[0].toFixed(5), +p[1].toFixed(5), p[2]]);
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

export async function loadItems(key) {
  const rec = await db.get('ink', key).catch(() => null);
  return rec ? (rec.items || rec.strokes || []).map(normalise) : [];
}
export function saveItems(key, items) { return db.put('ink', { key, items }).catch(() => {}); }
