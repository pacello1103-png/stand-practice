// Where the eyes look on the screen, from the front camera, on this device (nothing is saved or
// sent). A face model (MediaPipe Face Landmarker) gives the eyes, the irises and the turn of the
// head in each frame; a short calibration (looking at a few dots) maps them to the screen.
//
// A webcam gaze is rough: a few centimetres on the screen at best, worse when the head moves or the
// light is poor. It is used as a hint for the score follower, never on its own: how much it counts
// is in `quality`, and the follower trusts it less still when the eyes and the playing disagree
// (someone playing by heart looks anywhere).
//
// The same frames also give winks, with both eyes in view (a head turned aside, one eye hidden,
// is not a wink).

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;

// eye landmarks (MediaPipe face mesh): corners, lids, iris centre
const EYE = {
  r: { out: 33, inn: 133, top: 159, bot: 145, iris: 468 },
  l: { out: 263, inn: 362, top: 386, bot: 374, iris: 473 },
};

// ---- small linear algebra: ridge regression
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
export function ridge(X, y, lam = 1e-3) {
  const d = X[0].length, A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) { const x = X[i]; for (let p = 0; p < d; p++) { b[p] += x[p] * y[i]; for (let q = 0; q < d; q++) A[p][q] += x[p] * x[q]; } }
  for (let p = 1; p < d; p++) A[p][p] += lam * X.length;
  return solve(A, b);
}
const dot = (w, x) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * x[i]; return s; };

// the features of one frame for the screen mapping (scaled to about -1..1). Several sets, from a
// few (steady with few dots) to many (finer when the eyes were seen well); the set-up keeps the one
// that guesses the dots left out best.
export const FSETS = ['iris', 'look', 'look+head', 'full'];
export function featuresOf(s, set = 'legacy') {
  const u = s.u, v = s.v, yw = s.yaw / 30, pt = s.pitch / 30;
  if (set === 'legacy' || !set) return [1, u, v, yw, pt, s.tx / 20, s.ty / 20, u * v, u * u, v * v, u * yw, v * pt];
  const lh = s.lookH || 0, lv = s.lookV || 0, op = ((s.open || 0.3) - 0.3) * 5;
  if (set === 'iris') return [1, u, v, yw, pt];
  if (set === 'look') return [1, u, v, lh, lv, op];
  if (set === 'look+head') return [1, u, v, lh, lv, op, yw, pt];
  return [1, u, v, lh, lv, op, yw, pt, s.tx / 20, s.ty / 20, u * yw, v * pt, lv * pt];
}

