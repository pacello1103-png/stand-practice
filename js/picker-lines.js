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
  let ok = (lines || []).filter((L) => L && L.x1 > L.x0 && L.y1 > L.y0).sort((a, b) => a.y0 - b.y0);
  if (!ok.length) return [];
  // the staves played together (a violin over its piano, a quartet): one line, even where no bar
  // line joins them. Staves closer to each other than the lines of music are to each other belong
  // together.
  if (ok.length >= 2 && ok.every((L) => L.top !== undefined && L.sp)) {
    // (a staff this close to the next one, much closer than the lines of music are to each other,
    // and closer than about one and a half staves: they are played together)
    const gaps = ok.slice(1).map((L, i) => L.top - ok[i].bot), gmax = Math.max(...gaps);
    const out = [{ ...ok[0] }];
    gaps.forEach((g, i) => {
      const L = ok[i + 1], cur = out[out.length - 1], staff = Math.min(4 * cur.sp, 4 * L.sp);
      if (g < gmax * 0.4 && g < staff * 1.6) Object.assign(cur, { x0: Math.min(cur.x0, L.x0), x1: Math.max(cur.x1, L.x1), y1: L.y1, bot: L.bot, sp: Math.max(cur.sp, L.sp) });
      else out.push({ ...L });
    });
    ok = out;
  }
  const wmax = Math.max(...ok.map((L) => L.x1 - L.x0));
  const sps = ok.map((L) => L.sp || 0).filter((x) => x > 0).sort((a, b) => a - b), sp = sps.length ? sps[sps.length >> 1] : 0;
  const kept = ok.filter((L) => (L.x1 - L.x0) >= wmax * 0.45 && (!sp || !L.sp || (L.sp > sp * 0.65 && L.sp < sp * 1.5)));
  return kept.map((L, i) => {
    const s = L.sp || 0.01;
    // (tight around the staves: what is above and below them, not the next line's notes; above the
    // first line of a page (a title, a composer) and below the last (a footnote), tighter still)
    const up = i === 0 ? 3.0 : 4.2, down = i === kept.length - 1 ? 2.8 : 3.6;
    const y0 = L.top !== undefined ? Math.max(L.y0, L.top - s * up) : L.y0, y1 = L.bot !== undefined ? Math.min(L.y1, L.bot + s * down) : L.y1;
    return { x0: Math.max(0, L.x0 - 0.008), x1: Math.min(1, L.x1 + 0.008), y0: Math.max(0, y0), y1: Math.min(1, y1), ...(L.top !== undefined ? { top: L.top, bot: L.bot, sp: s } : {}) };
  });
}

