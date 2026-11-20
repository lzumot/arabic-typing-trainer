// macOS "Arabic - PC" layout, mapped from physical US ANSI codes.
// event.code is layout independent, so this stays valid even if he swaps layouts.
// Verified keys are the letters; the shift layer for vowel marks is best-effort
// (tashkeel is out of scope for v1, only hamza forms are used for classification).

export const LAYOUT = {
  Backquote: ['ذ', null],
  Digit1: ['١', '!'], Digit2: ['٢', '@'], Digit3: ['٣', '#'], Digit4: ['٤', '$'],
  Digit5: ['٥', '%'], Digit6: ['٦', '^'], Digit7: ['٧', '&'], Digit8: ['٨', '*'],
  Digit9: ['٩', '('], Digit0: ['٠', ')'],
  Minus: ['-', '_'], Equal: ['=', '+'],
  KeyQ: ['ض', 'َ'], KeyW: ['ص', 'ً'], KeyE: ['ث', 'ُ'], KeyR: ['ق', 'ٌ'],
  KeyT: ['ف', 'لإ'], KeyY: ['غ', 'إ'], KeyU: ['ع', 'ِ'], KeyI: ['ه', 'ٍ'],
  KeyO: ['خ', ']'], KeyP: ['ح', '['],
  BracketLeft: ['ج', '{'], BracketRight: ['د', '}'], Backslash: ['\\', '|'],
  KeyA: ['ش', null], KeyS: ['س', null], KeyD: ['ي', null], KeyF: ['ب', null],
  KeyG: ['ل', 'لأ'], KeyH: ['ا', 'أ'], KeyJ: ['ت', 'ـ'], KeyK: ['ن', null],
  KeyL: ['م', null], Semicolon: ['ك', null], Quote: ['ط', null],
  KeyZ: ['ئ', null], KeyX: ['ء', null], KeyC: ['ؤ', null], KeyV: ['ر', null],
  KeyB: ['لا', null], KeyN: ['ى', null], KeyM: ['ة', null],
  Comma: ['و', null], Period: ['ز', null], Slash: ['ظ', null],
};

export const ROWS = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
   'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO',
   'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL',
   'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period',
   'Slash'],
];
const STAGGER = [0, 1.5, 1.75, 2.25];

const POSITIONS = {};
ROWS.forEach((row, r) => row.forEach((code, i) => {
  POSITIONS[code] = { x: i + STAGGER[r], y: r };
}));

const NEIGHBOURS = {};
Object.keys(POSITIONS).forEach((code) => {
  const a = POSITIONS[code];
  NEIGHBOURS[code] = Object.keys(POSITIONS).filter((other) => {
    if (other === code) return false;
    const b = POSITIONS[other];
    const dy = Math.abs(a.y - b.y);
    const dx = Math.abs(a.x - b.x);
    return dy <= 1 && dx <= 1.25 && !(dy === 0 && dx > 1.2);
  });
});

export function neighboursOf(code) {
  return NEIGHBOURS[code] || [];
}

// char -> { code, shift }
export const CHAR_TO_KEY = {};
Object.entries(LAYOUT).forEach(([code, [base, shift]]) => {
  if (base && !CHAR_TO_KEY[base]) CHAR_TO_KEY[base] = { code, shift: 0 };
  if (shift && !CHAR_TO_KEY[shift]) CHAR_TO_KEY[shift] = { code, shift: 1 };
});

// Confusable sets from the PRD, expanded to the hamza seats that appear in text.
export const CONFUSABLE = [
  ['ة', 'ه'],
  ['ى', 'ي'],
  ['أ', 'إ', 'ا'],
  ['ئ', 'ؤ', 'ء'],
  ['ذ', 'ز', 'ظ'],
  ['ض', 'ص'],
  ['س', 'ش'],
  ['ت', 'ث'],
  ['ك', 'ق'],
  ['ح', 'خ', 'ج'],
  ['د'],
  ['ر'],
];

export function confusablesOf(ch) {
  const set = CONFUSABLE.find((group) => group.includes(ch));
  return set ? set.filter((c) => c !== ch) : [];
}

export function sameConfusableSet(a, b) {
  return a !== b && CONFUSABLE.some((group) => group.includes(a) && group.includes(b));
}

// The ten letters tracked in the manual letter hunt.
export const HUNT_LETTERS = ['ذ', 'ض', 'ظ', 'ة', 'ى', 'أ', 'إ', 'ء', 'ئ', 'ؤ'];

export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const LATIN_RE = /^[A-Za-z]$/;

export function isArabicChar(ch) {
  return !!ch && ARABIC_RE.test(ch) && ch.length === 1;
}

export function isLatinChar(ch) {
  return !!ch && LATIN_RE.test(ch);
}

// The Arabic PC layout produces "لا" as a single keystroke for a two-char sequence.
export function chunkAt(text, index) {
  if (text.startsWith('لا', index)) return 'لا';
  return text[index] || '';
}

export function expectedKey(ch) {
  return CHAR_TO_KEY[ch] || null;
}

// Everything needed to classify a wrong keystroke.
export function classifyError(expected, key, code, shift) {
  if (key === expected) return null;
  if (sameConfusableSet(expected, key)) return 'spelling';
  const target = CHAR_TO_KEY[expected];
  if (target && target.code === code) {
    const pressedShift = shift ? 1 : 0;
    if (pressedShift !== target.shift) return 'shift';
  }
  if (target && neighboursOf(target.code).includes(code)) return 'neighbour';
  return 'location';
}

export const ARABIC_LETTERS = ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر',
  'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن',
  'ه', 'و', 'ي', 'ء', 'أ', 'إ', 'ئ', 'ؤ', 'ة', 'ى'];
