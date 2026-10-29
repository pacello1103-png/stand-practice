// Studio: put the score on a recording, the way musicians share playing on Instagram.
// Draw around the music in a score; Stand finds the bars, lays them out as one line and moves
// along with your playing: it listens to the recording, reads the notes on the page and lines
// them up. Three looks (white paper, warm paper, or just the lines and notes with the video
// showing through), any size and place on the picture, images, trimming, vertical or square
// formats, and an export that is saved in Recordings and ready to share.
import { db, uid } from './db.js';
import { getCtx, wantAudio } from './audio.js';
import { detectPitch } from './tuner.js';
import { analyse, staffEvents } from './omr.js';
import { makeImpulse, ROOMS, computePeaks, peakOf, encodeWav } from './recorder.js';
import { videoThumb } from './video.js';
import { CLEFS, keyAlter, midiOf } from './compose/model.js';
import { onsetsOf, template, cosine } from './listen.js';
import { Grader, LOOKS, lookParams, isNeutral, autoLook } from './grade.js';
const grader = new Grader();

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + r.toFixed(1).padStart(4, '0'); };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let D = {};
const ST = { take: null, P: null, media: null, url: null, pcm: null, sr: 48000, raf: 0, sel: null, strips: new Map(), images: new Map(), dur: 1, tapping: null, busy: null };
const FORMATS = { '9:16': [1080, 1920, 'Reels'], '4:5': [1080, 1350, 'Post'], '1:1': [1080, 1080, 'Square'], '16:9': [1920, 1080, 'Wide'], orig: [0, 0, 'Original'] };

export function initStudio(deps) {
  D = deps;
  wire();
}

// =====================================================================
// Opening and saving
// =====================================================================
export async function openStudio(takeId) {
  const take = await db.get('takes', takeId);
  if (!take) { D.toast('That recording could not be opened.'); return; }
  ST.take = take;
  const saved = await db.get('files', 'studio:' + takeId);
  ST.P = saved ? saved.data : { takeId, format: take.kind === 'video' ? '9:16' : '1:1', fit: 'fill', pan: { x: 0.5, y: 0.5 }, bg: '#14171f', overlays: [], trim: null, sound: { room: D.room ? D.room() : 'studio', wet: D.wet ? D.wet() : 0.18, level: true } };
  ST.strips.clear(); ST.images.clear();
  // media element: the video itself, or the recording as a sound file
  if (ST.url) URL.revokeObjectURL(ST.url);
  const af = await db.get('files', 'audio:' + takeId);
  ST.pcm = af ? af.data : null; ST.sr = take.sr || 48000;
  if (take.kind === 'video') {
    const vf = await db.get('files', 'video:' + takeId);
    if (!vf) { D.toast('That video could not be opened.'); return; }
    ST.url = URL.createObjectURL(vf.data);
    const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto'; v.src = ST.url; v.muted = false;
    ST.media = v;
  } else {
    if (!ST.pcm) { D.toast('That recording could not be opened.'); return; }
    ST.url = URL.createObjectURL(encodeWav([ST.pcm], ST.sr));
    const a = document.createElement('audio'); a.preload = 'auto'; a.src = ST.url;
    ST.media = a;
  }
  await new Promise((res) => { ST.media.onloadedmetadata = res; ST.media.onerror = res; setTimeout(res, 4000); });
  ST.dur = isFinite(ST.media.duration) && ST.media.duration > 0 ? ST.media.duration : (take.dur || 1);
  if (!ST.P.trim) ST.P.trim = { a: 0, b: ST.dur };
  ST.P.trim.b = Math.min(ST.P.trim.b, ST.dur);
  for (const o of ST.P.overlays) await prepareOverlay(o);
  $('#studio').hidden = false; document.body.classList.add('in-studio');
  $('#stTitle').textContent = take.name || 'Studio';
  ST.sel = ST.P.overlays.find((o) => o.kind === 'score') ? { id: ST.P.overlays.find((o) => o.kind === 'score').id } : null;
  ST.media.currentTime = ST.P.trim.a;
  // (a picture of the first frame to show, and to draw the looks with)
  if (ST.media.readyState < 2) await new Promise((res) => { const done = () => { ST.media.removeEventListener('loadeddata', done); ST.media.removeEventListener('seeked', done); res(); }; ST.media.addEventListener('loadeddata', done); ST.media.addEventListener('seeked', done); setTimeout(done, 2500); });
  sizeCanvas(); renderSide(); renderTimeline(); drawWave(); frame();
  ST.media.addEventListener('seeked', () => frame());
  ST.media.addEventListener('ended', () => { ST.playing = false; syncPlay(); lsStop(); });
  // the sound heard as it will be in the video (room, level): played alongside the picture
  ST.pk = ST.pcm ? peakOf(ST.pcm) : 1; LS.buf = null;
  ST.media.addEventListener('playing', () => lsStart());
  ST.media.addEventListener('pause', () => lsStop());
  ST.media.addEventListener('seeked', () => { if (!ST.media.paused) lsStart(); });
}
// ---------- the sound while you watch, with the Sound settings ----------
// The recording's own sound is played by the sound system (with the room and the level chosen),
// in step with the picture, which plays silent; before, the picture's own sound played and the
// settings were only heard in the finished video.
const LS = { ctx: null, src: null, buf: null, irs: new Map() };
function lsGraph() {
  const ctx = getCtx();
  if (LS.ctx !== ctx) {
    LS.ctx = ctx; LS.buf = null; LS.irs.clear();
    LS.level = ctx.createGain(); LS.dry = ctx.createGain(); LS.conv = ctx.createConvolver(); LS.wet = ctx.createGain();
    LS.level.connect(LS.dry).connect(ctx.destination);
    LS.level.connect(LS.conv).connect(LS.wet).connect(ctx.destination);
  }
  lsApply();
  return ctx;
}
function lsApply() {
  if (!LS.ctx || !ST.P) return;
  const t = LS.ctx.currentTime, S = ST.P.sound || {};
  LS.level.gain.setTargetAtTime(S.level !== false && ST.pk > 0.001 ? Math.min(8, 0.89 / ST.pk) : 1, t, 0.03);
  const room = ROOMS[S.room];
  if (room) {
    if (!LS.irs.has(S.room)) LS.irs.set(S.room, makeImpulse(LS.ctx, room));
    if (LS.conv.buffer !== LS.irs.get(S.room)) LS.conv.buffer = LS.irs.get(S.room);
  }
  LS.wet.gain.setTargetAtTime(room ? (S.wet ?? 0.18) * 0.9 : 0, t, 0.03);
}
function lsStop() {
  if (LS.src) { const s = LS.src; LS.src = null; try { s.onended = null; s.stop(); } catch {} }
  wantAudio(false, 'studio');
}
function lsStart() {
  lsStop();
  const m = ST.media;
  if (!m || m.paused || ST.exporting || !ST.pcm) return;
  // (very long recordings: their own sound, as before; the copy for the sound system would be too big)
  if (ST.pcm.length > ST.sr * 60 * 15) { m.muted = false; return; }
  const ctx = lsGraph();
  if (!LS.buf || LS.buf.sampleRate !== ST.sr || LS.bufFor !== ST.pcm) { LS.buf = ctx.createBuffer(1, Math.max(1, ST.pcm.length), ST.sr); LS.buf.copyToChannel(ST.pcm, 0); LS.bufFor = ST.pcm; }
  m.muted = true;
  const src = ctx.createBufferSource(); src.buffer = LS.buf; src.playbackRate.value = m.playbackRate || 1; src.connect(LS.level);
  const at = Math.max(0, Math.min(LS.buf.duration - 0.01, m.currentTime));
  const when = ctx.currentTime + 0.01; src.start(when, at);
  LS.src = src; LS.c0 = when; LS.m0 = at;
  wantAudio(true, 'studio');
}
// (called every frame while playing: the sound kept with the picture)
function lsKeep() {
  if (!LS.src || !ST.media || ST.media.paused || LS.ctx !== getCtx()) { if (LS.src && LS.ctx !== getCtx()) lsStart(); return; }
  const heard = LS.m0 + (LS.ctx.currentTime - LS.c0) * (ST.media.playbackRate || 1);
  if (Math.abs(heard - ST.media.currentTime) > 0.12 && !ST.media.seeking) lsStart();
}
async function save() {
  if (!ST.P) return;
  await db.put('files', { id: 'studio:' + ST.take.id, data: ST.P });
}
let saveT; function saveSoon() { clearTimeout(saveT); saveT = setTimeout(save, 600); }
function close() {
  pause(); lsStop(); save();
  $('#studio').hidden = true; document.body.classList.remove('in-studio');
  if (ST.media) { ST.media.removeAttribute('src'); ST.media.load(); }
  if (ST.url) URL.revokeObjectURL(ST.url); ST.url = null;
  for (const s of ST.strips.values()) { s.canvas.width = 0; if (s.mask) s.mask.width = 0; }
  ST.strips.clear();
}

