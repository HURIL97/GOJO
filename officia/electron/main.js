// Processus principal : fenêtre, zone de notification, notifications Windows, IPC, PDF, sauvegardes.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, nativeImage, safeStorage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const ics = require('./ics');
const { loginMicrosoft } = require('./oauth');
const { SyncEngine } = require('./sync');
const { DB, stamp } = require('./db');
const { createServices, today, DEFAULT_SETTINGS } = require('./services');
const { createMail } = require('./mail');
const { Profiles, dbFileOf, filesDirOf } = require('./profiles');

process.removeAllListeners('warning'); // masque l'avertissement « SQLite experimental »
app.commandLine.appendSwitch('lang', 'fr-FR');
app.setAppUserModelId('com.officiatech.app'); // nécessaire aux notifications Windows

const DEV = process.env.OFFICIA_DEV === '1';
let win;
let tray;
let db;
let S;
let M;
let quitting = false;
let unlocked = false;
let profiles;
let current = null; // session ouverte
let locked = false; // session ouverte mais verrouillée (inactivité, verrouillage de Windows, cadenas)
let sync = null;
const UPDATE_REPO = 'HURIL97/GOJO';

const rootDir = () => path.join(app.getPath('userData'), 'data');
const dataDir = () => (current ? current.dir : rootDir());
const filesDir = () => (current ? filesDirOf(current) : path.join(rootDir(), 'fichiers'));
const dbFile = () => (current ? dbFileOf(current) : path.join(rootDir(), 'officia.db'));
const setting = (k) => (S ? S.settings()[k] : DEFAULT_SETTINGS[k]);
const iconPath = path.join(__dirname, 'icon.png');

// Mots de passe chiffrés par Windows (DPAPI) lorsque c'est disponible.
const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : `b64:${Buffer.from(s).toString('base64')}`);
const decrypt = (s) => {
  if (!s) return '';
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  return Buffer.from(s.slice(4), 'base64').toString();
};

// Reprend automatiquement les données de l'ancienne version (« Officia ») au premier lancement d'OfficiaTech.
function migrateLegacyData() {
  try {
    const legacy = path.join(app.getPath('appData'), 'Officia', 'data');
    if (fs.existsSync(path.join(rootDir(), 'officia.db')) || !fs.existsSync(path.join(legacy, 'officia.db'))) return;
    fs.cpSync(legacy, rootDir(), { recursive: true, errorOnExist: false });
  } catch (e) { console.error('Reprise des anciennes données impossible', e); }
}

function initData() {
  migrateLegacyData();
  profiles = new Profiles(rootDir());
  profiles.adoptLegacy();
}

const publicProfile = (p) => ({ id: p.id, name: p.name, title: p.title, organisation: p.organisation, demo: p.demo, has_lock: p.has_lock, last_used: p.last_used });

function closeSession() {
  clearInterval(mailTimer);
  if (sync) sync.stop();
  if (db) externalBackup();
  sync = null;
  unlocked = false;
  locked = false;
  if (db) { try { db.close(); } catch { /* déjà fermée */ } }
  db = null; S = null; M = null; current = null;
}

function openSession(entry) {
  closeSession();
  current = entry;
  fs.mkdirSync(filesDir(), { recursive: true });
  db = new DB(dbFile());
  S = createServices(db);
  M = createMail(db, { encrypt, decrypt, filesDir: filesDir(), oauth: () => { const st = S.settings(); return { clientId: String(st.ms_client_id || '').trim(), tenant: st.ms_tenant || 'common' }; } });
  db.onChange((tables) => send('data:changed', tables));
  S.seedQuickReplies();
  autoBackup();
  externalBackup();
  sync = new SyncEngine(db, S.settings);
  sync.onStatus((st) => send('sync:status', st));
  sync.start();
  current = profiles.update(entry.id, { last_used: stamp() }) || entry;
  unlocked = true;
  scheduleMail();
  tick();
}

// Vérifie le code d'une session sans l'ouvrir.
// Le code est lu dans la base elle-même (fiable même après une restauration de sauvegarde).
function checkSessionPin(entry, pin) {
  if (!fs.existsSync(dbFileOf(entry))) return;
  const tmp = new DB(dbFileOf(entry));
  try {
    const locked = !!tmp.get(`SELECT value FROM settings WHERE key = 'lock_pin' AND deleted = 0 AND value <> ''`);
    if (locked !== !!entry.has_lock) profiles.update(entry.id, { has_lock: locked });
    if (locked) createServices(tmp).unlock(pin);
  } finally { tmp.close(); }
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function autoBackup() {
  try {
    const dir = path.join(dataDir(), 'sauvegardes');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `officia-${today()}.db`);
    if (!fs.existsSync(target)) {
      db.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(dir, f));
    }
  } catch (e) { console.error('Sauvegarde automatique impossible', e); }
}

