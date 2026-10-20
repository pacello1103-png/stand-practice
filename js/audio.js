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
  // only a broken sound system is replaced, and not over and over: a merely suspended one just
  // waits for the next touch (iOS allows only a few sound systems; making more breaks sound until
  // Stand is closed)
  if (!mayReplace(c)) return c;
  try { c.close(); } catch {}
  ctx = null;
  const n = getCtx();
  // anyone using the microphone hears it again through the new sound system
  if (micStream) { try { micSource = n.createMediaStreamSource(micStream); } catch {} }
  try { await Promise.race([n.resume(), new Promise((r) => setTimeout(r, timeout))]); } catch {}
  window.dispatchEvent(new Event('stand-audio-new'));
  return n;
}
// After Stand was in the background, after a call, or when iOS restarted its audio, the sound
// system can look alive and play nothing, and the microphone can be dead. Check both, and rebuild
// what is broken; everyone using sound (metronome, drone, tuner…) hears 'stand-audio-new' or
// 'stand-mic-lost' and carries on by itself. No need to close Stand any more.
let healing = null, lastReplace = -1e9;
function mayReplace(c, clockStuck = false) {
  if (performance.now() - lastReplace < 5000) return false;
  const broken = c.state === 'interrupted' || c.state === 'closed' || (c.state === 'running' && clockStuck);
  if (!broken) return false;
  lastReplace = performance.now();
  return true;
}
const clockMoves = async (c, ms = 260) => { const t0 = c.currentTime; await new Promise((r) => setTimeout(r, ms)); return c.currentTime > t0; };
export function healAudio(reason = '') {
  if (healing) return healing;
  healing = (async () => {
    if (micStream && micStream.getAudioTracks().some((t) => t.readyState !== 'live')) {
      micStream = null; micSource = null;
      window.dispatchEvent(new Event('stand-mic-lost'));
    }
    if (!ctx) return;
    const inUse = wantSound || micUsers > 0;
    if (reason !== 'reset') {
      try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 600))]); } catch {}
      const moving = ctx.state === 'running' && await clockMoves(ctx);
      if (moving) return;
      if (!inUse) return;          // nothing is playing: it wakes on the next touch
      if (!mayReplace(ctx, ctx.state === 'running')) return;   // suspended: the next touch wakes it
    } else lastReplace = performance.now();
    // dead: a new sound system, and the microphone connected to it
    try { ctx.close(); } catch {}
    ctx = null;
    const n = getCtx();
    if (micStream) { try { micSource = n.createMediaStreamSource(micStream); } catch { micStream = null; micSource = null; } }
    try { await Promise.race([n.resume(), new Promise((r) => setTimeout(r, 600))]); } catch {}
    window.dispatchEvent(new Event('stand-audio-new'));
    if (!micSource && micUsers > 0) window.dispatchEvent(new Event('stand-mic-lost'));
  })().finally(() => { healing = null; });
  return healing;
}
if (typeof window !== 'undefined') {
  window.standAudioWake = (reason) => { healAudio(reason); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => healAudio('visible'), 400); });
  window.addEventListener('pageshow', () => setTimeout(() => healAudio('visible'), 400));
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
  // a microphone that iOS stopped while Stand was away is opened afresh
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState !== 'live')) { micStream = null; micSource = null; }
  if (micSource && micSource.context !== c) { try { micSource = c.createMediaStreamSource(micStream); } catch { micStream = null; micSource = null; } }
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