// =====================================================================
// The score: from the drawn region to a line of bars
// =====================================================================
async function addScore() {
  pause();
  const region = await D.pickRegion(null, null, { title: 'Choose the lines you play in this video' });
  if (!region) return;
  busy('Reading the score…', 'Finding the staves and the bars.', 0.2);
  try {
    const A = await analyse(region.canvas);
    if (!A.staves.length) { busy(null); D.toast('No staves found there. Draw a little wider than the music, around whole lines.', 5000); return; }
    const blob = await new Promise((res) => region.canvas.toBlob(res, 'image/png'));
    const o = {
      id: uid(), kind: 'score', title: region.source && region.source.title || 'Score', src: { scoreId: region.source && region.source.scoreId, page: region.page, box: region.box },
      img: blob, look: 'paper', ink: '#ffffff', mode: 'scroll', band: true, perView: { '9:16': 2, '4:5': 2, '1:1': 3 }[ST.P.format] || 4, size: ST.P.format === '9:16' || ST.P.format === '4:5' ? 0.96 : 0.9, pos: { x: 0.5, y: ST.P.format === '16:9' ? 0.8 : 0.78 }, opacity: 1, highlight: true,
      layout: stripLayout(A, region.canvas.width, region.canvas.height), times: null, synced: 'even',
    };
    if (!o.layout.bars.length) { busy(null); D.toast('No bars found there.', 4000); return; }
    o.times = evenTimes(o.layout.bars.length);
    ST.P.overlays = ST.P.overlays.filter((x) => x.kind !== 'score');   // one score at a time
    ST.P.overlays.unshift(o);
    await prepareOverlay(o);
    ST.sel = { id: o.id };
    busy(null);
    saveSoon(); renderSide(); renderTimeline(); frame();
    // line it up with the playing straight away
    if (ST.pcm) autoSync(o);
    else D.toast(`${o.layout.bars.length} bars. Use Sync › Tap along to line them up with the video.`, 4500);
  } catch (err) { console.error(err); busy(null); D.toast('That part of the score could not be read.'); }
}
// Bars in reading order: each system cut at its barlines; later systems without their clef.
function stripLayout(A, W, H) {
  const sp = A.sp;
  const segs = [], bars = [], notes = [], events = [];
  let sx = 0;
  // every note of a staff as sounding pitch classes, with the clef and key as they change along the
  // line and the accidentals carried through the bar (as the score follower reads them)
  const pcsOf = (st, k, n) => {
    const clef0 = CLEFS[st.clef] ? st.clef : k > 0 && n === 2 ? 'bass' : 'treble';
    const bars = staffEvents(st); let key = st.key || 0; const out = [];
    bars.forEach((b, bi) => {
      if (bars.meta && bars.meta[bi] && bars.meta[bi].key !== undefined) key = bars.meta[bi].key;
      for (const it of b) {
        if (it.rest) continue;
        const bottom = (CLEFS[it.clef] || CLEFS[clef0]).bottom;
        out.push({ x: it.x, pcs: it.ps.map((q) => { const s2 = bottom + q; const a = it.acc && it.acc[q] !== undefined ? it.acc[q] : keyAlter(key, s2); return ((midiOf(s2, a) % 12) + 12) % 12; }) });
      }
    });
    return out;
  };
  A.systems.forEach((sys, si) => {
    const sts = sys.map((i) => A.staves[i]);
    const evAll = sts.map((st, k) => pcsOf(st, k, sts.length));
    const top = clamp(Math.min(...sts.map((s) => s.top)) - sp * 3.6, 0, H), bot = clamp(Math.max(...sts.map((s) => s.bottom)) + sp * 3.6, 0, H);
    const s0 = sts[0];
    const firstHead = s0.heads.length ? Math.min(...s0.heads.map((h) => h.x)) : s0.x0 + sp * 4;
    let x0 = si === 0 ? Math.max(0, s0.x0 - sp * 0.5) : Math.max(s0.x0, firstHead - sp * 1.6);
    const x1 = Math.min(W, s0.x1 + sp * 0.4);
    const lines = s0.bars.map((b) => b.x).filter((x) => x > x0 + sp * 1.2 && x < x1 - sp * 1.2).sort((a, b) => a - b);
    // a barline right at the start belongs to the previous line
    const cuts = [x0, ...lines, x1];
    const seg = { x: x0, y: top, w: x1 - x0, h: bot - top, sx, staff: s0.top - top, sX0: Math.max(0, s0.x0 - x0), sX1: Math.min(x1 - x0, s0.x1 - x0) };
    segs.push(seg);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      if (b - a < sp * 1.5) continue;
      const bi = bars.length;
      bars.push({ x0: sx + (a - x0), x1: sx + (b - x0), seg: segs.length - 1 });
      // the notes of this bar (top staff), for following the playing
      const inBar = s0.heads.filter((h) => h.x >= a && h.x < b).sort((p, q) => p.x - q.x);
      const groups = [];
      for (const h of inBar) { const g = groups[groups.length - 1]; if (g && Math.abs(g.x - h.x) < sp * 0.5) g.ps.push({ p: h.p, acc: h.acc }); else groups.push({ x: h.x, ps: [{ p: h.p, acc: h.acc }] }); }
      for (const g of groups) notes.push({ bar: bi, x: sx + (g.x - x0), ps: g.ps });
      // every staff of the line together, as sounding pitch classes (for chords and the piano)
      const here = [];
      evAll.forEach((evs) => {
        for (const e of evs) if (e.x >= a && e.x < b) {
          const g = here.find((q) => Math.abs(q.x - e.x) < sp * 0.7);
          if (g) { for (const pc of e.pcs) if (!g.pcs.includes(pc)) g.pcs.push(pc); } else here.push({ x: e.x, pcs: [...e.pcs] });
        }
      });
      here.sort((p2, q) => p2.x - q.x);
      for (const g of here) events.push({ bar: bi, x: sx + (g.x - x0), pcs: g.pcs });
    }
    sx += x1 - x0 + sp * 1.2;
  });
  // every line of music sits at the same height in the strip
  const above = Math.max(...segs.map((s) => s.staff)), below = Math.max(...segs.map((s) => s.h - s.staff));
  for (const s of segs) s.dy = above - s.staff;
  return { segs, bars, notes, events, width: sx - sp * 1.2, height: above + below, sp, clef: A.staves[0].clef, key: A.staves[0].key };
}
function evenTimes(n) {
  const a = ST.P.trim.a + 0.4, b = ST.P.trim.b - 0.2;
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}
// The picture of the bars as one long line, plus a see-through version (just the ink).
async function prepareOverlay(o) {
  if (o.kind === 'image') {
    const bmp = await createImageBitmap(o.img).catch(() => null);
    if (bmp) ST.images.set(o.id, bmp);
    return;
  }
  const bmp = await createImageBitmap(o.img);
  const L = o.layout;
  const c = document.createElement('canvas'); c.width = Math.ceil(L.width); c.height = Math.ceil(L.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  for (const s of L.segs) g.drawImage(bmp, s.x, s.y, s.w, s.h, s.sx, s.dy ?? (c.height - s.h) / 2, s.w, s.h);
  bmp.close && bmp.close();
  // join the lines: the staff runs on through the gaps, so it reads as one endless line
  if (L.sp && L.segs.length > 1) {
    const s0 = L.segs[0], top = (s0.dy ?? 0) + s0.staff;
    g.fillStyle = '#1a1a1a';
    const th = Math.max(1, L.sp * 0.1);
    for (let i = 0; i + 1 < L.segs.length; i++) {
      const A = L.segs[i], B = L.segs[i + 1];
      const xa = A.sx + (A.sX1 ?? A.w) - 1, xb = B.sx + (B.sX0 ?? 0) + 1;
      if (A.sX1 !== undefined) g.fillStyle = '#fff', g.fillRect(xa + 2, (A.dy ?? 0), B.sx + (B.sX0 ?? 0) - xa - 2, c.height), g.fillStyle = '#1a1a1a';
      for (let k = 0; k < 5; k++) g.fillRect(xa, Math.round(top + k * L.sp - th / 2), xb - xa, th);
    }
  }
  // the ink alone: dark becomes opaque, paper becomes clear
  const m = document.createElement('canvas'); m.width = c.width; m.height = c.height;
  const id = g.getImageData(0, 0, c.width, c.height); const d = id.data;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; const a = clamp((235 - v) * 1.6, 0, 255); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }
  m.getContext('2d').putImageData(id, 0, 0);
  ST.strips.set(o.id, { canvas: c, mask: m, tinted: new Map() });
}
function tintedMask(st, color) {
  if (st.tinted.has(color)) return st.tinted.get(color);
  const t = document.createElement('canvas'); t.width = st.mask.width; t.height = st.mask.height;
  const g = t.getContext('2d'); g.drawImage(st.mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, t.width, t.height);
  st.tinted.set(color, t); return t;
}

