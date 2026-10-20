// Base locale SQLite (module node:sqlite intégré à Electron — aucun module natif à compiler).
// Chaque table synchronisée porte : id (uuid), updated_at, deleted, device_id, dirty.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const SYNC_COLS = `
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  device_id TEXT,
  dirty INTEGER NOT NULL DEFAULT 1`;

// Tables synchronisées avec le VPS, dans l'ordre d'application.
const TABLES = {
  settings: `key TEXT, value TEXT`,
  users: `name TEXT, role TEXT, pin_hash TEXT, active INTEGER DEFAULT 1, phone TEXT`,
  room_types: `name TEXT, base_price REAL DEFAULT 0, capacity INTEGER DEFAULT 2, description TEXT, color TEXT`,
  rooms: `number TEXT, type_id TEXT, floor TEXT, status TEXT DEFAULT 'libre', price REAL, notes TEXT`,
  guests: `first_name TEXT, last_name TEXT, phone TEXT, email TEXT, id_doc TEXT, nationality TEXT,
           address TEXT, company TEXT, notes TEXT, vip INTEGER DEFAULT 0`,
  reservations: `code TEXT, guest_id TEXT, room_id TEXT, check_in TEXT, check_out TEXT, adults INTEGER DEFAULT 1,
           children INTEGER DEFAULT 0, rate REAL DEFAULT 0, status TEXT DEFAULT 'confirmee', source TEXT,
           notes TEXT, checked_in_at TEXT, checked_out_at TEXT, user_id TEXT`,
  folio_items: `reservation_id TEXT, date TEXT, label TEXT, qty REAL DEFAULT 1, unit_price REAL DEFAULT 0,
           amount REAL DEFAULT 0, kind TEXT, order_id TEXT, user_id TEXT`,
  categories: `name TEXT, outlet TEXT DEFAULT 'both', color TEXT, sort INTEGER DEFAULT 0`,
  products: `name TEXT, category_id TEXT, price REAL DEFAULT 0, cost REAL DEFAULT 0, unit TEXT DEFAULT 'unité',
           stock_min REAL DEFAULT 0, track_stock INTEGER DEFAULT 1, outlet TEXT DEFAULT 'both',
           active INTEGER DEFAULT 1, barcode TEXT, supplier_id TEXT`,
  dining_tables: `name TEXT, outlet TEXT, seats INTEGER DEFAULT 4, zone TEXT, sort INTEGER DEFAULT 0`,
  orders: `number TEXT, outlet TEXT, table_id TEXT, reservation_id TEXT, customer TEXT, status TEXT DEFAULT 'ouverte',
           server_id TEXT, opened_at TEXT, closed_at TEXT, subtotal REAL DEFAULT 0, discount REAL DEFAULT 0,
           total REAL DEFAULT 0, covers INTEGER DEFAULT 1, notes TEXT, cancel_reason TEXT`,
  order_items: `order_id TEXT, product_id TEXT, name TEXT, qty REAL DEFAULT 1, unit_price REAL DEFAULT 0,
           cost REAL DEFAULT 0, amount REAL DEFAULT 0, note TEXT, sent INTEGER DEFAULT 0, created_at TEXT`,
  payments: `date TEXT, amount REAL, method TEXT, source TEXT, order_id TEXT, reservation_id TEXT,
           reference TEXT, user_id TEXT`,
  stock_moves: `product_id TEXT, date TEXT, qty REAL, type TEXT, unit_cost REAL DEFAULT 0, note TEXT,
           order_id TEXT, supplier_id TEXT, user_id TEXT`,
  suppliers: `name TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT`,
  expenses: `date TEXT, category TEXT, label TEXT, amount REAL, method TEXT, supplier_id TEXT, outlet TEXT, user_id TEXT`,
  audit_log: `date TEXT, user_id TEXT, action TEXT, entity TEXT, entity_id TEXT, details TEXT`,
};

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS ix_res_dates ON reservations(check_in, check_out)',
  'CREATE INDEX IF NOT EXISTS ix_res_room ON reservations(room_id)',
  'CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status, outlet)',
  'CREATE INDEX IF NOT EXISTS ix_orders_closed ON orders(closed_at)',
  'CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id)',
  'CREATE INDEX IF NOT EXISTS ix_pay_date ON payments(date)',
  'CREATE INDEX IF NOT EXISTS ix_moves_product ON stock_moves(product_id)',
  'CREATE INDEX IF NOT EXISTS ix_folio_res ON folio_items(reservation_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_key ON settings(key)',
];
for (const t of Object.keys(TABLES)) INDEXES.push(`CREATE INDEX IF NOT EXISTS ix_${t}_dirty ON ${t}(dirty)`);

const nowISO = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

class DB {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.columns = {};
    for (const t of Object.keys(TABLES)) {
      this.columns[t] = this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    }
    this.deviceId = this.meta('device_id') || this.setMeta('device_id', uuid());
    this.listeners = new Set();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    for (const [t, cols] of Object.entries(TABLES)) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${t} (${SYNC_COLS}, ${cols})`);
      // Ajout des colonnes manquantes (mise à jour d'une base plus ancienne).
      const have = new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const def of cols.split(',')) {
        const name = def.trim().split(/\s+/)[0];
        if (name && !have.has(name)) this.db.exec(`ALTER TABLE ${t} ADD COLUMN ${def.trim()}`);
      }
    }
    for (const sql of INDEXES) this.db.exec(sql);
    // Stock = somme des mouvements : fusion sans conflit entre postes.
    this.db.exec(`CREATE VIEW IF NOT EXISTS stock_levels AS
      SELECT p.id AS product_id, COALESCE(SUM(m.qty), 0) AS qty
      FROM products p LEFT JOIN stock_moves m ON m.product_id = p.id AND m.deleted = 0
      GROUP BY p.id`);
  }

  meta(key) {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return r ? r.value : null;
  }
  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value == null ? null : String(value));
    return value;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(tables) { for (const fn of this.listeners) fn(tables); }
  // Regroupe les modifications locales d'une même opération en une seule notification.
  touch(table) {
    if (!this.listeners.size) return;
    if (!this.touched) {
      this.touched = new Set();
      setImmediate(() => { const t = [...this.touched]; this.touched = null; this.emit(t); });
    }
    this.touched.add(table);
  }

  all(sql, ...p) { return this.db.prepare(sql).all(...p); }
  get(sql, ...p) { return this.db.prepare(sql).get(...p); }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }

  tx(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  assertTable(t) {
    if (!TABLES[t]) throw new Error(`Table inconnue : ${t}`);
  }

  // Écriture locale : marque la ligne « dirty » pour la prochaine synchro.
  save(table, row) {
    this.assertTable(table);
    const cols = this.columns[table];
    const existing = row.id ? this.get(`SELECT * FROM ${table} WHERE id = ?`, row.id) : null;
    const rec = { ...(existing || {}), ...row };
    rec.id = rec.id || uuid();
    rec.updated_at = nowISO();
    rec.deleted = rec.deleted ? 1 : 0;
    rec.device_id = this.deviceId;
    rec.dirty = 1;
    this.upsertRaw(table, rec, cols);
    this.touch(table);
    return this.get(`SELECT * FROM ${table} WHERE id = ?`, rec.id);
  }

  upsertRaw(table, rec, cols = this.columns[table]) {
    const keys = cols.filter((c) => rec[c] !== undefined);
    const vals = keys.map((k) => {
      const v = rec[k];
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v !== null && typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(',')}`;
    this.run(sql, ...vals);
  }

  remove(table, id) {
    this.assertTable(table);
    return this.save(table, { id, deleted: 1 });
  }

  byId(table, id) {
    this.assertTable(table);
    if (!id) return null;
    return this.get(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`, id) || null;
  }

  // Liste simple avec filtres d'égalité (les colonnes sont vérifiées).
  list(table, filter = {}, order) {
    this.assertTable(table);
    const cols = this.columns[table];
    const where = ['deleted = 0'];
    const params = [];
    for (const [k, v] of Object.entries(filter)) {
      if (!cols.includes(k)) throw new Error(`Colonne inconnue : ${k}`);
      if (Array.isArray(v)) {
        where.push(`${k} IN (${v.map(() => '?').join(',')})`);
        params.push(...v);
      } else {
        where.push(`${k} = ?`);
        params.push(v);
      }
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
  dirtyRows(limit = 500) {
    const out = {};
    let n = 0;
    for (const t of Object.keys(TABLES)) {
      if (n >= limit) break;
      const rows = this.all(`SELECT * FROM ${t} WHERE dirty = 1 LIMIT ?`, limit - n);
      if (rows.length) { out[t] = rows; n += rows.length; }
    }
    return { changes: out, count: n };
  }

  markClean(changes) {
    this.tx(() => {
      for (const [t, rows] of Object.entries(changes)) {
        const st = this.db.prepare(`UPDATE ${t} SET dirty = 0 WHERE id = ? AND updated_at = ?`);
        for (const r of rows) st.run(r.id, r.updated_at);
      }
    });
  }

  pendingCount() {
    let n = 0;
    for (const t of Object.keys(TABLES)) n += this.get(`SELECT COUNT(*) c FROM ${t} WHERE dirty = 1`).c;
    return n;
  }

  // Applique une ligne venue du serveur (dernier écrit gagne).
  applyRemote(table, row) {
    if (!TABLES[table] || !row || !row.id) return false;
    const local = this.get(`SELECT updated_at, dirty FROM ${table} WHERE id = ?`, row.id);
    if (local && local.updated_at >= row.updated_at) return false;
    const rec = {};
    for (const c of this.columns[table]) if (row[c] !== undefined) rec[c] = row[c];
    rec.dirty = 0;
    if (table === 'settings' && rec.key) this.run('DELETE FROM settings WHERE key = ? AND id <> ?', rec.key, rec.id);
    this.upsertRaw(table, rec);
    return true;
  }

  close() { this.db.close(); }
}

module.exports = { DB, TABLES, uuid, nowISO };
