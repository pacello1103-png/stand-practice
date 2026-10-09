// Tuning systems, note names and instruments shared by the tuner, drone and scale player.
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

// Frequency ratios above the key note for each of the 12 semitones.
export const SYSTEMS = {
  equal: { label: 'Equal', long: 'Equal temperament', ratios: null },
  just: { label: 'Just', long: 'Just (pure thirds and fifths)', ratios: [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8] },
  pyth: { label: 'Pythagorean', long: 'Pythagorean (pure fifths, high leading notes)', ratios: [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128] },
};

// Cents that a note sits away from equal temperament in the chosen system and key.
export function centsOffset(pc, key, system) {
  const sys = SYSTEMS[system];
  if (!sys || !sys.ratios) return 0;
  const d = (((pc - key) % 12) + 12) % 12;
  return 1200 * Math.log2(sys.ratios[d]) - 100 * d;
}

export const etFreq = (midi, ref) => ref * Math.pow(2, (midi - 69) / 12);
export const tunedFreq = (midi, ref, key, system) => etFreq(midi, ref) * Math.pow(2, centsOffset(((midi % 12) + 12) % 12, key, system) / 1200);
export const midiName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export const INSTRUMENTS = {
  cello: { label: 'Cello', strings: [36, 43, 50, 57], fifths: true, words: ['cello', 'violoncell', 'violoncelle', 'vc.', 'vlc', 'violoncello'] },
  violin: { label: 'Violin', strings: [55, 62, 69, 76], fifths: true, words: ['violin', 'violino', 'violon ', 'violine', 'vn.'] },
  viola: { label: 'Viola', strings: [48, 55, 62, 69], fifths: true, words: ['viola', 'alto', 'bratsche'] },
  bass: { label: 'Double bass', strings: [28, 33, 38, 43], fifths: false, words: ['double bass', 'contrabass', 'contrabbasso', 'kontrabass', 'bass'] },
  guitar: { label: 'Guitar', strings: [40, 45, 50, 55, 59, 64], fifths: false, words: ['guitar', 'chitarra', 'guitare', 'gitarre'] },
  flute: { label: 'Flute', strings: null, words: ['flute', 'flauto', 'flöte', 'flote', 'traverso'] },
  clarinet: { label: 'Clarinet', strings: null, words: ['clarinet', 'clarinetto', 'klarinette', 'clarinette'] },
  oboe: { label: 'Oboe', strings: null, words: ['oboe', 'hautbois'] },
  piano: { label: 'Piano', strings: null, words: ['piano', 'pianoforte', 'klavier', 'keyboard'] },
  voice: { label: 'Voice', strings: null, words: ['voice', 'soprano', 'alto', 'tenor', 'baritone', 'vocal', 'gesang', 'canto'] },
  other: { label: 'Other', strings: null, words: [] },
};

// Open-string targets. Bowed strings can be tuned in pure 3:2 fifths from the A string.
export function stringTargets(inst, ref, pureFifths) {
  const def = INSTRUMENTS[inst];
  if (!def || !def.strings) return [];
  const s = def.strings;
  const aIdx = s.findIndex((m) => m % 12 === 9);
  return s.map((m, i) => {
    let f = etFreq(m, ref);
    if (pureFifths && def.fifths && aIdx >= 0) f = etFreq(s[aIdx], ref) * Math.pow(1.5, i - aIdx);
    return { midi: m, name: NOTE_NAMES[m % 12], label: midiName(m), freq: f };
  });
}
