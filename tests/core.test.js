// Tests de la logique métier et de la synchronisation bout en bout (deux postes + serveur).
process.env.SYNC_TOKEN = 'test-token-0123456789abcdef';
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hsync-'));

const test = require('node:test');
const assert = require('node:assert');
const { DB } = require('../electron/db');
const { createServices, today, addDays } = require('../electron/services');
const { SyncEngine } = require('../electron/sync');
const { server } = require('../server/server');

function station(settings = {}) {
  const db = new DB(':memory:');
  const S = createServices(db);
  S.saveUser({ name: 'Admin', pin: '1234', role: 'admin', active: 1 });
  const user = S.login('1234');
  S.saveSettings(settings);
  return { db, S, user };
}

test('réservation, conflit, check-in, folio, check-out', () => {
  const { db, S, user } = station({ city_tax: '1000' });
  const type = db.save('room_types', { name: 'Std', base_price: 20000 });
  const room = db.save('rooms', { number: '101', type_id: type.id, status: 'libre' });
  const d = today();
  const r = S.saveReservation({ room_id: room.id, check_in: d, check_out: addDays(d, 2), rate: 20000, adults: 2, guest: { last_name: 'Diallo' } }, user);
  assert.throws(() => S.saveReservation({ room_id: room.id, check_in: addDays(d, 1), check_out: addDays(d, 3), rate: 1, guest: { last_name: 'X' } }, user), /déjà réservée/);
  S.checkIn(r.id, user);
  assert.equal(db.byId('rooms', room.id).status, 'occupee');
  let f = S.folio(r.id);
  assert.equal(f.total, 2 * 20000 + 2 * 2 * 1000);
  assert.throws(() => S.checkOut(r.id, {}, user), /Solde/);
  S.pay({ reservation_id: r.id, amount: f.balance, method: 'especes', source: 'hotel' }, user);
  f = S.checkOut(r.id, {}, user);
  assert.equal(f.balance, 0);
  assert.equal(db.byId('rooms', room.id).status, 'sale');
});

test('point de vente : commande, paiement, stock, transfert chambre', () => {
  const { db, S, user } = station();
  const cat = db.save('categories', { name: 'Bières', outlet: 'both' });
  const beer = db.save('products', { name: 'Bière', category_id: cat.id, price: 1500, cost: 700, track_stock: 1, outlet: 'both', active: 1 });
  S.stockMove({ product_id: beer.id, qty: 24, type: 'entree', unit_cost: 700 }, user);
  const table = db.save('dining_tables', { name: 'T1', outlet: 'restaurant' });
  let o = S.openOrder({ outlet: 'restaurant', table_id: table.id }, user);
  S.addItem(o.id, beer.id, 2);
  o = S.addItem(o.id, beer.id, 1);
  assert.equal(o.items.length, 1);
  assert.equal(o.total, 4500);
  assert.throws(() => S.checkoutOrder(o.id, [{ method: 'especes', amount: 4000 }], user), /insuffisant/);
  S.checkoutOrder(o.id, [{ method: 'especes', amount: 5000 }], user);
  assert.equal(db.get('SELECT qty FROM stock_levels WHERE product_id = ?', beer.id).qty, 21);
  assert.equal(db.list('payments', { order_id: o.id })[0].amount, 4500); // monnaie rendue exclue

  const type = db.save('room_types', { name: 'Std', base_price: 10000 });
  const room = db.save('rooms', { number: '1', type_id: type.id });
  const r = S.saveReservation({ room_id: room.id, check_in: today(), check_out: addDays(today(), 1), rate: 10000, guest: { last_name: 'K' } }, user);
  S.checkIn(r.id, user);
  const o2 = S.openOrder({ outlet: 'bar' }, user);
  S.addItem(o2.id, beer.id, 2);
  S.chargeToRoom(o2.id, r.id, user);
  assert.equal(S.folio(r.id).total, 10000 + 3000);

  S.inventory([{ product_id: beer.id, counted: 15 }], user);
  assert.equal(db.get('SELECT qty FROM stock_levels WHERE product_id = ?', beer.id).qty, 15);

  const dash = S.dashboard({});
  assert.equal(dash.kpi.tickets, 2);
  assert.equal(dash.split.bar, 3000);
  assert.equal(dash.split.restaurant, 4500);
});

test('données de démonstration + tableau de bord', () => {
  const { S } = station();
  S.seedDemo();
  const d = S.dashboard({});
  assert.ok(d.kpi.revenue > 0);
  assert.equal(d.series.length, 30);
  assert.equal(d.forecast.length, 14);
});

test('synchronisation entre deux postes via le serveur', async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const cfg = { sync_url: url, sync_token: process.env.SYNC_TOKEN };
  const A = station(cfg);
  const B = station(cfg);
  const syncA = new SyncEngine(A.db, A.S.settings);
  const syncB = new SyncEngine(B.db, B.S.settings);

  const g = A.db.save('guests', { last_name: 'Traoré', first_name: 'Fatou' });
  let st = await syncA.run();
  assert.equal(st.status, 'ok', st.lastError);
  st = await syncB.run();
  assert.equal(st.status, 'ok', st.lastError);
  assert.equal(B.db.byId('guests', g.id).last_name, 'Traoré');
  assert.equal(B.db.pendingCount(), 0);

  // Modification sur B puis renvoi vers A (dernier écrit gagne).
  await new Promise((r) => setTimeout(r, 5));
  B.db.save('guests', { id: g.id, phone: '0700000000' });
  await syncB.run();
  await syncA.run();
  assert.equal(A.db.byId('guests', g.id).phone, '0700000000');

  // Hors ligne : les écritures s'accumulent puis partent au retour du réseau.
  const bad = new SyncEngine(A.db, () => ({ ...A.S.settings(), sync_url: 'http://127.0.0.1:1' }));
  A.db.save('guests', { last_name: 'Hors-ligne' });
  st = await bad.run();
  assert.equal(st.status, 'error');
  assert.ok(A.db.pendingCount() > 0);
  await syncA.run();
  assert.equal(A.db.pendingCount(), 0);
  await syncB.run();
  assert.ok(B.db.list('guests').some((x) => x.last_name === 'Hors-ligne'));

  // Mauvais jeton refusé.
  const intruder = new SyncEngine(B.db, () => ({ ...B.S.settings(), sync_token: 'nope' }));
  st = await intruder.run();
  assert.match(st.lastError, /Jeton/);
  server.close();
});
