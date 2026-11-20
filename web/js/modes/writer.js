export class WriterMode {
  constructor(app) {
    this.app = app;
    this.done = false;
    this.typed = 0;
  }

  async mount() {
    const stage = this.app.stage;
    stage.innerHTML = `
      <div class="writer">
        <textarea id="writer-area" dir="rtl" spellcheck="false" placeholder="……"></textarea>
        <div class="writer-meta"><span id="writer-count">0</span></div>
      </div>`;
    this.area = stage.querySelector('#writer-area');
    this.countEl = stage.querySelector('#writer-count');
    this.tracker = await this.app.beginRound('writer');
    if (this.done) return;
    this.startedAt = performance.now();
    setTimeout(() => this.area.focus(), 30);
  }

  onKey(ev) {
    if (this.done || !this.tracker) return;
    if (ev.key.length !== 1) return;
    if (ev.metaKey || ev.ctrlKey) return;
    this.typed += 1;
    this.tracker.log({
      expected: ev.key,
      key: ev.key,
      code: ev.code,
      shift: ev.shiftKey,
      correct: true,
      appeared: null,
    });
    const seconds = Math.max(1, (performance.now() - this.startedAt) / 1000);
    const cpm = this.typed / (seconds / 60);
    this.countEl.textContent = this.typed + ' · ' + (cpm / 5).toFixed(1) + ' wpm';
  }

  exit() {
    if (this.done) return;
    this.finish(true);
  }

  async finish(exitedEarly) {
    if (this.done) return;
    this.done = true;
    this.keepText();
    await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    this.keepText();
    this.app.endRound(this.tracker, { exitedEarly: true });
  }

  keepText() {
    const content = this.area ? this.area.value.trim() : '';
    if (content.length >= 20) {
      this.app.addText({ source: 'his-own', content, title: 'My writing' });
    }
  }
}
