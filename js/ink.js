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
  const def = s.k === 'txt' ? { label: s.txt || '', font: 'words' } : STAMP_BY_KEY[s.k] || { label: s.k, font: 'finger' };
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
    if (s.t === 'passage') return;
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
  if (s.t === 'passage') return { ...s, x0: tx(s.x0), y0: ty(s.y0), x1: tx(s.x1), y1: ty(s.y1) };
  if (s.t === 'stamp') return { ...s, x: tx(s.x), y: ty(s.y), s: s.s * k };
  if (s.t === 'mask') return { ...s, x: tx(s.x), y: ty(s.y), w: s.w * k, h: s.h * k };
  return { ...s, s: s.s * k, p: s.p.map((p) => [+tx(p[0]).toFixed(5), +ty(p[1]).toFixed(5), p[2]]) };
}

export function itemHit(s, x, y, r, W, H) {
  if (s.t === 'passage') return false;
  if (s.t === 'stamp' && s.k === 'txt') { const b = itemBounds(s); return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r; }
  if (s.t === 'stamp') { const d = Math.hypot((s.x - x) * W, (s.y - y) * H); return d < Math.max(r * W, s.s * W); }
  if (s.t === 'mask') return x >= s.x - r && x <= s.x + s.w + r && y >= s.y - r && y <= s.y + s.h + r;
  const rr = r + (s.s || 0) / 2;
  return s.p.some((p) => Math.hypot((p[0] - x) * W, (p[1] - y) * H) < rr * W);
}

// ---------- smart eraser for the printed score ----------
// Erases printed marks under a scribble (slurs and ties, dynamics, fingerings, marks in the score).
// It never paints over staff lines, stems, barlines or noteheads. A mark that crosses a staff line
// or a stem is followed through it, so the whole slur goes, and the line itself is left as it was.

// Pixels of long straight runs in one direction (staff lines, stems, barlines).
function markLongRuns(ink, W, H, minLen, horizontal, mark) {
  const outer = horizontal ? H : W, inner = horizontal ? W : H;
  for (let a = 0; a < outer; a++) {
    let start = -1;
    for (let b = 0; b <= inner; b++) {
      const on = b < inner && ink[horizontal ? a * W + b : b * W + a];
      if (on && start < 0) start = b;
      if (!on && start >= 0) {
        if (b - start >= minLen) for (let k = start; k < b; k++) mark[horizontal ? a * W + k : k * W + a] = 1;
        start = -1;
      }
    }
  }
}
// Grows a mask by r pixels in every direction.
function grow(src, W, H, r) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!src[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1;
    }
  }
  return out;
}
// Distance from each ink pixel to the nearest paper pixel (chamfer 3-4): thick shapes have large values.
function thickness(ink, W, H) {
  const INF = 1e9, d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = ink[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - W] + 3); if (x > 0) v = Math.min(v, d[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!d[i]) continue;
    let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (x > 0) v = Math.min(v, d[i + W - 1] + 4); }
    d[i] = v;
  }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}
// Staff spacing in pixels, from the staff lines (median gap between neighbouring lines).
function staffSpace(staffCore, W, H) {
  const rows = [];
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) n += staffCore[y * W + x]; if (n > W * 0.05) rows.push(y); }
  const centres = []; let run = [];
  for (const y of rows) { if (run.length && y - run[run.length - 1] > 1) { centres.push(run.reduce((a, b) => a + b) / run.length); run = []; } run.push(y); }
  if (run.length) centres.push(run.reduce((a, b) => a + b) / run.length);
  const gaps = [];
  for (let i = 1; i < centres.length; i++) { const g = centres[i] - centres[i - 1]; if (g >= 3 && g <= H * 0.2) gaps.push(g); }
  if (!gaps.length) return 16;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