// Copie de sauvegarde vers un dossier choisi (clé USB, Google Drive pour ordinateur, OneDrive, partage réseau).
function externalBackup(force) {
  if (!db || !S) return null;
  const dir = String(S.settings().backup_dir || '').trim();
  if (!dir) return null;
  try {
    if (!fs.existsSync(dir)) throw new Error(`Dossier de sauvegarde introuvable (${dir}) : clé USB débranchée ?`);
    const prefix = `OfficiaTech-${safeName(current ? current.name : 'session').replace(/\s+/g, '_')}-`;
    const target = path.join(dir, `${prefix}${today()}.db`);
    if (fs.existsSync(target) && !force) return target;
    const tmp = `${target}.tmp`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    db.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    fs.renameSync(tmp, target);
    const keep = Math.max(1, Number(S.settings().backup_keep) || 30);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
    db.setMeta('backup_ext_at', stamp());
    db.setMeta('backup_ext_error', '');
    return target;
  } catch (e) {
    db.setMeta('backup_ext_error', e.message);
    if (force) throw e;
    return null;
  }
}

function listBackups() {
  const out = [];
  const scan = (dir, where) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.db')) continue;
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        out.push({ path: p, name: f, where, size: st.size, date: stamp(st.mtime) });
      }
    } catch { /* dossier absent */ }
  };
  scan(path.join(dataDir(), 'sauvegardes'), 'Sur ce poste');
  const ext = S && String(S.settings().backup_dir || '').trim();
  if (ext) scan(ext, 'Dossier externe');
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

async function restoreFrom(file) {
  const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, message: 'Remplacer toutes les données de cette session par cette sauvegarde ?', detail: `${path.basename(file)}\n\nL’application va redémarrer. Les données actuelles sont conservées à côté (« .avant-restauration »).` });
  if (response !== 1) return false;
  const target = dbFile();
  db.close();
  db = null;
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(target + ext)) fs.renameSync(target + ext, `${target}${ext}.avant-restauration`);
  fs.copyFileSync(file, target);
  quitting = true;
  app.relaunch();
  app.exit(0);
  return true;
}

