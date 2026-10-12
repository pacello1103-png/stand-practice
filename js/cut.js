// Cutting recordings: keep only a selected part, or remove it and join the rest.
// Audio is cut sample by sample. A video is re-recorded from its own frames, in real time,
// with the cut sound, so it stays in step.
import { getCtx } from './audio.js';

const clampI = (i, n) => Math.max(0, Math.min(n, i));

// The samples to keep: the selection, or everything except the selection.
export function cutPcm(data, sr, a, b, mode) {
  const i0 = clampI(Math.round(a * sr), data.length), i1 = clampI(Math.round(b * sr), data.length);
  if (mode === 'keep') return data.slice(i0, i1);
  const out = new Float32Array(data.length - (i1 - i0));
  out.set(data.subarray(0, i0), 0);
  out.set(data.subarray(i1), i0);
  return out;
}

// The parts of the original, in order, that the cut keeps (seconds).
export function segmentsFor(dur, a, b, mode) {
  const segs = mode === 'keep' ? [[a, b]] : [[0, a], [b, dur]];
  return segs.filter(([s, e]) => e - s > 0.01);
}
export const segmentsLength = (segs) => segs.reduce((t, [s, e]) => t + (e - s), 0);

// Re-record the video frames of the kept parts, with the cut sound. Runs in real time.
export function renderVideoCut({ url, mirror, segs, pcm, sr, onProgress }) {
  return new Promise(async (resolve, reject) => {
    try {
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video')); });
      const W = Math.min(v.videoWidth, 1280), H = Math.round((W * v.videoHeight) / v.videoWidth) || 720;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d');
      const ctx = getCtx();
      const dest = ctx.createMediaStreamDestination();
      const buf = ctx.createBuffer(1, Math.max(1, pcm.length), sr); buf.copyToChannel(pcm, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
      const stream = canvas.captureStream(30);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      const type = ['video/mp4', 'video/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = () => reject(new Error('record'));
      rec.onstop = () => { v.pause(); resolve(new Blob(chunks, { type: type || 'video/webm' })); };

      const total = segmentsLength(segs);
      // which part of the original plays at output time t
      const at = (t) => {
        let acc = 0;
        for (const [s, e] of segs) { const len = e - s; if (t < acc + len) return { src: s + (t - acc), end: acc + len }; acc += len; }
        return null;
      };
      rec.start(250);
      const t0 = ctx.currentTime + 0.12;
      src.start(t0);
      let started = false;
      const first = at(0);
      v.currentTime = first.src;
      await new Promise((r) => { v.onseeked = () => r(); });
      const tick = () => {
        const out = Math.max(0, ctx.currentTime - t0);
        if (!started && ctx.currentTime >= t0) { started = true; v.play().catch(() => {}); }
        if (out >= total) { rec.state !== 'inactive' && rec.stop(); return; }
        const p = at(out);
        if (p && started && Math.abs(v.currentTime - p.src) > 0.15) v.currentTime = p.src;
        if (started && v.readyState >= 2) {
          g.save();
          if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
          g.drawImage(v, 0, 0, W, H);
          g.restore();
        }
        onProgress && onProgress(out / total);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) { reject(err); }
  });
}
