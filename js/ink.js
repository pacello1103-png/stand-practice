// Apple Pencil markings: smooth variable-width strokes (perfect-freehand), highlighter,
// music stamps in the Bravura font, stroke eraser. Each page has a committed canvas and a
// live canvas, so drawing never redraws the whole page and the next stroke can start at once.
import { getStroke } from '../vendor/perfect-freehand.mjs';
import { db } from './db.js';

export const COLORS = ['#16181d', '#5b616e', '#d12f2f', '#ea7a17', '#e6b800', '#2f9e55', '#0f8f8f', '#2b6fd6', '#1f3a8f', '#7b3fc4', '#d23c8f', '#7a4b2a'];

// SMuFL code points (Bravura)
const G = { p: '', m: '', f: '', s: '', z: '', r: '' };
export const STAMPS = [
  { k: 'pp', label: G.p + G.p, font: 'music' }, { k: 'p', label: G.p, font: 'music' }, { k: 'mp', label: G.m + G.p, font: 'music' },
  { k: 'mf', label: G.m + G.f, font: 'music' }, { k: 'f', label: G.f, font: 'music' }, { k: 'ff', label: G.f + G.f, font: 'music' },
  { k: 'sfz', label: G.s + G.f + G.z, font: 'music' }, { k: 'fp', label: G.f + G.p, font: 'music' },
  { k: 'cresc', label: 'cresc', font: 'shape' }, { k: 'dim', label: 'dim', font: 'shape' },
  { k: 'down', label: '', font: 'music' }, { k: 'up', label: '', font: 'music' },
  { k: 'fermata', label: '', font: 'music' }, { k: 'breath', label: '', font: 'music' }, { k: 'caesura', label: '', font: 'music' },
  { k: 'accent', label: '', font: 'music' }, { k: 'tenuto', label: '', font: 'music' }, { k: 'harm', label: '', font: 'music' },
  { k: '0', label: '0', font: 'finger' }, { k: '1', label: '1', font: 'finger' }, { k: '2', label: '2', font: 'finger' }, { k: '3', label: '3', font: 'finger' }, { k: '4', label: '4', font: 'finger' },
  { k: 'glasses', label: '👓', font: 'emoji' }, { k: 'circle', label: '○', font: 'shape' }, { k: 'box', label: '▢', font: 'shape' },
];
const STAMP_BY_KEY = Object.fromEntries(STAMPS.map((s) => [s.k, s]));

let fontReady = null;
export function loadMusicFont() {
  if (!fontReady) fontReady = document.fonts ? document.fonts.load('40px Bravura').catch(() => {}) : Promise.resolve();
  return fontReady;
}

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

export function drawItem(ctx, s, W, H, live) {
  ctx.save();
  if (s.t === 'stamp') { drawStamp(ctx, s, W, H); ctx.restore(); return; }
  const pts = s.p.map((p) => [p[0] * W, p[1] * H, p[2] ?? 0.5]);
  if (!pts.length) { ctx.restore(); return; }
  const size = Math.max(1, s.s * W);
  const hasPressure = s.t === 'pen' && pts.some((p) => Math.abs(p[2] - 0.5) > 0.01);
  const outline = getStroke(pts, {
    size,
    thinning: s.t === 'hl' ? 0 : hasPressure ? 0.62 : 0.35,
    smoothing: 0.55,
    streamline: s.t === 'hl' ? 0.6 : 0.32,
    simulatePressure: s.t === 'pen' && !hasPressure,
    start: { cap: true }, end: { cap: true },
    last: !live,
  });
  ctx.fillStyle = s.c;
  ctx.globalAlpha = s.a ?? 1;
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

export function itemHit(s, x, y, r, W, H) {
  if (s.t === 'stamp') { const d = Math.hypot((s.x - x) * W, (s.y - y) * H); return d < Math.max(r * W, s.s * W); }
  const rr = (r + (s.s || 0) / 2) ;
  return s.p.some((p) => Math.hypot((p[0] - x) * W, (p[1] - y) * H) < rr * W);
}

export class InkLayer {
  constructor(ink, live, scoreId, page) {
    this.canvas = ink; this.live = live; this.scoreId = scoreId; this.page = page;
    this.items = []; this.key = scoreId + ':' + page;
    this._saveT = 0;
  }
  async load() {
    const rec = await db.get('ink', this.key).catch(() => null);
    this.items = rec ? (rec.items || rec.strokes || []).map(normalise) : [];
    if (this.items.some((s) => s.t === 'stamp')) await loadMusicFont();
    this.redraw();
  }
  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => db.put('ink', { key: this.key, items: this.items }).catch(() => {}), 400);
  }
  redraw() {
    const c = this.canvas, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of this.items) drawItem(ctx, s, c.width, c.height, false);
  }
  // Fast path: paint only the newly finished item onto the committed canvas.
  commit(item) {
    this.items.push(item);
    drawItem(this.canvas.getContext('2d'), item, this.canvas.width, this.canvas.height, false);
    this.clearLive();
    this.save();
  }
  drawLive(item, extra) {
    const c = this.live, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const it = extra && extra.length ? { ...item, p: item.p.concat(extra) } : item;
    drawItem(ctx, it, c.width, c.height, true);
  }
  clearLive() { const c = this.live; c.getContext('2d').clearRect(0, 0, c.width, c.height); }
  eraseAt(x, y, r) {
    const W = this.canvas.width, H = this.canvas.height;
    const before = this.items.length;
    this.items = this.items.filter((s) => !itemHit(s, x, y, r, W, H));
    if (this.items.length !== before) { this.redraw(); this.save(); return true; }
    return false;
  }
  setItems(items) { this.items = items; this.redraw(); this.save(); }
}