// =====================================================================
// Following the playing: listen, read, line up
// =====================================================================
async function pitchTrack(pcm, sr, a, b, onProgress) {
  const N = 2048, hop = Math.round(sr * 0.01);
  const i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(pcm.length - N, Math.floor(b * sr));
  const frames = [];
  let k = 0;
  for (let i = i0; i < i1; i += hop) {
    const buf = pcm.subarray(i, i + N);
    let ms = 0; for (let j = 0; j < N; j += 4) ms += buf[j] * buf[j];
    const rms = Math.sqrt(ms / (N / 4));
    const r = rms > 0.004 ? detectPitch(buf, sr) : null;
    frames.push({ t: (i + N / 2) / sr, midi: r && r.clarity > 0.82 ? 69 + 12 * Math.log2(r.freq / 440) : NaN, rms });
    if (++k % 200 === 0) { onProgress && onProgress((i - i0) / (i1 - i0)); await new Promise((r2) => setTimeout(r2, 0)); }
  }
  return frames;
}
function notesFrom(frames) {
  const n = frames.length;
  const med = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = []; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < n && !isNaN(frames[j].midi)) w.push(frames[j].midi);
    med[i] = w.length >= 3 ? w.sort((x, y) => x - y)[w.length >> 1] : NaN;
  }
  const notes = [];
  let cur = null, off = 0;
  const gate = Math.max(0.006, frames.reduce((m, f) => Math.max(m, f.rms), 0) * 0.04);
  for (let i = 0; i < n; i++) {
    const m = med[i], f = frames[i];
    // a new attack: the sound jumps up after a dip
    const prevMin = Math.min(...frames.slice(Math.max(0, i - 6), i).map((q) => q.rms), Infinity);
    const attack = f.rms > gate && f.rms > prevMin * 2.1 && (!cur || f.t - cur.t > 0.09);
    if (isNaN(m) || f.rms < gate) { if (cur && ++off > 4) { notes.push(cur); cur = null; } continue; }
    off = 0;
    if (!cur) { cur = { t: f.t, ps: [m] }; continue; }
    const cm = cur.ps.slice().sort((x, y) => x - y)[cur.ps.length >> 1];
    if (Math.abs(m - cm) > 0.6) {
      // only a real change if it lasts
      let stay = 0; for (let j = i; j < Math.min(n, i + 4); j++) if (!isNaN(med[j]) && Math.abs(med[j] - cm) > 0.6) stay++;
      if (stay >= 3) { notes.push(cur); cur = { t: f.t, ps: [m] }; continue; }
    } else if (attack) { notes.push(cur); cur = { t: f.t, ps: [m] }; continue; }
    cur.ps.push(m);
  }
  if (cur) notes.push(cur);
  return notes.filter((q) => q.ps.length >= 4).map((q) => ({ t: q.t, midi: q.ps.slice().sort((x, y) => x - y)[q.ps.length >> 1] }));
}
// Dynamic time warping between the notes on the page and the notes heard.
function align(scoreN, played) {
  const n = scoreN.length, m = played.length;
  const INF = 1e9, D = new Float64Array((n + 1) * (m + 1)).fill(INF), B = new Uint8Array((n + 1) * (m + 1));
  D[0] = 0;
  for (let i = 1; i <= n; i++) { D[i * (m + 1)] = i * 1.2; B[i * (m + 1)] = 2; }
  for (let j = 1; j <= m; j++) { D[j] = j * 0.9; B[j] = 3; }
  const cost = (i, j) => { let c = 99; const pm = played[j].midi; for (const sm of scoreN[i].midis) { const d = Math.abs(pm - sm); c = Math.min(c, d, Math.abs(d - 12) + 0.6, Math.abs(d - 24) + 1.2); } return Math.min(4, c); };
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = cost(i - 1, j - 1);
    const a = D[(i - 1) * (m + 1) + j - 1] + c, b = D[(i - 1) * (m + 1) + j] + 1.2, d = D[i * (m + 1) + j - 1] + 0.9;
    const k = i * (m + 1) + j;
    if (a <= b && a <= d) { D[k] = a; B[k] = 1; } else if (b <= d) { D[k] = b; B[k] = 2; } else { D[k] = d; B[k] = 3; }
  }
  // best end: the score may end before the recording does
  let best = INF, bj = m; for (let j = 1; j <= m; j++) { const v = D[n * (m + 1) + j] + (m - j) * 0.05; if (v < best) { best = v; bj = j; } }
  const match = new Array(n).fill(-1);
  let i = n, j = bj, good = 0;
  while (i > 0 && j > 0) {
    const b = B[i * (m + 1) + j];
    if (b === 1) { const c = cost(i - 1, j - 1); if (c < 1.1) { match[i - 1] = j - 1; good++; } i--; j--; } else if (b === 2) i--; else j--;
  }
  return { match, cost: best / Math.max(1, n), good: good / Math.max(1, n) };
}
// Chords heard against chords on the page: dynamic time warping on how well each fits,
// trying the music in other keys too (for instruments that sound in another key).
function alignChords(evs, ons) {
  const n = evs.length, m = ons.length;
  if (m < 3) return null;
  let best = null;
  for (const sh of [0, 10, 2, 9, 3, 7, 5]) {
    const tp = evs.map((e) => template(e.pcs.map((p) => (p + sh) % 12)));
    const fit = (i, j) => Math.max(0, Math.min(1, (cosine(ons[j].chroma, tp[i]) - 0.3) / 0.55));
    const W = m + 1, Dm = new Float64Array((n + 1) * W).fill(1e9), B = new Uint8Array((n + 1) * W);
    Dm[0] = 0;
    for (let j = 1; j <= m; j++) { Dm[j] = j * 0.15; B[j] = 3; }
    for (let i = 1; i <= n; i++) { Dm[i * W] = i * 0.9; B[i * W] = 2; }
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      const c = 1 - fit(i - 1, j - 1);
      const a = Dm[(i - 1) * W + j - 1] + c, b = Dm[(i - 1) * W + j] + 0.9, d = Dm[i * W + j - 1] + 0.3;   // extra attacks (echoes, ornaments) are common
      const k = i * W + j;
      if (a <= b && a <= d) { Dm[k] = a; B[k] = 1; } else if (b <= d) { Dm[k] = b; B[k] = 2; } else { Dm[k] = d; B[k] = 3; }
    }
    let bc = 1e9, bj = m; for (let j = 1; j <= m; j++) { const v = Dm[n * W + j] + (m - j) * 0.15; if (v < bc) { bc = v; bj = j; } }
    const match = new Array(n).fill(-1); let i = n, j = bj, good = 0;
    while (i > 0 && j > 0) { const b = B[i * W + j]; if (b === 1) { if (fit(i - 1, j - 1) > 0.5) { match[i - 1] = j - 1; good++; } i--; j--; } else if (b === 2) i--; else j--; }
    const r = { good: good / n, cost: bc / n, shift: sh, match };
    if (!best || r.good - (sh ? 0.08 : 0) > best.good - (best.shift ? 0.08 : 0)) best = r;
  }
  best.evs = evs.map((e, i) => ({ bar: e.bar, x: e.x, t: best.match[i] >= 0 ? ons[best.match[i]].t : null }));
  best.how = 'chords';
  return best;
}
async function autoSync(o) {
  if (!ST.pcm) { D.toast('This recording has no sound to follow. Use Tap along.'); return; }
  const L = o.layout;
  if (L.notes.length < 3) { D.toast('Not enough notes were found in the score to follow. Use Tap along.', 4000); return; }
  busy('Following your playing…', 'Listening to the recording.', 0);
  let cancelled = false; ST.busyCancel = () => { cancelled = true; };
  try {
    // two ways of listening: note by note (one line at a time) and chord by chord (the piano,
    // double stops, an ensemble). Both are tried; the one that fits the page best wins.
    const frames = await pitchTrack(ST.pcm, ST.sr, ST.P.trim.a, ST.P.trim.b, (f) => busy('Following your playing…', 'Listening to the recording.', f * 0.45));
    if (cancelled) return;
    const played = notesFrom(frames);
    let best = null;
    if (played.length >= 3) {
      // the page does not say which clef or instrument: try each and keep the best fit
      const clefs = L.clef ? [L.clef, ...['treble', 'bass', 'alto', 'tenor'].filter((c) => c !== L.clef)] : ['treble', 'bass', 'alto', 'tenor'];
      for (const clef of clefs) {
        for (const shift of [0, -12, 12, -2, -9, -7, 2, -24, 24]) {
          const sn = L.notes.map((nt) => ({ bar: nt.bar, midis: nt.ps.map(({ p, acc }) => { const s2 = CLEFS[clef].bottom + p; const a = acc !== undefined ? acc : keyAlter(L.key || 0, s2); return midiOf(s2, a) + shift; }) }));
          const r = align(sn, played);
          const score = r.cost - r.good * 0.8 + (clef === L.clef ? -0.15 : 0) + (shift ? 0.05 : 0);
          if (!best || score < best.score) best = { ...r, score, clef, shift };
        }
      }
      best.evs = L.notes.map((nt, i) => ({ bar: nt.bar, x: nt.x, t: best.match[i] >= 0 ? played[best.match[i]].t : null }));
      best.how = 'notes';
    }
    if (L.events && L.events.length >= 3 && (!best || best.good < 0.8 || L.events.some((e) => e.pcs.length > 1))) {
      busy('Following your playing…', 'Listening for chords.', 0.5);
      const ons = await onsetsOf(ST.pcm, ST.sr, ST.P.trim.a, ST.P.trim.b, (f) => busy('Following your playing…', 'Listening for chords.', 0.5 + f * 0.35));
      if (cancelled) return;
      const ch = alignChords(L.events, ons);
      // a page with chords is better followed chord by chord, unless that clearly fails
      const chordy = L.events.filter((e) => e.pcs.length > 1).length > L.events.length * 0.2;
      if (ch) ch.alt = best ? best.good : null;
      if (ch && (!best || (chordy ? ch.good > 0.45 || ch.good > best.good : ch.good > best.good + 0.05))) best = ch;
    }
    if (!best) { busy(null); D.toast('Not enough clear notes were heard. Use Tap along.', 4500); return; }
    busy('Following your playing…', 'Lining them up with the score.', 0.9);
    await new Promise((r) => setTimeout(r, 30));
    // bar times from the first matched note of each bar
    const nb = L.bars.length;
    const first = new Array(nb).fill(null);
    const byBar = Array.from({ length: nb }, () => []);
    for (const e of best.evs) byBar[e.bar].push({ x: e.x, t: e.t });
    let prevLast = null;
    for (let k = 0; k < nb; k++) {
      const ns = byBar[k].sort((a, b) => a.x - b.x), hit = ns.filter((n) => n.t !== null);
      if (!hit.length) continue;
      const fm = hit[0];
      if (fm === ns[0]) first[k] = fm.t;
      else {
        // the first note of the bar was not heard: step back from the first one that was,
        // at the pace of the notes around it
        const nm = hit[1];
        let rate = nm && nm.x > fm.x ? (nm.t - fm.t) / (nm.x - fm.x) : prevLast && fm.x > prevLast.x ? (fm.t - prevLast.t) / (fm.x - prevLast.x) : 0;
        if (!(rate > 0) || !isFinite(rate)) rate = 0;
        let t = fm.t - (fm.x - ns[0].x) * rate;
        if (prevLast) t = Math.max(t, prevLast.t + 0.08);
        first[k] = Math.min(t, fm.t);
      }
      prevLast = hit[hit.length - 1];
    }
    const known = first.map((t, k) => (t !== null ? k : -1)).filter((k) => k >= 0);
    if (known.length < 2) { busy(null); D.toast('Your playing could not be matched with the score. Use Tap along.', 5000); return; }
    const times = new Array(nb + 1);
    for (let k = 0; k < nb; k++) {
      if (first[k] !== null) { times[k] = first[k] - 0.05; continue; }
      // in between two known bars: share the time out; before or after: keep the pace
      const prev = known.filter((q) => q < k).pop(), next = known.find((q) => q > k);
      if (prev !== undefined && next !== undefined) times[k] = first[prev] + ((first[next] - first[prev]) * (k - prev)) / (next - prev);
      else if (next !== undefined) { const pace = (first[known[1]] - first[known[0]]) / (known[1] - known[0]); times[k] = first[next] - pace * (next - k); }
      else { const a2 = known[known.length - 2], b2 = known[known.length - 1]; const pace = (first[b2] - first[a2]) / (b2 - a2); times[k] = first[b2] + pace * (k - b2); }
    }
    const lastPlayed = Math.max(...best.evs.map((e) => e.t || 0)) + 0.6;
    const pace = (times[nb - 1] - times[0]) / Math.max(1, nb - 1);
    times[nb] = Math.min(ST.P.trim.b, Math.max(times[nb - 1] + pace * 0.5, Math.min(lastPlayed, times[nb - 1] + pace * 1.5)));
    for (let k = 1; k <= nb; k++) if (times[k] < times[k - 1] + 0.12) times[k] = times[k - 1] + 0.12;
    o.times = times.map((t) => clamp(t, ST.P.trim.a, ST.P.trim.b));
    // inside each bar: where each heard note is, as a share of the bar's width and of its time,
    // so the line moves note by note with the playing (and still fits if bars are moved by hand)
    o.knots = byBar.map((ns, k) => {
      const T0 = o.times[k], T1 = o.times[k + 1], b = L.bars[k];
      const out = []; let lx = 0, lt = 0;
      for (const n of ns.filter((q) => q.t !== null).sort((p, q) => p.x - q.x)) {
        const fx = (n.x - b.x0) / Math.max(1, b.x1 - b.x0), ft = (n.t - T0) / Math.max(0.01, T1 - T0);
        if (fx > lx + 0.02 && ft > lt + 0.02 && fx < 0.98 && ft < 0.98) { out.push([ft, fx]); lx = fx; lt = ft; }
      }
      return out;
    });
    o.synced = 'auto'; o.syncInfo = { good: best.good, clef: best.clef, shift: best.shift, how: best.how, alt: best.alt };
    busy(null);
    saveSoon(); renderSide(); renderTimeline(); frame();
    D.toast(best.good > 0.55 ? `Lined up with your playing (${Math.round(best.good * 100)}% of the notes matched).` : 'Lined up as well as possible. Check the bars on the timeline, or use Tap along.', 4200);
  } catch (err) { console.error(err); busy(null); D.toast('Following the playing did not work here. Use Tap along.'); }
}
// Tap along: a tap on each bar's first beat. A tap lands a little off the beat it means (the finger,
// and the sound reaching the ear a moment after the picture's clock), so each tap is then drawn to
// the note that starts nearest to it in the recording, when one starts clearly there.
function startTap(o) {
  pause();
  ST.tapping = { o, k: 0, times: [] };
  const t0 = Math.max(ST.P.trim.a, (o.times ? o.times[0] : ST.P.trim.a) - 2);
  ST.media.currentTime = t0;
  $('#stTap').hidden = false; $('#stTapInfo').textContent = 'Tap on the first beat of bar 1';
  // (the notes' starts, found while you tap)
  if (ST.pcm && !(ST.onsets && ST.onsets.a === ST.P.trim.a && ST.onsets.b === ST.P.trim.b)) {
    const a = ST.P.trim.a, b = ST.P.trim.b;
    ST.onsets = { a, b, list: null, job: onsetsOf(ST.pcm, ST.sr, a, b).then((l) => { if (ST.onsets && ST.onsets.a === a && ST.onsets.b === b) ST.onsets.list = l; return l; }).catch(() => null) };
  }
  play();
}
// the clock of what is heard: the media's own time, made smooth between its updates
function heardTime() {
  const m = ST.media, now = performance.now(), ct = m.currentTime;
  const c = ST.clk;
  if (!c || c.ct !== ct || m.paused) ST.clk = { ct, p: now };
  const at = ST.clk.ct + (m.paused ? 0 : Math.min(0.3, (now - ST.clk.p) / 1000) * (m.playbackRate || 1));
  return at;
}
function tap() {
  const T = ST.tapping; if (!T) return;
  const t = heardTime();
  T.times.push(t); T.k++;
  const n = T.o.layout.bars.length;
  $('#stTapInfo').textContent = T.k < n ? `Bar ${T.k + 1} of ${n}` : 'Tap where the last bar ends';
  if (T.k > n) finishTap();
}
// each tap to the clearest note start near it (from a little before to a little after the tap)
export function snapTaps(times, onsets, sr = 48000, win = [-0.2, 0.12]) {
  if (!onsets || onsets.length < 2) return times.slice();
  // (a note start is found a little early, by most of the listening window: put back where it is heard)
  const late = 3072 / sr - 0.012;
  onsets = onsets.map((x) => ({ t: x.t + late, fl: x.fl }));
  const fls = onsets.map((x) => x.fl).sort((x, y) => x - y), med = fls[fls.length >> 1] || 1;
  const out = times.map((t) => {
    let best = null, bs = 0;
    for (const on of onsets) {
      const d = on.t - t; if (d < win[0] || d > win[1]) continue;
      const sc = (on.fl / med) * Math.exp(-Math.pow((d + 0.03) / 0.09, 2));
      if (sc > bs) { bs = sc; best = on.t; }
    }
    return best !== null && bs > 0.45 ? best : t - 0.03;
  });
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1] + 0.05) out[i] = Math.max(times[i], out[i - 1] + 0.05);
  return out;
}
async function finishTap() {
  const T = ST.tapping; if (!T) return; ST.tapping = null;
  $('#stTap').hidden = true;
  pause();
  const n = T.o.layout.bars.length;
  if (T.times.length >= 2) {
    let raw = T.times.slice(0, n + 1);
    if (ST.onsets && (ST.onsets.list || ST.onsets.job)) {
      if (!ST.onsets.list) busy('Lining up your taps…', 'Listening for the notes.', 0.5);
      const list = ST.onsets.list || await ST.onsets.job; busy(null);
      raw = snapTaps(raw, list, ST.sr);
    }
    const times = raw;
    const pace = (times[times.length - 1] - times[0]) / (times.length - 1);
    while (times.length < n + 1) times.push(Math.min(ST.P.trim.b, times[times.length - 1] + pace));
    T.o.times = times; T.o.synced = 'tap';
    saveSoon(); D.toast('Bars set from your taps.', 2200);
  }
  renderSide(); renderTimeline(); frame();
}