// Each line's top and bottom edges, in pixels of a page drawn W x H, moved onto clean paper: a word
// or a note that the edge would cut through (a tempo above, a high note of the next line below) is
// either taken in whole or left out whole. g: the page's 2d context.
export function cleanEdges(g, W, H, lines) {
  // (ink: anything clearly darker than the paper, the grey staff lines of some editions too)
  const inkRow = (y, x0, w) => { if (y < 0 || y >= H) return false; const d = g.getImageData(x0, y, w, 1).data; for (let q = 0; q < d.length; q += 4) if (d[q] + d[q + 1] + d[q + 2] < 480) return true; return false; };
  const edges = lines.map((L) => ({ sx: Math.max(0, Math.round(L.x0 * W)), sw: Math.max(1, Math.min(W, Math.round(L.x1 * W)) - Math.max(0, Math.round(L.x0 * W))), a: Math.round(L.y0 * H), b: Math.min(H - 1, Math.round(L.y1 * H)) }));
  // (an edge moved inwards never comes into the staff itself: a line is never cut through)
  const staffTop = (k) => { const L = lines[k]; return L.top !== undefined ? Math.round((L.top - (L.sp || 0) * 1.2) * H) : H; };
  const staffBot = (k) => { const L = lines[k]; return L.bot !== undefined ? Math.round((L.bot + (L.sp || 0) * 1.2) * H) : 0; };
  edges.forEach((E, k) => {
    const reach = Math.round(H * 0.035);
    const upLimit = k > 0 ? edges[k - 1].b : 0, downLimit = k < edges.length - 1 ? edges[k + 1].a : H - 1;
    if (inkRow(E.a, E.sx, E.sw)) {
      let y = E.a; while (y > Math.max(upLimit, E.a - reach) && inkRow(y, E.sx, E.sw)) y--;
      if (!inkRow(y, E.sx, E.sw)) E.a = y; else { y = E.a; const stop = Math.min(E.a + Math.round((E.b - E.a) * 0.3), staffTop(k)); while (y < stop && inkRow(y, E.sx, E.sw)) y++; if (!inkRow(y, E.sx, E.sw)) E.a = y; }
    }
    if (inkRow(E.b, E.sx, E.sw)) {
      let y = E.b; while (y < Math.min(downLimit, E.b + reach) && inkRow(y, E.sx, E.sw)) y++;
      if (!inkRow(y, E.sx, E.sw)) E.b = y; else { y = E.b; const stop = Math.max(E.b - Math.round((E.b - E.a) * 0.3), staffBot(k)); while (y > stop && inkRow(y, E.sx, E.sw)) y--; if (!inkRow(y, E.sx, E.sw)) E.b = y; }
    }
  });
  return edges;
}

// What reaches into a line from beyond its edge (the stems of the next line's high notes, the tail of
// the line above) is taken away: at each edge, ink that goes on past it is wiped back to the paper.
// crop: the line's own 2d context (sw x sh), drawn from the page at (sx, sy); page: the page's context.
export function eraseCrossings(crop, sw, sh, page, sx, sy, H) {
  const dark = (d, i) => d[i] + d[i + 1] + d[i + 2] < 600;
  const img = crop.getImageData(0, 0, sw, sh), d = img.data;
  const out = (y) => (y >= 0 && y < H ? page.getImageData(sx, y, sw, 1).data : null);
  const below = out(sy + sh), above = out(sy - 1);
  let changed = false;
  for (const [edge, beyond, dir] of [[sh - 1, below, -1], [0, above, 1]]) {
    if (!beyond) continue;
    for (let x = 0; x < sw; x++) {
      if (!dark(beyond, x * 4) || !dark(d, (edge * sw + x) * 4)) continue;
      // (the run of ink from the edge inwards, at most a fifth of the line's height)
      // (only the thin part, a stem's end: where it meets something wider, a note head or a beam of
      // this line, it stops, and that is kept)
      const wide = (yy) => { let a = x, b = x; while (a > 0 && x - a < 8 && dark(d, (yy * sw + a - 1) * 4)) a--; while (b < sw - 1 && b - x < 8 && dark(d, (yy * sw + b + 1) * 4)) b++; return b - a + 1 > Math.max(6, sw * 0.004); };
      let y = edge, n = 0; const lim = Math.round(sh * 0.2);
      while (y >= 0 && y < sh && n < lim && dark(d, (y * sw + x) * 4) && !wide(y)) { y += dir; n++; }
      // (a long run, or one that ends in a note head or a beam inside: this line's own, kept; only a
      // thin end that stops on the paper inside belongs to the line beyond)
      if (n >= lim || n === 0 || (y >= 0 && y < sh && dark(d, (y * sw + x) * 4))) continue;
      for (let k = 0, yy = edge; k < n; k++, yy += dir) { for (const xx of [x - 2, x - 1, x, x + 1, x + 2]) { if (xx < 0 || xx >= sw || yy < 0 || yy >= sh) continue; const i = (yy * sw + xx) * 4; d[i] = d[i + 1] = d[i + 2] = 255; } }
      changed = true;
    }
  }
  if (changed) crop.putImageData(img, 0, 0);
}
