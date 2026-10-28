/* ---------- the home page below the folders: highlights, tools, privacy, questions, last call ---------- */
(() => {
  const host = document.getElementById('more'); if (!host) return;
  const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const title = (id) => (F.find((f) => f.id === id) || {}).title || '';
  host.innerHTML = `
    <section class="uniq" aria-labelledby="uniqH">
      <div class="uhead">
        <span class="hk"><i></i>${U.uniqK}</span>
        <h2 id="uniqH">${U.uniqH}</h2>
        <p>${U.uniqP}</p>
      </div>
      <div class="ugrid">${UNIQ.map(([i, f, c, t, l], k) => `
        <button class="ucard rise" style="--i:${k}" data-open="${f}" data-ch="${c}" data-tone="${f}">
          <span class="un">${String(k + 1).padStart(2, '0')}</span>${icon(i)}
          <b>${t}</b><span class="ul">${l}</span>
          <svg class="ua" aria-hidden="true"><use href="#i-chev-r"/></svg>
        </button>`).join('')}
      </div>
    </section>

    <section class="highs" aria-label="Highlights">
      ${HIGH.map((h, k) => `
      <article class="high${k % 2 ? ' flip' : ''}" data-tone="${h.to[0]}">
        <div class="htx">
          <span class="hk"><i></i>${String(k + 1).padStart(2, '0')} · ${h.k}</span>
          <h2>${h.h}</h2>
          <p>${h.p}</p>
          <button class="hopen" data-open="${h.to[0]}" data-ch="${h.to[1]}">${fmt(U.openF, { x: title(h.to[0]) })}<svg aria-hidden="true"><use href="#i-chev-r"/></svg></button>
        </div>
        <div class="hpics${h.phone ? ' two' : ''}" aria-hidden="true">
          <div class="dev ipad">${h.vid ? vidHTML(h.vid) : `<img src="img/s_${h.shot}.webp" alt="" loading="lazy" decoding="async">`}</div>
          ${h.phone ? `<div class="dev phone"><img src="img/${h.phone}.webp" alt="" loading="lazy" decoding="async"></div>` : ''}
        </div>
      </article>`).join('')}
    </section>

    <section class="private" aria-labelledby="privH">
      <h2 id="privH">${U.privH}</h2>
      <div>
        <p>${U.privP}</p>
        <a class="plink" href="privacy.html">${U.privLink}<svg aria-hidden="true"><use href="#i-chev-r"/></svg></a>
      </div>
    </section>

    <section class="faq" aria-labelledby="faqH">
      <h2 id="faqH">${U.faqH}</h2>
      <div class="qs">${FAQ.map(([q, a]) => `<details><summary>${q}<span class="pm" aria-hidden="true"></span></summary><p>${a}</p></details>`).join('')}</div>
    </section>

    <section class="final" aria-labelledby="finalH">
      <div class="fbig" aria-hidden="true">${[...'Stand'].map((c, k) => `<span style="--i:${k}">${c}</span>`).join('')}</div>
      <div class="ftx">
        <h2 id="finalH">${U.h1}</h2>
        <div class="cta-row">${ctaHTML()}<span class="ctanote">${U.finalNote}</span></div>
      </div>
    </section>`;
  host.querySelectorAll('[data-tone]').forEach((el) => THEME.tone(el, F.find((f) => f.id === el.dataset.tone)));
  /* each highlight rises into place the first time it comes into view */
  const highs = host.querySelectorAll('.high');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    highs.forEach((h) => h.classList.add('pre'));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.remove('pre'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    highs.forEach((h) => io.observe(h));
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* small things rise into place one after another, like cards being dealt */
  const risers = host.querySelectorAll('.rise, .final, .private');
  if ('IntersectionObserver' in window && !still) {
    risers.forEach((r) => r.classList.add('wait'));
    const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.remove('wait'); e.target.classList.add('up'); ro.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    risers.forEach((r) => ro.observe(r));
  }
  /* the pictures in the highlights drift a little as you scroll, slower than the page */
  const pics = [...host.querySelectorAll('.hpics')];
  if (pics.length && !still) {
    let ticking = false;
    const drift = () => {
      ticking = false; const h = innerHeight;
      pics.forEach((el) => {
        const r = el.getBoundingClientRect(); if (r.bottom < -100 || r.top > h + 100) return;
        const t = ((r.top + r.height / 2) - h / 2) / h; // -1 … 1 across the screen
        el.style.setProperty('--drift', (t * -26).toFixed(1) + 'px');
        el.style.setProperty('--drift2', (t * -54).toFixed(1) + 'px');
      });
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true });
    addEventListener('resize', drift); drift();
  }
  /* turn the cover iPad's screens every few seconds, only while the page is on show */
  const slides = document.querySelectorAll('.cover .slides img');
  if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let k = 0;
    setInterval(() => {
      const sheet = document.getElementById('sheet');
      if (document.hidden || (sheet && !sheet.hidden)) return;
      slides.forEach((x) => x.classList.remove('out')); slides[k].classList.remove('on'); slides[k].classList.add('out');
      k = (k + 1) % slides.length; slides[k].classList.add('on');
    }, 3800);
  }
})();
