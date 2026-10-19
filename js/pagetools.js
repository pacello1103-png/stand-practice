// Page tools for a score: crop a page (or every page) to the music you need, and cut a page
// in two between systems so each part becomes its own page. The original file is never changed.
import { pageGaps } from './score.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function shell(title, sub) {
  const root = el('section', 'ptool');
  const top = el('header', 'review-top');
  const cancel = el('button', 'btn ghost', 'Cancel');
  const t = el('div', 'review-title'); t.append(el('strong', '', title), el('span', 'hint', sub || ''));
  const done = el('button', 'btn primary', 'Done');
  top.append(cancel, t, done);
  const stage = el('div', 'ptool-stage');
  const page = el('div', 'ptool-page'); const cv = el('canvas'); page.append(cv); stage.append(page);
  const bar = el('div', 'ptool-bar');
  root.append(top, stage, bar);
  document.body.append(root);
  return { root, cancel, done, stage, page, cv, bar, t };
}
async function drawPage(doc, o, ui) {
  const [pw, ph] = doc.sizes[o];
  const r = ui.stage.getBoundingClientRect();
  const k = Math.min((r.width - 48) / pw, (r.height - 48) / ph);
  const w = Math.round(pw * k), h = Math.round(ph * k);
  ui.page.style.width = w + 'px'; ui.page.style.height = h + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1);
  await doc.render(o, ui.cv, w * dpr, h * dpr);
  return { w, h };
}

// ---------- crop ----------
// box: the current crop of this page (0..1) or null; resolves { box, all } or null
export function openCropper({ doc, orig, box, pageLabel }) {
  return new Promise(async (resolve) => {
    const ui = shell('Crop', pageLabel || '');
    let B = box ? { ...box } : { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
    await drawPage(doc, orig, ui);
    const shades = [0, 1, 2, 3].map(() => { const s = el('div', 'ptool-shade'); ui.page.append(s); return s; });
    const frame = el('div', 'ptool-box'); ui.page.append(frame);
    const hs = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].map((k) => { const h = el('div', 'ptool-h'); h.dataset.k = k; ui.page.append(h); return h; });
    const place = () => {
      const P = (v) => (v * 100).toFixed(3) + '%';
      Object.assign(frame.style, { left: P(B.x), top: P(B.y), width: P(B.w), height: P(B.h) });
      Object.assign(shades[0].style, { left: 0, top: 0, right: 0, height: P(B.y) });
      Object.assign(shades[1].style, { left: 0, top: P(B.y + B.h), right: 0, bottom: 0 });
      Object.assign(shades[2].style, { left: 0, top: P(B.y), width: P(B.x), height: P(B.h) });
      Object.assign(shades[3].style, { left: P(B.x + B.w), top: P(B.y), right: 0, height: P(B.h) });
      const pos = { nw: [B.x, B.y], ne: [B.x + B.w, B.y], sw: [B.x, B.y + B.h], se: [B.x + B.w, B.y + B.h], n: [B.x + B.w / 2, B.y], s: [B.x + B.w / 2, B.y + B.h], w: [B.x, B.y + B.h / 2], e: [B.x + B.w, B.y + B.h / 2] };
      for (const h of hs) { const [x, y] = pos[h.dataset.k]; h.style.left = P(x); h.style.top = P(y); }
    };
    place();
    let drag = null;
    const rel = (e) => { const r = ui.page.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const start = (e, k) => { e.preventDefault(); e.stopPropagation(); try { e.target.setPointerCapture(e.pointerId); } catch {} drag = { k, p: rel(e), b: { ...B } }; };
    frame.addEventListener('pointerdown', (e) => start(e, 'move'));
    for (const h of hs) h.addEventListener('pointerdown', (e) => start(e, h.dataset.k));
    window.addEventListener('pointermove', move);
    function move(e) {
      if (!drag) return;
      const [x, y] = rel(e); const dx = x - drag.p[0], dy = y - drag.p[1]; const b = drag.b;
      let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
      if (drag.k === 'move') { const w = b.w, h = b.h; x0 = clamp(b.x + dx, 0, 1 - w); y0 = clamp(b.y + dy, 0, 1 - h); x1 = x0 + w; y1 = y0 + h; }
      else {
        if (drag.k.includes('w')) x0 = clamp(b.x + dx, 0, x1 - 0.08);
        if (drag.k.includes('e')) x1 = clamp(b.x + b.w + dx, x0 + 0.08, 1);
        if (drag.k.includes('n')) y0 = clamp(b.y + dy, 0, y1 - 0.06);
        if (drag.k.includes('s')) y1 = clamp(b.y + b.h + dy, y0 + 0.06, 1);
      }
      B = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; place();
    }
    const up = () => { drag = null; };
    window.addEventListener('pointerup', up);
    const finish = (r) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ui.root.remove(); resolve(r); };
    const mk = (label, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), label); b.addEventListener('click', fn); ui.bar.append(b); return b; };
    mk('Whole page', '', () => { B = { x: 0, y: 0, w: 1, h: 1 }; place(); });
    mk('Use for every page', '', () => finish({ box: B, all: true }));
    ui.bar.append(el('p', 'hint', 'Drag the corners and sides. Your markings are kept; only what you see changes.'));
    ui.done.textContent = 'Crop this page';
    ui.done.addEventListener('click', () => finish({ box: B, all: false }));
    ui.cancel.addEventListener('click', () => finish(null));
  });
}

