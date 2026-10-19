// Photo covers for notebooks: each picture has its own way of carrying the title. On records the
// title runs around the paper label, on torn paper it sits in the tear, on the cassette it is
// written on the label strip, on lined paper it is handwritten on the lines.
// Positions are fractions of the cover (x of the width, y of the height; sizes of the width).

export const PHOTO_CATS = [['records', 'Records'], ['flowers', 'Flowers'], ['paint', 'Paint'], ['paper', 'Paper'], ['music', 'Music']];

const SCRIPT = '"Snell Roundhand", "Apple Chancery", "Zapfino", cursive';
const HAND = '"Bradley Hand", "Noteworthy", "Marker Felt", cursive';
const SERIF = '"Iowan Old Style", "Baskerville", "New York", Georgia, serif';
const DIDOT = '"Didot", "Bodoni 72", "Iowan Old Style", Georgia, serif';
const SANS = '"Avenir Next", -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = '"American Typewriter", "Courier New", monospace';

// geometry of the record labels (centre x, centre y, radius) measured on the photos
const REC = {
  '06': [-0.2016, 0.4601, 0.321], '16': [-0.1848, 0.4607, 0.3057], '17': [-0.0948, 0.461, 0.3098],
  '18': [-0.1642, 0.4581, 0.3211], '19': [-0.2447, 0.4573, 0.3639], '07': [0.4957, 1.0265, 0.2305],
};

