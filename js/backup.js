// Backups: everything in Stand (scores, markings, compositions, recordings, practice log and
// settings) as files you keep in iCloud Drive, so nothing is lost if the app is deleted or the
// iPad is replaced. A big library is split into several files of about 40 MB, because each one
// goes through the share sheet; restoring takes all the files of one backup at once.
//
// File layout (STANDBK2): 'STANDBK2', u32 header length, header JSON, then the bytes of its pieces.
// The header of file 1 also carries the library itself (with binaries replaced by keys).
import { db } from './db.js';

// Restoring adds to what is here, never wipes what was done since the backup: markings on a page
// are put together (the same ones once), the practice log keeps the larger of each figure, and
// what belongs to this device only (the iPhone's downloads and folders) is left as it is.
async function putInkMerged(rec) {
  const cur = await db.get('ink', rec.key).catch(() => null);
  if (!cur || !cur.items || !cur.items.length) { await db.put('ink', rec); return; }
  const seen = new Set(cur.items.map((x) => JSON.stringify(x)));
  const items = [...cur.items, ...(rec.items || rec.strokes || []).filter((x) => !seen.has(JSON.stringify(x)))];
  await db.put('ink', { ...cur, items });
}
const LOCAL_KV = new Set(['ipadRemoved', 'ipadOrg', 'ipadScores', 'mirrorState', 'folderPdfs']);
// (what the folder backup keeps of itself: not part of the library)
const MIRROR_LOCAL = new Set(['mirrorState', 'folderPdfs']);
const maxMerge = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = k in a ? maxMerge(a[k], v) : v; return o; }
  return a ?? b;
};
async function putKvMerged(rec) {
  if (LOCAL_KV.has(rec.k)) return;
  if (rec.k === 'log' || rec.k === 'log2' || rec.k === 'slots') {
    const cur = await db.get('kv', rec.k).catch(() => null);
    if (cur && cur.v) { await db.put('kv', { k: rec.k, v: maxMerge(cur.v, rec.v) }); return; }
  }
  await db.put('kv', rec);
}

const PART = 95 * 1024 * 1024;   // each file stays small enough for the share sheet
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
  let files = (await db.all('files')).filter((f) => !/^(ipadcopy|follow):/.test(String(f.id)));
  const takes = withTakes ? await db.all('takes') : [];
  if (!withTakes) files = files.filter((f) => !/^(audio|video):/.test(String(f.id)));
  const lib = pack({ v: 2, made: Date.now(), scores: await db.all('scores'), files, ink: await db.all('ink'), takes, kv: await db.all('kv') });
  return { lib, bins };
}

