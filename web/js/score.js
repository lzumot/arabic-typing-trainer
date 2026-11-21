// Daily score keeper. Points only ever go up: a wrong key scores nothing and
// breaks the streak, it never subtracts. One meta row per day, so the number
// survives reloads and restarts.

const pad = (n) => String(n).padStart(2, '0');

const MODE_LABELS = {
  pop: 'Pop',
  twins: 'Twins',
  ghost: 'Ghost race',
  duel: 'Duel',
  'duel-tutor': 'Duel',
  boss: 'Boss text',
  writer: 'Writer',
};

export function dayKey(date) {
  const d = date || new Date();
  return 'score:' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export class ScoreBoard {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('score');
    this.pointsEl = document.getElementById('score-points');
    this.subEl = document.getElementById('score-sub');
    this.roundEl = document.getElementById('score-round');
    this.key = dayKey();
    this.reset();
    this.roundStart = 0;
    this.roundMode = '';
    this.roundPoints = 0;
    this.dirty = false;
  }

  reset() {
    this.points = 0;
    this.correctChars = 0;
    this.wrongKeys = 0;
    this.words = 0;
    this.rounds = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  load() {
    this.key = dayKey();
    this.reset();
    const raw = this.app.readMeta(this.key, '');
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        ['points', 'correctChars', 'wrongKeys', 'words', 'rounds', 'bestStreak']
          .forEach((field) => {
            if (Number.isFinite(saved[field])) this[field] = saved[field];
          });
      } catch (err) {
        console.warn('[score] unreadable day row, starting fresh', err);
      }
    }
    this.render();
  }

  snapshot() {
    return JSON.stringify({
      points: this.points,
      correctChars: this.correctChars,
      wrongKeys: this.wrongKeys,
      words: this.words,
      rounds: this.rounds,
      bestStreak: this.bestStreak,
    });
  }

  save() {
    this.app.writeMeta(this.key, this.snapshot());
    this.dirty = false;
  }

  flush() {
    if (this.dirty) this.save();
  }

  checkDay() {
    const today = dayKey();
    if (today === this.key) return;
    this.save();
    this.key = today;
    this.reset();
    this.dirty = true;
    this.render();
  }

  // A correct key is worth 1. A wrong key is worth 0 and ends the streak.
  keystroke(correct) {
    if (correct) {
      this.points += 1;
      this.correctChars += 1;
      this.roundPoints += 1;
      this.streak += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    } else {
      this.wrongKeys += 1;
      this.streak = 0;
    }
    this.dirty = true;
    this.render();
  }

  // A whole correct word is worth 5 on top of its letters.
  word() {
    this.points += 5;
    this.roundPoints += 5;
    this.words += 1;
    this.dirty = true;
    this.render();
  }

  startRound(mode) {
    this.roundMode = MODE_LABELS[mode] || mode || '';
    this.roundStart = Date.now();
    this.roundPoints = 0;
    this.render();
  }

  setLabel(label) {
    if (!label) return;
    this.roundMode = label;
    this.render();
  }

  endRound() {
    if (this.roundStart) this.rounds += 1;
    this.roundStart = 0;
    this.roundMode = '';
    this.dirty = true;
    this.save();
    this.render();
  }

  accuracy() {
    const total = this.correctChars + this.wrongKeys;
    return total ? Math.round((this.correctChars / total) * 100) : null;
  }

  elapsed() {
    const seconds = Math.max(0, Math.floor((Date.now() - this.roundStart) / 1000));
    return pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60);
  }

  render() {
    if (!this.el) return;
    this.el.hidden = false;
    this.pointsEl.textContent = this.points.toLocaleString();
    const bits = [];
    const acc = this.accuracy();
    if (acc != null) bits.push(acc + '%');
    bits.push(this.words + (this.words === 1 ? ' word' : ' words'));
    bits.push(this.rounds + (this.rounds === 1 ? ' round' : ' rounds'));
    this.subEl.textContent = bits.join(' · ');
    if (this.roundStart) {
      this.roundEl.hidden = false;
      this.roundEl.textContent = this.roundMode + ' · ' + this.elapsed()
        + ' · +' + this.roundPoints + ' · streak ' + this.streak;
    } else {
      this.roundEl.hidden = true;
    }
  }
}
