// Reading a page for the follower: its notes and chords, every line with all its staves together,
// bar by bar, and the places where the page can turn. Used in a thread of its own (follow-worker.js)
// so the page and the listening never wait for it, or here when that thread cannot be had.
import { analyse, staffEvents } from './omr.js';
import { CLEFS, keyAlter, midiOf } from './compose/model.js';
// (the same as listen.js's template: kept here so this file needs nothing of the sound)
function template(pcs) {
  const t = new Float32Array(12);
  for (const p of pcs) { t[p] += 1; t[(p + 7) % 12] += 0.22; t[(p + 4) % 12] += 0.1; }
  return t;
}

export async function readPage(canvas) {
  const PW = canvas.width || 1600, PH = canvas.height || 2263;
  const A = await analyse(canvas, null, false, { notesOnly: true });   // (notes and bars only: far less memory)
  const seq = []; let bar = 0;
  const nSys = A.systems.length;
  A.systems.forEach((sys, si) => {
    const sts = sys.map((k) => A.staves[k]);
    const sp = sts[0].sp || A.sp || 12;
    // where the line is on the page (0 at the top, 1 at the bottom)
    const yn = sts.reduce((a, st) => a + (st.top + st.bottom) / 2, 0) / sts.length / PH;
    const all = [];
    let nb = 0;
    sts.forEach((st, k2) => {
      const clef0 = CLEFS[st.clef] ? st.clef : k2 > 0 && sts.length === 2 ? 'bass' : 'treble';
      const bars = staffEvents(st);
      nb = Math.max(nb, bars.length);
      // (the clef and key as they change along the line)
      let key = st.key || 0;
      bars.forEach((b, bi) => {
        if (bars.meta && bars.meta[bi] && bars.meta[bi].key !== undefined) key = bars.meta[bi].key;
        const evs = b.filter((it) => !it.rest);
        evs.forEach((it, k) => {
          const bottom = (CLEFS[it.clef] || CLEFS[clef0]).bottom;
          const pcs = it.ps.map((q) => { const s = bottom + q; const a = it.acc && it.acc[q] !== undefined ? it.acc[q] : keyAlter(key, s); return ((midiOf(s, a) % 12) + 12) % 12; });
          all.push({ x: it.x, xn: it.x / PW, yn, pcs, bar: bar + bi, half: k >= evs.length / 2 });
        });
      });
    });
    // notes at the same place on different staves sound together
    all.sort((a, b) => a.x - b.x);
    const start = seq.length;
    for (const e of all) {
      const prev = seq.length > start ? seq[seq.length - 1] : null;
      if (prev && Math.abs(prev.x - e.x) < sp * 0.7) { for (const q of e.pcs) if (!prev.pcs.includes(q)) prev.pcs.push(q); prev.half = prev.half && e.half; continue; }
      seq.push({ ...e, sys: si, nSys });
    }
    bar += nb;
  });
  for (const e of seq) { e.tpl = template(e.pcs); e.y = (e.sys + 0.5) / Math.max(1, e.nSys); }
  // where the page turns: in the middle of the last line, as the last bar begins, or with the
  // last notes (chosen in Settings); the places are kept and chosen when turning
  let lastBar = -1; for (const n of seq) lastBar = Math.max(lastBar, n.bar);
  let atBar = seq.findIndex((n) => n.bar === lastBar);
  if (atBar < 0) atBar = seq.length - 1;
  const lastSys = seq.length ? seq[seq.length - 1].sys : 0, sysFrom = seq.findIndex((n) => n.sys === lastSys);
  // (and the bar before it: the place to turn is chosen anywhere from the start of the bar
  // before the last to the last notes)
  let atPrev = seq.findIndex((n) => n.bar === lastBar - 1); if (atPrev < 0 || atPrev > atBar) atPrev = atBar;
  const atEnd = Math.max(atBar, seq.length - 2);
  void sysFrom;
  return { seq, turnAt: atBar, at: { prev: atPrev, bar: atBar, end: atEnd }, bars: bar };
}
