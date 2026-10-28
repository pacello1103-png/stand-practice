/* ---------- the home page below the folders: highlights, tools, privacy, questions, last call ---------- */
(() => {
  const host = document.getElementById('more'); if (!host) return;
  const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const title = (id) => (F.find((f) => f.id === id) || {}).title || '';
  host.innerHTML = `
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
          <div class="dev ipad"><img src="img/s_${h.shot}.webp" alt="" loading="lazy" decoding="async"></div>
          ${h.phone ? `<div class="dev phone"><img src="img/${h.phone}.webp" alt="" loading="lazy" decoding="async"></div>` : ''}
        </div>
      </article>`).join('')}
    </section>

    <section class="tools" aria-labelledby="toolsH">
      <div class="tl">
        <span class="hk"><i></i>${U.allin}</span>
        <h2 id="toolsH">${U.toolsH}</h2>
        <p>${U.toolsP}</p>
      </div>
      <ul class="tgrid">${TOOLS.map(([i, t]) => `<li>${icon(i)}<span>${t}</span></li>`).join('')}</ul>
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
      <div class="fbig" aria-hidden="true">Stand</div>
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
  /* turn the cover iPad's screens every few seconds, only while the page is on show */
  const slides = document.querySelectorAll('.cover .slides img');
  if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let k = 0;
    setInterval(() => {
      const sheet = document.getElementById('sheet');
      if (document.hidden || (sheet && !sheet.hidden)) return;
      slides[k].classList.remove('on'); k = (k + 1) % slides.length; slides[k].classList.add('on');
    }, 3800);
  }
})();
