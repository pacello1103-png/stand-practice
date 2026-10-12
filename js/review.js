// Review of pages before they join the library. Every page can be straightened, cleaned (the paper
// is whitened and the shadows removed), turned, cropped, and made black and white.
// Used for scans from the page scanner and for photos or image files brought in from Files.
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

const DEFAULTS = () => ({ rot: 0, bw: false, clean: true, contrast: 60, crop: { t: 0, b: 0, l: 0, r: 0 } });
const R = { pages: [], cur: 0, name: '', paths: [], commit: null, token: 0, busy: false };
let deps = { commit: null, toast: () => {}, release: () => {} };

export function initReview(d) { deps = { ...deps, ...d }; wire(); }

// Open the review with page images (Blobs or Files). `paths` are native files to release after saving.
export function openReview(blobs, name, { paths = [], onDone = null } = {}) {
  if (!blobs.length) return;
  R.pages = blobs.map((b) => ({ src: b, bmp: null, ...DEFAULTS() }));
  R.cur = 0; R.name = name; R.paths = paths; R.onDone = onDone;
  $('#review').hidden = false;
  document.body.classList.add('reviewing');
  syncTools(); draw(); strip();
}
// Closing always releases the native files that came with the pages (they are kept only until here).
function closeReview() {
  $('#review').hidden = true;
  document.body.classList.remove('reviewing');
  const done = R.onDone; R.pages = []; R.onDone = null;
  if (done) done();
}

// ---------- image pipeline ----------
async function bitmapOf(p) { if (!p.bmp) p.bmp = await createImageBitmap(p.src); return p.bmp; }

// Rotate, crop and scale one page onto a canvas.
async function straightCanvas(p, maxSide) {
  const bmp = await bitmapOf(p);
  const rot = ((p.rot % 360) + 360) % 360, swap = rot === 90 || rot === 270;
  const W = swap ? bmp.height : bmp.width, H = swap ? bmp.width : bmp.height;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const c0 = document.createElement('canvas'); c0.width = Math.round(W * k); c0.height = Math.round(H * k);
  const g0 = c0.getContext('2d');
  g0.save(); g0.translate(c0.width / 2, c0.height / 2); g0.rotate((rot * Math.PI) / 180);
  g0.drawImage(bmp, (-bmp.width * k) / 2, (-bmp.height * k) / 2, bmp.width * k, bmp.height * k); g0.restore();
  const { t, b, l, r } = p.crop;
  const sx = Math.round(l * c0.width), sy = Math.round(t * c0.height);
  const sw = Math.max(1, Math.round(c0.width * (1 - l - r))), sh = Math.max(1, Math.round(c0.height * (1 - t - b)));
  const c1 = document.createElement('canvas'); c1.width = sw; c1.height = sh;
  c1.getContext('2d').drawImage(c0, sx, sy, sw, sh, 0, 0, sw, sh);
  return c1;
}

// Whiten the paper and remove shadows: the paper's brightness is estimated on a coarse grid
// (the brightest value in each cell, which ignores dark ink) and every pixel is scaled to it.
function flattenPaper(c) {
  const w = c.width, h = c.height, g = c.getContext('2d');
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const cell = Math.max(4, Math.round(Math.max(w, h) / 60));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let bg = new Float32Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    let m = 0;
    for (let y = cy * cell; y < Math.min(h, cy * cell + cell); y++) for (let x = cx * cell; x < Math.min(w, cx * cell + cell); x++) {
      const i = (y * w + x) * 4; const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; if (lum > m) m = lum;
    }
    bg[cy * gw + cx] = m;
  }
  // smooth the grid so the correction never shows edges
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bg.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        s += bg[yy * gw + xx]; n++;
      }
      nb[y * gw + x] = s / n;
    }
    bg = nb;
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, y / cell), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, x / cell), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const b = (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) + (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
      const k = 248 / Math.max(b, 60), i = (y * w + x) * 4;
      d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  g.putImageData(img, 0, 0);
}

// Contrast and black and white, applied to the pixels.
function toneCanvas(c, p) {
  const g = c.getContext('2d'), img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const stretch = 0.8 + (p.contrast / 100) * 1.0;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], gg = d[i + 1], b = d[i + 2];
    if (p.bw) { const y = 0.299 * r + 0.587 * gg + 0.114 * b; r = gg = b = y; }
    d[i] = clamp((r - 128) * stretch + 128); d[i + 1] = clamp((gg - 128) * stretch + 128); d[i + 2] = clamp((b - 128) * stretch + 128);
  }
  g.putImageData(img, 0, 0);
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

async function renderPage(p, maxSide) {
  const c = await straightCanvas(p, maxSide);
  if (p.clean) flattenPaper(c);
  toneCanvas(c, p);
  return c;
}

