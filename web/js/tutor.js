import { ROWS, LAYOUT } from './keymap.js';
import {
  letterMedians, errorCounts, confusionTable, sessionStats, weeklyMedians,
  weekKey, median, HUNT_MS,
} from './metrics.js';
import { uid } from './storage.js';

const esc = (value) => String(value == null ? '' : value)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDateTime = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtWeek = (ms) => {
  const start = new Date(ms);
  const end = new Date(ms + 6 * 86400000);
  return fmtDate(start) + ' – ' + fmtDate(end);
};

const CLASS_LABELS = {
  spelling: 'Spelling confusion',
  shift: 'Shift-layer miss',
  neighbour: 'Neighbour slip',
  location: 'Location miss',
};
const CLASS_COLORS = { spelling: '#e0913c', shift: '#b06fd0', neighbour: '#5aa6c8', location: '#7d7d88' };

function lineChart({ series, width = 780, height = 210, baseline = null, unit = '' }) {
  const points = series.flatMap((s) => s.points);
  if (!points.length) return '<p class="empty">No sessions yet.</p>';
  const rawMax = Math.max(baseline || 0, ...points.map((p) => p.y), 1) * 1.1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((v) => rawMax / v <= 4) || magnitude * 10;
  const maxY = step * 4;
  const padLeft = 44;
  const padBottom = 26;
  const n = Math.max(...series.map((s) => s.points.length), 2);
  const x = (i) => padLeft + (i / (n - 1)) * (width - padLeft - 12);
  const y = (v) => height - padBottom - (v / maxY) * (height - padBottom - 12);
  let grid = '';
  for (let g = 0; g <= 4; g += 1) {
    const value = step * g;
    grid += `<line x1="${padLeft}" x2="${width - 12}" y1="${y(value)}" y2="${y(value)}" class="grid"/>`;
    grid += `<text x="${padLeft - 8}" y="${y(value) + 4}" class="axis" text-anchor="end">${value.toFixed(0)}</text>`;
  }
  const paths = series.map((s) => {
    if (!s.points.length) return '';
    const d = s.points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ');
    const dots = s.points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="2.6" fill="${s.color}"/>`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}`;
  }).join('');
  const baselineLine = baseline
    ? `<line x1="${padLeft}" x2="${width - 12}" y1="${y(baseline)}" y2="${y(baseline)}" class="baseline"/>
       <text x="${width - 14}" y="${y(baseline) - 6}" class="axis" text-anchor="end">pen ${baseline.toFixed(1)} ${unit}</text>`
    : '';
  const legend = series.map((s) => `<span class="legend-dot" style="background:${s.color}"></span>${esc(s.name)}`).join(' ');
  return `<div class="legend">${legend}</div>
    <svg viewBox="0 0 ${width} ${height}" class="chart" role="img">${grid}${baselineLine}${paths}</svg>`;
}

function stackedBars(rows, width = 780, height = 210) {
  if (!rows.length) return '<p class="empty">No sessions yet.</p>';
  const keys = ['spelling', 'shift', 'neighbour', 'location'];
  const max = Math.max(1, ...rows.map((r) => keys.reduce((s, k) => s + (r.values[k] || 0), 0)));
  const barW = Math.min(34, (width - 60) / rows.length - 6);
  const step = (width - 60) / Math.max(1, rows.length);
  let bars = '';
  rows.forEach((row, i) => {
    let base = height - 24;
    const total = keys.reduce((s, k) => s + (row.values[k] || 0), 0);
    keys.forEach((k) => {
      const value = row.values[k] || 0;
      if (!value) return;
      const h = (value / max) * (height - 44);
      base -= h;
      bars += `<rect x="${40 + i * step}" y="${base}" width="${barW}" height="${h}" fill="${CLASS_COLORS[k]}"><title>${k}: ${value}</title></rect>`;
    });
    bars += `<text x="${40 + i * step + barW / 2}" y="${height - 8}" class="axis" text-anchor="middle">${esc(row.label)}</text>`;
    if (total === 0) bars += `<text x="${40 + i * step + barW / 2}" y="${height - 30}" class="axis" text-anchor="middle">·</text>`;
  });
  const legend = keys.map((k) => `<span class="legend-dot" style="background:${CLASS_COLORS[k]}"></span>${CLASS_LABELS[k]}`).join(' ');
  return `<div class="legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" class="chart">${bars}</svg>`;
}

