// The look of a video, as a photo editor would set it: light, contrast, warmth, colour,
// sharpness, a soft vignette and gentle highlight and shadow recovery. Done on the graphics chip
// (WebGL), so it runs on every frame while playing and while exporting.

export const LOOKS = {
  natural: { label: 'Natural' },
  bright: { label: 'Bright', light: 0.28, contrast: 0.05, shadows: 0.25, colour: 0.05 },
  warm: { label: 'Warm', warmth: 0.45, colour: 0.08, contrast: 0.06, light: 0.05 },
  studio: { label: 'Studio', contrast: 0.16, colour: 0.06, sharp: 0.45, vignette: 0.3, highlights: 0.25 },
  soft: { label: 'Soft', contrast: -0.12, shadows: 0.2, highlights: 0.3, sharp: -0.2, warmth: 0.12 },
  film: { label: 'Film', contrast: 0.05, fade: 0.08, colour: -0.18, warmth: 0.18, vignette: 0.25 },
  cool: { label: 'Cool', warmth: -0.35, contrast: 0.08, colour: 0.05 },
  mono: { label: 'Black and white', colour: -1, contrast: 0.18, sharp: 0.25, vignette: 0.2 },
};
const KEYS = ['light', 'contrast', 'warmth', 'colour', 'sharp', 'vignette', 'shadows', 'highlights', 'fade'];
// the settings of a look, with the person's own adjustments on top
export function lookParams(look) {
  const base = LOOKS[(look && look.preset) || 'natural'] || LOOKS.natural;
  const out = {};
  for (const k of KEYS) out[k] = (base[k] || 0) + ((look && look.adj && look.adj[k]) || 0);
  return out;
}
export function isNeutral(look) { const p = lookParams(look); return KEYS.every((k) => Math.abs(p[k]) < 1e-3); }

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0.0,1.0); }`;
const FS = `precision mediump float;
varying vec2 uv; uniform sampler2D tex; uniform vec2 px;
uniform float light, contrast, warmth, colour, sharp, vignette, shadows, highlights, fade;
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec3 c = texture2D(tex, uv).rgb;
  if (sharp != 0.0) {
    vec3 b = (texture2D(tex, uv+vec2(px.x,0.0)).rgb + texture2D(tex, uv-vec2(px.x,0.0)).rgb + texture2D(tex, uv+vec2(0.0,px.y)).rgb + texture2D(tex, uv-vec2(0.0,px.y)).rgb) * 0.25;
    c = clamp(c + (c - b) * sharp * 1.6, 0.0, 1.0);
  }
  c *= pow(2.0, light);
  float l = luma(c);
  // shadows up, highlights down, smoothly
  c += c * shadows * 0.6 * (1.0 - smoothstep(0.0, 0.5, l));
  c -= c * highlights * 0.25 * smoothstep(0.55, 1.0, l);
  // contrast as a soft S around the middle
  c = (c - 0.5) * (1.0 + contrast) + 0.5;
  // warmth: towards amber or towards blue
  c.r += warmth * 0.07; c.b -= warmth * 0.07; c.g += warmth * 0.012;
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + colour);
  c = mix(c, vec3(0.5) * 0.25 + c * 0.75, fade * 2.0);
  vec2 d = uv - 0.5; float v = 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  gl_FragColor = vec4(clamp(c * v, 0.0, 1.0), 1.0);
}`;

export class Grader {
  constructor() { this.canvas = document.createElement('canvas'); this.ok = null; }
  _init() {
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) || this.canvas.getContext('experimental-webgl');
    if (!gl) { this.ok = false; return; }
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.ok = false; return; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.u = {}; for (const k of ['px', ...KEYS]) this.u[k] = gl.getUniformLocation(pr, k);
    this.gl = gl; this.ok = true;
  }
  // The graded picture of a video frame (or image) at w x h, or null when it cannot be done.
  render(source, w, h, look) {
    if (this.ok === null) this._init();
    if (!this.ok) return null;
    const gl = this.gl, c = this.canvas;
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch { return null; }
    const p = lookParams(look);
    gl.uniform2f(this.u.px, 1 / w, 1 / h);
    for (const k of KEYS) gl.uniform1f(this.u[k], p[k]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return c;
  }
}
