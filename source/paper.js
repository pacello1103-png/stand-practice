(() => {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 160;
    const g = c.getContext('2d'); const im = g.createImageData(160, 160);
    for (let i = 0; i < im.data.length; i += 4) { const v = 235 + Math.random() * 20; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
  } catch {}
})();
const PAPER = { read: ['#e9e3d4', '#1f1e1b'], mark: ['#cfc8b6', '#1f1e1b'], practise: ['#a5825a', '#1b150e'], listen: ['#2a2a27', '#ece6d8'], write: ['#8e98a3', '#141618'], notebook: ['#a9ad96', '#191b14'] };
const THEME = {
  tabH: 170,
  tone(el, f) { el.style.setProperty('--c-bg', PAPER[f.id][0]); el.style.setProperty('--c-ink', PAPER[f.id][1]); },
  folder(f, i) {
    return `<span class="tab">${U.folder} 0${i + 1} · ${f.short || f.title}</span>
      <span class="strip"><span class="name">${f.title}</span><span class="flead">${f.lead}</span>
        <span class="sb"><ul class="contents">${f.ch.map((c) => `<li>${c.name}</li>`).join('')}</ul><span class="bars" aria-hidden="true"></span><span class="num">0${i + 1} / 0${F.length}</span>
          <span class="open" aria-hidden="true">${U.open}<svg><use href="#i-chev-r"/></svg></span></span></span>
      <span class="peek"><img src="img/m_${f.shot}.webp" alt="" decoding="async" loading="lazy"></span>`;
  },
  cover() {
    return `<div class="big" aria-hidden="true">Stand</div><div class="spine-note" aria-hidden="true">${F.map((f) => f.title).join(' · ')}</div>
      <div class="inner">
        <span class="hint"><i></i><span class="hint-wide">${U.hintWide}</span><span class="hint-phone">${U.hintPhone}</span></span>
        <div class="ctext">
          <h1>${U.h1}</h1>
          <p>${U.coverP}</p>
          <div class="cta-row">${ctaHTML()}<span class="ctanote">${U.note}</span></div>
        </div>
        <div class="shots" aria-hidden="true">
          <div class="dev ipad"><div class="slides">${["07_marked","63_video_over_score","12_drone","26_study_running"].map((n, k) => `<img src="img/s_${n}.webp" alt="" decoding="async"${k ? ' loading="lazy"' : ' fetchpriority="high" class="on"'}>`).join("")}</div></div>
          <div class="dev phone"><img src="img/m_phone_tuner.webp" alt="" decoding="async"></div>
        </div>
      </div>`;
  },
  eyebrow(f, i) { return `<i></i>${fmt(U.eyebrow, { i: '0' + (i + 1), n: '0' + F.length, k: f.ch.length })}`; },
};
