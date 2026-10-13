(function () {
  const API = window.PC_API;
  const $ = (id) => document.getElementById(id);
  const LOCAL_REPEAT_MS = 4000; // la cámara lee el mismo QR muchas veces por segundo

  let mode = API.store.get('mode', 'AUTO');
  let scanner = null;
  let lastRead = { code: '', at: 0 };
  let busy = false;

  /* ---------- Estado / UI ---------- */
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function setMode(m) {
    mode = m;
    API.store.set('mode', m);
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  }

  function setNet(online) {
    const pill = $('net');
    if (API.isDemo) {
      pill.className = 'pill demo';
      $('netText').textContent = 'Modo demo';
      return;
    }
    pill.className = 'pill' + (online ? '' : ' offline');
    $('netText').textContent = online ? 'En línea' : 'Sin conexión';
  }

  function refreshQueued() {
    $('queued').textContent = API.queue.size();
  }

  function setInside(n) {
    if (typeof n === 'number') $('inside').textContent = n;
  }

  function showResult(r) {
    const el = $('result');
    const isIn = r.type === API.IN;
    let cls = r.queued ? '' : isIn ? 'in' : 'out';
    let title = r.queued ? 'GUARDADO SIN CONEXIÓN' : r.type;
    if (r.status === 'duplicate') { title = 'YA REGISTRADO · ' + r.type; }
    if (r.warning) cls = 'warn';
    const p = r.participant;
    const sub = p ? [p.dorsal && 'Dorsal ' + p.dorsal, p.nombre, p.categoria].filter(Boolean).join(' · ') : '';
    el.className = 'result ' + cls;
    el.innerHTML = '';
    const add = (tag, className, text) => {
      const n = document.createElement(tag);
      n.className = className;
      n.textContent = text;
      el.appendChild(n);
    };
    add('div', 'r-type', title);
    add('div', 'r-code', r.code);
    add('div', 'r-sub', sub || (r.queued ? 'Se enviará al recuperar la conexión' : ''));
    add('div', 'r-time', fmtTime(r.ts));
    if (r.warning) add('div', 'r-warn', '⚠ ' + r.warning);

    flash(r.warning ? '#f43f5e' : r.queued ? '#33a8e0' : isIn ? '#22c55e' : '#f59e0b');
    feedback(r.warning || r.status === 'duplicate' ? 'warn' : 'ok');
  }

  function flash(color) {
    const f = $('flash');
    f.style.background = color;
    f.classList.add('show');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('show')));
  }

  let audioCtx = null;
  function feedback(kind) {
    try {
      if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const beep = (freq, start, dur) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = freq;
        o.connect(g);
        g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.18, audioCtx.currentTime + start);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + dur);
        o.start(audioCtx.currentTime + start);
        o.stop(audioCtx.currentTime + start + dur);
      };
      if (kind === 'ok') beep(1200, 0, 0.12);
      else { beep(440, 0, 0.12); beep(330, 0.15, 0.18); }
    } catch (e) { /* sin audio */ }
  }

  /* ---------- Historial local ---------- */
  function pushHistory(r) {
    const h = API.store.get('history', []);
    const i = h.findIndex((x) => x.id === r.id);
    const item = { id: r.id, code: r.code, type: r.type, ts: r.ts, queued: !!r.queued, status: r.status, participant: r.participant };
    if (i >= 0) h[i] = item; else h.unshift(item);
    API.store.set('history', h.slice(0, 30));
    renderHistory();
  }

  function renderHistory() {
    const h = API.store.get('history', []).slice(0, 15);
    const ul = $('history');
    ul.innerHTML = '';
    $('historyEmpty').classList.toggle('hidden', h.length > 0);
    h.forEach((x) => {
      const li = document.createElement('li');
      const tag = document.createElement('span');
      tag.className = 'tag ' + (x.type === API.IN ? 'in' : x.type === API.OUT ? 'out' : '');
      tag.textContent = x.queued ? 'EN COLA' : x.status === 'duplicate' ? 'REPETIDO' : x.type;
      if (x.queued) tag.style.cssText = 'background:rgba(51,168,224,.15);color:#33a8e0';
      const mid = document.createElement('div');
      const code = document.createElement('div');
      code.className = 'code';
      code.textContent = x.code;
      mid.appendChild(code);
      if (x.participant) {
        const who = document.createElement('div');
        who.className = 'who';
        who.textContent = [x.participant.dorsal && '#' + x.participant.dorsal, x.participant.nombre].filter(Boolean).join(' ');
        mid.appendChild(who);
      }
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = fmtTime(x.ts);
      li.append(tag, mid, time);
      ul.appendChild(li);
    });
  }

  /* ---------- Registro ---------- */
  async function register(raw) {
    const code = API.normalizeCode(raw);
    if (!code) return;
    const now = Date.now();
    if (code === lastRead.code && now - lastRead.at < LOCAL_REPEAT_MS) return;
    lastRead = { code, at: now };
    if (busy) return;
    busy = true;

    const scan = {
      id: API.uuid(),
      ts: now,
      raw: String(raw),
      code,
      mode,
      puesto: API.store.get('puesto', ''),
      device: API.deviceId(),
    };

    try {
      const r = await API.call('scan', { scan });
      setNet(true);
      setInside(r.inside);
      const res = Object.assign({}, r, { ts: scan.ts });
      showResult(res);
      pushHistory(res);
      flushQueue();
    } catch (err) {
      if (err.code === 'unauthorized') {
        openSettings('La clave no es válida. Ingrésala de nuevo.');
      } else if (err.network) {
        setNet(false);
        API.queue.add(scan);
        refreshQueued();
        const res = { id: scan.id, code, ts: scan.ts, queued: true, type: mode === 'IN' ? API.IN : mode === 'OUT' ? API.OUT : '' };
        showResult(res);
        pushHistory(res);
      } else {
        showResult({ code, ts: scan.ts, type: 'ERROR', warning: 'No se pudo registrar (' + err.code + ')' });
      }
    } finally {
      busy = false;
    }
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing || !API.queue.size()) return;
    flushing = true;
    try {
      const results = await API.queue.flush();
      setNet(true);
      results.forEach((r) => {
        const h = API.store.get('history', []).find((x) => x.id === r.id);
        if (h) pushHistory(Object.assign({}, h, r, { queued: false }));
        if (typeof r.inside === 'number') setInside(r.inside);
      });
    } catch (err) {
      if (err.network) setNet(false);
    } finally {
      flushing = false;
      refreshQueued();
    }
  }

  async function refreshInside() {
    try {
      const data = await API.call('events');
      const st = {};
      data.events.forEach((e) => { st[e[2]] = e[3]; });
      setInside(Object.keys(st).filter((c) => st[c] === API.IN).length);
      setNet(true);
    } catch (err) {
      if (err.network) setNet(false);
      if (err.code === 'unauthorized') openSettings('Ingresa la clave de acceso para comenzar.');
    }
  }

  /* ---------- Cámara ---------- */
  async function startCamera() {
    $('camError').textContent = '';
    if (!window.Html5Qrcode) {
      $('camError').textContent = 'No se pudo cargar el lector QR. Revisa la conexión.';
      return;
    }
    try {
      scanner = scanner || new Html5Qrcode('reader', { verbose: false });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.64); return { width: s, height: s }; } },
        (text) => register(text),
        () => {}
      );
      $('placeholder').classList.add('hidden');
      $('frame').classList.remove('hidden');
      $('stopBtn').classList.remove('hidden');
    } catch (err) {
      $('camError').textContent = 'No se pudo abrir la cámara: ' + (err && err.message ? err.message : err) +
        '. Revisa los permisos del navegador (requiere HTTPS).';
    }
  }

  async function stopCamera() {
    if (scanner && scanner.isScanning) await scanner.stop();
    $('placeholder').classList.remove('hidden');
    $('frame').classList.add('hidden');
    $('stopBtn').classList.add('hidden');
  }

  /* ---------- Ajustes ---------- */
  function openSettings(msg) {
    $('puestoInput').value = API.store.get('puesto', '');
    $('keyInput').value = API.getKey();
    $('keyField').classList.toggle('hidden', API.isDemo);
    $('settingsError').textContent = msg || '';
    $('settings').classList.remove('hidden');
  }

  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    API.store.set('puesto', $('puestoInput').value.trim());
    $('puestoLabel').textContent = API.store.get('puesto', '') || 'Escáner';
    if (!API.isDemo) {
      API.setKey($('keyInput').value);
      try {
        await API.call('ping');
      } catch (err) {
        if (err.code === 'unauthorized') {
          $('settingsError').textContent = 'Clave incorrecta.';
          return;
        }
      }
    }
    $('settings').classList.add('hidden');
    refreshInside();
    flushQueue();
  });
  $('settingsCancel').addEventListener('click', () => $('settings').classList.add('hidden'));
  $('settingsBtn').addEventListener('click', () => openSettings());

  /* ---------- Eventos ---------- */
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('startBtn').addEventListener('click', startCamera);
  $('stopBtn').addEventListener('click', stopCamera);
  $('manualForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('manualCode').value;
    $('manualCode').value = '';
    lastRead = { code: '', at: 0 };
    register(v);
  });
  window.addEventListener('online', flushQueue);
  window.addEventListener('offline', () => setNet(false));
  setInterval(flushQueue, 10000);
  setInterval(refreshInside, 30000);

  /* ---------- Inicio ---------- */
  setMode(mode);
  setNet(navigator.onLine);
  $('puestoLabel').textContent = API.store.get('puesto', '') || 'Escáner';
  renderHistory();
  refreshQueued();
  if (API.isDemo && !API.Mock.events().length) API.Mock.seed();
  if (!API.isDemo && !API.getKey()) openSettings('Ingresa la clave de acceso para comenzar.');
  else refreshInside();
  flushQueue();
})();