// =====================================================================
// Drawing a frame
// =====================================================================
function outSize() {
  const f = FORMATS[ST.P.format] || FORMATS['9:16'];
  if (ST.P.format === 'orig') {
    const vw = ST.media.videoWidth || 1280, vh = ST.media.videoHeight || 720;
    const k = Math.min(1, 1920 / Math.max(vw, vh)); return [Math.round(vw * k / 2) * 2, Math.round(vh * k / 2) * 2];
  }
  return [f[0], f[1]];
}
function sizeCanvas() {
  const [W, H] = outSize();
  const stage = $('#stStage').getBoundingClientRect();
  const k = Math.min((stage.width - 36) / W, (stage.height - 36) / H);
  const c = $('#stCanvas');
  c.style.width = Math.round(W * k) + 'px'; c.style.height = Math.round(H * k) + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const q = Math.min(1, (W * k * dpr) / W);
  c.width = Math.round(W * q); c.height = Math.round(H * q);
  ST.view = { W, H, q, k };
}
let blurC = null;
// The video, covering the frame, very soft and a little darker: behind a video shown whole.
function softBack(m, W, H) {
  const vw = m.videoWidth, vh = m.videoHeight;
  if (!blurC) blurC = { a: document.createElement('canvas'), b: document.createElement('canvas'), out: document.createElement('canvas') };
  // the frame's shape at 40 px across, the picture covering it
  const sw = W >= H ? 40 : Math.round(40 * W / H), sh = W >= H ? Math.round(40 * H / W) : 40;
  const A = blurC.a; A.width = sw; A.height = sh;
  const ga = A.getContext('2d'); ga.imageSmoothingEnabled = true; ga.imageSmoothingQuality = 'high';
  const cov = Math.max(sw / vw, sh / vh); ga.drawImage(m, (sw - vw * cov) / 2, (sh - vh * cov) / 2, vw * cov, vh * cov);
  // grown back in steps of two, to about a quarter of the frame
  let src = A, w = sw, h = sh; const tw = Math.max(sw, Math.round(W / 4)), th = Math.max(sh, Math.round(H / 4));
  let flip = false;
  while (w < tw) {
    const nw = Math.min(tw, w * 2), nh = Math.min(th, h * 2);
    const D = flip ? blurC.a : blurC.b; if (D === src) break;
    D.width = nw; D.height = nh; const gd = D.getContext('2d'); gd.imageSmoothingEnabled = true; gd.imageSmoothingQuality = 'high';
    gd.drawImage(src, 0, 0, w, h, 0, 0, nw, nh);
    src = D; w = nw; h = nh; flip = !flip;
  }
  const O = blurC.out; O.width = w; O.height = h;
  const go = O.getContext('2d'); go.imageSmoothingEnabled = true; go.imageSmoothingQuality = 'high';
  go.drawImage(src, 0, 0, w, h);
  go.fillStyle = 'rgba(0,0,0,0.28)'; go.fillRect(0, 0, w, h);
  return O;
}
// Draw the picture at time t into ctx sized W x H (any scale).
function drawFrame(g, W, H, t, forExport) {
  const P = ST.P, m = ST.media;
  g.save();
  g.fillStyle = P.bg || '#14171f'; g.fillRect(0, 0, W, H);
  const isVideo = ST.take.kind === 'video' && m.videoWidth;
  if (isVideo) {
    const vw = m.videoWidth, vh = m.videoHeight;
    const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
    if (P.fit === 'fit') {
      // a soft blurred copy fills the space around a fitted video
      // (a real blur, smooth at any size: the picture made very small, then grown back in gentle
      // steps, each step smoothing the last; one big step from a tiny picture showed squares)
      g.save(); g.drawImage(softBack(m, W, H), 0, 0, W, H); g.restore();
      const dw = vw * contain, dh = vh * contain;
      drawVideo(g, m, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const dw = vw * cover, dh = vh * cover;
      const x = (W - dw) * (P.pan ? P.pan.x : 0.5), y = (H - dh) * (P.pan ? P.pan.y : 0.5);
      drawVideo(g, m, x, y, dw, dh);
    }
  } else {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1b2a4a'); gr.addColorStop(1, '#3a2433');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = `600 ${Math.round(W * 0.045)}px ui-serif, Georgia, serif`; g.textAlign = 'center';
    g.fillText(ST.take.name || '', W / 2, H * 0.2);
  }
  for (const o of P.overlays) {
    if (o.kind === 'image') drawImage(g, W, H, o, t);
    else drawScore(g, W, H, o, t, forExport);
  }
  g.restore();
}
function drawVideo(g, m, x, y, w, h) {
  // the chosen look, worked out on the graphics chip for each frame
  let src = m;
  if (ST.P.look && !isNeutral(ST.P.look)) {
    const k = Math.min(1, 2048 / Math.max(w, h));
    const graded = grader.render(m, Math.min(m.videoWidth || w, w * k), Math.min(m.videoHeight || h, h * k), ST.P.look);
    if (graded) src = graded;
  }
  if (ST.take.mirror) { g.save(); g.translate(x + w, y); g.scale(-1, 1); g.drawImage(src, 0, 0, w, h); g.restore(); }
  else g.drawImage(src, x, y, w, h);
}
// a still of the current frame in a look, for the look buttons
function lookThumb(c, look) {
  const m = ST.media; if (!m || !m.videoWidth) return;
  const g = c.getContext('2d'); const vw = m.videoWidth, vh = m.videoHeight, s = Math.max(c.width / vw, c.height / vh);
  const graded = isNeutral(look) ? m : grader.render(m, vw * s, vh * s, look);
  g.drawImage(graded || m, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s);
}
function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
function barAt(o, t) {
  const T = o.times; const n = o.layout.bars.length;
  if (!T || t < T[0]) return { b: -1, f: 0 };
  for (let k = 0; k < n; k++) if (t < T[k + 1]) return { b: k, f: (t - T[k]) / Math.max(0.01, T[k + 1] - T[k]) };
  return { b: n, f: 0 };
}
// where the music is at time t, in the strip: note by note when the playing was followed
function posAt(o, t) {
  const L = o.layout, bars = L.bars, n = bars.length;
  const { b, f } = barAt(o, t);
  if (b < 0) return bars[0].x0;
  if (b >= n) return bars[n - 1].x1;
  const kn = o.knots && o.knots[b];
  let fx = f;
  if (kn && kn.length) {
    let pt = 0, px = 0;
    for (const [ft, x] of kn) { if (f < ft) { fx = px + ((f - pt) / Math.max(1e-3, ft - pt)) * (x - px); pt = -1; break; } pt = ft; px = x; }
    if (pt >= 0) fx = px + ((f - pt) / Math.max(1e-3, 1 - pt)) * (1 - px);
  }
  return bars[b].x0 + fx * (bars[b].x1 - bars[b].x0);
}
// the same, smoothed over a quarter of a second, for moving the page without jolts
function viewAt(o, t) { let s = 0; for (let k = -2; k <= 2; k++) s += posAt(o, t + k * 0.06); return s / 5; }
function drawScore(g, W, H, o, t) {
  const st = ST.strips.get(o.id); if (!st) return;
  const L = o.layout, bars = L.bars, n = bars.length;
  const { b, f } = barAt(o, t);
  const cb = clamp(b, 0, n - 1);
  // which part of the line is on show
  let vx0, vx1, cursor = null;
  const avg = L.width / n;
  if (o.mode === 'lines') {
    // one line of the page at a time; the next one fades in as you reach the end of a line
    const segs = L.segs;
    const segOf = (k) => bars[clamp(k, 0, n - 1)].seg;
    let si = segOf(cb);
    const lastOfSeg = (q) => { let k = n - 1; while (k > 0 && bars[k].seg !== q) k--; return k; };
    if (b >= 0 && b < n && b === lastOfSeg(si) && f > 0.72 && si < segs.length - 1) si++;
    const fullW = Math.max(...segs.map((q) => q.w));
    const view = (q) => [segs[q].sx, segs[q].sx + segs[q].w];
    // how far into the change from the previous line
    const firstBar = bars.findIndex((q) => q.seg === si);
    const lastPrev = firstBar > 0 ? firstBar - 1 : -1;
    let fade = 1;
    if (lastPrev >= 0 && o.times) {
      const tSwitch = o.times[lastPrev] + 0.72 * (o.times[lastPrev + 1] - o.times[lastPrev]);
      fade = clamp((t - tSwitch) / 0.28, 0, 1);
    }
    // (the paper stays; the old line's music goes, then the new one's comes: two lines faded over
    // each other at once showed a ghost of one in the other)
    if (fade < 1 && si > 0) {
      if (fade < 0.5) { const [p0, p1] = view(si - 1); paint(p0, p1, 1, null, fullW, 1 - fade * 2); }
      else { const [v0, v1] = view(si); paint(v0, v1, 1, null, fullW, fade * 2 - 1); }
      return;
    }
    const [v0, v1] = view(si);
    paint(v0, v1, 1, null, fullW);
    return;
  }
  if (o.mode === 'static') { vx0 = 0; vx1 = L.width; }
  else if (o.mode === 'bars') {
    const per = Math.max(1, o.perView | 0); const gidx = Math.floor(cb / per);
    vx0 = bars[gidx * per].x0; vx1 = bars[Math.min(n - 1, gidx * per + per - 1)].x1;
  } else {
    const per = Math.max(1, o.perView);
    const vw = Math.min(L.width, avg * per);
    const pos = posAt(o, t), smooth = viewAt(o, t);
    // the score slides under a still line, like a film; at the very start and end the music stays
    // put and the line moves instead, so there is never paper without music (or an empty band)
    if (o.band) vx0 = clamp(smooth - vw * 0.22, 0, Math.max(0, L.width - vw));
    else vx0 = clamp(smooth - vw * 0.32, 0, Math.max(0, L.width - vw));
    vx1 = vx0 + vw;
    if (b >= 0 && b < n) cursor = pos;
  }
  paint(vx0, vx1, 1, cursor, null);
  function paint(vx0, vx1, alpha, cursor, fullW, inkA = 1) {
  const vw = vx1 - vx0, vh = L.height;
  const band = !!o.band && o.mode === 'scroll';
  const boxW0 = band ? W : W * o.size, scale = boxW0 / (fullW || vw), boxW = vw * scale, boxH = vh * scale * (band ? o.size / 0.96 : 1);
  const pad = band ? Math.round(boxH * 0.06) : o.look === 'lines' ? 0 : Math.round(boxW * 0.025);
  const cx = band ? W / 2 : clamp(o.pos.x * W, boxW / 2 + pad, W - boxW / 2 - pad), cy = clamp(o.pos.y * H, boxH / 2 + pad, H - boxH / 2 - pad);
  const x = cx - boxW / 2, y = cy - boxH / 2;
  // only the part of the strip that exists (an endless line starts and ends in blank paper)
  const sx0 = Math.max(0, vx0), sx1 = Math.min(L.width, vx1);
  const blit = (img) => { if (sx1 > sx0 && inkA > 0.001) { const a0 = g.globalAlpha; g.globalAlpha = a0 * inkA; g.drawImage(img, sx0, 0, sx1 - sx0, vh, x + (sx0 - vx0) * scale, y, (sx1 - sx0) * scale, boxH); ; g.globalAlpha = a0; } };
  o._box = { x: x - pad, y: y - pad, w: boxW + pad * 2, h: boxH + pad * 2, W, H };
  g.save(); g.globalAlpha = (o.opacity ?? 1) * alpha;
  if (o.look !== 'lines') {
    g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = boxW * 0.03; g.shadowOffsetY = boxW * 0.006;
    g.fillStyle = o.look === 'warm' ? '#FBF6EA' : '#ffffff';
    const rad = band ? 0 : Math.round(boxW * 0.02);
    rr(g, x - (band ? 0 : pad), y - pad, boxW + (band ? 0 : pad * 2), boxH + pad * 2, rad); g.fill(); g.restore();
    g.save(); rr(g, x - (band ? 0 : pad), y - pad, boxW + (band ? 0 : pad * 2), boxH + pad * 2, rad); g.clip();
    if (o.highlight && b >= 0 && b < n && o.mode !== 'scroll' && bars[b].x0 >= vx0 - 1 && bars[b].x1 <= vx1 + 1) {
      g.fillStyle = 'rgba(255, 210, 90, 0.32)';
      const hx0 = x + (bars[b].x0 - vx0) * scale, hx1 = x + (bars[b].x1 - vx0) * scale;
      g.fillRect(hx0, y - pad, hx1 - hx0, boxH + pad * 2);
    }
    if (o.look === 'warm') g.globalCompositeOperation = 'multiply';
    blit(st.canvas);
    g.restore();
  } else {
    const ink = o.ink || '#ffffff';
    const mk = tintedMask(st, ink);
    // a soft shadow keeps white lines readable on bright video
    const shade = o.shade !== false;   // the soft shade behind the lines can be switched off
    g.save(); g.shadowColor = ink === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)'; g.shadowBlur = shade ? Math.max(2, boxW * 0.006) : 0;
    if (band && shade) {
      // a soft band behind the music, fading out above and below (no hard dark strip)
      g.save(); g.shadowBlur = 0;
      const col = ink === '#ffffff' ? '0,0,0' : '255,255,255', a = ink === '#ffffff' ? 0.32 : 0.34, f = boxH * 0.22;
      const gr = g.createLinearGradient(0, y - pad - f, 0, y + boxH + pad + f);
      const H2 = boxH + pad * 2 + f * 2, e = f / H2;
      gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(e, `rgba(${col},${a})`); gr.addColorStop(1 - e, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, y - pad - f, W, H2); g.restore();
    }
    blit(mk); g.restore();
    if (o.highlight && b >= 0 && b < n && o.mode !== 'scroll' && bars[b].x0 >= vx0 - 1 && bars[b].x1 <= vx1 + 1) {
      const hx0 = x + (bars[b].x0 - vx0) * scale, hx1 = x + (bars[b].x1 - vx0) * scale;
      g.fillStyle = ink === '#ffffff' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'; rr(g, hx0, y, hx1 - hx0, boxH, boxW * 0.01); g.fill();
    }
  }
  if (cursor !== null && o.highlight !== false) {
    const cxp = x + (cursor - vx0) * scale;
    g.fillStyle = o.look === 'lines' ? (o.ink === '#000000' ? 'rgba(216,52,58,0.9)' : 'rgba(255,90,95,0.95)') : 'rgba(216,52,58,0.85)';
    const lw = Math.max(2, boxW * 0.003);
    if (o.band) g.fillRect(cxp - lw / 2, y - boxH * 0.06, lw, boxH * 1.12); else g.fillRect(cxp - lw / 2, y + boxH * 0.12, lw, boxH * 0.76);
  }
  g.restore();
  }
}

