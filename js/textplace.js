// Where typed words go. They start exactly where you tapped. Only if that spot sits on the printed
// notes or staff lines do they move, to the nearest clear place, and if there is none they get a
// paper box behind them so they stay readable.
import { textFont } from './ink.js';

const SAMPLE_W = 480;          // the page is sampled at this width; enough to see notes and lines
const grids = new WeakMap();   // score page canvas -> dark-pixel grid
let measurer = null;

function darkGrid(art) {
  const key = art.width + 'x' + art.height;
  const hit = grids.get(art);
  if (hit && hit.key === key) return hit;
  const w = SAMPLE_W, h = Math.max(1, Math.round(art.height * w / art.width));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(art, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = i * 4;
    dark[i] = d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11 < 150 ? 1 : 0;
  }
  const out = { w, h, dark, key };
  grids.set(art, out);
  return out;
}

// Share of the box (page pixels) that is printed ink.
function inkShare(grid, W, H, x0, y0, x1, y1) {
  const sx = grid.w / W, sy = grid.h / H;
  const X0 = Math.max(0, Math.floor(x0 * sx)), X1 = Math.min(grid.w - 1, Math.ceil(x1 * sx));
  const Y0 = Math.max(0, Math.floor(y0 * sy)), Y1 = Math.min(grid.h - 1, Math.ceil(y1 * sy));
  let n = 0, d = 0;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { n++; d += grid.dark[y * grid.w + x]; }
  return n ? d / n : 0;
}

function measure(text, bold, size) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  measurer.font = textFont(100, bold);
  return (measurer.measureText(text).width / 100) * size;
}

// item: a words item with x, y as fractions of the page. Returns the item, moved or boxed if needed.
export function placeWords(art, item) {
  if (!art || !art.getContext || !item.txt) return item;
  const W = art.width, H = art.height;
  const grid = darkGrid(art);
  const size = item.s * W;
  const width = measure(item.txt, item.b, size);
  const pad = size * 0.14;
  const left = item.x * W - (item.al === 'l' ? 0 : width / 2);
  const top = item.y * H - size * 0.55, bottom = item.y * H + size * 0.55;

  // candidates: the tapped spot first, then nearby spots up and down, closest first
  const step = size * 0.3;
  const cands = [];
  for (let k = 0; k <= 12; k++) {
    for (const sign of k ? [1, -1] : [1]) {
      for (const dx of [0, size * 0.6, -size * 0.6]) cands.push({ dx, dy: sign * k * step });
    }
  }
  cands.sort((a, b) => (Math.abs(a.dy) + Math.abs(a.dx) * 0.5) - (Math.abs(b.dy) + Math.abs(b.dx) * 0.5));

  for (const c of cands) {
    const x0 = left + c.dx - pad, x1 = left + c.dx + width + pad;
    const y0 = top + c.dy, y1 = bottom + c.dy;
    if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) continue;
    if (inkShare(grid, W, H, x0, y0, x1, y1) < 0.01) {
      if (c.dx === 0 && c.dy === 0) return item;
      return { ...item, x: +((item.x * W + c.dx) / W).toFixed(4), y: +((item.y * H + c.dy) / H).toFixed(4) };
    }
  }
  return { ...item, bg: 1 };   // nowhere clear: a paper box keeps the words readable
}