function showWindow(link) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (link) send('navigate', link);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, title: 'OfficiaTech', icon: iconPath,
    backgroundColor: '#0b0f1e', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) { win.maximize(); win.show(); } });
  if (DEV) win.loadURL('http://localhost:5174'); else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:5174')) { e.preventDefault(); shell.openExternal(url); } });
  win.on('close', (e) => {
    if (!quitting && setting('minimize_to_tray') === '1') { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('OfficiaTech');
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir OfficiaTech', click: () => showWindow() },
    { label: 'Ma journée', click: () => showWindow({ page: 'home' }) },
    { label: 'Agenda', click: () => showWindow({ page: 'agenda' }) },
    { type: 'separator' },
    { label: 'Se déconnecter', click: () => { closeSession(); showWindow(); send('session:logout'); } },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

// ---- Planificateur : échéances, rappels, messagerie ----
const LINK_PAGE = { meeting: 'meetings', event: 'agenda', reminder: 'tasks', tasks: 'tasks', courrier: 'courrier', calls: 'calls', mail: 'mail', home: 'home' };
function deliver(list) {
  if (!list.length || !S) return;
  send('notifications:new', list);
  const set = S.settings();
  if (set.notify_native !== '1' || !Notification.isSupported()) return;
  for (const n of list.slice(0, 4)) {
    // Session verrouillée : le contenu reste confidentiel.
    const notif = new Notification({ title: locked ? 'OfficiaTech' : n.title, body: locked ? 'Nouvelle notification — déverrouillez la session pour la consulter' : n.body || '', icon: iconPath, silent: set.notify_sound !== '1' });
    notif.on('click', () => { S.markRead(n.id); showWindow({ page: LINK_PAGE[n.link_type] || 'home', id: n.link_id, type: n.link_type }); });
    notif.show();
  }
}
function tick() {
  if (!S) return;
  try { deliver(S.tick()); } catch (e) { console.error(e); }
  automations().catch((e) => console.error('Automatisations', e));
  // Verrouillage après inactivité (uniquement si la session a un code).
  const idle = Number(S.settings().lock_idle_minutes) || 0;
  if (!locked && idle > 0 && powerMonitor.getSystemIdleTime() >= idle * 60) lockSession();
  // Sauvegarde externe quotidienne, même si l'ordinateur reste allumé plusieurs jours.
  if (db && db.meta('backup_day') !== today()) { db.setMeta('backup_day', today()); autoBackup(); externalBackup(); }
}

function lockSession() {
  if (!S || locked || S.settings().has_lock !== '1') return false;
  locked = true;
  send('session:locked');
  return true;
}

// Rappels automatiques : visiteurs de demain (e-mail) et relances du courrier.
let autoBusy = false;
async function automations() {
  if (autoBusy || !S || !M) return;
  autoBusy = true;
  try {
    const batch = S.automationBatch();
    const acc = M.accounts()[0];
    const out = [];
    for (const v of batch.visitors) {
      if (!acc) { batch.phones.push(v.ev); continue; }
      try {
        const ev = db.byId('events', v.ev.id);
        const invite = ics.calendar([ev], { method: 'REQUEST', organizer: { name: acc.display_name, email: acc.email }, attendees: [{ name: v.ev.contact ? `${v.ev.contact.first_name || ''} ${v.ev.contact.last_name || ''}`.trim() : '', email: v.to }] });
        await M.send({ account_id: acc.id, to_addr: v.to, subject: v.subject, text: v.text, ics: invite, link_type: 'event', link_id: v.ev.id });
        S.markVisitorReminded(v.ev.id);
        out.push(S.notify({ kind: 'event', title: `Rappel envoyé à ${v.to}`, body: `${v.ev.title} — demain ${v.ev.start.slice(11, 16)}`, link_type: 'event', link_id: v.ev.id, dedupe: `visit:${v.ev.id}:${v.ev.start}` }));
      } catch (e) { console.error('Rappel visiteur', e.message); }
    }
    if (batch.phones.length) {
      out.push(S.notify({ kind: 'event', title: `${batch.phones.length} visiteur${batch.phones.length > 1 ? 's' : ''} à prévenir pour demain`, body: 'Sans adresse e-mail : prévenez-les par WhatsApp ou SMS depuis « Ma journée »', link_type: 'home', dedupe: `visitphones:${today()}` }));
    }
    for (const rel of batch.relances) {
      if (!acc) break;
      try {
        await M.send({ account_id: acc.id, to_addr: rel.to, subject: rel.subject, text: rel.text, link_type: 'courrier', link_id: rel.courrier.id });
        S.courrierStep(rel.courrier.id, { action: 'relance', to: rel.to, note: 'Relance automatique par e-mail' });
        out.push(S.notify({ kind: 'courrier', title: `Relance envoyée : courrier ${rel.courrier.number}`, body: `${rel.courrier.object} → ${rel.to}`, link_type: 'courrier', link_id: rel.courrier.id, dedupe: `relance:${rel.courrier.id}:${today()}` }));
      } catch (e) { console.error('Relance courrier', e.message); }
    }
    deliver(out.filter(Boolean));
  } finally { autoBusy = false; }
}

let mailBusy = false;
async function mailCycle() {
  if (mailBusy || !M) return;
  mailBusy = true;
  try {
    await M.processOutbox();
    const r = await M.fetchAll();
    if (r.fetched) {
      const list = [];
      if (r.fetched <= 3) {
        for (const m of r.mails) list.push(S.notify({ kind: 'mail', title: `Nouveau message de ${m.from_name || m.from_addr}`, body: m.subject || '(sans objet)', link_type: 'mail', link_id: m.id, dedupe: `mail:${m.id}` }));
      } else list.push(S.notify({ kind: 'mail', title: `${r.fetched} nouveaux messages`, body: 'Boîte de réception', link_type: 'mail', dedupe: `mailbatch:${stamp()}` }));
      deliver(list.filter(Boolean));
    }
    send('mail:synced', r.fetched);
  } catch (e) { console.error('Messagerie', e); } finally { mailBusy = false; }
}
let mailTimer;
function scheduleMail() {
  clearInterval(mailTimer);
  if (!S) return;
  const min = Math.max(1, Number(S.settings().mail_sync_minutes) || 5);
  mailTimer = setInterval(mailCycle, min * 60000);
  setTimeout(mailCycle, 5000);
}

// ---- Génération de PDF ----
function htmlToPdf(html, file) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.webContents.once('did-finish-load', async () => {
      try {
        const data = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        fs.writeFileSync(file, data);
        resolve(file);
      } catch (e) { reject(e); } finally { w.close(); }
    });
  });
}
function printHtml(html) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.webContents.once('did-finish-load', () => {
      w.webContents.print({ printBackground: true }, (ok, reason) => { w.close(); if (!ok && reason !== 'cancelled') reject(new Error(reason)); else resolve(ok); });
    });
  });
}
const safeName = (s) => String(s || 'document').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

