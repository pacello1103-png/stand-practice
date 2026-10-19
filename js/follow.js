// Turning pages by listening. Each page is read once (the same music reader as Capture and
// Studio) into its notes and chords, all staves of each line together, bar by bar.
//
// Following is a score follower in the proper sense: a probability for every note of the pages on
// screen (and the next page), updated with everything heard. Playing moves the probability along
// the music; a note the reader missed, an extra note, a repeated attack or a wrong note only blur it
// a little instead of losing the place; a jump (starting again, a repeat) is found again quickly.
// The page turns when the playing is clearly in the last bar (or, with half-page turns, past the
// middle of the page, and then past the part of the next page already on show).
// Works for single lines (any transposing instrument: the follower finds the interval itself) and
// for chords and the piano.

import { analyse, staffEvents } from './omr.js';
import { CLEFS, keyAlter, midiOf } from './compose/model.js';
import { getCtx, acquireMic, releaseMic } from './audio.js';
import { Listener, template, cosine } from './listen.js';

const SHIFTS = [0, 2, 10, 3, 9, 5, 7, 1, 11, 4, 8, 6];
// where the music can go from one note to the next thing heard
const MOVE = [0.14, 0.62, 0.15, 0.05, 0.02];   // stay (a repeated attack), next, skip 1, 2, 3
const JUMP = 0.01;                               // anywhere (a jump, starting again)

// how well one thing heard fits one event of the score (0..1), with the music moved by `sh`
export function fit(obs, ev, sh) {
  if (obs.mono && obs.pc !== null) {
    const q = (obs.pc - sh + 12) % 12;
    if (ev.pcs.includes(q)) return 1;
    // a semitone off: often an accidental the reader missed (or a key change)
    if (ev.pcs.includes((q + 1) % 12) || ev.pcs.includes((q + 11) % 12)) return 0.3;
    // an octave-related overtone heard as the note (fifth above)
    if (ev.pcs.includes((q + 5) % 12)) return 0.15;
    return 0;
  }
  const t = sh ? ev.tpl.map((_, i) => ev.tpl[(i - sh + 12) % 12]) : ev.tpl;
  return Math.max(0, (cosine(obs.chroma, t) - 0.25) / 0.6);
}
const like = (f) => 0.04 + 0.96 * f * f;