// How big a backup would be, with and without recordings.
export async function backupSizes() {
  let all = 0, rec = 0;
  for (const f of await db.all('files')) {
    if (/^(ipadcopy|follow):/.test(String(f.id))) continue;   // (copies and readings made again by themselves)
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

// ---------- backups as tidy folders (Stand 2.10 and later) ----------
// Each backup is a .zip that opens in Files as a folder:
//   Scores/<library folder>/<Composer> - <Title>.pdf   your scores, as ordinary PDFs
//   Scores/<...>/<Title>/01.jpg …                      scanned pages
//   Recordings/<date> <name>.wav / .mp4                your recordings
//   Stand data/…                                       markings, notebooks, compositions, settings
//   Read me.txt
// Stand restores everything from it; the PDFs and recordings are also there to open by hand.
// A big library is split into several zips of about 40 MB (each one goes through the share sheet).
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8, c = 0xFFFFFFFF) { for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return c; }
const safeName = (s, max = 80) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '') || 'Untitled';
const dosTime = (d) => [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF];
// a zip with no compression (PDFs, JPEGs and videos are already compressed)
async function makeZip(entries) {
  const parts = [], central = []; let off = 0;
  const [tm, dt] = dosTime(new Date());
  for (const e of entries) {
    const name = enc.encode(e.path);
    const blob = e.blob instanceof Blob ? e.blob : new Blob([e.blob]);
    let c = 0xFFFFFFFF;
    for (let o = 0; o < blob.size; o += 8 << 20) c = crc32(new Uint8Array(await blob.slice(o, o + (8 << 20)).arrayBuffer()), c);
    const crc = (c ^ 0xFFFFFFFF) >>> 0, size = blob.size;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(ch.buffer, name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, x) => n + (x.byteLength ?? x.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
// the entries of a zip: name -> { at, size } (stored entries only, as Stand writes them)
async function readZip(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const n = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = new Map(); let p = 0;
  const dec = new TextDecoder();
  for (let k = 0; k < n && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), size = cd.getUint32(p + 20, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), lo = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    const lh = new DataView(await file.slice(lo, lo + 30).arrayBuffer());
    const at = lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    if (method === 0) out.set(name, { at, size });
    p += 46 + nl + xl + cl;
  }
  return out;
}
// 16-bit WAV, so a recording plays anywhere
function wavOf(f32, sr) {
  const n = f32.length, b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i])) * 32767, true);
  return new Blob([b.buffer], { type: 'audio/wav' });
}
async function f32OfWav(blob) {
  const ab = await blob.arrayBuffer(), d = new DataView(ab);
  let o = 12, at = 44, len = (ab.byteLength - 44) >> 1;
  while (o + 8 <= ab.byteLength) { const id = String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3)); const sz = d.getUint32(o + 4, true); if (id === 'data') { at = o + 8; len = sz >> 1; break; } o += 8 + sz + (sz & 1); }
  const out = new Float32Array(len); for (let i = 0; i < len; i++) out[i] = d.getInt16(at + i * 2, true) / 32767;
  return out;
}