export const COVER_PHOTOS = [
  { id: '06', cat: 'records', label: 'Plum record', t: { k: 'ring', font: SERIF, spacing: 0.45, color: 'rgba(255,255,255,.92)', size: 0.056, rf: 1.2 } },
  { id: '16', cat: 'records', label: 'Brown record', t: { k: 'ring', font: SERIF, spacing: 0.45, color: 'rgba(255,248,236,.92)', size: 0.056, rf: 1.2 } },
  { id: '19', cat: 'records', label: 'Red record', t: { k: 'ring', font: SCRIPT, spacing: 0.15, color: 'rgba(255,255,255,.92)', size: 0.095, rf: 1.17 } },
  { id: '17', cat: 'records', label: 'Blue record', t: { k: 'ring', font: SCRIPT, spacing: 0.12, color: 'rgba(255,255,255,.92)', size: 0.09, rf: 1.22 } },
  { id: '18', cat: 'records', label: 'Green record', t: { k: 'ring', font: SCRIPT, spacing: 0.12, color: 'rgba(255,255,255,.92)', size: 0.09, rf: 1.22 } },
  { id: '07', cat: 'records', label: 'Black record', t: { k: 'ringTop', font: SANS, weight: 700, spacing: 0.5, color: 'rgba(255,255,255,.9)', size: 0.045, rf: 1.17, label: '#f6ead8' } },
  { id: '20', cat: 'flowers', label: 'Pink petals', t: { k: 'text', x: 0.07, y: 0.585, align: 'left', font: DIDOT, color: '#7d1d2b', size: 0.085, sub: '#9b4a55', maxW: 0.4 } },
  { id: '27', cat: 'flowers', label: 'Blue petals', t: { k: 'text', x: 0.5, y: 0.975, align: 'center', font: DIDOT, color: '#22396e', size: 0.06, sub: '#4a5f8f', maxW: 0.86, subAbove: true } },
  { id: '28', cat: 'flowers', label: 'Anthurium', t: { k: 'text', x: 0.07, y: 0.86, align: 'left', font: DIDOT, color: '#2a5560', size: 0.08, sub: '#58808a', maxW: 0.42 } },
  { id: '29', cat: 'flowers', label: 'Poppies', t: { k: 'text', x: 0.5, y: 0.2, align: 'center', font: DIDOT, color: '#f6efe2', size: 0.085, sub: '#e3ddd2', maxW: 0.72 } },
  { id: '15', cat: 'flowers', label: 'Night flowers', t: { k: 'card', x: 0.5, y: 0.5, color: '#1f2a3a', font: SERIF } },
  { id: '25', cat: 'paint', label: 'Green brush', t: { k: 'text', x: 0.08, y: 0.9, align: 'left', font: DIDOT, color: '#f7f2e4', size: 0.08, sub: '#e4ead9', maxW: 0.6, shadow: true } },
  { id: '26', cat: 'paint', label: 'Red brush', t: { k: 'text', x: 0.08, y: 0.9, align: 'left', font: DIDOT, color: '#fbf3ea', size: 0.08, sub: '#f3dcd6', maxW: 0.6, shadow: true } },
  { id: '23', cat: 'paint', label: 'Ink wave', t: { k: 'text', x: 0.5, y: 0.2, align: 'center', font: DIDOT, color: '#1d2742', size: 0.085, sub: '#4c5570', maxW: 0.8 } },
  { id: '12', cat: 'paint', label: 'Navy strokes', t: { k: 'text', x: 0.06, y: 0.08, align: 'left', font: DIDOT, color: '#16264d', size: 0.075, sub: '#3e4c6d', maxW: 0.38 } },
  { id: '09', cat: 'paint', label: 'Japandi', t: { k: 'text', x: 0.06, y: 0.5, align: 'left', font: SERIF, color: '#15213d', size: 0.07, sub: '#46506a', maxW: 0.4 } },
  { id: '11', cat: 'paint', label: 'Boho', t: { k: 'text', x: 0.08, y: 0.17, align: 'left', font: DIDOT, color: '#f6efe2', size: 0.08, sub: '#dfe3ec', maxW: 0.7 } },
  { id: '10', cat: 'paint', label: 'Ribbons', t: { k: 'card', x: 0.5, y: 0.5, color: '#16244a', font: SERIF } },
  { id: '13', cat: 'paint', label: 'Textured', t: { k: 'card', x: 0.5, y: 0.5, color: '#203352', font: SERIF } },
  { id: '14', cat: 'paint', label: 'Blue squares', t: { k: 'card', x: 0.5, y: 0.5, color: '#1b2f52', font: SERIF } },
  { id: '08', cat: 'paint', label: 'Navy', t: { k: 'stack', x: 0.9, y: 0.93, font: SANS, weight: 700, color: '#efe6d3', size: 0.13 } },
  { id: '02', cat: 'paper', label: 'Torn paper', t: { k: 'tear', x: 0.49, y0: 0.15, y1: 0.98, w: 0.24, font: DIDOT, color: '#2b2b2e' } },
  { id: '24', cat: 'paper', label: 'Torn burgundy', t: { k: 'band', x: 0.47, y: 0.49, h: 0.12, w: 0.84, font: DIDOT, color: '#f3e9da' } },
  { id: '01', cat: 'paper', label: 'Lined paper', t: { k: 'lines', x: 0.17, y: 0.165, font: HAND, color: '#22305a', size: 0.075 } },
  { id: '05', cat: 'music', label: 'Cassette', t: { k: 'cassette', x: 0.175, w: 0.1, band: 0.072, font: HAND, color: '#2a2622', sub: '#7fb0a8' } },
  { id: '03', cat: 'music', label: 'Guitar picks', t: { k: 'text', x: 0.5, y: 0.1, align: 'center', font: SANS, weight: 700, spacing: 0.12, upper: true, color: '#f2e6c9', size: 0.07, sub: '#b8b2a5', maxW: 0.86 } },
  { id: '04', cat: 'music', label: 'Painted score', t: { k: 'card', x: 0.5, y: 0.88, color: '#1d1d22', font: SERIF } },
  { id: '21', cat: 'music', label: 'Cellist', t: { k: 'card', x: 0.5, y: 0.9, color: '#232a52', font: SERIF } },
];
export const photoById = (id) => COVER_PHOTOS.find((p) => p.id === id);

const cache = new Map();
export function loadCoverPhoto(id, thumb) {
  const key = (thumb ? 't/' : '') + id;
  if (!cache.has(key)) {
    cache.set(key, new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej;
      im.src = new URL(`../covers/${thumb ? 't/' : ''}${id}.jpg`, import.meta.url).href;
    }));
  }
  return cache.get(key);
}

function fit(ctx, text, font, size, maxW, weight = 600, spacing = 0) {
  let s = size;
  const set = () => { ctx.font = `${weight} ${s}px ${font}`; };
  set();
  const width = () => ctx.measureText(text).width + spacing * s * Math.max(0, text.length - 1);
  while (s > 8 && width() > maxW) { s *= 0.94; set(); }
  return s;
}
// words in lines no wider than maxW, at most `max` lines, shrinking only when it must
function wrap(ctx, text, font, size, maxW, max = 3, weight = 600, spacing = 0) {
  let sz = size;
  for (let k = 0; k < 40; k++) {
    ctx.font = `${weight} ${sz}px ${font}`;
    const wd = (t) => ctx.measureText(t).width + spacing * sz * Math.max(0, t.length - 1);
    const lines = []; let cur = '';
    for (const w of text.split(/\s+/)) { const tr = cur ? cur + ' ' + w : w; if (cur && wd(tr) > maxW) { lines.push(cur); cur = w; } else cur = tr; }
    if (cur) lines.push(cur);
    if (lines.length <= max && lines.every((l) => wd(l) <= maxW)) return { size: sz, lines };
    sz *= 0.94;
  }
  return { size: sz, lines: [text] };
}
// a title split in two balanced halves at a space
function halves(text) {
  const w = text.split(/\s+/); if (w.length < 2) return [text];
  let best = 1, bd = 1e9;
  for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (d < bd) { bd = d; best = i; } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}