export function smartMask(art, stroke) {
  const W = art.width, H = art.height, N = W * H;
  const img = art.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const o = i * 4; ink[i] = img[o] + img[o + 1] + img[o + 2] < 3 * 170 ? 1 : 0; }

  // 1) the score's own lines: staff lines and stems/barlines. Their core pixels are never painted.
  const staffCore = new Uint8Array(N), stemCore = new Uint8Array(N);
  markLongRuns(ink, W, H, Math.round(W * 0.08), true, staffCore);
  const G = staffSpace(staffCore, W, H);
  markLongRuns(ink, W, H, Math.max(10, Math.round(G * 0.8)), false, stemCore);
  const lineCore = grow(staffCore.map((v, i) => v | stemCore[i]), W, H, 1);

  // 2) solid shapes: noteheads, clefs, heavy marks. Thin slurs are far thinner than a notehead.
  const dt = thickness(ink, W, H);
  const thick = new Uint8Array(N);
  for (let i = 0; i < N; i++) thick[i] = dt[i] >= Math.max(2.2, G * 0.16) ? 1 : 0;
  const solid = grow(thick, W, H, 2);
  const nearSolid = grow(thick, W, H, 3);

  // 3) pixels the eraser may take: printed ink that is not a score line and not next to a solid shape.
  //    A line pixel is only used to cross from one side of a mark to the other.
  const free = new Uint8Array(N), crossing = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!ink[i] || nearSolid[i]) continue;
    if (lineCore[i]) crossing[i] = 1; else free[i] = 1;
  }
  // a line pixel joins the search only if printed ink lies on both sides of it, across the line
  // (above and below a staff line, left and right of a stem); the slope of the mark does not matter
  const usable = new Uint8Array(N);
  const anyFree = (x0, x1, y0, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) if (free[y * W + x]) return true;
    return false;
  };
  for (let i = 0; i < N; i++) {
    if (free[i]) { usable[i] = 1; continue; }
    if (!crossing[i]) continue;
    const x = i % W, y = (i / W) | 0;
    const acrossLine = staffCore[i] && anyFree(x - 2, x + 2, y - 7, y - 1) && anyFree(x - 2, x + 2, y + 1, y + 7);
    const acrossStem = stemCore[i] && anyFree(x - 7, x - 1, y - 2, y + 2) && anyFree(x + 1, x + 7, y - 2, y + 2);
    if (acrossLine || acrossStem) usable[i] = 1;
  }

  // 4) seeds: the scribble, snapped to the nearest printed pixel within a few px
  const seen = new Uint8Array(N);
  const maxPx = N * 0.01, maxW = W * 0.6, maxH = H * 0.25;
  const accepted = [];
  let rejected = 0;
  for (let i = 0; i < stroke.length; i++) {
    const [px, py] = stroke[i];
    const steps = i ? Math.ceil(Math.hypot((px - stroke[i - 1][0]) * W, (py - stroke[i - 1][1]) * H) / 2) : 1;
    for (let k = 0; k < steps; k++) {
      const t = steps === 1 ? 1 : k / steps;
      const sx = Math.round((i ? stroke[i - 1][0] + (px - stroke[i - 1][0]) * t : px) * W);
      const sy = Math.round((i ? stroke[i - 1][1] + (py - stroke[i - 1][1]) * t : py) * H);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      let s0 = -1, bd = 5;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const nx = sx + dx, ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx, d = Math.hypot(dx, dy);
        if (free[n] && d < bd) { bd = d; s0 = n; }
      }
      if (s0 < 0) {
        // the scribble is on a note or a line only: nothing is erased there
        if (ink[sy * W + sx] && (thick[sy * W + sx] || lineCore[sy * W + sx])) rejected++;
        continue;
      }
      if (seen[s0]) continue;
      // 5) follow the printed mark through its neighbours, across lines where it crosses them
      const stack = [s0]; const comp = []; seen[s0] = 1;
      let x0 = s0 % W, x1 = x0, y0 = (s0 / W) | 0, y1 = y0, ok = true;
      while (stack.length) {
        const j = stack.pop(); comp.push(j);
        const x = j % W, y = (j / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x1 - x0 > maxW || y1 - y0 > maxH || comp.length > maxPx) { ok = false; break; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (!seen[n] && usable[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      if (!ok) { rejected++; continue; }
      accepted.push({ comp, x0, y0, x1, y1 });
    }
  }
  if (!accepted.length) return { item: null, rejected };

  // 6) paint: only the marks found, never a score line, a solid shape, or ink next to one
  const mark = new Uint8Array(N);
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (const a of accepted) {
    for (const j of a.comp) mark[j] = 1;
    if (a.x0 < bx0) bx0 = a.x0; if (a.y0 < by0) by0 = a.y0; if (a.x1 > bx1) bx1 = a.x1; if (a.y1 > by1) by1 = a.y1;
  }
  const pad = 3;
  const px0 = Math.max(0, bx0 - pad), py0 = Math.max(0, by0 - pad), px1 = Math.min(W - 1, bx1 + pad), py1 = Math.min(H - 1, by1 + pad);
  const mw = px1 - px0 + 1, mh = py1 - py0 + 1;
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  const mg = mc.getContext('2d');
  const md = mg.createImageData(mw, mh);
  const paintable = (j) => !lineCore[j] && !nearSolid[j];
  let count = 0;
  for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
    const j = y * W + x;
    if (!paintable(j)) continue;
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2 && !hit; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (mark[ny * W + nx]) hit = true;
    }
    if (!hit) continue;
    md.data[((y - py0) * mw + (x - px0)) * 4 + 3] = 255; count++;
  }
  mg.putImageData(md, 0, 0);
  if (!count) return { item: null, rejected };
  return { item: { t: 'mask', x: px0 / W, y: py0 / H, w: mw / W, h: mh / H, d: mc.toDataURL('image/png') }, rejected, count: accepted.length };
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
  // Erases like a real eraser: the part of a pen or highlighter stroke under the eraser goes,
  // the rest of the stroke stays. Symbols, words and whiteouts go as a whole.
  eraseAt(x, y, r) {
    const W = this.canvas.width, H = this.canvas.height;
    let changed = false;
    const out = [];
    for (const s of this.items) {
      if (!itemHit(s, x, y, r, W, H)) { out.push(s); continue; }
      changed = true;
      if (!s.p || s.p.length < 2) continue;
      for (const part of cutStroke(s.p, x, y, r + (s.s || 0) * 0.35, W, H)) out.push({ ...s, p: part });
    }
    if (changed) { this.items = out; this.redraw(); this.save(); }
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
