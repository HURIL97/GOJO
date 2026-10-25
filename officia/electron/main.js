// Processus principal : fenêtre, zone de notification, notifications Windows, IPC, PDF, sauvegardes.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, Notification, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DB, stamp } = require('./db');
const { createServices, today } = require('./services');
const { createMail } = require('./mail');

process.removeAllListeners('warning'); // masque l'avertissement « SQLite experimental »
app.commandLine.appendSwitch('lang', 'fr-FR');
app.setAppUserModelId('com.officia.app'); // nécessaire aux notifications Windows

const DEV = process.env.OFFICIA_DEV === '1';
let win;
let tray;
let db;
let S;
let M;
let quitting = false;
let unlocked = false;

const dataDir = () => path.join(app.getPath('userData'), 'data');
const filesDir = () => path.join(dataDir(), 'fichiers');
const dbFile = () => path.join(dataDir(), 'officia.db');
const iconPath = path.join(__dirname, 'icon.png');

// Mots de passe chiffrés par Windows (DPAPI) lorsque c'est disponible.
const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : `b64:${Buffer.from(s).toString('base64')}`);
const decrypt = (s) => {
  if (!s) return '';
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  return Buffer.from(s.slice(4), 'base64').toString();
};

function initData() {
  fs.mkdirSync(filesDir(), { recursive: true });
  db = new DB(dbFile());
  S = createServices(db);
  M = createMail(db, { encrypt, decrypt, filesDir: filesDir() });
  db.onChange((tables) => send('data:changed', tables));
  autoBackup();
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

function showWindow(link) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (link) send('navigate', link);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700, title: 'Officia', icon: iconPath,
    backgroundColor: '#0b0f1e', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) { win.maximize(); win.show(); } });
  if (DEV) win.loadURL('http://localhost:5174'); else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith('http://localhost:5174')) { e.preventDefault(); shell.openExternal(url); } });
  win.on('close', (e) => {
    if (!quitting && S.settings().minimize_to_tray === '1') { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('Officia');
  const menu = Menu.buildFromTemplate([
    { label: 'Ouvrir Officia', click: () => showWindow() },
    { label: 'Ma journée', click: () => showWindow({ page: 'home' }) },
    { label: 'Agenda', click: () => showWindow({ page: 'agenda' }) },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

// ---- Planificateur : échéances, rappels, messagerie ----
const LINK_PAGE = { meeting: 'meetings', event: 'agenda', reminder: 'tasks', tasks: 'tasks', courrier: 'courrier', calls: 'calls', mail: 'mail', home: 'home' };
function deliver(list) {
  if (!list.length) return;
  send('notifications:new', list);
  const set = S.settings();
  if (set.notify_native !== '1' || !Notification.isSupported()) return;
  for (const n of list.slice(0, 4)) {
    const notif = new Notification({ title: n.title, body: n.body || '', icon: iconPath, silent: set.notify_sound !== '1' });
    notif.on('click', () => { S.markRead(n.id); showWindow({ page: LINK_PAGE[n.link_type] || 'home', id: n.link_id, type: n.link_type }); });
    notif.show();
  }
}
function tick() { try { deliver(S.tick()); } catch (e) { console.error(e); } }

let mailBusy = false;
async function mailCycle() {
  if (mailBusy) return;
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
      if (!open && !unlocked) throw new Error('Application verrouillée');
      return { ok: true, data: await fn(...args) };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function registerIpc() {
  // Démarrage et verrouillage
  handle('app.info', () => ({ version: app.getVersion(), dataDir: dataDir(), today: today(), firstRun: S.isFirstRun() }), { open: true });
  handle('app.unlock', (pin) => { S.unlock(pin); unlocked = true; return true; }, { open: true });
  handle('app.autoUnlock', () => { if (S.settings().has_lock === '1') return false; unlocked = true; return true; }, { open: true });
  handle('app.lock', () => { if (S.settings().has_lock === '1') unlocked = false; return !unlocked; }, { open: true });
  handle('app.setup', ({ settings, demo }) => { if (!S.isFirstRun()) throw new Error('Déjà configuré'); S.saveSettings(settings); if (demo) S.seedDemo(); unlocked = true; return S.settings(); }, { open: true });
  handle('settings.get', () => S.settings(), { open: true });
  handle('settings.save', (v) => {
    const r = S.saveSettings(v);
    app.setLoginItemSettings({ openAtLogin: r.start_with_windows === '1', args: ['--hidden'] });
    scheduleMail();
    return r;
  });
  handle('settings.lockPin', (pin) => S.setLockPin(pin));

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
    if (draft.id) { const ex = db.byId('mails', draft.id); if (ex && ex.folder === 'drafts') db.remove('mails', draft.id); delete draft.id; }
    const r = await M.send(draft);
    if (draft.link_type === 'meeting' && draft.link_id && pdf && pdf.kind) S.setMeetingStatus(draft.link_id, pdf.kind === 'pv' ? 'pv_diffuse' : 'convoquee');
    return r;
  });
  handle('mail.sync', () => mailCycle());
  handle('mail.pickFiles', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (canceled) return [];
    return filePaths.map((p) => ({ filename: path.basename(p), path: p, size: fs.statSync(p).size }));
  });

  // Fichiers, impression, export
  handle('file.open', (p) => { if (p && fs.existsSync(p)) return shell.openPath(p); throw new Error('Fichier introuvable'); });
  handle('file.attach', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'odt'] }] });
    if (canceled || !filePaths[0]) return null;
    const dir = path.join(filesDir(), 'courrier');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${Date.now()}-${safeName(path.basename(filePaths[0]))}`);
    fs.copyFileSync(filePaths[0], target);
    return target;
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
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `officia-sauvegarde-${today()}.db`), filters: [{ name: 'Sauvegarde Officia', extensions: ['db'] }] });
    if (canceled) return null;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    return filePath;
  });
  handle('backup.restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'Sauvegarde Officia', extensions: ['db'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return false;
    const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, message: 'Remplacer toutes les données par cette sauvegarde ?', detail: 'L’application va redémarrer.' });
    if (response !== 1) return false;
    db.close();
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(dbFile() + ext)) fs.renameSync(dbFile() + ext, `${dbFile()}${ext}.avant-restauration`);
    fs.copyFileSync(filePaths[0], dbFile());
    quitting = true;
    app.relaunch();
    app.exit(0);
    return true;
  });
  handle('backup.openFolder', () => shell.openPath(dataDir()));
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
    tick();
    setInterval(tick, 30000);
    scheduleMail();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (quitting || S.settings().minimize_to_tray !== '1') { db.close(); app.quit(); } });
}
