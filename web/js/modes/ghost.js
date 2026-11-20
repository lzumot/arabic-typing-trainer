import { TextRunner } from './runner.js';

const MAX_MS = 60000;

export class GhostMode {
  constructor(app) {
    this.app = app;
    this.done = false;
    this.raf = null;
  }

  async mount() {
    this.renderPicker();
  }

  renderPicker() {
    const texts = this.app.allTexts();
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="picker">
        <div class="picker-title">A text to race</div>
        <div class="picker-list" id="ghost-list"></div>
        <form class="picker-form" id="ghost-form">
          <textarea id="ghost-new" rows="3" placeholder="……"></textarea>
          <button type="submit">Add</button>
        </form>
      </div>`;
    const list = stage.querySelector('#ghost-list');
    texts.forEach((text) => {
      const button = document.createElement('button');
      button.className = 'picker-item';
      button.textContent = text.title || text.content.slice(0, 24);
      button.addEventListener('click', () => this.start(text));
      list.appendChild(button);
    });
    stage.querySelector('#ghost-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = stage.querySelector('#ghost-new').value.trim();
      if (value.length < 10) return;
      const row = this.app.addText({ source: 'his-own', content: value, title: 'My text' });
      this.start({ id: row.id, title: row.title, content: value });
    });
  }

  async start(text) {
    if (this.done) return;
    const best = this.app.personalBest('ghost:' + text.id);
    this.text = text;
    this.best = best ? best.value : null;

    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="ghost">
        <div class="ghost-lanes" ${this.best ? '' : 'hidden'}>
          <div class="lane ghost-lane"><span class="lane-label">ghost</span><div class="lane-bar"><i id="ghost-bar"></i></div></div>
          <div class="lane"><span class="lane-label">you</span><div class="lane-bar"><i id="you-bar"></i></div></div>
        </div>
        <div class="ghost-text" id="ghost-text" dir="rtl"></div>
      </div>`;
    this.textEl = stage.querySelector('#ghost-text');
    this.ghostBar = stage.querySelector('#ghost-bar');
    this.youBar = stage.querySelector('#you-bar');

    this.tracker = await this.app.beginRound('ghost', text.id);
    if (this.done) return;
    this.startedAt = performance.now();
    this.runner = new TextRunner({
      app: this.app,
      tracker: this.tracker,
      text: text.content,
      el: this.textEl,
      onProgress: (p) => { this.youBar.style.width = (p * 100).toFixed(1) + '%'; },
      onDone: () => this.finish(false, true),
    });
    this.raf = requestAnimationFrame(() => this.frame());
    this.deadline = setTimeout(() => this.finish(false, false), MAX_MS);
  }

  frame() {
    if (this.done || !this.runner) return;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    if (this.best && this.ghostBar) {
      const chars = (this.best / 60) * elapsed;
      const total = this.text.content.length;
      this.ghostBar.style.width = Math.min(100, (chars / total) * 100).toFixed(1) + '%';
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }

  onKey(ev) {
    if (this.done || !this.runner) return;
    this.lastKeyAt = performance.now();
    this.runner.key(ev);
  }

  exit() {
    if (this.done) return;
    if (this.tracker && Date.now() - this.tracker.startedAt < 5000) this.tracker.signal('quick_exit');
    this.finish(true, false);
  }

  async finish(exitedEarly, completed) {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.deadline);
    if (this.runner) this.runner.destroy();
    const summary = await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    if (summary && summary.cpm > 0) {
      const improved = this.app.submitBest('ghost:' + this.text.id, summary.cpm, 'max');
      if (completed) {
        this.app.submitBest('ghosttime:' + this.text.id, summary.duration / 1000, 'min');
      }
      const you = summary.wpm.toFixed(1);
      const ghost = this.best ? (this.best / 5).toFixed(1) : null;
      const line = ghost
        ? 'You ' + you + ' wpm · ghost ' + ghost + ' wpm'
        : 'Your first run on this text: ' + you + ' wpm';
      this.app.toast(improved && this.best ? 'New personal best · ' + line : line, improved && this.best ? 'best' : '');
    }
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.deadline);
    if (this.runner) this.runner.destroy();
    if (this.tracker) this.app.endRound(this.tracker, { exitedEarly: true });
  }
}
