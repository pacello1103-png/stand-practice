// Notebooks: manuscript paper drawn the way engravers set a printed score (rastral staff sizes,
// the line weights of the Bravura font, real clefs, braces and brackets, even spacing, page
// numbers), and covers in several styles with your own title.
// Units: points on an A4 page (595 x 842).

export const PAGE_W = 595, PAGE_H = 842;
const MM = 2.8346;

// ---------- the kinds of paper ----------
// staves: one system = list of clefs ('g','f','c','t' tenor, 'tab', null = no clef)
export const PAPER_TYPES = {
  treble: { label: 'Treble clef', staves: ['g'] },
  bass: { label: 'Bass clef', staves: ['f'] },
  alto: { label: 'Alto clef', staves: ['c'] },
  tenor: { label: 'Tenor clef', staves: ['t'] },
  blank: { label: 'Staves', staves: [null] },
  piano: { label: 'Piano', staves: ['g', 'f'], brace: true },
  duo: { label: 'Two staves', staves: ['g', 'f'], bracket: true },
  violinpiano: { label: 'Violin and piano', staves: ['g', 'g', 'f'], brace: true, solo: true },
  cellopiano: { label: 'Cello and piano', staves: ['f', 'g', 'f'], brace: true, solo: true },
  voicepiano: { label: 'Voice and piano', staves: ['g', 'g', 'f'], brace: true, solo: true, lyrics: true },
  quartet: { label: 'String quartet', staves: ['g', 'g', 'c', 'f'], bracket: true },
  satb: { label: 'Choir SATB', staves: ['g', 'g', 'g8', 'f'], bracket: true, lyrics: true },
  tab: { label: 'Guitar tab', staves: ['g', 'tab'], tab: true },
  tabonly: { label: 'Tab only', staves: ['tab'], tab: true },
  wide: { label: 'Large (teaching)', staves: ['g'], size: 9.2 },
  lined: { label: 'Lined', kind: 'lined' },
  dots: { label: 'Dot grid', kind: 'dots' },
  grid: { label: 'Squared', kind: 'grid' },
  plain: { label: 'Plain', kind: 'plain' },
  cornell: { label: 'Cornell notes', kind: 'cornell' },
  todo: { label: 'To-do list', kind: 'todo' },
  week: { label: 'Practice week', kind: 'week' },
  log: { label: 'Practice log', kind: 'log' },
  lesson: { label: 'Staves and lines', kind: 'lesson' },
  storyboard: { label: 'Storyboard', kind: 'storyboard' },
};
// the papers in two groups, as they are offered
export const PAPER_GROUPS = [
  ['Staff paper', ['treble', 'bass', 'alto', 'tenor', 'blank', 'piano', 'duo', 'violinpiano', 'cellopiano', 'voicepiano', 'quartet', 'satb', 'tab', 'tabonly', 'wide', 'lesson']],
  ['Other paper', ['lined', 'dots', 'grid', 'plain', 'cornell', 'todo', 'week', 'log', 'storyboard']],
];
// Rastral sizes (staff height in mm), as engravers name them.
export const RASTRAL = [
  { n: 0, mm: 9.2, use: 'Teaching' }, { n: 1, mm: 7.9, use: 'Large' }, { n: 2, mm: 7.4, use: 'Solo parts' },
  { n: 3, mm: 7.0, use: 'Standard' }, { n: 4, mm: 6.5, use: 'Songs, hymns' }, { n: 5, mm: 6.0, use: 'Choral' }, { n: 6, mm: 5.5, use: 'Compact' },
];

const G = { g: '', f: '', c: '', t: '', g8: '', tab: '', brace: '', bracketTop: '', bracketBottom: '' };

// Notebook settings with their defaults (older notebooks have only a template).
export function nbOpts(file) {
  const o = file.opts || {};
  const t = PAPER_TYPES[file.template] || PAPER_TYPES.treble;
  return {
    staffMm: o.staffMm || t.size || 7.0,
    bars: o.bars || 0,                    // barlines drawn in every line (0 = none)
    paper: o.paper || 'white',            // white | cream
    numbers: o.numbers !== false,         // page numbers
    header: o.header !== false,           // title on the first page
    title: file.title || '', composer: o.composer || '',
  };
}
export function paperColor(opts) { return opts.paper === 'cream' ? '#FBF6EA' : '#ffffff'; }