// ---------- the screen ----------
let drawT = 0;
function draw() {
  clearTimeout(drawT);
  drawT = setTimeout(async () => {
    const token = ++R.token;
    const p = R.pages[R.cur]; if (!p) return;
    $('#revBusy').hidden = false;
    const c = await renderPage(p, 1100);
    if (token !== R.token) return;
    const view = $('#revCanvas');
    view.width = c.width; view.height = c.height;
    view.getContext('2d').drawImage(c, 0, 0);
    $('#revBusy').hidden = true;
    $('#revSub').textContent = `Page ${R.cur + 1} of ${R.pages.length}`;
    $('#revTitle').textContent = 'Review';
    $('#revSave').disabled = !R.pages.length;
  }, 40);
}
async function strip() {
  const box = $('#revStrip'); box.textContent = '';
  R.pages.forEach((p, i) => {
    const b = el('button', 'rev-thumb' + (i === R.cur ? ' on' : ''));
    b.setAttribute('aria-label', `Page ${i + 1}`);
    const cv = el('canvas'); b.append(cv, el('span', 'num', String(i + 1)));
    b.addEventListener('click', () => { R.cur = i; syncTools(); draw(); strip(); });
    box.append(b);
    renderPage(p, 160).then((c) => { cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); }).catch(() => {});
  });
  const on = box.querySelector('.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function syncTools() {
  const p = R.pages[R.cur] || DEFAULTS();
  $$('#revColour button').forEach((b) => b.classList.toggle('on', (b.dataset.bw === '1') === !!p.bw));
  $('#revClean').checked = !!p.clean;
  $('#revContrast').value = p.contrast;
  for (const k of ['t', 'b', 'l', 'r']) $('#crop' + k.toUpperCase()).value = Math.round(p.crop[k] * 100);
  $('#revApplyAll').disabled = R.pages.length < 2;
}
const $$ = (s) => [...document.querySelectorAll(s)];
function change(fn) {
  const p = R.pages[R.cur]; if (!p) return;
  fn(p); syncTools(); draw(); strip();
}

function wire() {
  $('#revCancel').addEventListener('click', () => {
    if (R.pages.length && !confirm('Discard these pages?')) return;
    closeReview();
    deps.toast('Nothing was added.');
  });
  $('#revRotL').addEventListener('click', () => change((p) => { p.rot = (p.rot + 270) % 360; }));
  $('#revRotR').addEventListener('click', () => change((p) => { p.rot = (p.rot + 90) % 360; }));
  $('#revDelete').addEventListener('click', () => {
    if (!R.pages.length) return;
    R.pages.splice(R.cur, 1);
    if (!R.pages.length) { closeReview(); deps.toast('No pages left.'); return; }
    R.cur = Math.min(R.cur, R.pages.length - 1); syncTools(); draw(); strip();
  });
  $$('#revColour button').forEach((b) => b.addEventListener('click', () => change((p) => { p.bw = b.dataset.bw === '1'; })));
  $('#revClean').addEventListener('change', (e) => change((p) => { p.clean = e.target.checked; }));
  $('#revContrast').addEventListener('input', (e) => change((p) => { p.contrast = +e.target.value; }));
  for (const k of ['t', 'b', 'l', 'r']) $('#crop' + k.toUpperCase()).addEventListener('input', (e) => change((p) => { p.crop[k] = Math.min(0.4, +e.target.value / 100); }));
  $('#revApplyAll').addEventListener('click', () => {
    const p = R.pages[R.cur]; if (!p) return;
    for (const q of R.pages) { q.rot = p.rot; q.bw = p.bw; q.clean = p.clean; q.contrast = p.contrast; q.crop = { ...p.crop }; }
    deps.toast('Applied to all pages.'); draw(); strip();
  });
  $('#revSave').addEventListener('click', save);
}

// Render every page at full size and add the result as one score.
async function save() {
  if (!R.pages.length || R.busy) return;
  R.busy = true; $('#revSave').disabled = true; $('#revBusy').hidden = false;
  try {
    const blobs = [];
    for (let i = 0; i < R.pages.length; i++) {
      $('#revSub').textContent = `Preparing page ${i + 1} of ${R.pages.length}…`;
      const c = await renderPage(R.pages[i], 2400);
      blobs.push(await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9)));
    }
    const name = R.name || 'Scan.jpg';
    await deps.commit(blobs, name);
    closeReview();
  } catch (err) {
    console.error(err); deps.toast('Those pages could not be saved.', 3500);
  } finally {
    R.busy = false; $('#revSave').disabled = false; $('#revBusy').hidden = true;
  }
}
