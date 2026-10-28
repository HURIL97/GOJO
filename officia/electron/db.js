// Base locale SQLite (module node:sqlite intégré à Electron : aucun module natif à compiler).
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const BASE = `id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, deleted INTEGER NOT NULL DEFAULT 0`;

const TABLES = {
  settings: `key TEXT UNIQUE, value TEXT`,
  contacts: `first_name TEXT, last_name TEXT, company TEXT, title TEXT, email TEXT, phone TEXT, mobile TEXT,
             address TEXT, notes TEXT, tags TEXT, favorite INTEGER DEFAULT 0, color TEXT`,
  events: `title TEXT, type TEXT DEFAULT 'rdv', start TEXT, end TEXT, all_day INTEGER DEFAULT 0, location TEXT,
           visio_url TEXT, description TEXT, status TEXT DEFAULT 'planifie', contact_id TEXT, participants TEXT,
           reminder_min INTEGER DEFAULT 15, recurrence TEXT DEFAULT 'none', recur_until TEXT, meeting_id TEXT,
           private INTEGER DEFAULT 0, visitor_reminded_at TEXT, ics_seq INTEGER DEFAULT 0, ics_uid TEXT`,
  meetings: `title TEXT, event_id TEXT, start TEXT, end TEXT, location TEXT, visio_url TEXT, organizer TEXT,
             president TEXT, secretary TEXT, objective TEXT, agenda TEXT, participants TEXT, minutes TEXT,
             status TEXT DEFAULT 'preparation', convocation_sent_at TEXT, pv_sent_at TEXT, pv_validated_at TEXT,
             pv_validated_by TEXT, pv_remarks TEXT, previous_id TEXT`,
  tasks: `title TEXT, description TEXT, due TEXT, priority TEXT DEFAULT 'normale', status TEXT DEFAULT 'a_faire',
          meeting_id TEXT, contact_id TEXT, assignee TEXT, done_at TEXT, tags TEXT, sort INTEGER DEFAULT 0`,
  reminders: `title TEXT, note TEXT, due TEXT, repeat TEXT DEFAULT 'none', done INTEGER DEFAULT 0, fired_at TEXT,
              link_type TEXT, link_id TEXT`,
  notifications: `date TEXT, kind TEXT, title TEXT, body TEXT, link_type TEXT, link_id TEXT, read INTEGER DEFAULT 0,
                  dedupe TEXT UNIQUE`,
  mail_accounts: `name TEXT, email TEXT, display_name TEXT, smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER,
                  imap_host TEXT, imap_port INTEGER, imap_secure INTEGER, username TEXT, password_enc TEXT,
                  signature TEXT, last_uid INTEGER DEFAULT 0, last_sync TEXT, last_error TEXT,
                  auth_type TEXT DEFAULT 'password', oauth_enc TEXT, folder_state TEXT, save_sent INTEGER`,
  mails: `account_id TEXT, folder TEXT, message_id TEXT, uid INTEGER, from_addr TEXT, from_name TEXT, to_addr TEXT,
          cc TEXT, bcc TEXT, subject TEXT, text TEXT, html TEXT, date TEXT, read INTEGER DEFAULT 0,
          starred INTEGER DEFAULT 0, attachments TEXT, in_reply_to TEXT, error TEXT, tries INTEGER DEFAULT 0,
          link_type TEXT, link_id TEXT, imap_path TEXT, flags_dirty INTEGER DEFAULT 0, ics TEXT, ics_method TEXT`,
  templates: `name TEXT, category TEXT, subject TEXT, body TEXT`,
  courrier: `number TEXT, direction TEXT, date TEXT, correspondent TEXT, object TEXT, reference TEXT, mode TEXT,
             assigned_to TEXT, status TEXT DEFAULT 'enregistre', due TEXT, notes TEXT, attachment TEXT, contact_id TEXT,
             files TEXT, circuit TEXT, assigned_email TEXT, reply_to_id TEXT, letter TEXT, treated_at TEXT`,
  calls: `date TEXT, caller TEXT, company TEXT, phone TEXT, for_whom TEXT, message TEXT, direction TEXT DEFAULT 'entrant',
          urgent INTEGER DEFAULT 0, status TEXT DEFAULT 'a_rappeler', contact_id TEXT`,
  notes: `title TEXT, body TEXT, color TEXT, pinned INTEGER DEFAULT 0`,
  // Accès mobile (consultation de l'agenda, validation des PV) : géré depuis le poste, vérifié par le serveur.
  mobile_users: `name TEXT, login TEXT, code_hash TEXT, role TEXT DEFAULT 'direction', active INTEGER DEFAULT 1`,
};