// How many systems fit on a page, for the settings to show.
export function systemsPerPage(template, staffMm, first) {
  const t = PAPER_TYPES[template] || PAPER_TYPES.treble;
  if (t.kind) return 0;
  return layoutSystems(t, staffMm, first).length;
}
function layoutSystems(t, staffMm, first, header = true) {
  const sp = (staffMm / 4) * MM;
  const top = (first && header ? 34 : 14) * MM, bottom = PAGE_H - 16 * MM;
  const heights = t.staves.map((c) => (c === 'tab' ? sp * 1.5 * 5 : sp * 4));
  const inner = t.staves.map((c, i) => (i === 0 ? 0 : (t.lyrics && i <= (t.solo ? 1 : t.staves.length) && c !== 'f' ? sp * 7.5 : sp * 6.2)));
  const sysH = heights.reduce((a, b) => a + b, 0) + inner.reduce((a, b) => a + b, 0);
  const minGap = t.staves.length > 1 ? sp * 9 : t.lyrics ? sp * 8 : sp * 6.5;
  const n = Math.max(1, Math.floor((bottom - top + minGap) / (sysH + minGap)));
  const gap = n > 1 ? (bottom - top - n * sysH) / (n - 1) : 0;
  const out = [];
  for (let s = 0; s < n; s++) {
    let y = top + s * (sysH + gap);
    const staves = t.staves.map((c, i) => { y += inner[i]; const st = { clef: c, y, h: heights[i] }; y += heights[i]; return st; });
    out.push({ staves, top: staves[0].y, bottom: staves[staves.length - 1].y + staves[staves.length - 1].h });
  }
  return out;
}

