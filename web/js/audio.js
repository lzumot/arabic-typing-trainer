// Preloaded Web Audio blips. Nothing is fetched, everything is synthesised once.
export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
  }

  ready() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.buffers.pop = this.tone(660, 0.09, 'sine', 0.25, 1.6);
    this.buffers.soft = this.tone(220, 0.07, 'triangle', 0.09, 0.9);
    this.buffers.wobble = this.tone(150, 0.12, 'sine', 0.08, 0.7);
    this.buffers.best = this.tone(880, 0.22, 'sine', 0.16, 1.4);
    this.buffers.hit = this.tone(520, 0.14, 'sine', 0.18, 1.2);
    return this.ctx;
  }

  tone(freq, duration, type, gain, sweep) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const frames = Math.max(1, Math.floor(rate * duration));
    const buffer = ctx.createBuffer(1, frames, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      const p = i / frames;
      const env = Math.min(1, p * 40) * Math.pow(1 - p, 2.2);
      const f = freq * (1 + (sweep - 1) * p);
      data[i] = Math.sin(2 * Math.PI * f * (i / rate)) * env * gain;
    }
    return buffer;
  }

  play(name) {
    if (!this.enabled) return;
    const ctx = this.ready();
    if (!ctx) return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
  }
}
