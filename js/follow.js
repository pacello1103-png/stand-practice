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

import { readPage } from './follow-read.js';
import { getCtx, acquireMic, releaseMic } from './audio.js';
import { Listener, cosine } from './listen.js';

// The music reader in a thread of its own: reading a page (a second or more) never holds up the
// score, the drawing or the listening. Pages go one after another. If the thread cannot be had, or
// fails, pages are read here as before.
let W = null, wBroken = false, wSeq = 0; const wWait = new Map();
function readElsewhere(canvas) {
  if (wBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return Promise.resolve(null);
  if (!W) {
    try {
      W = new Worker(new URL('./follow-worker.js', import.meta.url), { type: 'module' });
      W.onmessage = (e) => { const d = e.data || {}; const w = wWait.get(d.id); if (!w) return; wWait.delete(d.id); clearTimeout(w.t); if (d.error) { wBroken = true; w.res(null); } else w.res(d.r); };
      W.onerror = () => { wBroken = true; for (const w of wWait.values()) { clearTimeout(w.t); w.res(null); } wWait.clear(); try { W.terminate(); } catch {} W = null; };
    } catch { wBroken = true; return Promise.resolve(null); }
  }
  return createImageBitmap(canvas).then((page) => new Promise((res) => {
    const id = ++wSeq;
    const t = setTimeout(() => { wWait.delete(id); res(null); }, 45000);
    wWait.set(id, { res, t });
    try { W.postMessage({ id, page }, [page]); } catch { clearTimeout(t); wWait.delete(id); wBroken = true; res(null); }
  }), () => null);
}

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
  constructor({ render, pages, turn, onState, half, halfWanted, gaze, gazeOff, when, store, fixedShift }) {
    // when(): where to turn, 0 (as the bar before the last begins) .. 0.5 (as the last bar begins) .. 1 (with the last notes)
    Object.assign(this, { fixedShift: fixedShift || null, store: store || null, render, pages, turnFn: turn, onState, half: half || (() => null), halfWanted: halfWanted || null, gaze: gaze || null, gazeOff: gazeOff || null, whenRaw: when || (() => 0.5) });
    // how far the eyes are to be believed: how often they have agreed with the playing lately
    this.trust = 0.5;
    this.cache = new Map(); this.on = false; this.page = 0; this.last = 0;
    this.post = null; this.seqKey = ''; this.turnedAt = 0; this.sinceTurn = 0;
    this.shift = null; this.shiftScore = new Map(); this.heard = 0;
  }
  when() { const w = this.whenRaw(); return typeof w === 'number' ? Math.max(0, Math.min(1, w)) : w === 'line' ? 0 : w === 'end' ? 1 : 0.5; }
  // the place to turn on a page, from its marks and the chosen moment
  turnIndex(at, w) {
    if (!at) return null;
    if (w <= 0.5) return Math.round(at.prev + (at.bar - at.prev) * (w / 0.5));
    return Math.round(at.bar + (at.end - at.bar) * ((w - 0.5) / 0.5));
  }
  async start() {
    if (this.on) return;
    this.on = true;
    const tok = this._tok = (this._tok || 0) + 1;
    try { this.src = await acquireMic(); } catch (e) { if (tok === this._tok) { this.on = false; this.onState && this.onState('No microphone', false); } return; }
    // (stopped while the microphone was opening: let it go again, and listen to nothing)
    if (!this.on || tok !== this._tok) { releaseMic(); return; }
    if (this.listener) { try { this.listener.detach(); } catch {} }
    this.listener = new Listener((o) => this._heard(o));
    this.listener.attach(this.src.context || getCtx(), this.src);
    this.onState && this.onState('Listening', false);
    // the sound system was replaced (iOS): listen again through the new one
    // (the microphone held meanwhile: closing it and opening it again moved the sound once more)
    if (!this._wired) { this._wired = true; for (const ev of ['stand-audio-new', 'stand-mic-lost']) window.addEventListener(ev, async () => { if (!this.on) return; let held = false; try { await acquireMic(); held = true; } catch {} this.stop(); await this.start(); if (held) releaseMic(); }); }
    this.prepare();
  }
  stop() {
    if (!this.on) return;
    this.on = false; this._tok = (this._tok || 0) + 1; this._gen = (this._gen || 0) + 1;
    // (the microphone is let go only if it was got: a start still waiting lets go by itself)
    if (this.listener) { this.listener.detach(); this.listener = null; releaseMic(); }
  }
  // the pages on screen (first and last); called after every turn or jump
  setPages(first, last) {
    if (first === this.page && last === this.last) return;
    const forward = first === this.last + 1 || (first > this.page && first <= this.last + 1);
    this.page = first; this.last = last;
    // after our own turn we know where we are: the top of the new page
    this.start0 = forward ? 'top' : 'any';
    this.post = null; this.sinceTurn = 0; this._gen = (this._gen || 0) + 1; this._lastBest = undefined; if (this.vstate) for (const q of Object.values(this.vstate)) { q.post = null; q._lastBest = undefined; q.goRun = 0; }
    if (this.endT) { clearTimeout(this.endT); this.endT = 0; }
    this.prepare();
  }
  reset() { this.cache.clear(); this.post = null; this.shift = null; this.shiftScore.clear(); this.heard = 0; this.vstate = null; this.variant = null; }
  async prepare() {
    for (let i = this.page; i <= Math.min(this.pages() - 1, this.last + 1); i++) await this.notesOf(i);
  }
  // the notes of a page: every line, all its staves together, as pitch classes, with their bar
  notesOf(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const p = (async () => {
      // read before, for this score as it is now: nothing to read again
      const kept = this.store ? await this.store.get(i).catch(() => null) : null;
      if (kept && Array.isArray(kept.seq) && kept.at && kept.v === 2) return kept;   // (read by an older Stand: read again, once)
      const c = document.createElement('canvas');
      await this.render(i, c, 1600, 2263);
      let r = null;
      try { r = await readElsewhere(c); } catch { r = null; }
      if (!r) r = await readPage(c);   // (no thread of its own on this device: read here)
      c.width = c.height = 0;
      if (this.store && r.seq.length) this.store.put(i, r).catch(() => {});
      return r;
    })().catch((err) => { console.warn(err); setTimeout(() => { if (this.cache.get(i) === p) this.cache.delete(i); }, 4000); return { seq: [], turnAt: -1, bars: 0 }; });   // (read again a little later)
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
  _step(prev, obs, seq, sh, gz) {
    const n = seq.length, out = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const pj = prev[j]; if (pj < 1e-9) continue;
      for (let d = 0; d < MOVE.length && j + d < n; d++) out[j + d] += pj * MOVE[d];
    }
    let s = 0;
    // a jump (starting again, a repeat) lands anywhere, or where the eyes are
    // (but never straight into the place where the page turns, or past it: that place is reached
    // note by note. A phrase that comes back there must not pull the playing ahead and turn early)
    const cut = this._jumpCut ?? -1;
    const jumpAt = (j) => (gz ? JUMP * ((1 - gz.w) / n + (gz.w * gz.K[j]) / gz.sumK) : JUMP / n) * (cut >= 0 && j >= cut ? (globalThis.__jumpCutK ?? 0.04) : 1);
    for (let j = 0; j < n; j++) {
      let l = like(fit(obs, seq[j], sh));
      if (gz) l *= 1 - gz.w + gz.w * gz.K[j];
      out[j] = (out[j] * (1 - JUMP) + jumpAt(j)) * l; s += out[j];
    }
    for (let j = 0; j < n; j++) out[j] /= s || 1;
    return { p: out, ev: s };
  }
  // The eyes, as evidence: each place of the music as likely as it is near where the eyes are, a
  // little behind it (the eyes read ahead of the playing). Counted as much as the eyes are seen well
  // and have agreed with the playing lately; not at all when they are off the music.
  _gazeK(seq) {
    if (!this.gaze) return null;
    const g = this.gaze();
    if (!g || !(g.q > 0)) return null;
    const w = Math.min(0.6, 0.6 * g.q * Math.min(1, this.trust * 1.6));
    if (w < 0.03) return null;
    const R = g.page + g.yn, sig = g.sig || 0.08, mu = g.lead ?? 0.035;
    const K = new Float64Array(seq.length); let sumK = 0;
    for (let j = 0; j < seq.length; j++) {
      const e = seq[j];
      const d = R - (e.pg + (e.yn ?? 0.5));
      // (along the line too, but only a little: the eyes jump about within a line)
      const dx = e.pg === g.page && Math.abs(d) < sig ? (g.xn - (e.xn ?? 0.5)) : 0;
      const k = Math.exp(-0.5 * ((d - mu) / sig) ** 2) * (0.65 + 0.35 * Math.exp(-0.5 * ((dx - 0.08) / 0.3) ** 2));
      K[j] = k; sumK += k;
    }
    return { w, K, sumK: sumK || 1, R, sig, mu };
  }
  // after each note: did the eyes agree with where the playing is (when the playing is sure)?
  _trustUpdate(gz, e, conf) {
    if (!this.gaze) return;
    const g = gz || (() => { const q = this.gaze(); return q && q.q > 0 ? { R: q.page + q.yn, sig: q.sig || 0.08, mu: q.lead ?? 0.035 } : null; })();
    if (!g || conf < 0.5 || !e) { if (!g && this.gaze) this.trust += (0.5 - this.trust) * 0.002; return; }
    const d = g.R - (e.pg + (e.yn ?? 0.5));
    let ok = Math.abs(d - g.mu) < 2.2 * g.sig ? 1 : 0;
    // the playing is sure of its place: how far the eyes are off it goes back to the eyes, which
    // slowly correct themselves (a head that has moved since the set-up shifts everything a little)
    if (this.gazeOff && conf > 0.6 && Math.abs(d - g.mu) < 0.3) this.gazeOff(d - g.mu);
    // eyes that stay put while the playing moves on are not reading (playing by heart, looking at the
    // conductor): they agree only by chance
    const h = this.gazeHist = this.gazeHist || [];
    h.push({ R: g.R, A: (e.pg || 0) + (e.yn ?? 0.5) }); if (h.length > 30) h.shift();
    if (h.length >= 24) {
      // the playing went down the page (a line or more), the eyes on average did not
      const half = h.length >> 1, mean = (a, k) => a.reduce((x, q) => x + q[k], 0) / a.length;
      const a1 = h.slice(0, half), a2 = h.slice(half);
      const dA = mean(a2, 'A') - mean(a1, 'A'), dG = mean(a2, 'R') - mean(a1, 'R');
      if (dA > 0.08 && dG < dA * 0.3) ok = 0;
    }
    this.trust += (ok - this.trust) * 0.08;
  }
  // Scores with a solo part over the piano (a cello sonata, a concerto's piano score): the soloist
  // plays only the top line, the pianist only the piano. Both readings are followed side by side,
  // and the one the playing fits better is the one that turns the pages.
  async _heard(obs) {
    const pages = [], gen = this._gen;
    const lastIdx = Math.min(this.pages() - 1, this.last + 1);
    for (let i = this.page; i <= lastIdx; i++) pages.push({ i, ...(await this.notesOf(i)) });
    // (stopped, turned or moved while the pages were being read: this note belongs to before)
    if (gen !== this._gen) return;
    this.heard++; this.sinceTurn++;
    // an instrument that sounds as written (cello, violin, flute, piano…): no interval to look for
    // (looking for one, a run of notes could be taken for the music a fourth away, and followed so)
    if (this.shift === null && this.fixedShift) { const f = this.fixedShift(); if (f !== null && f !== undefined) this.shift = f; }
    // the pace of the playing (time from one note to the next), for turning with the last notes
    if (obs.t !== undefined) { if (this.lastObsT !== undefined) { const d = obs.t - this.lastObsT; if (d > 80 && d < 2500) this.ioi = this.ioi ? this.ioi * 0.85 + d * 0.15 : d; } this.lastObsT = obs.t; }
    const solo = pages.some((pg) => pg.solo && pg.solo.length);
    if (!solo) { this.variant = 'all'; this._heardV(obs, pages, 'all', true); return; }
    const KEYS = ['post', 'seqKey', '_lastBest', '_lastConf', 'goRun', '_jumpCut'];
    const V = this.vstate = this.vstate || { all: { score: 0.5 }, solo: { score: 0 } };
    if (!this.variant) this.variant = 'all';
    const mine = {}; for (const k of KEYS) mine[k] = this[k];
    const evs = {};
    for (const v of ['all', 'solo']) {
      const st = V[v];
      for (const k of KEYS) this[k] = st[k];
      evs[v] = this._heardV(obs, pages, v, v === this.variant);
      for (const k of KEYS) st[k] = this[k];
      st.score = st.score * 0.94 + Math.log((evs[v] || 0) + 1e-9);
    }
    // the other reading takes over only when it is clearly better for a while
    const other = this.variant === 'all' ? 'solo' : 'all';
    if (this.shift !== null && V[other].score > V[this.variant].score + (globalThis.__varMargin ?? 2.5)) this.variant = other;
    for (const k of KEYS) this[k] = V[this.variant][k];
    void mine;
  }
  _heardV(obs, pages, v, act) {
    const seq = []; let firstNext = Infinity, turnAt = -1, barAt = -1, jumpCut = -1;
    pages.forEach((pg0) => {
      // (the solo reading: the top line alone, where the page has one over a piano)
      const pg = v === 'solo' && pg0.solo && pg0.solo.length ? { ...pg0, seq: pg0.solo, at: pg0.soloAt, turnAt: pg0.soloAt ? pg0.soloAt.bar : pg0.turnAt } : pg0;
      const off = seq.length;
      if (pg.i > this.last && firstNext === Infinity) firstNext = off;
      if (pg.i === this.last && pg.turnAt >= 0) { turnAt = off + (this.turnIndex(pg.at, this.when()) ?? pg.turnAt); barAt = off + ((pg.at && pg.at.bar) ?? pg.turnAt); jumpCut = off + Math.max(0, Math.min((pg.at && pg.at.prev) ?? pg.turnAt, pg.turnAt) - 2); }
      for (const e of pg.seq) seq.push({ ...e, pg: pg.i });
    });
    if (firstNext === Infinity) firstNext = seq.length;
    this._jumpCut = jumpCut;
    // (a page on show with no notes found, a title page or one that could not be read: it turns
    // once the playing is in the next one)
    if (turnAt < 0 && firstNext < seq.length) turnAt = firstNext;
    if (!seq.length) return 0;
    const key = v + pages.map((p) => p.i + ':' + p.seq.length).join('|');
    if (!this.post || this.seqKey !== key) { this._lastBest = undefined; this.post = { p: this._start(seq, firstNext), alt: new Map() }; this.seqKey = key; }
    const gz = this._gazeK(seq);
    let evNow = 0;
    // the interval of a transposing instrument: try the others alongside, until one is clearly best
    if (this.shift !== null && this.post.alt.size) { const st = this.post.alt.get(this.shift); if (st) this.post.p = st.p; this.post.alt.clear(); }
    if (this.shift === null) {
      const cands = obs.mono ? SHIFTS : [0];
      for (const sh of cands) {
        let st = this.post.alt.get(sh);
        if (!st) st = { p: sh === 0 ? this.post.p : this._start(seq, firstNext), score: 0 };
        const r = this._step(st.p, obs, seq, sh, gz);
        if (sh === 0) evNow = r.ev;
        st.p = r.p; st.score = st.score * 0.92 + Math.log(r.ev + 1e-12) + (sh === 0 ? 0.25 : 0);
        this.post.alt.set(sh, st);
      }
      if (this.heard >= 8) {
        const arr = [...this.post.alt.entries()].sort((a, b) => b[1].score - a[1].score);
        const z = this.post.alt.get(0);
        // music in its written key is far more likely: another interval must be clearly better,
        // and better than every other interval too (a wrong interval would turn at the wrong time)
        const margin = arr.length > 1 ? arr[0][1].score - arr[1][1].score : 99;
        if (act && ((arr[0][0] === 0 && margin > 1) || (arr[0][0] !== 0 && arr[0][1].score > z.score + 3 && margin > 2.5 && this.heard >= 12))) { this.shift = arr[0][0]; this.post.p = arr[0][1].p; this.post.alt.clear(); }
      }
      if (this.shift === null) {
        // until the interval is known, show the best guess, but never turn on it
        const arr = [...this.post.alt.entries()].sort((a, b) => b[1].score - a[1].score);
        this.post.p = arr[0][1].p; this.guessing = obs.mono;
      } else this.guessing = false;
    } else {
      // Music repeats itself: the same phrase further on fits the playing as well as the place
      // being played, and a wrong note could make the follower leap there (and turn the page bars
      // too early). While it is sure where the playing is, other places far from it fade away
      // (and come back as soon as the playing really is there).
      const pp = this.post.p, lb = this._lastBest, lc = this._lastConf || 0;
      // (going back is rarer still — a repeat — and needs the playing to say so for a few notes)
      if (lb !== undefined && lc > (globalThis.__fadeConf ?? 0.45) && lb < pp.length) {
        const k = globalThis.__farFade ?? 0.45, kb = globalThis.__backFade ?? 0.3;
        let s2 = 0; for (let j = 0; j < pp.length; j++) { if (j > lb + 8) pp[j] *= k; else if (j < lb - 6) pp[j] *= kb; s2 += pp[j]; }
        if (s2 > 0) for (let j = 0; j < pp.length; j++) pp[j] /= s2;
      }
      const r = this._step(this.post.p, obs, seq, this.shift, gz);
      this.post.p = r.p; evNow = r.ev;
    }
    const p = this.post.p;
    let best = 0; for (let j = 1; j < p.length; j++) if (p[j] > p[best]) best = j;
    // how sure: the probability near the best place
    let conf = 0; for (let j = Math.max(0, best - 2); j <= Math.min(p.length - 1, best + 2); j++) conf += p[j];
    this._lastBest = best; this._lastConf = conf;
    if (!act) return evNow;   // (the other reading only keeps up)
    this._trustUpdate(gz, seq[best], conf);
    if (window.__followDbg) window.__followDbg.push([Math.round(obs.t), obs.mono ? obs.pc : 'c', best, +conf.toFixed(2), seq[best] && seq[best].pcs.join('.'), this.shift, gz ? +gz.w.toFixed(2) : 0, +this.trust.toFixed(2), v]);
    if (conf < 0.3 || this.heard < 3) { this.onState && this.onState('Listening', true); return evNow; }
    const n = seq[best];
    this.onState && this.onState(`Bar ${n.bar + 1}${pages.length > 2 || this.last > this.page ? ` · p. ${n.pg + 1}` : ''}`, true);
    if (this.last >= this.pages() - 1 && n.pg <= this.last) return evNow;            // the last page: nothing to turn
    // right after a turn, wait for some playing on the new page (a page is never over in a few notes)
    const minAfter = Math.max(3, Math.min(8, Math.floor(firstNext / 3)));
    if (performance.now() - this.turnedAt < 1800 || this.sinceTurn < minAfter || (this.shift === null && this.guessing)) return evNow;
    // a page is not over before a good part of its notes have been played (music repeats itself: the
    // same phrase on the last line can seem to be heard long before it comes)
    if ((globalThis.__followMinPlay ?? 1) && turnAt > 0 && this.sinceTurn < turnAt * 0.6) return evNow;
    // mass at or past the turning point (the next page counts too: a late turn is still a turn)
    // (turning on the last line or with the last notes: a note or two before the place counts too,
    // the playing being heard a little late at the end of a page)
    const W = this.when(), slack = W > 0.6 ? 2 : 0;
    let ahead = 0; for (let j = Math.max(0, turnAt - slack); j < p.length; j++) ahead += p[j];
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
    } else go = turnAt >= 0 && ahead > 0.55 && conf > 0.35 && best >= turnAt - slack;
    // a turn needs the playing to stay there for two notes in a row (one stray note never turns),
    // unless it is already certain
    this.goRun = go ? (this.goRun || 0) + 1 : 0;
    if (go && this.goRun < 2 && ahead < 0.9) go = false;
    // with the last notes: once the last bar is surely being played, the turn comes when the notes
    // left should be over at this pace (long or repeated last notes are heard late, or not at all)
    if (!go && W >= 0.75 && !(split !== null && split !== undefined) && !(this.halfWanted && this.halfWanted()) && barAt >= 0 && best >= barAt && conf > 0.5 && this.ioi && !this.endT) {
      let inBar = 0; for (let j = barAt; j < p.length; j++) inBar += p[j];
      if (inBar > 0.7) {
        const left = Math.max(0, (W >= 0.95 ? firstNext - 1 : turnAt) - best), g0 = this._gen;
        this.endT = setTimeout(() => { this.endT = 0; if (g0 === this._gen && performance.now() - this.turnedAt > 1800) { this.turnedAt = performance.now(); this.sinceTurn = 0; this.turnFn(); } }, Math.max(0, left * this.ioi));
      }
    }
    if (go) {
      this.goRun = 0; if (this.endT) { clearTimeout(this.endT); this.endT = 0; }
      this.turnedAt = performance.now(); this.sinceTurn = 0;
      this.turnFn();
    }
    return evNow;
  }
}
