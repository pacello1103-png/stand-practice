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
    ctx.addEventListener('statechange', () => { if (wantSound && ctx.state !== 'running') ctx.resume().catch(() => {}); });
    document.addEventListener('visibilitychange', () => { if (wantSound && document.visibilityState === 'visible' && ctx.state !== 'running') ctx.resume().catch(() => {}); });
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  return ctx;
}
// The metronome asks for sound to keep coming: an interruption (a call, a lock, the mic starting) is then undone at once.
let wantSound = false;
export function wantAudio(on) { wantSound = !!on; if (on) getCtx(); }

export function master() { getCtx(); return masterGain; }

// Sound must really be running before a metronome or a tuner starts. iOS can leave the sound
// system suspended (the first tap of the day) or "interrupted" (after a call, Siri, or when the
// microphone opens). Wake it; if it will not wake, make a new one (the old one is dead).
export async function ensureRunning(timeout = 500) {
  const c = getCtx();
  if (c.state === 'running') return c;
  try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, timeout))]); } catch {}
  if (c.state === 'running') return c;
  try { c.close(); } catch {}
  ctx = null;
  const n = getCtx();
  // anyone using the microphone hears it again through the new sound system
  if (micStream) { try { micSource = n.createMediaStreamSource(micStream); } catch {} }
  try { await Promise.race([n.resume(), new Promise((r) => setTimeout(r, timeout))]); } catch {}
  window.dispatchEvent(new Event('stand-audio-new'));
  return n;
}
// The first touch anywhere wakes the sound (iOS only allows it inside a touch), and so does
// coming back to the app.
if (typeof document !== 'undefined') {
  const wake = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('touchend', wake, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
}

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
      // iOS can take the microphone away (a call, Siri, another app): forget it, so the next one
      // to ask opens it afresh, and tell everyone listening
      for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => {
        if (micStream !== stream) return;
        micStream = null; micSource = null;
        window.dispatchEvent(new Event('stand-mic-lost'));
      });
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