export class PageFollower {
  // render(i, canvas, w, h) draws page i; pages() is the number of pages; turn() turns;
  // onState(text, hearing); half() is where a half-page turn splits the screen (or null)
  constructor({ render, pages, turn, onState, half, halfWanted }) {
    Object.assign(this, { render, pages, turnFn: turn, onState, half: half || (() => null), halfWanted: halfWanted || null });
    this.cache = new Map(); this.on = false; this.page = 0; this.last = 0;
    this.post = null; this.seqKey = ''; this.turnedAt = 0; this.sinceTurn = 0;
    this.shift = null; this.shiftScore = new Map(); this.heard = 0;
  }
  async start() {
    if (this.on) return;
    this.on = true;
    try { this.src = await acquireMic(); } catch (e) { this.on = false; this.onState && this.onState('No microphone', false); return; }
    this.listener = new Listener((o) => this._heard(o));
    this.listener.attach(this.src.context || getCtx(), this.src);
    this.onState && this.onState('Listening', false);
    // the sound system was replaced (iOS): listen again through the new one
    if (!this._wired) { this._wired = true; window.addEventListener('stand-audio-new', () => { if (this.on) { this.stop(); this.start(); } }); }
    this.prepare();
  }
  stop() {
    if (!this.on) return;
    this.on = false;
    if (this.listener) this.listener.detach();
    releaseMic();
  }
  // the pages on screen (first and last); called after every turn or jump
  setPages(first, last) {
    if (first === this.page && last === this.last) return;
    const forward = first === this.last + 1 || (first > this.page && first <= this.last + 1);
    this.page = first; this.last = last;
    // after our own turn we know where we are: the top of the new page
    this.start0 = forward ? 'top' : 'any';
    this.post = null; this.sinceTurn = 0;
    this.prepare();
  }
  reset() { this.cache.clear(); this.post = null; this.shift = null; this.shiftScore.clear(); this.heard = 0; }
  async prepare() {
    for (let i = this.page; i <= Math.min(this.pages() - 1, this.last + 1); i++) await this.notesOf(i);
  }
  // the notes of a page: every line, all its staves together, as pitch classes, with their bar
  notesOf(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const p = (async () => {
      const c = document.createElement('canvas');
      await this.render(i, c, 1600, 2263);
      const A = await analyse(c);
      c.width = c.height = 0;
      const seq = []; let bar = 0;
      const nSys = A.systems.length;
      A.systems.forEach((sys, si) => {
        const sts = sys.map((k) => A.staves[k]);
        const sp = sts[0].sp || A.sp || 12;
        const all = [];
        let nb = 0;
        sts.forEach((st, k2) => {
          const bottom = (CLEFS[st.clef] || CLEFS[k2 > 0 && sts.length === 2 ? 'bass' : 'treble']).bottom, key = st.key || 0;
          const bars = staffEvents(st);
          nb = Math.max(nb, bars.length);
          bars.forEach((b, bi) => {
            const evs = b.filter((it) => !it.rest);
            evs.forEach((it, k) => {
              const pcs = it.ps.map((q) => { const s = bottom + q; const a = it.acc && it.acc[q] !== undefined ? it.acc[q] : keyAlter(key, s); return ((midiOf(s, a) % 12) + 12) % 12; });
              all.push({ x: it.x, pcs, bar: bar + bi, half: k >= evs.length / 2 });
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
      // turn in the middle of the last bar that has notes
      let lastBar = -1; for (const n of seq) lastBar = Math.max(lastBar, n.bar);
      let turnAt = seq.findIndex((n) => n.bar === lastBar && n.half);
      if (turnAt < 0) turnAt = seq.length - 1;
      return { seq, turnAt, bars: bar };
    })().catch((err) => { console.warn(err); return { seq: [], turnAt: -1, bars: 0 }; });
    this.cache.set(i, p);
    return p;
  }
  // the probability of each place, carried over when the pages on show change
  _start(seq, firstNext) {
    const n = seq.length, p = new Float64Array(n);
    if (this.start0 === 'top') {
      // just turned: the first notes of the page now on show
      for (let j = 0; j < Math.min(n, 6); j++) p[j] = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04][j];
    } else {
      for (let j = 0; j < n; j++) p[j] = j < firstNext ? 1 : 0.15;   // anywhere on show, the next page less
    }
    let s = 0; for (const v of p) s += v; for (let j = 0; j < n; j++) p[j] /= s || 1;
    return p;
  }
  _step(prev, obs, seq, sh) {
    const n = seq.length, out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const pj = prev[j]; if (pj < 1e-9) continue;
      for (let d = 0; d < MOVE.length && j + d < n; d++) out[j + d] += pj * MOVE[d];
    }
    const jump = JUMP / n;
    let s = 0;
    for (let j = 0; j < n; j++) { out[j] = (out[j] * (1 - JUMP) + jump) * like(fit(obs, seq[j], sh)); s += out[j]; }
    for (let j = 0; j < n; j++) out[j] /= s || 1;
    return { p: out, ev: s };
  }
  async _heard(obs) {
    const pages = [];
    const lastIdx = Math.min(this.pages() - 1, this.last + 1);
    for (let i = this.page; i <= lastIdx; i++) pages.push({ i, ...(await this.notesOf(i)) });
    const seq = []; let firstNext = Infinity, turnAt = -1;
    pages.forEach((pg, k) => {
      const off = seq.length;
      if (pg.i > this.last && firstNext === Infinity) firstNext = off;
      if (pg.i === this.last && pg.turnAt >= 0) turnAt = off + pg.turnAt;
      for (const e of pg.seq) seq.push({ ...e, pg: pg.i });
    });
    if (firstNext === Infinity) firstNext = seq.length;
    if (!seq.length) return;
    const key = pages.map((p) => p.i + ':' + p.seq.length).join('|');
    if (!this.post || this.seqKey !== key) { this.post = { p: this._start(seq, firstNext), alt: new Map() }; this.seqKey = key; }
    this.heard++; this.sinceTurn++;
    // the interval of a transposing instrument: try the others alongside, until one is clearly best
    if (this.shift === null) {
      const cands = obs.mono ? SHIFTS : [0];
      for (const sh of cands) {
        let st = this.post.alt.get(sh);
        if (!st) st = { p: sh === 0 ? this.post.p : this._start(seq, firstNext), score: 0 };
        const r = this._step(st.p, obs, seq, sh);
        st.p = r.p; st.score = st.score * 0.92 + Math.log(r.ev + 1e-12) + (sh === 0 ? 0.25 : 0);
        this.post.alt.set(sh, st);
      }
      if (this.heard >= 8) {
        const arr = [...this.post.alt.entries()].sort((a, b) => b[1].score - a[1].score);
        const z = this.post.alt.get(0);
        // music in its written key is far more likely: another interval must be clearly better
        if (arr[0][0] === 0 || arr[0][1].score > z.score + 3) { this.shift = arr[0][0]; this.post.p = arr[0][1].p; this.post.alt.clear(); }
      }
      if (this.shift === null) {
        // until the interval is known, show the best guess, but never turn on it
        const arr = [...this.post.alt.entries()].sort((a, b) => b[1].score - a[1].score);
        this.post.p = arr[0][1].p; this.guessing = obs.mono;
      } else this.guessing = false;
    } else {
      this.post.p = this._step(this.post.p, obs, seq, this.shift).p;
    }
    const p = this.post.p;
    let best = 0; for (let j = 1; j < p.length; j++) if (p[j] > p[best]) best = j;
    // how sure: the probability near the best place
    let conf = 0; for (let j = Math.max(0, best - 2); j <= Math.min(p.length - 1, best + 2); j++) conf += p[j];
    if (window.__followDbg) window.__followDbg.push([Math.round(obs.t), obs.mono ? obs.pc : 'c', best, +conf.toFixed(2), seq[best] && seq[best].pcs.join('.'), this.shift]);
    if (conf < 0.3 || this.heard < 3) { this.onState && this.onState('Listening', true); return; }
    const n = seq[best];
    this.onState && this.onState(`Bar ${n.bar + 1}${pages.length > 2 || this.last > this.page ? ` · p. ${n.pg + 1}` : ''}`, true);
    if (this.last >= this.pages() - 1 && n.pg <= this.last) return;            // the last page: nothing to turn
    if (performance.now() - this.turnedAt < 1800 || this.sinceTurn < 3 || (this.shift === null && this.guessing)) return;
    // mass at or past the turning point (the next page counts too: a late turn is still a turn)
    let ahead = 0; for (let j = Math.max(0, turnAt); j < p.length; j++) ahead += p[j];
    const split = this.half();
    let go = false;
    if (split !== null && split !== undefined) {
      // half-page view: turn the rest once the playing is past the part of the next page on show
      let past = 0; for (let j = firstNext; j < p.length; j++) if (seq[j].y > split) past += p[j];
      let inNext = 0; for (let j = firstNext; j < p.length; j++) inNext += p[j];
      go = past > 0.5 || (inNext > 0.7 && this.sinceTurn > 6 && n.pg > this.last && n.y > split * 0.8);
    } else if (this.halfWanted && this.halfWanted()) {
      // half-page turns: the top of the next page comes once the playing is past the middle
      let low = 0; for (let j = 0; j < firstNext; j++) if (seq[j].pg === this.last && seq[j].y > 0.5) low += p[j];
      go = low + ahead > 0.6;
    } else go = turnAt >= 0 && ahead > 0.55 && conf > 0.35;
    if (go) {
      this.turnedAt = performance.now(); this.sinceTurn = 0;
      this.turnFn();
    }
  }
}
