// Practice timer: play for a set time, rest for a set time, for a set number of rounds.
// Time while it is playing counts in the practice tracker (see toolsActive in main.js).
import { getCtx, master, unlock } from './audio.js';
import { getSetting, setSetting } from './db.js';

// Presets. Deliberate practice research (Ericsson and colleagues) found that the best
// musicians practised in focused blocks of about an hour at most, with rest between them,
// and that the rests keep tension and attention fresh.
export const PRESETS = {
  focus: { work: 25, rest: 5, text: 'The classic Pomodoro. Short, sharp blocks for one passage or one problem.' },
  deliberate: { work: 45, rest: 15, text: 'Best for instrument work. Focused blocks of around 45 minutes, then a real rest so the next block is still good.' },
  long: { work: 60, rest: 20, text: 'The longest focused block the research supports, about 60 to 90 minutes. Rest after it, do not push past it.' },
};

export const pomo = {
  phase: 'idle',      // idle | work | rest
  running: false,
  round: 1,
  rounds: 3,
  work: 45,
  rest: 15,
  preset: 'deliberate',
  chime: true,
  end: 0,             // when the phase ends (ms), while running
  left: 0,            // ms left, while paused
};

let toastFn = () => {};
let renderFn = () => {};

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
export const remaining = () => (pomo.running ? pomo.end - Date.now() : pomo.left);

function begin(phase) {
  pomo.phase = phase;
  pomo.end = Date.now() + (phase === 'work' ? pomo.work : pomo.rest) * 60000;
}

// Two soft tones: a rising pair when playing starts, a falling pair when resting starts.
function chime(up) {
  if (!pomo.chime) return;
  try {
    const ctx = getCtx(), out = master();
    const notes = up ? [660, 880] : [880, 660];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t = ctx.currentTime + i * 0.28;
      o.frequency.value = f;
      o.connect(g); g.connect(out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.start(t); o.stop(t + 1);
    });
  } catch { /* no sound is fine */ }
}

export function start() {
  unlock();
  if (pomo.phase === 'idle') { pomo.round = 1; begin('work'); chime(true); }
  else pomo.end = Date.now() + pomo.left;
  pomo.running = true;
  render();
}

export function pause() {
  if (!pomo.running) return;
  pomo.left = Math.max(0, pomo.end - Date.now());
  pomo.running = false;
  render();
}

export function stop() {
  pomo.phase = 'idle';
  pomo.running = false;
  render();
}

export function toggle() { if (pomo.running) pause(); else start(); }

function tick() {
  if (!pomo.running || Date.now() < pomo.end) { render(); return; }
  if (pomo.phase === 'work') {
    if (pomo.round >= pomo.rounds) {
      pomo.phase = 'idle'; pomo.running = false; chime(false);
      toastFn('Practice done. Well played.', 5000);
    } else {
      begin('rest'); chime(false);
      toastFn('Rest for ' + pomo.rest + ' minutes.', 4000);
    }
  } else {
    pomo.round++;
    begin('work'); chime(true);
    toastFn('Round ' + pomo.round + ' of ' + pomo.rounds + '. Play.', 4000);
  }
  render();
}

function render() {
  renderFn();
}

// Settings for the next session, kept on this iPad.
async function save() {
  await setSetting('pomo', { work: pomo.work, rest: pomo.rest, rounds: pomo.rounds, preset: pomo.preset, chime: pomo.chime });
}

export async function initPomodoro({ toast, draw }) {
  toastFn = toast;
  renderFn = draw;
  const saved = (await getSetting('pomo', null)) || {};
  Object.assign(pomo, {
    work: saved.work || 45, rest: saved.rest || 15, rounds: saved.rounds || 3,
    preset: saved.preset || 'deliberate', chime: saved.chime !== false,
  });
  setInterval(tick, 250);
  draw();
}

export const pomoSave = save;
export const fmt = mmss;