export class Gaze {
  constructor() {
    this.on = false; this.cal = null; this.listeners = new Set(); this.last = null; this.err = null;
    this.smooth = null;
  }
  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof WebAssembly === 'object');
  }
  onSample(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async start() {
    if (this.on) return true;
    this.on = true; this.err = null;
    const tok = this._tok = (this._tok || 0) + 1;
    let stream = null;
    try {
      // the camera first (asked for at once), the model meanwhile
      const cam = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
      const model = this._model();
      stream = await cam;
      await model;
      // (stopped, or started again, meanwhile: this camera is let go; only one is ever open)
      if (!this.on || tok !== this._tok) { for (const t of stream.getTracks()) t.stop(); return false; }
      this.stream = stream;
      const v = this.video = this.video || Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
      v.setAttribute('playsinline', ''); v.srcObject = this.stream;
      await v.play().catch(() => {});
      this._loop();
      return true;
    } catch (e) {
      if (stream && stream !== this.stream) for (const t of stream.getTracks()) t.stop();
      if (tok === this._tok) { this.err = String((e && e.message) || e); this.on = false; this._release(); }
      return false;
    }
  }
  // the face model: in a thread of its own when it can be (nothing on the page waits for it), else here
  _model() { if (!this._modelP) { this._modelP = this._model1(); this._modelP.catch(() => { this._modelP = null; }); } return this._modelP; }
  async _model1() {
    if (this.worker || this.lm) return;
    const life = this._life = (this._life || 0) + 1;
    if (!(globalThis.__gazeMain) && typeof Worker === 'function') {
      try {
        const w = new Worker(new URL('./gaze-worker.js', import.meta.url));
        const ok = await new Promise((res) => {
          const to = setTimeout(() => res(false), 45000);
          w.onmessage = (e) => { if (e.data.ready) { clearTimeout(to); this.delegate = e.data.delegate; res(true); } else if (e.data.error) { clearTimeout(to); this.err = e.data.error; res(false); } };
          w.onerror = () => { clearTimeout(to); res(false); };
          w.postMessage({ init: BASE, gpu: !!globalThis.__gazeGpu });
        });
        if (ok && life !== this._life) { w.terminate(); return; }   // (given up meanwhile)
        if (ok) {
          this.worker = w; this.pending = false;
          w.onmessage = (e) => { this.pending = false; this._fromWorker(e.data); };
          return;
        }
        w.terminate();
      } catch (e) { /* the page's own thread, then */ }
    }
    const mp = await import('../vendor/mediapipe/vision_bundle.mjs');
    // (the model needs the processor's vector instructions: iPadOS 16.4 or later)
    if (!(await mp.FilesetResolver.isSimdSupported())) throw new Error('This iPad is too old for following the eyes.');
    const fileset = { wasmLoaderPath: BASE + 'wasm/vision_wasm_internal.js', wasmBinaryPath: BASE + 'wasm/vision_wasm_internal.wasm' };
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: BASE + 'face_landmarker.task', delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
    try { this.lm = await mp.FaceLandmarker.createFromOptions(fileset, opts('GPU')); this.delegate = 'GPU-main'; } catch (e) { this.lm = await mp.FaceLandmarker.createFromOptions(fileset, opts('CPU')); this.delegate = 'CPU-main'; }
  }
  stop() { this.on = false; this._tok = (this._tok || 0) + 1; this._release(); }
  // (no longer wanted at all: the face model's thread goes too, it takes much memory)
  dispose() { this._life = (this._life || 0) + 1; this.stop(); if (this.worker) { try { this.worker.terminate(); } catch {} this.worker = null; } this.lm = null; this._modelP = null; }
  _release() {
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    if (this.video) this.video.srcObject = null;
  }
  // how long the model takes per frame (ms), kept to set the pace
  _cost(ms) { this.avgMs = this.avgMs ? this.avgMs * 0.9 + ms * 0.1 : ms; }
  _loop() {
    let lastT = 0;
    const tick = () => {
      if (!this.on) return;
      const v = this.video;
      const now = performance.now();
      // about 20 frames a second at most; slower when the model is slow (it never takes more than
      // about a fifth of the time on the page's own thread), and a pause while the page is busy
      // turning (globalThis.__busyUntil)
      const gap = Math.max(48, (this.avgMs || 20) * (this.worker ? 1.15 : 5));
      const busy = (globalThis.__busyUntil || 0) > now && !this.worker;
      if (v && v.readyState >= 2 && now - lastT >= gap && !busy && !this.pending) {
        lastT = now;
        if (this.worker) {
          this.pending = true;
          const w = v.videoWidth || 640, h = v.videoHeight || 480, k = Math.min(1, 480 / Math.max(w, h));
          createImageBitmap(v, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k) })
            .then((bm) => { if (!this.on || !this.worker) { bm.close(); this.pending = false; return; } this.worker.postMessage({ frame: bm, t: now }, [bm]); })
            .catch(() => { this.pending = false; });
          // (an answer lost: not waiting for it for ever)
          clearTimeout(this.pendT); this.pendT = setTimeout(() => { this.pending = false; }, 1500);
        } else {
          let r = null; const t0 = performance.now(); try { r = this.lm.detectForVideo(v, now); } catch (e) { r = null; }
          this._cost(performance.now() - t0);
          this._frame(r, now);
        }
      }
      if (v && v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
    };
    tick();
  }
  _fromWorker(d) {
    if (!this.on) return;
    if (d.ms) this._cost(d.ms);
    if (d.none) { this._frame(null, d.t); return; }
    const L = new Array(478); for (const k in d.pts) L[k] = d.pts[k];
    const cats = [{ categoryName: 'eyeBlinkLeft', score: d.bl }, { categoryName: 'eyeBlinkRight', score: d.br }];
    for (const [k, v] of Object.entries(d.look || {})) cats.push({ categoryName: k, score: v });
    this._frame({ faceLandmarks: [L], facialTransformationMatrixes: d.M ? [{ data: d.M }] : [], faceBlendshapes: [{ categories: cats }] }, d.t);
  }
  // one frame: the eyes, the head, the blinks (and the point on the screen, when calibrated)
  _frame(r, t) {
    const s = measure(r, t);
    if (s.face && this.cal) {
      const f = featuresOf(s, this.cal.fset || 'legacy');
      let x = dot(this.cal.wx, f), y = dot(this.cal.wy, f);
      // (the drift since calibrating, as the follower has seen it)
      x += this.cal.dx || 0; y += this.cal.dy || 0;
      // smoothed over a few frames, but a jump to another line follows quickly
      const a = this.smooth && Math.hypot(x - this.smooth.x, y - this.smooth.y) < 120 ? 0.35 : 0.8;
      this.smooth = this.smooth ? { x: this.smooth.x + a * (x - this.smooth.x), y: this.smooth.y + a * (y - this.smooth.y) } : { x, y };
      s.x = this.smooth.x; s.y = this.smooth.y;
      // (worth less the further the head has turned from how it was while setting up)
      const turned = Math.max(Math.abs(s.yaw - (this.cal.yaw0 || 0)) - 14, Math.abs(s.pitch - (this.cal.pitch0 || 0)) - 12, 0);
      s.quality = s.see ? Math.max(0, 1 - (this.cal.err || 80) / 260) * Math.max(0, 1 - turned / 22) : 0;
      // a blink: the eyes are not looking anywhere
      if (s.blinkL > 0.45 && s.blinkR > 0.45) s.quality = 0;
    } else s.quality = 0;
    this.last = s;
    for (const fn of this.listeners) { try { fn(s); } catch (e) { console.warn(e); } }
  }
}

