// MusicXML 4.0 export (.musicxml and compressed .mxl) and import, so scores move to and from
// Sibelius, Dorico, MuseScore and Finale.
import { INST, INSTRUMENTS } from './instruments.js';
import { hasVoice2, voiceView,
  WHOLE, STEP_NAMES, barTicks, timeAt, keyAt, ticksOf, toWritten, writtenKey, clefAt, newId, newScore, restBar, tidyBar, restsFor, valueOf, midiOf, newPart, spansToMarks, migrateScore,
} from './model.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TYPE = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' };
const TYPE_BACK = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, +k]));
const CLEF_XML = { treble: ['G', 2, 0], bass: ['F', 4, 0], alto: ['C', 3, 0], tenor: ['C', 4, 0], treble8: ['G', 2, -1], bass8: ['F', 4, -1], perc: ['percussion', 0, 0] };
const ART_XML = { stacc: 'staccato', stacciss: 'staccatissimo', ten: 'tenuto', acc: 'accent', marc: 'strong-accent', breath: 'breath-mark', caes: 'caesura' };
const ORN_XML = { trill: 'trill-mark', mord: 'mordent', prall: 'inverted-mordent', turn: 'turn', turnInv: 'inverted-turn' };
const OTT = { '8va': 1, '8vb': 1, '15ma': 1, '15mb': 1 };
const JUMP_WORDS = { dc: 'D.C.', dcfine: 'D.C. al Fine', dccoda: 'D.C. al Coda', ds: 'D.S.', dsfine: 'D.S. al Fine', dscoda: 'D.S. al Coda', tocoda: 'To Coda', fine: 'Fine' };
const GM = { piano: 1, harpsichord: 7, celesta: 9, glockenspiel: 10, vibraphone: 12, marimba: 13, xylophone: 14, bells: 15, organ: 20, accordion: 22, guitar: 25, steelguitar: 26, eguitar: 28, jazzbass: 33, ebass: 34, violin: 41, viola: 42, cello: 43, bass: 44, tremolo: 45, pizz: 46, harp: 47, timpani: 48, strings: 49, choir: 53, oohs: 54, trumpet: 57, trombone: 58, tuba: 59, horn: 61, brass: 62, sopsax: 65, altosax: 66, tenorsax: 67, barisax: 68, oboe: 69, englishhorn: 70, bassoon: 71, clarinet: 72, piccolo: 73, flute: 74, recorder: 75, banjo: 106, woodblock: 116, drum: 119, epiano: 5 };