function heatColor(rt) {
  if (!rt) return 'rgba(255,255,255,0.04)';
  const t = Math.min(1, Math.max(0, (rt - 350) / 2100));
  const hue = 188 - t * 168;
  return 'hsl(' + hue.toFixed(0) + ' 58% ' + (56 - t * 10).toFixed(0) + '%)';
}

function heatmap(medians, flags) {
  let html = '<div class="heatmap">';
  ROWS.slice(1).forEach((row) => {
    html += '<div class="heat-row">';
    row.forEach((code) => {
      const ch = LAYOUT[code][0];
      const stat = medians[ch];
      const hunt = flags && flags[ch];
      const rt = stat ? stat.median : null;
      html += `<div class="heat-key${hunt ? ' hunt' : ''}" style="background:${heatColor(rt)}" title="${esc(ch)} · ${rt ? (rt / 1000).toFixed(2) + ' s' : 'no data'}">`
        + `<span class="heat-ch">${esc(ch)}</span>`
        + `<span class="heat-val">${rt ? (rt / 1000).toFixed(1) : '—'}</span></div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

export class TutorView {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.tab = 'speed';
  }

  async render() {
    try {
      const loaded = await this.app.storage.load(400);
      Object.keys(this.app.data).forEach((table) => {
        if (Array.isArray(loaded[table])) this.app.data[table] = loaded[table];
      });
    } catch (err) {
      console.warn('[tutor] refresh failed', err);
    }
    this.root.innerHTML = `
      <div class="panel tutor">
        <header class="tutor-head">
          <h1>Tutor</h1>
          <nav class="tabs" id="tutor-tabs">
            ${[['speed', 'Speed'], ['letters', 'Letters'], ['errors', 'Errors'], ['engage', 'Engagement'], ['signals', 'Frustration'], ['data', 'Data']]
    .map(([id, label]) => `<button class="tab${this.tab === id ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}
          </nav>
          <button class="close-btn" id="tutor-close" aria-label="Close">×</button>
        </header>
        <div class="tutor-body" id="tutor-body"></div>
      </div>`;
    this.body = this.root.querySelector('#tutor-body');
    this.root.querySelector('#tutor-close').addEventListener('click', () => this.app.closeOverlay());
    this.root.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        this.tab = button.dataset.tab;
        this.root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b === button));
        this.renderBody();
      });
    });
    this.renderBody();
  }

  context() {
    const { sessions, rounds, keystrokes, signals, baselines } = this.app.data;
    const stats = sessions
      .map((s) => sessionStats(s, rounds, keystrokes, signals))
      .sort((a, b) => a.start - b.start);
    return { sessions, rounds, keystrokes, signals, baselines, stats };
  }

  renderBody() {
    if (this.tab === 'speed') this.renderSpeed();
    else if (this.tab === 'letters') this.renderLetters();
    else if (this.tab === 'errors') this.renderErrors();
    else if (this.tab === 'engage') this.renderEngagement();
    else if (this.tab === 'signals') this.renderSignals();
    else this.renderData();
  }

  renderSpeed() {
    const { stats, baselines } = this.context();
    const usable = stats.filter((s) => s.chars > 0);
    const baselineWpm = median((baselines || []).map((b) => (b.words && b.seconds ? b.words / (b.seconds / 60) : null)));
    const weekly = weeklyMedians(stats, 'wpm');
    this.body.innerHTML = `
      <section>
        <h2>Speed per session</h2>
        ${lineChart({
    series: [
      { name: 'WPM', color: '#7fd1b9', points: usable.map((s) => ({ x: s.start, y: s.wpm })) },
      { name: 'CPM', color: '#6fa8dc', points: usable.map((s) => ({ x: s.start, y: s.cpm })) },
    ],
    baseline: baselineWpm,
    unit: 'wpm',
  })}
      </section>
      <section>
        <h2>Weekly medians</h2>
        ${weekly.length ? `<table class="grid-table"><thead><tr><th>Week</th><th>Median WPM</th><th>Sessions</th></tr></thead><tbody>
          ${weekly.map((w) => `<tr><td>${fmtWeek(w.week)}</td><td>${w.value.toFixed(1)}</td><td>${w.n}</td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">Two sessions make a week.</p>'}
      </section>
      <section>
        <h2>Handwriting baseline</h2>
        ${baselineWpm ? `<p class="note">Pen speed on the same kind of text: <b>${baselineWpm.toFixed(1)} wpm</b>.</p>` : '<p class="empty">No baseline entered yet. Add one under Data.</p>'}
      </section>`;
  }

  weekList() {
    const { rounds } = this.context();
    const weeks = [...new Set(rounds.map((r) => weekKey(r.start)))].sort();
    return weeks;
  }

  keystrokesByWeek() {
    const { keystrokes, rounds } = this.context();
    const weekOf = new Map(rounds.map((r) => [r.id, weekKey(r.start)]));
    const map = new Map();
    keystrokes.forEach((k) => {
      const w = weekOf.get(k.round_id);
      if (w == null) return;
      if (!map.has(w)) map.set(w, []);
      map.get(w).push(k);
    });
    return map;
  }

  renderLetters() {
    const weeks = this.weekList();
    if (!weeks.length) {
      this.body.innerHTML = '<p class="empty">No typed letters yet.</p>';
      return;
    }
    const selected = this.selectedWeek != null && weeks.includes(this.selectedWeek) ? this.selectedWeek : weeks[weeks.length - 1];
    this.selectedWeek = selected;
    const byWeek = this.keystrokesByWeek();
    const all = letterMedians(this.app.data.keystrokes);
    const current = letterMedians(byWeek.get(selected) || []);
    const previousIndex = weeks.indexOf(selected) - 1;
    const compare = this.compare;

    const hunts = Object.entries(current)
      .filter(([ch, stat]) => stat.median != null && stat.n >= 3 && (stat.median > HUNT_MS || (all[ch] && stat.median > all[ch].median * 2)))
      .sort((a, b) => b[1].median - a[1].median);

    this.body.innerHTML = `
      <section class="toolbar">
        <label>Week
          <select id="week-select">
            ${weeks.slice().reverse().map((w) => `<option value="${w}"${w === selected ? ' selected' : ''}>${fmtWeek(w)}</option>`).join('')}
          </select>
        </label>
        <label class="check"><input type="checkbox" id="compare-toggle"${compare ? ' checked' : ''}> Compare with the week before</label>
      </section>
      <section>
        <h2>Median reaction time · ${fmtWeek(selected)}</h2>
        ${heatmap(current, Object.fromEntries(Object.entries(current).map(([ch, s]) => [ch, s.median > HUNT_MS])))}
        <div class="legend"><span class="legend-dot" style="background:#3fa9a0"></span>fast
          <span class="legend-dot" style="background:#c9702c"></span>slow
          <span class="legend-dot" style="border:1px solid #fff"></span>hunt</div>
      </section>
      ${compare && previousIndex >= 0 ? `<section>
        <h2>Median reaction time · ${fmtWeek(weeks[previousIndex])}</h2>
        ${heatmap(letterMedians(byWeek.get(weeks[previousIndex]) || []), null)}
      </section>` : ''}
      <section>
        <h2>Hunts this week</h2>
        ${hunts.length
    ? `<ul class="plain">${hunts.map(([ch, s]) => `<li>${esc(ch)} · median ${(s.median / 1000).toFixed(2)} s · ${s.n} presses</li>`).join('')}</ul>`
    : '<p class="empty">Nothing above 1.5 s.</p>'}
      </section>`;

    this.body.querySelector('#week-select').addEventListener('change', (ev) => {
      this.selectedWeek = Number(ev.target.value);
      this.renderLetters();
    });
    this.body.querySelector('#compare-toggle').addEventListener('change', (ev) => {
      this.compare = ev.target.checked;
      this.renderLetters();
    });
  }

  renderErrors() {
    const { rounds, keystrokes, sessions } = this.context();
    const bySession = sessions.map((s) => {
      const roundIds = new Set(rounds.filter((r) => r.session_id === s.id).map((r) => r.id));
      const ks = keystrokes.filter((k) => roundIds.has(k.round_id));
      return { label: fmtDate(s.start), values: errorCounts(ks) };
    }).filter((r) => Object.values(r.values).some((v) => v));
    const totals = errorCounts(keystrokes);
    const confusions = confusionTable(keystrokes).slice(0, 15);
    this.body.innerHTML = `
      <section>
        <h2>Error classes per session</h2>
        ${stackedBars(bySession.slice(-16))}
      </section>
      <section>
        <h2>Totals</h2>
        <table class="grid-table"><tbody>
          ${Object.entries(totals).map(([k, v]) => `<tr><td>${CLASS_LABELS[k]}</td><td>${v}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section>
        <h2>Spelling confusions</h2>
        ${confusions.length
    ? `<table class="grid-table"><thead><tr><th>Typed</th><th>Count</th></tr></thead><tbody>
        ${confusions.map((c) => `<tr><td dir="rtl" class="big-rtl">${esc(c.pair)}</td><td>${c.n}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="empty">No spelling confusions logged yet.</p>'}
      </section>`;
  }

  renderEngagement() {
    const { stats, rounds } = this.context();
    const byWeek = new Map();
    stats.forEach((s) => {
      const w = weekKey(s.start);
      byWeek.set(w, (byWeek.get(w) || 0) + 1);
    });
    const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
    const lengths = median(stats.map((s) => s.minutes));
    const continuedRounds = rounds.filter((r) => r.continued).length;
    const modes = {};
    rounds.forEach((r) => { modes[r.mode] = (modes[r.mode] || 0) + 1; });
    const maxWeek = Math.max(1, ...weeks.map((w) => w[1]));
    this.body.innerHTML = `
      <section class="stat-row">
        <div class="stat"><span class="stat-num">${stats.length}</span><span class="stat-label">sessions</span></div>
        <div class="stat"><span class="stat-num">${lengths ? lengths.toFixed(0) : '—'}</span><span class="stat-label">median minutes</span></div>
        <div class="stat"><span class="stat-num">${rounds.length ? Math.round((continuedRounds / rounds.length) * 100) : 0}%</span><span class="stat-label">rounds continued</span></div>
        <div class="stat"><span class="stat-num">${stats.filter((s) => s.start > Date.now() - 7 * 86400000).length}</span><span class="stat-label">sessions this week</span></div>
      </section>
      <section>
        <h2>Sessions per week</h2>
        ${weeks.length ? `<div class="weekbars">${weeks.map(([w, n]) => `<div class="weekbar"><i style="height:${(n / maxWeek) * 100}%"></i><span>${fmtWeek(w)}</span><b>${n}</b></div>`).join('')}</div>` : '<p class="empty">Nothing yet.</p>'}
      </section>
      <section>
        <h2>Modes picked</h2>
        <table class="grid-table"><tbody>
          ${Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<tr><td>${esc(m)}</td><td>${n}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section>
        <h2>Sessions</h2>
        <table class="grid-table"><thead><tr><th>Start</th><th>Min</th><th>Rounds</th><th>WPM</th><th>Acc</th></tr></thead><tbody>
          ${stats.slice().reverse().slice(0, 20).map((s) => `<tr><td>${fmtDateTime(s.start)}</td><td>${s.minutes.toFixed(0)}</td><td>${s.rounds}</td><td>${s.wpm.toFixed(1)}</td><td>${s.accuracy == null ? '—' : Math.round(s.accuracy * 100) + '%'}</td></tr>`).join('')}
        </tbody></table>
      </section>`;
  }

  renderSignals() {
    const { sessions, signals, stats } = this.context();
    const order = stats.slice().reverse().slice(0, 15);
    const countsFor = (id) => {
      const list = signals.filter((s) => s.session_id === id);
      const out = { mash: 0, stall: 0, quick_exit: 0, low_accuracy: 0 };
      list.forEach((s) => { out[s.type] = (out[s.type] || 0) + 1; });
      return out;
    };
    this.body.innerHTML = `
      <section>
        <h2>Signals next to the tutor rating</h2>
        <table class="grid-table signal-table"><thead><tr><th>Session</th><th>Mash</th><th>Stall</th><th>Quick exit</th><th>Low acc.</th><th>Rating 1–5</th><th>Notes</th></tr></thead><tbody>
          ${order.map((s) => {
    const c = countsFor(s.id);
    const session = sessions.find((x) => x.id === s.id) || {};
    const rating = session.tutor_rating || '';
    return `<tr>
              <td>${fmtDateTime(s.start)}</td>
              <td>${c.mash}</td><td>${c.stall}</td><td>${c.quick_exit}</td><td>${c.low_accuracy}</td>
              <td class="rating" data-session="${s.id}">
                ${[1, 2, 3, 4, 5].map((n) => `<button class="rate${Number(rating) === n ? ' on' : ''}" data-n="${n}">${n}</button>`).join('')}
              </td>
              <td><input class="note-input" data-session="${s.id}" value="${esc(session.notes || '')}" placeholder="……"></td>
            </tr>`;
  }).join('')}
        </tbody></table>
      </section>`;

    this.body.querySelectorAll('.rate').forEach((button) => {
      button.addEventListener('click', (ev) => {
        const cell = ev.target.closest('.rating');
        const id = cell.dataset.session;
        const value = Number(ev.target.dataset.n);
        cell.querySelectorAll('.rate').forEach((b) => b.classList.toggle('on', b === ev.target));
        this.updateSession(id, { tutor_rating: value });
      });
    });
    this.body.querySelectorAll('.note-input').forEach((input) => {
      input.addEventListener('change', () => {
        this.updateSession(input.dataset.session, { notes: input.value });
      });
    });
  }

  updateSession(id, patch) {
    const row = this.app.data.sessions.find((s) => s.id === id);
    if (row) Object.assign(row, patch);
    this.app.storage.update('sessions', id, patch);
  }

  renderData() {
    const { baselines } = this.context();
    const texts = this.app.data.texts || [];
    const clockOn = this.app.clockVisible;
    this.body.innerHTML = `
      <section>
        <h2>Display</h2>
        <label class="check"><input type="checkbox" id="clock-toggle"${clockOn ? ' checked' : ''}> Show the counting clock</label>
      </section>
      <section>
        <h2>Handwriting baseline</h2>
        <form class="grid-form" id="baseline-form">
          <label>Date <input type="date" id="b-date" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>Seconds <input type="number" id="b-seconds" min="1" step="1"></label>
          <label>Words <input type="number" id="b-words" min="1" step="1"></label>
          <label>ة/ه errors <input type="number" id="b-tehe" min="0" value="0"></label>
          <label>ى/ي errors <input type="number" id="b-ya" min="0" value="0"></label>
          <label>Hamza errors <input type="number" id="b-hamza" min="0" value="0"></label>
          <label class="wide">Note <input type="text" id="b-note"></label>
          <button type="submit">Save baseline</button>
        </form>
        ${baselines.length ? `<table class="grid-table"><thead><tr><th>Date</th><th>WPM</th><th>Errors</th><th></th></tr></thead><tbody>
          ${baselines.slice().reverse().map((b) => `<tr>
            <td>${fmtDate(b.date)}</td>
            <td>${(b.words && b.seconds ? b.words / (b.seconds / 60) : 0).toFixed(1)}</td>
            <td>${esc(b.errors_tehe || 0)}/${esc(b.errors_ya || 0)}/${esc(b.errors_hamza || 0)}</td>
            <td><button class="link-btn" data-del-baseline="${b.id}">remove</button></td>
          </tr>`).join('')}
        </tbody></table>` : '<p class="empty">Pen measurements go here so both sit on one chart.</p>'}
      </section>
      <section>
        <h2>Texts</h2>
        ${texts.length ? `<table class="grid-table"><thead><tr><th>Title</th><th>Source</th><th></th></tr></thead><tbody>
          ${texts.slice().reverse().map((t) => `<tr><td>${esc(t.title || t.content.slice(0, 30))}</td><td>${esc(t.source)}</td>
            <td><button class="link-btn" data-del-text="${t.id}">remove</button></td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">Homework pasted in Boss text lands here.</p>'}
      </section>
      <section>
        <h2>Export and backup</h2>
        <p class="note">Everything lives in <code>data/trainer.db</code> inside the app folder. Clearing the browser cannot touch it.</p>
        <div class="export-row">
          <a class="soft-btn" href="/api/export/keystrokes.csv" download>Raw events CSV</a>
          <a class="soft-btn" href="/api/export/rounds.csv" download>Rounds CSV</a>
          <a class="soft-btn" href="/api/export/sessions.csv" download>Sessions CSV</a>
          <a class="soft-btn" href="/api/backup" download>Backup database</a>
        </div>
      </section>`;

    const clock = this.body.querySelector('#clock-toggle');
    clock.addEventListener('change', () => this.app.setClockVisible(clock.checked));

    this.body.querySelector('#baseline-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = (id) => this.body.querySelector(id).value;
      const row = {
        id: uid('base'),
        date: new Date(value('#b-date') + 'T12:00:00').getTime(),
        text_id: null,
        seconds: Number(value('#b-seconds')) || 0,
        words: Number(value('#b-words')) || 0,
        errors_tehe: Number(value('#b-tehe')) || 0,
        errors_ya: Number(value('#b-ya')) || 0,
        errors_hamza: Number(value('#b-hamza')) || 0,
        note: value('#b-note'),
      };
      this.app.data.baselines.push(row);
      this.app.storage.insert('baselines', [row]);
      this.renderData();
    });

    this.body.querySelectorAll('[data-del-baseline]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.delBaseline;
        this.app.data.baselines = this.app.data.baselines.filter((b) => b.id !== id);
        this.app.storage.remove('baselines', id);
        this.renderData();
      });
    });
    this.body.querySelectorAll('[data-del-text]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.delText;
        this.app.data.texts = this.app.data.texts.filter((t) => t.id !== id);
        this.app.storage.remove('texts', id);
        this.renderData();
      });
    });
  }

  onKey() {}

  destroy() {}
}
