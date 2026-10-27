const TONE = { read: 'white', mark: 'sunk2', practise: 'tint', listen: 'navy', write: 'deep' };
const THEME = {
  tabH: 150,
  tone(el, f) {
    const t = TONE[f.id];
    el.style.setProperty('--c-bg', `var(--t-${t})`);
    el.style.setProperty('--c-ink', t === 'navy' || t === 'deep' ? 'var(--t-ink-inv)' : 'var(--t-ink)');
  },
  folder(f, i) {
    return `<span class="tab">${ic(f.icon)}<small>${f.short || f.title}</small></span>
      <span class="strip"><span class="name">${f.title}</span>
        <span class="sb"><ul class="contents">${f.ch.map((c) => `<li>${c.name}</li>`).join('')}</ul><span class="num">${pad(i + 1)}</span></span></span>
      <span class="peek"><img src="img/m_${f.shot}.webp" alt="" decoding="async" loading="lazy"></span>`;
  },
  cover() {
    return `<div class="inner">
        <div class="brand"><b>Stand</b><span>iPad &middot; iPhone</span></div>
        <div style="display:grid;gap:16px;align-content:center">
          <h1>The music stand that practises with you.</h1>
          <p>Read and mark your scores, turn pages hands-free, tune, keep time, film yourself and plan your week. Then keep notebooks and write your own music, in the same place.</p>
          ${ctaHTML()}
          <span class="hint"><i></i>Open a folder to see what is inside</span>
        </div>
        <div class="meta"><span><b>Platform</b>iPad and iPhone</span><span><b>Works</b>Offline</span><span><b>Your data</b>Stays on your device</span></div>
      </div>`;
  },
  eyebrow(f, i) { return `${ic(f.icon)}Folder ${i + 1} of ${F.length}`; },
};
