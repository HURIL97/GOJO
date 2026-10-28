// Serveur d'équipe OfficiaTech — à installer sur votre VPS.
//  • Synchronisation des postes (agenda, réunions, tâches, courrier, appels, contacts, modèles, pense-bêtes).
//  • Accès mobile de la Direction : /m (agenda, PV à valider, tâches).
//  • Flux d'agenda privé pour Google Agenda / Outlook / téléphone : /ical/<clé>.ics
// Aucune dépendance externe : Node.js >= 22.13 (http + node:sqlite intégrés).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ics = require('../electron/ics');

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '0.0.0.0'; // 127.0.0.1 derrière un proxy (Caddy) sur la même machine
const TOKEN = process.env.SYNC_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_BODY = 20 * 1024 * 1024;
const TABLES = new Set(['contacts', 'events', 'meetings', 'tasks', 'courrier', 'calls', 'templates', 'notes', 'mobile_users']);

if (require.main === module && (!TOKEN || TOKEN.length < 16)) {
  console.error('SYNC_TOKEN manquant ou trop court (16 caractères minimum). Exemple :');
  console.error(`  SYNC_TOKEN=${crypto.randomBytes(24).toString('hex')} node server.js`);
  process.exit(1);
}

function createServer({ token = TOKEN, dataDir = DATA_DIR, file } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file || path.join(dataDir, 'officia-equipe.db'));
  db.exec(`
    PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS records (tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, sync_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT, rev INTEGER NOT NULL, PRIMARY KEY (tbl, id));
    CREATE INDEX IF NOT EXISTS ix_records_rev ON records(rev);
    CREATE INDEX IF NOT EXISTS ix_records_tbl ON records(tbl, deleted);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT, last_seen TEXT, ip TEXT, pushes INTEGER DEFAULT 0);
  `);
  let rev = db.prepare('SELECT COALESCE(MAX(rev), 0) r FROM records').get().r;
  const getRec = db.prepare('SELECT data, sync_at FROM records WHERE tbl = ? AND id = ?');
  const putRec = db.prepare(`INSERT INTO records (tbl, id, data, sync_at, deleted, device_id, rev) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, sync_at = excluded.sync_at, deleted = excluded.deleted, device_id = excluded.device_id, rev = excluded.rev`);
  const pullStmt = db.prepare('SELECT tbl, data, rev FROM records WHERE rev > ? ORDER BY rev LIMIT ?');
  const allOf = db.prepare('SELECT data FROM records WHERE tbl = ? AND deleted = 0');
  const seen = db.prepare(`INSERT INTO devices (id, name, last_seen, ip, pushes) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), devices.name), last_seen = excluded.last_seen, ip = excluded.ip, pushes = devices.pushes + excluded.pushes`);
  const secret = crypto.createHmac('sha256', token).update('officia-mobile').digest();
  const feedKey = crypto.createHmac('sha256', token).update('ical').digest('hex').slice(0, 32);

  const rows = (tbl) => allOf.all(tbl).map((r) => JSON.parse(r.data));
  const json = (v, d) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return d; } };

  function push(changes, deviceId) {
    let accepted = 0;
    let skipped = 0;
    db.exec('BEGIN');
    try {
      for (const [tbl, list] of Object.entries(changes || {})) {
        if (!TABLES.has(tbl) || !Array.isArray(list)) continue;
        for (const row of list) {
          if (!row || typeof row.id !== 'string' || typeof row.sync_at !== 'string') continue;
          const cur = getRec.get(tbl, row.id);
          if (cur && cur.sync_at >= row.sync_at) { skipped++; continue; } // la version la plus récente gagne
          rev += 1;
          putRec.run(tbl, row.id, JSON.stringify(row), row.sync_at, row.deleted ? 1 : 0, row.device_id || deviceId || null, rev);
          accepted++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      rev = db.prepare('SELECT COALESCE(MAX(rev), 0) r FROM records').get().r;
      throw e;
    }
    return { accepted, skipped, rev };
  }
  // Modification faite depuis le mobile : elle repart vers tous les postes à leur prochaine synchronisation.
  function update(tbl, id, patch) {
    const cur = getRec.get(tbl, id);
    if (!cur) return null;
    const data = { ...JSON.parse(cur.data), ...patch, sync_at: new Date().toISOString(), device_id: 'mobile', updated_at: stamp() };
    rev += 1;
    putRec.run(tbl, id, JSON.stringify(data), data.sync_at, data.deleted ? 1 : 0, 'mobile', rev);
    return data;
  }
  function pull(since, limit) {
    const list = pullStmt.all(since, limit + 1);
    const page = list.slice(0, limit);
    return { rows: page.map((r) => ({ tbl: r.tbl, data: JSON.parse(r.data) })), last_rev: page.length ? page[page.length - 1].rev : since, more: list.length > limit };
  }

  // ---- Accès mobile ----
  const sign = (payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
  const verify = (tok) => {
    const [p, sig] = String(tok || '').split('.');
    if (!p || !sig) return null;
    const want = crypto.createHmac('sha256', secret).update(p).digest('base64url');
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    const u = rows('mobile_users').find((x) => x.id === data.uid && x.active !== 0);
    return u ? { ...data, name: u.name } : null; // un accès désactivé sur le poste est coupé aussitôt
  };
  const failures = new Map();
  function login(loginName, code, ip) {
    const f = failures.get(ip) || { n: 0, at: 0 };
    if (f.n >= 5 && Date.now() - f.at < 15 * 60000) throw Object.assign(new Error('Trop de tentatives : réessayez dans 15 minutes'), { status: 429 });
    const u = rows('mobile_users').find((x) => x.login === String(loginName || '').trim().toLowerCase() && x.active !== 0);
    const ok = u && u.code_hash && checkPin(code, u.code_hash);
    if (!ok) { failures.set(ip, { n: f.n + 1, at: Date.now() }); throw Object.assign(new Error('Identifiant ou code incorrect'), { status: 401 }); }
    failures.delete(ip);
    return { token: sign({ uid: u.id, exp: Date.now() + 30 * 86400000 }), name: u.name };
  }

  const agenda = (from, to) => {
    const out = [];
    for (const ev of rows('events')) {
      if (ev.status === 'annule') continue;
      for (const o of occurrences(ev, from, to)) out.push(o.private ? { ...o, title: 'Occupé', location: '', description: '', visio_url: '' } : o);
    }
    const people = new Map(rows('contacts').map((c) => [c.id, c]));
    return out.sort((a, b) => a.start.localeCompare(b.start)).map((e) => {
      const c = people.get(e.contact_id);
      return { id: e.id, title: e.title, type: e.type, start: e.start, end: e.end, all_day: e.all_day, location: e.location || '', visio_url: e.visio_url || '', description: e.description || '', status: e.status,
        contact: c ? { name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company, company: c.company || '', phone: c.mobile || c.phone || '' } : null, meeting_id: e.meeting_id || null };
    });
  };
  const meetingView = (m) => ({ id: m.id, title: m.title, start: m.start, end: m.end, location: m.location, status: m.status, president: m.president, objective: m.objective,
    agenda: json(m.agenda, []), participants: json(m.participants, []), minutes: json(m.minutes, {}), pv_remarks: m.pv_remarks || '', pv_validated_by: m.pv_validated_by || '', pv_validated_at: m.pv_validated_at || '' });

  function mobileApi(req, url, user, body) {
    const p = url.pathname.replace(/^\/m\/api/, '');
    if (p === '/me') return { name: user.name };
    if (p === '/summary') {
      const t = stamp().slice(0, 10);
      const meetings = rows('meetings');
      return {
        today: agenda(t, t), pvToValidate: meetings.filter((m) => m.status === 'tenue').length,
        tasksLate: rows('tasks').filter((x) => x.status !== 'terminee' && x.due && x.due < t).length,
        courrier: rows('courrier').filter((c) => c.direction === 'arrivee' && ['enregistre', 'en_traitement'].includes(c.status)).length,
      };
    }
    if (p === '/agenda') {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from')) ? url.searchParams.get('from') : stamp().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to')) ? url.searchParams.get('to') : addDays(from, 6);
      return agenda(from, to);
    }
    if (p === '/meetings') {
      const list = rows('meetings').sort((a, b) => b.start.localeCompare(a.start));
      return { toValidate: list.filter((m) => m.status === 'tenue').map(meetingView), recent: list.filter((m) => ['pv_valide', 'pv_diffuse'].includes(m.status)).slice(0, 15).map(meetingView),
        upcoming: list.filter((m) => m.start >= stamp() && ['preparation', 'convoquee'].includes(m.status)).reverse().slice(0, 10).map(meetingView) };
    }
    if (p === '/tasks') return rows('tasks').filter((x) => x.status !== 'terminee').sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'))).slice(0, 100);
    if (p === '/courrier') return rows('courrier').filter((c) => c.direction === 'arrivee' && ['enregistre', 'en_traitement'].includes(c.status)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100)
      .map((c) => ({ id: c.id, number: c.number, date: c.date, correspondent: c.correspondent, object: c.object, assigned_to: c.assigned_to, due: c.due, status: c.status }));
    const mm = p.match(/^\/meetings\/([\w-]+)(\/validate|\/remarks)?$/);
    if (mm) {
      const m = rows('meetings').find((x) => x.id === mm[1]);
      if (!m) throw Object.assign(new Error('Réunion introuvable'), { status: 404 });
      if (!mm[2]) return meetingView(m);
      if (req.method !== 'POST') throw Object.assign(new Error('Méthode non autorisée'), { status: 405 });
      const remarks = String(body.remarks || '').slice(0, 4000);
      if (mm[2] === '/remarks') return meetingView(update('meetings', m.id, { pv_remarks: remarks }));
      if (m.status !== 'tenue') throw Object.assign(new Error('Ce procès-verbal n’est pas en attente de validation'), { status: 409 });
      return meetingView(update('meetings', m.id, { status: 'pv_valide', pv_validated_at: stamp(), pv_validated_by: user.name, pv_remarks: remarks || m.pv_remarks || null }));
    }
    throw Object.assign(new Error('Introuvable'), { status: 404 });
  }

  const authorized = (req) => {
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(token);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  const MOBILE = fs.readFileSync(path.join(__dirname, 'mobile.html'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    try {
      if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'officia-equipe' });
      if (url.pathname === '/m' || url.pathname === '/m/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:" });
        return res.end(MOBILE);
      }
      if (url.pathname === '/m/api/login' && req.method === 'POST') {
        const b = await readBody(req);
        return send(res, 200, login(b.login, b.code, ip));
      }
      if (url.pathname.startsWith('/m/api/')) {
        const h = req.headers.authorization || '';
        const user = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
        if (!user) return send(res, 401, { error: 'Session expirée : reconnectez-vous' });
        const body = req.method === 'POST' ? await readBody(req) : {};
        return send(res, 200, mobileApi(req, url, user, body));
      }
      const feed = url.pathname.match(/^\/ical\/([a-f0-9]{32})\.ics$/);
      if (feed) {
        const k = Buffer.from(feed[1]);
        if (k.length !== feedKey.length || !crypto.timingSafeEqual(k, Buffer.from(feedKey))) return send(res, 404, { error: 'Introuvable' });
        const evs = rows('events').filter((e) => e.status !== 'annule' && e.start >= addDays(stamp().slice(0, 10), -90));
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(ics.calendar(evs, { name: process.env.CALENDAR_NAME || 'Agenda de la Direction (OfficiaTech)', privateAsBusy: true }));
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Introuvable' });
      if (!authorized(req)) return send(res, 401, { error: 'Jeton de l’équipe invalide' });
      const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);
      const deviceName = decodeURIComponent(String(req.headers['x-device-name'] || '')).slice(0, 80);
      if (url.pathname === '/api/sync/push' && req.method === 'POST') {
        const b = await readBody(req);
        const r = push(b.changes, deviceId);
        if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), ip, 1);
        return send(res, 200, r);
      }
      if (url.pathname === '/api/sync/pull' && req.method === 'GET') {
        const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
        const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
        if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), ip, 0);
        return send(res, 200, pull(since, limit));
      }
      if (url.pathname === '/api/status' && req.method === 'GET') {
        if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), ip, 0);
        const counts = db.prepare('SELECT tbl, COUNT(*) n FROM records WHERE deleted = 0 GROUP BY tbl').all();
        const devices = db.prepare('SELECT id, name, last_seen, ip, pushes FROM devices ORDER BY last_seen DESC').all();
        return send(res, 200, { ok: true, rev, counts, devices, time: new Date().toISOString() });
      }
      return send(res, 404, { error: 'Introuvable' });
    } catch (e) {
      if (!e.status) console.error(e);
      return send(res, e.status || 400, { error: e.message });
    }
  });
  server.feedKey = feedKey;
  server.on('close', () => db.close());
  return server;
}

