// Writes one round plus its raw keystrokes. Metrics are computed from the raw
// rows, never from anything pre-aggregated at typing time.

import { uid } from './storage.js';
import { classifyError } from './keymap.js';
import { roundMetrics } from './metrics.js';

export class Tracker {
  constructor(app, mode, textId) {
    this.app = app;
    this.storage = app.storage;
    this.sessionId = app.session.id;
    this.mode = mode;
    this.textId = textId || null;
    this.id = uid('round');
    this.rows = [];
    this.sent = 0;
    this.startedAt = 0;
    this.t0 = 0;
    this.items = 0;
    this.correctItems = 0;
    this.finished = false;
    this.flushTimer = null;
  }

  async begin() {
    this.startedAt = Date.now();
    this.t0 = performance.now();
    await this.storage.insert('rounds', [{
      id: this.id,
      session_id: this.sessionId,
      mode: this.mode,
      text_id: this.textId,
      start: this.startedAt,
      end: null,
      exited_early: 0,
      continued: 0,
      accuracy: null,
      cpm: null,
      wpm: null,
      chars: 0,
      mistakes: 0,
      clean_run: 0,
      items: 0,
      correct_items: 0,
    }]);
    this.flushTimer = setInterval(() => this.flush(), 2500);
    return this;
  }

  now() {
    return Math.round(performance.now() - this.t0);
  }

  present() {
    this.items += 1;
    return this.now();
  }

  resolveItem(correct) {
    if (correct) {
      this.correctItems += 1;
      if (this.app.score) this.app.score.word();
    }
  }

  log({ expected, key, code, shift, correct, appeared }) {
    const row = {
      round_id: this.id,
      session_id: this.sessionId,
      t: this.now(),
      appeared: appeared == null ? this.now() : appeared,
      expected: expected || '',
      key: key || '',
      code: code || '',
      shift: shift ? 1 : 0,
      correct: correct ? 1 : 0,
      error_class: correct ? '' : (classifyError(expected, key, code, shift) || 'location'),
    };
    this.rows.push(row);
    if (this.app.score) this.app.score.keystroke(correct);
    return row;
  }

  signal(type) {
    this.storage.insert('signals', [{
      id: uid('sig'),
      session_id: this.sessionId,
      round_id: this.id,
      t: this.now(),
      type,
      at: Date.now(),
    }]);
  }

  flush() {
    if (this.sent >= this.rows.length) return;
    const batch = this.rows.slice(this.sent);
    this.sent = this.rows.length;
    this.storage.insert('keystrokes', batch);
  }

  async finish({ exitedEarly = false } = {}) {
    if (this.finished) return null;
    this.finished = true;
    clearInterval(this.flushTimer);
    const duration = Math.max(1, Date.now() - this.startedAt);
    const all = this.rows.slice();
    this.summaryRows = all;
    const summary = roundMetrics(all, duration);
    this.flush();
    await this.storage.update('rounds', this.id, {
      end: Date.now(),
      exited_early: exitedEarly ? 1 : 0,
      accuracy: Number(summary.accuracy.toFixed(4)),
      cpm: Number(summary.cpm.toFixed(2)),
      wpm: Number(summary.wpm.toFixed(2)),
      chars: summary.chars,
      mistakes: summary.mistakes,
      clean_run: summary.cleanRun,
      items: this.items,
      correct_items: this.correctItems,
    });
    return { ...summary, duration, keystrokes: all, id: this.id };
  }
}
