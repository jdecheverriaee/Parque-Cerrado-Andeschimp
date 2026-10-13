/**
 * Andeschimp · Parque Cerrado — backend en Google Apps Script.
 *
 * Se instala dentro del Google Sheet (Extensiones → Apps Script) y se publica
 * como "Aplicación web". La web de escaneo y el dashboard hablan con este
 * script por POST (JSON en text/plain para evitar el preflight de CORS).
 *
 * Hojas:
 *   Registros     — un registro por escaneo (lo escribe este script)
 *   Participantes — opcional: Código | Dorsal | Nombre | Categoría
 */

const SHEET_LOG = 'Registros';
const SHEET_PART = 'Participantes';
const LOG_HEADERS = ['ID', 'Fecha', 'Hora', 'Timestamp', 'Código', 'Tipo', 'Puesto', 'Dispositivo', 'QR original', 'Recibido'];
const PART_HEADERS = ['Código', 'Dorsal', 'Nombre', 'Categoría'];
const IN = 'INGRESO';
const OUT = 'RETIRO';
// Un mismo chip escaneado de nuevo dentro de esta ventana se ignora (lectura doble).
const DUP_WINDOW_MS = 20 * 1000;

/** Ejecutar una vez a mano: crea las hojas y la clave de acceso. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS);
  ensureSheet_(ss, SHEET_PART, PART_HEADERS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) {
    props.setProperty('API_KEY', Math.random().toString(36).slice(2, 8).toUpperCase());
  }
  Logger.log('Clave de acceso (PIN) para la web: ' + props.getProperty('API_KEY'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function doGet() {
  return json_({ ok: true, service: 'andeschimp-parque-cerrado' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key || String(body.key || '').toUpperCase() !== key.toUpperCase()) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  try {
    switch (body.action) {
      case 'ping':
        return json_({ ok: true });
      case 'scan':
        return json_(Object.assign({ ok: true }, withLock_(() => recordScan_(body.scan))));
      case 'sync':
        return json_({ ok: true, results: withLock_(() => (body.scans || []).map(recordScan_)) });
      case 'events':
        return json_({ ok: true, events: readEvents_(), participants: readParticipants_(), serverTime: Date.now() });
      default:
        return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Registra un escaneo. mode: 'AUTO' alterna ingreso/retiro según el último
 * movimiento del chip; 'IN' / 'OUT' fuerzan el tipo.
 */
function recordScan_(scan) {
  const sh = ensureSheet_(SpreadsheetApp.getActive(), SHEET_LOG, LOG_HEADERS);
  const code = normalizeCode_(scan.code || scan.raw);
  if (!code) return { id: scan.id, status: 'invalid' };

  const ts = Number(scan.ts) || Date.now();
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues() : [];

  let last = null;
  const state = {};
  for (let i = 0; i < rows.length; i++) {
    const [id, , , rTs, rCode, rType] = rows[i];
    if (scan.id && id === scan.id) {
      // Reenvío desde la cola offline: ya estaba guardado.
      return { id: scan.id, status: 'already_saved', code, type: rType, inside: countInside_(rows) };
    }
    state[rCode] = rType;
    if (rCode === code) last = { ts: Number(rTs), type: rType };
  }

  const mode = scan.mode || 'AUTO';
  const participant = findParticipant_(code);

  if (last && Math.abs(ts - last.ts) < DUP_WINDOW_MS &&
      (mode === 'AUTO' || (mode === 'IN' ? IN : OUT) === last.type)) {
    return { id: scan.id, status: 'duplicate', code, type: last.type, participant, inside: countInside_(rows) };
  }

  const wasInside = last && last.type === IN;
  let type;
  if (mode === 'IN') type = IN;
  else if (mode === 'OUT') type = OUT;
  else type = wasInside ? OUT : IN;

  let warning = null;
  if (type === IN && wasInside) warning = 'El chip ya figuraba dentro del parque';
  if (type === OUT && !wasInside) warning = 'El chip no tenía ingreso registrado';

  const tz = Session.getScriptTimeZone();
  const d = new Date(ts);
  sh.appendRow([
    scan.id || Utilities.getUuid(),
    Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    Utilities.formatDate(d, tz, 'HH:mm:ss'),
    ts,
    code,
    type,
    scan.puesto || '',
    scan.device || '',
    scan.raw || '',
    new Date(),
  ]);

  state[code] = type;
  const inside = Object.keys(state).filter((c) => state[c] === IN).length;
  return { id: scan.id, status: 'saved', code, type, warning, participant, inside };
}

function countInside_(rows) {
  const state = {};
  rows.forEach((r) => { state[r[4]] = r[5]; });
  return Object.keys(state).filter((c) => state[c] === IN).length;
}

function readEvents_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues()
    .filter((r) => r[4])
    // [id, ts, código, tipo, puesto, dispositivo]
    .map((r) => [r[0], Number(r[3]), String(r[4]), r[5], r[6], r[7]]);
}

function readParticipants_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PART);
  if (!sh || sh.getLastRow() < 2) return {};
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach((r) => {
    const code = normalizeCode_(r[0]);
    if (code) out[code] = { dorsal: String(r[1] || ''), nombre: String(r[2] || ''), categoria: String(r[3] || '') };
  });
  return out;
}

function findParticipant_(code) {
  return readParticipants_()[code] || null;
}

/** Misma lógica que normalizeCode() en assets/api.js. */
function normalizeCode_(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/[?&](?:chip|code|tag|id|transponder)=([^&#]+)/i);
    s = m ? decodeURIComponent(m[1]) : s.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  }
  return s.replace(/\s+/g, '').toUpperCase();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
