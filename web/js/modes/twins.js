import { TWIN_WORDS } from '../textbank.js';
import { confusablesOf } from '../keymap.js';

const WORDS_PER_ROUND = 10;

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class TwinsMode {
  constructor(app) {
    this.app = app;
    this.done = false;
    this.count = 0;
    this.locked = false;
  }

  async mount() {
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="twins">
        <div class="twins-word" id="twins-word"></div>
        <div class="twins-chips" id="twins-chips"></div>
        <div class="twins-progress" id="twins-progress"></div>
      </div>`;
    this.wordEl = stage.querySelector('#twins-word');
    this.chipsEl = stage.querySelector('#twins-chips');
    this.progressEl = stage.querySelector('#twins-progress');
    this.tracker = await this.app.beginRound('twins');
    if (this.done) return;
    this.queue = this.buildQueue();
    this.renderProgress();
    this.next();
  }

  buildQueue() {
    const counts = {};
    (this.app.data.keystrokes || []).forEach((k) => {
      if (k.error_class === 'spelling') {
        const pair = (k.expected || '') + (k.key || '');
        counts[pair] = (counts[pair] || 0) + 1;
      }
    });
    const scored = TWIN_WORDS.map((entry) => {
      const ch = entry.word[entry.index];
      const weight = 1 + confusablesOf(ch).reduce((sum, other) => (
        sum + (counts[ch + other] || 0) + (counts[other + ch] || 0)
      ), 0);
      return { entry, weight };
    });
    const picked = [];
    const pool = scored.slice();
    while (picked.length < WORDS_PER_ROUND && pool.length) {
      const total = pool.reduce((s, p) => s + p.weight, 0);
      let roll = Math.random() * total;
      let index = 0;
      for (let i = 0; i < pool.length; i += 1) {
        roll -= pool[i].weight;
        if (roll <= 0) { index = i; break; }
      }
      picked.push(pool.splice(index, 1)[0].entry);
    }
    return picked;
  }

  renderProgress() {
    this.progressEl.innerHTML = '';
    for (let i = 0; i < WORDS_PER_ROUND; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i < this.count ? ' done' : '');
      this.progressEl.appendChild(dot);
    }
  }

  next() {
    if (this.done) return;
    if (!this.queue.length) {
      this.finish(false);
      return;
    }
    const entry = this.queue.shift();
    this.entry = entry;
    this.correctChar = entry.word[entry.index];
    this.appeared = this.tracker.present();
    this.locked = false;

    const before = entry.word.slice(0, entry.index);
    const after = entry.word.slice(entry.index + 1);
    this.wordEl.innerHTML =
      '<span class="plain">' + before + '</span>' +
      '<span class="slot" id="twins-slot"></span>' +
      '<span class="plain">' + after + '</span>';
    this.slotEl = this.wordEl.querySelector('#twins-slot');
    this.slotEl.classList.add('empty');

    this.candidates = shuffle([this.correctChar, ...confusablesOf(this.correctChar)]);
    this.chipsEl.innerHTML = this.candidates
      .map((c) => '<span class="chip" data-ch="' + c + '">' + c + '</span>')
      .join('');
  }

  onKey(ev) {
    if (this.done || this.locked || !this.correctChar) return;
    if (ev.key.length !== 1) return;
    const correct = ev.key === this.correctChar;
    this.tracker.log({
      expected: this.correctChar,
      key: ev.key,
      code: ev.code,
      shift: ev.shiftKey,
      correct,
      appeared: this.appeared,
    });

    if (correct) {
      this.tracker.resolveItem(true);
      this.app.audio.play('pop');
      this.slotEl.textContent = this.correctChar;
      this.slotEl.classList.remove('empty');
      this.slotEl.classList.add('filled');
      this.locked = true;
      this.count += 1;
      this.renderProgress();
      setTimeout(() => this.next(), 450);
      return;
    }

    this.app.audio.play('wobble');
    this.chipsEl.classList.remove('shake');
    void this.chipsEl.offsetWidth;
    this.chipsEl.classList.add('shake');
    const chip = this.chipsEl.querySelector('[data-ch="' + ev.key + '"]');
    if (chip) chip.classList.add('tried');
    this.locked = true;
    this.slotEl.textContent = this.correctChar;
    this.slotEl.classList.remove('empty');
    this.slotEl.classList.add('reveal');
    this.count += 1;
    this.renderProgress();
    const wrongCount = (this.wrongStreak = (this.wrongStreak || 0) + 1);
    if (wrongCount >= 3) {
      this.tracker.signal('mash');
      this.app.easeOff();
      this.wrongStreak = 0;
    }
    setTimeout(() => this.next(), 900);
  }

  exit() {
    if (this.done) return;
    if (Date.now() - this.tracker.startedAt < 5000) this.tracker.signal('quick_exit');
    this.finish(true);
  }

  async finish(exitedEarly) {
    if (this.done) return;
    this.done = true;
    await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    this.app.endRound(this.tracker, { exitedEarly: true });
  }
}
