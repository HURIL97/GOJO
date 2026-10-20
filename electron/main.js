// Processus principal Electron : fenêtre, base locale, IPC, impression, sauvegardes, synchronisation.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DB } = require('./db');
const { createServices, today, localStamp } = require('./services');
const { SyncEngine } = require('./sync');

process.removeAllListeners('warning');
app.commandLine.appendSwitch('lang', 'fr-FR'); // masque l'avertissement « SQLite experimental »

let win;
let db;
let services;
let sync;
let session = null; // utilisateur connecté

const DEV = process.env.HOSPITALIS_DEV === '1';
const dataDir = () => path.join(app.getPath('userData'), 'data');
const dbFile = () => path.join(dataDir(), 'hospitalis.db');

function initData() {
  fs.mkdirSync(dataDir(), { recursive: true });
  db = new DB(dbFile());
  services = createServices(db);
  sync = new SyncEngine(db, services.settings);
  sync.onStatus((s) => win && !win.isDestroyed() && win.webContents.send('sync:status', s));
  db.onChange((tables) => win && !win.isDestroyed() && win.webContents.send('data:changed', tables));
  sync.start();
  autoBackup();
}

// Sauvegarde automatique quotidienne (30 dernières conservées).
function autoBackup() {
  try {
    const dir = path.join(dataDir(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `hospitalis-${today()}.db`);
    if (!fs.existsSync(target)) {
      db.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(dir, f));
    }
  } catch (e) {
    console.error('Sauvegarde automatique impossible', e);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Hospitalis',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0b1020',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  if (DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && DEV) win.webContents.toggleDevTools();
  });
}

// ---- Droits ----
const PAGE_OF = {
  'hotel.': 'hotel', 'pos.': 'pos', 'stock.': 'stock', 'guests.': 'guests', 'cash.': 'cash',
  'expenses.': 'expenses', 'reports.': 'reports', 'users.': 'users', 'dashboard.': 'dashboard', 'settings.': 'settings',
};
function requireRight(channel) {
  if (!session) throw new Error('Session expirée, reconnectez-vous');
  const prefix = Object.keys(PAGE_OF).find((p) => channel.startsWith(p));
  if (!prefix) return;
  const rights = session.rights || [];
  if (rights.includes('*') || rights.includes(PAGE_OF[prefix])) return;
  throw new Error('Accès refusé pour votre rôle');
}

// Tables modifiables par l'écran générique, avec le droit requis.
const CRUD_RIGHTS = {
  room_types: 'settings', rooms: 'hotel', guests: 'guests', categories: 'stock', products: 'stock',
  dining_tables: 'settings', suppliers: 'stock', expenses: 'expenses',
};
const READ_TABLES = new Set([...Object.keys(CRUD_RIGHTS), 'reservations', 'folio_items', 'payments']);

function canWrite(table) {
  const rights = (session && session.rights) || [];
  const need = CRUD_RIGHTS[table];
  if (!need) return false;
  if (rights.includes('*')) return true;
  if (table === 'rooms' && rights.includes('hotel')) return true;
  if (table === 'guests' && rights.includes('hotel')) return true;
  return rights.includes(need);
}

function handle(channel, fn, { open = false } = {}) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      if (!open) requireRight(channel);
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

function htmlToFile(html, { pdf, title }) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.webContents.once('did-finish-load', async () => {
      try {
        if (pdf) {
          const { canceled, filePath } = await dialog.showSaveDialog(win, {
            defaultPath: path.join(app.getPath('documents'), `${title || 'document'}.pdf`),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          if (canceled) { w.close(); return resolve(null); }
          const data = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
          fs.writeFileSync(filePath, data);
          shell.openPath(filePath);
          w.close();
          resolve(filePath);
        } else {
          w.webContents.print({ printBackground: true }, (ok, reason) => {
            w.close();
            if (!ok && reason !== 'cancelled') reject(new Error(reason)); else resolve(ok);
          });
        }
      } catch (e) { w.close(); reject(e); }
    });
  });
}

