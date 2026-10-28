// Synchronisation d'équipe : envoie au serveur (VPS) les lignes modifiées sur ce poste et récupère celles des collègues.
// Tout fonctionne hors ligne ; dès que le serveur répond, les changements sont rattrapés (la version la plus récente gagne).
class SyncEngine {
  constructor(db, getSettings) {
    this.db = db;
    this.getSettings = getSettings;
    this.state = { status: 'off', lastSync: db.meta('last_sync'), lastError: null, pending: 0, online: false };
    this.timer = null;
    this.running = false;
    this.listeners = new Set();
  }

  onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  publish(patch) {
    Object.assign(this.state, patch, { pending: this.db.pendingCount() });
    for (const fn of this.listeners) fn({ ...this.state });
  }

  config() {
    const s = this.getSettings();
    return { url: String(s.sync_url || '').trim().replace(/\/+$/, ''), token: String(s.sync_token || '').trim(), interval: Math.max(10, Number(s.sync_interval) || 30), name: s.device_name || s.user_name || '' };
  }

  start() {
    this.stop();
    const c = this.config();
    if (!c.url || !c.token) { this.publish({ status: 'off', online: false }); return; }
    // Première connexion de ce poste : toutes ses données partent vers le serveur.
    if (this.db.meta('sync_server') !== c.url) { this.db.markAllDirty(); this.db.setMeta('sync_server', c.url); this.db.setMeta('last_rev', 0); }
    this.timer = setInterval(() => this.run().catch(() => {}), c.interval * 1000);
    this.run().catch(() => {});
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async request(path, opts = {}) {
    const c = this.config();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${c.url}${path}`, {
        ...opts, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}`, 'X-Device-Id': this.db.deviceId, 'X-Device-Name': encodeURIComponent(c.name) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      return body;
    } finally { clearTimeout(t); }
  }

  test() { return this.request('/api/status'); }

  // Une seule synchronisation à la fois : un second appel attend celle en cours.
  run() {
    if (!this.current) this.current = this.runOnce().finally(() => { this.current = null; });
    return this.current;
  }

  async runOnce() {
    const c = this.config();
    if (!c.url || !c.token) return this.state;
    this.running = true;
    this.publish({ status: 'syncing' });
    try {
      let pushed = 0;
      for (let guard = 0; guard < 200; guard++) {
        const { changes, count } = this.db.dirtyRows(500);
        if (!count) break;
        await this.request('/api/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
        this.db.markClean(changes);
        pushed += count;
      }
      let since = Number(this.db.meta('last_rev') || 0);
      let pulled = 0;
      for (let guard = 0; guard < 500; guard++) {
        const r = await this.request(`/api/sync/pull?since=${since}&limit=1000`);
        if (r.rows && r.rows.length) {
          this.db.tx(() => { for (const row of r.rows) if (this.db.applyRemote(row.tbl, row.data)) pulled++; });
        }
        since = r.last_rev;
        this.db.setMeta('last_rev', since);
        if (!r.more) break;
      }
      const now = new Date().toISOString();
      this.db.setMeta('last_sync', now);
      this.publish({ status: 'ok', online: true, lastSync: now, lastError: null, lastPushed: pushed, lastPulled: pulled });
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'Délai dépassé' : e.cause && e.cause.code ? `Serveur injoignable (${e.cause.code})` : e.message;
      this.publish({ status: 'error', online: false, lastError: msg });
    } finally { this.running = false; }
    return this.state;
  }
}

module.exports = { SyncEngine };