function drawImage(g, W, H, o, t) {
  if (t < o.t0 || t > o.t1) return;
  const bmp = ST.images.get(o.id); if (!bmp) return;
  const w = W * o.size, h = (w * bmp.height) / bmp.width;
  const x = clamp(o.pos.x * W - w / 2, 0, W - w), y = clamp(o.pos.y * H - h / 2, 0, H - h);
  let a = o.opacity ?? 1;
  if (o.fade) a *= clamp(Math.min((t - o.t0) / 0.35, (o.t1 - t) / 0.35), 0, 1);
  g.save(); g.globalAlpha = a;
  if (o.round) { rr(g, x, y, w, h, w * 0.04); g.clip(); }
  g.drawImage(bmp, x, y, w, h);
  g.restore();
  o._box = { x, y, w, h, W, H };
}
function frame() {
  if (!ST.media || $('#studio').hidden) return;
  const c = $('#stCanvas'), g = c.getContext('2d');
  const { W, H, q } = ST.view;
  g.setTransform(q, 0, 0, q, 0, 0);
  drawFrame(g, W, H, ST.media.currentTime);
  // selection frame on the preview
  const o = selected();
  if (o && o._box && !ST.playing) { g.save(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.setLineDash([12, 8]); g.lineWidth = 3 / q; g.strokeRect(o._box.x, o._box.y, o._box.w, o._box.h); g.restore(); }
  updateHead();
}
function loop() { frame(); lsKeep(); if (ST.playing) ST.raf = requestAnimationFrame(loop); }
function play() {
  if (ST.media.currentTime >= ST.P.trim.b - 0.05 || ST.media.currentTime < ST.P.trim.a) ST.media.currentTime = ST.P.trim.a;
  ST.media.play().catch(() => {}); ST.playing = true; syncPlay(); loop();
  ST.stopAt = setInterval(() => { if (ST.media.currentTime >= ST.P.trim.b) { pause(); if (ST.tapping) finishTap(); } }, 50);
}
function pause() { if (!ST.media) return; ST.media.pause(); ST.playing = false; clearInterval(ST.stopAt); cancelAnimationFrame(ST.raf); syncPlay(); frame(); }
function syncPlay() { const b = $('#stPlay'); b.innerHTML = ST.playing ? '<svg><use href="#i-pause"/></svg><span>Pause</span>' : '<svg><use href="#i-play"/></svg><span>Play</span>'; if (!ST.playing) ST.playing = false; }
const selected = () => (ST.sel ? ST.P.overlays.find((o) => o.id === ST.sel.id) : null);

// =====================================================================
// Timeline
// =====================================================================
function tx(t) { const lane = $('#stScoreLane').getBoundingClientRect(); return ((t - 0) / ST.dur) * lane.width; }
function tAt(clientX) { const lane = $('#stScoreLane').getBoundingClientRect(); return clamp(((clientX - lane.left) / lane.width) * ST.dur, 0, ST.dur); }
function renderTimeline() {
  const ruler = $('#stRuler'); ruler.textContent = '';
  const step = ST.dur > 240 ? 30 : ST.dur > 90 ? 10 : ST.dur > 30 ? 5 : 2;
  const lane = $('#stScoreLane').getBoundingClientRect();
  for (let s = 0; s <= ST.dur; s += step) { const sp = el('span', '', fmt(s).replace(/\.\d$/, '')); sp.style.left = (s / ST.dur) * lane.width + 'px'; ruler.append(sp); }
  const sl = $('#stScoreLane'); sl.textContent = '';
  const o = ST.P.overlays.find((x) => x.kind === 'score');
  if (o && o.times) {
    const { b } = barAt(o, ST.media ? ST.media.currentTime : 0);
    o.layout.bars.forEach((bar, k) => {
      const d = el('div', 'st-bar' + (k === b ? ' cur' : ''), String(k + 1));
      d.style.left = tx(o.times[k]) + 'px'; d.style.width = Math.max(2, tx(o.times[k + 1]) - tx(o.times[k]) - 1) + 'px';
      const edge = el('span', 'edge'); edge.dataset.k = k; d.append(edge);
      d.addEventListener('pointerdown', (e) => { if (e.target === edge) return; ST.sel = { id: o.id }; renderSide(); seek(o.times[k] + 0.01); });
      sl.append(d);
    });
    // the end of the last bar
    const end = el('div', 'st-bar'); end.style.left = tx(o.times[o.times.length - 1]) + 'px'; end.style.width = '0'; end.style.border = '0'; const e2 = el('span', 'edge'); e2.dataset.k = o.times.length - 1; end.append(e2); sl.append(end);
  } else {
    const hint = el('div', 'st-bar', 'Add the score to see its bars here'); hint.style.left = '6px'; hint.style.right = '6px'; hint.style.background = 'transparent'; hint.style.border = '1px dashed var(--line)'; hint.style.color = 'var(--muted)'; sl.append(hint);
  }
  const il = $('#stImgLane'); il.textContent = '';
  for (const im of ST.P.overlays.filter((x) => x.kind === 'image')) {
    const d = el('div', 'st-img' + (ST.sel && ST.sel.id === im.id ? ' sel' : ''));
    d.style.left = tx(im.t0) + 'px'; d.style.width = Math.max(14, tx(im.t1) - tx(im.t0)) + 'px';
    const bmp = ST.images.get(im.id);
    d.append(el('span', '', 'Image'));
    const l = el('span', 'edge l'), r = el('span', 'edge r'); l.dataset.img = im.id; l.dataset.side = 'a'; r.dataset.img = im.id; r.dataset.side = 'b';
    d.append(l, r); d.dataset.img = im.id; d.dataset.side = 'move';
    d.addEventListener('pointerdown', () => { ST.sel = { id: im.id }; renderSide(); renderTimeline(); frame(); });
    il.append(d);
    void bmp;
  }
  // trim handles
  $('#stTrimL').style.left = (40 + tx(ST.P.trim.a) - 7) + 'px';
  $('#stTrimR').style.left = (40 + tx(ST.P.trim.b) - 7) + 'px';
  updateHead();
}
function updateHead() {
  if (!ST.media) return;
  const t = ST.media.currentTime;
  $('#stHead').style.left = (40 + tx(t)) + 'px';
  $('#stTime').textContent = fmt(t) + ' / ' + fmt(ST.dur);
  const o = ST.P.overlays.find((x) => x.kind === 'score');
  if (o && o.times) {
    const { b } = barAt(o, t);
    const bars = $('#stScoreLane').querySelectorAll('.st-bar');
    bars.forEach((d, k) => d.classList.toggle('cur', k === b));
  }
}
function drawWave() {
  const c = $('#stWave'); const r = c.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr);
  const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
  const peaks = ST.take.peaks;
  // dim what is trimmed away
  const ax = (ST.P.trim.a / ST.dur) * c.width, bx = (ST.P.trim.b / ST.dur) * c.width;
  if (peaks && peaks.length) {
    let max = 0.0001; for (const p of peaks) max = Math.max(max, p);
    const n = Math.floor(c.width / (3 * dpr));
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * peaks.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
      let m = 0; for (let j = a; j < b; j++) m = Math.max(m, peaks[j]);
      const h = Math.max(1.5 * dpr, Math.pow(m / max, 0.8) * (c.height - 10 * dpr));
      const x = i * 3 * dpr;
      g.fillStyle = css('--accent-text'); g.globalAlpha = x >= ax && x <= bx ? 0.75 : 0.22;
      g.fillRect(x, (c.height - h) / 2, 2 * dpr, h);
    }
  }
  g.globalAlpha = 1;
}
function seek(t) { ST.media.currentTime = clamp(t, 0, ST.dur); frame(); }
function wireTimeline() {
  const tracks = $('#stTracks');
  let drag = null;
  tracks.addEventListener('pointerdown', (e) => {
    const t = tAt(e.clientX);
    const edge = e.target.closest('.edge');
    const trim = e.target.closest('.st-trim');
    const img = e.target.closest('[data-img]');
    try { tracks.setPointerCapture(e.pointerId); } catch {}
    if (trim) { drag = { kind: 'trim', side: trim.id === 'stTrimL' ? 'a' : 'b' }; pause(); return; }
    if (edge && edge.dataset.k !== undefined) { drag = { kind: 'bar', k: +edge.dataset.k }; pause(); return; }
    if (img) { const o = ST.P.overlays.find((x) => x.id === img.dataset.img); drag = { kind: 'img', o, side: img.dataset.side, t0: t, a: o.t0, b: o.t1 }; return; }
    drag = { kind: 'seek' }; seek(t);
  });
  tracks.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = tAt(e.clientX);
    if (drag.kind === 'seek') seek(t);
    else if (drag.kind === 'trim') { if (drag.side === 'a') ST.P.trim.a = clamp(t, 0, ST.P.trim.b - 0.5); else ST.P.trim.b = clamp(t, ST.P.trim.a + 0.5, ST.dur); seek(drag.side === 'a' ? ST.P.trim.a : ST.P.trim.b); renderTimeline(); drawWave(); }
    else if (drag.kind === 'bar') {
      const o = ST.P.overlays.find((x) => x.kind === 'score'); const T = o.times, k = drag.k;
      T[k] = clamp(t, k > 0 ? T[k - 1] + 0.08 : 0, k < T.length - 1 ? T[k + 1] - 0.08 : ST.dur);
      o.synced = 'hand'; seek(T[k] + 0.01); renderTimeline();
    } else if (drag.kind === 'img') {
      const o = drag.o, d = t - drag.t0;
      if (drag.side === 'a') o.t0 = clamp(drag.a + d, 0, o.t1 - 0.3);
      else if (drag.side === 'b') o.t1 = clamp(drag.b + d, o.t0 + 0.3, ST.dur);
      else { const len = drag.b - drag.a; o.t0 = clamp(drag.a + d, 0, ST.dur - len); o.t1 = o.t0 + len; }
      renderTimeline(); seek(o.t0 + 0.05);
    }
  });
  const end = () => { if (drag && drag.kind !== 'seek') saveSoon(); drag = null; };
  tracks.addEventListener('pointerup', end); tracks.addEventListener('pointercancel', end);
}
// Drag the score or an image on the picture to place it; pinch or the slider to size it.
function wireStage() {
  const c = $('#stCanvas');
  let d = null;
  c.addEventListener('pointerdown', (e) => {
    const r = c.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * ST.view.W, py = ((e.clientY - r.top) / r.height) * ST.view.H;
    const hit = [...ST.P.overlays].reverse().find((o) => o._box && px >= o._box.x && px <= o._box.x + o._box.w && py >= o._box.y && py <= o._box.y + o._box.h && (o.kind !== 'image' || (ST.media.currentTime >= o.t0 && ST.media.currentTime <= o.t1)));
    try { c.setPointerCapture(e.pointerId); } catch {}
    if (hit) { ST.sel = { id: hit.id }; d = { o: hit, x: e.clientX, y: e.clientY, pos: { ...hit.pos } }; renderSide(); frame(); return; }
    // drag the video itself to choose the part on show (filled formats)
    d = { video: true, x: e.clientX, y: e.clientY, pan: { ...(ST.P.pan || { x: 0.5, y: 0.5 }) } };
  });
  c.addEventListener('pointermove', (e) => {
    if (!d) return;
    const r = c.getBoundingClientRect();
    if (d.o) { d.o.pos = { x: clamp(d.pos.x + (e.clientX - d.x) / r.width, 0, 1), y: clamp(d.pos.y + (e.clientY - d.y) / r.height, 0, 1) }; frame(); }
    else if (d.video && ST.P.fit !== 'fit') { ST.P.pan = { x: clamp(d.pan.x - (e.clientX - d.x) / r.width, 0, 1), y: clamp(d.pan.y - (e.clientY - d.y) / r.height, 0, 1) }; frame(); }
  });
  const end = () => { if (d) saveSoon(); d = null; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}

// =====================================================================
// Side panel: what is selected
// =====================================================================
function seg(items, value, on) {
  const s = el('div', 'seg full');
  for (const [v, label] of items) { const b = el('button', v === value ? 'on' : '', label); b.addEventListener('click', () => on(v)); s.append(b); }
  return s;
}
function slider(label, value, min, max, step, fmtv, on) {
  const row = el('label', 'st-row'); row.append(el('span', '', label));
  const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = value;
  const v = el('span', 'num', fmtv(value));
  i.addEventListener('input', () => { v.textContent = fmtv(+i.value); on(+i.value); });
  row.append(i, v); return row;
}
function renderSide() {
  // on a phone a swipe up or down scrolls the Studio, except over something chosen to move
  try { $('#stCanvas').style.touchAction = matchMedia('(max-width: 600px), (max-height: 500px)').matches && !ST.sel ? 'pan-y' : 'none'; } catch {}
  const side = $('#stSide'); side.textContent = '';
  const o = selected();
  $('#stEmpty').hidden = !!ST.P.overlays.find((x) => x.kind === 'score');
  const change = (fn, re = false) => { fn(); saveSoon(); frame(); if (re) renderSide(); };
  if (o && o.kind === 'score') {
    side.append(el('h3', '', 'Score'));
    side.append(el('p', 'hint', `${o.title} · ${o.layout.bars.length} bars`));
    const looks = el('div', 'st-looks');
    for (const [k, label] of [['paper', 'Paper'], ['warm', 'Warm'], ['lines', 'Just the lines']]) {
      const b = el('button', o.look === k ? 'on' : ''); const sw = el('i', k); b.append(sw, document.createTextNode(label));
      b.addEventListener('click', () => change(() => { o.look = k; }, true)); looks.append(b);
    }
    side.append(looks);
    if (o.look === 'lines') side.append(seg([['#ffffff', 'White ink'], ['#000000', 'Black ink']], o.ink, (v) => change(() => { o.ink = v; }, true)));
    if (o.look === 'lines') side.append(seg([['on', 'Soft shade behind'], ['off', 'No shade']], o.shade === false ? 'off' : 'on', (v) => change(() => { o.shade = v === 'on'; }, true)));
    side.append(el('div', 'ctl-head', 'On screen'));
    side.append(seg([['scroll', 'Endless line'], ['lines', 'Line by line'], ['bars', 'Bars'], ['static', 'All']], o.mode, (v) => change(() => { o.mode = v; }, true)));
    if (o.mode === 'scroll') { const bl = el('label', 'check'); const bc = el('input'); bc.type = 'checkbox'; bc.checked = !!o.band; bl.append(bc, document.createTextNode(' Full width, sliding under a still line')); bc.addEventListener('change', () => change(() => { o.band = bc.checked; }, true)); side.append(bl); }
    if (o.mode !== 'static' && o.mode !== 'lines') side.append(slider('Bars', o.perView, 1, Math.min(8, o.layout.bars.length), 1, (x) => String(x), (v) => change(() => { o.perView = v; })));
    side.append(slider('Size', Math.round(o.size * 100), 30, 100, 1, (x) => x + '%', (v) => change(() => { o.size = v / 100; })));
    side.append(seg([['0.16', 'Top'], ['0.5', 'Middle'], ['0.82', 'Bottom']], String(o.pos.y), (v) => change(() => { o.pos = { x: 0.5, y: +v }; }, true)));
    side.append(slider('Opacity', Math.round((o.opacity ?? 1) * 100), 30, 100, 1, (x) => x + '%', (v) => change(() => { o.opacity = v / 100; })));
    const hl = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = o.highlight !== false; hl.append(cb, document.createTextNode(o.mode === 'scroll' ? ' Show where you are (a red line)' : ' Light up the bar being played'));
    cb.addEventListener('change', () => change(() => { o.highlight = cb.checked; })); side.append(hl);
    side.append(el('p', 'hint', 'Drag the score on the picture to move it.'));
    const sync = el('section', 'sub-card');
    const sh = el('div', 'sub-head'); sh.append(el('h3', '', 'Timing'));
    sync.append(sh);
    const state = el('p', 'st-sync-state ' + (o.synced === 'auto' && o.syncInfo && o.syncInfo.good > 0.55 ? 'good' : o.synced === 'even' ? 'warn' : ''),
      o.synced === 'auto' ? `Follows your playing${o.syncInfo ? ` (${Math.round(o.syncInfo.good * 100)}% of notes matched)` : ''}.` : o.synced === 'tap' ? 'Set by your taps.' : o.synced === 'hand' ? 'Adjusted by hand on the timeline.' : 'Spread evenly. Line it up with your playing:');
    sync.append(state);
    const row = el('div', 'row-even');
    const auto = el('button', 'btn small primary'); auto.append(el('span', '', 'Follow my playing')); auto.disabled = !ST.pcm;
    auto.addEventListener('click', () => autoSync(o));
    const tapB = el('button', 'btn small', 'Tap along'); tapB.addEventListener('click', () => startTap(o));
    row.append(auto, tapB); sync.append(row);
    sync.append(el('p', 'hint', 'Drag the start of a bar on the timeline to move it.'));
    side.append(sync);
    const del = el('button', 'btn danger-text', 'Remove the score'); del.addEventListener('click', () => { ST.P.overlays = ST.P.overlays.filter((x) => x !== o); ST.sel = null; saveSoon(); renderSide(); renderTimeline(); frame(); });
    side.append(del);
    return;
  }
  if (o && o.kind === 'image') {
    side.append(el('h3', '', 'Image'));
    side.append(slider('Size', Math.round(o.size * 100), 10, 100, 1, (x) => x + '%', (v) => change(() => { o.size = v / 100; })));
    side.append(slider('Opacity', Math.round((o.opacity ?? 1) * 100), 10, 100, 1, (x) => x + '%', (v) => change(() => { o.opacity = v / 100; })));
    side.append(seg([['0.16', 'Top'], ['0.5', 'Middle'], ['0.82', 'Bottom']], String(o.pos.y), (v) => change(() => { o.pos = { x: 0.5, y: +v }; }, true)));
    for (const [k, label] of [['round', 'Rounded corners'], ['fade', 'Fade in and out']]) {
      const l = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!o[k]; l.append(cb, document.createTextNode(' ' + label));
      cb.addEventListener('change', () => change(() => { o[k] = cb.checked; })); side.append(l);
    }
    side.append(el('p', 'hint', 'On the timeline, drag the image to move it in time, or its ends to make it shorter or longer. Drag it on the picture to place it.'));
    const del = el('button', 'btn danger-text', 'Remove the image'); del.addEventListener('click', () => { ST.P.overlays = ST.P.overlays.filter((x) => x !== o); ST.sel = null; saveSoon(); renderSide(); renderTimeline(); frame(); });
    side.append(del);
    return;
  }
  renderFormat(side);
}
// The look of the video: a few ready-made looks, and four simple controls on top
function renderLook(side) {
  const card = el('section', 'sub-card st-look');
  const head = el('div', 'sub-head'); head.append(el('h3', '', 'Look'));
  const reset = el('button', 'btn small ghost', 'Reset'); reset.hidden = !ST.P.look || isNeutral(ST.P.look);
  reset.addEventListener('click', () => { ST.P.look = null; saveSoon(); frame(); renderSide(); });
  head.append(reset); card.append(head);
  // Auto: the video looked at, and set for its light, colour, noise and detail
  const autoRow = el('div', 'st-auto');
  const autoB = el('button', 'btn small ' + (ST.P.look && ST.P.look.auto && ST.P.look.autoOn !== false ? 'on-auto' : 'primary'));
  autoB.append(el('span', '', ST.P.look && ST.P.look.auto && ST.P.look.autoOn !== false ? 'Auto is on' : 'Auto: make it look its best'));
  autoB.addEventListener('click', async () => {
    const lk = ST.P.look || (ST.P.look = { preset: 'natural', adj: {} });
    if (lk.auto && lk.autoOn !== false) { lk.autoOn = false; saveSoon(); frame(); renderSide(); return; }
    autoB.disabled = true; autoB.querySelector('span').textContent = 'Looking at the video…';
    try { const fr = await grabFrames(8); if (!fr.length) throw new Error('no frames'); lk.auto = autoLook(fr); lk.autoOn = true; if (lk.autoAmt === undefined) lk.autoAmt = 1; } catch (e) { console.warn(e); D.toast('The video could not be looked at just now. Play it for a moment, then try again.', 4000); }
    saveSoon(); frame(); renderSide();
  });
  autoRow.append(autoB);
  card.append(autoRow);
  if (ST.P.look && ST.P.look.auto && ST.P.look.autoOn !== false) {
    card.append(slider('Auto amount', Math.round((ST.P.look.autoAmt ?? 1) * 100), 0, 150, 1, (x) => x + '%', (v) => { ST.P.look.autoAmt = v / 100; saveSoon(); frame(); }));
    card.append(el('p', 'hint', 'Light, white balance, contrast, noise and sharpness set for this video. A look and the sliders go on top.'));
  }
  const cur = (ST.P.look && ST.P.look.preset) || 'natural';
  const strip = el('div', 'st-look-strip');
  for (const [k, v] of Object.entries(LOOKS)) {
    const b = el('button', k === cur ? 'on' : ''); const c = el('canvas'); c.width = 96; c.height = 120;
    b.append(c, el('span', '', v.label));
    lookThumb(c, { preset: k });
    b.addEventListener('click', () => { const keep = ST.P.look || {}; ST.P.look = { preset: k, adj: {}, ...(keep.auto ? { auto: keep.auto, autoOn: keep.autoOn, autoAmt: keep.autoAmt } : {}) }; saveSoon(); frame(); renderSide(); });
    strip.append(b);
  }
  card.append(strip);
  const adj = () => { if (!ST.P.look) ST.P.look = { preset: 'natural', adj: {} }; if (!ST.P.look.adj) ST.P.look.adj = {}; return ST.P.look.adj; };
  const ctl = (key, label, lo = -100, hi = 100) => slider(label, Math.round(((ST.P.look && ST.P.look.adj && ST.P.look.adj[key]) || 0) * 100), lo, hi, 1, (x) => (x > 0 ? '+' : '') + x, (v) => { adj()[key] = v / 100; reset.hidden = isNeutral(ST.P.look); saveSoon(); frame(); });
  card.append(ctl('light', 'Light'), ctl('contrast', 'Contrast'), ctl('warmth', 'Warmth'), ctl('colour', 'Colour'));
  const more = el('details', 'st-look-more'); more.append(el('summary', '', 'More'));
  more.append(ctl('clarity', 'Clarity'), ctl('sharp', 'Sharpness'), ctl('denoise', 'Less noise', 0, 100), ctl('shadows', 'Shadows'), ctl('highlights', 'Highlights'), ctl('tint', 'Tint'), ctl('vignette', 'Vignette', 0, 100));
  card.append(more);
  side.append(card);
}
// a few frames from across the video (for Auto), the playing place put back after
async function grabFrames(n) {
  const m = ST.media, back = m.currentTime, out = [];
  if (!m.videoWidth) return out;
  const a = ST.P.trim ? ST.P.trim.a : 0, b = ST.P.trim ? ST.P.trim.b : ST.dur;
  for (let i = 0; i < n; i++) {
    const t = a + ((b - a) * (i + 0.5)) / n;
    await new Promise((res) => { const done = () => { m.removeEventListener('seeked', done); res(); }; m.addEventListener('seeked', done); m.currentTime = t; setTimeout(done, 1500); });
    // (the new frame must be there before it is copied: on an iPad it comes a moment after the jump)
    await new Promise((res) => { let ok = false; const go = () => { if (!ok) { ok = true; res(); } }; if (m.requestVideoFrameCallback) m.requestVideoFrameCallback(go); setTimeout(go, 160); });
    const c = document.createElement('canvas'); const k = 192 / Math.max(m.videoWidth, m.videoHeight); c.width = Math.round(m.videoWidth * k); c.height = Math.round(m.videoHeight * k);
    const g2 = c.getContext('2d', { willReadFrequently: true }); g2.drawImage(m, 0, 0, c.width, c.height);
    // (an empty frame, not yet drawn, is not looked at)
    const d = g2.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let j = 0; j < d.length; j += 16) sum += d[j] + d[j + 1] + d[j + 2];
    if (sum / (d.length / 16) > 4) out.push(c);
  }
  m.currentTime = back;
  return out;
}
function renderFormat(side) {
  side.append(el('h3', '', 'Picture'));
  const f = el('div', 'st-formats');
  for (const [k, [w, h, label]] of Object.entries(FORMATS)) {
    const b = el('button', ST.P.format === k ? 'on' : ''); const i = el('i');
    const vw = k === 'orig' ? (ST.media.videoWidth || 16) : w, vh = k === 'orig' ? (ST.media.videoHeight || 9) : h;
    const s = 26 / Math.max(vw, vh); i.style.width = Math.round(vw * s) + 'px'; i.style.height = Math.round(vh * s) + 'px';
    b.append(i, el('span', '', k === 'orig' ? 'Original' : `${k} ${label}`.replace(' Reels', '').replace(' Post', '').replace(' Square', '').replace(' Wide', '')));
    b.title = label;
    b.addEventListener('click', () => { ST.P.format = k; saveSoon(); sizeCanvas(); renderSide(); frame(); });
    f.append(b);
  }
  side.append(f);
  side.append(el('p', 'hint', ST.P.format === '9:16' ? 'Vertical, for Reels and Stories.' : ST.P.format === '4:5' ? 'For Instagram posts.' : ST.P.format === '1:1' ? 'Square.' : ST.P.format === '16:9' ? 'Wide, for YouTube.' : 'As it was filmed.'));
  if (ST.take.kind === 'video') {
    side.append(seg([['fill', 'Fill the frame'], ['fit', 'Show it all']], ST.P.fit || 'fill', (v) => { ST.P.fit = v; saveSoon(); frame(); renderSide(); }));
    if (ST.P.fit !== 'fit') side.append(el('p', 'hint', 'Drag the video to choose the part on show.'));
  }
  if (ST.take.kind === 'video') renderLook(side);
  side.append(el('div', 'ctl-head', 'Trim'));
  side.append(el('p', 'hint', `From ${fmt(ST.P.trim.a)} to ${fmt(ST.P.trim.b)}. Drag the dark handles on the timeline.`));
  const sd = el('section', 'sub-card'); sd.append(el('h3', '', 'Sound'));
  sd.append(seg([['dry', 'Dry'], ['studio', 'Studio'], ['hall', 'Hall'], ['church', 'Church']], ST.P.sound.room, (v) => { ST.P.sound.room = v; saveSoon(); lsApply(); renderSide(); }));
  sd.append(slider('Room', Math.round((ST.P.sound.wet ?? 0.18) * 100), 0, 100, 1, (x) => x + '%', (v) => { ST.P.sound.wet = v / 100; saveSoon(); lsApply(); }));
  const l = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = ST.P.sound.level !== false; l.append(cb, document.createTextNode(' Bring the sound to a good level'));
  cb.addEventListener('change', () => { ST.P.sound.level = cb.checked; saveSoon(); lsApply(); }); sd.append(l);
  sd.append(el('p', 'hint', 'Room and level are added in the exported video.'));
  side.append(sd);
}