function registerIpc() {
  const S = () => services;
  const u = () => session;

  // Session
  handle('auth.needsSetup', () => S().needsSetup(), { open: true });
  handle('auth.setup', ({ name, pin, hotel_name, demo }) => {
    if (!S().needsSetup()) throw new Error('Déjà configuré');
    const user = S().saveUser({ name, pin, role: 'admin', active: 1 });
    if (hotel_name) S().saveSettings({ hotel_name });
    session = S().login(pin);
    if (demo) S().seedDemo();
    return user;
  }, { open: true });
  handle('auth.login', (pin) => (session = S().login(pin)), { open: true });
  handle('auth.logout', () => { session = null; return true; }, { open: true });
  handle('app.info', () => ({ version: app.getVersion(), dataDir: dataDir(), deviceId: db.deviceId, today: today() }), { open: true });

  // Générique
  handle('db.list', (table, filter, order) => {
    if (!READ_TABLES.has(table)) throw new Error('Accès refusé');
    return db.list(table, filter, order);
  });
  handle('db.save', (table, row) => {
    if (!canWrite(table)) throw new Error('Accès refusé pour votre rôle');
    return db.save(table, row);
  });
  handle('db.remove', (table, id) => {
    if (!canWrite(table)) throw new Error('Accès refusé pour votre rôle');
    return db.remove(table, id);
  });

  // Paramètres (lecture pour tous, écriture admin)
  handle('settings.get', () => S().settings(), { open: true });
  handle('settings.save', (v) => { const r = S().saveSettings(v); sync.start(); return r; });
  handle('settings.syncNow', () => sync.run());
  handle('settings.syncTest', () => sync.test());
  handle('sync.status', () => ({ ...sync.state, pending: db.pendingCount() }), { open: true });
  handle('sync.now', () => sync.run(), { open: true });
  handle('settings.backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `hospitalis-sauvegarde-${today()}.db`),
      filters: [{ name: 'Base Hospitalis', extensions: ['db'] }],
    });
    if (canceled) return null;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    return filePath;
  });
  handle('settings.restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { filters: [{ name: 'Base Hospitalis', extensions: ['db'] }], properties: ['openFile'] });
    if (canceled || !filePaths[0]) return false;
    const { response } = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Annuler', 'Restaurer'], defaultId: 0, message: 'Remplacer toutes les données locales par cette sauvegarde ?', detail: 'L’application va redémarrer.' });
    if (response !== 1) return false;
    sync.stop();
    db.close();
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(dbFile() + ext)) fs.renameSync(dbFile() + ext, `${dbFile()}${ext}.avant-restauration`);
    fs.copyFileSync(filePaths[0], dbFile());
    app.relaunch();
    app.exit(0);
    return true;
  });
  handle('settings.openData', () => shell.openPath(dataDir()));

  // Utilisateurs
  handle('users.list', () => S().users());
  handle('users.save', (d) => S().saveUser(d));
  handle('pos.staff', () => S().users().filter((x) => x.active));

  // Hôtel
  handle('hotel.rooms', () => S().rooms());
  handle('hotel.roomBoard', () => S().roomBoard());
  handle('hotel.setRoomStatus', (id, status) => db.save('rooms', { id, status }));
  handle('hotel.available', (a, b, ex) => S().availableRooms(a, b, ex));
  handle('hotel.reservations', (f) => S().reservations(f));
  handle('hotel.saveReservation', (d) => S().saveReservation(d, u()));
  handle('hotel.checkIn', (id) => S().checkIn(id, u()));
  handle('hotel.checkOut', (id, opts) => S().checkOut(id, opts, u()));
  handle('hotel.setStatus', (id, st) => S().setReservationStatus(id, st, u()));
  handle('hotel.folio', (id) => S().folio(id));
  handle('hotel.addFolioItem', (d) => S().addFolioItem(d, u()));
  handle('hotel.removeFolioItem', (id) => db.remove('folio_items', id));
  handle('hotel.pay', (d) => S().pay({ ...d, source: 'hotel' }, u()));
  handle('hotel.planning', (from, days) => S().planning(from, days));
  handle('hotel.inHouse', () => S().reservations({ status: 'en_cours' }));
  handle('guests.list', (q) => S().guests(q));
  handle('guests.history', (id) => db.all(`SELECT r.*, rm.number room_number FROM reservations r LEFT JOIN rooms rm ON rm.id = r.room_id WHERE r.guest_id = ? AND r.deleted = 0 ORDER BY r.check_in DESC`, id));

  // Point de vente
  handle('pos.catalog', (outlet) => S().catalog(outlet));
  handle('pos.tables', (outlet) => S().tables(outlet));
  handle('pos.openOrders', (outlet) => S().openOrders(outlet));
  handle('pos.openOrder', (d) => S().openOrder(d, u()));
  handle('pos.order', (id) => S().order(id));
  handle('pos.addItem', (o, p, q) => S().addItem(o, p, q));
  handle('pos.updateItem', (id, patch) => S().updateItem(id, patch, u()));
  handle('pos.updateOrder', (id, patch) => S().updateOrder(id, patch));
  handle('pos.send', (id) => S().sendOrder(id));
  handle('pos.checkout', (id, pays) => S().checkoutOrder(id, pays, u()));
  handle('pos.chargeToRoom', (id, resId) => S().chargeToRoom(id, resId, u()));
  handle('pos.cancel', (id, reason) => S().cancelOrder(id, reason, u()));
  handle('pos.inHouse', () => S().reservations({ status: 'en_cours' }));
  handle('pos.history', (f) => S().orders(f));

  // Stocks
  handle('stock.list', () => S().stock());
  handle('stock.move', (d) => S().stockMove(d, u()));
  handle('stock.inventory', (c) => S().inventory(c, u()));
  handle('stock.moves', (pid) => S().stockMoves(pid));

  // Caisse, dépenses, rapports, tableau de bord
  handle('cash.payments', (f) => S().payments(f));
  handle('cash.z', (day) => S().zReport(day));
  handle('expenses.list', (f) => S().expenses(f));
  handle('dashboard.stats', (r) => S().dashboard(r));
  handle('reports.sales', (r) => S().salesReport(r));
  handle('reports.audit', () => S().auditLog());
  handle('reports.orders', (f) => S().orders(f));

  // Impression / export (ouverts à tout utilisateur connecté)
  handle('print.html', (html, opts = {}) => { if (!session) throw new Error('Non connecté'); return htmlToFile(html, opts); }, { open: true });
  handle('export.csv', async (name, rows) => {
    if (!session) throw new Error('Non connecté');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `${name}-${localStamp().slice(0, 10)}.csv`),
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });
    if (canceled) return null;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const esc = (v) => {
      if (v == null) return '';
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\r\n');
    fs.writeFileSync(filePath, csv, 'utf8');
    shell.openPath(filePath);
    return filePath;
  }, { open: true });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    initData();
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => { if (sync) sync.stop(); if (db) db.close(); app.quit(); });
}
