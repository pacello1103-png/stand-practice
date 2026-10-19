// Backups: everything in Stand (scores, markings, compositions, recordings, practice log and
// settings) as files you keep in iCloud Drive, so nothing is lost if the app is deleted or the
// iPad is replaced. A big library is split into several files of about 40 MB, because each one
// goes through the share sheet; restoring takes all the files of one backup at once.
//
// File layout (STANDBK2): 'STANDBK2', u32 header length, header JSON, then the bytes of its pieces.
// The header of file 1 also carries the library itself (with binaries replaced by keys).
import { db } from './db.js';

const PART = 40 * 1024 * 1024;
const enc = new TextEncoder();

// The library as JSON plus a list of binaries (Blob / ArrayBuffer / Float32Array).
async function collect(withTakes) {
  const bins = [];
  const pack = (v) => {
    if (v instanceof Blob) { bins.push(v); return { $bin: 'b' + (bins.length - 1), $t: 'blob', mime: v.type, n: v.size }; }
    if (v instanceof ArrayBuffer) { bins.push(new Blob([v])); return { $bin: 'b' + (bins.length - 1), $t: 'ab', n: v.byteLength }; }
    if (ArrayBuffer.isView(v)) {
      const t = v instanceof Float32Array ? 'f32' : v instanceof Uint8Array ? 'u8' : v instanceof Int16Array ? 'i16' : 'u8';
      bins.push(new Blob([v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)]));
      return { $bin: 'b' + (bins.length - 1), $t: t, n: v.byteLength };
    }
    if (Array.isArray(v)) return v.map(pack);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = pack(x); return o; }
    return v;
  };
  let files = await db.all('files');
  const takes = withTakes ? await db.all('takes') : [];
  if (!withTakes) files = files.filter((f) => !/^(audio|video):/.test(String(f.id)));
  const lib = pack({ v: 2, made: Date.now(), scores: await db.all('scores'), files, ink: await db.all('ink'), takes, kv: await db.all('kv') });
  return { lib, bins };
}

