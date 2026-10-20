// Instruments, ensembles and staff sizes for Compose, laid out the way engravers expect:
// orchestral score order, standard clefs and transpositions, professional ranges.
// Pitches are MIDI numbers at concert (sounding) pitch. A transposing instrument sounds
// `tr.semis` semitones (and `tr.steps` letter-names) away from what is written.

export const FAMILIES = [
  ['wind', 'Woodwinds'], ['brass', 'Brass'], ['perc', 'Percussion'], ['keys', 'Keyboards'], ['pluck', 'Harp and guitars'],
  ['voice', 'Voices'], ['str', 'Strings'],
];

const T = (steps, semis) => ({ steps, semis });
const C = T(0, 0);
// clefs: treble, bass, alto, tenor, treble8 (sounds an octave lower), bass8 (octave lower), perc
const I = (id, name, abbr, fam, clefs, range, sound, tr = C, extra = {}) => ({ id, name, abbr, fam, clefs, range, sound, tr, ...extra });

export const INSTRUMENTS = [
  // ---- woodwinds
  I('piccolo', 'Piccolo', 'Picc.', 'wind', ['treble'], [74, 108], 'piccolo', T(7, 12)),
  I('flute', 'Flute', 'Fl.', 'wind', ['treble'], [59, 98], 'flute'),
  I('altoflute', 'Alto Flute', 'A. Fl.', 'wind', ['treble'], [55, 91], 'flute', T(-3, -5)),
  I('bassflute', 'Bass Flute', 'B. Fl.', 'wind', ['treble'], [48, 84], 'flute', T(-7, -12)),
  I('recorder', 'Recorder (alto)', 'Rec.', 'wind', ['treble'], [65, 98], 'recorder'),
  I('sopranorecorder', 'Recorder (soprano)', 'S. Rec.', 'wind', ['treble'], [72, 103], 'recorder', T(7, 12)),
  I('oboe', 'Oboe', 'Ob.', 'wind', ['treble'], [58, 91], 'oboe'),
  I('oboedamore', 'Oboe d’amore', 'Ob. d’am.', 'wind', ['treble'], [56, 88], 'oboe', T(-2, -3)),
  I('englishhorn', 'English Horn', 'E. H.', 'wind', ['treble'], [52, 84], 'englishhorn', T(-4, -7)),
  I('clarinetEb', 'Clarinet in E♭', 'E♭ Cl.', 'wind', ['treble'], [55, 94], 'clarinet', T(2, 3)),
  I('clarinet', 'Clarinet in B♭', 'Cl.', 'wind', ['treble'], [50, 94], 'clarinet', T(-1, -2)),
  I('clarinetA', 'Clarinet in A', 'Cl. (A)', 'wind', ['treble'], [49, 93], 'clarinet', T(-2, -3)),
  I('bassclarinet', 'Bass Clarinet in B♭', 'B. Cl.', 'wind', ['treble'], [34, 77], 'clarinet', T(-8, -14)),
  I('bassoon', 'Bassoon', 'Bsn.', 'wind', ['bass'], [34, 75], 'bassoon'),
  I('contrabassoon', 'Contrabassoon', 'Cbsn.', 'wind', ['bass'], [22, 53], 'bassoon', T(-7, -12)),
  I('sopsax', 'Soprano Saxophone', 'S. Sax.', 'wind', ['treble'], [56, 88], 'sopsax', T(-1, -2)),
  I('altosax', 'Alto Saxophone', 'A. Sax.', 'wind', ['treble'], [49, 81], 'altosax', T(-5, -9)),
  I('tenorsax', 'Tenor Saxophone', 'T. Sax.', 'wind', ['treble'], [44, 76], 'tenorsax', T(-8, -14)),
  I('barisax', 'Baritone Saxophone', 'B. Sax.', 'wind', ['treble'], [36, 69], 'barisax', T(-12, -21)),
  // ---- brass
  I('horn', 'Horn in F', 'Hn.', 'brass', ['treble'], [34, 77], 'horn', T(-4, -7)),
  I('trumpet', 'Trumpet in B♭', 'Tpt.', 'brass', ['treble'], [52, 84], 'trumpet', T(-1, -2)),
  I('trumpetC', 'Trumpet in C', 'Tpt. (C)', 'brass', ['treble'], [54, 86], 'trumpet'),
  I('piccolotrumpet', 'Piccolo Trumpet in A', 'Picc. Tpt.', 'brass', ['treble'], [61, 94], 'trumpet', T(5, 9)),
  I('cornet', 'Cornet in B♭', 'Cor.', 'brass', ['treble'], [52, 82], 'trumpet', T(-1, -2)),
  I('flugelhorn', 'Flugelhorn', 'Flg.', 'brass', ['treble'], [52, 80], 'trumpet', T(-1, -2)),
  I('trombone', 'Trombone', 'Tbn.', 'brass', ['bass'], [40, 72], 'trombone'),
  I('basstrombone', 'Bass Trombone', 'B. Tbn.', 'brass', ['bass'], [34, 67], 'trombone'),
  I('euphonium', 'Euphonium', 'Euph.', 'brass', ['bass'], [34, 70], 'trombone'),
  // brass band: written in treble clef, sounding lower
  I('euphoniumTC', 'Euphonium in B♭ (treble clef)', 'Euph.', 'brass', ['treble'], [34, 70], 'trombone', T(-8, -14)),
  I('baritone', 'Baritone in B♭ (treble clef)', 'Bar.', 'brass', ['treble'], [40, 70], 'trombone', T(-8, -14)),
  I('tenorhorn', 'Tenor Horn in E♭', 'T. Hn.', 'brass', ['treble'], [46, 77], 'horn', T(-5, -9)),
  I('tromboneTC', 'Trombone in B♭ (treble clef)', 'Tbn.', 'brass', ['treble'], [40, 72], 'trombone', T(-8, -14)),
  I('tubaEb', 'E♭ Bass (treble clef)', 'E♭ Bass', 'brass', ['treble'], [28, 63], 'tuba', T(-19, -33)),
  I('tubaBb', 'B♭ Bass (treble clef)', 'B♭ Bass', 'brass', ['treble'], [26, 60], 'tuba', T(-15, -26)),
  I('tuba', 'Tuba', 'Tba.', 'brass', ['bass'], [26, 65], 'tuba'),
  // ---- percussion
  I('timpani', 'Timpani', 'Timp.', 'perc', ['bass'], [38, 57], 'timpani'),
  I('glockenspiel', 'Glockenspiel', 'Glock.', 'perc', ['treble'], [79, 108], 'glockenspiel', T(14, 24)),
  I('xylophone', 'Xylophone', 'Xyl.', 'perc', ['treble'], [65, 108], 'xylophone', T(7, 12)),
  I('vibraphone', 'Vibraphone', 'Vib.', 'perc', ['treble'], [53, 89], 'vibraphone'),
  I('marimba', 'Marimba', 'Mar.', 'perc', ['treble', 'bass'], [45, 96], 'marimba', C, { brace: true }),
  I('tubularbells', 'Tubular Bells', 'T. Bells', 'perc', ['treble'], [60, 77], 'bells'),
  I('snare', 'Snare Drum', 'S. D.', 'perc', ['perc'], [60, 60], 'drum', C, { unpitched: 60 }),
  I('bassdrum', 'Bass Drum', 'B. D.', 'perc', ['perc'], [36, 36], 'drum', C, { unpitched: 36 }),
  I('woodblock', 'Wood Block', 'W. B.', 'perc', ['perc'], [72, 72], 'woodblock', C, { unpitched: 72 }),
  I('drumset', 'Drum Set', 'D. S.', 'perc', ['perc'], [36, 72], 'drum', C, { unpitched: 48 }),
  // ---- keyboards
  I('piano', 'Piano', 'Pno.', 'keys', ['treble', 'bass'], [21, 108], 'piano', C, { brace: true }),
  I('harpsichord', 'Harpsichord', 'Hpsd.', 'keys', ['treble', 'bass'], [29, 89], 'harpsichord', C, { brace: true }),
  I('organ', 'Organ', 'Org.', 'keys', ['treble', 'bass', 'bass'], [24, 96], 'organ', C, { brace: true, braceStaves: 2 }),
  I('celesta', 'Celesta', 'Cel.', 'keys', ['treble', 'bass'], [60, 108], 'celesta', T(7, 12), { brace: true }),
  I('epiano', 'Electric Piano', 'E. Pno.', 'keys', ['treble', 'bass'], [28, 103], 'epiano', C, { brace: true }),
  I('accordion', 'Accordion', 'Acc.', 'keys', ['treble', 'bass'], [41, 93], 'accordion', C, { brace: true }),
  // ---- harp and guitars
  I('harp', 'Harp', 'Hp.', 'pluck', ['treble', 'bass'], [24, 103], 'harp', C, { brace: true }),
  I('guitar', 'Classical Guitar', 'Gtr.', 'pluck', ['treble8'], [40, 88], 'guitar', C),
  I('steelguitar', 'Acoustic Guitar', 'A. Gtr.', 'pluck', ['treble8'], [40, 88], 'steelguitar', C),
  I('eguitar', 'Electric Guitar', 'E. Gtr.', 'pluck', ['treble8'], [40, 88], 'eguitar', C),
  I('bassguitar', 'Bass Guitar', 'B. Gtr.', 'pluck', ['bass8'], [28, 67], 'ebass', C),
  I('mandolin', 'Mandolin', 'Mand.', 'pluck', ['treble'], [55, 88], 'mandolin'),
  I('banjo', 'Banjo', 'Bjo.', 'pluck', ['treble8'], [48, 84], 'banjo', C),
  I('ukulele', 'Ukulele', 'Uke.', 'pluck', ['treble'], [60, 81], 'guitar'),
  // ---- voices
  I('soprano', 'Soprano', 'S.', 'voice', ['treble'], [60, 84], 'choir', C, { voice: true }),
  I('mezzo', 'Mezzo-soprano', 'Mez.', 'voice', ['treble'], [57, 81], 'choir', C, { voice: true }),
  I('alto', 'Alto', 'A.', 'voice', ['treble'], [53, 77], 'choir', C, { voice: true }),
  I('tenor', 'Tenor', 'T.', 'voice', ['treble8'], [48, 72], 'choir', C, { voice: true }),
  I('baritone', 'Baritone', 'Bar.', 'voice', ['bass'], [43, 67], 'choir', C, { voice: true }),
  I('bass', 'Bass', 'B.', 'voice', ['bass'], [40, 64], 'choir', C, { voice: true }),
  I('voice', 'Voice', 'V.', 'voice', ['treble'], [55, 81], 'oohs', C, { voice: true }),
  // ---- strings
  I('violin', 'Violin', 'Vln.', 'str', ['treble'], [55, 103], 'violin'),
  I('violin1', 'Violin I', 'Vln. I', 'str', ['treble'], [55, 103], 'strings', C, { section: true }),
  I('violin2', 'Violin II', 'Vln. II', 'str', ['treble'], [55, 103], 'strings', C, { section: true }),
  I('viola', 'Viola', 'Vla.', 'str', ['alto'], [48, 91], 'viola'),
  I('violas', 'Violas', 'Vla.', 'str', ['alto'], [48, 91], 'strings', C, { section: true }),
  I('cello', 'Violoncello', 'Vc.', 'str', ['bass'], [36, 84], 'cello'),
  I('cellos', 'Violoncellos', 'Vc.', 'str', ['bass'], [36, 84], 'strings', C, { section: true }),
  I('contrabass', 'Double Bass', 'Cb.', 'str', ['bass8'], [28, 67], 'bass', C),
  I('contrabasses', 'Contrabasses', 'Cb.', 'str', ['bass8'], [28, 67], 'strings', C, { section: true }),
];
export const INST = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));
// score order: the index of each family decides where a new instrument goes
export const FAMILY_ORDER = ['wind', 'brass', 'perc', 'keys', 'pluck', 'voice', 'str'];