function handle(channel, fn, { open = false } = {}) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      if (!open && (!unlocked || locked)) throw new Error(locked ? 'Session verrouillée' : 'Application verrouillée');
      return { ok: true, data: await fn(...args) };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function registerIpc() {
  // Démarrage et verrouillage
  handle('app.info', () => ({ version: app.getVersion(), dataDir: dataDir(), today: today(), firstRun: !profiles.list().length }), { open: true });

  // Sessions
  handle('session.state', () => ({ profiles: profiles.list().map(publicProfile), current: unlocked && current ? current.id : null, locked }), { open: true });
  handle('session.lock', () => lockSession(), { open: true });
  handle('session.unlock', (pin) => { if (!S) throw new Error('Aucune session ouverte'); S.unlock(pin); locked = false; return true; }, { open: true });
  handle('session.auto', () => {
    // Ouverture directe uniquement s'il n'existe qu'une session, sans code.
    const list = profiles.list();
    if (list.length !== 1) return false;
    try { checkSessionPin(list[0], undefined); } catch { return false; }
    openSession(list[0]);
    return true;
  }, { open: true });
  handle('session.open', (id, pin) => {
    const entry = profiles.get(id);
    if (!entry) throw new Error('Session introuvable');
    checkSessionPin(entry, pin);
    openSession(entry);
    return publicProfile(current);
  }, { open: true });
  handle('session.create', ({ settings, demo, pin }) => {
    if (!settings || !String(settings.user_name || '').trim()) throw new Error('Indiquez votre nom');
    if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('Le code doit contenir 4 à 8 chiffres');
    const entry = profiles.add({ name: settings.user_name, title: settings.user_title, organisation: settings.organisation, demo });
    openSession(entry);
    S.saveSettings(settings);
    if (pin) S.setLockPin(pin);
    if (demo) S.seedDemo(); else S.seedTemplates();
    current = profiles.update(entry.id, { has_lock: !!pin });
    tick();
    return publicProfile(current);
  }, { open: true });
  handle('session.remove', (id, pin) => {
    const entry = profiles.get(id);
    if (!entry) return false;
    checkSessionPin(entry, pin);
    if (current && current.id === id) closeSession();
    return profiles.remove(id);
  }, { open: true });
  handle('app.logout', () => { closeSession(); return true; }, { open: true });
  handle('settings.get', () => (S ? S.settings() : { ...DEFAULT_SETTINGS, lock_pin: undefined, has_lock: '0' }), { open: true });
  handle('settings.save', (v) => {
    const r = S.saveSettings(v);
    if (sync) sync.start();
    current = profiles.update(current.id, { name: r.user_name || current.name, title: r.user_title || '', organisation: r.organisation || '' });
    app.setLoginItemSettings({ openAtLogin: r.start_with_windows === '1', args: ['--hidden'] });
    scheduleMail();
    return r;
  });
  handle('settings.lockPin', (pin) => { const r = S.setLockPin(pin); current = profiles.update(current.id, { has_lock: r.has_lock === '1' }); return r; });

  // Générique
  const TABLES = new Set(['contacts', 'events', 'meetings', 'tasks', 'reminders', 'courrier', 'calls', 'templates', 'notes']);
  handle('db.list', (t, f, o) => { if (!TABLES.has(t)) throw new Error('Accès refusé'); return db.list(t, f, o); });
  handle('db.get', (t, id) => { if (!TABLES.has(t)) throw new Error('Accès refusé'); return db.byId(t, id); });
  handle('db.save', (t, row) => { if (!TABLES.has(t)) throw new Error('Accès refusé'); return db.save(t, row); });
  handle('db.remove', (t, id) => { if (!TABLES.has(t) && t !== 'mails') throw new Error('Accès refusé'); return db.remove(t, id); });

  // Métier
  handle('dashboard', () => S.dashboard());
  handle('search', (q) => S.search(q));
  handle('contacts.list', (q) => S.contacts(q));
  handle('contacts.history', (id) => S.contactHistory(id));
  handle('contacts.import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Contacts (CSV)', extensions: ['csv', 'txt'] }] });
    if (canceled || !filePaths[0]) return null;
    const buf = fs.readFileSync(filePaths[0]);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
    return S.importContacts(text);
  });
  handle('agenda.range', (a, b) => S.agenda(a, b));
  handle('agenda.conflicts', (a, b, ex) => S.conflicts(a, b, ex));
  handle('agenda.save', (d) => S.saveEvent(d));
  handle('agenda.status', (id, st) => S.setEventStatus(id, st));
  handle('meetings.list', (f) => S.meetings(f));
  handle('meetings.get', (id) => S.meeting(id));
  handle('meetings.save', (d) => S.saveMeeting(d));
  handle('meetings.status', (id, st) => S.setMeetingStatus(id, st));
  handle('tasks.list', (f) => S.tasks(f));
  handle('tasks.save', (d) => S.saveTask(d));
  handle('reminders.list', (f) => S.reminders(f));
  handle('reminders.save', (d) => S.saveReminder(d));
  handle('reminders.done', (id) => S.completeReminder(id));
  handle('reminders.snooze', (id, m) => S.snoozeReminder(id, m));
  handle('courrier.list', (f) => S.courrier(f));
  handle('courrier.save', (d) => S.saveCourrier(d));
  handle('calls.list', (f) => S.calls(f));
  handle('calls.save', (d) => S.saveCall(d));
  handle('notif.list', () => S.notifications());
  handle('notif.unread', () => S.unreadCount());
  handle('notif.read', (id) => S.markRead(id));
  handle('notif.clear', () => S.clearNotifications());
  handle('templates.fill', (tpl, vars) => S.fillTemplate(tpl, vars));

  // Messagerie
  handle('mail.accounts', () => M.accounts());
  handle('mail.saveAccount', (d) => M.saveAccount(d));
  handle('mail.preset', (email) => M.preset(email));
  handle('mail.test', (id) => M.testAccount(id));
  handle('mail.list', (f) => M.list(f));
  handle('mail.starred', () => M.starred());
  handle('mail.get', (id) => M.get(id));
  handle('mail.counts', () => M.counts());
  handle('mail.update', (id, p) => M.update(id, p));
  handle('mail.draft', (d) => M.saveDraft(d));
  handle('mail.send', async (d, pdf) => {
    const draft = { ...d, attachments: Array.isArray(d.attachments) ? [...d.attachments] : [] };
    if (pdf && pdf.html) {
      const dir = path.join(filesDir(), 'pdf');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${safeName(pdf.filename)}.pdf`);
      await htmlToPdf(pdf.html, file);
      draft.attachments.push({ filename: `${safeName(pdf.filename)}.pdf`, path: file, size: fs.statSync(file).size });
    }
    // Invitation calendrier (.ics) : le destinataire l'ajoute à son agenda d'un clic (Outlook, Gmail, téléphone).
    if (draft.invite_event) {
      const ev = db.byId('events', draft.invite_event);
      const acc = M.accounts().find((a) => a.id === draft.account_id);
      if (ev) {
        const emails = `${draft.to_addr || ''},${draft.cc || ''}`.split(/[,;]/).map((x) => x.trim()).filter((x) => /@/.test(x));
        const people = db.list('contacts');
        const attendees = emails.map((e) => { const c = people.find((x) => (x.email || '').toLowerCase() === e.toLowerCase()); return { email: e, name: c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : '' }; });
        draft.ics = ics.calendar([ev], { method: 'REQUEST', organizer: acc ? { name: acc.display_name || S.settings().user_name, email: acc.email } : null, attendees });
      }
      delete draft.invite_event;
    }
    if (draft.id) { const ex = db.byId('mails', draft.id); if (ex && ex.folder === 'drafts') db.remove('mails', draft.id); delete draft.id; }
    const visitor = draft.remind_visitor;
    const cstep = draft.courrier_step;
    delete draft.remind_visitor;
    delete draft.courrier_step;
    const r = await M.send(draft);
    if (visitor) S.markVisitorReminded(visitor);
    if (cstep && cstep.id) S.courrierStep(cstep.id, cstep);
    if (draft.link_type === 'meeting' && draft.link_id && pdf && pdf.kind) S.setMeetingStatus(draft.link_id, pdf.kind === 'pv' ? 'pv_diffuse' : 'convoquee');
    return r;
  });
  handle('mail.sync', () => mailCycle());
  handle('mail.pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (canceled) return [];
    return filePaths.map((p) => ({ filename: path.basename(p), path: p, size: fs.statSync(p).size }));
  });

  handle('mail.microsoft', async (data = {}) => {
    const st = S.settings();
    const res = await loginMicrosoft({ clientId: String(st.ms_client_id || '').trim(), tenant: st.ms_tenant || 'common', loginHint: data.email }, (u) => shell.openExternal(u));
    const email = data.email || res.email;
    if (!email) throw new Error('Adresse e-mail introuvable dans le compte Microsoft');
    showWindow();
    return M.saveAccount({ ...data, email, username: res.email || email, display_name: data.display_name || res.name || '', auth_type: 'oauth_ms', oauth: res.tokens,
      smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: 0, imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: 1 });
  });
  handle('mail.removeAccount', (id) => db.remove('mail_accounts', id));

  // Agenda : fichiers .ics et visiteurs de demain
  handle('agenda.exportIcs', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `agenda-officiatech-${today()}.ics`), filters: [{ name: 'Calendrier (iCalendar)', extensions: ['ics'] }] });
    if (canceled) return null;
    const from = `${addDaysISO(-90)}T00:00:00`;
    const evs = db.list('events').filter((e) => e.status !== 'annule' && (e.start >= from || (e.recurrence && e.recurrence !== 'none')));
    fs.writeFileSync(filePath, ics.calendar(evs, { name: `Agenda — ${S.settings().organisation || 'OfficiaTech'}` }), 'utf8');
    return { file: filePath, count: evs.length };
  });
  handle('agenda.importIcs', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Calendrier (iCalendar)', extensions: ['ics'] }] });
    if (canceled || !filePaths[0]) return null;
    return S.importEvents(ics.parse(fs.readFileSync(filePaths[0], 'utf8')));
  });
  handle('agenda.visitors', () => S.visitorReminders().map((e) => ({ id: e.id, title: e.title, start: e.start, location: e.location, visio_url: e.visio_url, reminded: e.visitor_reminded_at,
    contact: { id: e.contact.id, name: [e.contact.first_name, e.contact.last_name].filter(Boolean).join(' ') || e.contact.company, email: e.contact.email, phone: e.contact.mobile || e.contact.phone }, message: S.visitorMessage(e).text })));
  handle('agenda.markReminded', (id) => S.markVisitorReminded(id));

  // Réunions : séance suivante, suivi des actions, validation
  handle('meetings.next', (id, start) => S.planNextMeeting(id, start));
  handle('meetings.carry', (id) => S.carryActions(id));
  handle('meetings.openActions', (id) => S.openActions(id));
  handle('meetings.validate', (id, remarks) => S.validatePv(id, S.settings().manager_name || S.settings().user_name, remarks));

  // Courrier : circuit, relance, lettres, numérisation
  handle('courrier.step', (id, step) => S.courrierStep(id, step));
  handle('courrier.relance', (id) => { const c = db.byId('courrier', id); if (!c) throw new Error('Courrier introuvable'); return S.relanceMessage(c); });
  handle('courrier.letterPdf', async (html, name) => {
    const dir = path.join(filesDir(), 'courrier');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${safeName(name)}.pdf`);
    await htmlToPdf(html, file);
    return { filename: `${safeName(name)}.pdf`, path: file, size: fs.statSync(file).size };
  });
  handle('scan.acquire', () => scanDocument());
  handle('export.doc', async (html, name) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safeName(name)}.doc`), filters: [{ name: 'Document Word', extensions: ['doc'] }] });
    if (canceled) return null;
    const word = html.replace('<html lang="fr">', '<html lang="fr" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">').replace('<head>', '<head><meta name="ProgId" content="Word.Document">');
    fs.writeFileSync(filePath, `﻿${word}`, 'utf8');
    shell.openPath(filePath);
    return filePath;
  });
  handle('settings.pickLogo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] }] });
    if (canceled || !filePaths[0]) return null;
    let img = nativeImage.createFromPath(filePaths[0]);
    if (img.isEmpty()) throw new Error('Image illisible');
    if (img.getSize().width > 480) img = img.resize({ width: 480, quality: 'best' });
    return img.toDataURL();
  });

  // Équipe : serveur, accès mobile, flux d'agenda
  const teamLinks = () => {
    const st = S.settings();
    const url = String(st.sync_url || '').trim().replace(/\/+$/, '');
    const tok = String(st.sync_token || '').trim();
    if (!url || !tok) return { mobileUrl: '', icalUrl: '' };
    return { mobileUrl: `${url}/m`, icalUrl: `${url}/ical/${crypto.createHmac('sha256', tok).update('ical').digest('hex').slice(0, 32)}.ics` };
  };
  handle('team.state', () => ({ ...(sync ? sync.state : { status: 'off' }), pending: db.pendingCount(), device: db.deviceId, ...teamLinks() }));
  handle('team.syncNow', () => sync.run());
  handle('team.test', () => sync.test());
  handle('mobile.list', () => S.mobileUsers());
  handle('mobile.save', (u) => S.saveMobileUser(u));
  handle('mobile.remove', (id) => db.remove('mobile_users', id));

  // Rapport mensuel
  handle('report.month', (m) => S.monthlyReport(m));

  // Mises à jour (publications GitHub)
  handle('update.check', () => checkUpdate(), { open: true });
  handle('update.install', (u) => installUpdate(u), { open: true });

  // Fichiers, impression, export
  // Appel (tel:), SMS (sms:) et WhatsApp (wa.me) : ouverts par Windows, « Lien avec Windows » ou WhatsApp.
  handle('phone.open', (url) => {
    if (!/^(tel:\+?\d{6,16}$|sms:\+?\d{6,16}(\?body=.*)?$|https:\/\/wa\.me\/\d{6,16}(\?text=.*)?$)/.test(String(url || ''))) throw new Error('Numéro de téléphone invalide');
    return shell.openExternal(url).catch(() => {
      throw new Error(url.startsWith('tel:') || url.startsWith('sms:') ? 'Aucune application d’appel ou de SMS n’est associée : installez et configurez « Lien avec Windows » avec votre téléphone.' : 'Impossible d’ouvrir WhatsApp');
    });
  });
  handle('file.open', (p) => { if (p && fs.existsSync(p)) return shell.openPath(p); throw new Error('Fichier introuvable'); });
  handle('file.attach', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'doc', 'docx', 'xls', 'xlsx', 'odt', 'msg', 'eml'] }] });
    if (canceled || !filePaths.length) return [];
    const dir = path.join(filesDir(), 'courrier');
    fs.mkdirSync(dir, { recursive: true });
    return filePaths.map((src, i) => {
      const target = path.join(dir, `${Date.now() + i}-${safeName(path.basename(src))}`);
      fs.copyFileSync(src, target);
      return { filename: path.basename(src), path: target, size: fs.statSync(target).size };
    });
  });
  handle('print.html', (html) => printHtml(html));
  handle('print.pdf', async (html, name) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safeName(name)}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled) return null;
    await htmlToPdf(html, filePath);
    shell.openPath(filePath);
    return filePath;
  });
  handle('export.csv', async (name, rows) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${safeName(name)}-${today()}.csv`), filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
    if (canceled) return null;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const esc = (v) => { if (v == null) return ''; const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    fs.writeFileSync(filePath, '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n'), 'utf8');
    shell.openPath(filePath);
    return filePath;
  });
  handle('backup.create', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `officia-sauvegarde-${today()}.db`), filters: [{ name: 'Sauvegarde OfficiaTech', extensions: ['db'] }] });
    if (canceled) return null;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    return filePath;
  });
  handle('backup.restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'Sauvegarde OfficiaTech', extensions: ['db'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return false;
    return restoreFrom(filePaths[0]);
  });
  handle('backup.list', () => listBackups());
  handle('backup.restoreFile', (p) => { if (!listBackups().some((b) => b.path === p)) throw new Error('Sauvegarde introuvable'); return restoreFrom(p); });
  handle('backup.pickDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Dossier des sauvegardes (clé USB, Google Drive, OneDrive…)' });
    return canceled ? null : filePaths[0];
  });
  handle('backup.external', () => externalBackup(true));
  handle('backup.state', () => ({ at: db.meta('backup_ext_at'), error: db.meta('backup_ext_error') }));
  handle('backup.openFolder', () => shell.openPath(dataDir()));
}

const addDaysISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return stamp(d).slice(0, 10); };

// ---- Numérisation (scanner Windows, WIA) ----
const SCAN_PS = `$ErrorActionPreference = 'Stop'
try {
  $dlg = New-Object -ComObject WIA.CommonDialog
  $img = $dlg.ShowAcquireImage(1, 1, 131072, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false)
  if ($img -eq $null) { exit 2 }
  if (Test-Path $args[0]) { Remove-Item $args[0] }
  $img.SaveFile($args[0])
} catch {
  if ($_.Exception.HResult -eq -2145320939) { exit 3 }
  Write-Error $_.Exception.Message
  exit 1
}`;
function scanDocument() {
  if (process.platform !== 'win32') return Promise.reject(new Error('La numérisation directe est disponible sous Windows'));
  const dir = path.join(filesDir(), 'courrier');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(os.tmpdir(), 'officiatech-scan.ps1');
  fs.writeFileSync(script, SCAN_PS, 'utf8');
  const jpg = path.join(os.tmpdir(), `officiatech-scan-${Date.now()}.jpg`);
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, jpg], { windowsHide: true, timeout: 10 * 60000 }, async (err, _out, stderr) => {
      if (err) {
        if (err.code === 2) return resolve(null); // annulé
        if (err.code === 3) return reject(new Error('Aucun scanner détecté : vérifiez qu’il est allumé et installé dans Windows'));
        return reject(new Error(`Numérisation impossible : ${String(stderr || err.message).trim().split(/\r?\n/)[0]}`));
      }
      try {
        // Le document numérisé est enregistré en PDF (format attendu pour l'archivage du courrier).
        const name = `Numerisation-${stamp().replace(/[T:]/g, '-')}`;
        const file = path.join(dir, `${Date.now()}-${name}.pdf`);
        const data = fs.readFileSync(jpg).toString('base64');
        await htmlToPdf(`<!doctype html><html><head><style>@page{size:A4;margin:0}body{margin:0}img{width:210mm;height:297mm;object-fit:contain;display:block}</style></head><body><img src="data:image/jpeg;base64,${data}"></body></html>`, file);
        fs.unlinkSync(jpg);
        resolve({ filename: `${name}.pdf`, path: file, size: fs.statSync(file).size });
      } catch (e) { reject(e); }
    });
  });
}

