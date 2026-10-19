// Design elements for notebooks: leaves, line doodles, sparkles, frames, labels, arrows, dividers,
// boho shapes, paint strokes and music. Each is drawn into a 100 × 100 box (or the box given by vb)
// with a "fill" part and a "line" part, so one colour, a gradient (gold!) and an outline all work.
const P = () => new Path2D();
const leaf = (p, x, y, len, ang, wid = 0.36) => {
  // a pointed leaf from (x, y) along angle ang
  const c = Math.cos(ang), s = Math.sin(ang), n = [-s, c];
  const tx = x + c * len, ty = y + s * len, w = len * wid;
  const m1 = [x + c * len * 0.45 + n[0] * w, y + s * len * 0.45 + n[1] * w];
  const m2 = [x + c * len * 0.45 - n[0] * w, y + s * len * 0.45 - n[1] * w];
  p.moveTo(x, y); p.quadraticCurveTo(m1[0], m1[1], tx, ty); p.quadraticCurveTo(m2[0], m2[1], x, y); p.closePath();
};
const sparkle = (p, cx, cy, r) => {
  p.moveTo(cx, cy - r);
  p.quadraticCurveTo(cx + r * 0.12, cy - r * 0.12, cx + r, cy); p.quadraticCurveTo(cx + r * 0.12, cy + r * 0.12, cx, cy + r);
  p.quadraticCurveTo(cx - r * 0.12, cy + r * 0.12, cx - r, cy); p.quadraticCurveTo(cx - r * 0.12, cy - r * 0.12, cx, cy - r); p.closePath();
};
const circle = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); };
// a little pseudo-random, the same every time (so a paint stroke does not change on redraw)
const rnd = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export const ELEMENT_CATS = [['nature', 'Leaves & flowers'], ['doodle', 'Line doodles'], ['sparkle', 'Sparkles'], ['frame', 'Frames'], ['label', 'Labels & bubbles'], ['arrow', 'Arrows'], ['divider', 'Dividers'], ['boho', 'Boho'], ['paint', 'Paint & shapes'], ['music', 'Music']];