// what a frame shows: face found, iris position in each eye (u across, v up and down, in eye
// widths), head turn (degrees) and place (cm), blinks (0..1), both eyes in view
export function measure(r, t) {
  const s = { t, face: false, both: false, blinkL: 0, blinkR: 0, u: 0, v: 0, yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0 };
  const L = r && r.faceLandmarks && r.faceLandmarks[0];
  if (!L || L.length < 478) return s;
  s.face = true;
  const eye = (e) => {
    const a = L[e.inn], b = L[e.out], c = L[e.iris];
    const ex = b.x - a.x, ey = b.y - a.y, w = Math.hypot(ex, ey) || 1e-6;
    const ux = ex / w, uy = ey / w;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = c.x - mx, dy = c.y - my;
    return { u: (dx * ux + dy * uy) / w, v: (-dx * uy + dy * ux) / w, w, open: Math.hypot(L[e.top].x - L[e.bot].x, L[e.top].y - L[e.bot].y) / w };
  };
  const er = eye(EYE.r), el = eye(EYE.l);
  // (left and right outer corners point opposite ways: across means the same on screen). With the
  // iPad to one side the far eye is narrower in the picture and its iris less sure: each eye
  // counts by how wide it is seen.
  const kl = el.w * el.w, kr = er.w * er.w;
  s.u = (kl * el.u - kr * er.u) / (kl + kr); s.v = (kl * el.v + kr * er.v) / (kl + kr);
  const M = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0] && r.facialTransformationMatrixes[0].data;
  if (M) {
    s.yaw = (Math.atan2(M[8], M[10]) * 180) / Math.PI;
    s.pitch = (Math.asin(Math.max(-1, Math.min(1, -M[9]))) * 180) / Math.PI;
    s.tx = M[12]; s.ty = M[13]; s.tz = M[14];
  }
  const bs = r.faceBlendshapes && r.faceBlendshapes[0] && r.faceBlendshapes[0].categories;
  const lk = {};
  if (bs) for (const c of bs) { if (c.categoryName === 'eyeBlinkLeft') s.blinkL = c.score; else if (c.categoryName === 'eyeBlinkRight') s.blinkR = c.score; else lk[c.categoryName] = c.score; }
  // where the face model itself says the eyes look (trained on many faces: steadier than the iris
  // alone), across (+ to the right of the picture) and up (+): the two eyes together
  const g = (k) => lk[k] || 0;
  s.lookH = ((g('eyeLookOutLeft') - g('eyeLookInLeft')) * kl + (g('eyeLookInRight') - g('eyeLookOutRight')) * kr) / (kl + kr);
  s.lookV = ((g('eyeLookUpLeft') - g('eyeLookDownLeft')) * kl + (g('eyeLookUpRight') - g('eyeLookDownRight')) * kr) / (kl + kr);
  s.hasLook = Object.keys(lk).length > 0;
  // how open the eyelids are: they follow the eyes down a page (looking down lowers them)
  s.open = (el.open * kl + er.open * kr) / (kl + kr);
  // both eyes in view: the head not turned far, and the two eyes about as wide in the picture
  const ratio = Math.min(er.w, el.w) / Math.max(er.w, el.w);
  s.both = Math.abs(s.yaw) < 40 && ratio > 0.5;
  // good enough to tell where the eyes look: from the front or from the side (up to about 55°),
  // with the far eye still in the picture
  s.see = Math.abs(s.yaw) < 64 && ratio > 0.2;
  s.ratio = ratio;
  return s;
}