// what: 'library' (scores, markings, compositions, notebooks, practice, settings) or 'recordings'
// (the recordings given in takeIds). Each makes its own set of files, with names that say what
// they are: "Stand – Library – 24 Oct 2026.zip", "Stand – Recordings – 24 Oct 2026 (1 of 2).zip".
export async function makeBackupSet(what, stamp, folders = [], takeIds = null) {
  return makeFolderBackup(what === 'recordings', stamp, folders, { only: what, takeIds });
}
export async function makeFolderBackup(withTakes, stamp, folders = [], opt = {}) {
  const bins = [];   // { path, blob, $t, mime, n, wav? }
  const used = new Set();
  const uniq = (p) => { let q = p, k = 2; const dot = p.lastIndexOf('.'); while (used.has(q.toLowerCase())) q = dot > p.lastIndexOf('/') ? `${p.slice(0, dot)} (${k++})${p.slice(dot)}` : `${p} (${k++})`; used.add(q.toLowerCase()); return q; };
  const recOnly = opt.only === 'recordings';
  const scores = recOnly ? [] : await db.all('scores');
  let files = (await db.all('files')).filter((f) => !/^(ipadcopy|follow):/.test(String(f.id)));
  let takes = withTakes ? await db.all('takes') : [];
  if (opt.takeIds) { const want = new Set(opt.takeIds); takes = takes.filter((t) => want.has(t.id)); }
  if (recOnly) { const ids = new Set(takes.flatMap((t) => ['audio:' + t.id, 'video:' + t.id])); files = files.filter((f) => ids.has(String(f.id))); }
  else if (!withTakes) files = files.filter((f) => !/^(audio|video):/.test(String(f.id)));
  const folderName = (id) => { const f = folders.find((x) => x.id === id); return f ? safeName(f.name, 60) + '/' : ''; };
  // a readable place for each file people would want to open by hand
  const nice = new Map();
  for (const s of scores) {
    if (!s.fileId || s.kind === 'paper' || s.kind === 'comp') continue;
    const base = 'Scores/' + folderName(s.folder) + safeName((s.composer ? s.composer + ' - ' : '') + s.title, 110);
    nice.set(s.fileId, base);
  }
  for (const t of takes) {
    const d = new Date(t.created || Date.now());
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const base = 'Recordings/' + safeName(day + ' ' + (t.name || (t.kind === 'video' ? 'Video' : 'Recording')), 110);
    if (t.kind === 'video') nice.set('video:' + t.id, base); else nice.set('audio:' + t.id, base);
    nice.set('audio:' + t.id + ':sr', t.sr || 48000);
  }
  let cur = null;   // the file being packed (for its readable name)
  const pack = (v, key) => {
    const at = (ext, i) => { const b = nice.get(cur); if (!b) return null; return i === undefined ? b + ext : `${b}/${String(i + 1).padStart(2, '0')}${ext}`; };
    if (v instanceof Blob) {
      let path = null;
      if (key && key.startsWith('img:')) path = at(/png/.test(v.type) ? '.png' : '.jpg', +key.slice(4));
      else if (key === 'data' && String(cur).startsWith('video:')) path = at(/quicktime/.test(v.type) ? '.mov' : /webm/.test(v.type) ? '.webm' : '.mp4');
      else if (key === 'data') path = at(/pdf/.test(v.type) ? '.pdf' : '');
      const p = uniq(path || 'Stand data/files/' + bins.length);
      bins.push({ path: p, blob: v }); return { $path: p, $t: 'blob', mime: v.type, n: v.size };
    }
    if (v instanceof ArrayBuffer) {
      const isPdf = key === 'data' && nice.has(cur) && v.byteLength > 4 && new TextDecoder().decode(new Uint8Array(v, 0, 4)) === '%PDF';
      const p = uniq(isPdf ? at('.pdf') : 'Stand data/files/' + bins.length);
      bins.push({ path: p, blob: new Blob([v], isPdf ? { type: 'application/pdf' } : {}) }); return { $path: p, $t: 'ab', n: v.byteLength };
    }
    if (ArrayBuffer.isView(v)) {
      const t = v instanceof Float32Array ? 'f32' : v instanceof Int16Array ? 'i16' : 'u8';
      if (t === 'f32' && key === 'data' && String(cur).startsWith('audio:') && nice.has(cur) && !nice.has('video:' + String(cur).slice(6))) {
        const p = uniq(at('.wav')); bins.push({ path: p, blob: wavOf(v, nice.get(cur + ':sr')) }); return { $path: p, $t: 'wav', n: v.length };
      }
      const p = uniq('Stand data/files/' + bins.length);
      bins.push({ path: p, blob: new Blob([v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)]) }); return { $path: p, $t: t, n: v.byteLength };
    }
    if (Array.isArray(v)) return v.map((x, i) => pack(x, key === 'data' ? 'img:' + i : key));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = pack(x, k); return o; }
    return v;
  };
  const pfiles = files.map((f) => { cur = f.id; const r = pack(f); cur = null; return r; });
  const lib = { v: 3, made: Date.now(), scores: pack(scores), files: pfiles, ink: recOnly ? [] : pack(await db.all('ink')), takes: pack(takes), kv: recOnly ? [] : pack(await db.all('kv')) };
  const set = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const libBlob = new Blob([JSON.stringify(lib)], { type: 'application/json' });
  // share the files out into zips of about PART bytes (a file bigger than that gets a zip of its own)
  const vols = [[]]; let room = PART - libBlob.size - 65536;
  for (const b of bins.sort((x, y) => x.path.localeCompare(y.path))) {
    if (b.blob.size > room && vols[vols.length - 1].length) { vols.push([]); room = PART; }
    vols[vols.length - 1].push(b); room -= b.blob.size + 200;
  }
  const count = vols.length;
  const kind = recOnly ? 'Recordings' : withTakes ? 'Library and recordings' : 'Library';
  const readme = (k) => new Blob([`Stand backup — ${kind} — ${stamp}${count > 1 ? ` — part ${k + 1} of ${count}` : ''}

${recOnly ? 'Recordings: your recordings (WAV sound, videos as they were filmed).' : `Scores: your scores as PDF files, in the folders of your library.
Stand data: your markings, notebooks, compositions, practice log and settings.`}

To bring everything back: in Stand open Settings › Backup › Restore from a backup, and choose ${count > 1 ? `all ${count} files of this backup` : 'this file'} (and your other Stand backup files, all together if you like).
Please do not change the files inside Stand data.
`], { type: 'text/plain' });
  const out = [];
  for (let k = 0; k < count; k++) {
    const entries = [{ path: 'Read me.txt', blob: readme(k) }, { path: 'Stand data/backup.json', blob: new Blob([JSON.stringify({ magic: 'stand', v: 3, set, index: k, count, made: Date.now() })]) }];
    if (k === 0) entries.push({ path: 'Stand data/library.json', blob: libBlob });
    for (const b of vols[k]) entries.push({ path: b.path, blob: b.blob });
    const blob = await makeZip(entries);
    out.push({ blob, kind, part: k + 1, count, name: `Stand – ${kind} – ${stamp}${count > 1 ? ` (${k + 1} of ${count})` : ''}.zip`, size: blob.size, takeIds: takes.map((t) => t.id) });
  }
  return out;
}
async function restoreZips(zips) {
  let scores = 0, takes = 0; const missing = [];
  const sets = new Map();
  for (const { file, dir } of zips) {
    const h = dir.get('Stand data/backup.json'); if (!h) continue;
    const head = JSON.parse(await file.slice(h.at, h.at + h.size).text());
    if (!sets.has(head.set)) sets.set(head.set, []);
    sets.get(head.set).push({ ...head, file, dir });
  }
  for (const [, hs] of [...sets.entries()].sort((a, b) => a[1][0].made - b[1][0].made)) {
    const count = hs[0].count, have = new Set(hs.map((h) => h.index));
    const lack = []; for (let i = 0; i < count; i++) if (!have.has(i)) lack.push(i + 1);
    const first = hs.find((h) => h.index === 0);
    if (!first) { missing.push({ count, lack }); continue; }
    const L = first.dir.get('Stand data/library.json');
    const lib = JSON.parse(await first.file.slice(L.at, L.at + L.size).text());
    const find = (p) => { for (const h of hs) { const e = h.dir.get(p); if (e) return h.file.slice(e.at, e.at + e.size); } return null; };
    const unpack = async (v) => {
      if (v && typeof v === 'object' && '$path' in v) {
        const blob = find(v.$path); if (!blob) return undefined;
        if (v.$t === 'blob') return new Blob([blob], { type: v.mime || '' });
        if (v.$t === 'wav') return f32OfWav(blob);
        const ab = await blob.arrayBuffer();
        return v.$t === 'f32' ? new Float32Array(ab) : v.$t === 'i16' ? new Int16Array(ab) : v.$t === 'u8' ? new Uint8Array(ab) : ab;
      }
      if (Array.isArray(v)) { const r = []; for (const x of v) r.push(await unpack(x)); return r; }
      if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = await unpack(x); return r; }
      return v;
    };
    const okFiles = new Set();
    for (const f of lib.files) {
      const r = await unpack(f);
      if (r.data === undefined && f.data !== undefined) continue;
      if (Array.isArray(r.data) && r.data.some((x) => x === undefined)) continue;
      await db.put('files', r); okFiles.add(r.id);
    }
    for (const s of lib.scores) if (!s.fileId || okFiles.has(s.fileId) || await db.get('files', s.fileId)) { await db.put('scores', await unpack(s)); scores++; }
    for (const i of lib.ink) await putInkMerged(await unpack(i));
    for (const t of lib.takes) if (okFiles.has('audio:' + t.id) || okFiles.has('video:' + t.id)) { await db.put('takes', await unpack(t)); takes++; }
    for (const k of lib.kv) await putKvMerged(await unpack(k));
    if (lack.length) missing.push({ count, lack });
  }
  return { scores, takes, missing };
}

