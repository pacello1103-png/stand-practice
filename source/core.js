const n = F.length;
const ic = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const pad = (k) => String(k).padStart(2, '0');
const img = (s) => `img/m_${s}.webp`;
const PHONE_MQ = '(max-width: 760px), (max-height: 560px) and (orientation: landscape) and (max-width: 1000px)';
const phoneQ = () => matchMedia(PHONE_MQ).matches;
const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const narrow = () => matchMedia('(max-width: 900px)').matches;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- the drawer ---------- */
const drawer = document.getElementById('drawer');
const els = [];
F.forEach((f, i) => {
  const b = document.createElement('button');
  b.className = 'folder'; b.dataset.id = f.id; b.style.setProperty('--i', i);
  THEME.tone(b, f, i);
  b.setAttribute('aria-label', `${f.title}: ${f.lead}`);
  b.innerHTML = THEME.folder(f, i);
  b.addEventListener('click', () => openFolder(i, b));
  b.addEventListener('mouseenter', () => { if (canHover()) hover(i); });
  b.addEventListener('focus', () => { if (b.matches(':focus-visible')) hover(i); });
  b.addEventListener('blur', () => hover(-1));
  drawer.append(b); els.push(b);
});
const cover = document.createElement('div');
cover.className = 'folder cover'; cover.style.setProperty('--i', n);
cover.innerHTML = THEME.cover();
drawer.append(cover);
drawer.addEventListener('mouseleave', () => hover(-1));

function place() {
  if (phoneQ()) { [...els, cover].forEach((e) => { e.style.left = ''; e.style.width = ''; e.style.zIndex = ''; }); drawer.classList.remove('tight'); return; }
  const W = drawer.clientWidth, H = drawer.clientHeight;
  let coverW = Math.min(560, Math.max(380, W * 0.38));
  /* every folder keeps a strip wide enough for its name; on narrow screens the cover gives a little room */
  const minStrip = 62;
  if ((W - coverW - 34) / n < minStrip) coverW = Math.max(330, W - 34 - n * minStrip);
  const strip = Math.max(52, (W - coverW - 34) / n);
  const fw = Math.min(600, W * 0.46);
  drawer.classList.toggle('tight', strip < 120);
  const step = Math.min(78, (H - THEME.tabH - 40 - H * 0.34) / (n - 1));
  els.forEach((e, i) => {
    e.style.left = (34 + i * strip) + 'px'; e.style.width = fw + 'px'; e.style.zIndex = i + 1;
    e.style.setProperty('--strip', strip + 'px');
    e.style.setProperty('--tab-y', Math.round(H * 0.34 + i * step) + 'px');
  });
  /* if any folder's list does not fit its strip, every folder shows only its name (they stay alike) */
  if (!drawer.classList.contains('tight') && els.some((e) => { const st = e.querySelector('.strip'); return st && st.scrollHeight > st.clientHeight + 1; })) drawer.classList.add('tight');
  cover.style.left = (W - coverW) + 'px'; cover.style.width = coverW + 'px'; cover.style.zIndex = n + 2;
  drawer.style.setProperty('--shift', Math.max(120, Math.min(300, fw - strip - 30)) + 'px');
}
function hover(k) {
  if (phoneQ()) return;
  els.forEach((e, i) => { e.classList.toggle('lift', i === k); e.classList.toggle('shift', k >= 0 && i > k); });
}
addEventListener('resize', place); place();
/* the folders are dealt onto the table when the page opens; on a computer the first one then lifts once, to show they open */
let touched = false;
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((t) => addEventListener(t, () => { touched = true; }, { once: true, passive: true }));
if (!reduce()) {
  drawer.classList.add('intro');
  setTimeout(() => drawer.classList.remove('intro'), 1500);
  let seen = false; try { seen = sessionStorage.getItem('stand-nudge') === '1'; sessionStorage.setItem('stand-nudge', '1'); } catch {}
  if (!seen) setTimeout(() => {
    if (touched || !canHover() || phoneQ() || !sheet.hidden) return;
    hover(0); setTimeout(() => { if (!touched) hover(-1); }, 1100);
  }, 1900);
}