// Winks from how shut each eye is (0 open .. 1 shut), from the iPad's own face tracking or from the
// camera here. Each eye is measured against its own resting level of the moment before, so a face
// turned a little aside (the far eye looks half shut to the camera all the time) still winks
// well. A wink: one eye shuts clearly beyond its rest while the other stays near its own, for a
// short moment. Both closing together (a blink, eyes closed, a head turned away with the eyes
// shut) never is one.
export class WinkLevels {
  constructor() { this.h = []; this.run = null; this.lastFire = 0; this.sens = 0.7; }
  // t: ms; l, r: how shut; ok: the face is there to judge. Returns 'left', 'right' or null.
  feed(t, l, r, ok = true) {
    const h = this.h; h.push({ t, l, r }); while (h.length && t - h[0].t > 2500) h.shift();
    if (!ok) { this.run = null; return null; }
    // the resting level of each eye: the open half of the moment before (0.5 to 2.5 s ago)
    const old = h.filter((q) => t - q.t > 500);
    const restOf = (k) => { if (old.length < 6) return 0.12; const v = old.map((q) => q[k]).sort((x, y) => x - y); return v[Math.floor(v.length * 0.3)]; };
    const bl = restOf('l'), br = restOf('r');
    const dl = l - bl, dr = r - br;
    // how far past its rest the winking eye has to go: less with a higher sensitivity
    const need = 0.34 - (this.sens - 0.5) * 0.3;
    let eye = null;
    if (dr > need && r > 0.4 && dl < Math.max(0.18, dr * 0.35)) eye = 'right';
    else if (dl > need && l > 0.4 && dr < Math.max(0.18, dl * 0.35)) eye = 'left';
    // both shut (each clearly past its rest): a blink or closed eyes, never a wink
    if (this.run && dl > 0.3 && dr > 0.3 && l > 0.45 && r > 0.45) this.run.spoilt = true;
    if (this.run && !this.run.spoilt && this.run.eye === eye) {
      // fired as soon as the wink has lasted long enough to be one (no wait for the eye to open)
      const d = t - this.run.t0;
      if (!this.run.fired && d >= 120 && t - this.lastFire > 900) { this.run.fired = true; this.lastFire = t; return eye; }
      if (d > 1200) this.run.spoilt = true;
      return null;
    }
    // a wink shuts the eye quickly; an eye that creeps shut (the head turning away, tiredness) is not one
    if (eye) {
      const k = eye === 'left' ? 'l' : 'r', rest = eye === 'left' ? bl : br;
      const prev = h.filter((q) => t - q.t >= 90 && t - q.t <= 220);
      if (prev.length && Math.min(...prev.map((q) => q[k])) - rest > 0.22) eye = null;
    }
    this.run = eye ? { eye, t0: t, spoilt: false, fired: false } : null;
    return null;
  }
}
// From the camera's frames here (while the eyes are followed)
export class WinkDetector {
  constructor(onWink) { this.onWink = onWink; this.lv = new WinkLevels(); this.sens = 0.7; }
  feed(s) {
    this.lv.sens = this.sens;
    const e = this.lv.feed(s.t, s.blinkL || 0, s.blinkR || 0, !!(s.face && (s.see ?? s.both)));
    if (e) this.onWink(e);
  }
}

