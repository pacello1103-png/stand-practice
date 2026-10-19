// Camera recording with MediaRecorder. The audio track is decoded afterwards so video takes
// get the same waveform, looping, slow-down and reverb as audio takes.
import { getCtx } from './audio.js';

const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export class VideoRecorder {
  constructor() { this.stream = null; this.rec = null; this.recording = false; }
  // The picture goes through a canvas in the shape the iPad is held (landscape when it lies on its
  // side), turning the camera's frames if they come the other way round.
  async open(facing = 'user', shape = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait') {
    // already open the same way (opened ahead of time): start at once
    if (this.cam && this.facing === facing && this.shape === shape && this.cam.getVideoTracks().every((t) => t.readyState === 'live')) return this.stream;
    this.close();
    const land = shape === 'landscape';
    this.cam = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: land ? 1280 : 720 }, height: { ideal: land ? 720 : 1280 }, frameRate: { ideal: 30, max: 30 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.shape = shape; this.facing = facing;
    // the camera's own picture, kept in the page (iOS slows down videos that are not on the page)
    const v = this.src = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.append(v);
    v.srcObject = new MediaStream(this.cam.getVideoTracks());
    await v.play().catch(() => {});
    if (!v.videoWidth) await new Promise((r) => { const t = setTimeout(r, 1500); v.addEventListener('loadedmetadata', () => { clearTimeout(t); r(); }, { once: true }); });
    const vw = v.videoWidth, vh = v.videoHeight;
    // When the camera already gives the picture the right way round, it is recorded directly: no
    // copying of frames, so nothing on screen can make the video stutter.
    if (!vw || (vw > vh) === land || !(document.createElement('canvas').captureStream)) {
      this.direct = true;
      this.stream = new MediaStream([...this.cam.getVideoTracks(), ...this.cam.getAudioTracks()]);
      return this.stream;
    }
    this.direct = false;
    const c = this.canvas = document.createElement('canvas');
    c.width = land ? 1280 : 720; c.height = land ? 720 : 1280;
    const g = c.getContext('2d', { alpha: false });
    const draw = () => {
      if (!this.cam) return;
      const w = v.videoWidth, h = v.videoHeight;
      if (w && h) {
        g.save(); g.translate(c.width / 2, c.height / 2); g.rotate(Math.PI / 2);
        const k = Math.max(c.height / w, c.width / h); g.drawImage(v, -w * k / 2, -h * k / 2, w * k, h * k);
        g.restore();
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else this.raf = requestAnimationFrame(draw);
    };
    draw();
    const out = c.captureStream(30);
    this.stream = new MediaStream([...out.getVideoTracks(), ...this.cam.getAudioTracks()]);
    return this.stream;
  }
  start() {
    const type = (window.MediaRecorder && TYPES.find((t) => MediaRecorder.isTypeSupported(t))) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, { mimeType: type || undefined, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
    this.mime = this.rec.mimeType || type || 'video/mp4';
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.recording = true;
    this.startedAt = performance.now();
  }
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') { resolve(null); return; }
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
        this.recording = false;
        resolve(blob);
      };
      this.rec.stop();
    });
  }
  close() {
    cancelAnimationFrame(this.raf); clearInterval(this.timer);
    if (this.cam) this.cam.getTracks().forEach((t) => t.stop());
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.src) { this.src.srcObject = null; this.src.remove(); this.src = null; }
    this.facing = null;
    this.stream = null; this.cam = null;
  }
}

// Decode the sound of a video file into mono samples. Returns null if the browser can't.
export async function decodeVideoAudio(blob) {
  try {
    const ctx = getCtx();
    const buf = await blob.arrayBuffer();
    const audio = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    const n = audio.length, ch = audio.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    return { data: mono, sr: audio.sampleRate };
  } catch (e) {
    console.warn('Could not decode video audio', e);
    return null;
  }
}

// A still frame for the recordings list.
export function videoThumb(blob) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(blob);
    const done = (b) => { URL.revokeObjectURL(url); resolve(b); };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch { done(null); } };
    v.onseeked = () => {
      const c = document.createElement('canvas');
      const w = 240, h = Math.round((240 * (v.videoHeight || 9)) / (v.videoWidth || 16));
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      c.toBlob((b) => done(b), 'image/jpeg', 0.75);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    v.src = url;
  });
}
