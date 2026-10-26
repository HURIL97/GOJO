// Sessions (profils) : chaque session a sa propre base, ses pièces jointes, ses sauvegardes et son code facultatif.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DB, stamp } = require('./db');

class Profiles {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, 'profiles.json');
    fs.mkdirSync(root, { recursive: true });
  }

  list() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return []; }
  }

  write(list) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(id) { return this.list().find((p) => p.id === id) || null; }

  add({ name, title, organisation, demo }) {
    const id = crypto.randomUUID();
    const dir = path.join(this.root, 'profils', id);
    fs.mkdirSync(dir, { recursive: true });
    const entry = { id, name: name || 'Nouvelle session', title: title || '', organisation: organisation || '', demo: !!demo, has_lock: false, dir, created_at: stamp(), last_used: null };
    this.write([...this.list(), entry]);
    return entry;
  }

  update(id, patch) {
    const list = this.list().map((p) => (p.id === id ? { ...p, ...patch } : p));
    this.write(list);
    return list.find((p) => p.id === id) || null;
  }

  // Supprime la session et ses fichiers (uniquement sous le dossier des profils, jamais ailleurs).
  remove(id) {
    const p = this.get(id);
    if (!p) return false;
    this.write(this.list().filter((x) => x.id !== id));
    const base = path.join(this.root, 'profils') + path.sep;
    if (path.resolve(p.dir).startsWith(base)) fs.rmSync(p.dir, { recursive: true, force: true });
    else for (const ext of ['', '-wal', '-shm']) fs.rmSync(path.join(p.dir, `officia.db${ext}`), { force: true });
    return true;
  }

  // Les données d'avant les sessions (data/officia.db) deviennent une session à part entière.
  adoptLegacy() {
    const file = path.join(this.root, 'officia.db');
    if (!fs.existsSync(file) || this.list().some((p) => path.resolve(p.dir) === path.resolve(this.root))) return null;
    let name = 'Session principale';
    let organisation = '';
    let title = '';
    let demo = false;
    let hasLock = false;
    try {
      const db = new DB(file);
      const set = Object.fromEntries(db.list('settings').map((r) => [r.key, r.value]));
      name = set.user_name || name;
      organisation = set.organisation || '';
      title = set.user_title || '';
      hasLock = !!set.lock_pin;
      demo = !!db.get(`SELECT 1 FROM contacts WHERE email = 'a.kone@exemple.ci' AND deleted = 0`);
      db.close();
    } catch { /* base illisible : on garde les valeurs par défaut */ }
    const entry = { id: 'principale', name, title, organisation, demo, has_lock: hasLock, dir: this.root, created_at: stamp(), last_used: stamp() };
    this.write([...this.list(), entry]);
    return entry;
  }
}

const dbFileOf = (p) => path.join(p.dir, 'officia.db');
const filesDirOf = (p) => path.join(p.dir, 'fichiers');

module.exports = { Profiles, dbFileOf, filesDirOf };
