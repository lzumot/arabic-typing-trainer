// All metrics are derived from raw keystroke rows, so older data stays useful
// when a definition changes.

export const HUNT_MS = 1500;
export const HUNT_FACTOR = 2;

export function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

export function mean(values) {
  const list = values.filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

export function byRound(keystrokes) {
  const map = new Map();
  keystrokes.forEach((k) => {
    if (!map.has(k.round_id)) map.set(k.round_id, []);
    map.get(k.round_id).push(k);
  });
  return map;
}

// One entry per item presentation: expected char + when it appeared.
export function presentationKey(k) {
  return k.round_id + '|' + Number(k.appeared) + '|' + (k.expected || '');
}

export function reactionTimes(keystrokes) {
  const first = new Map();
  keystrokes.forEach((k) => {
    if (!k.correct) return;
    if (k.appeared == null) return;
    const key = presentationKey(k);
    const rt = Number(k.t) - Number(k.appeared);
    if (!Number.isFinite(rt) || rt < 0) return;
    if (!first.has(key) || rt < first.get(key)) first.set(key, rt);
  });
  return [...first.entries()].map(([key, rt]) => {
    const expected = key.split('|').slice(2).join('|');
    return { key, expected, rt };
  });
}

export function letterMedians(keystrokes) {
  const groups = new Map();
  reactionTimes(keystrokes).forEach(({ expected, rt }) => {
    if (!groups.has(expected)) groups.set(expected, []);
    groups.get(expected).push(rt);
  });
  const out = {};
  groups.forEach((list, ch) => {
    out[ch] = { median: median(list), n: list.length };
  });
  return out;
}

// A letter is a hunt if it is slow in absolute terms, or slow against its own history.
export function huntFlags(current, history) {
  const flags = {};
  Object.entries(current).forEach(([ch, stat]) => {
    if (!stat || stat.median == null || stat.n < 3) {
      flags[ch] = false;
      return;
    }
    const own = history && history[ch] ? history[ch].median : null;
    const slowAbsolute = stat.median > HUNT_MS;
    const slowAgainstSelf = own && stat.median > own * HUNT_FACTOR;
    flags[ch] = !!(slowAbsolute || slowAgainstSelf);
  });
  return flags;
}

export function errorCounts(keystrokes) {
  const out = { spelling: 0, shift: 0, neighbour: 0, location: 0 };
  keystrokes.forEach((k) => {
    if (k.correct) return;
    if (k.error_class in out) out[k.error_class] += 1;
  });
  return out;
}

export function confusionTable(keystrokes) {
  const map = new Map();
  keystrokes.forEach((k) => {
    if (k.correct || k.error_class !== 'spelling') return;
    const id = (k.expected || '?') + '→' + (k.key || '?');
    map.set(id, (map.get(id) || 0) + 1);
  });
  return [...map.entries()]
    .map(([pair, n]) => ({ pair, n }))
    .sort((a, b) => b.n - a.n);
}

export function roundMetrics(keystrokes, durationMs) {
  const total = keystrokes.length;
  const correct = keystrokes.filter((k) => k.correct).length;
  const minutes = Math.max(durationMs, 1) / 60000;
  let run = 0;
  let cleanRun = 0;
  keystrokes.forEach((k) => {
    if (k.correct) {
      run += 1;
      if (run > cleanRun) cleanRun = run;
    } else {
      run = 0;
    }
  });
  const cpm = correct / minutes;
  return {
    chars: correct,
    mistakes: total - correct,
    accuracy: total ? correct / total : 0,
    cpm,
    wpm: cpm / 5,
    cleanRun,
    items: total,
  };
}

export function sessionStats(session, rounds, keystrokes, signals) {
  const rs = rounds.filter((r) => r.session_id === session.id);
  const ks = keystrokes.filter((k) => rs.some((r) => r.id === k.round_id));
  const correct = ks.filter((k) => k.correct).length;
  const minutes = Math.max(1, (Math.max(session.end || 0, session.start) - session.start)) / 60000;
  const cpm = minutes ? correct / minutes : 0;
  return {
    id: session.id,
    start: session.start,
    end: session.end,
    rounds: rs.length,
    chars: correct,
    keystrokes: ks.length,
    accuracy: ks.length ? correct / ks.length : null,
    cpm,
    wpm: cpm / 5,
    minutes,
    signals: signals.filter((s) => s.session_id === session.id).length,
    rating: session.tutor_rating || session.frust_rating || null,
    notes: session.notes || '',
    continued: rs.filter((r) => r.continued).length,
    modes: [...new Set(rs.map((r) => r.mode))],
  };
}

export function weekKey(ms) {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function weeklyMedians(sessions, key) {
  const groups = new Map();
  sessions.forEach((s) => {
    const v = s[key];
    if (v == null || !Number.isFinite(v) || v === 0) return;
    const w = weekKey(s.start);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(v);
  });
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, values]) => ({ week, value: median(values), n: values.length }));
}

export function adaptationScore(history) {
  // Higher score = slower letter = needs more practice. Unknown letters sit mid.
  const out = {};
  Object.entries(history || {}).forEach(([ch, stat]) => {
    out[ch] = stat && stat.median ? Math.min(3, stat.median / 900) : 1;
  });
  return out;
}

export function weightedPick(items, weightOf) {
  const weights = items.map((item) => Math.max(0.05, weightOf(item)));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function formatSeconds(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return (ms / 1000).toFixed(1) + ' s';
}