// ---- Utilitaires ----
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const toDate = (s) => new Date(s.length === 10 ? `${s}T00:00:00` : s);
const addDays = (day, n) => { const d = toDate(day); d.setDate(d.getDate() + n); return stamp(d).slice(0, 10); };
const addMinutes = (ts, n) => { const d = toDate(ts); d.setMinutes(d.getMinutes() + n); return stamp(d); };
function shift(ts, unit, n) {
  const d = toDate(ts);
  if (unit === 'daily') d.setDate(d.getDate() + n);
  else if (unit === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (unit === 'monthly') d.setMonth(d.getMonth() + n);
  else if (unit === 'yearly') d.setFullYear(d.getFullYear() + n);
  return stamp(d);
}
// Même règle que sur le poste : occurrences d'un évènement (récurrent ou non) dans [from, to].
function occurrences(ev, from, to) {
  if (!ev.start) return [];
  const dur = Math.max(0, Math.round((toDate(ev.end || ev.start) - toDate(ev.start)) / 60000));
  const until = ev.recur_until ? `${ev.recur_until}T23:59:59` : null;
  const out = [];
  for (let i = 0, s = ev.start; i < 1500; i++, s = shift(ev.start, ev.recurrence, i)) {
    if ((until && s > until) || s > `${to}T23:59:59`) break;
    const e = addMinutes(s, dur);
    if (e >= `${from}T00:00:00` || s >= `${from}T00:00:00`) out.push({ ...ev, start: s, end: e });
    if (!ev.recurrence || ev.recurrence === 'none') break;
  }
  return out;
}
function checkPin(pin, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(String(pin || ''), salt, 32);
  const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function send(res, code, body) {
  const j = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(j), 'Cache-Control': 'no-store' });
  res.end(j);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON invalide')); } });
    req.on('error', reject);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`OfficiaTech — serveur d'équipe en écoute sur ${HOST}:${PORT} (données : ${DATA_DIR})`);
    console.log(`Flux d'agenda : https://<votre-domaine>/ical/${server.feedKey}.ics`);
  });
}

module.exports = { createServer };