/* ---------- the open folder ---------- */
const sheet = document.getElementById('sheet'), body = document.getElementById('sheetBody');
const barT = document.getElementById('barTitle'), barC = document.getElementById('barCh');
let cur = -1, busy = false, io = null, ioR = null, active = -1, origin = null;

function extra(c) {
  if (c.grid) return `<div class="grid rv">${c.grid.map(([t, s]) => `<div class="sq"><b>${t}</b><span>${s}</span></div>`).join('')}</div>`;
  if (c.steps) return `<ol class="steps rv">${c.steps.map((t, k) => `<li><span>${k + 1}</span>${t}</li>`).join('')}</ol>`;
  if (c.chips) return `<div class="chips rv">${c.chips.map((t) => `<span>${t}</span>`).join('')}</div>`;
  return '';
}
const frame = (c, cls = '') => c.phone
  ? `<div class="dev phone ${cls}"><img src="${img(c.phone)}" alt="${fmt(U.onIphone, { x: c.name })}" decoding="async"></div>`
  : `<div class="dev ipad ${cls}"><img src="${img(c.shot)}" alt="${c.name}" decoding="async"></div>`;

function fill(i) {
  const f = F[i], next = F[(i + 1) % n];
  const endcta = `<div class="endcta"><div><b>Stand</b><span>${U.endcta}</span></div>${ctaHTML()}</div>`;
  THEME.tone(sheet, f, i);
  barT.innerHTML = `${ic(f.icon)}<span>${phoneQ() ? (f.short || f.title) : f.title}</span>`; barC.textContent = '';
  body.innerHTML = `
    <header class="hero">
      <div class="htext">
        <span class="eyebrow rv">${THEME.eyebrow(f, i)}</span>
        <h2 class="rv" id="sheetTitle">${f.title}</h2>
        <p class="lead rv">${f.lead}</p>
        <div class="tiles rv" role="list">${f.ch.map((c, k) => `<button role="listitem" data-to="${k}">${ic(c.icon)}<span>${c.name}</span></button>`).join('')}</div>
        <span class="scrollhint rv" aria-hidden="true">${U.scroll}<i></i></span>
      </div>
      <div class="hdev rv" aria-hidden="true"><div class="dev ipad"><img src="${img(f.shot)}" alt="" decoding="async"></div></div>
    </header>
    <div class="story">
      <div class="chapters">${f.ch.map((c, k) => `
        <article class="ch" data-k="${k}" id="ch-${c.id}">
          <div class="chin">
            <span class="kicker rv">${ic(c.icon)}${c.name}</span>
            <h3 class="rv">${c.h}</h3>
            <p class="rv">${c.p}</p>
            ${extra(c)}
            <div class="inline rv">${frame(c)}</div>
          </div>
        </article>`).join('')}
      </div>
      <div class="media" aria-hidden="true"><div class="stage">${f.ch.map((c, k) => frame(c, k === 0 ? 'on' : 'after')).join('')}</div></div>
    </div>
    <footer class="nextf">
      <button class="nextcard" data-go="${(i + 1) % n}">
        <span class="nt"><small>${U.next}</small><b>${next.title}</b><em>${next.lead}</em></span>
        <span class="np"><img src="${img(next.shot)}" alt="" loading="lazy" decoding="async"></span>
      </button>
      <div class="others">${F.map((g, k) => `<button data-go="${k}" ${k === i ? 'aria-current="true"' : ''}>${ic(g.icon)}${g.short || g.title}</button>`).join('')}</div>
      ${endcta}
    </footer>`;
  THEME.tone(body.querySelector('.nextcard'), next, (i + 1) % n);
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.go)));
  body.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => toCh(+b.dataset.to)));
  active = -1; watch(); setActive(0); fitTitles(); if (typeof sizeDevs === 'function') sizeDevs(body);
}
/* big titles shrink until their longest word fits the column (long names in some languages) */
function fitTitles() {
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (!sheet.hidden) fitTitles(); });
  body.querySelectorAll('.hero h2, .nextcard b').forEach((el) => {
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize), n = 0;
    while (el.scrollWidth > el.clientWidth + 1 && fs > 30 && n++ < 60) { fs -= 3; el.style.fontSize = fs + 'px'; }
  });
}
addEventListener('resize', () => { if (!sheet.hidden) fitTitles(); });
function toCh(k) {
  const el = body.querySelectorAll('.ch')[k]; if (!el) return;
  const y = el.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop - (narrow() ? 70 : 0);
  sheet.scrollTo({ top: y, behavior: reduce() ? 'auto' : 'smooth' });
}
function setActive(k) {
  if (k === active) return;
  active = k;
  const f = F[cur]; if (!f) return;
  body.querySelectorAll('.ch').forEach((c, j) => c.classList.toggle('now', j === k));
  body.querySelectorAll('.media .dev').forEach((d, j) => { d.classList.toggle('on', j === k); d.classList.toggle('before', j < k); d.classList.toggle('after', j > k); });
  body.querySelectorAll('.tiles button').forEach((b, j) => b.classList.toggle('now', j === k));
  barC.classList.remove('show');
  requestAnimationFrame(() => { barC.textContent = f.ch[k].name; barC.classList.add('show'); });
}
function watch() {
  io && io.disconnect(); ioR && ioR.disconnect();
  /* reveal: things rise into place as they come up, and settle back when you scroll away above them */
  ioR = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) e.target.classList.add('in');
    else if (e.boundingClientRect.top > 0) e.target.classList.remove('in');
  }), { root: sheet, threshold: 0.12 });
  body.querySelectorAll('.rv').forEach((el) => ioR.observe(el));
  /* the chapter in the middle of the screen is the one shown on the iPad */
  io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setActive(+e.target.dataset.k); }),
    { root: sheet, rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  body.querySelectorAll('.ch').forEach((el) => io.observe(el));
}
sheet.addEventListener('scroll', () => {
  const p = sheet.scrollTop / Math.max(1, sheet.scrollHeight - sheet.clientHeight);
  sheet.style.setProperty('--p', p.toFixed(4));
  sheet.classList.toggle('scrolled', sheet.scrollTop > 40);
}, { passive: true });

