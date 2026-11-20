import { Storage, uid } from './storage.js';
import { Audio } from './audio.js';
import { Tracker } from './tracker.js';
import { letterMedians, adaptationScore, weightedPick } from './metrics.js';
import { isArabicChar, isLatinChar } from './keymap.js';
import { PASSAGES } from './textbank.js';
import { PopMode } from './modes/pop.js';
import { TwinsMode } from './modes/twins.js';
import { GhostMode } from './modes/ghost.js';
import { BossMode } from './modes/boss.js';
import { DuelMode } from './modes/duel.js';
import { WriterMode } from './modes/writer.js';
import { RecordsView } from './records.js';
import { TutorView } from './tutor.js';

const ICONS = {
  pop: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="6"/><path d="M12 2v4M5 6l2.5 2.5M19 6l-2.5 2.5"/></svg>',
  twins: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>',
  ghost: '<svg viewBox="0 0 24 24"><path d="M6 20V10a6 6 0 0 1 12 0v10l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z"/></svg>',
  duel: '<svg viewBox="0 0 24 24"><path d="M4 4l7 7M20 4l-7 7"/><path d="M4 20l7-7M20 20l-7-7"/></svg>',
  boss: '<svg viewBox="0 0 24 24"><path d="M4 18V9l4 3 4-6 4 6 4-3v9z"/></svg>',
  writer: '<svg viewBox="0 0 24 24"><path d="M4 20l3-1 10-10-2-2L5 17z"/><path d="M15 5l2 2"/></svg>',
};

export const MODE_META = [
  { id: 'pop', label: 'Pop' },
  { id: 'twins', label: 'Twins' },
  { id: 'ghost', label: 'Ghost race' },
  { id: 'duel', label: 'Duel' },
  { id: 'boss', label: 'Boss text' },
  { id: 'writer', label: 'Writer' },
];

const MODES = {
  pop: PopMode,
  twins: TwinsMode,
  ghost: GhostMode,
  duel: DuelMode,
  boss: BossMode,
  writer: WriterMode,
};

class App {
  constructor() {
    this.storage = new Storage();
    this.audio = new Audio();
    this.stage = document.getElementById('stage');
    this.trayEl = document.getElementById('tray');
    this.overlayEl = document.getElementById('overlay');
    this.toastEl = document.getElementById('toast');
    this.statusEl = document.getElementById('status');
    this.clockEl = document.getElementById('clock');
    this.mode = null;
    this.currentTracker = null;
    this.overlayOpen = null;
    this.session = null;
    this.data = { sessions: [], rounds: [], keystrokes: [], texts: [], baselines: [], signals: [], bests: [], meta: [] };
    this.bests = new Map();
    this.letterHistory = {};
    this.clockVisible = true;
    this.easeOffUntil = 0;
    this.latinAt = null;
    this.latinSeen = 0;
    this.switchLogged = false;
    this.lastRoundEnd = 0;
    this.lastRoundId = null;
    this.trayShown = false;
    this.trayTimer = null;
  }

  async boot() {
    const online = await this.storage.probe();
    if (!online) {
      this.showStatus('The local server is not running, so nothing is being saved. Start the app with Start Trainer.command.', true);
    }
    if (online) {
      try {
        const loaded = await this.storage.load(400);
        Object.keys(this.data).forEach((table) => {
          if (Array.isArray(loaded[table])) this.data[table] = loaded[table];
        });
      } catch (err) {
        console.warn('[app] load failed', err);
        this.showStatus('History could not be read. New keystrokes are still logged.', true);
      }
    }
    this.bests = new Map(this.data.bests.map((row) => [row.key, row]));
    this.letterHistory = letterMedians(this.data.keystrokes || []);
    this.clockVisible = this.readMeta('clock', 'on') === 'on';

    this.session = {
      id: uid('session'),
      start: Date.now(),
      end: Date.now(),
      layout: 'unknown',
      switched_keyboard: 0,
      switch_seconds: null,
      notes: '',
    };
    this.storage.insert('sessions', [this.session]);
    this.touchSession();
    this.renderTray();
    this.startMode('pop');
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    setInterval(() => this.touchSession(), 15000);
    window.addEventListener('beforeunload', () => this.flushSession());
    document.addEventListener('keydown', (ev) => this.onKeydown(ev), true);
    document.addEventListener('pointerdown', () => this.audio.ready(), { once: true });
  }

