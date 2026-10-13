/* Cliente del backend (Apps Script) + cola offline + modo demo. */
(function () {
  const CFG = window.PC_CONFIG || {};
  const IN = 'INGRESO';
  const OUT = 'RETIRO';
  const DUP_WINDOW_MS = 20 * 1000;

  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem('pc_' + k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try { localStorage.setItem('pc_' + k, JSON.stringify(v)); } catch (e) { /* sin storage */ }
    },
  };

  // Misma lógica que normalizeCode_() en apps-script/Code.gs.
  function normalizeCode(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) {
      const m = s.match(/[?&](?:chip|code|tag|id|transponder)=([^&#]+)/i);
      s = m ? decodeURIComponent(m[1]) : s.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
    }
    return s.replace(/\s+/g, '').toUpperCase();
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function deviceId() {
    let d = store.get('device');
    if (!d) {
      d = 'DISP-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      store.set('device', d);
    }
    return d;
  }

  class ApiError extends Error {
    constructor(code, network) {
      super(code);
      this.code = code;
      this.network = !!network;
    }
  }

  /* ---------- Modo demo: replica la lógica del Apps Script en localStorage ---------- */
  const Mock = {
    events() { return store.get('demo_events', []); },
    save(ev) { store.set('demo_events', ev); },
    participants() {
      const p = {};
      for (let i = 1; i <= 120; i++) {
        p[demoCode(i)] = { dorsal: String(i), nombre: 'Corredor ' + i, categoria: i % 3 ? 'Elite' : 'Master' };
      }
      return p;
    },
    inside(ev) {
      const st = {};
      ev.forEach((e) => { st[e[2]] = e[3]; });
      return Object.keys(st).filter((c) => st[c] === IN).length;
    },
    record(scan) {
      const ev = this.events();
      const code = normalizeCode(scan.code || scan.raw);
      if (!code) return { id: scan.id, status: 'invalid' };
      const ts = Number(scan.ts) || Date.now();
      const dupe = ev.find((e) => e[0] === scan.id);
      if (dupe) return { id: scan.id, status: 'already_saved', code, type: dupe[3], inside: this.inside(ev) };
      let last = null;
      ev.forEach((e) => { if (e[2] === code) last = { ts: e[1], type: e[3] }; });
      const mode = scan.mode || 'AUTO';
      const participant = this.participants()[code] || null;
      if (last && Math.abs(ts - last.ts) < DUP_WINDOW_MS &&
          (mode === 'AUTO' || (mode === 'IN' ? IN : OUT) === last.type)) {
        return { id: scan.id, status: 'duplicate', code, type: last.type, participant, inside: this.inside(ev) };
      }
      const wasInside = last && last.type === IN;
      const type = mode === 'IN' ? IN : mode === 'OUT' ? OUT : wasInside ? OUT : IN;
      let warning = null;
      if (type === IN && wasInside) warning = 'El chip ya figuraba dentro del parque';
      if (type === OUT && !wasInside) warning = 'El chip no tenía ingreso registrado';
      ev.push([scan.id || uuid(), ts, code, type, scan.puesto || '', scan.device || '']);
      this.save(ev);
      return { id: scan.id, status: 'saved', code, type, warning, participant, inside: this.inside(ev) };
    },
    seed() {
      // Jornada de ejemplo: ingresos desde las 7:00, retiros desde las 13:00.
      const ev = [];
      const day = new Date();
      day.setHours(7, 0, 0, 0);
      const t0 = day.getTime();
      const now = Date.now();
      for (let i = 1; i <= 96; i++) {
        const tin = t0 + Math.round(Math.pow(Math.random(), 1.4) * 4.5 * 3600e3);
        if (tin < now) ev.push([uuid(), tin, demoCode(i), IN, i % 2 ? 'Puerta A' : 'Puerta B', 'DEMO']);
        if (i % 4 !== 0) {
          const tout = t0 + 6 * 3600e3 + Math.round(Math.random() * 4 * 3600e3);
          if (tout < now) ev.push([uuid(), tout, demoCode(i), OUT, 'Puerta A', 'DEMO']);
        }
      }
      ev.sort((a, b) => a[1] - b[1]);
      this.save(ev);
    },
    call(action, payload) {
      if (action === 'ping') return { ok: true };
      if (action === 'scan') return Object.assign({ ok: true }, this.record(payload.scan));
      if (action === 'sync') return { ok: true, results: payload.scans.map((s) => this.record(s)) };
      if (action === 'events') {
        return { ok: true, events: this.events(), participants: this.participants(), serverTime: Date.now() };
      }
      return { ok: false, error: 'unknown_action' };
    },
  };

  function demoCode(i) {
    return 'TT-' + String(40000 + i * 37).padStart(5, '0');
  }

  /* ---------- API ---------- */
  const API = {
    IN,
    OUT,
    store,
    normalizeCode,
    uuid,
    deviceId,
    ApiError,
    Mock,
    isDemo: !CFG.API_URL,
    getKey() { return store.get('key', ''); },
    setKey(k) { store.set('key', String(k || '').trim()); },

    async call(action, payload) {
      if (API.isDemo) {
        await new Promise((r) => setTimeout(r, 120));
        return Mock.call(action, payload || {});
      }
      let res;
      try {
        res = await fetch(CFG.API_URL, {
          method: 'POST',
          // text/plain evita el preflight CORS que Apps Script no responde.
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action, key: API.getKey() }, payload || {})),
          redirect: 'follow',
        });
      } catch (e) {
        throw new ApiError('network', true);
      }
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new ApiError('bad_response', !res.ok);
      }
      if (!data.ok) throw new ApiError(data.error || 'error');
      return data;
    },

    /* Cola offline: escaneos que no alcanzaron a llegar al servidor. */
    queue: {
      list() { return store.get('queue', []); },
      add(scan) {
        const q = store.get('queue', []);
        q.push(scan);
        store.set('queue', q);
      },
      size() { return store.get('queue', []).length; },
      async flush() {
        const q = store.get('queue', []);
        if (!q.length) return [];
        const data = await API.call('sync', { scans: q });
        const done = new Set(data.results.map((r) => r.id));
        store.set('queue', store.get('queue', []).filter((s) => !done.has(s.id)));
        return data.results;
      },
    },
  };

  window.PC_API = API;
})();
