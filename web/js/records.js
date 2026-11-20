import { ROWS, LAYOUT } from './keymap.js';
import { formatSeconds } from './metrics.js';

function glow(median) {
  if (!median) return 0.12;
  const fast = 350;
  const slow = 2200;
  const t = Math.min(1, Math.max(0, (slow - median) / (slow - fast)));
  return 0.14 + t * 0.86;
}

export class RecordsView {
  constructor(app, root) {
    this.app = app;
    this.root = root;
  }

  render() {
    const bests = this.app.bests;
    const letters = [...bests.values()]
      .filter((b) => b.key.startsWith('letter:'))
      .map((b) => ({ ch: b.key.slice(7), value: b.value }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 3);
    const ghosts = [...bests.values()].filter((b) => b.key.startsWith('ghosttime:'));
    const titles = {};
    this.app.allTexts().forEach((t) => { titles[t.id] = t.title || t.content.slice(0, 20); });
    const clean = bests.get('clean');

    this.root.innerHTML = `
      <div class="panel records">
        <button class="close-btn" id="records-close" aria-label="Close">×</button>
        <h1>My records</h1>
        ${letters.length ? `<div class="record-line big">Your fastest ${letters[0].ch} so far: <b>${formatSeconds(letters[0].value)}</b></div>` : '<div class="record-line">The letters are still warming up.</div>'}
        <div class="record-list">
          ${letters.slice(1).map((l) => `<div class="record-line">${l.ch} · ${formatSeconds(l.value)}</div>`).join('')}
          ${clean ? `<div class="record-line">Longest clean run: <b>${clean.value}</b> letters</div>` : ''}
          ${ghosts.map((g) => `<div class="record-line">${titles[g.key.slice(10)] || g.key.slice(10)} · <b>${g.value.toFixed(1)} s</b></div>`).join('')}
        </div>
        <h2>Letters</h2>
        <div class="mini-keyboard" id="records-keys"></div>
      </div>`;

    const keys = this.root.querySelector('#records-keys');
    ROWS.slice(1).forEach((row) => {
      const line = document.createElement('div');
      line.className = 'mini-row';
      row.forEach((code) => {
        const ch = LAYOUT[code][0];
        const stat = this.app.letterHistory[ch];
        const cell = document.createElement('span');
        cell.className = 'mini-key';
        cell.textContent = ch;
        cell.style.setProperty('--g', glow(stat ? stat.median : null));
        line.appendChild(cell);
      });
      keys.appendChild(line);
    });

    this.root.querySelector('#records-close').addEventListener('click', () => this.app.closeOverlay());
  }

  destroy() {}
}
