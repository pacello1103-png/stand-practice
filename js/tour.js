// A short tour the first time Stand opens: one thing at a time, lit up on the screen. A tap
// anywhere goes on; "Skip" ends it. It can be seen again from Settings.

const DESK_STEPS = [
  { title: 'Welcome to your stand', text: 'Here is a quick look around. Tap anywhere to go on.', at: null },
  { title: 'Your music', text: 'Import a PDF or photo, or scan a page with the camera. Stand finds the page, straightens it and makes the paper white.', at: '.head-actions' },
  { title: 'Find any piece', text: 'Search the free IMSLP library by composer and title, and pick the best edition for your instrument.', at: '#homeTabs' },
  { title: 'Practice tools', text: 'Tuner, drone, metronome, scales, recording and more, one tap away. Choose which ones show in Settings.', at: '.tiles' },
  { title: 'Notebooks', text: 'Engraved staff paper with a cover of your own, to write with the Apple Pencil.', at: '#newNotebookBtn' },
  { title: 'On a score', text: 'Tap the right edge for the next page (or swipe, use a pedal, wink, or let Stand listen and turn for you). The Pencil writes at once. Perform hides everything but the music.', at: null, icon: 'score' },
  { title: 'Keep it safe', text: 'Settings › Backup to iCloud Drive keeps everything, even if the app is deleted.', at: '[data-panel="app"]' },
];

// on the iPhone, where there are no scores
const PHONE_STEPS = [
  { title: 'Stand on your iPhone', text: 'Your practice companion in your pocket. Tap anywhere to go on.', at: null },
  { title: 'Your practice', text: 'The time you practise, here and on your iPad, piece by piece. Connect once; after that it updates by itself.', at: '#ipadCard' },
  { title: 'Practice tools', text: 'Tuner, drone, metronome, scales, timer, recording and writing music, one tap away.', at: '.tiles' },
  { title: 'A camera for the iPad', text: 'Film yourself playing: the iPhone becomes the iPad’s camera and sends it the video.', at: '#phoneCamTile' },
  { title: 'Settings', text: 'Your instrument, colours and backups to iCloud Drive.', at: '[data-panel="app"]' },
];
export function startTour({ onDone, phone, steps } = {}) {
  const STEPS = steps || (phone ? PHONE_STEPS : DESK_STEPS);
  let i = 0;
  const back = document.createElement('div'); back.className = 'tour';
  const hole = document.createElement('div'); hole.className = 'tour-hole';
  const card = document.createElement('div'); card.className = 'tour-card';
  const skip = document.createElement('button'); skip.className = 'tour-skip'; skip.textContent = 'Skip';
  back.append(hole, card, skip); document.body.append(back);
  const end = () => { back.remove(); window.removeEventListener('resize', show); onDone && onDone(); };
  skip.addEventListener('click', (e) => { e.stopPropagation(); end(); });
  back.addEventListener('click', () => { i++; if (i >= STEPS.length) end(); else show(); });
  function show() {
    const s = STEPS[i];
    const t = s.at && document.querySelector(s.at);
    const r = t && t.offsetParent !== null ? t.getBoundingClientRect() : null;
    card.innerHTML = '';
    if (s.icon === 'score') {
      const ill = document.createElement('div'); ill.className = 'tour-ill';
      ill.innerHTML = '<div class="tp"><i></i><i></i><i></i><i></i></div><div class="tp"><i></i><i></i><i></i><i></i></div><span class="tap">tap</span>';
      card.append(ill);
    }
    const h = document.createElement('h3'); h.textContent = s.title;
    const p = document.createElement('p'); p.textContent = s.text;
    const dots = document.createElement('div'); dots.className = 'tour-dots';
    STEPS.forEach((_, k) => { const d = document.createElement('i'); if (k === i) d.className = 'on'; dots.append(d); });
    const hint = document.createElement('span'); hint.className = 'tour-next'; hint.textContent = i === STEPS.length - 1 ? 'Tap to start' : 'Tap to go on';
    card.append(h, p, dots, hint);
    if (r) {
      const pad = 8;
      Object.assign(hole.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      back.classList.remove('dim');
      // the card below the lit part, or above it when there is no room
      const below = r.bottom + 16 + 200 < innerHeight;
      const cw = Math.min(380, innerWidth - 32);
      card.style.width = cw + 'px';
      card.style.left = Math.max(16, Math.min(innerWidth - cw - 16, r.left + r.width / 2 - cw / 2)) + 'px';
      card.style.top = below ? r.bottom + 16 + 'px' : 'auto';
      card.style.bottom = below ? 'auto' : innerHeight - r.top + 16 + 'px';
      card.style.transform = '';
    } else {
      hole.style.display = 'none'; back.classList.add('dim');
      card.style.width = Math.min(420, innerWidth - 32) + 'px';
      card.style.left = '50%'; card.style.top = '50%'; card.style.bottom = 'auto'; card.style.transform = 'translate(-50%, -50%)';
    }
  }
  window.addEventListener('resize', show);
  show();
}