// Restore from the chosen files. Returns { scores, takes, missing, sets }.
export async function restoreBackup(fileList) {
  const files = [...fileList];
  const heads = [];
  // the folder backups (zip)
  const zips = [];
  for (const f of files) {
    const sig = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    if (sig[0] === 0x50 && sig[1] === 0x4b) { const dir = await readZip(f).catch(() => null); if (dir && dir.has('Stand data/backup.json')) zips.push({ file: f, dir }); }
  }
  const zr = zips.length ? await restoreZips(zips) : null;
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
  if (!heads.length && !zr) throw new Error('These are not Stand backup files.');
  let scores = zr ? zr.scores : 0, takes = zr ? zr.takes : 0;
  const missing = zr ? [...zr.missing] : [];
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
    for (const i of lib.ink) await putInkMerged(await unpack(i));
    for (const t of lib.takes) if (okFiles.has('audio:' + t.id) || okFiles.has('video:' + t.id)) { await db.put('takes', await unpack(t)); takes++; }
    for (const k of lib.kv) await putKvMerged(await unpack(k));
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
  for (const i of data.ink) await putInkMerged(await unpack(i));
  for (const t of data.takes) await db.put('takes', await unpack(t));
  for (const k of data.kv) await putKvMerged(await unpack(k));
  return { scores: data.scores.length, takes: data.takes.length };
}