  readMeta(key, fallback) {
    const row = (this.data.meta || []).find((m) => m.key === key);
    return row ? row.value : fallback;
  }

  writeMeta(key, value) {
    const row = { key, value: String(value) };
    const index = (this.data.meta || []).findIndex((m) => m.key === key);
    if (index >= 0) this.data.meta[index] = row;
    else (this.data.meta = this.data.meta || []).push(row);
    this.storage.insert('meta', [row]);
  }

  touchSession() {
    if (!this.session) return;
    this.session.end = Date.now();
    this.storage.update('sessions', this.session.id, { end: this.session.end });
  }

  markFirstKey() {
    if (!this.session || this.session.startedByKey) return;
    this.session.startedByKey = true;
    this.session.start = Date.now();
    this.session.end = this.session.start;
    this.storage.update('sessions', this.session.id, { start: this.session.start });
  }

  flushSession() {
    if (this.currentTracker) this.currentTracker.flush();
    if (!this.session) return;
    this.session.end = Date.now();
    const body = JSON.stringify({
      table: 'sessions',
      id: this.session.id,
      patch: { end: this.session.end },
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/update', new Blob([body], { type: 'application/json' }));
    }
  }

  tickClock() {
    if (!this.clockEl) return;
    if (!this.session) return;
    const seconds = Math.max(0, Math.floor((Date.now() - this.session.start) / 1000));
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    this.clockEl.textContent = mm + ':' + ss;
    this.clockEl.hidden = !this.clockVisible;
  }

  setClockVisible(on) {
    this.clockVisible = !!on;
    this.writeMeta('clock', on ? 'on' : 'off');
    this.tickClock();
  }

  showStatus(text, sticky) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.hidden = false;
    if (!sticky) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = setTimeout(() => { this.statusEl.hidden = true; }, 6000);
    }
  }

  toast(message, kind) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.className = 'toast show ' + (kind || '');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => { this.toastEl.className = 'toast'; }, 2600);
    if (kind === 'best') this.audio.play('best');
  }

  // ---------- rounds ----------

  async beginRound(mode, textId) {
    const tracker = new Tracker(this, mode, textId);
    await tracker.begin();
    if (this.lastRoundId && this.lastRoundMode !== 'duel-tutor' && mode !== 'duel-tutor'
        && Date.now() - this.lastRoundEnd < 300000) {
      this.storage.update('rounds', this.lastRoundId, { continued: 1 });
      const row = this.data.rounds.find((r) => r.id === this.lastRoundId);
      if (row) row.continued = 1;
    }
    this.currentTracker = tracker;
    return tracker;
  }

  async endRound(tracker, options) {
    if (!tracker) return null;
    if (this.currentTracker === tracker) this.currentTracker = null;
    const summary = await tracker.finish(options || {});
    this.lastRoundEnd = Date.now();
    this.lastRoundId = tracker.id;
    this.lastRoundMode = tracker.mode;
    if (summary) {
      this.data.rounds.push({
        id: tracker.id,
        session_id: tracker.sessionId,
        mode: tracker.mode,
        text_id: tracker.textId,
        start: tracker.startedAt,
        end: Date.now(),
        accuracy: summary.accuracy,
        cpm: summary.cpm,
        wpm: summary.wpm,
        chars: summary.chars,
        mistakes: summary.mistakes,
        clean_run: summary.cleanRun,
      });
      this.absorbRound(tracker.mode, summary);
    }
    return summary;
  }

  absorbRound(mode, summary) {
    this.bestFlash = false;
    const letters = letterMedians(summary.keystrokes);
    Object.entries(letters).forEach(([ch, stat]) => {
      if (stat.median == null || stat.n < 2 || stat.median < 100) return;
      const prev = this.letterHistory[ch];
      this.letterHistory[ch] = prev && prev.n >= stat.n
        ? { median: (prev.median * prev.n + stat.median * stat.n) / (prev.n + stat.n), n: prev.n + stat.n }
        : stat;
      if (this.submitBest('letter:' + ch, stat.median, 'min')) this.bestFlash = true;
    });
    if (summary.cleanRun > 5 && this.submitBest('clean', summary.cleanRun, 'max')) this.bestFlash = true;
    if (summary.accuracy >= 0.8 && summary.cpm > 0) {
      this.submitBest('wpm:' + mode, summary.wpm, 'max');
    }
  }

  submitBest(key, value, direction) {
    if (!Number.isFinite(value) || value <= 0) return false;
    const row = this.bests.get(key);
    const better = !row || (direction === 'min' ? value < row.value : value > row.value);
    if (!better) return false;
    const next = { key, value, text_id: row ? row.text_id : null, achieved: Date.now() };
    this.bests.set(key, next);
    this.storage.insert('bests', [next]);
    return true;
  }

  personalBest(key) {
    return this.bests.get(key) || null;
  }

  // ---------- modes ----------

  renderTray() {
    this.trayEl.innerHTML = '';
    MODE_META.forEach((meta) => {
      const button = document.createElement('button');
      button.className = 'tray-btn';
      button.dataset.mode = meta.id;
      button.title = meta.label;
      button.setAttribute('aria-label', meta.label);
      button.innerHTML = ICONS[meta.id];
      button.addEventListener('click', () => {
        this.audio.ready();
        this.audio.play('soft');
        this.startMode(meta.id);
      });
      this.trayEl.appendChild(button);
    });
    const records = document.createElement('button');
    records.className = 'tray-btn subtle';
    records.title = 'My records';
    records.setAttribute('aria-label', 'My records');
    records.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l2.5 6 6.5.5-5 4.2 1.6 6.3L12 16.8 6.4 20l1.6-6.3-5-4.2 6.5-.5z"/></svg>';
    records.addEventListener('click', () => this.openRecords());
    this.trayEl.appendChild(records);
  }

  revealTray() {
    if (this.trayShown) return;
    this.trayShown = true;
    this.trayEl.hidden = false;
    this.trayEl.classList.add('in');
  }

  startMode(id) {
    const Mode = MODES[id];
    if (!Mode) return;
    if (this.mode) this.mode.unmount();
    this.mode = new Mode(this);
    this.stage.innerHTML = '';
    this.stage.className = 'stage mode-' + id;
    const mounting = this.mode.mount();
    clearTimeout(this.trayTimer);
    this.trayTimer = setTimeout(() => this.revealTray(), 20000);
    return mounting;
  }

  goIdle() {
    if (this.mode) this.mode.unmount();
    this.mode = null;
    this.stage.className = 'stage idle';
    this.stage.innerHTML = '<div class="idle-field"><span>ذ</span><span>ض</span><span>ة</span><span>ى</span><span>أ</span><span>ء</span><span>ؤ</span><span>ئ</span></div>';
    this.revealTray();
  }

  // ---------- keys ----------

  onKeydown(ev) {
    if (ev.ctrlKey && ev.altKey && ev.code === 'KeyT') {
      ev.preventDefault();
      this.openTutor();
      return;
    }
    this.audio.ready();
    if (this.overlayOpen) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeOverlay();
      } else if (this.overlayOpen.onKey) {
        this.overlayOpen.onKey(ev);
      }
      return;
    }
    this.detectLayout(ev);
    if (ev.key.length === 1 || ev.key === 'Backspace') this.markFirstKey();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (this.mode && this.mode.exit) this.mode.exit();
      else this.goIdle();
      return;
    }
    if (ev.metaKey || ev.ctrlKey) return;
    if (!this.mode) {
      if (ev.key.length === 1) {
        this.startMode('pop').then(() => {
          if (this.mode && this.mode.onKey) this.mode.onKey(ev);
        });
      }
      return;
    }
    if (this.mode.onKey) this.mode.onKey(ev);
  }

  detectLayout(ev) {
    if (this.switchLogged || !this.session) return;
    if (isArabicChar(ev.key)) {
      if (this.session.layout === 'unknown') {
        this.session.layout = 'arabic-pc';
        this.storage.update('sessions', this.session.id, { layout: 'arabic-pc' });
      }
      if (this.latinAt) {
        const seconds = Math.round((Date.now() - this.latinAt) / 100) / 10;
        this.session.switched_keyboard = 1;
        this.session.switch_seconds = seconds;
        this.session.layout = 'arabic-pc';
        this.storage.update('sessions', this.session.id, {
          switched_keyboard: 1, switch_seconds: seconds, layout: 'arabic-pc',
        });
        this.latinAt = null;
        this.hideLatinHint();
      }
      return;
    }
    if (isLatinChar(ev.key)) {
      this.latinSeen += 1;
      this.session.layout = 'latin';
      if (this.latinSeen >= 2 && !this.latinAt) {
        this.latinAt = Date.now();
        this.storage.update('sessions', this.session.id, { layout: 'latin', switched_keyboard: 0 });
        this.showLatinHint();
      }
    }
  }

  showLatinHint() {
    const hint = document.getElementById('latin-hint');
    if (!hint) return;
    hint.hidden = false;
    hint.classList.add('in');
  }

  hideLatinHint() {
    const hint = document.getElementById('latin-hint');
    if (!hint) return;
    hint.classList.remove('in');
    hint.hidden = true;
  }

  // ---------- overlays ----------

  openTutor() {
    this.audio.ready();
    this.overlayEl.hidden = false;
    this.overlayEl.className = 'overlay tutor-overlay in';
    this.overlayEl.innerHTML = '';
    this.overlayOpen = new TutorView(this, this.overlayEl);
    this.overlayOpen.render();
  }

  openRecords() {
    this.overlayEl.hidden = false;
    this.overlayEl.className = 'overlay records-overlay in';
    this.overlayEl.innerHTML = '';
    this.overlayOpen = new RecordsView(this, this.overlayEl);
    this.overlayOpen.render();
  }

  closeOverlay() {
    if (this.overlayOpen && this.overlayOpen.destroy) this.overlayOpen.destroy();
    this.overlayOpen = null;
    this.overlayEl.hidden = true;
    this.overlayEl.innerHTML = '';
    this.overlayEl.className = 'overlay';
  }

  // ---------- helpers for modes ----------

  letterWeights() {
    const scores = adaptationScore(this.letterHistory);
    return (ch) => (scores[ch] == null ? 1 : scores[ch]);
  }

  pickLetter(pool) {
    const weightOf = this.letterWeights();
    if (Date.now() < this.easeOffUntil) {
      const fast = Object.entries(this.letterHistory)
        .filter(([, s]) => s.median)
        .sort((a, b) => a[1].median - b[1].median)
        .slice(0, 8)
        .map(([ch]) => ch)
        .filter((ch) => pool.includes(ch));
      if (fast.length) return fast[Math.floor(Math.random() * fast.length)];
    }
    return weightedPick(pool, weightOf);
  }

  easeOff() {
    this.easeOffUntil = Date.now() + 45000;
  }

  get easedOff() {
    return Date.now() < this.easeOffUntil;
  }

  allTexts() {
    const builtin = PASSAGES.map((p) => ({ id: p.id, title: p.title, content: p.text, source: 'builtin' }));
    const stored = (this.data.texts || []).map((t) => ({
      id: t.id,
      title: t.title || 'Text',
      content: t.content,
      source: t.source,
    }));
    return [...builtin, ...stored];
  }

  addText({ id, title, content, source }) {
    const row = { id: id || uid('text'), source: source || 'homework', content, date_added: Date.now(), title: title || '' };
    this.data.texts = this.data.texts || [];
    this.data.texts.push(row);
    this.storage.insert('texts', [row]);
    return row;
  }
}

export { App };

const app = new App();
window.trainer = app;
app.boot().catch((err) => {
  console.error(err);
  document.getElementById('stage').textContent = 'Something went wrong while loading.';
});
