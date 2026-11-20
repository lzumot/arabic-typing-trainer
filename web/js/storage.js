// Thin client for the local server. Nothing leaves 127.0.0.1.

const API = '';

async function request(path, options) {
  const res = await fetch(API + path, options);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (_) { /* ignore */ }
    throw new Error('Request failed (' + res.status + ') ' + detail);
  }
  return res.json();
}

export class Storage {
  constructor() {
    this.online = false;
    this.pending = [];
    this.flushing = false;
  }

  async probe() {
    try {
      const health = await request('/api/health');
      this.online = !!health.ok;
    } catch (_) {
      this.online = false;
    }
    return this.online;
  }

  async load(days = 120) {
    return request('/api/data?days=' + days);
  }

  insert(table, rows) {
    if (!rows || !rows.length) return Promise.resolve(0);
    return request('/api/insert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table, rows }),
    }).then((r) => r.inserted, (err) => {
      console.warn('[storage] insert failed', table, err);
      return 0;
    });
  }

  update(table, id, patch) {
    return request('/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table, id, patch }),
    }).catch((err) => console.warn('[storage] update failed', table, err));
  }

  remove(table, id) {
    return request('/api/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table, id }),
    }).catch((err) => console.warn('[storage] delete failed', table, err));
  }
}

export function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 7);
}