// How big a backup would be, with and without recordings.
export async function backupSizes() {
  let all = 0, rec = 0;
  for (const f of await db.all('files')) {
    const n = sizeOf(f.data);
    all += n; if (/^(audio|video):/.test(String(f.id))) rec += n;
  }
  return { essentials: all - rec, recordings: rec };
}
function sizeOf(v) {
  if (!v) return 0;
  if (v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (Array.isArray(v)) return v.reduce((s, x) => s + sizeOf(x), 0);
  if (typeof v === 'object') return Object.values(v).reduce((s, x) => s + sizeOf(x), 0);
  if (typeof v === 'string') return v.length;
  return 8;
}

// Build the backup: a list of { blob, name, size }.
export async function makeBackup(withTakes, stamp) {
  const { lib, bins } = await collect(withTakes);
  const set = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // lay the binaries out in pieces of at most PART bytes
  const vols = [[]]; let room = PART - enc.encode(JSON.stringify(lib)).length - 4096;
  bins.forEach((b, i) => {
    let off = 0;
    while (off < b.size || (b.size === 0 && off === 0)) {
      if (room <= 0) { vols.push([]); room = PART; }
      const n = Math.min(b.size - off, room);
      vols[vols.length - 1].push({ key: 'b' + i, off, n, blob: b });
      off += n; room -= n;
      if (b.size === 0) break;
    }
  });
  const count = vols.length;
  return vols.map((pieces, k) => {
    const head = { magic: 'stand', set, index: k, count, made: Date.now(), entries: pieces.map((p) => [p.key, p.off, p.n]) };
    if (k === 0) head.lib = lib;
    const hj = enc.encode(JSON.stringify(head));
    const pre = new Uint8Array(12); pre.set(enc.encode('STANDBK2')); new DataView(pre.buffer).setUint32(8, hj.length, true);
    const blob = new Blob([pre, hj, ...pieces.map((p) => p.blob.slice(p.off, p.off + p.n))], { type: 'application/octet-stream' });
    const name = `Stand backup ${stamp}${count > 1 ? ` (${k + 1} of ${count})` : ''}.standbackup`;
    return { blob, name, size: blob.size };
  });
}

// Restore from the chosen files. Returns { scores, takes, missing, sets }.
export async function restoreBackup(fileList) {
  const files = [...fileList];
  const heads = [];
  for (const f of files) {
    const pre = await f.slice(0, 12).arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(pre, 0, 8));
    if (magic === 'STANDBK1') { const r = await restoreV1(f); heads.push({ v1: r }); continue; }
    if (magic !== 'STANDBK2') continue;
    const hl = new DataView(pre).getUint32(8, true);
    const head = JSON.parse(await f.slice(12, 12 + hl).text());
    head.file = f; head.base = 12 + hl;
    heads.push(head);
  }
  if (!heads.length) throw new Error('These are not Stand backup files.');
  let scores = 0, takes = 0;
  const missing = [];
  for (const h of heads) if (h.v1) { scores += h.v1.scores; takes += h.v1.takes; }
  // the newest complete backup set wins; others are restored too if complete
  const sets = new Map();
  for (const h of heads) if (!h.v1) { if (!sets.has(h.set)) sets.set(h.set, []); sets.get(h.set).push(h); }
  for (const [, hs] of [...sets.entries()].sort((a, b) => a[1][0].made - b[1][0].made)) {
    const count = hs[0].count;
    const have = new Set(hs.map((h) => h.index));
    const first = hs.find((h) => h.index === 0);
    const lack = []; for (let i = 0; i < count; i++) if (!have.has(i)) lack.push(i + 1);
    if (!first) { missing.push({ count, lack }); continue; }
    // where each piece of each binary is
    const where = new Map();
    for (const h of hs) {
      let o = h.base;
      for (const [key, off, n] of h.entries) { if (!where.has(key)) where.set(key, []); where.get(key).push({ off, n, file: h.file, at: o }); o += n; }
    }
    const unpack = async (v) => {
      if (v && typeof v === 'object' && '$bin' in v) {
        const ps = (where.get(v.$bin) || []).sort((a, b) => a.off - b.off);
        const got = ps.reduce((s, p) => s + p.n, 0);
        if (got < (v.n || 0)) return undefined;                      // that part of the backup was not chosen
        const blob = new Blob(ps.map((p) => p.file.slice(p.at, p.at + p.n)), { type: v.mime || '' });
        if (v.$t === 'blob') return blob;
        const ab = await blob.arrayBuffer();
        return v.$t === 'f32' ? new Float32Array(ab) : v.$t === 'i16' ? new Int16Array(ab) : v.$t === 'u8' ? new Uint8Array(ab) : ab;
      }
      if (Array.isArray(v)) { const r = []; for (const x of v) r.push(await unpack(x)); return r; }
      if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = await unpack(x); return r; }
      return v;
    };
    const lib = first.lib;
    const okFiles = new Set();
    for (const f of lib.files) {
      const r = await unpack(f);
      if (r.data === undefined && f.data !== undefined) continue;
      await db.put('files', r); okFiles.add(r.id);
    }
    for (const s of lib.scores) if (!s.fileId || okFiles.has(s.fileId) || await db.get('files', s.fileId)) { await db.put('scores', await unpack(s)); scores++; }
    for (const i of lib.ink) await db.put('ink', await unpack(i));
    for (const t of lib.takes) if (okFiles.has('audio:' + t.id) || okFiles.has('video:' + t.id)) { await db.put('takes', await unpack(t)); takes++; }
    for (const k of lib.kv) await db.put('kv', await unpack(k));
    if (lack.length) missing.push({ count, lack });
  }
  return { scores, takes, missing };
}

// Backups made by Stand 2.3 and earlier: one file.
async function restoreV1(file) {
  const head = await file.slice(0, 12).arrayBuffer();
  const jl = new DataView(head).getUint32(8, true);
  const data = JSON.parse(await file.slice(12, 12 + jl).text());
  let o = 12 + jl;
  const n = new DataView(await file.slice(o, o + 4).arrayBuffer()).getUint32(0, true); o += 4;
  const lv = new DataView(await file.slice(o, o + 4 * n).arrayBuffer()); o += 4 * n;
  const spans = []; for (let i = 0; i < n; i++) { const L = lv.getUint32(i * 4, true); spans.push([o, o + L]); o += L; }
  const unpack = async (v) => {
    if (v && typeof v === 'object' && '$bin' in v) {
      const [x0, x1] = spans[v.$bin];
      if (v.$t === 'blob') return file.slice(x0, x1, v.mime || '');
      const ab = await file.slice(x0, x1).arrayBuffer();
      return v.$t === 'f32' ? new Float32Array(ab) : ab;
    }
    if (Array.isArray(v)) { const r = []; for (const x of v) r.push(await unpack(x)); return r; }
    if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = await unpack(x); return r; }
    return v;
  };
  for (const f of data.files) await db.put('files', await unpack(f));
  for (const s of data.scores) await db.put('scores', await unpack(s));
  for (const i of data.ink) await db.put('ink', await unpack(i));
  for (const t of data.takes) await db.put('takes', await unpack(t));
  for (const k of data.kv) await db.put('kv', await unpack(k));
  return { scores: data.scores.length, takes: data.takes.length };
}

// When something was last added or used (to know whether a new backup is worth it).
export async function lastChange() {
  let t = 0;
  for (const s of await db.all('scores')) t = Math.max(t, s.added || 0, s.opened || 0, s.edited || 0);
  for (const k of await db.all('takes')) t = Math.max(t, k.created || 0);
  return t;
}
