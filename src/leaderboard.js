// Catnap — online leaderboard client (Supabase REST, no SDK).
(function (root) {
  'use strict';
  const cfg = root.CATNAP_CONFIG || {};
  const base = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const key = cfg.supabaseKey || '';
  const enabled = !!(base && key);

  function headers(json) {
    const h = { apikey: key, Accept: 'application/json' };
    // Legacy anon keys are JWTs and may also go in Authorization;
    // new sb_publishable_ keys must only be sent as apikey.
    if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  async function request(path, opts = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await fetch(base + path, Object.assign({ signal: ctl && ctl.signal }, opts));
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const err = new Error((data && (data.message || data.hint)) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally { if (timer) clearTimeout(timer); }
  }

  // ISO week id matching Postgres to_char(now(), 'IYYY-"W"IW')
  function isoWeek(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
  }

  async function pidOf(uuid) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uuid));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    } catch { return null; }
  }

  function submit({ board, player, name, timeMs = null, score = null, regions = null, solution = null }) {
    return request('/rest/v1/rpc/submit_score', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ p_board: board, p_player: player, p_name: name, p_time_ms: timeMs, p_score: score, p_regions: regions, p_solution: solution })
    });
  }

  function top(board, kind = 'time', limit = 50) {
    const order = kind === 'score' ? 'score.desc,updated_at.asc' : 'time_ms.asc,updated_at.asc';
    const q = `?board=eq.${encodeURIComponent(board)}&select=name,time_ms,score,pid&order=${order}&limit=${limit}`;
    return request('/rest/v1/leaderboard' + q, { headers: headers(false) });
  }

  const api = { enabled, submit, top, pidOf, isoWeek };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatnapLB = api;
})(typeof window !== 'undefined' ? window : globalThis);