function spaced(ctx, text, x, y, spacing, size, align) {
  if (!spacing) { ctx.textAlign = align; ctx.fillText(text, x, y); return; }
  const chars = [...text], gap = spacing * size;
  const total = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + gap * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.textAlign = 'left';
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + gap; }
}
// letters along a circle, centred on angle a0 (radians, 0 = right, -PI/2 = top), going clockwise
function arcText(ctx, text, cx, cy, R, a0, spacing, size) {
  const chars = [...text], gap = spacing * size;
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
  let a = a0 - total / R / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  chars.forEach((c, i) => {
    const mid = a + widths[i] / 2 / R;
    ctx.save(); ctx.translate(cx + R * Math.cos(mid), cy + R * Math.sin(mid)); ctx.rotate(mid + Math.PI / 2); ctx.fillText(c, 0, 0); ctx.restore();
    a += (widths[i] + gap) / R;
  });
  return total / R;
}

// Draw a photo cover; img is the loaded picture. file: { title, cover: { photo, sub, dir } }
export function drawPhotoCover(ctx, file, W, H, img) {
  const c = file.cover || {}, P = photoById(c.photo) || COVER_PHOTOS[0], t = P.t;
  const title = (file.title || 'Notebook').trim(), sub = (c.sub || '').trim();
  // the title can be made bigger or smaller (it still keeps clear of the edges)
  const ts = Math.min(1.8, Math.max(0.6, c.ts || 1));
  ctx.save();
  if (img) ctx.drawImage(img, 0, 0, W, H); else { ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, W, H); }
  ctx.textBaseline = 'alphabetic';
  const px = (f) => f * W, py = (f) => f * H;
  const shadow = (on, col = 'rgba(0,0,0,.35)') => { ctx.shadowColor = on ? col : 'transparent'; ctx.shadowBlur = on ? W * 0.012 : 0; ctx.shadowOffsetY = on ? W * 0.002 : 0; };
  if (t.k === 'ring' || t.k === 'ringTop') {
    const [fx, fy, fr] = REC[P.id];
    const cx = px(fx), cy = py(fy), r = px(fr);
    const top = t.k === 'ringTop';
    ctx.fillStyle = t.color;
    // the title follows the groove just outside the label; a long one takes two grooves
    const R = r * t.rf, maxArc = top ? 1.5 : 1.45;
    const text = t.font === SCRIPT ? title : title.toUpperCase();
    const arcOf = (str, sz) => { ctx.font = `${t.weight || 400} ${sz}px ${t.font}`; return ([...str].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + t.spacing * sz * (str.length - 1)) / R; };
    const base = px(t.size) * ts;
    let lines = [text], size = base;
    while (arcOf(text, size) > maxArc && size > base * 0.72) size *= 0.95;
    if (arcOf(text, size) > maxArc && halves(text).length === 2) {
      lines = halves(text); size = base;
      while (Math.max(...lines.map((l) => arcOf(l, size))) > maxArc && size > 8) size *= 0.95;
    } else while (arcOf(text, size) > maxArc && size > 8) size *= 0.95;
    shadow(true, 'rgba(0,0,0,.25)');
    ctx.font = `${t.weight || 400} ${size}px ${t.font}`;
    // on the right-hand records the first line is the inner groove; over the top the first is the outer
    // letters stand with their tops outwards, so the outer groove reads first: the title goes
    // outside, the subtitle in the groove next to the label
    const step = size * 1.15, R0 = sub && !top ? R + px(0.045) : R;
    lines.forEach((l, i) => arcText(ctx, l, cx, cy, R0 + (lines.length - 1 - i) * step, top ? -Math.PI / 2 : 0, t.spacing, size));
    if (sub) {
      if (top) {
        // on the label itself
        shadow(false); ctx.fillStyle = '#f6ead8';
        const s2 = fit(ctx, sub.toUpperCase(), SANS, px(0.03), r * 1.3, 600, 0.2);
        spaced(ctx, sub.toUpperCase(), cx, cy - r * 0.62, 0.2, s2, 'center');
      } else {
        ctx.font = `400 ${px(0.03)}px ${SERIF}`; ctx.fillStyle = t.color;
        arcText(ctx, sub.toUpperCase(), cx, cy, R - size * 0.15, 0, 0.5, px(0.03));
      }
    }
  } else if (t.k === 'text') {
    ctx.fillStyle = t.color; shadow(!!t.shadow);
    const text = t.upper ? title.toUpperCase() : title, wt = t.weight || 500;
    const { size: s, lines } = wrap(ctx, text, t.font, px(t.size) * ts, px(t.maxW) * Math.max(1, ts * 0.92), 3, wt, t.spacing || 0);
    const lh = s * 1.08, up = t.y > 0.6;
    // near the top the lines go down from y; near the bottom they end at y
    let y0 = up ? py(t.y) - (lines.length - 1) * lh : py(t.y);
    if (up && sub && !t.subAbove) y0 -= s * 0.62 - s * 0.5;
    if (sub && t.subAbove) {
      ctx.font = `italic 400 ${s * 0.42}px ${t.font}`; ctx.fillStyle = t.sub; ctx.textAlign = t.align; ctx.fillText(sub, px(t.x), y0 - s * 1.05);
      ctx.fillStyle = t.color;
    }
    ctx.font = `${wt} ${s}px ${t.font}`;
    lines.forEach((l, i) => spaced(ctx, l, px(t.x), y0 + i * lh, t.spacing || 0, s, t.align));
    const yl = y0 + (lines.length - 1) * lh;
    if (sub && !t.subAbove) { ctx.font = `italic 400 ${Math.max(px(0.026), s * 0.38)}px ${t.font}`; ctx.fillStyle = t.sub; ctx.textAlign = t.align; ctx.fillText(sub, px(t.x), yl + s * 0.62); }
  } else if (t.k === 'card') {
    const cw = px(0.62);
    const { size: s, lines } = wrap(ctx, title, t.font, px(0.068) * ts, cw - px(0.1), 2, 600);
    const lh = s * 1.12, ch = px(0.1) + lines.length * lh + (sub ? px(0.05) : 0);
    const x = px(t.x) - cw / 2, y = Math.min(H - ch - px(0.04), py(t.y) - ch / 2);
    shadow(true, 'rgba(0,0,0,.3)');
    ctx.fillStyle = '#f7f1e6'; ctx.fillRect(x, y, cw, ch); shadow(false);
    ctx.strokeStyle = t.color; ctx.lineWidth = px(0.0025); ctx.strokeRect(x + px(0.015), y + px(0.015), cw - px(0.03), ch - px(0.03));
    ctx.fillStyle = t.color; ctx.textAlign = 'center'; ctx.font = `600 ${s}px ${t.font}`;
    lines.forEach((l, i) => ctx.fillText(l, px(t.x), y + px(0.05) + s * 0.8 + i * lh));
    if (sub) { ctx.font = `italic ${px(0.032)}px ${t.font}`; ctx.globalAlpha = 0.8; ctx.fillText(sub, px(t.x), y + px(0.05) + s * 0.8 + (lines.length - 1) * lh + px(0.055)); ctx.globalAlpha = 1; }
  } else if (t.k === 'stack') {
    ctx.fillStyle = t.color; ctx.textAlign = 'right';
    const words = title.split(/\s+/);
    let s = px(t.size) * ts;
    ctx.font = `${t.weight} ${s}px ${t.font}`;
    const widest = () => Math.max(...words.map((w) => ctx.measureText(w).width));
    while (widest() > px(0.8) && s > 10) { s *= 0.94; ctx.font = `${t.weight} ${s}px ${t.font}`; }
    const lh = s * 1.02; let y = py(t.y) - (words.length - 1) * lh - (sub ? s * 0.6 : 0);
    for (const w of words) { ctx.fillText(w, px(t.x), y); y += lh; }
    if (sub) { ctx.font = `500 ${s * 0.26}px ${t.font}`; ctx.globalAlpha = 0.75; ctx.fillText(sub, px(t.x), y - lh + s * 0.55); ctx.globalAlpha = 1; }
  } else if (t.k === 'tear') {
    // in the tear: down the strip (default) or across it, word by word
    ctx.fillStyle = t.color; ctx.textAlign = 'center';
    const cx = px(t.x), y0 = py(t.y0), y1 = py(t.y1), sw = px(t.w);
    if (c.dir === 'across') {
      const words = title.split(/\s+/); let s = px(0.09) * ts;
      ctx.font = `600 ${s}px ${t.font}`;
      while (Math.max(...words.map((w) => ctx.measureText(w).width)) > sw && s > 10) { s *= 0.94; ctx.font = `600 ${s}px ${t.font}`; }
      let y = (y0 + y1) / 2 - ((words.length - 1) * s * 1.1) / 2 + s * 0.35;
      for (const w of words) { ctx.fillText(w, cx, y); y += s * 1.1; }
      if (sub) { ctx.font = `italic ${s * 0.4}px ${t.font}`; ctx.fillText(sub, cx, y + s * 0.1); }
    } else {
      ctx.save(); ctx.translate(cx, (y0 + y1) / 2); ctx.rotate(Math.PI / 2);
      const s = fit(ctx, title, t.font, sw * 0.62 * ts, (y1 - y0) * 0.86, 600, 0.04);
      spaced(ctx, title, 0, s * 0.3 - (sub ? s * 0.22 : 0), 0.04, s, 'center');
      if (sub) { ctx.font = `italic ${s * 0.32}px ${t.font}`; ctx.textAlign = 'center'; ctx.fillText(sub, 0, s * 0.62); }
      ctx.restore();
    }
  } else if (t.k === 'band') {
    ctx.fillStyle = t.color; shadow(true, 'rgba(0,0,0,.35)');
    const one = fit(ctx, title, t.font, px(t.h) * 0.9 * ts, px(t.w), 600, 0.03);
    const two = one < px(t.h) * 0.62 * ts && title.includes(' ');
    if (!two) {
      spaced(ctx, title, px(t.x), py(t.y) + one * 0.32 - (sub ? one * 0.2 : 0), 0.03, one, 'center');
      if (sub) { ctx.font = `italic ${one * 0.34}px ${t.font}`; ctx.textAlign = 'center'; ctx.fillText(sub, px(t.x), py(t.y) + one * 0.72); }
    } else {
      const ls = halves(title); const s2 = Math.min(px(t.h) * 0.5 * ts, ...ls.map((l) => fit(ctx, l, t.font, px(t.h) * 0.5 * ts, px(t.w), 600, 0.03)));
      ctx.font = `600 ${s2}px ${t.font}`;
      const yy = py(t.y) - (sub ? s2 * 0.35 : 0);
      spaced(ctx, ls[0], px(t.x), yy - s2 * 0.2, 0.03, s2, 'center'); spaced(ctx, ls[1], px(t.x), yy + s2 * 0.9, 0.03, s2, 'center');
      if (sub) { ctx.font = `italic ${s2 * 0.42}px ${t.font}`; ctx.textAlign = 'center'; ctx.fillText(sub, px(t.x), yy + s2 * 1.55); }
    }
  } else if (t.k === 'lines') {
    ctx.fillStyle = t.color; ctx.textAlign = 'left';
    const { size: s, lines } = wrap(ctx, title, t.font, px(t.size) * ts, px(0.76), 2, 400);
    ctx.font = `400 ${s}px ${t.font}`;
    lines.forEach((l, i) => ctx.fillText(l, px(t.x), py(t.y) + i * px(0.085)));
    if (sub) { ctx.font = `400 ${s * 0.55}px ${t.font}`; ctx.fillText(sub, px(t.x) + px(0.02), py(t.y) + (lines.length - 1) * px(0.085) + px(0.07)); }
  } else if (t.k === 'cassette') {
    // handwritten on the label strip, reading upwards; the subtitle printed on the dark band
    ctx.save(); ctx.translate(px(t.x), H / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = t.color; ctx.textAlign = 'center';
    const s = fit(ctx, title, t.font, px(t.w) * 0.62 * ts, H * 0.8, 400);
    ctx.fillText(title, 0, s * 0.33);
    ctx.restore();
    if (sub) {
      ctx.save(); ctx.translate(px(t.band), H / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = t.sub; const s2 = fit(ctx, sub.toUpperCase(), SANS, px(0.042), H * 0.8, 600, 0.25);
      spaced(ctx, sub.toUpperCase(), 0, s2 * 0.35, 0.25, s2, 'center'); ctx.restore();
    }
  }
  ctx.restore();
}

// Any cover, photo or drawn: waits for the picture when it has one.
import { drawCover } from './notebook.js';
export async function paintCover(ctx, file, w, h, thumb) {
  const c = file.cover || {};
  if (c.style === 'photo' && c.photo) {
    let img = null; try { img = await loadCoverPhoto(c.photo, thumb); } catch {}
    drawPhotoCover(ctx, file, w, h, img);
  } else drawCover(ctx, file, w, h);
}
