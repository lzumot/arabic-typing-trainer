import { Storage, uid } from './storage.js';
import { Audio } from './audio.js';
import { Tracker } from './tracker.js';
import { ScoreBoard } from './score.js';
import { letterMedians, adaptationScore, weightedPick } from './metrics.js';
import { isArabicChar, isLatinChar } from './keymap.js';
import { PASSAGES, POP_ALPHABET, POP_WORDS } from './textbank.js';
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

const MODE_HELP = {
  pop: {
    title: 'Pop',
    goal: 'Type each falling block before it reaches the bottom.',
    steps: [
      'Blocks climb: one letter, then 2-letter, 3-letter and 4-letter words.',
      'Type the letters in order, right to left. Typed letters dim.',
      'A miss shakes the block and slows it down. 30 seconds per round.',
    ],
    keys: 'Any Arabic letter - Esc to stop',
  },
  twins: {
    title: 'Twins',
    goal: 'Fill the gap in the word with the right letter.',
    steps: [
      'A word appears with one letter missing.',
      'The chips below are look-alike letters, for example ة and ه, or أ and إ.',
      'A wrong letter shows the answer and moves on. 10 words per round.',
    ],
    keys: 'One Arabic letter per word - Esc to stop',
  },
  ghost: {
    title: 'Ghost race',
    goal: 'Race the ghost of your own best speed on the same text.',
    steps: [
      'Pick a built-in text or paste one of your own.',
      'Type it exactly; the you bar moves against the ghost bar.',
      '60 seconds per try. Your fastest run becomes the new ghost.',
    ],
    keys: 'Type the text - Esc to stop',
  },
  duel: {
    title: 'Duel',
    goal: 'Two runs on one text: you first, then the tutor.',
    steps: [
      'Type the text in your run.',
      'Hand the keyboard over and press Start for the tutor run.',
      'The faster run with 90% accuracy or better wins.',
    ],
    keys: 'Type the text - Esc to stop',
  },
  boss: {
    title: 'Boss text',
    goal: 'Get through the homework answer in one piece.',
    steps: [
      'Paste the homework question or answer, or pick an old one.',
      'The text is split into chunks of 5 to 8 words.',
      'A chunk only advances when the letters are right. Pips show progress.',
    ],
    keys: 'Type the chunk - Esc to stop',
  },
  writer: {
    title: 'Writer',
    goal: 'Free writing. Nothing here can be wrong.',
    steps: [
      'Type whatever you like, in Arabic.',
      'Word count and WPM update as you go.',
      'Text over 20 characters is saved as one of your own texts.',
    ],
    keys: 'Any key - Esc to finish',
  },
};

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class App {
  constructor() {
    this.storage = new Storage();
    this.audio = new Audio();
    this.score = new ScoreBoard(this);
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
    this.helpSeen = new Set();
    this.modeId = 'pop';
    this.popDeck = [];
    this.popCount = 0;
    this.popDeckStage = null;
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
    this.score.load();

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
    setInterval(() => { this.touchSession(); this.score.flush(); }, 15000);
    window.addEventListener('beforeunload', () => this.flushSession());
    document.addEventListener('keydown', (ev) => this.onKeydown(ev), true);
    document.addEventListener('pointerdown', () => this.audio.ready(), { once: true });
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => {
        this.audio.play('soft');
        this.openHelpFor(this.modeId);
      });
    }
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
    this.score.checkDay();
    this.score.render();
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
    this.score.startRound(mode);
    if (this.mode && typeof this.mode.scoreLabel === 'function') {
      this.score.setLabel(this.mode.scoreLabel());
    }
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
    this.score.endRound();
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
      button.dataset.label = meta.label;
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
    records.dataset.label = 'My records';
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

  startMode(id, fromHelp) {
    const Mode = MODES[id];
    if (!Mode) return;
    if (!fromHelp && !this.helpSeen.has(id)) {
      this.helpSeen.add(id);
      if (this.mode) {
        this.mode.unmount();
        this.mode = null;
      }
      this.showHelp(id, () => this.startMode(id, true));
      return;
    }
    if (this.mode) this.mode.unmount();
    this.modeId = id;
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

  // ---------- help ----------

  showHelp(id, after) {
    const help = MODE_HELP[id] || MODE_HELP[this.modeId] || MODE_HELP.pop;
    this.overlayEl.hidden = false;
    this.overlayEl.className = 'overlay help-overlay in';
    this.overlayEl.innerHTML = `
      <div class="help-card">
        <h2>${help.title}</h2>
        <p class="help-goal">${help.goal}</p>
        <ol class="help-steps">${help.steps.map((s) => '<li>' + s + '</li>').join('')}</ol>
        <p class="help-keys">${help.keys}</p>
        <button class="soft-btn" id="help-close">${after ? 'Start' : 'Got it'}</button>
      </div>`;
    const close = () => {
      this.closeOverlay();
      if (after) after();
    };
    this.overlayEl.querySelector('#help-close').addEventListener('click', close);
    this.overlayOpen = {
      onKey: (ev) => {
        if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          close();
          return true;
        }
        return false;
      },
    };
  }

  openHelpFor(modeId) {
    this.showHelp(modeId || this.modeId);
  }

  // ---------- pop unit picker ----------
  // The deck climbs: single letters, then 2-letter words, then 3, then 4, then
  // a mixed deck forever. The stage is kept in the meta table, so the next
  // session continues from the same rung.

  popStage() {
    const stage = parseInt(this.readMeta('pop:stage', '0'), 10);
    return Number.isFinite(stage) ? Math.min(4, Math.max(0, stage)) : 0;
  }

  popStageName(stage) {
    const names = ['letters', '2-letter words', '3-letter words', '4-letter words', 'mixed'];
    return names[stage == null ? this.popStage() : stage];
  }

  popPool(stage) {
    if (stage === 0) return shuffle(POP_ALPHABET).slice(0, 16);
    if (stage === 4) return shuffle([...shuffle(POP_ALPHABET).slice(0, 6), ...POP_WORDS]);
    const words = POP_WORDS.filter((word) => word.length === stage + 1);
    return shuffle(words).slice(0, 16);
  }

  advancePopStage() {
    const stage = this.popStage();
    if (stage >= 4) return stage;
    const next = stage + 1;
    this.writeMeta('pop:stage', String(next));
    this.toast('Pop: ' + this.popStageName(next), '');
    return next;
  }

  pickPopUnit() {
    this.popCount += 1;
    if (!this.popDeck.length) {
      if (this.popDeckStage != null && this.popDeckStage < 4) {
        this.popDeckStage = this.advancePopStage();
      } else {
        this.popDeckStage = this.popStage();
      }
      this.popDeck = this.popPool(this.popDeckStage);
      if (!this.popDeck.length) this.popDeck = shuffle(POP_ALPHABET);
    }
    if (this.popDeckStage === 0 && this.popCount % 3 === 0) {
      const slow = Object.entries(this.letterHistory)
        .filter(([, s]) => s.median)
        .sort((a, b) => b[1].median - a[1].median)
        .slice(0, 8)
        .map(([ch]) => ch)
        .filter((ch) => this.popDeck.includes(ch));
      if (slow.length) {
        const drill = slow[Math.floor(Math.random() * slow.length)];
        // Take it out of the deck so the rung still progresses.
        this.popDeck.splice(this.popDeck.indexOf(drill), 1);
        return drill;
      }
    }
    return this.popDeck.pop();
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
      const handled = this.overlayOpen.onKey ? this.overlayOpen.onKey(ev) : false;
      if (!handled && ev.key === 'Escape') {
        ev.preventDefault();
        this.closeOverlay();
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
        const started = this.startMode('pop');
        if (started && started.then) {
          started.then(() => {
            if (this.mode && this.mode.onKey) this.mode.onKey(ev);
          });
        }
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