// ---------- cut ----------
// cuts: heights where this page is already cut; resolves the new list or null
export function openCutter({ doc, orig, cuts, pageLabel }) {
  return new Promise(async (resolve) => {
    const ui = shell('Cut the page', pageLabel || '');
    await drawPage(doc, orig, ui);
    const gaps = pageGaps(ui.cv);
    let C = (cuts && cuts.length ? cuts.slice() : []);
    // a first cut: the clean gap nearest the middle
    if (!C.length) { const g = gaps.filter((q) => q.mid > 0.15 && q.mid < 0.85).sort((a, b) => Math.abs(a.mid - 0.5) - Math.abs(b.mid - 0.5))[0]; C = [g ? g.mid : 0.5]; }
    const lines = [];
    const snap = (y) => { let best = null; for (const g of gaps) if (Math.abs(g.mid - y) < 0.035 && (!best || Math.abs(g.mid - y) < Math.abs(best.mid - y))) best = g; return best ? best.mid : y; };
    const draw = () => {
      for (const l of lines) l.remove(); lines.length = 0;
      C.sort((a, b) => a - b).forEach((y, i) => {
        const l = el('div', 'ptool-cut'); l.style.top = (y * 100).toFixed(3) + '%';
        const x = el('b', '', '✕'); x.setAttribute('aria-label', 'Remove this cut');
        x.addEventListener('pointerdown', (e) => { e.stopPropagation(); C.splice(i, 1); draw(); });
        l.append(x);
        l.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { l.setPointerCapture(e.pointerId); } catch {} drag = { i }; });
        ui.page.append(l); lines.push(l);
      });
      ui.t.lastChild.textContent = (pageLabel ? pageLabel + ' · ' : '') + (C.length ? `${C.length + 1} pieces` : 'Not cut');
    };
    let drag = null;
    const rel = (e) => { const r = ui.page.getBoundingClientRect(); return clamp((e.clientY - r.top) / r.height, 0.03, 0.97); };
    const move = (e) => { if (!drag) return; C[drag.i] = rel(e); lines[drag.i].style.top = (C[drag.i] * 100) + '%'; };
    const up = () => { if (drag) { C[drag.i] = snap(C[drag.i]); drag = null; draw(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    // tap the page to add a cut there
    ui.page.addEventListener('pointerdown', (e) => { if (e.target !== ui.cv) return; C.push(snap(rel(e))); draw(); });
    draw();
    const finish = (r) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ui.root.remove(); resolve(r); };
    ui.bar.append(el('p', 'hint', 'Tap the page to add a cut; drag a cut to move it. Cuts settle in the white space between systems. Each piece becomes its own page.'));
    const none = el('button', 'btn', 'Remove all cuts'); none.addEventListener('click', () => { C = []; draw(); }); ui.bar.prepend(none);
    ui.done.textContent = 'Cut';
    ui.done.addEventListener('click', () => finish(C.filter((y) => y > 0.03 && y < 0.97)));
    ui.cancel.addEventListener('click', () => finish(null));
  });
}

