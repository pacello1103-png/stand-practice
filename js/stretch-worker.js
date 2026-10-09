// Time-stretch without changing pitch: WSOLA (waveform-similarity overlap-add).
// 50 ms Hann frames, 75% overlap, ±12 ms similarity search with a coarse-to-fine
// normalised cross-correlation. Tuned for sustained, mostly monophonic instruments.

function wsola(x, sr, rate, onProgress) {
  const N = x.length;
  if (Math.abs(rate - 1) < 1e-4 || N < 4096) return Float32Array.from(x);
  const D = 4;                                   // decimation for the coarse search
  const L = Math.max(256, (Math.round(sr * 0.05) >> 3) << 3);
  const Hs = L >> 2;
  const Ha = Hs * rate;
  const tol = Math.round(sr * 0.012);
  const P = L + tol + 2 * D;                     // zero padding on both sides

  const xp = new Float32Array(N + 2 * P);
  xp.set(x, P);
  const nd = Math.floor(xp.length / D);
  const xd = new Float32Array(nd);
  for (let i = 0; i < nd; i++) { let s = 0; const b = i * D; for (let j = 0; j < D; j++) s += xp[b + j]; xd[i] = s / D; }

  const win = new Float32Array(L);
  for (let i = 0; i < L; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / L);

  const outLen = Math.round(N / rate);
  const y = new Float32Array(outLen + L + Hs);
  const w = new Float32Array(outLen + L + Hs);

  const Lc = L >> 1;            // compare the leading half: the part that overlaps
  const Lcd = (Lc / D) | 0;

  let prev = P;
  const addFrame = (src, at) => {
    for (let i = 0; i < L; i++) { const o = at + i; if (o >= y.length) break; y[o] += xp[src + i] * win[i]; w[o] += win[i]; }
  };
  addFrame(prev, 0);

  const frames = Math.ceil(outLen / Hs) + 1;
  for (let k = 1; k < frames; k++) {
    const nominal = P + Math.round(k * Ha);
    if (nominal - tol + L >= xp.length) break;
    const target = prev + Hs;
    const lo = Math.max(0, nominal - tol);
    const hi = Math.min(xp.length - L - 1, nominal + tol);
    if (hi < lo) break;

    // coarse search (decimated)
    const t = Math.round(target / D);
    const cLo = Math.ceil(lo / D), cHi = Math.floor(hi / D);
    let bestC = Math.round(nominal / D), bestScore = -Infinity;
    if (t + Lcd < nd) {
      let e = 0;
      for (let i = 0; i < Lcd; i++) { const v = xd[cLo + i]; e += v * v; }
      for (let c = cLo; c <= cHi; c++) {
        if (c > cLo) { const a = xd[c - 1], b = xd[c + Lcd - 1]; e += b * b - a * a; }
        let s = 0;
        for (let i = 0; i < Lcd; i++) s += xd[c + i] * xd[t + i];
        const score = s / Math.sqrt(e + 1e-9);
        if (score > bestScore) { bestScore = score; bestC = c; }
      }
    }
    // fine search around the coarse winner (full rate)
    let best = Math.min(hi, Math.max(lo, bestC * D));
    let bestFine = -Infinity;
    const fLo = Math.max(lo, best - D), fHi = Math.min(hi, best + D);
    for (let c = fLo; c <= fHi; c++) {
      let s = 0, e = 0;
      for (let i = 0; i < Lc; i += 1) { const v = xp[c + i]; s += v * xp[target + i]; e += v * v; }
      const score = s / Math.sqrt(e + 1e-9);
      if (score > bestFine) { bestFine = score; best = c; }
    }
    addFrame(best, k * Hs);
    prev = best;
    if (onProgress && (k & 255) === 0) onProgress(k / frames);
  }

  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = w[i] > 1e-4 ? y[i] / w[i] : 0;
  return out;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    const { id, data, sr, rate } = e.data;
    const out = wsola(data, sr, rate, (p) => self.postMessage({ id, progress: p }));
    self.postMessage({ id, out }, [out.buffer]);
  };
}
if (typeof module !== 'undefined') module.exports = { wsola };
