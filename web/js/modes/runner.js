import { chunkAt } from '../keymap.js';

// Shared text-typing surface: used by Ghost race, Boss chunks and Duel.
// Reaction time is not measured here (the whole text is visible at once), so
// `appeared` is null and these rows never enter per-letter reaction stats.
export class TextRunner {
  constructor({ app, tracker, text, el, onDone, onWrong, onProgress }) {
    this.app = app;
    this.tracker = tracker;
    this.text = text;
    this.el = el;
    this.onDone = onDone || (() => {});
    this.onWrong = onWrong || (() => {});
    this.onProgress = onProgress || (() => {});
    this.cursor = 0;
    this.spans = [];
    this.render();
  }

  render() {
    this.el.innerHTML = '';
    this.spans = [];
    let i = 0;
    while (i < this.text.length) {
      const chunk = chunkAt(this.text, i);
      if (!chunk) break;
      const span = document.createElement('span');
      span.className = 'ch';
      if (chunk === ' ') {
        span.className += ' space';
        span.innerHTML = '&nbsp;';
      } else {
        span.textContent = chunk;
      }
      this.el.appendChild(span);
      this.spans.push(span);
      i += chunk.length;
    }
    if (this.spans[0]) this.spans[0].classList.add('current');
  }

  key(ev) {
    if (ev.key.length !== 1 && ev.key !== 'لا') return 'ignored';
    if (ev.metaKey || ev.ctrlKey) return 'ignored';
    const expected = chunkAt(this.text, this.cursor);
    if (!expected) return 'ignored';
    const span = this.spans[this.spanIndex()];
    const correct = ev.key === expected;
    this.tracker.log({
      expected,
      key: ev.key,
      code: ev.code,
      shift: ev.shiftKey,
      correct,
      appeared: null,
    });
    if (correct) {
      if (span) {
        span.classList.remove('current', 'bad');
        span.classList.add('done');
      }
      this.cursor += expected.length;
      if (this.cursor >= this.text.length || this.text[this.cursor] === ' ') {
        if (this.app.score) this.app.score.word();
      }
      const next = this.spans[this.spanIndex()];
      if (next) next.classList.add('current');
      this.app.audio.play('pop');
      this.onProgress(this.progress());
      if (this.cursor >= this.text.length) this.onDone();
      return 'correct';
    }
    if (span) {
      span.classList.add('bad');
      clearTimeout(this.badTimer);
      this.badTimer = setTimeout(() => span.classList.remove('bad'), 320);
    }
    this.app.audio.play('wobble');
    this.onWrong(ev.key, expected);
    return 'wrong';
  }

  spanIndex() {
    let index = 0;
    let i = 0;
    while (i < this.cursor) {
      i += chunkAt(this.text, i).length;
      index += 1;
    }
    return index;
  }

  progress() {
    return this.text.length ? this.cursor / this.text.length : 0;
  }

  destroy() {
    clearTimeout(this.badTimer);
  }
}