// Tables partagées avec l'équipe via le serveur (VPS). Paramètres, comptes et messages restent sur chaque poste.
const SYNCED = new Set(['contacts', 'events', 'meetings', 'tasks', 'courrier', 'calls', 'templates', 'notes', 'mobile_users']);
// Colonnes de synchronisation ajoutées à toutes les tables.
const SYNC_COLS = ['sync_at TEXT', 'dirty INTEGER NOT NULL DEFAULT 0', 'device_id TEXT'];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS ix_events_start ON events(start)',
  'CREATE INDEX IF NOT EXISTS ix_tasks_due ON tasks(due, status)',
  'CREATE INDEX IF NOT EXISTS ix_rem_due ON reminders(due, done)',
  'CREATE INDEX IF NOT EXISTS ix_mails_folder ON mails(account_id, folder, date)',
  'CREATE INDEX IF NOT EXISTS ix_mails_msgid ON mails(message_id)',
  'CREATE INDEX IF NOT EXISTS ix_notif_read ON notifications(read, date)',
  'CREATE INDEX IF NOT EXISTS ix_courrier_date ON courrier(direction, date)',
];

const uuid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, '0');
// Horodatage local, sans fuseau : l'agenda s'affiche toujours en heure locale du poste.
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const JSON_COLS = new Set(['participants', 'agenda', 'minutes', 'attachments', 'files', 'circuit', 'letter', 'folder_state']);

