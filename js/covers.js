// All the cover pictures are original artwork drawn by a program for Stand (covergen.py), so they are free to use.
// Photo covers for notebooks: each picture has its own way of carrying the title. On records the
// title runs around the paper label, on torn paper it sits in the tear, on the cassette it is
// written on the label strip, on lined paper it is handwritten on the lines.
// Positions are fractions of the cover (x of the width, y of the height; sizes of the width).

export const PHOTO_CATS = [['records', 'Records'], ['flowers', 'Flowers'], ['paint', 'Paint'], ['textures', 'Textures'], ['paper', 'Paper'], ['music', 'Music']];

const SCRIPT = '"Snell Roundhand", "Apple Chancery", "Zapfino", cursive';
const HAND = '"Bradley Hand", "Noteworthy", "Marker Felt", cursive';
const SERIF = '"Iowan Old Style", "Baskerville", "New York", Georgia, serif';
const DIDOT = '"Didot", "Bodoni 72", "Iowan Old Style", Georgia, serif';
const SANS = '"Avenir Next", -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = '"American Typewriter", "Courier New", monospace';

// geometry of the record labels (centre x, centre y, radius) measured on the pictures
const REC = {
  r1: [-0.1025, 0.5458, 0.339], r2: [-0.0933, 0.5458, 0.3368], r3: [-0.1025, 0.5517, 0.3399],
  r4: [-0.1077, 0.5526, 0.339], r5: [-0.1018, 0.5534, 0.3396], r6: [-0.1018, 0.5538, 0.3386],
};
const ring = (color, font = SERIF, spacing = 0.45, size = 0.056) => ({ k: 'ring', font, spacing, color, size, rf: 1.18 });
const card = (color, y = 0.5) => ({ k: 'card', x: 0.5, y, color, font: SERIF });
// a band of paper across the whole cover, a little see-through
const strip = (color, y, bg = 'rgba(246,240,229,.88)') => ({ k: 'strip', y, color, bg, font: DIDOT });

export const COVER_PHOTOS = [
  { id: 'r1', cat: 'records', label: 'Black record', t: ring('rgba(255,255,255,.92)') },
  { id: 'r2', cat: 'records', label: 'Red record', t: ring('rgba(255,246,236,.94)', SCRIPT, 0.14, 0.092) },
  { id: 'r3', cat: 'records', label: 'Blue record', t: ring('rgba(255,255,255,.92)', SCRIPT, 0.12, 0.09) },
  { id: 'r4', cat: 'records', label: 'Green record', t: ring('rgba(255,252,240,.92)') },
  { id: 'r5', cat: 'records', label: 'Brown record', t: ring('rgba(255,246,232,.92)', SCRIPT, 0.12, 0.09) },
  { id: 'r6', cat: 'records', label: 'Silver record', t: { ...ring('rgba(12,14,20,1)'), weight: 600 } },
  { id: 'f1', cat: 'flowers', label: 'Blue petals', t: card('#1f3a6b', 0.5) },
  { id: 'f2', cat: 'flowers', label: 'Red petals', t: card('#7a1f22', 0.88) },
  { id: 'f3', cat: 'flowers', label: 'Poppies', t: { k: 'text', x: 0.5, y: 0.19, align: 'center', font: DIDOT, color: '#f6efe2', size: 0.085, sub: '#e8e2d6', maxW: 0.66, shadow: true } },
  { id: 'f4', cat: 'flowers', label: 'Anthurium', t: card('#1f484d', 0.5) },
  { id: 'f5', cat: 'flowers', label: 'Anemones', t: { k: 'text', x: 0.5, y: 0.085, align: 'center', font: DIDOT, color: '#1c2a4d', size: 0.07, sub: '#4a5677', maxW: 0.86 } },
  { id: 'p1', cat: 'paint', label: 'Blue ribbons', t: card('#16244a', 0.5) },
  { id: 'p2', cat: 'paint', label: 'Red brush', t: card('#7a1414', 0.52) },
  { id: 'p3', cat: 'paint', label: 'Green brush', t: card('#1e4a22', 0.88) },
  { id: 'p4', cat: 'paint', label: 'Ink wave', t: strip('#16244a', 0.2) },
  { id: 'p5', cat: 'paint', label: 'Blue marble', t: card('#16244a', 0.5) },
  { id: 'p6', cat: 'paint', label: 'Mountains', t: { k: 'text', x: 0.5, y: 0.1, align: 'center', font: DIDOT, color: '#1d2b4a', size: 0.08, sub: '#46506a', maxW: 0.8 } },
  { id: 't1', cat: 'textures', label: 'Red and sage', t: { k: 'text', x: 0.08, y: 0.12, align: 'left', font: DIDOT, color: '#6e1a22', size: 0.085, sub: '#8a4a50', maxW: 0.6 } },
  { id: 't2', cat: 'textures', label: 'Navy and sand', t: { k: 'text', x: 0.08, y: 0.12, align: 'left', font: DIDOT, color: '#f3ead8', size: 0.085, sub: '#d9d2c3', maxW: 0.62, shadow: true } },
  { id: 't3', cat: 'textures', label: 'Indigo squares', t: card('#16244a', 0.5) },
  { id: 't4', cat: 'textures', label: 'Faded squares', t: strip('#1f3354', 0.62) },
  { id: 't5', cat: 'textures', label: 'Blue cross', t: card('#16244a', 0.5) },
  { id: 't6', cat: 'textures', label: 'Weathered blue', t: strip('#f4ecdc', 0.36, 'rgba(22,34,58,.82)') },
  { id: 'a1', cat: 'paper', label: 'Torn paper', t: { k: 'tear', x: 0.49, y0: 0.37, y1: 0.97, w: 0.26, font: DIDOT, color: '#f3e9da' } },
  { id: 'a2', cat: 'paper', label: 'Torn across', t: { k: 'band', x: 0.5, y: 0.44, h: 0.11, w: 0.82, font: DIDOT, color: '#f3e9da' } },
  { id: 'a3', cat: 'paper', label: 'Torn diagonal', t: { k: 'diag', x: 0.53, y: 0.555, angle: -21, w: 0.74, h: 0.085, font: DIDOT, color: '#f3e9da' } },
  { id: 'm1', cat: 'music', label: 'Plectrums', t: strip('#f3ead8', 0.5, 'rgba(18,18,22,.8)') },
  { id: 'm2', cat: 'music', label: 'Painted score', t: card('#1d1d22', 0.11) },
  { id: 'm3', cat: 'music', label: 'Cassette', t: { k: 'cassette', x: 0.737, w: 0.095, band: 0.432, font: HAND, color: '#241f1b', sub: '#3a2c24' } },
];
// covers chosen with the earlier pictures open with the nearest new one
const OLD = { '06': 'r2', '16': 'r5', '17': 'r3', '18': 'r4', '19': 'r2', '07': 'r1', '20': 'f2', '27': 'f1', '28': 'f4', '29': 'f3', '15': 'f5',
  '25': 'p3', '26': 'p2', '23': 'p4', '12': 'p1', '10': 'p1', '08': 'p6', '09': 't2', '11': 't1', '13': 't6', '14': 't3',
  '02': 'a1', '24': 'a2', '01': 'a3', '05': 'm3', '03': 'm1', '04': 'm2', '21': 'm2' };
