// Serveur de synchronisation Hospitalis — à installer sur votre VPS.
// Stocke toutes les lignes de tous les postes et distribue les changements (dernier écrit gagne).
// Aucune dépendance externe : Node.js >= 22.13 (http + node:sqlite intégrés).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.SYNC_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_BODY = 20 * 1024 * 1024;

if (!TOKEN || TOKEN.length < 16) {
  console.error('SYNC_TOKEN manquant ou trop court (16 caractères minimum). Exemple :');
  console.error(`  SYNC_TOKEN=${crypto.randomBytes(24).toString('hex')} node server.js`);
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'hospitalis-sync.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS records (
    tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT, rev INTEGER NOT NULL,
    PRIMARY KEY (tbl, id));
  CREATE INDEX IF NOT EXISTS ix_records_rev ON records(rev);
  CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT, last_seen TEXT, ip TEXT, pushes INTEGER DEFAULT 0);
`);

const TABLE_RE = /^[a-z_]{1,40}$/;
let rev = db.prepare('SELECT COALESCE(MAX(rev), 0) r FROM records').get().r;
const getRec = db.prepare('SELECT updated_at FROM records WHERE tbl = ? AND id = ?');
const putRec = db.prepare(`INSERT INTO records (tbl, id, data, updated_at, deleted, device_id, rev) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
  deleted = excluded.deleted, device_id = excluded.device_id, rev = excluded.rev`);
const pullStmt = db.prepare('SELECT tbl, data, rev FROM records WHERE rev > ? ORDER BY rev LIMIT ?');
const seen = db.prepare(`INSERT INTO devices (id, name, last_seen, ip, pushes) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), devices.name), last_seen = excluded.last_seen,
  ip = excluded.ip, pushes = devices.pushes + excluded.pushes`);

function authorized(req) {
  const h = req.headers.authorization || '';
  const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const want = Buffer.from(TOKEN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function push(changes, deviceId) {
  let accepted = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    for (const [tbl, rows] of Object.entries(changes || {})) {
      if (!TABLE_RE.test(tbl) || !Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || typeof row.updated_at !== 'string') continue;
        const cur = getRec.get(tbl, row.id);
        // Dernier écrit gagne ; à égalité, on garde la version déjà présente.
        if (cur && cur.updated_at >= row.updated_at) { skipped++; continue; }
        const data = { ...row };
        delete data.dirty;
        rev += 1;
        putRec.run(tbl, row.id, JSON.stringify(data), row.updated_at, row.deleted ? 1 : 0, row.device_id || deviceId || null, rev);
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

function pull(since, limit) {
  const rows = pullStmt.all(since, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    rows: page.map((r) => ({ tbl: r.tbl, data: JSON.parse(r.data) })),
    last_rev: page.length ? page[page.length - 1].rev : since,
    more,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'hospitalis-sync' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Introuvable' });
    if (!authorized(req)) return send(res, 401, { error: 'Jeton de synchronisation invalide' });

    const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);
    const deviceName = decodeURIComponent(String(req.headers['x-device-name'] || '')).slice(0, 80);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (url.pathname === '/api/sync/push' && req.method === 'POST') {
      const body = await readBody(req);
      const r = push(body.changes, deviceId);
      if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), String(ip), 1);
      return send(res, 200, r);
    }
    if (url.pathname === '/api/sync/pull' && req.method === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
      if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), String(ip), 0);
      return send(res, 200, pull(since, limit));
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      if (deviceId) seen.run(deviceId, deviceName, new Date().toISOString(), String(ip), 0);
      const counts = db.prepare('SELECT tbl, COUNT(*) n FROM records WHERE deleted = 0 GROUP BY tbl').all();
      const devices = db.prepare('SELECT id, name, last_seen, ip, pushes FROM devices ORDER BY last_seen DESC').all();
      return send(res, 200, { ok: true, rev, counts, devices, time: new Date().toISOString() });
    }
    return send(res, 404, { error: 'Introuvable' });
  } catch (e) {
    console.error(e);
    return send(res, 400, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Hospitalis sync en écoute sur le port ${PORT} — données : ${DATA_DIR}`));
}

module.exports = { server, push, pull };