// =====================================================================
// Images
// =====================================================================
async function addImage(file) {
  const o = { id: uid(), kind: 'image', img: file, size: 0.4, pos: { x: 0.5, y: 0.2 }, opacity: 1, round: true, fade: true, t0: ST.media.currentTime, t1: Math.min(ST.P.trim.b, ST.media.currentTime + 4) };
  ST.P.overlays.push(o); await prepareOverlay(o); ST.sel = { id: o.id };
  saveSoon(); renderSide(); renderTimeline(); frame();
}

// =====================================================================
// Export: plays the edit once and records it (real time)
// =====================================================================
async function exportVideo() {
  pause();
  const [W, H] = outSize();
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const ctx = getCtx();
  const a = ST.P.trim.a, b = ST.P.trim.b, total = b - a;
  // the sound: the recording with the room and level chosen
  const dest = ctx.createMediaStreamDestination();
  let src = null, mediaSrc = null;
  if (ST.pcm) {
    const i0 = Math.floor(a * ST.sr), i1 = Math.min(ST.pcm.length, Math.ceil(b * ST.sr));
    const part = ST.pcm.subarray(i0, i1);
    const buf = ctx.createBuffer(1, Math.max(1, part.length), ST.sr); buf.copyToChannel(part, 0);
    src = ctx.createBufferSource(); src.buffer = buf;
    const level = ctx.createGain(); const pk = peakOf(part); level.gain.value = ST.P.sound.level !== false && pk > 0.001 ? Math.min(8, 0.89 / pk) : 1;
    src.connect(level);
    level.connect(dest);
    const room = ROOMS[ST.P.sound.room];
    if (room) { const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, room); const wet = ctx.createGain(); wet.gain.value = (ST.P.sound.wet ?? 0.18) * 0.9; level.connect(conv).connect(wet).connect(dest); }
  } else if (ST.take.kind === 'video') {
    try { mediaSrc = ctx.createMediaElementSource(ST.media); mediaSrc.connect(dest); mediaSrc.connect(ctx.destination); } catch { /* no sound */ }
  }
  const stream = canvas.captureStream(30);
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  let rec;
  try { rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: W * H > 1.5e6 ? 10_000_000 : 6_000_000, audioBitsPerSecond: 192_000 }); }
  catch (err) { D.toast('Video export needs iPadOS 15 or newer.'); return; }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let cancelled = false;
  ST.busyCancel = () => { cancelled = true; try { rec.stop(); } catch {} ST.media.pause(); };
  ST.exporting = true; lsStop();
  busy('Making the video…', 'It plays once while it is recorded.', 0);
  const done = new Promise((res) => { rec.onstop = res; });
  ST.media.muted = !!src;
  ST.media.currentTime = a;
  await new Promise((r) => { ST.media.onseeked = () => { ST.media.onseeked = null; r(); }; setTimeout(r, 1500); });
  rec.start(500);
  const t0 = ctx.currentTime + 0.15;
  if (src) src.start(t0);
  await new Promise((r) => setTimeout(r, 150));
  if (ST.take.kind === 'video') ST.media.play().catch(() => {});
  const audioOnly = ST.take.kind !== 'video';
  await new Promise((resolve) => {
    const tick = () => {
      if (cancelled) { resolve(); return; }
      const t = audioOnly ? a + (ctx.currentTime - t0) : ST.media.currentTime;
      // keep the video in step with the sound
      if (!audioOnly && src && Math.abs(ST.media.currentTime - (a + ctx.currentTime - t0)) > 0.12) ST.media.currentTime = a + ctx.currentTime - t0;
      if (audioOnly) try { ST.media.currentTime = t; } catch {}
      drawFrame(g, W, H, t, true);
      busy('Making the video…', `${fmt(t - a)} of ${fmt(total)}`, clamp((t - a) / total, 0, 1));
      if (t >= b - 0.02) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
  try { rec.stop(); } catch {}
  await done;
  ST.media.pause(); ST.media.muted = false; ST.exporting = false;
  if (src) try { src.stop(); } catch {}
  if (mediaSrc) try { mediaSrc.disconnect(); } catch {}
  busy(null);
  if (cancelled) { D.toast('Export cancelled.'); return; }
  const blob = new Blob(chunks, { type: (type || 'video/mp4').split(';')[0] });
  if (blob.size < 5000) { D.toast('The video could not be made.'); return; }
  // keep it in Recordings, then share
  const id = uid();
  const take = { id, kind: 'video', mime: blob.type, scoreId: ST.take.scoreId, page: ST.take.page, name: (ST.take.name || 'Video') + ' · Studio', created: Date.now(), mirror: false, fav: false, thumb: await videoThumb(blob) };
  await db.put('files', { id: 'video:' + id, data: blob });
  if (ST.pcm) {
    const part = ST.pcm.slice(Math.floor(a * ST.sr), Math.min(ST.pcm.length, Math.ceil(b * ST.sr)));
    take.sr = ST.sr; take.dur = part.length / ST.sr; take.peaks = computePeaks(part); take.peak = peakOf(part); take.pcm = true;
    await db.put('files', { id: 'audio:' + id, data: part });
  } else { take.pcm = false; take.dur = total; }
  await db.put('takes', take);
  D.onSaved && D.onSaved(take);
  D.toast('Saved in Recordings.', 2500);
  const ext = blob.type.includes('webm') ? '.webm' : '.mp4';
  shareChooser(blob, (take.name || 'Studio').replace(/[\\/:*?"<>|]+/g, '') + ext);
}
// Where the finished video goes: straight to one of the apps people post in (the video is put in
// Photos and that app opens), or anywhere else with the usual share sheet.
// (plain symbols in the app's own style, not the apps' logos)
const SOCIAL = [
  ['instagram', 'Instagram', 'Reels and posts · 9:16 or 4:5', '<path d="M12 19s-6.5-4-6.5-8.6A3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 6.5 2c0 4.6-6.5 8.6-6.5 8.6z"/>'],
  ['tiktok', 'TikTok', 'Upright · 9:16', '<circle cx="8.5" cy="17" r="2.5"/><path d="M11 17V5l7 2v3"/>'],
  ['youtube', 'YouTube', 'Shorts 9:16 · videos 16:9', '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4"/>'],
  ['facebook', 'Facebook', 'Any shape', '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="10" r="2.4"/><path d="M15 14.2a4.5 4.5 0 0 1 5.5 4.8"/>'],
  ['whatsapp', 'WhatsApp', 'To a person or a group', '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h0.5A2.5 2.5 0 0 1 5 13.5z"/>'],
];
export function shareChooser(blob, name) {
  const native = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.standShare);
  const wrap = el('div', 'st-busy st-share'); const card = el('div', 'st-busy-card');
  card.append(el('b', '', 'Share your video'), el('span', 'hint', 'It is saved in Recordings. Send it to:'));
  const grid = el('div', 'st-share-grid');
  const go = (to) => { wrap.remove(); D.shareBlob(blob, name, to); };
  if (native) for (const [k, label, tip, svg] of SOCIAL) {
    const b = el('button', 'st-share-btn');
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
    b.append(el('span', 'st-share-name', label), el('span', 'st-share-tip', tip));
    b.addEventListener('click', () => go(k)); grid.append(b);
  }
  const more = el('button', 'st-share-btn');
  more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 11v8h12v-8"/></svg>';
  more.append(el('span', 'st-share-name', 'Other apps'), el('span', 'st-share-tip', 'Messages, Mail, Files, AirDrop…'));
  more.addEventListener('click', () => go('')); grid.append(more);
  const close = el('button', 'btn small', 'Not now'); close.addEventListener('click', () => wrap.remove());
  card.append(grid, close); wrap.append(card);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  $('#studio').append(wrap);
}

// =====================================================================
// Busy card
// =====================================================================
function busy(title, text, f) {
  const b = $('#stBusy');
  if (title === null) { b.hidden = true; ST.busyCancel = null; return; }
  b.hidden = false; $('#stBusyTitle').textContent = title; $('#stBusyText').textContent = text || '';
  $('#stBusyBar').style.width = Math.round((f || 0) * 100) + '%';
}

function wire() {
  if (!$('#studio')) return;
  $('#stBack').addEventListener('click', close);
  $('#stPlay').addEventListener('click', () => (ST.playing ? pause() : play()));
  $('#stAddScore').addEventListener('click', addScore);
  $('#stEmptyAdd').addEventListener('click', addScore);
  $('#stAddImage').addEventListener('click', () => $('#stImageInput').click());
  $('#stImageInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) addImage(f); });
  $('#stSyncBtn').addEventListener('click', () => { const o = ST.P.overlays.find((x) => x.kind === 'score'); if (!o) { addScore(); return; } ST.sel = { id: o.id }; renderSide(); autoSync(o); });
  $('#stFormatBtn').addEventListener('click', () => { ST.sel = null; renderSide(); frame(); });
  $('#stExport').addEventListener('click', exportVideo);
  $('#stTap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
  $('#stBusyCancel').addEventListener('click', () => { if (ST.busyCancel) ST.busyCancel(); busy(null); });
  wireTimeline(); wireStage();
  window.addEventListener('resize', () => { if (!$('#studio').hidden) { sizeCanvas(); renderTimeline(); drawWave(); frame(); } });
  document.addEventListener('keydown', (e) => {
    if ($('#studio').hidden || e.target.matches('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); if (ST.tapping) tap(); else ST.playing ? pause() : play(); }
    if (e.key === 'Escape' && ST.tapping) finishTap();
  });
}
export const _studio = ST;
export const _posAt = (o, t) => posAt(o, t);
export const _alignChords = (e, o) => alignChords(e, o);
// (for the tests: a score put on the video without the picker)
export async function _addScoreFrom(canvas) {
  const A = await analyse(canvas);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const o = { id: uid(), kind: 'score', title: 'Score', src: {}, img: blob, look: 'paper', ink: '#ffffff', mode: 'scroll', band: true, perView: 2, size: 0.96, pos: { x: 0.5, y: 0.78 }, opacity: 1, highlight: true, layout: stripLayout(A, canvas.width, canvas.height), times: null, synced: 'even' };
  o.times = evenTimes(o.layout.bars.length);
  ST.P.overlays = ST.P.overlays.filter((x) => x.kind !== 'score'); ST.P.overlays.unshift(o);
  await prepareOverlay(o); ST.sel = { id: o.id }; renderSide(); renderTimeline(); frame();
  return o;
}
export const _frame = () => frame();