export const photoById = (id) => COVER_PHOTOS.find((p) => p.id === (OLD[id] || id));

const cache = new Map();
export function loadCoverPhoto(id, thumb) {
  id = OLD[id] || id;
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
    // never past the top edge (a long title has more lines)
    y0 = Math.max(y0, s * 0.92 + px(0.035));
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
  } else if (t.k === 'strip') {
    const { size: s, lines } = wrap(ctx, title.toUpperCase(), t.font, px(0.06) * ts, px(0.84), 2, 500, 0.12);
    const lh = s * 1.18, bh = px(0.07) + lines.length * lh + (sub ? px(0.045) : 0);
    const y = Math.min(H - bh - px(0.03), Math.max(px(0.03), py(t.y) - bh / 2));
    ctx.fillStyle = t.bg; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = t.color; ctx.strokeStyle = t.color; ctx.globalAlpha = 0.5; ctx.lineWidth = px(0.002);
    ctx.beginPath(); ctx.moveTo(px(0.06), y + px(0.018)); ctx.lineTo(W - px(0.06), y + px(0.018)); ctx.moveTo(px(0.06), y + bh - px(0.018)); ctx.lineTo(W - px(0.06), y + bh - px(0.018)); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = `500 ${s}px ${t.font}`;
    lines.forEach((l, i) => spaced(ctx, l, W / 2, y + px(0.035) + s * 0.85 + i * lh, 0.12, s, 'center'));
    if (sub) { ctx.font = `italic ${Math.max(px(0.026), s * 0.45)}px ${t.font}`; ctx.textAlign = 'center'; ctx.globalAlpha = 0.85; ctx.fillText(sub, W / 2, y + px(0.035) + s * 0.85 + (lines.length - 1) * lh + px(0.05)); ctx.globalAlpha = 1; }
  } else if (t.k === 'diag') {
    // along the tear, on the slant of the paper: one line, or two when the title is long
    ctx.save(); ctx.translate(px(t.x), py(t.y)); ctx.rotate((t.angle * Math.PI) / 180);
    ctx.fillStyle = t.color; ctx.textAlign = 'center'; shadow(true, 'rgba(0,0,0,.4)');
    const L = px(t.w), Hh = px(t.h);
    const one = fit(ctx, title, t.font, Hh * ts, L, 600, 0.04);
    if (one >= Hh * 0.62 * ts || !title.includes(' ')) {
      ctx.font = `600 ${one}px ${t.font}`;
      spaced(ctx, title, 0, one * 0.32 - (sub ? one * 0.18 : 0), 0.04, one, 'center');
      if (sub) { shadow(false); ctx.font = `italic ${Math.max(px(0.026), one * 0.32)}px ${t.font}`; ctx.globalAlpha = 0.9; ctx.fillText(sub, 0, one * 0.32 + one * 0.55); ctx.globalAlpha = 1; }
    } else {
      const ls = halves(title); const s2 = Math.min(Hh * 0.72 * ts, ...ls.map((l) => fit(ctx, l, t.font, Hh * 0.72 * ts, L * 0.92, 600, 0.04)));
      ctx.font = `600 ${s2}px ${t.font}`;
      const y0 = -s2 * 0.55 - (sub ? s2 * 0.25 : 0);
      spaced(ctx, ls[0], 0, y0 + s2 * 0.35, 0.04, s2, 'center'); spaced(ctx, ls[1], 0, y0 + s2 * 1.45, 0.04, s2, 'center');
      if (sub) { shadow(false); ctx.font = `italic ${Math.max(px(0.026), s2 * 0.4)}px ${t.font}`; ctx.globalAlpha = 0.9; ctx.fillText(sub, 0, y0 + s2 * 2.15); ctx.globalAlpha = 1; }
    }
    ctx.restore();
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
