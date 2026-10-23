const n = F.length;
const ic = (id, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const pad = (k) => String(k).padStart(2, '0');
const img = (s) => `img/m_${s}.webp`;
const phoneQ = () => matchMedia('(max-width: 760px)').matches;
const narrow = () => matchMedia('(max-width: 900px)').matches;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- the drawer ---------- */
const drawer = document.getElementById('drawer');
const els = [];
F.forEach((f, i) => {
  const b = document.createElement('button');
  b.className = 'folder'; b.dataset.id = f.id;
  THEME.tone(b, f, i);
  b.setAttribute('aria-label', `${f.title}: ${f.lead}`);
  b.innerHTML = THEME.folder(f, i);
  b.addEventListener('click', () => openFolder(i, b));
  b.addEventListener('mouseenter', () => hover(i));
  b.addEventListener('focus', () => hover(i));
  drawer.append(b); els.push(b);
});
const cover = document.createElement('div');
cover.className = 'folder cover';
cover.innerHTML = THEME.cover();
drawer.append(cover);
drawer.addEventListener('mouseleave', () => hover(-1));

function place() {
  if (phoneQ()) { [...els, cover].forEach((e) => { e.style.left = ''; e.style.width = ''; e.style.zIndex = ''; }); return; }
  const W = drawer.clientWidth, H = drawer.clientHeight;
  const coverW = Math.min(560, Math.max(380, W * 0.38));
  const strip = Math.max(70, (W - coverW - 34) / n);
  const fw = Math.min(600, W * 0.46);
  const step = Math.min(78, (H - THEME.tabH - 40 - H * 0.34) / (n - 1));
  els.forEach((e, i) => {
    e.style.left = (34 + i * strip) + 'px'; e.style.width = fw + 'px'; e.style.zIndex = i + 1;
    e.style.setProperty('--strip', strip + 'px');
    e.style.setProperty('--tab-y', Math.round(H * 0.34 + i * step) + 'px');
  });
  cover.style.left = (W - coverW) + 'px'; cover.style.width = coverW + 'px'; cover.style.zIndex = n + 2;
  drawer.style.setProperty('--shift', Math.max(120, Math.min(300, fw - strip - 30)) + 'px');
}
function hover(k) {
  if (phoneQ()) return;
  els.forEach((e, i) => { e.classList.toggle('lift', i === k); e.classList.toggle('shift', k >= 0 && i > k); });
}
addEventListener('resize', place); place();

/* ---------- the open folder ---------- */
const sheet = document.getElementById('sheet'), body = document.getElementById('sheetBody');
const barT = document.getElementById('barTitle'), barC = document.getElementById('barCh');
let cur = -1, busy = false, io = null, ioR = null, active = -1;

function extra(c) {
  if (c.grid) return `<div class="grid rv">${c.grid.map(([t, s]) => `<div class="sq"><b>${t}</b><span>${s}</span></div>`).join('')}</div>`;
  if (c.steps) return `<ol class="steps rv">${c.steps.map((t, k) => `<li><span>${k + 1}</span>${t}</li>`).join('')}</ol>`;
  if (c.chips) return `<div class="chips rv">${c.chips.map((t) => `<span>${t}</span>`).join('')}</div>`;
  return '';
}
const frame = (c, cls = '') => c.phone
  ? `<div class="dev phone ${cls}"><img src="${img(c.phone)}" alt="${c.name} on iPhone" decoding="async"></div>`
  : `<div class="dev ipad ${cls}"><img src="${img(c.shot)}" alt="${c.name}" decoding="async"></div>`;

function fill(i) {
  const f = F[i], next = F[(i + 1) % n];
  THEME.tone(sheet, f, i);
  barT.innerHTML = `${ic(f.icon)}<span>${f.title}</span>`; barC.textContent = '';
  body.innerHTML = `
    <header class="hero">
      <div class="htext">
        <span class="eyebrow rv">${THEME.eyebrow(f, i)}</span>
        <h2 class="rv" id="sheetTitle">${f.title}</h2>
        <p class="lead rv">${f.lead}</p>
        <div class="tiles rv" role="list">${f.ch.map((c, k) => `<button role="listitem" data-to="${k}">${ic(c.icon)}<span>${c.name}</span></button>`).join('')}</div>
        <span class="scrollhint rv" aria-hidden="true">Scroll<i></i></span>
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
        <span class="nt"><small>Next folder</small><b>${next.title}</b><em>${next.lead}</em></span>
        <span class="np"><img src="${img(next.shot)}" alt="" loading="lazy" decoding="async"></span>
      </button>
      <div class="others">${F.map((g, k) => `<button data-go="${k}" ${k === i ? 'aria-current="true"' : ''}>${ic(g.icon)}${g.short || g.title}</button>`).join('')}</div>
    </footer>`;
  THEME.tone(body.querySelector('.nextcard'), next, (i + 1) % n);
  body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.go)));
  body.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => toCh(+b.dataset.to)));
  active = -1; watch(); setActive(0);
}
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
function show() { sheet.hidden = false; sheet.scrollTop = 0; document.body.style.overflow = 'hidden'; }
async function openFolder(i, el) {
  if (busy) return; busy = true; cur = i;
  show(); fill(i);
  try { history.replaceState(null, '', '#' + F[i].id); } catch {}
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
async function closeFolder() {
  if (busy || sheet.hidden) return; busy = true;
  const el = els[cur];
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  if (!reduce() && el) {
    sheet.classList.remove('in');
    const a = sheet.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: clip(el.getBoundingClientRect()) }], { duration: 440, easing: 'cubic-bezier(.4,0,.2,1)' });
    await a.finished.catch(() => {});
  }
  sheet.hidden = true; sheet.classList.remove('in', 'scrolled'); document.body.style.overflow = '';
  io && io.disconnect(); ioR && ioR.disconnect();
  busy = false; if (el) el.focus({ preventScroll: true });
}
function go(i) {
  if (busy) return; busy = true;
  const run = () => { cur = i; sheet.scrollTop = 0; fill(i); try { history.replaceState(null, '', '#' + F[i].id); } catch {} };
  if (reduce()) { run(); sheet.classList.add('in'); busy = false; return; }
  sheet.classList.add('leaving');
  setTimeout(() => {
    sheet.classList.remove('in'); run();
    sheet.classList.remove('leaving');
    requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('in'); busy = false; }));
  }, 320);
}
document.getElementById('closeBtn').addEventListener('click', closeFolder);
document.getElementById('prevBtn').addEventListener('click', () => go((cur + n - 1) % n));
document.getElementById('nextBtn').addEventListener('click', () => go((cur + 1) % n));
addEventListener('keydown', (e) => {
  if (sheet.hidden) return;
  if (e.key === 'Escape') closeFolder();
  if (e.key === 'ArrowRight') go((cur + 1) % n);
  if (e.key === 'ArrowLeft') go((cur + n - 1) % n);
});
const start = F.findIndex((f) => '#' + f.id === location.hash);
if (start >= 0) { cur = start; show(); fill(start); sheet.classList.add('in'); }