// Ensembles, the way professional notation programs offer them.
export const ENSEMBLES = [
  { id: 'blank', name: 'Choose instruments', group: 'Start', insts: [] },
  { id: 'piano', name: 'Piano', group: 'Solo', insts: ['piano'] },
  { id: 'violin', name: 'Solo Violin', group: 'Solo', insts: ['violin'] },
  { id: 'cello', name: 'Solo Cello', group: 'Solo', insts: ['cello'] },
  { id: 'flute', name: 'Solo Flute', group: 'Solo', insts: ['flute'] },
  { id: 'guitar', name: 'Guitar', group: 'Solo', insts: ['guitar'] },
  { id: 'organ', name: 'Organ', group: 'Solo', insts: ['organ'] },
  { id: 'leadsheet', name: 'Lead Sheet', group: 'Solo', insts: ['voice'] },
  { id: 'violinpiano', name: 'Violin and Piano', group: 'Duos', insts: ['violin', 'piano'] },
  { id: 'cellopiano', name: 'Cello and Piano', group: 'Duos', insts: ['cello', 'piano'] },
  { id: 'violapiano', name: 'Viola and Piano', group: 'Duos', insts: ['viola', 'piano'] },
  { id: 'flutepiano', name: 'Flute and Piano', group: 'Duos', insts: ['flute', 'piano'] },
  { id: 'clarinetpiano', name: 'Clarinet and Piano', group: 'Duos', insts: ['clarinet', 'piano'] },
  { id: 'voicepiano', name: 'Voice and Piano', group: 'Duos', insts: ['voice', 'piano'] },
  { id: 'pianoduet', name: 'Two Pianos', group: 'Duos', insts: ['piano', 'piano'] },
  { id: 'stringtrio', name: 'String Trio', group: 'Chamber', insts: ['violin', 'viola', 'cello'] },
  { id: 'stringquartet', name: 'String Quartet', group: 'Chamber', insts: ['violin', 'violin', 'viola', 'cello'] },
  { id: 'stringquintet', name: 'String Quintet', group: 'Chamber', insts: ['violin', 'violin', 'viola', 'viola', 'cello'] },
  { id: 'pianotrio', name: 'Piano Trio', group: 'Chamber', insts: ['violin', 'cello', 'piano'] },
  { id: 'pianoquartet', name: 'Piano Quartet', group: 'Chamber', insts: ['violin', 'viola', 'cello', 'piano'] },
  { id: 'pianoquintet', name: 'Piano Quintet', group: 'Chamber', insts: ['violin', 'violin', 'viola', 'cello', 'piano'] },
  { id: 'windquintet', name: 'Wind Quintet', group: 'Chamber', insts: ['flute', 'oboe', 'clarinet', 'horn', 'bassoon'] },
  { id: 'brassquintet', name: 'Brass Quintet', group: 'Chamber', insts: ['trumpet', 'trumpet', 'horn', 'trombone', 'tuba'] },
  { id: 'saxquartet', name: 'Saxophone Quartet', group: 'Chamber', insts: ['sopsax', 'altosax', 'tenorsax', 'barisax'] },
  { id: 'clarinettrio', name: 'Clarinet Trio', group: 'Chamber', insts: ['clarinet', 'cello', 'piano'] },
  { id: 'satb', name: 'Choir SATB', group: 'Voices', insts: ['soprano', 'alto', 'tenor', 'bass'] },
  { id: 'satbpiano', name: 'Choir SATB and Piano', group: 'Voices', insts: ['soprano', 'alto', 'tenor', 'bass', 'piano'] },
  { id: 'stringorch', name: 'String Orchestra', group: 'Orchestra', insts: ['violin1', 'violin2', 'violas', 'cellos', 'contrabasses'] },
  { id: 'chamberorch', name: 'Chamber Orchestra', group: 'Orchestra', insts: ['flute', 'oboe', 'clarinet', 'bassoon', 'horn', 'trumpet', 'timpani', 'violin1', 'violin2', 'violas', 'cellos', 'contrabasses'] },
  { id: 'classicalorch', name: 'Classical Orchestra', group: 'Orchestra', insts: ['flute', 'flute', 'oboe', 'oboe', 'clarinet', 'clarinet', 'bassoon', 'bassoon', 'horn', 'horn', 'trumpet', 'trumpet', 'timpani', 'violin1', 'violin2', 'violas', 'cellos', 'contrabasses'] },
  { id: 'fullorch', name: 'Symphony Orchestra', group: 'Orchestra', insts: ['piccolo', 'flute', 'flute', 'oboe', 'oboe', 'englishhorn', 'clarinet', 'clarinet', 'bassclarinet', 'bassoon', 'bassoon', 'contrabassoon', 'horn', 'horn', 'horn', 'horn', 'trumpet', 'trumpet', 'trumpet', 'trombone', 'trombone', 'basstrombone', 'tuba', 'timpani', 'glockenspiel', 'harp', 'piano', 'violin1', 'violin2', 'violas', 'cellos', 'contrabasses'] },
  { id: 'concertband', name: 'Concert Band', group: 'Band', insts: ['piccolo', 'flute', 'oboe', 'bassoon', 'clarinetEb', 'clarinet', 'clarinet', 'bassclarinet', 'altosax', 'tenorsax', 'barisax', 'trumpet', 'trumpet', 'horn', 'trombone', 'euphonium', 'tuba', 'timpani', 'glockenspiel', 'snare', 'bassdrum'] },
  { id: 'bigband', name: 'Jazz Big Band', group: 'Band', insts: ['altosax', 'altosax', 'tenorsax', 'tenorsax', 'barisax', 'trumpet', 'trumpet', 'trumpet', 'trumpet', 'trombone', 'trombone', 'trombone', 'basstrombone', 'eguitar', 'piano', 'contrabass', 'drumset'] },
  { id: 'jazzcombo', name: 'Jazz Combo', group: 'Band', insts: ['tenorsax', 'trumpet', 'piano', 'contrabass', 'drumset'] },
  { id: 'rockband', name: 'Rock Band', group: 'Band', insts: ['voice', 'eguitar', 'bassguitar', 'piano', 'drumset'] },
];

// Rastral staff sizes (staff height in millimetres), as engravers name them.
export const STAFF_SIZES = [
  { n: 0, mm: 9.2, use: 'Teaching, very large' }, { n: 1, mm: 7.9, use: 'Large solo parts' }, { n: 2, mm: 7.4, use: 'Solo parts' },
  { n: 3, mm: 7.0, use: 'Solo music, parts' }, { n: 4, mm: 6.5, use: 'Chamber music' }, { n: 5, mm: 6.0, use: 'Small ensembles, choir' },
  { n: 6, mm: 5.5, use: 'Choral and band scores' }, { n: 7, mm: 4.8, use: 'Orchestral scores' }, { n: 8, mm: 3.7, use: 'Full orchestral scores' },
];
export const PAGE_SIZES = { A4: [210, 297], Letter: [215.9, 279.4], A3: [297, 420], Tabloid: [279.4, 431.8], B4: [250, 353] };

// A sensible default staff size for how many staves the score has.
export function defaultStaffSize(nStaves) {
  if (nStaves <= 2) return 7.0;
  if (nStaves <= 4) return 6.5;
  if (nStaves <= 6) return 6.0;
  if (nStaves <= 10) return 5.5;
  if (nStaves <= 16) return 4.8;
  return 3.7;
}