class DB {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.columns = {};
    for (const t of Object.keys(TABLES)) this.columns[t] = this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    this.listeners = new Set();
    this.deviceId = this.meta('device_id');
    if (!this.deviceId) { this.deviceId = uuid(); this.setMeta('device_id', this.deviceId); }
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    for (const [t, cols] of Object.entries(TABLES)) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (${BASE}, ${cols})`);
      const have = new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const def of [...cols.split(','), ...SYNC_COLS]) {
        const d = def.trim().replace(/\s+UNIQUE\b/i, '');
        const name = d.split(/\s+/)[0];
        if (name && !have.has(name)) this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${d}`);
      }
    }
    for (const sql of INDEXES) this.db.exec(sql);
  }

  meta(key) { const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key); return r ? r.value : null; }
  setMeta(key, value) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value == null ? null : String(value)); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  touch(table) {
    if (!this.listeners.size) return;
    if (!this.touched) {
      this.touched = new Set();
      setImmediate(() => { const t = [...this.touched]; this.touched = null; for (const fn of this.listeners) fn(t); });
    }
    this.touched.add(table);
  }

  all(sql, ...p) { return this.db.prepare(sql).all(...p).map(decode); }
  get(sql, ...p) { const r = this.db.prepare(sql).get(...p); return r ? decode(r) : null; }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }

  tx(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } finally { this.inTx = false; }
  }

  assertTable(t) { if (!TABLES[t]) throw new Error(`Table inconnue : ${t}`); }

  save(table, row) {
    this.assertTable(table);
    const cols = this.columns[table];
    const existing = row.id ? this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) : null;
    const rec = { ...(existing || {}), ...row };
    rec.id = rec.id || uuid();
    rec.created_at = rec.created_at || stamp();
    rec.updated_at = stamp();
    rec.deleted = rec.deleted ? 1 : 0;
    if (SYNCED.has(table)) { rec.sync_at = new Date().toISOString(); rec.dirty = 1; rec.device_id = this.deviceId; }
    const keys = cols.filter((c) => rec[c] !== undefined);
    const vals = keys.map((k) => {
      const v = rec[k];
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v !== null && typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(',')}`, ...vals);
    this.touch(table);
    return this.byId(table, rec.id, true);
  }

  remove(table, id) { return this.save(table, { id, deleted: 1 }); }

  byId(table, id, withDeleted) {
    this.assertTable(table);
    if (!id) return null;
    return this.get(`SELECT * FROM ${table} WHERE id = ?${withDeleted ? '' : ' AND deleted = 0'}`, id);
  }

  list(table, filter = {}, order) {
    this.assertTable(table);
    const cols = this.columns[table];
    const where = ['deleted = 0'];
    const params = [];
    for (const [k, v] of Object.entries(filter)) {
      if (!cols.includes(k)) throw new Error(`Colonne inconnue : ${k}`);
      if (Array.isArray(v)) { where.push(`${k} IN (${v.map(() => '?').join(',')})`); params.push(...v); } else { where.push(`${k} = ?`); params.push(v); }
    }
    let orderBy = '';
    if (order) {
      const [col, dir] = order.split(' ');
      if (!cols.includes(col)) throw new Error(`Tri inconnu : ${col}`);
      orderBy = ` ORDER BY ${col} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    return this.all(`SELECT * FROM ${table} WHERE ${where.join(' AND ')}${orderBy}`, ...params);
  }

  // ---- Synchronisation ----
  // Lignes modifiées localement, telles quelles (JSON non décodé), par lots.
  dirtyRows(limit = 500) {
    const changes = {};
    let count = 0;
    for (const t of SYNCED) {
      if (count >= limit) break;
      const rows = this.db.prepare(`SELECT * FROM ${t} WHERE dirty = 1 LIMIT ?`).all(limit - count);
      if (rows.length) { changes[t] = rows.map(({ dirty, ...r }) => r); count += rows.length; } // eslint-disable-line no-unused-vars
    }
    return { changes, count };
  }
  markClean(changes) {
    this.tx(() => {
      for (const [t, rows] of Object.entries(changes)) {
        const st = this.db.prepare(`UPDATE ${t} SET dirty = 0 WHERE id = ? AND sync_at = ?`);
        for (const r of rows) st.run(r.id, r.sync_at);
      }
    });
  }
  pendingCount() {
    let n = 0;
    for (const t of SYNCED) n += this.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE dirty = 1`).get().n;
    return n;
  }
  // Première activation : toutes les données existantes partent vers le serveur.
  markAllDirty() {
    const now = new Date().toISOString();
    this.tx(() => { for (const t of SYNCED) this.run(`UPDATE ${t} SET dirty = 1, sync_at = COALESCE(sync_at, ?), device_id = COALESCE(device_id, ?)`, now, this.deviceId); });
  }
  // Applique une ligne reçue : la version la plus récente gagne.
  applyRemote(table, data) {
    if (!SYNCED.has(table) || !data || typeof data.id !== 'string') return false;
    const cur = this.db.prepare(`SELECT sync_at FROM ${table} WHERE id = ?`).get(data.id);
    if (cur && cur.sync_at && data.sync_at && cur.sync_at >= data.sync_at) return false;
    const cols = this.columns[table];
    const rec = { ...data, dirty: 0 };
    const keys = cols.filter((c) => rec[c] !== undefined);
    const vals = keys.map((k) => { const v = rec[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v; });
    this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(',')}`, ...vals);
    this.touch(table);
    return true;
  }

  close() { this.db.close(); }
}

function decode(row) {
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (JSON_COLS.has(k) && typeof out[k] === 'string' && out[k]) {
      try { out[k] = JSON.parse(out[k]); } catch { /* valeur texte conservée */ }
    }
  }
  return out;
}

module.exports = { DB, TABLES, SYNCED, uuid, stamp };