// The calibration: the frames gathered while looking at each dot give the mapping to the screen.
// samples: [{ px, py, s }] (the dot in screen pixels, the frame). Each dot counts once, as the middle
// of what was seen while looking at it (a glance away, a blink, the first moment of moving the eyes
// left out), so a few bad frames never spoil it; the set of features that guesses the dots left out
// best is kept. Returns { wx, wy, fset, err, errX, errY } (errors in px, each dot guessed from the
// others), or null when too few dots were seen.
export function fitCalibration(samples) {
  const usable = (q) => q.s.face && !(q.s.blinkL > 0.45 && q.s.blinkR > 0.45) && (q.s.see ?? q.s.both ?? true);
  const byDot = new Map();
  for (const q of samples) { if (!usable(q)) continue; const k = q.px + ',' + q.py; if (!byDot.has(k)) byDot.set(k, []); byDot.get(k).push(q); }
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const keys = ['u', 'v', 'lookH', 'lookV', 'open', 'yaw', 'pitch', 'tx', 'ty'];
  const dots = [];
  for (const [k, qs] of byDot) {
    if (qs.length < 3) continue;
    // the middle of each measure, then the frames far from it dropped and the middle taken again
    const m0 = {}; for (const key of keys) m0[key] = med(qs.map((q) => q.s[key] || 0));
    const dist = (q) => Math.abs((q.s.u || 0) - m0.u) * 8 + Math.abs((q.s.v || 0) - m0.v) * 8 + Math.abs((q.s.lookV || 0) - m0.lookV) * 2 + Math.abs((q.s.lookH || 0) - m0.lookH) * 2;
    const ds = qs.map(dist).sort((a, b) => a - b), cut = ds[Math.floor(ds.length * 0.7)] + 1e-9;
    const keep = qs.filter((q) => dist(q) <= cut);
    const s = {}; for (const key of keys) s[key] = med(keep.map((q) => q.s[key] || 0));
    dots.push({ px: qs[0].px, py: qs[0].py, s, n: keep.length });
  }
  if (dots.length < 5) return null;
  const hasLook = samples.some((q) => q.s.hasLook);
  const sets = (hasLook ? FSETS : ['iris']).filter((f) => featuresOf(dots[0].s, f).length <= dots.length + 1);
  const fit = (ds, f, lam) => { const X = ds.map((d) => featuresOf(d.s, f)); return { wx: ridge(X, ds.map((d) => d.px), lam), wy: ridge(X, ds.map((d) => d.py), lam) }; };
  const loo = (f, lam) => {
    let ex = 0, ey = 0;
    for (let i = 0; i < dots.length; i++) {
      const w = fit(dots.filter((_, j) => j !== i), f, lam), x = featuresOf(dots[i].s, f);
      ex += (dot(w.wx, x) - dots[i].px) ** 2; ey += (dot(w.wy, x) - dots[i].py) ** 2;
    }
    return { errX: Math.sqrt(ex / dots.length), errY: Math.sqrt(ey / dots.length) };
  };
  // the simplest that is about as good as the best (more features only when they clearly help:
  // with a dozen dots, many features learn the dots and not the eyes)
  const all = [];
  for (const f of sets) for (const lam of [1e-2, 5e-2, 0.2, 0.6]) { const e = loo(f, lam); all.push({ f, lam, err: Math.hypot(e.errX, e.errY), ...e, size: featuresOf(dots[0].s, f).length }); }
  const top = Math.min(...all.map((q) => q.err));
  const best = all.filter((q) => q.err <= top * 1.1).sort((a, b) => a.size - b.size || b.lam - a.lam)[0];
  const w = fit(dots, best.f, best.lam);
  return { wx: w.wx, wy: w.wy, fset: best.f, err: best.err, errX: best.errX, errY: best.errY, dots: dots.length,
    yaw0: med(dots.map((d) => d.s.yaw)), pitch0: med(dots.map((d) => d.s.pitch)) };
}