// One page of paper. `pi` counts paper pages from 0 (the cover is not counted).
export function drawNotebookPage(ctx, file, pi, w, h) {
  // a page can have its own paper (pages added later)
  if (file.pagesTpl && file.pagesTpl[pi]) file = { ...file, template: file.pagesTpl[pi] };
  const t = PAPER_TYPES[file.template] || PAPER_TYPES.treble;
  const o = nbOpts(file);
  const k = w / PAGE_W;
  ctx.save();
  ctx.fillStyle = paperColor(o); ctx.fillRect(0, 0, w, h);
  ctx.scale(k, k);
  const ink = '#1a1b1f';
  const left = 15 * MM, right = PAGE_W - 15 * MM;
  if (o.numbers && pi > 0) { ctx.fillStyle = '#6b6f78'; ctx.font = '9px "Iowan Old Style", Georgia, serif'; ctx.textAlign = pi % 2 ? 'right' : 'left'; ctx.fillText(String(pi + 1), pi % 2 ? right : left, PAGE_H - 8 * MM); }
  if (t.kind) { drawPlain(ctx, t.kind, o, pi); ctx.restore(); return; }
  const sp = (o.staffMm / 4) * MM;
  // first page: the title, like a printed part
  if (pi === 0 && o.header && (o.title || o.composer)) {
    ctx.fillStyle = ink; ctx.textAlign = 'center';
    ctx.font = '600 20px "Iowan Old Style", "New York", Georgia, serif';
    if (o.title) ctx.fillText(o.title, PAGE_W / 2, 20 * MM);
    if (o.composer) { ctx.textAlign = 'right'; ctx.font = '11px "Iowan Old Style", Georgia, serif'; ctx.fillText(o.composer, right, 27 * MM); }
  }
  const systems = layoutSystems(t, o.staffMm, pi === 0, o.header && !!(o.title || o.composer));
  const lw = sp * 0.13, bw = sp * 0.16;
  ctx.fillStyle = ink; ctx.strokeStyle = ink;
  const multi = t.staves.length > 1;
  const sx0 = left + (multi ? sp * 1.2 : 0);
  for (const sys of systems) {
    for (const st of sys.staves) {
      const lines = st.clef === 'tab' ? 6 : 5, gap = st.clef === 'tab' ? sp * 1.5 : sp;
      ctx.lineWidth = lw; ctx.beginPath();
      for (let l = 0; l < lines; l++) { const y = st.y + l * gap; ctx.moveTo(sx0, y); ctx.lineTo(right, y); }
      ctx.stroke();
      // the clef, set like the printed one
      if (st.clef) {
        ctx.font = `${sp * 4}px Bravura`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const x = sx0 + sp * 0.9;
        if (st.clef === 'g' || st.clef === 'g8') ctx.fillText(G[st.clef], x, st.y + sp * 3);
        else if (st.clef === 'f') ctx.fillText(G.f, x, st.y + sp * 1);
        else if (st.clef === 'c') ctx.fillText(G.c, x, st.y + sp * 2);
        else if (st.clef === 't') ctx.fillText(G.c, x, st.y + sp * 1);
        else if (st.clef === 'tab') {
          // T, A, B stacked in the middle spaces, as engraved tab is marked
          ctx.font = `700 ${gap * 1.4}px "Helvetica Neue", Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ['T', 'A', 'B'].forEach((ch, q) => ctx.fillText(ch, x + sp * 0.8, st.y + gap * (1.25 + q * 1.25)));
          ctx.textBaseline = 'alphabetic';
        }
      }
    }
    // the system's start line, the barlines and the end
    ctx.lineWidth = bw;
    ctx.beginPath(); ctx.moveTo(sx0, sys.top); ctx.lineTo(sx0, sys.bottom);
    const bars = o.bars, x0 = sx0 + sp * 4.6;
    for (let b = 1; b <= bars; b++) {
      const x = x0 + ((right - x0) * b) / bars;
      // barlines run through the staves of a bracketed group, but not between piano and solo
      if (t.staves.length > 1 && !t.solo) { ctx.moveTo(x, sys.top); ctx.lineTo(x, sys.bottom); }
      else for (const st of sys.staves) { const hh = st.clef === 'tab' ? sp * 7.5 : sp * 4; ctx.moveTo(x, st.y); ctx.lineTo(x, st.y + hh); }
    }
    if (!bars) for (const st of sys.staves) { const hh = st.clef === 'tab' ? sp * 7.5 : sp * 4; ctx.moveTo(right, st.y); ctx.lineTo(right, st.y + hh); }
    if (bars && t.solo) { const p = sys.staves.slice(1); ctx.moveTo(right, p[0].y); ctx.lineTo(right, p[p.length - 1].y + p[p.length - 1].h); }
    ctx.stroke();
    // braces and brackets
    if (t.brace && multi) {
      const ps = t.solo ? sys.staves.slice(-2) : sys.staves;
      const a = ps[0].y, b = ps[ps.length - 1].y + ps[ps.length - 1].h, hh = b - a;
      // the brace glyph is one em tall: set it at the height of the piano staves
      ctx.save(); ctx.font = `${hh}px Bravura`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(G.brace, sx0 - sp * 0.3, b); ctx.restore();
    }
    if (t.bracket && multi) {
      const a = sys.top, b = sys.bottom, x = sx0 - sp * 0.9;
      ctx.lineWidth = sp * 0.5; ctx.beginPath(); ctx.moveTo(x, a - sp * 0.3); ctx.lineTo(x, b + sp * 0.3); ctx.stroke();
      ctx.font = `${sp * 4}px Bravura`; ctx.textAlign = 'left';
      ctx.fillText(G.bracketTop, x - sp * 0.25, a - sp * 0.3); ctx.fillText(G.bracketBottom, x - sp * 0.25, b + sp * 0.3);
    }
    if (t.solo && multi) {
      // the solo line stands apart: its own start line already drawn; nothing joins it to the piano
    }
  }
  ctx.restore();
}
function drawPlain(ctx, kind, o, pi) {
  const x0 = 15 * MM, x1 = PAGE_W - 15 * MM, y0 = (pi === 0 && o.header && o.title ? 30 : 15) * MM, y1 = PAGE_H - 16 * MM;
  if (pi === 0 && o.header && o.title) { ctx.fillStyle = '#1a1b1f'; ctx.textAlign = 'center'; ctx.font = '600 20px "Iowan Old Style", Georgia, serif'; ctx.fillText(o.title, PAGE_W / 2, 20 * MM); }
  const step = 7 * MM;
  if (kind === 'lined') {
    ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let y = y0 + step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  } else if (kind === 'grid') {
    ctx.strokeStyle = '#d6dbe6'; ctx.lineWidth = 0.4; ctx.beginPath();
    for (let y = y0; y <= y1 + 0.1; y += 5 * MM) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    for (let x = x0; x <= x1 + 0.1; x += 5 * MM) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    ctx.stroke();
  } else if (kind === 'dots') {
    ctx.fillStyle = '#9aa5ba';
    for (let y = y0; y <= y1 + 0.1; y += 5 * MM) for (let x = x0; x <= x1 + 0.1; x += 5 * MM) { ctx.beginPath(); ctx.arc(x, y, 0.75, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'cornell') {
    // a cue column, notes, and a summary at the foot
    const cx = x0 + (x1 - x0) * 0.28, sy = y1 - 45 * MM;
    ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let y = y0 + step; y <= sy; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    for (let y = sy + step * 1.6; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = '#d0786f'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, sy); ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); ctx.stroke();
    label(ctx, 'Cues', x0, y0 - 2); label(ctx, 'Notes', cx + 4, y0 - 2); label(ctx, 'Summary', x0, sy + 9);
  } else if (kind === 'todo') {
    ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.5;
    for (let y = y0 + step * 1.3; y <= y1; y += step * 1.3) {
      ctx.beginPath(); ctx.moveTo(x0 + 10 * MM, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.strokeStyle = '#8e98ad'; ctx.lineWidth = 0.7; ctx.strokeRect(x0 + 1 * MM, y - 5 * MM, 4.2 * MM, 4.2 * MM); ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.5;
    }
  } else if (kind === 'week') {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const rh = (y1 - y0) / 7;
    days.forEach((d, i) => {
      const y = y0 + i * rh;
      ctx.fillStyle = i % 2 ? '#f6f7fa' : '#ffffff'; ctx.fillRect(x0, y, x1 - x0, rh);
      label(ctx, d, x0 + 3, y + 10);
      ctx.strokeStyle = '#d6dbe6'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let k = 1; k < 4; k++) { ctx.moveTo(x0 + 34 * MM, y + (rh * k) / 4 + 4); ctx.lineTo(x1, y + (rh * k) / 4 + 4); }
      ctx.stroke();
      ctx.fillStyle = '#9aa5ba'; ctx.font = '7px -apple-system, Helvetica, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('min', x0 + 30 * MM, y + rh - 6); ctx.textAlign = 'left';
      ctx.strokeStyle = '#b9c3d6'; ctx.beginPath(); ctx.moveTo(x0 + 18 * MM, y + rh - 5); ctx.lineTo(x0 + 26 * MM, y + rh - 5); ctx.stroke();
    });
  } else if (kind === 'log') {
    const cols = [['Date', 0.16], ['Piece / exercise', 0.42], ['Tempo', 0.12], ['Minutes', 0.12], ['How it went', 0.18]];
    let x = x0; ctx.strokeStyle = '#c7cede'; ctx.lineWidth = 0.5;
    cols.forEach(([t, f]) => { label(ctx, t, x + 2, y0 + 8); x += (x1 - x0) * f; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); });
    ctx.beginPath(); for (let y = y0 + 12; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); } ctx.stroke();
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else if (kind === 'lesson') {
    // a staff, then lines for words, down the page
    const sp = 1.75 * MM;
    for (let y = y0 + 8 * MM; y + 40 * MM < y1; y += 48 * MM) {
      ctx.strokeStyle = '#1a1b1f'; ctx.lineWidth = sp * 0.13; ctx.beginPath();
      for (let l = 0; l < 5; l++) { ctx.moveTo(x0, y + l * sp); ctx.lineTo(x1, y + l * sp); }
      ctx.stroke();
      ctx.strokeStyle = '#b9c3d6'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let k = 1; k <= 4; k++) { const yy = y + 4 * sp + k * step; ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); }
      ctx.stroke();
    }
  } else if (kind === 'storyboard') {
    const bw = (x1 - x0 - 8 * MM) / 2, bh = bw * 0.6;
    ctx.strokeStyle = '#8e98ad'; ctx.lineWidth = 0.8;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const bx = x0 + c * (bw + 8 * MM), by = y0 + 4 * MM + r * (bh + 26 * MM);
      if (by + bh + 20 * MM > y1) continue;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.strokeStyle = '#c7cede'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let k = 1; k <= 2; k++) { ctx.moveTo(bx, by + bh + k * 7 * MM); ctx.lineTo(bx + bw, by + bh + k * 7 * MM); }
      ctx.stroke(); ctx.strokeStyle = '#8e98ad'; ctx.lineWidth = 0.8;
    }
  }
}
function label(ctx, t, x, y) {
  ctx.fillStyle = '#7a8296'; ctx.font = '600 7.5px -apple-system, "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(t.toUpperCase(), x, y);
}
function _unused() {
  if (false) {
  }
}

// ---------- covers ----------
export const COVER_COLORS = [
  ['navy', '#1d2f6f'], ['burgundy', '#6e1a2a'], ['forest', '#1c4a38'], ['charcoal', '#26282e'], ['plum', '#4a2560'],
  ['teal', '#175e66'], ['ochre', '#b8812a'], ['sky', '#5f93c7'], ['rose', '#c98585'], ['sand', '#d7c6a0'],
];
export const COVER_STYLES = [
  { id: 'cloth', label: 'Cloth' }, { id: 'gilded', label: 'Gilded' }, { id: 'modern', label: 'Modern' }, { id: 'staves', label: 'Staves' },
  { id: 'marble', label: 'Marbled' }, { id: 'minimal', label: 'Minimal' }, { id: 'gradient', label: 'Glow' }, { id: 'kraft', label: 'Kraft' },
];
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
};
const light = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150; };
function rnd(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const SERIF = '"Iowan Old Style", "New York", "Palatino", Georgia, serif';
const SANS = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
let TS = 1;
function fitText(ctx, text, font, size, maxW) { let s = size * TS; ctx.font = font(s); while (s > 10 && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = font(s); } return s; }

export function drawCover(ctx, file, w, h) {
  const c = file.cover || {}; const style = c.style || 'cloth', col = c.color || '#1d2f6f';
  TS = Math.min(1.8, Math.max(0.6, c.ts || 1));
  const title = file.title || 'Notebook', sub = c.sub || '';
  const k = w / PAGE_W;
  ctx.save(); ctx.scale(k, k);
  const W = PAGE_W, H = PAGE_H, R = rnd(title.length * 97 + col.length);
  const onDark = !light(col);
  const fg = onDark ? '#fbf7ee' : '#1d1d21';
  if (style === 'cloth' || style === 'gilded') {
    ctx.fillStyle = col; ctx.fillRect(0, 0, W, H);
    // woven texture
    ctx.globalAlpha = 0.07;
    for (let y = 0; y < H; y += 2) { ctx.fillStyle = R() > 0.5 ? '#fff' : '#000'; ctx.fillRect(0, y, W, 1); }
    for (let x = 0; x < W; x += 3) { ctx.fillStyle = R() > 0.5 ? '#fff' : '#000'; ctx.fillRect(x, 0, 1, H); }
    ctx.globalAlpha = 1;
    // the spine
    const sg = ctx.createLinearGradient(0, 0, 46, 0); sg.addColorStop(0, shade(col, -0.45)); sg.addColorStop(0.8, shade(col, -0.15)); sg.addColorStop(1, shade(col, -0.32));
    ctx.fillStyle = sg; ctx.fillRect(0, 0, 46, H);
    ctx.strokeStyle = shade(col, 0.25); ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(38, 0); ctx.lineTo(38, H); ctx.stroke(); ctx.setLineDash([]);
    if (style === 'cloth') {
      // a paper label
      const lx = 120, ly = 190, lw = W - 190, lh = 210;
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#f6efdf'; roundRect(ctx, lx, ly, lw, lh, 6); ctx.fill(); ctx.shadowColor = 'transparent';
      ctx.strokeStyle = shade(col, -0.1); ctx.lineWidth = 1.2; roundRect(ctx, lx + 10, ly + 10, lw - 20, lh - 20, 3); ctx.stroke();
      ctx.lineWidth = 0.6; roundRect(ctx, lx + 14, ly + 14, lw - 28, lh - 28, 2); ctx.stroke();
      ctx.fillStyle = '#26221b'; ctx.textAlign = 'center';
      fitText(ctx, title, (s) => `600 ${s}px ${SERIF}`, 40, lw - 60); ctx.fillText(title, lx + lw / 2, ly + (sub ? 100 : 118));
      if (sub) { ctx.font = `italic 17px ${SERIF}`; ctx.fillStyle = '#5a5246'; ctx.fillText(sub, lx + lw / 2, ly + 140); }
      ctx.font = `${30}px Bravura`; ctx.fillStyle = shade(col, -0.05); ctx.fillText('', lx + lw / 2, ly + lh - 26);
    } else {
      // gold frame and lettering
      const gold = ctx.createLinearGradient(0, 0, W, H); gold.addColorStop(0, '#e9cf8a'); gold.addColorStop(0.5, '#b8913f'); gold.addColorStop(1, '#f1dc9f');
      ctx.strokeStyle = gold; ctx.lineWidth = 2.2; ctx.strokeRect(78, 40, W - 118, H - 80); ctx.lineWidth = 0.8; ctx.strokeRect(86, 48, W - 134, H - 96);
      // corner ornaments
      ctx.fillStyle = gold;
      for (const [x, y] of [[86, 48], [W - 48, 48], [86, H - 48], [W - 48, H - 48]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.fillStyle = gold;
      ctx.font = `${70}px Bravura`; ctx.fillText('', (W + 46) / 2, 300);
      fitText(ctx, title.toUpperCase(), (s) => `600 ${s}px ${SERIF}`, 38, W - 200); ctx.fillText(title.toUpperCase(), (W + 46) / 2, 420);
      ctx.fillRect((W + 46) / 2 - 40, 444, 80, 1.2);
      if (sub) { ctx.font = `italic 18px ${SERIF}`; ctx.fillText(sub, (W + 46) / 2, 480); }
    }
  } else if (style === 'modern') {
    ctx.fillStyle = col; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = onDark ? 0.12 : 0.16; ctx.fillStyle = onDark ? '#fff' : '#000';
    ctx.font = `${620}px Bravura`; ctx.textAlign = 'left'; ctx.fillText('', W * 0.38, H * 0.62);
    ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.textAlign = 'left';
    const s = fitText(ctx, title, (z) => `700 ${z}px ${SANS}`, 60, W - 110);
    ctx.fillText(title, 56, H - 120);
    ctx.fillRect(56, H - 120 + 22, 60, 4);
    if (sub) { ctx.font = `500 17px ${SANS}`; ctx.globalAlpha = 0.8; ctx.fillText(sub, 56, H - 120 + 58); ctx.globalAlpha = 1; }
    void s;
  } else if (style === 'staves') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, shade(col, 0.06)); g.addColorStop(1, shade(col, -0.25));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = onDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.3;
    for (let l = 0; l < 5; l++) {
      ctx.beginPath(); const y = 480 + l * 12;
      ctx.moveTo(-10, y + 90); ctx.bezierCurveTo(W * 0.3, y - 140, W * 0.65, y + 160, W + 10, y - 60); ctx.stroke();
    }
    ctx.fillStyle = onDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.75)'; ctx.font = `48px Bravura`;
    const notes = [[0.18, 486], [0.33, 452], [0.47, 470], [0.62, 500], [0.78, 470]];
    for (const [fx, y] of notes) ctx.fillText('', W * fx, y);
    ctx.fillStyle = fg; ctx.textAlign = 'left';
    fitText(ctx, title, (z) => `600 ${z}px ${SERIF}`, 50, W - 110); ctx.fillText(title, 56, 150);
    if (sub) { ctx.font = `italic 19px ${SERIF}`; ctx.globalAlpha = 0.85; ctx.fillText(sub, 58, 186); ctx.globalAlpha = 1; }
  } else if (style === 'marble') {
    ctx.fillStyle = shade(col, 0.55); ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, Math.round(W * k), Math.round(H * k));
    const d = img.data, iw = img.width, ih = img.height;
    const base = parseInt(col.slice(1), 16), br = base >> 16, bg = (base >> 8) & 255, bb = base & 255;
    const ph = R() * 10;
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
      const u = x / iw * 6, v = y / ih * 8;
      const n = Math.sin(u * 1.7 + Math.sin(v * 1.3 + ph) * 2.2 + Math.sin(u * 0.7 + v * 0.9) * 1.6 + v * 0.8);
      const t = Math.pow(Math.abs(n), 0.35);
      const i = (y * iw + x) * 4;
      d[i] = br + (248 - br) * t; d[i + 1] = bg + (244 - bg) * t; d[i + 2] = bb + (236 - bb) * t; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const lx = 110, ly = 300, lw = W - 220, lh = 170;
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 12; ctx.fillStyle = '#fbf7ee'; roundRect(ctx, lx, ly, lw, lh, 4); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = col; ctx.lineWidth = 1; roundRect(ctx, lx + 8, ly + 8, lw - 16, lh - 16, 2); ctx.stroke();
    ctx.fillStyle = '#25221e'; ctx.textAlign = 'center';
    fitText(ctx, title, (z) => `600 ${z}px ${SERIF}`, 36, lw - 50); ctx.fillText(title, W / 2, ly + (sub ? 82 : 96));
    if (sub) { ctx.font = `italic 16px ${SERIF}`; ctx.fillStyle = '#5c554b'; ctx.fillText(sub, W / 2, ly + 116); }
  } else if (style === 'minimal') {
    ctx.fillStyle = '#f7f4ee'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.strokeRect(36, 36, W - 72, H - 72);
    ctx.fillStyle = '#1e1f24'; ctx.textAlign = 'center';
    fitText(ctx, title, (z) => `500 ${z}px ${SERIF}`, 44, W - 140); ctx.fillText(title, W / 2, H * 0.42);
    ctx.fillStyle = col; ctx.fillRect(W / 2 - 28, H * 0.42 + 24, 56, 2.5);
    if (sub) { ctx.fillStyle = '#5a5c63'; ctx.font = `400 16px ${SERIF}`; ctx.fillText(sub, W / 2, H * 0.42 + 62); }
    ctx.fillStyle = col; ctx.font = `34px Bravura`; ctx.fillText('', W / 2, H - 90);
  } else if (style === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.45));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rg = ctx.createRadialGradient(W * 0.75, H * 0.2, 10, W * 0.75, H * 0.2, W * 0.8); rg.addColorStop(0, 'rgba(255,255,255,.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; roundRect(ctx, 50, H - 280, W - 100, 200, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; roundRect(ctx, 50, H - 280, W - 100, 200, 22); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    fitText(ctx, title, (z) => `700 ${z}px ${SANS}`, 46, W - 160); ctx.fillText(title, 80, H - 190);
    if (sub) { ctx.font = `500 17px ${SANS}`; ctx.globalAlpha = 0.85; ctx.fillText(sub, 80, H - 152); ctx.globalAlpha = 1; }
  } else if (style === 'kraft') {
    ctx.fillStyle = '#c9a874'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = R() > 0.5 ? 'rgba(90,60,25,.10)' : 'rgba(255,240,210,.10)'; ctx.fillRect(R() * W, R() * H, 1 + R() * 2, 1 + R() * 2); }
    // a band in the chosen colour, and a stamped title
    ctx.fillStyle = col; ctx.fillRect(0, H * 0.62, W, 54);
    ctx.fillStyle = '#2b2116'; ctx.textAlign = 'left';
    fitText(ctx, title.toUpperCase(), (z) => `700 ${z}px "Courier New", ui-monospace, monospace`, 40, W - 120); ctx.fillText(title.toUpperCase(), 60, 200);
    if (sub) { ctx.font = `18px "Courier New", ui-monospace, monospace`; ctx.fillText(sub, 60, 236); }
    ctx.save(); ctx.translate(W - 140, 330); ctx.rotate(-0.18); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 58, 0, 7); ctx.stroke(); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 50, 0, 7); ctx.stroke();
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.font = `700 15px "Courier New", monospace`; ctx.fillText('MUSIC', 0, -14); ctx.font = `30px Bravura`; ctx.fillText('', 0, 26); ctx.restore();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