export const ELEMENTS = [
  // ---- leaves & flowers ----
  { k: 'sprig', cat: 'nature', label: 'Sprig', vb: [60, 100], line(p) { p.moveTo(30, 98); p.bezierCurveTo(29, 70, 31, 40, 30, 8); }, fill(p) {
    for (const [y, l, a] of [[84, 24, 0.5], [66, 22, 0.55], [48, 19, 0.6], [31, 15, 0.65]]) { leaf(p, 30, y, l, -Math.PI / 2 - a * 1.6); leaf(p, 30, y, l, -Math.PI / 2 + a * 1.6); }
    leaf(p, 30, 12, 11, -Math.PI / 2, 0.42);
  } },
  { k: 'branch', cat: 'nature', label: 'Branch', vb: [100, 60], line(p) { p.moveTo(4, 52); p.bezierCurveTo(30, 40, 60, 28, 96, 10); }, fill(p) {
    for (let i = 0; i < 6; i++) { const t = 0.12 + i * 0.15, x = 4 + t * 92, y = 52 - t * 42 - Math.sin(t * Math.PI) * 4; leaf(p, x, y, 15 - i, -Math.PI / 2 - 0.5 + (i % 2 ? 0 : 0.2), 0.38); leaf(p, x + 3, y + 1, 14 - i, 0.25 + (i % 2) * 0.2, 0.38); }
  } },
  { k: 'leaf', cat: 'nature', label: 'Leaf', vb: [70, 100], fill(p) { p.moveTo(35, 98); p.bezierCurveTo(4, 76, 2, 34, 35, 3); p.bezierCurveTo(68, 34, 66, 76, 35, 98); p.closePath(); }, cut(p) {
    p.moveTo(35, 92); p.lineTo(35, 12); for (const y of [74, 56, 38]) { p.moveTo(35, y); p.lineTo(20, y - 13); p.moveTo(35, y); p.lineTo(50, y - 13); }
  } },
  { k: 'flower', cat: 'nature', label: 'Flower', line(p) {
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; p.moveTo(50, 50); p.ellipse(50 + Math.cos(a) * 24, 50 + Math.sin(a) * 24, 22, 12, a, Math.PI, Math.PI * 3); }
  }, fill(p) { circle(p, 50, 50, 10); } },
  { k: 'daisy', cat: 'nature', label: 'Daisy', fill(p) {
    for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; p.moveTo(50, 50); p.ellipse(50 + Math.cos(a) * 28, 50 + Math.sin(a) * 28, 20, 7, a, 0, Math.PI * 2); }
  }, cut(p) { circle(p, 50, 50, 13); } },
  { k: 'tulip', cat: 'nature', label: 'Tulip', vb: [60, 100], line(p) { p.moveTo(30, 98); p.lineTo(30, 46); }, fill(p) {
    p.moveTo(14, 18); p.lineTo(22, 28); p.lineTo(30, 14); p.lineTo(38, 28); p.lineTo(46, 18); p.bezierCurveTo(50, 40, 44, 50, 30, 50); p.bezierCurveTo(16, 50, 10, 40, 14, 18); p.closePath();
    leaf(p, 30, 88, 26, -Math.PI / 2 - 0.7, 0.3); leaf(p, 30, 80, 22, -Math.PI / 2 + 0.75, 0.3);
  } },
  // ---- line doodles ----
  { k: 'squiggle', cat: 'doodle', label: 'Squiggle', vb: [100, 30], line(p) { p.moveTo(3, 15); for (let i = 0; i < 6; i++) p.bezierCurveTo(8 + i * 16, 2, 12 + i * 16, 2, 19 + i * 16, 15), p.bezierCurveTo(24 + i * 16, 28, 26 + i * 16, 28, 27 + i * 16, 15); } },
  { k: 'heartline', cat: 'doodle', label: 'Heart', line(p) { p.moveTo(50, 86); p.bezierCurveTo(10, 58, 4, 26, 26, 18); p.bezierCurveTo(40, 13, 48, 24, 50, 32); p.bezierCurveTo(52, 24, 60, 13, 74, 18); p.bezierCurveTo(96, 26, 90, 58, 50, 86); p.moveTo(57, 82); p.bezierCurveTo(70, 90, 80, 94, 94, 92); } },
  { k: 'swirl', cat: 'doodle', label: 'Swirl', line(p) { let a = 0; p.moveTo(50, 50); for (let i = 1; i <= 90; i++) { a = i * 0.21; const r = i * 0.48; p.lineTo(50 + Math.cos(a) * r, 50 + Math.sin(a) * r); } } },
  { k: 'loops', cat: 'doodle', label: 'Loops', vb: [100, 34], line(p) { p.moveTo(3, 26); for (let i = 0; i < 5; i++) { const x = 8 + i * 19; p.bezierCurveTo(x + 10, 26, x + 16, 6, x + 9, 4); p.bezierCurveTo(x + 2, 4, x + 2, 26, x + 19, 26); } } },
  { k: 'zigzag', cat: 'doodle', label: 'Zigzag', vb: [100, 24], line(p) { p.moveTo(3, 18); for (let i = 0; i < 10; i++) p.lineTo(8 + i * 9.6, i % 2 ? 18 : 5); } },
  { k: 'underline', cat: 'doodle', label: 'Swoosh', vb: [100, 26], fill(p) { p.moveTo(2, 18); p.bezierCurveTo(30, 8, 70, 4, 98, 9); p.bezierCurveTo(70, 9, 36, 14, 6, 23); p.quadraticCurveTo(0, 22, 2, 18); p.closePath(); } },
  // ---- sparkles ----
  { k: 'sparkle', cat: 'sparkle', label: 'Sparkle', fill(p) { sparkle(p, 50, 50, 48); } },
  { k: 'sparkles', cat: 'sparkle', label: 'Sparkles', fill(p) { sparkle(p, 40, 56, 38); sparkle(p, 80, 20, 17); sparkle(p, 84, 78, 11); } },
  { k: 'star4', cat: 'sparkle', label: 'Twinkle', line(p) { for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; p.moveTo(50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12); p.lineTo(50 + Math.cos(a) * (i % 2 ? 30 : 46), 50 + Math.sin(a) * (i % 2 ? 30 : 46)); p.moveTo(50 - Math.cos(a) * 12, 50 - Math.sin(a) * 12); p.lineTo(50 - Math.cos(a) * (i % 2 ? 30 : 46), 50 - Math.sin(a) * (i % 2 ? 30 : 46)); } } },
  { k: 'dots', cat: 'sparkle', label: 'Confetti', fill(p) { const r = rnd(7); for (let i = 0; i < 26; i++) circle(p, 6 + r() * 88, 6 + r() * 88, 1.5 + r() * 3.2); } },
  // ---- frames ----
  { k: 'archframe', cat: 'frame', label: 'Arch frame', vb: [70, 100], line(p) { p.moveTo(3, 97); p.lineTo(3, 35); p.arc(35, 35, 32, Math.PI, 0); p.lineTo(67, 97); p.closePath(); p.moveTo(9, 91); p.lineTo(9, 35); p.arc(35, 35, 26, Math.PI, 0); p.lineTo(61, 91); p.closePath(); } },
  { k: 'ring', cat: 'frame', label: 'Ring', line(p) { circle(p, 50, 50, 46); circle(p, 50, 50, 40); } },
  { k: 'border', cat: 'frame', label: 'Border', vb: [80, 100], line(p) { p.rect(3, 3, 74, 94); p.moveTo(14, 9); p.lineTo(66, 9); p.arc(66, 14, 5, -Math.PI / 2, 0); p.lineTo(71, 86); p.arc(66, 86, 5, 0, Math.PI / 2); p.lineTo(14, 91); p.arc(14, 86, 5, Math.PI / 2, Math.PI); p.lineTo(9, 14); p.arc(14, 14, 5, Math.PI, Math.PI * 1.5); } },
  { k: 'scallop', cat: 'frame', label: 'Scallop', line(p) { const n = 18; for (let i = 0; i < n; i++) { const a0 = (i * Math.PI * 2) / n, a1 = ((i + 1) * Math.PI * 2) / n, am = (a0 + a1) / 2; const x0 = 50 + Math.cos(a0) * 42, y0 = 50 + Math.sin(a0) * 42; if (!i) p.moveTo(x0, y0); p.quadraticCurveTo(50 + Math.cos(am) * 52, 50 + Math.sin(am) * 52, 50 + Math.cos(a1) * 42, 50 + Math.sin(a1) * 42); } p.closePath(); } },
  // ---- labels & bubbles ----
  { k: 'tag', cat: 'label', label: 'Tag', vb: [100, 40], fill(p) { p.moveTo(8, 2); p.lineTo(92, 2); p.lineTo(98, 20); p.lineTo(92, 38); p.lineTo(8, 38); p.lineTo(2, 20); p.closePath(); } },
  { k: 'badge', cat: 'label', label: 'Badge', fill(p) { const n = 24; for (let i = 0; i <= n * 2; i++) { const a = (i * Math.PI) / n, r = i % 2 ? 44 : 49; p[i ? 'lineTo' : 'moveTo'](50 + Math.cos(a) * r, 50 + Math.sin(a) * r); } p.closePath(); } },
  { k: 'ticket', cat: 'label', label: 'Ticket', vb: [100, 46], fill(p) { p.moveTo(2, 2); p.lineTo(98, 2); p.lineTo(98, 15); p.arc(98, 23, 8, -Math.PI / 2, Math.PI / 2, true); p.lineTo(98, 44); p.lineTo(2, 44); p.lineTo(2, 31); p.arc(2, 23, 8, Math.PI / 2, -Math.PI / 2, true); p.closePath(); } },
  { k: 'speech', cat: 'label', label: 'Bubble', vb: [100, 80], line(p) { p.moveTo(30, 62); p.bezierCurveTo(6, 58, 2, 36, 8, 24); p.bezierCurveTo(18, 2, 82, 2, 92, 24); p.bezierCurveTo(100, 44, 84, 62, 50, 62); p.lineTo(24, 78); p.closePath(); } },
  { k: 'quote', cat: 'label', label: 'Quote marks', vb: [100, 60], fill(p) { for (const x of [8, 56]) { circle(p, x + 16, 40, 15); p.moveTo(x + 2, 40); p.bezierCurveTo(x + 2, 18, x + 14, 6, x + 30, 4); p.lineTo(x + 31, 10); p.bezierCurveTo(x + 18, 14, x + 12, 24, x + 14, 32); p.closePath(); } } },
  // ---- arrows ----
  { k: 'arrowcurve', cat: 'arrow', label: 'Curved', vb: [100, 60], line(p) { p.moveTo(6, 52); p.bezierCurveTo(24, 10, 64, 4, 92, 22); p.moveTo(76, 10); p.lineTo(93, 23); p.lineTo(74, 30); } },
  { k: 'arrowloop', cat: 'arrow', label: 'Loop', vb: [100, 60], line(p) { p.moveTo(4, 46); p.bezierCurveTo(28, 50, 44, 40, 46, 26); p.bezierCurveTo(48, 10, 30, 10, 32, 24); p.bezierCurveTo(34, 40, 60, 46, 94, 36); p.moveTo(80, 26); p.lineTo(95, 36); p.lineTo(81, 46); } },
  { k: 'arrowhand', cat: 'arrow', label: 'Sketch', vb: [100, 30], line(p) { p.moveTo(4, 17); p.bezierCurveTo(30, 13, 60, 18, 94, 14); p.moveTo(80, 4); p.lineTo(95, 14); p.lineTo(81, 26); } },
  { k: 'arrowdown', cat: 'arrow', label: 'Down', vb: [50, 100], line(p) { p.moveTo(24, 4); p.bezierCurveTo(40, 30, 6, 56, 25, 94); p.moveTo(12, 80); p.lineTo(25, 95); p.lineTo(38, 82); } },
  // ---- dividers ----
  { k: 'divdots', cat: 'divider', label: 'Dots', vb: [100, 12], fill(p) { for (let i = 0; i < 21; i++) { const x = 3 + i * 4.7; if (Math.abs(x - 50) < 6) continue; circle(p, x, 6, 1.1); } p.moveTo(50, 1); p.lineTo(55, 6); p.lineTo(50, 11); p.lineTo(45, 6); p.closePath(); } },
  { k: 'divwave', cat: 'divider', label: 'Wave', vb: [100, 14], line(p) { p.moveTo(2, 7); for (let i = 0; i < 8; i++) p.quadraticCurveTo(8 + i * 12, i % 2 ? 13 : 1, 14 + i * 12, 7); } },
  { k: 'divleaf', cat: 'divider', label: 'Leaves', vb: [100, 16], line(p) { p.moveTo(2, 8); p.lineTo(40, 8); p.moveTo(60, 8); p.lineTo(98, 8); }, fill(p) { leaf(p, 50, 8, 11, Math.PI + 0.35, 0.4); leaf(p, 50, 8, 11, -0.35, 0.4); circle(p, 50, 8, 1.8); } },
  { k: 'divline', cat: 'divider', label: 'Elegant', vb: [100, 12], line(p) { p.moveTo(2, 6); p.lineTo(42, 6); p.moveTo(58, 6); p.lineTo(98, 6); p.moveTo(50, 1); p.lineTo(55, 6); p.lineTo(50, 11); p.lineTo(45, 6); p.closePath(); } },
  // ---- boho ----
  { k: 'sun', cat: 'boho', label: 'Sun', fill(p) { circle(p, 50, 50, 17); }, line(p) { for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; p.moveTo(50 + Math.cos(a) * 26, 50 + Math.sin(a) * 26); p.lineTo(50 + Math.cos(a) * (i % 2 ? 38 : 46), 50 + Math.sin(a) * (i % 2 ? 38 : 46)); } } },
  { k: 'moon', cat: 'boho', label: 'Moon', fill(p) { p.moveTo(62, 6); p.arc(50, 50, 45, -1.3, 1.3, true); p.bezierCurveTo(30, 82, 22, 30, 62, 6); p.closePath(); } },
  { k: 'rainbow', cat: 'boho', label: 'Rainbow', vb: [100, 56], line(p) { for (const r of [46, 36, 26]) { p.moveTo(50 - r, 54); p.arc(50, 54, r, Math.PI, 0); } } },
  { k: 'archbow', cat: 'boho', label: 'Arches', vb: [100, 56], fill(p) { for (const [r, r2] of [[48, 40], [32, 24]]) { p.moveTo(50 - r, 54); p.arc(50, 54, r, Math.PI, 0); p.lineTo(50 + r2, 54); p.arc(50, 54, r2, 0, Math.PI, true); p.closePath(); } circle(p, 50, 54, 9); } },
  { k: 'eye', cat: 'boho', label: 'Eye', vb: [100, 60], line(p) { p.moveTo(4, 32); p.quadraticCurveTo(50, -8, 96, 32); p.quadraticCurveTo(50, 72, 4, 32); for (let i = 0; i < 5; i++) { const a = Math.PI + 0.45 + i * 0.56; p.moveTo(50 + Math.cos(a) * 30, 38 + Math.sin(a) * 30); p.lineTo(50 + Math.cos(a) * 38, 38 + Math.sin(a) * 38); } }, fill(p) { circle(p, 50, 32, 10); } },
  // ---- paint & shapes ----
  { k: 'brush', cat: 'paint', label: 'Paint stroke', vb: [100, 34], fill(p) {
    // overlapping bristle streaks with dry, uneven ends
    const r = rnd(11);
    for (let i = 0; i < 9; i++) {
      const y = 4 + i * 3.1, hh = 3.4 + r() * 1.6, x0 = 2 + r() * 7 + (i % 3 === 0 ? 4 : 0), x1 = 90 + r() * 8 - (i % 4 === 1 ? 6 : 0);
      p.moveTo(x0 + hh / 2, y); p.lineTo(x1 - hh / 2, y + (r() - 0.5) * 0.8); p.arc(x1 - hh / 2, y + hh / 2, hh / 2, -Math.PI / 2, Math.PI / 2); p.lineTo(x0 + hh / 2, y + hh); p.arc(x0 + hh / 2, y + hh / 2, hh / 2, Math.PI / 2, Math.PI * 1.5); p.closePath();
    }
  } },
  { k: 'blob2', cat: 'paint', label: 'Pebble', vb: [100, 80], fill(p) { p.moveTo(30, 6); p.bezierCurveTo(60, -4, 98, 10, 96, 40); p.bezierCurveTo(94, 70, 60, 80, 34, 74); p.bezierCurveTo(6, 68, 0, 46, 6, 30); p.bezierCurveTo(10, 16, 18, 10, 30, 6); p.closePath(); } },
  { k: 'blob3', cat: 'paint', label: 'Wave split', vb: [100, 100], fill(p) { p.moveTo(0, 100); p.lineTo(0, 62); p.bezierCurveTo(14, 54, 20, 70, 30, 58); p.bezierCurveTo(40, 46, 36, 30, 52, 32); p.bezierCurveTo(66, 34, 64, 18, 76, 14); p.bezierCurveTo(86, 10, 92, 2, 100, 0); p.lineTo(100, 100); p.closePath(); } },
  { k: 'halfcircle', cat: 'paint', label: 'Half circle', vb: [100, 50], fill(p) { p.moveTo(2, 48); p.arc(50, 48, 48, Math.PI, 0); p.closePath(); } },
  { k: 'grid', cat: 'paint', label: 'Window light', line(p) { p.rect(6, 6, 88, 88); p.moveTo(50, 6); p.lineTo(50, 94); p.moveTo(6, 50); p.lineTo(94, 50); } },
  // ---- music ----
  { k: 'quavers', cat: 'music', label: 'Two notes', vb: [80, 100], fill(p) {
    p.ellipse(20, 82, 13, 9, -0.4, 0, Math.PI * 2); p.moveTo(76, 72); p.ellipse(64, 72, 13, 9, -0.4, 0, Math.PI * 2);
    p.rect(29.5, 14, 4, 66); p.rect(73.5, 4, 4, 66); p.moveTo(29.5, 14); p.lineTo(77.5, 4); p.lineTo(77.5, 16); p.lineTo(29.5, 26); p.closePath();
  } },
  { k: 'staff', cat: 'music', label: 'Staff', vb: [100, 30], line(p) { for (let i = 0; i < 5; i++) { p.moveTo(2, 5 + i * 5); p.lineTo(98, 5 + i * 5); } } },
  { k: 'notewave', cat: 'music', label: 'Melody', vb: [100, 40], line(p) { p.moveTo(2, 30); p.bezierCurveTo(20, 4, 36, 4, 50, 22); p.bezierCurveTo(64, 40, 80, 36, 98, 12); }, fill(p) { for (const [x, y] of [[14, 14], [44, 14], [70, 32]]) { p.moveTo(x + 6, y); p.ellipse(x, y, 6, 4.2, -0.4, 0, Math.PI * 2); } } },
];
export const ELEMENT_BY_KEY = Object.fromEntries(ELEMENTS.map((e) => [e.k, e]));