export function toMusicXML(score0) {
  const score = spansToMarks(score0);
  const out = [];
  const w = (s) => out.push(s);
  w('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  w(`<work><work-title>${esc(score.title)}</work-title></work>`);
  if (score.subtitle) w(`<movement-title>${esc(score.subtitle)}</movement-title>`);
  w('<identification>');
  if (score.composer) w(`<creator type="composer">${esc(score.composer)}</creator>`);
  w(`<encoding><software>Stand</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>`);
  w('<part-list>');
  score.parts.forEach((p, i) => {
    const inst = INST[p.inst] || INST.piano, id = 'P' + (i + 1);
    w(`<score-part id="${id}"><part-name>${esc(p.name)}</part-name><part-abbreviation>${esc(p.abbr)}</part-abbreviation>`);
    w(`<score-instrument id="${id}-I1"><instrument-name>${esc(inst.name)}</instrument-name></score-instrument>`);
    w(`<midi-instrument id="${id}-I1"><midi-channel>${(i % 15) + 1 + (i % 15 >= 9 ? 1 : 0)}</midi-channel><midi-program>${GM[p.sound || inst.sound] || 1}</midi-program></midi-instrument></score-part>`);
  });
  w('</part-list>');
  score.parts.forEach((p, pi) => {
    const inst = INST[p.inst] || INST.piano;
    w(`<part id="P${pi + 1}">`);
    for (let m = 0; m < score.measures.length; m++) {
      const ms = score.measures[m];
      const time = timeAt(score, m);
      w(`<measure number="${m + 1}">`);
      if (ms.start === 'repeat') w('<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
      // attributes: at the start and where things change
      const attrs = [];
      if (m === 0) attrs.push(`<divisions>${WHOLE / 4}</divisions>`);
      if (m === 0 || (ms.key !== undefined && ms.key !== null)) attrs.push(`<key><fifths>${writtenKey(keyAt(score, m), inst)}</fifths></key>`);
      if (m === 0 || ms.time) attrs.push(`<time${ms.timeSym ? ` symbol="${ms.timeSym}"` : ''}><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time>`);
      if (m === 0 && p.staves.length > 1) attrs.push(`<staves>${p.staves.length}</staves>`);
      p.staves.forEach((st, si) => {
        const clef = clefAt(st, m);
        if (m === 0 || (st.clefs && st.clefs[m])) {
          const [sign, line, oct] = CLEF_XML[clef] || CLEF_XML.treble;
          attrs.push(`<clef${p.staves.length > 1 ? ` number="${si + 1}"` : ''}><sign>${sign}</sign>${line ? `<line>${line}</line>` : ''}${oct ? `<clef-octave-change>${oct}</clef-octave-change>` : ''}</clef>`);
        }
      });
      if (m === 0 && inst.tr && (inst.tr.semis || inst.tr.steps)) attrs.push(`<transpose><diatonic>${inst.tr.steps}</diatonic><chromatic>${inst.tr.semis}</chromatic></transpose>`);
      if (attrs.length) w(`<attributes>${attrs.join('')}</attributes>`);
      if (ms.tempo && pi === 0) {
        const unit = ms.tempo.beat === 2 ? 'half' : ms.tempo.beat === 8 ? 'eighth' : 'quarter';
        w(`<direction placement="above"><direction-type>${ms.tempo.text ? `<words font-weight="bold">${esc(ms.tempo.text)}</words></direction-type><direction-type>` : ''}<metronome><beat-unit>${unit}</beat-unit>${ms.tempo.dotted ? '<beat-unit-dot/>' : ''}<per-minute>${ms.tempo.bpm}</per-minute></metronome></direction-type><sound tempo="${Math.round(ms.tempo.bpm * (4 / (ms.tempo.beat || 4)) * (ms.tempo.dotted ? 1.5 : 1))}"/></direction>`);
      }
      if (ms.rehearsal && pi === 0) w(`<direction placement="above"><direction-type><rehearsal>${esc(ms.rehearsal)}</rehearsal></direction-type></direction>`);
      if (ms.mark && pi === 0) w(`<direction placement="above"><direction-type><${ms.mark}/></direction-type><sound ${ms.mark}="${ms.mark}${m}"/></direction>`);
      const volta = (score.spans || []).find((q) => q.kind === 'volta' && q.a.m <= m && q.b.m >= m);
      if (volta && volta.a.m === m) w(`<barline location="left"><ending number="${volta.n || 1}" type="start">${volta.n || 1}.</ending></barline>`);
      p.staves.forEach((st, si) => {
        if (si > 0) w(`<backup><duration>${barTicks(time)}</duration></backup>`);
        const staffTag = p.staves.length > 1 ? `<staff>${si + 1}</staff>` : '';
        const lyrState = { hyph: false };
        for (const [voice, bar] of [[si * 4 + 1, st.bars[m] || restBar(time)], ...(hasVoice2(st, m) ? [[si * 4 + 2, st.v2[m]]] : [])]) {
        if (voice % 4 === 2) w(`<backup><duration>${barTicks(time)}</duration></backup>`);
        for (const ev of bar) {
          const dur = ticksOf(ev, time);
          if (ev.dyn) w(`<direction placement="below"><direction-type><dynamics><${ev.dyn}/></dynamics></direction-type>${staffTag}</direction>`);
          if (ev.hp === '<' || ev.hp === '>') w(`<direction placement="below"><direction-type><wedge type="${ev.hp === '<' ? 'crescendo' : 'diminuendo'}"/></direction-type>${staffTag}</direction>`);
          if (ev.hp === 'end') w(`<direction placement="below"><direction-type><wedge type="stop"/></direction-type>${staffTag}</direction>`);
          if (ev.txt) w(`<direction placement="above"><direction-type><words${ev.txtStyle === 'tech' || ev.txtStyle === 'box' || ev.txtStyle === 'plain' ? '' : ' font-style="italic"'}${ev.txtStyle === 'box' ? ' enclosure="rectangle"' : ''}>${esc(ev.txt)}</words></direction-type>${staffTag}</direction>`);
          // lines that start or stop here
          let pos0 = 0; for (const q of bar) { if (q === ev) break; pos0 += ticksOf(q, time); }
          for (const sp of score.spans || []) {
            if (sp.st !== st.id) continue;
            const startsHere = sp.a.m === m && sp.a.pos >= pos0 && sp.a.pos < pos0 + dur, stopsHere = sp.b.m === m && sp.b.pos >= pos0 && sp.b.pos < pos0 + dur;
            const below = ['8vb', '15mb', 'ped', 'cresc', 'dim'].includes(sp.kind) ? 'below' : 'above';
            const n = (sp.id.length % 5) + 1;
            if (startsHere) {
              if (sp.kind === '8va' || sp.kind === '8vb' || sp.kind === '15ma' || sp.kind === '15mb') w(`<direction placement="${below}"><direction-type><octave-shift type="${sp.kind.includes('v') && sp.kind.endsWith('a') || sp.kind === '15ma' ? 'down' : 'up'}" size="${sp.kind.startsWith('15') ? 15 : 8}" number="${n}"/></direction-type>${staffTag}</direction>`);
              if (sp.kind === 'ped') w(`<direction placement="below"><direction-type><pedal type="start" line="${sp.line === false ? 'no' : 'yes'}"/></direction-type>${staffTag}</direction>`);
              if (['rit', 'accel', 'cresc', 'dim'].includes(sp.kind)) w(`<direction placement="${below}"><direction-type><words font-style="italic">${{ rit: 'rit.', accel: 'accel.', cresc: 'cresc.', dim: 'dim.' }[sp.kind]}</words></direction-type><direction-type><dashes type="start" number="${n}"/></direction-type>${staffTag}</direction>`);
            }
            if (stopsHere && !startsHere) {
              if (OTT[sp.kind]) w(`<direction placement="${below}"><direction-type><octave-shift type="stop" size="${sp.kind.startsWith('15') ? 15 : 8}" number="${n}"/></direction-type>${staffTag}</direction>`);
              if (sp.kind === 'ped') w(`<direction placement="below"><direction-type><pedal type="stop" line="${sp.line === false ? 'no' : 'yes'}"/></direction-type>${staffTag}</direction>`);
              if (['rit', 'accel', 'cresc', 'dim'].includes(sp.kind)) w(`<direction placement="${below}"><direction-type><dashes type="stop" number="${n}"/></direction-type>${staffTag}</direction>`);
            }
          }
          const common = (first) => {
            let s = `<duration>${dur}</duration>`;
            return s;
          };
          if (ev.rest || !ev.notes || !ev.notes.length) {
            w(`<note><rest${ev.full ? ' measure="yes"' : ''}/>${common(true)}<voice>${voice}</voice>${ev.full ? '' : `<type>${TYPE[ev.t]}</type>${'<dot/>'.repeat(ev.dots || 0)}`}${tupXml(ev)}${staffTag}${notations(ev, null, true)}</note>`);
            continue;
          }
          if (ev.chord) w(harmonyXml(ev.chord, staffTag));
          if (ev.grace && !inst.unpitched) {
            const gn = toWritten({ s: ev.grace.s, a: ev.grace.a || 0 }, inst);
            const sc = ((gn.s % 7) + 7) % 7, oct = Math.floor(gn.s / 7);
            w(`<note><grace${ev.grace.slash === false ? '' : ' slash="yes"'}/><pitch><step>${STEP_NAMES[sc]}</step>${gn.a ? `<alter>${gn.a}</alter>` : ''}<octave>${oct}</octave></pitch><voice>${voice}</voice><type>eighth</type><stem>up</stem>${staffTag}</note>`);
          }
          ev.notes.forEach((n0, k) => {
            const n = inst.unpitched ? n0 : toWritten(n0, inst);
            const sc = ((n.s % 7) + 7) % 7, oct = Math.floor(n.s / 7);
            const pitch = inst.unpitched ? `<unpitched><display-step>${STEP_NAMES[sc]}</display-step><display-octave>${oct}</display-octave></unpitched>` : `<pitch><step>${STEP_NAMES[sc]}</step>${n.a ? `<alter>${n.a}</alter>` : ''}<octave>${oct}</octave></pitch>`;
            const tieIn = isTiedFrom(voice % 4 === 2 ? voiceView(st, 2, score) : st, m, ev, n0);
            const ties = (tieIn ? '<tie type="stop"/>' : '') + (n0.tie ? '<tie type="start"/>' : '');
            w(`<note>${k ? '<chord/>' : ''}${pitch}${common(!k)}${ties}<voice>${voice}</voice><type>${TYPE[ev.t]}</type>${'<dot/>'.repeat(ev.dots || 0)}${tupXml(ev)}${headXml(n0.head || ev.head)}${staffTag}${notations(ev, n0, k === 0, tieIn, k === 0 ? lineMarks(score, st.id, m, pos0, dur) : '')}${k === 0 && ev.lyric ? lyricXml(ev.lyric, lyrState) : ''}</note>`);
          });
        }
        }
      });
      if (ms.jump && pi === 0) w(`<direction placement="above"><direction-type><words font-style="italic">${JUMP_WORDS[ms.jump] || ''}</words></direction-type>${ms.jump === 'fine' ? '<sound fine="yes"/>' : ms.jump.startsWith('dc') ? '<sound dacapo="yes"/>' : ''}</direction>`);
      const bl = ms.bar;
      const vEnd = (score.spans || []).find((q) => q.kind === 'volta' && q.b.m === m);
      if (vEnd) w(`<barline location="right">${bl === 'repeat' ? '<bar-style>light-heavy</bar-style>' : ''}<ending number="${vEnd.n || 1}" type="${vEnd.closed === false ? 'discontinue' : 'stop'}"/>${bl === 'repeat' ? '<repeat direction="backward"/>' : ''}</barline>`);
      if (vEnd && bl === 'repeat') { /* written above with the ending */ }
      else if (bl === 'final') w('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      else if (bl === 'double') w('<barline location="right"><bar-style>light-light</bar-style></barline>');
      else if (bl === 'repeat') w('<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
      w('</measure>');
    }
    w('</part>');
  });
  w('</score-partwise>');
  return out.join('\n');
}
const HEAD_XML = { x: 'x', diamond: 'diamond', slash: 'slash', tri: 'triangle', square: 'square', circlex: 'circle-x', ghost: 'normal" parentheses="yes', harm: 'diamond' };
const HEAD_BACK = { x: 'x', cross: 'x', diamond: 'diamond', slash: 'slash', triangle: 'tri', square: 'square', 'circle-x': 'circlex' };
function headXml(h) { return h && HEAD_XML[h] ? `<notehead>${HEAD_XML[h]}</notehead>`.replace('<notehead>normal" parentheses="yes</notehead>', '<notehead parentheses="yes">normal</notehead>') : ''; }
function tupXml(ev) { return ev.tup ? `<time-modification><actual-notes>${ev.tup.n}</actual-notes><normal-notes>${ev.tup.m}</normal-notes></time-modification>` : ''; }
function isTiedFrom(st, m, ev, n) {
  const bar = st.bars[m]; const i = bar.indexOf(ev);
  const prev = i > 0 ? bar[i - 1] : m > 0 ? st.bars[m - 1][st.bars[m - 1].length - 1] : null;
  return !!(prev && prev.notes && prev.notes.some((q) => q.tie && q.s === n.s));
}
function lyricXml(l, st) {
  const cont = /-$/.test(l), text = l.replace(/-$/, '');
  const syl = st.hyph ? (cont ? 'middle' : 'end') : (cont ? 'begin' : 'single');
  st.hyph = cont;
  return `<lyric number="1"><syllabic>${syl}</syllabic><text>${esc(text)}</text></lyric>`;
}
const KINDS = [['maj7', 'major-seventh'], ['m7b5', 'half-diminished'], ['m7', 'minor-seventh'], ['dim7', 'diminished-seventh'], ['dim', 'diminished'], ['°', 'diminished'], ['aug', 'augmented'], ['+', 'augmented'], ['sus4', 'suspended-fourth'], ['sus2', 'suspended-second'], ['m6', 'minor-sixth'], ['m', 'minor'], ['13', 'dominant-13th'], ['11', 'dominant-11th'], ['9', 'dominant-ninth'], ['7', 'dominant'], ['6', 'major-sixth'], ['', 'major']];
function harmonyXml(c, staffTag) {
  const mm = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(c.trim());
  if (!mm) return `<direction placement="above"><direction-type><words>${esc(c)}</words></direction-type>${staffTag}</direction>`;
  const alt = (x) => (x === '#' ? '<root-alter>1</root-alter>' : x === 'b' ? '<root-alter>-1</root-alter>' : '');
  const rest = mm[3] || ''; const kind = (KINDS.find(([k]) => rest.startsWith(k)) || ['', 'major'])[1];
  return `<harmony><root><root-step>${mm[1]}</root-step>${alt(mm[2])}</root><kind text="${esc(rest)}">${kind}</kind>${mm[4] ? `<bass><bass-step>${mm[4]}</bass-step>${mm[5] ? `<bass-alter>${mm[5] === '#' ? 1 : -1}</bass-alter>` : ''}</bass>` : ''}${staffTag}</harmony>`;
}
// trills with a wavy line and glissandos are written on their first and last notes
function lineMarks(score, stId, m, pos, dur) {
  let out = '';
  for (const sp of score.spans || []) {
    if (sp.st !== stId || (sp.kind !== 'trill' && sp.kind !== 'gliss')) continue;
    const at = (q) => q.m === m && q.pos >= pos && q.pos < pos + dur;
    if (sp.kind === 'trill') { if (at(sp.a)) out += '<ornaments><trill-mark/><wavy-line type="start"/></ornaments>'; if (at(sp.b)) out += '<ornaments><wavy-line type="stop"/></ornaments>'; }
    else { if (at(sp.a)) out += '<glissando type="start" line-type="solid">gliss.</glissando>'; if (at(sp.b) && !at(sp.a)) out += '<glissando type="stop"/>'; }
  }
  return out;
}
function notations(ev, n, first, tieIn, extra) {
  const parts = [];
  if (extra) parts.push(extra);
  if (n && n.tie) parts.push('<tied type="start"/>');
  if (n && tieIn) parts.push('<tied type="stop"/>');
  if (first) {
    if (ev.slur === 'start') parts.push('<slur type="start" number="1"/>');
    if (ev.slur === 'end') parts.push('<slur type="stop" number="1"/>');
    const arts = (ev.art || []).filter((a) => ART_XML[a]).map((a) => `<${ART_XML[a]}/>`);
    if (arts.length) parts.push(`<articulations>${arts.join('')}</articulations>`);
    if ((ev.art || []).includes('ferm')) parts.push('<fermata type="upright"/>');
    if ((ev.art || []).includes('fermS')) parts.push('<fermata type="upright">angled</fermata>');
    if ((ev.art || []).includes('fermL')) parts.push('<fermata type="upright">square</fermata>');
    if ((ev.art || []).includes('arp')) parts.push('<arpeggiate/>');
    const tech = [];
    if ((ev.art || []).includes('stopped')) tech.push('<stopped/>');
    if ((ev.art || []).includes('open')) tech.push('<open-string/>');
    if ((ev.art || []).includes('snap')) tech.push('<snap-pizzicato/>');
    if ((ev.art || []).includes('up')) tech.push('<up-bow/>');
    if ((ev.art || []).includes('down')) tech.push('<down-bow/>');
    if ((ev.art || []).includes('harm')) tech.push('<harmonic/>');
    if (tech.length) parts.push(`<technical>${tech.join('')}</technical>`);
    const orn = (ev.art || []).filter((a) => ORN_XML[a]).map((a) => `<${ORN_XML[a]}/>`);
    const tr = (ev.art || []).find((a) => a === 'trem' || a === 'trem2' || a === 'trem3');
    if (tr) orn.push(`<tremolo type="single">${tr === 'trem' ? 1 : tr === 'trem2' ? 2 : 3}</tremolo>`);
    if (orn.length) parts.push(`<ornaments>${orn.join('')}</ornaments>`);
    if (ev.tup && ev._tupStart) parts.push('<tuplet type="start"/>');
  }
  return parts.length ? `<notations>${parts.join('')}</notations>` : '';
}

// ---------- compressed MusicXML (.mxl): a zip with the score and a container file ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export async function zipFiles(files) {
  // files: [{ name, data: Uint8Array }]; deflate when the browser can, else store
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data, method = 0;
    if (typeof CompressionStream !== 'undefined' && f.name !== 'mimetype') {
      try { const cs = new Blob([f.data]).stream().pipeThrough(new CompressionStream('deflate-raw')); body = new Uint8Array(await new Response(cs).arrayBuffer()); method = 8; } catch { body = f.data; method = 0; }
    }
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0, true); head.setUint16(8, method, true);
    head.setUint16(10, 0, true); head.setUint16(12, 0x21, true); head.setUint32(14, crc, true); head.setUint32(18, body.length, true); head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true); head.setUint16(28, 0, true);
    chunks.push(new Uint8Array(head.buffer), name, body);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0, true); cen.setUint16(10, method, true);
    cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true); cen.setUint32(16, crc, true); cen.setUint32(20, body.length, true); cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.recordare.musicxml' });
}
export async function toMXL(score) {
  const enc = new TextEncoder();
  const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>';
  return zipFiles([
    { name: 'mimetype', data: enc.encode('application/vnd.recordare.musicxml') },
    { name: 'META-INF/container.xml', data: enc.encode(container) },
    { name: 'score.musicxml', data: enc.encode(toMusicXML(score)) },
  ]);
}

