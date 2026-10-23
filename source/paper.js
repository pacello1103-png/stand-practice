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
    return `<span class="tab">FOLDER_0${i + 1} // ${f.title}</span>
      <span class="strip"><span class="name">${f.title}</span>
        <span class="sb"><ul class="contents">${f.ch.map((c) => `<li>${c.name}</li>`).join('')}</ul><span class="bars" aria-hidden="true"></span><span class="num">0${i + 1} / 0${F.length}</span></span></span>
      <span class="peek"><img src="img/m_${f.shot}.webp" alt="" decoding="async" loading="lazy"></span>`;
  },
  cover() {
    return `<div class="big" aria-hidden="true">Stand_01&ndash;0${F.length}</div>
      <div class="inner">
        <span class="hint"><i></i>Pull out a folder</span>
        <div style="display:grid;gap:16px;align-content:center">
          <h1>The music stand that practises with you.</h1>
          <p>Read and mark your scores, turn pages hands-free, tune, keep time, film yourself and plan your week. Then keep notebooks and write your own music, in the same place.</p>
          <span class="cta">Coming to the App Store</span>
        </div>
        <div class="meta"><span><b>Platform</b>iPad &middot; iPhone</span><span><b>Works</b>Offline</span><span><b>Your data</b>Stays on your device</span></div>
      </div>`;
  },
  eyebrow(f, i) { return `<i></i>Folder 0${i + 1} of 0${F.length} · ${f.ch.length} things inside`; },
};
