const ROUND_MS = 30000;
const MIN_SPEED = 60;

export class PopMode {
  constructor(app) {
    this.app = app;
    this.done = false;
    this.raf = null;
    this.lastNow = 0;
    this.y = 0;
    this.speed = 95;
    this.streak = 0;
  }

  async mount() {
    const stage = this.app.stage;
    stage.innerHTML = '<div class="pop-track"><div class="pop-letter"><span class="pop-glyph"></span></div></div>';
    this.track = stage.querySelector('.pop-track');
    this.letterEl = stage.querySelector('.pop-letter');
    this.glyphEl = stage.querySelector('.pop-glyph');
    this.startedAt = performance.now();
    this.tracker = await this.app.beginRound('pop');
    if (this.done) return;

    this.recent = [];
    this.wrongTimes = [];
    this.signaled = {};
    this.lastKeyAt = performance.now();
    this.trackH = Math.max(320, this.track.clientHeight);
    this.onResize = () => {
      this.trackH = Math.max(320, this.track.clientHeight);
    };
    window.addEventListener('resize', this.onResize);

    this.spawn();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
    this.endTimer = setTimeout(() => this.finish(false), ROUND_MS);
    this.watchTimer = setInterval(() => this.watch(), 700);
  }

  spawn() {
    if (this.done) return;
    this.target = this.app.pickPopUnit();
    this.i = 0;
    this.appeared = this.tracker.present();
    this.y = 0;
    this.renderTarget();
    this.glyphEl.classList.remove('popped', 'drifted', 'shake');
    this.letterEl.classList.toggle('word', this.target.length > 1);
    this.letterEl.style.transform = 'translate(-50%, 0px)';
    this.letterEl.style.opacity = '1';
    this.letterEl.style.fontSize = '';
  }

  renderTarget() {
    const typed = this.target.slice(0, this.i);
    const rest = this.target.slice(this.i);
    this.glyphEl.innerHTML = (typed ? '<span class="typed">' + typed + '</span>' : '')
      + '<span class="rest">' + rest + '</span>';
  }

  frame(now) {
    if (this.done) return;
    if (!this.lastNow) this.lastNow = now;
    const dt = Math.min(64, now - this.lastNow);
    this.lastNow = now;
    const limit = this.trackH - 200;
    this.y += (this.speed * dt) / 1000;
    if (this.y >= limit) {
      this.driftedOut();
      return;
    }
    this.letterEl.style.transform = 'translate(-50%, ' + this.y.toFixed(1) + 'px)';
    this.raf = requestAnimationFrame(this.frame);
  }

  driftedOut() {
    this.glyphEl.classList.add('drifted');
    this.speed = Math.max(MIN_SPEED, this.speed - 5);
    this.streak = 0;
    cancelAnimationFrame(this.raf);
    setTimeout(() => {
      if (this.done) return;
      this.spawn();
      this.lastNow = 0;
      this.raf = requestAnimationFrame(this.frame);
    }, 420);
  }

  scoreLabel() {
    return 'Pop · ' + this.app.popStageName();
  }

  onKey(ev) {
    if (this.done || !this.target) return;
    if (ev.key.length !== 1) return;
    const expected = this.target[this.i];
    const correct = ev.key === expected;
    this.tracker.log({
      expected,
      key: ev.key,
      code: ev.code,
      shift: ev.shiftKey,
      correct,
      appeared: this.i === 0 ? this.appeared : null,
    });
    this.lastKeyAt = performance.now();

    if (correct && this.i < this.target.length - 1) {
      this.i += 1;
      this.renderTarget();
      this.app.audio.play('soft');
      return;
    }

    if (correct) {
      this.tracker.resolveItem(true);
      this.streak += 1;
      this.speed = Math.min(150, this.speed + 4);
      this.app.audio.play('pop');
      this.glyphEl.classList.add('popped');
      if (this.app.easedOff && this.streak >= 5) {
        this.finish(false, true);
        return;
      }
      setTimeout(() => {
        if (this.done) return;
        this.spawn();
        this.lastNow = 0;
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(this.frame);
      }, 130);
      this.noteAccuracy(true);
      return;
    }

    this.app.audio.play('wobble');
    this.glyphEl.classList.remove('shake');
    void this.glyphEl.offsetWidth;
    this.glyphEl.classList.add('shake');
    this.speed = Math.max(MIN_SPEED, this.speed - 8);
    this.streak = 0;
    this.noteAccuracy(false);

    const now = performance.now();
    this.wrongTimes.push(now);
    this.wrongTimes = this.wrongTimes.filter((t) => now - t <= 1000);
    if (this.wrongTimes.length >= 3) {
      this.signal('mash');
      this.wrongTimes = [];
    }
  }

  noteAccuracy(correct) {
    this.recent.push(correct ? 1 : 0);
    if (this.recent.length > 12) this.recent.shift();
    if (this.recent.length >= 10) {
      const accuracy = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
      if (accuracy < 0.7) this.signal('low_accuracy');
    }
  }

  signal(type) {
    if (this.signaled[type] || this.done) return;
    this.signaled[type] = true;
    this.tracker.signal(type);
    this.app.easeOff();
    if (type === 'low_accuracy') this.speed = MIN_SPEED;
  }

  watch() {
    if (this.done) return;
    if (performance.now() - this.lastKeyAt > 10000) {
      this.signal('stall');
      this.speed = MIN_SPEED;
    }
  }

  exit() {
    if (this.done) return;
    if (Date.now() - this.tracker.startedAt < 5000) this.tracker.signal('quick_exit');
    this.finish(true);
  }

  async finish(exitedEarly, earlyWin) {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    clearInterval(this.watchTimer);
    window.removeEventListener('resize', this.onResize);
    const summary = await this.app.endRound(this.tracker, { exitedEarly: !!exitedEarly });
    if (earlyWin) this.app.toast('Round complete', 'best');
    if (summary && this.app.bestFlash) this.app.toast('New personal best', 'best');
    this.app.goIdle();
  }

  unmount() {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    clearInterval(this.watchTimer);
    window.removeEventListener('resize', this.onResize);
    this.app.endRound(this.tracker, { exitedEarly: true });
  }
}
