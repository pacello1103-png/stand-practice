// Notes: little sheets of see-through paper laid on a page. Closed, a note is a small folded tab
// that hides nothing; tapped, it opens as a card of tinted, see-through paper to read or write on
// (type, or write with the Pencil: the iPad turns handwriting into type). Notes can be dragged
// anywhere, coloured, closed again or thrown away. They are never part of the score: not drawn
// into the page, not exported, not sent to the iPhone. The eye that hides the markings hides them too.
// A note is kept with the page's markings: { t: 'note', nid, x, y, c, txt } (x, y: its top left
// corner, as a part of the page).
export const NOTE_COLOURS = { yellow: 'Yellow', blue: 'Blue', pink: 'Pink', green: 'Green', clear: 'Clear' };
const open = new Set();          // notes open now (closed again when the score is opened next time)
let D = null;                    // { change(entry, fn, undo), hidden(item), hint(text) }
export function initNotes(deps) { D = deps; }
export const noteId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
export function openNote(nid) { open.add(nid); }
export function closeAllNotes() { open.clear(); }

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Brings the notes shown on a page in line with its markings (the one being typed in is left alone)
export function renderNotes(entry) {
  if (!D || !entry || !entry.layer || !entry.inner) return;
  let box = entry.notesEl;
  if (!box || !box.isConnected) { box = entry.notesEl = el('div', 'notes-layer'); entry.inner.append(box); }
  const items = entry.layer.items.filter((s) => s.t === 'note' && !D.hidden(s));
  const seen = new Set();
  for (const s of items) {
    seen.add(s.nid);
    let n = box.querySelector(`[data-nid="${s.nid}"]`);
    if (!n) { n = build(entry, s.nid); box.append(n); }
    n.style.left = (s.x * 100).toFixed(3) + '%'; n.style.top = (s.y * 100).toFixed(3) + '%';
    n.className = 'snote c-' + (s.c || 'yellow') + (open.has(s.nid) ? ' open' : '') + (s.x > 0.62 ? ' leftward' : '') + (s.y > 0.68 ? ' upward' : '');
    const ta = n.querySelector('textarea');
    if (document.activeElement !== ta && ta.value !== (s.txt || '')) ta.value = s.txt || '';
    n.querySelector('.snote-tab').setAttribute('aria-label', 'Note' + (s.txt ? ': ' + s.txt.slice(0, 40) : ''));
    for (const b of n.querySelectorAll('.snote-dot')) b.classList.toggle('on', b.dataset.c === (s.c || 'yellow'));
  }
  for (const n of [...box.children]) if (!seen.has(n.dataset.nid)) n.remove();
}

function itemOf(entry, nid) { return entry.layer.items.find((s) => s.t === 'note' && s.nid === nid); }
function patch(entry, nid, ch, undo = true) {
  D.change(entry, (items) => items.map((s) => (s.t === 'note' && s.nid === nid ? { ...s, ...ch } : s)), undo);
}

function build(entry, nid) {
  const n = el('div', 'snote'); n.dataset.nid = nid;
  // nothing on a note reaches the page under it (no page turn, no line drawn)
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'touchstart']) n.addEventListener(ev, (e) => e.stopPropagation());
  // (the tap that opened it is not also a tap on what the card shows under the finger)
  n.addEventListener('click', (e) => { if (performance.now() - (n._opened || 0) < 450 && e.target.closest('.snote-card')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // closed: the tab
  const tab = el('button', 'snote-tab'); tab.innerHTML = '<i></i>';
  // open: the card
  const card = el('div', 'snote-card');
  const head = el('div', 'snote-head');
  const dots = el('div', 'snote-dots');
  for (const [c, name] of Object.entries(NOTE_COLOURS)) {
    const d = el('button', 'snote-dot c-' + c); d.dataset.c = c; d.setAttribute('aria-label', name);
    d.addEventListener('click', () => patch(entry, nid, { c }));
    dots.append(d);
  }
  const fold = el('button', 'snote-btn'); fold.setAttribute('aria-label', 'Close the note'); fold.innerHTML = svg('M6 15l6-6 6 6');
  fold.addEventListener('click', () => { open.delete(nid); renderNotes(entry); });
  const del = el('button', 'snote-btn'); del.setAttribute('aria-label', 'Throw the note away'); del.innerHTML = svg('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12');
  del.addEventListener('click', () => { open.delete(nid); D.change(entry, (items) => items.filter((s) => !(s.t === 'note' && s.nid === nid)), true); D.hint('Note thrown away. Undo brings it back.'); });
  del.classList.add('snote-del');
  head.append(dots, del, fold);   // (closing at the right, as everywhere; throwing away a little apart)
  const ta = el('textarea', 'snote-text'); ta.placeholder = 'Write a note…'; ta.rows = 4;
  let before = null, saveT = 0;
  ta.addEventListener('focus', () => { before = entry.layer.items.slice(); });
  ta.addEventListener('input', () => { clearTimeout(saveT); saveT = setTimeout(() => patch(entry, nid, { txt: ta.value }, false), 400); });
  ta.addEventListener('blur', () => { clearTimeout(saveT); const s = itemOf(entry, nid); if (s && s.txt !== ta.value) patch(entry, nid, { txt: ta.value }, false); if (before) D.undoStep(entry, before); before = null; });
  card.append(head, ta);
  n.append(tab, card);
  // drag by the tab or the top of the card; a tap on the tab opens or closes it
  for (const grip of [tab, head]) {
    let g = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.snote-dot, .snote-btn')) return;
      const r = entry.inner.getBoundingClientRect(), s = itemOf(entry, nid); if (!s) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: s.x, sy: s.y, r, moved: false };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 6) return;
      g.moved = true;
      const x = Math.min(0.97, Math.max(0, g.sx + dx / g.r.width)), y = Math.min(0.97, Math.max(0, g.sy + dy / g.r.height));
      n.style.left = (x * 100).toFixed(3) + '%'; n.style.top = (y * 100).toFixed(3) + '%'; g.to = [x, y];
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const done = g; g = null;
      if (done.moved && done.to) patch(entry, nid, { x: +done.to[0].toFixed(4), y: +done.to[1].toFixed(4) });
      else if (grip === tab) { if (open.has(nid)) open.delete(nid); else { open.add(nid); n._opened = performance.now(); } renderNotes(entry); if (open.has(nid)) setTimeout(() => { const t = n.querySelector('textarea'); if (t && !t.value) t.focus(); }, 30); }
    };
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  }
  return n;
}
