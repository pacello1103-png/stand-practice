// The lines of music of a page, from what the reader found: where each line is, its bars (the
// places it can be cut), as parts of the page (0..1). Used by Capture (picker.js and its thread).
export function linesOf(A) {
  const lines = [];
  const W = A.w, H = A.h;
  for (const sys of A.systems || []) {
    const sts = sys.map((i) => A.staves[i]);
    const s0 = sts[0], sp = s0.sp;
    const top = Math.min(...sts.map((q) => q.top)), bot = Math.max(...sts.map((q) => q.bottom));
    const x0 = Math.max(0, Math.min(...sts.map((q) => q.x0)) - sp * 0.6), x1 = Math.min(W, Math.max(...sts.map((q) => q.x1)) + sp * 0.6);
    const heads = s0.heads || [];
    const firstHead = heads.length ? Math.min(...heads.map((q) => q.x)) : s0.x0 + sp * 5;
    const headEnd = Math.max(s0.x0 + sp * 2.5, firstHead - sp * 1.0);
    const bars = (s0.bars || []).map((b) => b.x).filter((x) => x > headEnd + sp && x < s0.x1 - sp * 1.2).sort((a, b) => a - b);
    lines.push({ y0: top - sp * 4.2, y1: bot + sp * 4.2, top, bot, x0, x1, headEnd, cuts: [headEnd, ...bars, s0.x1], W, H, sp });
  }
  // neighbouring lines share the white space between them
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) lines[i].y0 = Math.max(lines[i].y0, (lines[i - 1].bot + lines[i].top) / 2);
    if (i < lines.length - 1) lines[i].y1 = Math.min(lines[i].y1, (lines[i].bot + lines[i + 1].top) / 2);
  }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    lines[i] = { y0: Math.max(0, L.y0) / H, y1: Math.min(H, L.y1) / H, x0: L.x0 / W, x1: L.x1 / W, cuts: L.cuts.map((x) => x / W), top: L.top / H, bot: L.bot / H, sp: L.sp / H };
  }
  return lines;
}

// only real lines of music: as wide as the others (a first line may be set in a little), staves of
// the size of the page's own
export function cleanLines(lines) {
  const ok = (lines || []).filter((L) => L && L.x1 > L.x0 && L.y1 > L.y0);
  if (!ok.length) return [];
  const wmax = Math.max(...ok.map((L) => L.x1 - L.x0));
  const sps = ok.map((L) => L.sp || 0).filter((x) => x > 0).sort((a, b) => a - b), sp = sps.length ? sps[sps.length >> 1] : 0;
  return ok.filter((L) => (L.x1 - L.x0) >= wmax * 0.45 && (!sp || !L.sp || (L.sp > sp * 0.65 && L.sp < sp * 1.5))).map((L) => {
    const s = L.sp || 0.01;
    // (tight around the staves: what is above and below them, not the next line's notes)
    const y0 = L.top !== undefined ? Math.max(L.y0, L.top - s * 3.4) : L.y0, y1 = L.bot !== undefined ? Math.min(L.y1, L.bot + s * 3.4) : L.y1;
    return { x0: Math.max(0, L.x0 - 0.008), x1: Math.min(1, L.x1 + 0.008), y0: Math.max(0, y0), y1: Math.min(1, y1) };
  });
}
