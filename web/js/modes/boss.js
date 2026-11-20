import { TextRunner } from './runner.js';

function chunkText(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const size = 5 + Math.floor(Math.random() * 4);
    chunks.push(words.slice(i, i + size).join(' '));
    i += size;
  }
  return chunks;
}

export class BossMode {
  constructor(app) {
    this.app = app;
    this.done = false;
  }

  async mount() {
    this.renderPicker();
  }

  renderPicker() {
    const homework = (this.app.data.texts || []).filter((t) => t.source === 'homework');
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="picker">
        <div class="picker-title">The homework question</div>
        <div class="picker-list" id="boss-list"></div>
        <form class="picker-form" id="boss-form">
          <textarea id="boss-new" rows="4" placeholder="……"></textarea>
          <button type="submit">Add</button>
        </form>
      </div>`;
    const list = stage.querySelector('#boss-list');
    homework.slice(-8).reverse().forEach((text) => {
      const button = document.createElement('button');
      button.className = 'picker-item';
      button.textContent = text.title || text.content.slice(0, 30);
      button.addEventListener('click', () => this.start(text));
      list.appendChild(button);
    });
    stage.querySelector('#boss-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = stage.querySelector('#boss-new');
      const value = input.value.trim();
      if (value.length < 5) return;
      const title = 'Homework ' + new Date().toLocaleDateString();
      const row = this.app.addText({ source: 'homework', content: value, title });
      this.start(row);
    });
  }

  async start(text) {
    if (this.done) return;
    this.text = text;
    this.chunks = chunkText(text.content);
    this.index = 0;
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="boss">
        <div class="boss-pips" id="boss-pips"></div>
        <div class="boss-prev" id="boss-prev"></div>
        <div class="boss-chunk" id="boss-chunk" dir="rtl"></div>
      </div>`;
    this.pipsEl = stage.querySelector('#boss-pips');
    this.prevEl = stage.querySelector('#boss-prev');
    this.chunkEl = stage.querySelector('#boss-chunk');
    this.tracker = await this.app.beginRound('boss', text.id);
    if (this.done) return;
    this.chunks.forEach(() => {
      const pip = document.createElement('span');
      pip.className = 'pip';
      this.pipsEl.appendChild(pip);
    });
    this.loadChunk();
  }

  loadChunk() {
    if (this.done) return;
    if (this.index >= this.chunks.length) {
      this.finish(false);
      return;
    }
    const pip = this.pipsEl.children[this.index];
    if (pip) pip.classList.add('live');
    if (this.runner) this.runner.destroy();
    this.chunkEl.innerHTML = '';
    this.runner = new TextRunner({
      app: this.app,
      tracker: this.tracker,
      text: this.chunks[this.index],
      el: this.chunkEl,
      onDone: () => this.chunkDone(),
    });
  }

  chunkDone() {
    const pip = this.pipsEl.children[this.index];
    if (pip) {
      pip.classList.remove('live');
      pip.classList.add('hit');
    }
    this.app.audio.play('hit');
    this.prevEl.textContent = this.chunks[this.index];
    this.index += 1;
    this.chunkEl.classList.remove('flash');
    void this.chunkEl.offsetWidth;
    this.chunkEl.classList.add('flash');
    setTimeout(() => this.loadChunk(), 260);
  }

  onKey(ev) {
    if (this.done || !this.runner) return;
    this.runner.key(ev);
  }

  exit() {
    if (this.done) return;
    if (this.tracker && Date.now() - this.tracker.startedAt < 5000) this.tracker.signal('quick_exit');
    this.finish(true);
  }

  async finish(exitedEarly) {
    if (this.done) return;
    this.done = true;
    if (this.runner) this.runner.destroy();
    const summary = await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    if (summary && summary.chars > 0) {
      this.app.toast(summary.wpm.toFixed(1) + ' wpm on the homework', '');
    }
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    if (this.runner) this.runner.destroy();
    if (this.tracker) this.app.endRound(this.tracker, { exitedEarly: true });
  }
}
