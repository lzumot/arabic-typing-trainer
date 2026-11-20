import { TextRunner } from './runner.js';

export class DuelMode {
  constructor(app) {
    this.app = app;
    this.done = false;
    this.phase = 'pick';
  }

  async mount() {
    this.renderPicker();
  }

  renderPicker() {
    const texts = this.app.allTexts();
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="picker">
        <div class="picker-title">The text for the duel</div>
        <div class="picker-list" id="duel-list"></div>
        <form class="picker-form" id="duel-form">
          <textarea id="duel-new" rows="3" placeholder="……"></textarea>
          <button type="submit">Add</button>
        </form>
      </div>`;
    const list = stage.querySelector('#duel-list');
    texts.forEach((text) => {
      const button = document.createElement('button');
      button.className = 'picker-item';
      button.textContent = text.title || text.content.slice(0, 24);
      button.addEventListener('click', () => this.start(text));
      list.appendChild(button);
    });
    stage.querySelector('#duel-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = stage.querySelector('#duel-new').value.trim();
      if (value.length < 10) return;
      const row = this.app.addText({ source: 'tutor', content: value, title: 'Duel text' });
      this.start({ id: row.id, title: row.title, content: value });
    });
  }

  async start(text) {
    if (this.done) return;
    this.text = text;
    this.runs = {};
    await this.beginRun('you');
  }

  async beginRun(role) {
    if (this.done) return;
    this.role = role;
    this.phase = 'run';
    const stage = this.app.stage;
    const title = role === 'you' ? 'Your run' : "Tutor's run";
    stage.innerHTML = `
      <div class="duel">
        <div class="duel-turn ${role}">${title}</div>
        <div class="duel-text" id="duel-text" dir="rtl"></div>
      </div>`;
    const el = stage.querySelector('#duel-text');
    this.tracker = await this.app.beginRound(role === 'you' ? 'duel' : 'duel-tutor', this.text.id);
    if (this.done) return;
    this.startedAt = performance.now();
    this.runner = new TextRunner({
      app: this.app,
      tracker: this.tracker,
      text: this.text.content,
      el,
      onDone: () => this.endRun(true),
    });
  }

  onKey(ev) {
    if (this.done || !this.runner) return;
    this.runner.key(ev);
  }

  async endRun(completed) {
    if (this.done || !this.runner) return;
    this.runner.destroy();
    this.runner = null;
    const summary = await this.app.endRound(this.tracker, { exitedEarly: false });
    this.runs[this.role] = {
      wpm: summary.wpm,
      seconds: summary.duration / 1000,
      accuracy: summary.accuracy,
      clean: summary.accuracy >= 0.9 && completed,
    };
    if (this.role === 'you') this.renderHandoff();
    else this.renderResult();
  }

  renderHandoff() {
    this.phase = 'handoff';
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="duel-handoff">
        <div class="duel-turn tutor">Tutor's run</div>
        <div class="duel-preview" dir="rtl">${this.text.content}</div>
        <button class="soft-btn" id="duel-go">Start</button>
      </div>`;
    stage.querySelector('#duel-go').addEventListener('click', () => {
      this.app.audio.play('soft');
      this.beginRun('tutor');
    });
  }

  renderResult() {
    this.phase = 'result';
    const you = this.runs.you;
    const tutor = this.runs.tutor;
    const clean = (run) => run.clean;
    let winner = null;
    if (you && tutor) {
      const youFast = you.seconds <= tutor.seconds;
      if (youFast && clean(you)) winner = 'you';
      else if (!youFast && clean(tutor)) winner = 'tutor';
    }
    const card = (label, run, who) => `
      <div class="duel-card ${winner === who ? 'win' : ''}">
        <div class="duel-card-label">${label}</div>
        <div class="duel-card-wpm">${run ? run.wpm.toFixed(1) : '—'}</div>
        <div class="duel-card-sub">${run ? run.seconds.toFixed(1) + ' s · ' + Math.round(run.accuracy * 100) + '%' : ''}</div>
      </div>`;
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="duel-result">
        <div class="duel-cards">
          ${card('you', you, 'you')}
          ${card('tutor', tutor, 'tutor')}
        </div>
        <div class="duel-note">${winner ? 'Fastest clean run: ' + (winner === 'you' ? 'you' : 'the tutor') : 'Nobody finished clean this time'}</div>
        <div class="duel-actions">
          <button class="soft-btn" id="duel-again">Race again</button>
          <button class="soft-btn quiet" id="duel-done">Done</button>
        </div>
      </div>`;
    stage.querySelector('#duel-again').addEventListener('click', () => {
      this.done = true;
      this.app.startMode('duel');
    });
    stage.querySelector('#duel-done').addEventListener('click', () => {
      this.app.goIdle();
    });
    const best = this.app.submitBest('duel', you ? you.wpm : 0, 'max');
    if (best) this.app.toast('New personal best', 'best');
  }

  exit() {
    if (this.done) return;
    if (this.phase === 'run') this.finish(true);
    else this.app.goIdle();
  }

  async finish(exitedEarly) {
    if (this.done) return;
    this.done = true;
    if (this.runner) this.runner.destroy();
    if (this.tracker) await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    if (this.runner) this.runner.destroy();
    if (this.tracker && this.phase === 'run') this.app.endRound(this.tracker, { exitedEarly: true });
  }
}
