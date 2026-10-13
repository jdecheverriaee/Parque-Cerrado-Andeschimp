(function () {
  const API = window.PC_API;
  const CFG = window.PC_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const LONG_STAY_MS = 6 * 3600e3; // resalta bicis con más de 6 h dentro

  const C = {
    brand: '#33a8e0', in: '#22c55e', out: '#f59e0b',
    grid: 'rgba(142,163,192,0.14)', text: '#8ea3c0',
  };

  let data = { events: [], participants: {} };
  let charts = {};

  /* ---------- Utilidades ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hhmm = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const hhmmss = (ts) => hhmm(ts) + ':' + pad(new Date(ts).getSeconds());
  const shortDate = (ts) => new Date(ts).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
  function dur(ms) {
    if (!isFinite(ms) || ms < 0) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + pad(m % 60);
  }
  function td(text, cls) {
    const c = document.createElement('td');
    if (cls) c.className = cls;
    if (text instanceof Node) c.appendChild(text); else c.textContent = text == null ? '' : text;
    return c;
  }
  function tag(type) {
    const s = document.createElement('span');
    s.className = 'tag ' + (type === API.IN ? 'in' : 'out');
    s.textContent = type;
    return s;
  }
  const part = (code) => data.participants[code] || {};

  /* ---------- Periodo ---------- */
  function periodRange() {
    const v = $('period').value || 'today';
    if (v === 'all') return { all: true, from: -Infinity, to: Infinity };
    const key = v === 'today' ? dayKey(Date.now()) : v;
    const [y, m, d] = key.split('-').map(Number);
    const from = new Date(y, m - 1, d).getTime();
    return { all: false, from, to: from + 86400e3 };
  }

  function fillPeriods() {
    const sel = $('period');
    const current = sel.value || API.store.get('dash_period', 'today');
    const today = dayKey(Date.now());
    const days = Array.from(new Set(data.events.map((e) => dayKey(e[1])))).filter((d) => d !== today).sort().reverse();
    sel.innerHTML = '';
    const opt = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    opt('today', 'Hoy');
    days.forEach((d) => opt(d, new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })));
    opt('all', 'Todo el historial');
    sel.value = Array.from(sel.options).some((o) => o.value === current) ? current : 'today';
  }

  /* ---------- Cálculo de métricas ---------- */
  function compute() {
    const ev = data.events.slice().sort((a, b) => a[1] - b[1]);
    const R = periodRange();
    const now = Date.now();
    const state = {}; // código -> { type, ts }
    let occ = 0;
    let startOcc = null;
    const series = [];
    const stays = [];
    const inPeriod = [];
    let peak = { n: 0, ts: null };

    for (const e of ev) {
      const [, ts, code, type] = e;
      if (ts >= R.from && startOcc === null) {
        startOcc = occ;
        if (!R.all) series.push({ x: R.from, y: occ });
        peak = { n: occ, ts: R.all ? null : R.from };
      }
      const prev = state[code];
      const wasIn = prev && prev.type === API.IN;
      if (type === API.IN && !wasIn) occ++;
      if (type === API.OUT && wasIn) occ--;
      if (ts >= R.from && ts < R.to) {
        inPeriod.push(e);
        series.push({ x: ts, y: occ });
        if (occ > peak.n) peak = { n: occ, ts };
        if (type === API.OUT && wasIn) stays.push(ts - prev.ts);
      }
      // Un ingreso repetido no reinicia el tiempo de permanencia.
      if (!(type === API.IN && wasIn)) state[code] = { type, ts };
    }
    if (startOcc === null) { startOcc = occ; if (!R.all) series.push({ x: R.from, y: occ }); }
    // El gráfico parte 30 min antes del primer movimiento del día, no a medianoche.
    if (!R.all && inPeriod.length && series.length) {
      series[0].x = Math.max(R.from, inPeriod[0][1] - 30 * 60e3);
    }
    const end = Math.min(R.to, now);
    if (series.length && end > series[series.length - 1].x) {
      series.push({ x: end, y: series[series.length - 1].y });
    }

    const inside = Object.keys(state)
      .filter((c) => state[c].type === API.IN)
      .map((c) => ({ code: c, ts: state[c].ts }))
      .sort((a, b) => a.ts - b.ts);

    return {
      R, inside, series, inPeriod, peak,
      ins: inPeriod.filter((e) => e[3] === API.IN).length,
      outs: inPeriod.filter((e) => e[3] === API.OUT).length,
      unique: new Set(inPeriod.map((e) => e[2])).size,
      avgStay: stays.length ? stays.reduce((a, b) => a + b, 0) / stays.length : NaN,
      stays: stays.length,
    };
  }

  /* ---------- Render ---------- */
  function render() {
    const m = compute();
    const now = Date.now();

    $('kInside').textContent = m.inside.length;
    const longOnes = m.inside.filter((b) => now - b.ts > LONG_STAY_MS).length;
    $('kInsideSub').textContent = longOnes ? longOnes + ' con más de 6 h dentro' : 'según último escaneo de cada chip';
    $('kIn').textContent = m.ins;
    $('kOut').textContent = m.outs;
    $('kUnique').textContent = m.unique;
    $('kStay').textContent = dur(m.avgStay);
    $('kStaySub').textContent = m.stays ? m.stays + ' retiros completados' : 'sin retiros aún';
    $('kPeak').textContent = m.peak.n;
    $('kPeakSub').textContent = m.peak.ts ? 'a las ' + hhmm(m.peak.ts) + (m.R.all ? ' · ' + shortDate(m.peak.ts) : '') : '';

    renderInside(m.inside);
    renderLog(m.inPeriod);
    renderCharts(m);
  }

  function renderInside(list) {
    const q = $('search').value.trim().toLowerCase();
    const now = Date.now();
    const rows = list.filter((b) => {
      if (!q) return true;
      const p = part(b.code);
      return [b.code, p.dorsal, p.nombre].some((v) => String(v || '').toLowerCase().includes(q));
    });
    $('insideCount').textContent = list.length;
    const body = $('insideBody');
    body.innerHTML = '';
    rows.forEach((b) => {
      const p = part(b.code);
      const tr = document.createElement('tr');
      if (now - b.ts > LONG_STAY_MS) tr.className = 'long';
      tr.append(td(b.code, 'mono'), td(p.dorsal || '—'), td(p.nombre || ''),
        td(dayKey(b.ts) === dayKey(now) ? hhmm(b.ts) : shortDate(b.ts) + ' ' + hhmm(b.ts)),
        td(dur(now - b.ts), 'num stay'));
      body.appendChild(tr);
    });
    $('insideEmpty').classList.toggle('hidden', rows.length > 0);
  }

  function renderLog(evs) {
    const body = $('logBody');
    body.innerHTML = '';
    const rows = evs.slice().reverse().slice(0, 300);
    rows.forEach((e) => {
      const tr = document.createElement('tr');
      const p = part(e[2]);
      tr.append(td(($('period').value === 'all' ? shortDate(e[1]) + ' ' : '') + hhmmss(e[1]), 'mono'),
        td(tag(e[3])), td(e[2], 'mono'), td(p.dorsal || '—'), td(e[4] || ''));
      body.appendChild(tr);
    });
    $('logEmpty').classList.toggle('hidden', rows.length > 0);
  }

  function baseOptions() {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: C.text, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: { backgroundColor: '#0a1220', borderColor: '#24385a', borderWidth: 1, padding: 10 },
      },
      scales: {
        x: { grid: { color: C.grid }, ticks: { color: C.text, maxRotation: 0, autoSkipPadding: 16 } },
        y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.text, precision: 0 } },
      },
    };
  }

  function renderCharts(m) {
    if (!window.Chart) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

    // Ocupación (escalonada)
    const occOpts = baseOptions();
    occOpts.plugins.legend.display = false;
    occOpts.scales.x.type = 'linear';
    const xs = m.series.map((p) => p.x);
    if (xs.length) { occOpts.scales.x.min = Math.min(...xs); occOpts.scales.x.max = Math.max(...xs); }
    occOpts.scales.x.ticks.callback = (v) => (m.R.all ? shortDate(v) + ' ' : '') + hhmm(v);
    occOpts.plugins.tooltip.callbacks = {
      title: (items) => items.length ? (m.R.all ? shortDate(items[0].parsed.x) + ' ' : '') + hhmmss(items[0].parsed.x) : '',
      label: (item) => ' ' + item.parsed.y + ' bicicletas',
    };
    const occData = {
      datasets: [{
        label: 'En parque', data: m.series, stepped: true, borderColor: C.brand, borderWidth: 2,
        pointRadius: 0, fill: true, backgroundColor: 'rgba(51,168,224,0.16)',
      }],
    };
    upsert('occ', 'occChart', 'line', occData, occOpts);

    // Movimientos por hora
    const ins = new Array(24).fill(0);
    const outs = new Array(24).fill(0);
    m.inPeriod.forEach((e) => { const h = new Date(e[1]).getHours(); (e[3] === API.IN ? ins : outs)[h]++; });
    const used = ins.map((v, i) => v + outs[i]);
    let lo = used.findIndex((v) => v > 0);
    let hi = 23 - used.slice().reverse().findIndex((v) => v > 0);
    if (lo < 0) { lo = 7; hi = 19; }
    const hours = [];
    for (let h = lo; h <= hi; h++) hours.push(h);
    const hourOpts = baseOptions();
    hourOpts.scales.x.grid.display = false;
    upsert('hour', 'hourChart', 'bar', {
      labels: hours.map((h) => pad(h) + ':00'),
      datasets: [
        { label: 'Ingresos', data: hours.map((h) => ins[h]), backgroundColor: C.in, borderRadius: 4, maxBarThickness: 22 },
        { label: 'Retiros', data: hours.map((h) => outs[h]), backgroundColor: C.out, borderRadius: 4, maxBarThickness: 22 },
      ],
    }, hourOpts);
  }

  function upsert(key, canvasId, type, chartData, options) {
    if (charts[key]) {
      charts[key].data = chartData;
      charts[key].options = options;
      charts[key].update('none');
    } else {
      charts[key] = new Chart($(canvasId), { type, data: chartData, options });
    }
  }

  /* ---------- CSV ---------- */
  function downloadCsv() {
    const m = compute();
    const lines = [['Fecha', 'Hora', 'Código', 'Tipo', 'Dorsal', 'Nombre', 'Puesto']];
    m.inPeriod.forEach((e) => {
      const p = part(e[2]);
      lines.push([dayKey(e[1]), hhmmss(e[1]), e[2], e[3], p.dorsal || '', p.nombre || '', e[4] || '']);
    });
    const csv = lines.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'parque-cerrado-' + ($('period').value === 'all' ? 'historial' : dayKey(m.R.from)) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- Carga ---------- */
  async function load() {
    try {
      data = await API.call('events');
      fillPeriods();
      render();
      $('updated').textContent = 'Actualizado ' + hhmmss(Date.now());
      setNet(true);
    } catch (err) {
      if (err.code === 'unauthorized') { $('keyModal').classList.remove('hidden'); return; }
      setNet(false);
      $('updated').textContent = 'Error al actualizar (' + err.code + ')';
    }
  }

  function setNet(ok) {
    if (API.isDemo) { $('net').className = 'pill demo'; $('netText').textContent = 'Modo demo'; return; }
    $('net').className = 'pill' + (ok ? '' : ' offline');
    $('netText').textContent = ok ? 'En línea' : 'Sin conexión';
  }

  $('keyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    API.setKey($('keyInput').value);
    $('keyModal').classList.add('hidden');
    load();
  });
  $('period').addEventListener('change', () => { API.store.set('dash_period', $('period').value); render(); });
  $('search').addEventListener('input', () => renderInside(compute().inside));
  $('csvBtn').addEventListener('click', downloadCsv);
  if (CFG.SHEET_URL) { $('sheetBtn').href = CFG.SHEET_URL; $('sheetBtn').classList.remove('hidden'); }
  if (API.isDemo) {
    $('seedBtn').classList.remove('hidden');
    $('seedBtn').addEventListener('click', () => { API.Mock.seed(); load(); });
    if (!API.Mock.events().length) API.Mock.seed();
  }

  setNet(true);
  if (!API.isDemo && !API.getKey()) $('keyModal').classList.remove('hidden');
  else load();
  setInterval(load, (CFG.REFRESH_SECONDS || 15) * 1000);
})();
