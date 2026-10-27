// The look of a video, as a good photo editor would make it: light, contrast, white balance,
// colour, clarity, noise and sharpness, a soft vignette, and highlights and shadows brought back
// where they are in the picture (not by a filter over the whole frame). Done on the graphics chip
// (WebGL) in full precision, on every frame while playing and while exporting.
//
// "Auto" looks at a few frames of the video (exposure, white balance, contrast, noise) and sets
// everything for it; the looks and the sliders go on top of that.

export const LOOKS = {
  natural: { label: 'Natural' },
  bright: { label: 'Bright', light: 0.22, contrast: 0.04, shadows: 0.3, colour: 0.08, clarity: 0.08 },
  warm: { label: 'Warm', warmth: 0.4, colour: 0.1, contrast: 0.06, light: 0.04 },
  studio: { label: 'Studio', contrast: 0.12, colour: 0.08, sharp: 0.35, vignette: 0.25, highlights: 0.3, clarity: 0.2 },
  soft: { label: 'Soft', contrast: -0.1, shadows: 0.2, highlights: 0.35, sharp: -0.15, warmth: 0.1, clarity: -0.15 },
  film: { label: 'Film', contrast: 0.06, fade: 0.08, colour: -0.15, warmth: 0.15, vignette: 0.22 },
  cool: { label: 'Cool', warmth: -0.32, contrast: 0.08, colour: 0.06 },
  mono: { label: 'Black and white', colour: -1, contrast: 0.16, sharp: 0.2, vignette: 0.18, clarity: 0.15 },
};
const KEYS = ['light', 'contrast', 'warmth', 'tint', 'colour', 'sharp', 'vignette', 'shadows', 'highlights', 'fade', 'clarity', 'denoise', 'black', 'wbr', 'wbb'];
// the settings of a look: what Auto found, the look, and the person's own adjustments on top
export function lookParams(look) {
  const base = LOOKS[(look && look.preset) || 'natural'] || LOOKS.natural;
  const auto = look && look.auto && look.autoOn !== false ? look.auto : null;
  const k0 = look && look.autoAmt !== undefined ? look.autoAmt : 1;
  const out = {};
  for (const k of KEYS) out[k] = (base[k] || 0) + ((look && look.adj && look.adj[k]) || 0) + (auto ? (auto[k] || 0) * k0 : 0);
  return out;
}
export function isNeutral(look) { const p = lookParams(look); return KEYS.every((k) => Math.abs(p[k]) < 1e-3); }

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0.0,1.0); }`;
// (a copy into a small square picture with all its smaller sizes: the local light around each point)
const FS_COPY = `precision mediump float; varying vec2 uv; uniform sampler2D tex; void main(){ gl_FragColor = vec4(texture2D(tex, uv).rgb, 1.0); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv; uniform sampler2D tex; uniform sampler2D blur; uniform vec2 px;
uniform float light, contrast, warmth, tint, colour, sharp, vignette, shadows, highlights, fade, clarity, denoise, black, wbr, wbb;
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGam(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec3 c0 = texture2D(tex, uv).rgb;
  vec3 c = c0;
  // noise: an average of the neighbours that look alike (edges stay sharp); colour noise more
  if (denoise > 0.0) {
    vec3 s = c0; float ws = 1.0;
    float k = 1.0 / (0.002 + denoise * 0.03);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.785398 + (i >= 8 ? 0.3927 : 0.0);
      vec2 o = vec2(cos(a), sin(a)) * px * (i >= 8 ? 1.0 + denoise * 2.5 : 1.0 + denoise * 0.8);
      vec3 q = texture2D(tex, uv + o).rgb;
      vec3 dq = q - c0; float w = exp(-dot(dq, dq) * k);
      s += q * w; ws += w;
    }
    vec3 m = s / ws;
    float a = clamp(denoise, 0.0, 1.0);
    // (the light smoothed gently, the colour noise more firmly)
    float ly = mix(luma(c0), luma(m), a * 0.8);
    vec3 ch = mix(c0 - luma(c0), m - luma(m), min(1.0, a * 1.4));
    c = vec3(ly) + ch;
  }
  // sharpness: the fine detail of the light only, a little held back where it is only noise
  if (sharp != 0.0) {
    vec3 b = (texture2D(tex, uv+vec2(px.x,0.0)).rgb + texture2D(tex, uv-vec2(px.x,0.0)).rgb + texture2D(tex, uv+vec2(0.0,px.y)).rgb + texture2D(tex, uv-vec2(0.0,px.y)).rgb) * 0.25;
    float d = luma(c0) - luma(b);
    float keep = smoothstep(0.004, 0.02, abs(d));
    c += vec3(d) * sharp * 1.4 * (sharp > 0.0 ? keep : 1.0);
  }
  // the black point: a grey veil over the darkest parts goes
  c = (c - black) / max(0.5, 1.0 - black);
  vec3 lin = toLin(c);
  // the white balance found by Auto (gains on red and blue)
  lin *= vec3(1.0 + wbr, 1.0, 1.0 + wbb);
  // white balance (temperature and tint) and exposure, in light, as a camera would
  lin *= vec3(1.0 + warmth * 0.16, 1.0 + tint * 0.08, 1.0 - warmth * 0.18) * pow(2.0, light);
  // the light around this point (blurred): shadows lifted and highlights brought down where they
  // are, and clarity (local contrast), without darkening or flattening the whole picture
  float lb = luma(toLin(texture2D(blur, uv, 4.0).rgb)) * pow(2.0, light);
  float lp = luma(lin);
  float sh = shadows * 0.9 * (1.0 - smoothstep(0.02, 0.35, lb));
  float hl = highlights * 0.55 * smoothstep(0.35, 1.0, lb);
  lin *= pow(2.0, sh - hl);
  if (clarity != 0.0) {
    float lbl = max(lb, 1e-4);
    float r = clamp(lp / lbl, 0.25, 4.0);
    lin *= pow(r, clarity * 0.5);
  }
  // a soft shoulder when the picture is made brighter: bright parts roll off instead of clipping
  // (left as it is otherwise)
  float G = pow(2.0, max(light, 0.0)) * max(1.0 + max(wbr, wbb), 1.0) * pow(2.0, max(shadows, 0.0) * 0.3);
  if (G > 1.01) {
    float R = max(G - 0.8, 0.2);
    vec3 e = max(lin - 0.8, 0.0);
    vec3 rolled = 0.8 + 0.2 * (1.0 - exp(-3.0 * e / R)) / 0.9502;
    lin = mix(lin, mix(lin, rolled, step(0.8, lin)), clamp((G - 1.0) * 6.0, 0.0, 1.0));
  }
  vec3 g = toGam(lin);
  // contrast as an S around the middle grey
  float y = luma(g);
  float ys = clamp(y, 0.0, 1.0);
  float s = ys + contrast * (ys - 0.5) * (1.0 - abs(ys - 0.5) * 1.4);
  g *= s / max(y, 1e-4);
  // colour: vibrance (the dull colours more than the strong ones, skin kept natural), or none
  y = luma(g);
  float sat = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
  float amt = colour < 0.0 ? colour : colour * (1.2 - sat);
  g = mix(vec3(y), g, 1.0 + amt);
  g = mix(g, g * 0.82 + 0.09, fade * 1.6);
  vec2 dv = uv - 0.5; float v = 1.0 - vignette * 0.7 * smoothstep(0.2, 0.9, dot(dv, dv) * 2.0);
  g *= v;
  // a touch of grain-free dither: smooth skies and walls without bands
  g += (rnd(uv * 997.0) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`;

export class Grader {
  constructor() { this.canvas = document.createElement('canvas'); this.ok = null; }
  _init() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) || this.canvas.getContext('experimental-webgl');
    if (!gl) { this.ok = false; return; }
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = (fs) => { const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); return gl.getProgramParameter(pr, gl.LINK_STATUS) ? pr : null; };
    const main = prog(FS), copy = prog(FS_COPY);
    if (!main || !copy) { this.ok = false; return; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const pr of [main, copy]) { const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; };
    this.tex = tex();
    // the small square picture, with its smaller sizes (for the light around each point)
    this.btex = tex(); this.B = 256;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.B, this.B, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.btex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(main);
    this.u = {}; for (const k of ['px', 'tex', 'blur', ...KEYS]) this.u[k] = gl.getUniformLocation(main, k);
    this.cu = gl.getUniformLocation(copy, 'tex');
    this.main = main; this.copy = copy;
    this.gl = gl; this.ok = true;
  }
  // The graded picture of a video frame (or image) at w x h, or null when it cannot be done.
  render(source, w, h, look) {
    if (this.ok === null) this._init();
    if (!this.ok) return null;
    const gl = this.gl, c = this.canvas;
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { return null; }
    const p = lookParams(look);
    // the light around each point: the frame made small, with its smaller sizes
    gl.useProgram(this.copy); gl.uniform1i(this.cu, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.B, this.B);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.btex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.main);
    gl.uniform1i(this.u.tex, 0); gl.uniform1i(this.u.blur, 1);
    gl.viewport(0, 0, w, h);
    // (one pixel of the picture as it comes in)
    const sw = source.videoWidth || source.width || w, shh = source.videoHeight || source.height || h;
    gl.uniform2f(this.u.px, 1 / sw, 1 / shh);
    for (const k of KEYS) gl.uniform1f(this.u[k], p[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return c;
  }
}

// ---- Auto: what the video needs, from a few of its frames
// frames: canvases (or images) of the video at a few moments; returns adjustments (KEYS)
export function autoLook(frames) {
  const W = 96, H = 96;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const lum = [], hist = new Float64Array(256);
  let sr = 0, sg = 0, sb = 0, nW = 0, noise = 0, nN = 0, satSum = 0;
  for (const f of frames) {
    g.drawImage(f, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      hist[Math.round(l)]++; lum.push(l);
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      satSum += mx ? (mx - mn) / mx : 0;
      // white balance from what is neither black, nor bright, nor strongly coloured (grey world)
      if (l > 30 && l < 235 && mx - mn < 60) { sr += r; sg += gg; sb += b; nW++; }
      // noise: the small differences between neighbours in flat parts
      if (x > 0 && y > 0 && x < W - 1) {
        const j = i - 4, k = i - W * 4;
        const dx = Math.abs(l - (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2])), dy = Math.abs(l - (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]));
        if (dx < 12 && dy < 12) { noise += dx + dy; nN++; }
      }
    }
  }
  const n = lum.length; if (!n) return {};
  const pct = (q) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * n) return v; } return 255; };
  const p1 = pct(0.01), p5 = pct(0.05), p25 = pct(0.25), p50 = pct(0.5), p75 = pct(0.75), p95 = pct(0.95), p99 = pct(0.995);
  const out = {};
  // exposure: the middle of the picture towards a pleasant middle (darker scenes stay a bit darker)
  const target = 118;
  // (the black point found below comes first: the middle as it will be after it)
  const bp = p1 > 14 ? Math.min(51, p1 - 10) : 0;
  // (a dark suit or a black piano is dark, and stays so: the middle and the brighter half together)
  const key = 0.5 * p50 + 0.5 * p75;
  const mid = (key - bp) / (1 - bp / 255);
  out.light = Math.max(-0.6, Math.min(1.0, Math.log2(128 / Math.max(18, mid)) * 0.8));
  // shadows and highlights: lifted where the dark part is crushed, held back where the bright clips
  out.shadows = Math.max(0, Math.min(0.4, Math.max((40 - p5) / 70, (70 - (p25 - bp)) / 140)));
  out.highlights = Math.max(0, Math.min(0.7, (p99 - 235) / 25));
  // contrast: a flat (foggy, dim) picture gets more, an already hard one a little less
  const spread = p95 - p5;
  out.contrast = Math.max(-0.12, Math.min(0.25, (150 - spread) / 400));
  // black point: a grey veil (nothing really dark) goes
  // white balance
  if (nW > n * 0.05) {
    // (in light: the greys made grey, most of the way, so a warm room stays a little warm)
    const lin = (v) => Math.pow(v / 255, 2.2);
    const ar = lin(sr / nW), ag = lin(sg / nW), ab = lin(sb / nW);
    out.wbr = Math.max(-0.4, Math.min(0.6, (ag / Math.max(1e-3, ar) - 1) * 0.8));
    out.wbb = Math.max(-0.4, Math.min(0.6, (ag / Math.max(1e-3, ab) - 1) * 0.8));
  }
  // black point
  if (p1 > 14) out.black = Math.min(0.2, (p1 - 10) / 255);
  // colour: dull pictures a little richer
  const sat = satSum / n;
  out.colour = Math.max(0, Math.min(0.25, (0.3 - sat) * 0.8));
  // noise and detail
  const nz = nN ? noise / nN : 0;
  out.denoise = Math.max(0, Math.min(0.8, (nz - 2.2) / 4));
  out.sharp = Math.max(0.05, 0.22 - out.denoise * 0.25);
  out.clarity = 0.08;
  for (const k of Object.keys(out)) out[k] = +out[k].toFixed(3);
  return out;
}
