// Camera recording with MediaRecorder. The audio track is decoded afterwards so video takes
// get the same waveform, looping, slow-down and reverb as audio takes.
import { getCtx } from './audio.js';

const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export class VideoRecorder {
  constructor() { this.stream = null; this.rec = null; this.recording = false; }
  async open(facing = 'user') {
    this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    return this.stream;
  }
  start() {
    const type = (window.MediaRecorder && TYPES.find((t) => MediaRecorder.isTypeSupported(t))) || '';
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, { mimeType: type || undefined, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 192_000 });
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
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
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
