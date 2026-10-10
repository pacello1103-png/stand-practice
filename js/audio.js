// One shared AudioContext and one shared microphone for the whole app.
let ctx = null;
let masterGain = null;

function setSession(type) {
  // In the iPad app the native side keeps one play-and-record session for everything.
  if (window.standCaps && window.standCaps.native) return;
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* not supported */ }
}

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    // Gentle safety limiter so stacked sounds never clip harshly.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -3; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.1;
    masterGain.connect(comp).connect(ctx.destination);
    // Play through the speaker even when the iPad's silent switch is on.
    setSession('playback');
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}

export function master() { getCtx(); return masterGain; }

// Call from a user gesture; iOS needs a sound to start inside a tap.
export function unlock() {
  const c = getCtx();
  const b = c.createBuffer(1, 1, c.sampleRate);
  const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start();
}

let micStream = null, micSource = null, micUsers = 0, micPending = null;

export async function acquireMic() {
  const c = getCtx();
  micUsers++;
  if (micSource) return micSource;
  if (!micPending) {
    setSession('play-and-record');
    micPending = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    }).then((stream) => {
      micStream = stream;
      micSource = c.createMediaStreamSource(stream);
      return micSource;
    }).catch((e) => { micUsers = 0; setSession('playback'); throw e; })
      .finally(() => { micPending = null; });
  }
  return micPending;
}

export function releaseMic() {
  micUsers = Math.max(0, micUsers - 1);
  if (micUsers === 0 && micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    try { micSource.disconnect(); } catch {}
    micStream = null; micSource = null;
    setSession('playback');
  }
}

export function micErrorText(e) {
  if (!navigator.mediaDevices) return 'This browser cannot use the microphone. Open Stand in Safari.';
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'Microphone access is off. Allow it in Settings › Safari › Microphone, then try again.';
  if (e && e.name === 'NotFoundError') return 'No microphone was found.';
  return 'The microphone could not start. Try again.';
}