// ---------- import ----------
async function unzip(buf) {
  const dv = new DataView(buf); const files = {};
  let eocd = buf.byteLength - 22; while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    const lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true);
    const data = new Uint8Array(buf, off + 30 + lnlen + lxlen, csize);
    files[name] = method === 0 ? data : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
export async function readMusicFile(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, 4);
  let xml;
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const files = await unzip(buf);
    const dec = new TextDecoder();
    let path = Object.keys(files).find((k) => /\.(musicxml|xml)$/i.test(k) && !k.startsWith('META-INF'));
    if (files['META-INF/container.xml']) { const m = dec.decode(files['META-INF/container.xml']).match(/full-path="([^"]+)"/); if (m && files[m[1]]) path = m[1]; }
    xml = dec.decode(files[path]);
  } else xml = new TextDecoder().decode(buf);
  return fromMusicXML(xml);
}
function guessInst(name, program, clefs) {
  const n = (name || '').toLowerCase();
  let best = null;
  for (const i of INSTRUMENTS) if (n && (n === i.name.toLowerCase() || n.startsWith(i.name.toLowerCase()))) { best = i; break; }
  if (!best) for (const [k, words] of [['violin', ['violin', 'vln', 'violino']], ['viola', ['viola', 'vla']], ['cello', ['cello', 'violoncell', 'vc']], ['contrabass', ['contrabass', 'double bass', 'kontrabass']], ['flute', ['flute', 'flauto', 'fl.']], ['oboe', ['oboe']], ['clarinet', ['clarinet']], ['bassoon', ['bassoon', 'fagott']], ['horn', ['horn', 'corno']], ['trumpet', ['trumpet', 'tromba']], ['trombone', ['trombone']], ['tuba', ['tuba']], ['piano', ['piano', 'klavier']], ['harp', ['harp', 'arpa']], ['guitar', ['guitar']], ['soprano', ['soprano']], ['alto', ['alto']], ['tenor', ['tenor']], ['bass', ['bass']], ['timpani', ['timpani', 'pauken']], ['organ', ['organ']], ['voice', ['voice', 'voce', 'canto']]]) {
    if (words.some((w) => n.includes(w))) { best = INST[k]; break; }
  }
  if (!best && program) { const sid = Object.entries(GM).find(([, v]) => v === program); if (sid) best = INSTRUMENTS.find((i) => i.sound === sid[0]); }
  if (!best) best = clefs >= 2 ? INST.piano : INST.violin;
  return best;
}
export function fromMusicXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not MusicXML.');
  const q = (el, sel) => el.querySelector(sel);
  const txt = (el, sel) => { const e = sel ? q(el, sel) : el; return e ? e.textContent.trim() : ''; };
  const title = txt(doc, 'work > work-title') || txt(doc, 'movement-title') || 'Imported score';
  const composer = txt(doc, 'creator[type="composer"]');
  const partEls = [...doc.querySelectorAll('score-partwise > part')];
  if (!partEls.length) throw new Error('No parts in this file. Only “partwise” MusicXML is supported.');
  const listEls = Object.fromEntries([...doc.querySelectorAll('part-list > score-part')].map((sp) => [sp.getAttribute('id'), sp]));
  const score = newScore({ title, composer, insts: ['piano'], bars: 1 });
  score.parts = []; score.measures = [];
  const nMeasures = Math.max(...partEls.map((p) => p.querySelectorAll(':scope > measure').length));
  for (let m = 0; m < nMeasures; m++) score.measures.push({});
  partEls.forEach((pel, pi) => {
    const sp = listEls[pel.getAttribute('id')];
    const pname = sp ? txt(sp, 'part-name') : 'Part ' + (pi + 1);
    const program = sp ? +txt(sp, 'midi-program') || 0 : 0;
    const firstStaves = +txt(pel, 'measure attributes staves') || 1;
    const inst = guessInst(pname, program, firstStaves);
    const part = newPart(inst.id);
    part.name = pname || inst.name; part.abbr = (sp && txt(sp, 'part-abbreviation')) || inst.abbr;
    // the staves come from the file
    part.staves = Array.from({ length: firstStaves }, (_, i) => ({ id: newId(), clef: inst.clefs[i] || inst.clefs[0], bars: [] }));
    score.parts.push(part);
    let divisions = 1, tr = { steps: 0, semis: 0 };
    let time = [4, 4];
    const measureEls = [...pel.querySelectorAll(':scope > measure')];
    // marks waiting for the next note on a staff, lines being drawn, the last note on a staff
    const pend = part.staves.map(() => ({}));
    const openSpans = [];
    const lastAt = part.staves.map(() => null);
    score.spans = score.spans || [];
    for (let m = 0; m < nMeasures; m++) {
      const mel = measureEls[m];
      const perStaff = part.staves.map(() => []);   // {pos, ev}
      const perStaff2 = part.staves.map(() => []);
      const voiceOf = part.staves.map(() => null);
      const voice2Of = part.staves.map(() => null);
      let pos = 0, lastStart = 0;
      const ms = score.measures[m];
      if (mel) for (const el of mel.children) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          if (q(el, 'divisions')) divisions = +txt(el, 'divisions') || 1;
          if (q(el, 'key fifths') && pi === 0) ms.key = +txt(el, 'key fifths');
          if (q(el, 'time beats') && pi === 0) { time = [+txt(el, 'time beats') || 4, +txt(el, 'time beat-type') || 4]; ms.time = time.slice(); const sym = q(el, 'time') && q(el, 'time').getAttribute('symbol'); if (sym === 'common' || sym === 'cut') ms.timeSym = sym; }
          else if (q(el, 'time beats')) time = [+txt(el, 'time beats') || 4, +txt(el, 'time beat-type') || 4];
          for (const c of el.querySelectorAll('clef')) {
            const k = (+c.getAttribute('number') || 1) - 1; if (!part.staves[k]) continue;
            const sign = txt(c, 'sign'), line = +txt(c, 'line'), oct = +txt(c, 'clef-octave-change') || 0;
            const clef = sign === 'G' ? (oct < 0 ? 'treble8' : 'treble') : sign === 'F' ? (oct < 0 ? 'bass8' : 'bass') : sign === 'C' ? (line === 4 ? 'tenor' : 'alto') : sign === 'percussion' ? 'perc' : 'treble';
            if (m === 0) part.staves[k].clef = clef; else { part.staves[k].clefs = part.staves[k].clefs || {}; part.staves[k].clefs[m] = clef; }
          }
          if (q(el, 'transpose')) tr = { steps: +txt(el, 'transpose diatonic') || 0, semis: +txt(el, 'transpose chromatic') || 0 };
        } else if (tag === 'backup') pos -= Math.round((+txt(el, 'duration') * 480) / divisions);
        else if (tag === 'forward') pos += Math.round((+txt(el, 'duration') * 480) / divisions);
        else if (tag === 'barline') {
          if (q(el, 'repeat[direction="forward"]')) ms.start = 'repeat';
          if (q(el, 'repeat[direction="backward"]')) ms.bar = 'repeat';
          else if (txt(el, 'bar-style') === 'light-light') ms.bar = 'double';
          const en = q(el, 'ending');
          if (en && pi === 0) {
            const type = en.getAttribute('type'), n = parseInt(en.getAttribute('number'), 10) || 1;
            if (type === 'start') openSpans.push({ id: newId(), kind: 'volta', n, a: { m, pos: 0 }, b: null });
            else { const v = openSpans.find((x) => x.kind === 'volta' && !x.b); if (v) { v.b = { m, pos: 0 }; if (type === 'discontinue') v.closed = false; score.spans.push(v); openSpans.splice(openSpans.indexOf(v), 1); } }
          }
        } else if (tag === 'harmony') {
          const k = Math.max(0, (+txt(el, 'staff') || 1) - 1);
          const ra = +txt(el, 'root root-alter') || 0, ba = +txt(el, 'bass bass-alter') || 0;
          const kd = q(el, 'kind'); const kt = kd ? (kd.getAttribute('text') ?? (KINDS.find(([, v]) => v === kd.textContent.trim()) || [''])[0]) : '';
          (pend[k] || pend[0]).chord = txt(el, 'root root-step') + (ra > 0 ? '#' : ra < 0 ? 'b' : '') + kt + (q(el, 'bass') ? '/' + txt(el, 'bass bass-step') + (ba > 0 ? '#' : ba < 0 ? 'b' : '') : '');
        } else if (tag === 'direction') {
          const k = Math.max(0, (+txt(el, 'staff') || 1) - 1); const P = pend[k] || pend[0];
          const pm = q(el, 'per-minute'); const snd = q(el, 'sound[tempo]');
          const words = txt(el, 'words');
          if ((pm || snd) && pi === 0) ms.tempo = { bpm: Math.round(+(pm ? pm.textContent : snd.getAttribute('tempo'))) || 96, beat: { half: 2, eighth: 8 }[txt(el, 'beat-unit')] || 4, text: words };
          else if (q(el, 'segno') && pi === 0) ms.mark = 'segno';
          else if (q(el, 'coda') && pi === 0) ms.mark = 'coda';
          else if (q(el, 'rehearsal') && pi === 0) ms.rehearsal = txt(el, 'rehearsal');
          else if (q(el, 'dynamics')) { const d = q(el, 'dynamics').firstElementChild; if (d) P.dyn = d.tagName; }
          else if (q(el, 'wedge')) { const ty = q(el, 'wedge').getAttribute('type'); P.hp = ty === 'crescendo' ? '<' : ty === 'diminuendo' ? '>' : 'end'; }
          else if (q(el, 'octave-shift')) {
            const os = q(el, 'octave-shift'), ty = os.getAttribute('type'), size = +os.getAttribute('size') || 8;
            if (ty === 'stop') { const sp = openSpans.find((x) => /^(8v|15m)/.test(x.kind) && x.k === k && !x.b); if (sp) { sp.b = lastAt[k] || { m, pos: 0 }; delete sp.k; score.spans.push(sp); openSpans.splice(openSpans.indexOf(sp), 1); } }
            else openSpans.push({ id: newId(), kind: size === 15 ? (ty === 'down' ? '15ma' : '15mb') : (ty === 'down' ? '8va' : '8vb'), st: part.staves[k].id, k, a: null, b: null });
          } else if (q(el, 'pedal')) {
            const pd = q(el, 'pedal'), ty = pd.getAttribute('type');
            if (ty === 'start') openSpans.push({ id: newId(), kind: 'ped', st: part.staves[k].id, k, a: null, b: null, ...(pd.getAttribute('line') === 'no' ? { line: false } : {}) });
            else if (ty === 'stop') { const sp = openSpans.find((x) => x.kind === 'ped' && x.k === k && !x.b); if (sp) { sp.b = lastAt[k] || { m, pos: 0 }; delete sp.k; score.spans.push(sp); openSpans.splice(openSpans.indexOf(sp), 1); } }
          } else if (q(el, 'dashes')) {
            const ty = q(el, 'dashes').getAttribute('type');
            const kind = /rit|rall/i.test(words) ? 'rit' : /accel/i.test(words) ? 'accel' : /cresc/i.test(words) ? 'cresc' : /dim|decresc/i.test(words) ? 'dim' : null;
            if (ty === 'start' && kind) openSpans.push({ id: newId(), kind, st: part.staves[k].id, k, a: null, b: null });
            if (ty === 'stop') { const sp = openSpans.find((x) => ['rit', 'accel', 'cresc', 'dim'].includes(x.kind) && x.k === k && !x.b); if (sp) { sp.b = lastAt[k] || { m, pos: 0 }; delete sp.k; score.spans.push(sp); openSpans.splice(openSpans.indexOf(sp), 1); } }
          } else if (words) {
            const jump = Object.entries(JUMP_WORDS).find(([, w]) => w.toLowerCase() === words.toLowerCase());
            if (jump && pi === 0) ms.jump = jump[0];
            else { const we = q(el, 'words'); P.txt = words; P.txtStyle = we.getAttribute('enclosure') ? 'box' : we.getAttribute('font-style') === 'italic' ? 'expr' : 'tech'; }
          }
        } else if (tag === 'note') {
          if (q(el, 'grace')) {
            // keep the first grace note before a note; it is drawn small and played just before the beat
            const kg = Math.max(0, (+txt(el, 'staff') || 1) - 1);
            if (!q(el, 'chord') && !q(el, 'rest') && pend[kg] && !pend[kg].grace) {
              const step = STEP_NAMES.indexOf(txt(el, 'pitch step') || 'C'), oct = +(txt(el, 'pitch octave') || 4), alter = Math.round(+txt(el, 'pitch alter') || 0);
              let gn = { s: oct * 7 + Math.max(0, step), a: alter };
              if (tr.steps || tr.semis) { const s2 = gn.s + tr.steps; const mid = midiOf(gn.s, gn.a) + tr.semis; gn = { s: s2, a: mid - midiOf(s2, 0) }; }
              pend[kg].grace = { ...gn, ...(q(el, 'grace').getAttribute('slash') === 'yes' ? {} : { slash: false }), ...(q(el, 'accidental') ? { acc: alter } : {}) };
            }
            continue;
          }
          const k = (+txt(el, 'staff') || 1) - 1;
          if (!part.staves[k]) continue;
          const voice = txt(el, 'voice') || '1';
          if (voiceOf[k] === null) voiceOf[k] = voice;
          if (voice !== voiceOf[k] && voice2Of[k] === null) voice2Of[k] = voice;
          const dur = Math.round(((+txt(el, 'duration') || 0) * 480) / divisions);
          const isChord = !!q(el, 'chord');
          const start = isChord ? lastStart : pos;
          if (!isChord) { lastStart = pos; pos += dur; }
          if (voice !== voiceOf[k] && voice !== voice2Of[k]) continue;
          const inV2 = voice !== voiceOf[k];
          const type = TYPE_BACK[txt(el, 'type')];
          const dots = el.querySelectorAll('dot').length;
          const tm = q(el, 'time-modification');
          let ev = { id: newId(), t: type || 4, dots, rest: !!q(el, 'rest') };
          if (!type) { const v = valueOf(dur); if (v) { ev.t = v.t; ev.dots = v.dots; } }
          if (q(el, 'rest') && q(el, 'rest').getAttribute('measure') === 'yes') ev = { id: newId(), rest: true, full: true, t: 1, dots: 0 };
          if (tm) ev.tup = { n: +txt(tm, 'actual-notes') || 3, m: +txt(tm, 'normal-notes') || 2, base: ev.t };
          if (!ev.rest) {
            const step = STEP_NAMES.indexOf(txt(el, 'pitch step') || txt(el, 'unpitched display-step') || 'C');
            const oct = +(txt(el, 'pitch octave') || txt(el, 'unpitched display-octave') || 4);
            const alter = Math.round(+txt(el, 'pitch alter') || 0);
            let n = { s: oct * 7 + Math.max(0, step), a: alter, tie: [...el.querySelectorAll('tie')].some((t) => t.getAttribute('type') === 'start') };
            if (tr.steps || tr.semis) { const s2 = n.s + tr.steps; const mid = midiOf(n.s, n.a) + tr.semis; n = { ...n, s: s2, a: mid - midiOf(s2, 0) }; }
            const nh = q(el, 'notehead');
            if (nh) { const hk = HEAD_BACK[(nh.textContent || '').trim()]; if (hk) n.head = hk; else if (nh.getAttribute('parentheses') === 'yes') n.head = 'ghost'; }
            ev.notes = [n];
            const arts = [];
            for (const [a, x] of Object.entries(ART_XML)) if (q(el, 'articulations ' + x)) arts.push(a);
            if (q(el, 'fermata')) arts.push('ferm');
            if (q(el, 'up-bow')) arts.push('up'); if (q(el, 'down-bow')) arts.push('down');
            const fe = q(el, 'fermata'); if (fe && fe.textContent.trim() === 'angled') { arts.splice(arts.indexOf('ferm'), 1); arts.push('fermS'); } else if (fe && fe.textContent.trim() === 'square') { arts.splice(arts.indexOf('ferm'), 1); arts.push('fermL'); }
            for (const [a, x] of Object.entries(ORN_XML)) if (q(el, 'ornaments ' + x)) arts.push(a);
            const trm = q(el, 'ornaments tremolo'); if (trm) { const n2 = +trm.textContent || 1; arts.push(n2 >= 3 ? 'trem3' : n2 === 2 ? 'trem2' : 'trem'); }
            if (q(el, 'arpeggiate')) arts.push('arp');
            if (q(el, 'technical stopped')) arts.push('stopped'); if (q(el, 'technical open-string')) arts.push('open'); if (q(el, 'technical snap-pizzicato')) arts.push('snap'); if (q(el, 'technical harmonic')) arts.push('harm');
            const wl = q(el, 'ornaments wavy-line');
            if (wl && wl.getAttribute('type') === 'start') { openSpans.push({ id: newId(), kind: 'trill', st: part.staves[k].id, k, a: { m, pos: start }, b: null }); const ti = arts.indexOf('trill'); if (ti >= 0) arts.splice(ti, 1); }
            if (wl && wl.getAttribute('type') === 'stop') { const sp = openSpans.find((x) => x.kind === 'trill' && x.k === k && !x.b); if (sp) { sp.b = { m, pos: start }; delete sp.k; score.spans.push(sp); openSpans.splice(openSpans.indexOf(sp), 1); } }
            const gl = q(el, 'glissando') || q(el, 'slide');
            if (gl && gl.getAttribute('type') === 'start') openSpans.push({ id: newId(), kind: 'gliss', st: part.staves[k].id, k, a: { m, pos: start }, b: null, g: 1 });
            if (gl && gl.getAttribute('type') === 'stop') { const sp = openSpans.find((x) => x.kind === 'gliss' && x.k === k && !x.b); if (sp) { sp.b = { m, pos: start }; delete sp.k; delete sp.g; score.spans.push(sp); openSpans.splice(openSpans.indexOf(sp), 1); } }
            if (arts.length) ev.art = [...new Set(arts)];
            const sl = q(el, 'slur'); if (sl) ev.slur = sl.getAttribute('type') === 'stop' ? 'end' : 'start';
          } else delete ev.notes;
          if (isChord && !ev.rest) {
            const host = perStaff[k].find((x) => x.pos === start && x.ev.notes);
            if (host) { host.ev.notes.push(ev.notes[0]); continue; }
          }
          // marks that were waiting for this note
          const P = pend[k];
          if (!isChord && !inV2) {
            for (const key of ['dyn', 'hp', 'txt', 'txtStyle', 'chord']) if (P[key]) { ev[key] = P[key]; delete P[key]; }
            if (P.grace) { if (!ev.rest && ev.notes) ev.grace = { ...P.grace, dir: P.grace.s > ev.notes[0].s ? 1 : -1 }; delete P.grace; }
            const ly = q(el, 'lyric'); if (ly && !ev.rest) { const sy = txt(ly, 'syllabic'); ev.lyric = txt(ly, 'text') + (sy === 'begin' || sy === 'middle' ? '-' : ''); }
            for (const sp of openSpans) if (sp.k === k && !sp.a) sp.a = { m, pos: start };
            lastAt[k] = { m, pos: start };
          }
          (inV2 ? perStaff2 : perStaff)[k].push({ pos: start, ev, dur });
        }
      }
      // build each staff's bar, with rests in any gaps
      const bt = barTicks(time);
      part.staves.forEach((st, k) => {
        const list = perStaff[k].filter((x) => x.pos >= 0 && x.pos < bt).sort((a, b) => a.pos - b.pos);
        const evs = []; let p = 0;
        for (const x of list) {
          if (x.pos < p) continue;
          if (x.pos > p) evs.push(...restsFor(p, x.pos - p, time));
          evs.push(x.ev); p = x.pos + (x.ev.full ? bt : x.dur);
        }
        if (p < bt) evs.push(...restsFor(p, bt - p, time));
        st.bars[m] = evs.length ? tidyBar(evs, time) : restBar(time);
        if (perStaff2[k].length) {
          const l2 = perStaff2[k].filter((x) => x.pos >= 0 && x.pos < bt).sort((a, b) => a.pos - b.pos);
          const e2 = []; let p2 = 0;
          for (const x of l2) { if (x.pos < p2) continue; if (x.pos > p2) e2.push(...restsFor(p2, x.pos - p2, time)); e2.push(x.ev); p2 = x.pos + (x.ev.full ? bt : x.dur); }
          if (p2 < bt) e2.push(...restsFor(p2, bt - p2, time));
          st.v2 = st.v2 || []; st.v2[m] = tidyBar(e2, time);
        }
      });
    }
  });
  for (const p of score.parts) for (const st of p.staves) if (st.v2) for (let m = 0; m < score.measures.length; m++) if (!st.v2[m]) st.v2[m] = restBar(timeAt(score, m));
  score.spans = (score.spans || []).filter((sp) => sp.a && sp.b);
  if (!score.measures[0].time) score.measures[0].time = [4, 4];
  if (score.measures[0].key === undefined) score.measures[0].key = 0;
  if (!score.measures[0].tempo) score.measures[0].tempo = { bpm: 96, beat: 4, text: '' };
  score.measures[score.measures.length - 1].bar = 'final';
  const n = score.parts.reduce((a, p) => a + p.staves.length, 0);
  score.layout.staffMm = n <= 2 ? 7 : n <= 4 ? 6.5 : n <= 8 ? 5.5 : 4.8;
  return migrateScore(score);
}