// ---- Mises à jour : publications « officia-vX.Y.Z » du dépôt GitHub ----
const newer = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`, { headers: { 'User-Agent': 'OfficiaTech', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Vérification impossible (GitHub ${res.status})`);
  const list = await res.json();
  const current = app.getVersion();
  let best = null;
  for (const r of list) {
    const m = /^officia-v(\d+\.\d+\.\d+)$/.exec(r.tag_name || '');
    if (!m || r.draft || r.prerelease) continue;
    const exe = (r.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
    if (exe && (!best || newer(m[1], best.version))) best = { version: m[1], notes: r.body || '', page: r.html_url, url: exe.browser_download_url, size: exe.size, name: exe.name, date: r.published_at };
  }
  return { current, latest: best ? best.version : current, available: !!best && newer(best.version, current), ...(best || {}) };
}
async function installUpdate(u) {
  if (!u || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(u.url || '')) throw new Error('Lien de mise à jour invalide');
  const res = await fetch(u.url, { headers: { 'User-Agent': 'OfficiaTech' } });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const file = path.join(os.tmpdir(), safeName(u.name || 'OfficiaTech-Setup.exe'));
  const total = Number(res.headers.get('content-length')) || u.size || 0;
  const out = fs.createWriteStream(file);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    send('update:progress', total ? Math.round((got / total) * 100) : null);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  if (total && got !== total) throw new Error('Téléchargement incomplet, réessayez');
  // L'installateur remplace l'application ; les données (dossier utilisateur) sont conservées.
  if (S) externalBackup();
  await shell.openPath(file);
  setTimeout(() => { quitting = true; app.quit(); }, 1500);
  return file;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    initData();
    registerIpc();
    createWindow();
    createTray();
    setInterval(tick, 30000);
    powerMonitor.on('lock-screen', () => lockSession());
    // Vérification discrète des mises à jour au démarrage.
    setTimeout(() => { checkUpdate().then((u) => { if (u.available) send('update:available', u); }).catch(() => {}); }, 20000);
  });
  app.on('before-quit', () => { quitting = true; if (db) externalBackup(); });
  app.on('window-all-closed', () => { if (quitting || setting('minimize_to_tray') !== '1') { closeSession(); app.quit(); } });
}