// ---------- move lines up from the next page ----------
// For a page turn in the middle of a line: pull the first lines of the next page up onto the end
// of this one. Left: this page as it will look. Right: the next page; drag the line down to the
// last system you want moved. Everything snaps to the white space between systems.
function inkRows(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data;
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x += 3) { const i = (y * w + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 420) n++; } rows[y] = n / (w / 3); }
  return rows;
}
function inkRuns(rows) {
  const runs = []; let s = -1;
  for (let y = 0; y <= rows.length; y++) { const ink = y < rows.length && rows[y] > 0.004; if (ink && s < 0) s = y; if (!ink && s >= 0) { runs.push([s / rows.length, y / rows.length]); s = -1; } }
  return runs;
}
export function openGluer({ doc, orig, next, glue, pageLabel }) {
  return new Promise(async (resolve) => {
    const root = el('section', 'ptool');
    const top = el('header', 'review-top');
    const cancel = el('button', 'btn ghost', 'Cancel');
    const t = el('div', 'review-title'); t.append(el('strong', '', 'Move lines up'), el('span', 'hint', pageLabel || ''));
    const done = el('button', 'btn primary', 'Done');
    top.append(cancel, t, done);
    const stage = el('div', 'ptool-stage ptool-two');
    const left = el('div', 'ptool-page'); const lc = el('canvas'); left.append(lc);
    const right = el('div', 'ptool-page'); const rc = el('canvas'); right.append(rc);
    const lCap = el('span', 'ptool-cap', 'This page'), rCap = el('span', 'ptool-cap', 'Next page');
    left.append(lCap); right.append(rCap);
    stage.append(left, right);
    const bar = el('div', 'ptool-bar');
    root.append(top, stage, bar);
    document.body.append(root);
    // size both pages to fit side by side
    const r = stage.getBoundingClientRect();
    const [pw, ph] = doc.sizes[orig], [nw, nh] = doc.sizes[next];
    const k = Math.min((r.width - 80) / 2 / pw, (r.height - 60) / (ph * 1.0));
    const W = Math.round(pw * k), H = Math.round(ph * k), NW = W, NH = Math.round(NW * nh / nw);
    right.style.width = NW + 'px'; right.style.height = NH + 'px';
    const dpr = Math.min(2, devicePixelRatio || 1);
    const a = document.createElement('canvas'), bcv = document.createElement('canvas');
    await doc.render(orig, a, W * dpr, H * dpr);
    await doc.render(next, bcv, NW * dpr, NH * dpr);
    rc.width = bcv.width; rc.height = bcv.height;
    // where this page's music ends and the next page's begins (skipping page numbers and headers)
    const aRuns = inkRuns(inkRows(a)), bRuns = inkRuns(inkRows(bcv));
    let endA = aRuns.length ? aRuns[aRuns.length - 1][1] : 1;
    if (aRuns.length > 1) { const l = aRuns[aRuns.length - 1], pv = aRuns[aRuns.length - 2]; if (l[1] - l[0] < 0.025 && l[0] - pv[1] > 0.03) endA = pv[1]; }
    endA = Math.min(1, endA + 0.012);
    let topB = bRuns.length ? bRuns[0][0] : 0;
    if (bRuns.length > 1 && bRuns[0][1] - bRuns[0][0] < 0.025 && bRuns[1][0] - bRuns[0][1] > 0.03) topB = bRuns[1][0];
    topB = Math.max(0, topB - 0.012);
    const gaps = pageGaps(bcv).filter((q) => q.mid > topB + 0.03);
    let cut = glue && glue.next === next ? glue.cut : (gaps.find((q) => q.len > 0.012) || { mid: 0.3 }).mid;
    const snap = (y) => { let best = null; for (const g of gaps) if (!best || Math.abs(g.mid - y) < Math.abs(best.mid - y)) best = g; return best && Math.abs(best.mid - y) < 0.06 ? best.mid : y; };
    const line = el('div', 'ptool-cut ptool-glue'); const grip = el('b', '', '↕'); line.append(grip); right.append(line);
    const paint = () => {
      // the next page, with the part that moves up tinted
      const g = rc.getContext('2d'); g.drawImage(bcv, 0, 0);
      g.fillStyle = 'rgba(43,111,214,0.13)'; g.fillRect(0, topB * rc.height, rc.width, (cut - topB) * rc.height);
      g.fillStyle = 'rgba(243,244,247,0.72)'; g.fillRect(0, 0, rc.width, topB * rc.height);
      line.style.top = (cut * 100) + '%';
      // this page as it will look: its music, then the moved lines
      const moved = (cut - topB) * bcv.height;
      const h1 = endA * a.height;
      const total = h1 + moved;
      lc.width = a.width; lc.height = Math.round(total);
      const lg = lc.getContext('2d'); lg.fillStyle = '#fff'; lg.fillRect(0, 0, lc.width, lc.height);
      lg.drawImage(a, 0, 0, a.width, h1, 0, 0, a.width, h1);
      lg.drawImage(bcv, 0, topB * bcv.height, bcv.width, moved, 0, h1, a.width, moved);
      lg.fillStyle = 'rgba(43,111,214,0.10)'; lg.fillRect(0, h1, lc.width, moved);
      const sh = total / dpr; const sc = Math.min(1, (r.height - 60) / sh);
      left.style.width = Math.round(W * sc) + 'px'; left.style.height = Math.round(sh * sc) + 'px';
      const pct = Math.round((total / a.height) * 100);
      t.lastChild.textContent = (pageLabel ? pageLabel + ' · ' : '') + (pct > 100 ? `The page grows to ${pct}% of its height, so it shows a little smaller.` : '');
    };
    let drag = false;
    const rel = (e) => { const rr = right.getBoundingClientRect(); return clamp((e.clientY - rr.top) / rr.height, topB + 0.03, 0.97); };
    line.addEventListener('pointerdown', (e) => { e.preventDefault(); try { line.setPointerCapture(e.pointerId); } catch {} drag = true; });
    right.addEventListener('pointerdown', (e) => { if (e.target === line || e.target === grip) return; cut = snap(rel(e)); paint(); });
    const move = (e) => { if (!drag) return; cut = rel(e); paint(); };
    const up = () => { if (drag) { drag = false; cut = snap(cut); paint(); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    paint();
    const finish = (res) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); a.width = bcv.width = 0; root.remove(); resolve(res); };
    bar.append(el('p', 'hint', 'Drag the blue line on the next page (or tap a gap) to choose how many lines move up. The original file is not changed.'));
    if (glue) { const off = el('button', 'btn', 'Put them back'); off.addEventListener('click', () => finish({ remove: true })); bar.prepend(off); }
    done.textContent = 'Move up';
    done.addEventListener('click', () => finish({ next, cut: +cut.toFixed(4), top: +topB.toFixed(4), end: +endA.toFixed(4) }));
    cancel.addEventListener('click', () => finish(null));
  });
}
