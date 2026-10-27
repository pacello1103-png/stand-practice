(() => {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 160;
    const g = c.getContext('2d'); const im = g.createImageData(160, 160);
    for (let i = 0; i < im.data.length; i += 4) { const v = 235 + Math.random() * 20; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
  } catch {}
})();
const PAPER = { read: ['#e9e3d4', '#1f1e1b'], mark: ['#cfc8b6', '#1f1e1b'], practise: ['#a5825a', '#1b150e'], listen: ['#2a2a27', '#ece6d8'], write: ['#8e98a3', '#141618'] };
const THEME = {
  tabH: 170,
  tone(el, f) { el.style.setProperty('--c-bg', PAPER[f.id][0]); el.style.setProperty('--c-ink', PAPER[f.id][1]); },
  folder(f, i) {
    return `<span class="tab">Folder 0${i + 1} · ${f.short || f.title}</span>
      <span class="strip"><span class="name">${f.title}</span><span class="flead">${f.lead}</span>
        <span class="sb"><ul class="contents">${f.ch.map((c) => `<li>${c.name}</li>`).join('')}</ul><span class="bars" aria-hidden="true"></span><span class="num">0${i + 1} / 0${F.length}</span>
          <span class="open" aria-hidden="true">Open<svg><use href="#i-chev-r"/></svg></span></span></span>
      <span class="peek"><img src="img/m_${f.shot}.webp" alt="" decoding="async" loading="lazy"></span>`;
  },
  cover() {
    return `<div class="big" aria-hidden="true">Stand</div><div class="spine-note" aria-hidden="true">Read · Mark · Practise · Tune &amp; Record · Write</div>
      <div class="inner">
        <span class="hint"><i></i><span class="hint-wide">Open a folder to see inside</span><span class="hint-phone">Tap a folder to see inside</span></span>
        <div class="ctext">
          <h1>The music stand that practises with you.</h1>
          <p>Read and mark your scores, turn pages hands-free, practise the hard bars, tune, film yourself and write your own music. One app, on iPad and iPhone.</p>
          <div class="cta-row">${ctaHTML()}<span class="ctanote">No account · Offline · Private</span></div>
        </div>
        <div class="shots" aria-hidden="true">
          <div class="dev ipad"><img src="img/s_07_marked.webp" alt="" decoding="async" fetchpriority="high"></div>
          <div class="dev phone"><img src="img/m_phone_tuner.webp" alt="" decoding="async"></div>
        </div>
      </div>`;
  },
  eyebrow(f, i) { return `<i></i>Folder 0${i + 1} of 0${F.length} · ${f.ch.length} things inside`; },
};