// When something was last added or used (to know whether a new backup is worth it).
export async function lastChange() {
  let t = 0;
  for (const s of await db.all('scores')) t = Math.max(t, s.added || 0, s.opened || 0, s.edited || 0);
  for (const k of await db.all('takes')) t = Math.max(t, k.created || 0);
  return t;
}

// ---------- the backup as one folder, kept up to date (Files › Stand › Backup) ----------
// Everything Stand needs to bring the library back, as files that keep their names from one backup
// to the next: Stand library.json (scores, folders, markings, notebooks, compositions, practice,
// settings) and, in files/, each score's PDF or pages and each recording. A backup writes only what
// is new or changed (the size and the start of each file tell), so it takes a moment, and nothing
// piles up: there is one backup, always the latest.
const fileTag = (id) => String(id).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80);
async function sigOf(blob) {
  const head = new Uint8Array(await blob.slice(0, 262144).arrayBuffer());
  const tail = blob.size > 262144 ? new Uint8Array(await blob.slice(Math.max(262144, blob.size - 65536)).arrayBuffer()) : new Uint8Array(0);
  return blob.size + ':' + ((crc32(tail, crc32(head)) ^ 0xFFFFFFFF) >>> 0).toString(36);
}
export async function makeMirror() {
  const bins = [];   // { path, blob }
  const scores = await db.all('scores');
  const files = (await db.all('files')).filter((f) => !/^(ipadcopy|follow):/.test(String(f.id)));
  const takes = await db.all('takes');
  const srOf = new Map(takes.map((t) => ['audio:' + t.id, t.sr || 48000]));
  let cur = null;
  const pack = (v, key) => {
    const base = 'files/' + fileTag(cur) + (key && key.startsWith('img:') ? '-' + String(+key.slice(4) + 1).padStart(3, '0') : '');
    if (v instanceof Blob) {
      const ext = /pdf/.test(v.type) ? '.pdf' : /png/.test(v.type) ? '.png' : /jpe?g/.test(v.type) ? '.jpg' : /quicktime/.test(v.type) ? '.mov' : /mp4/.test(v.type) ? '.mp4' : /webm/.test(v.type) ? '.webm' : '.bin';
      const p = base + ext; bins.push({ path: p, blob: v }); return { $path: p, $t: 'blob', mime: v.type, n: v.size };
    }
    if (v instanceof ArrayBuffer) {
      const isPdf = v.byteLength > 4 && new TextDecoder().decode(new Uint8Array(v, 0, 4)) === '%PDF';
      const p = base + (isPdf ? '.pdf' : '.bin'); bins.push({ path: p, blob: new Blob([v], isPdf ? { type: 'application/pdf' } : {}) }); return { $path: p, $t: 'ab', n: v.byteLength };
    }
    if (ArrayBuffer.isView(v)) {
      const t = v instanceof Float32Array ? 'f32' : v instanceof Int16Array ? 'i16' : 'u8';
      if (t === 'f32' && key === 'data' && String(cur).startsWith('audio:')) { const p = base + '.wav'; bins.push({ path: p, blob: wavOf(v, srOf.get(cur) || 48000) }); return { $path: p, $t: 'wav', n: v.length }; }
      const p = base + '.' + t; bins.push({ path: p, blob: new Blob([v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)]) }); return { $path: p, $t: t, n: v.byteLength };
    }
    if (Array.isArray(v)) return v.map((x, i) => pack(x, key === 'data' ? 'img:' + i : key));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = pack(x, k); return o; }
    return v;
  };
  const pfiles = files.map((f) => { cur = f.id; const r = pack(f); cur = null; return r; });
  // (anything outside a file record that is binary: scores' covers, settings with pictures)
  // (each score's cover, and anything binary in the markings or settings, under a name of its own)
  const each = (list, tag) => list.map((x) => { cur = tag(x); const r = pack(x); cur = null; return r; });
  const kv = (await db.all('kv')).filter((x) => !MIRROR_LOCAL.has(x.k));
  const lib = { magic: 'stand-mirror', v: 1, made: Date.now(), scores: each(scores, (x) => 'score-' + x.id), files: pfiles, ink: each(await db.all('ink'), (x) => 'ink-' + x.key), takes: each(takes, (x) => 'take-' + x.id), kv: each(kv, (x) => 'kv-' + x.k) };
  for (const b of bins) b.sig = await sigOf(b.blob);
  return { lib: new Blob([JSON.stringify(lib)], { type: 'application/json' }), bins };
}
// Bring the library back from the folder. get(path) gives a Blob (or null) for a path in it.
export async function restoreMirror(get) {
  const libBlob = await get('Stand library.json');
  if (!libBlob) throw new Error('There is no backup in the Stand folder yet.');
  const lib = JSON.parse(await libBlob.text());
  if (lib.magic !== 'stand-mirror') throw new Error('The backup in the Stand folder could not be read.');
  const unpack = async (v) => {
    if (v && typeof v === 'object' && '$path' in v) {
      const blob = await get(v.$path); if (!blob) return undefined;
      if (v.$t === 'blob') return new Blob([blob], { type: v.mime || '' });
      if (v.$t === 'wav') return f32OfWav(blob);
      const ab = await blob.arrayBuffer();
      return v.$t === 'f32' ? new Float32Array(ab) : v.$t === 'i16' ? new Int16Array(ab) : v.$t === 'u8' ? new Uint8Array(ab) : ab;
    }
    if (Array.isArray(v)) { const r = []; for (const x of v) r.push(await unpack(x)); return r; }
    if (v && typeof v === 'object') { const r = {}; for (const [k, x] of Object.entries(v)) r[k] = await unpack(x); return r; }
    return v;
  };
  let scores = 0, takes = 0; const okFiles = new Set(); const lost = [];
  for (const f of lib.files) {
    const r = await unpack(f);
    if ((r.data === undefined && f.data !== undefined) || (Array.isArray(r.data) && r.data.some((x) => x === undefined))) { lost.push(f.id); continue; }
    await db.put('files', r); okFiles.add(r.id);
  }
  for (const s of lib.scores) if (!s.fileId || okFiles.has(s.fileId) || await db.get('files', s.fileId)) { await db.put('scores', await unpack(s)); scores++; }
  for (const i of lib.ink) await putInkMerged(await unpack(i));
  for (const t of lib.takes) if (okFiles.has('audio:' + t.id) || okFiles.has('video:' + t.id)) { await db.put('takes', await unpack(t)); takes++; }
  for (const k of lib.kv) await putKvMerged(await unpack(k));
  return { scores, takes, lost: lost.length, made: lib.made };
}