const cache = new Map();
function paths(e) {
  let c = cache.get(e.k);
  if (!c) {
    c = {};
    for (const part of ['fill', 'line', 'cut']) if (e[part]) { const p = P(); e[part](p); c[part] = p; }
    cache.set(e.k, c);
  }
  return c;
}
// an element's own shape (width ÷ height)
export const elementAspect = (k) => { const e = ELEMENT_BY_KEY[k]; return e && e.vb ? e.vb[0] / e.vb[1] : 1; };
const scaled = (src, w, h, vb) => { const p = P(); p.addPath(src, new DOMMatrix([w / vb[0], 0, 0, h / vb[1], -w / 2, -h / 2])); return p; };
// Draw an element centred at 0, 0 in a w × h box. paint: the fill style (a colour or gradient).
export function drawElement(ctx, k, w, h, paint, lineW, outline, shadow) {
  const e = ELEMENT_BY_KEY[k]; if (!e) return;
  const vb = e.vb || [100, 100], c = paths(e);
  const lw = lineW || Math.max(1, Math.min(w, h) * (e.vb && Math.min(...e.vb) < 40 ? 0.12 : 0.035));
  if (shadow) { ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = Math.min(w, h) * 0.06; ctx.shadowOffsetY = Math.min(w, h) * 0.02; }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (c.fill) {
    const f = scaled(c.fill, w, h, vb);
    ctx.fillStyle = paint; ctx.fill(f);
    if (c.cut) {
      // the leaf's veins and the daisy's middle, drawn over the fill
      ctx.save(); ctx.shadowColor = 'transparent';
      if (k === 'daisy') { ctx.fillStyle = '#e8b33c'; ctx.fill(scaled(c.cut, w, h, vb)); }
      else { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = lw * 0.45; ctx.stroke(scaled(c.cut, w, h, vb)); }
      ctx.restore();
    }
    if (outline) { ctx.save(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = outline; ctx.lineWidth = lw * 0.7; ctx.stroke(f); ctx.restore(); }
  }
  if (c.line) { ctx.strokeStyle = paint; ctx.lineWidth = lw; ctx.stroke(scaled(c.line, w, h, vb)); }
}