const clip = (r) => `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px round 18px)`;
/* lock the page behind the open folder, so iPhone Safari cannot scroll it away underneath */
let savedY = 0;
function lock() {
  if (document.body.classList.contains('locked')) return;
  savedY = scrollY; document.body.style.top = -savedY + 'px'; document.body.classList.add('locked');
}
function unlock() {
  if (!document.body.classList.contains('locked')) return;
  document.body.classList.remove('locked'); document.body.style.top = '';
  scrollTo(0, savedY); requestAnimationFrame(() => { if (Math.abs(scrollY - savedY) > 2) scrollTo(0, savedY); });
}
function show() { lock(); sheet.hidden = false; sheet.scrollTop = 0; }
/* the folder is a history step, so the iPhone back swipe or the browser Back button closes it instead of leaving the site */
let pushed = false;
try { history.scrollRestoration = 'manual'; } catch {}
const setHash = (id, push) => {
  try {
    if (push) { history.pushState({ stand: id }, '', '#' + id); pushed = true; }
    else history.replaceState(pushed ? { stand: id } : null, '', id ? '#' + id : location.pathname + location.search);
  } catch {}
};
async function openFolder(i, el) {
  if (busy) return; busy = true; cur = i; origin = el;
  hover(-1); show(); fill(i);
  setHash(F[i].id, true);
  if (reduce()) { sheet.classList.add('in'); busy = false; document.getElementById('closeBtn').focus(); return; }
  sheet.hidden = true;
  el.classList.remove('shift'); el.classList.add('pull');
  await new Promise((r) => setTimeout(r, 190));
  const r = el.getBoundingClientRect();
  sheet.hidden = false;
  const a = sheet.animate([{ clipPath: clip(r) }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' });
  setTimeout(() => sheet.classList.add('in'), 180);
  await a.finished.catch(() => {});
  el.classList.remove('pull'); busy = false;
  document.getElementById('closeBtn').focus({ preventScroll: true });
}
async function closeFolder(fromHistory = false) {
  if (busy || sheet.hidden) return; busy = true;
  const el = origin && document.contains(origin) ? origin : els[cur];
  if (!fromHistory) setHash('', false);
  pushed = false;
  if (!reduce() && el && !(fromHistory && !canHover())) {
    sheet.classList.remove('in');
    const a = sheet.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: clip(el.getBoundingClientRect()) }], { duration: 440, easing: 'cubic-bezier(.4,0,.2,1)' });
    await a.finished.catch(() => {});
  }
  origin = null;
  sheet.hidden = true; sheet.classList.remove('in', 'scrolled', 'leaving'); sheet.getAnimations().forEach((a) => a.cancel());
  unlock(); hover(-1);
  document.querySelectorAll('.pull').forEach((e) => e.classList.remove('pull'));
  els.forEach((e) => e.classList.remove('lift', 'shift'));
  io && io.disconnect(); ioR && ioR.disconnect();
  busy = false; if (el && canHover()) el.focus({ preventScroll: true });
}
function go(i) {
  if (busy) return; busy = true;
  origin = null;
  const run = () => { cur = i; sheet.scrollTop = 0; fill(i); setHash(F[i].id, false); };
  if (reduce()) { run(); sheet.classList.add('in'); busy = false; return; }
  sheet.classList.add('leaving');
  setTimeout(() => {
    sheet.classList.remove('in'); run();
    sheet.classList.remove('leaving');
    requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('in'); busy = false; }));
  }, 320);
}
/* close: step back through history when we added the step, otherwise just close */
function requestClose() {
  if (busy || sheet.hidden) return;
  if (pushed && history.state && history.state.stand) history.back();
  else closeFolder();
}
document.getElementById('closeBtn').addEventListener('click', requestClose);
addEventListener('popstate', () => {
  const k = F.findIndex((f) => '#' + f.id === location.hash);
  if (k < 0) { if (!sheet.hidden) { busy = false; closeFolder(true); } return; }
  if (sheet.hidden) { cur = k; pushed = true; show(); fill(k); sheet.classList.add('in'); }
  else if (k !== cur) { busy = false; go(k); }
});
/* coming back to the page from another site (Safari back-forward cache): never leave the page locked or half-open */
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  busy = false; els.forEach((x) => x.classList.remove('pull', 'lift', 'shift'));
  if (sheet.hidden) { unlock(); document.body.classList.remove('locked'); document.body.style.top = ''; }
  else sheet.classList.add('in');
});
document.getElementById('prevBtn').addEventListener('click', () => go((cur + n - 1) % n));
document.getElementById('nextBtn').addEventListener('click', () => go((cur + 1) % n));
addEventListener('keydown', (e) => {
  if (sheet.hidden) return;
  if (e.key === 'Escape') requestClose();
  if (e.key === 'ArrowRight') go((cur + 1) % n);
  if (e.key === 'ArrowLeft') go((cur + n - 1) % n);
});
/* highlights on the home page open a folder at the right chapter */
async function openAt(id, chId, el) {
  const i = F.findIndex((f) => f.id === id); if (i < 0) return;
  await openFolder(i, el || els[i]);
  const k = F[i].ch.findIndex((c) => c.id === chId);
  if (k > 0) setTimeout(() => toCh(k), reduce() ? 0 : 120);
}
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openAt(b.dataset.open, b.dataset.ch, b.closest('.high') || b)));
const barCta = document.getElementById('barCta'); if (barCta) barCta.innerHTML = ctaHTML();
/* every iPad and iPhone picture knows its own width, so bezel and corners stay in proportion */
const devRO = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((e) => e.target.style.setProperty('--w', e.target.offsetWidth + 'px'))) : null;
function sizeDevs(root = document) {
  root.querySelectorAll('.dev').forEach((d) => {
    d.style.setProperty('--w', (d.offsetWidth || 0) + 'px');
    if (devRO && !d.dataset.ro) { devRO.observe(d); d.dataset.ro = '1'; }
  });
}
sizeDevs();
const start = F.findIndex((f) => '#' + f.id === location.hash);
if (start >= 0) { cur = start; show(); fill(start); sheet.classList.add('in'); }
matchMedia(PHONE_MQ).addEventListener?.('change', () => { hover(-1); place(); });
