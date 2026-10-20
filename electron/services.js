// Logique métier : hôtel, point de vente bar/restaurant, stocks, caisse, tableau de bord, rapports.
const crypto = require('node:crypto');
const { uuid } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
// Horodatage local (les rapports se font en heure locale de l'établissement).
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const today = () => localStamp().slice(0, 10);
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localStamp(d).slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function hashPin(pin, salt = crypto.randomBytes(8).toString('hex')) {
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPin(pin, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}
const shortCode = (prefix) =>
  `${prefix}${localStamp().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

const DEFAULT_SETTINGS = {
  hotel_name: 'Mon Hôtel',
  address: '',
  phone: '',
  email: '',
  tax_id: '',
  currency: 'FCFA',
  vat_rate: '18',
  city_tax: '0',
  checkout_hour: '12:00',
  invoice_footer: 'Merci de votre visite et à bientôt !',
  sync_url: '',
  sync_token: '',
  sync_interval: '30',
  device_name: '',
};

const LOCAL_KEYS = ['sync_url', 'sync_token', 'sync_interval', 'device_name'];

const ROLES = {
  admin: ['*'],
  manager: ['dashboard', 'hotel', 'pos', 'stock', 'guests', 'cash', 'expenses', 'reports', 'users'],
  reception: ['dashboard', 'hotel', 'guests', 'cash', 'pos'],
  serveur: ['pos'],
  barman: ['pos', 'stock'],
  caissier: ['pos', 'cash'],
};

function createServices(db) {
  const S = {};
  const audit = (user, action, entity, entity_id, details) =>
    db.save('audit_log', { date: localStamp(), user_id: user && user.id, action, entity, entity_id, details: details ? JSON.stringify(details) : null });

  // ---------- Paramètres ----------
  // Les réglages propres au poste (connexion au VPS, nom du poste) restent locaux et ne sont pas synchronisés.
  S.settings = () => {
    const out = { ...DEFAULT_SETTINGS };
    for (const r of db.list('settings')) if (!LOCAL_KEYS.includes(r.key)) out[r.key] = r.value;
    for (const k of LOCAL_KEYS) { const v = db.meta(`setting:${k}`); if (v != null) out[k] = v; }
    return out;
  };
  S.saveSettings = (values) =>
    db.tx(() => {
      for (const [key, value] of Object.entries(values)) {
        const v = value == null ? '' : String(value);
        if (LOCAL_KEYS.includes(key)) db.setMeta(`setting:${key}`, v);
        else if (key in DEFAULT_SETTINGS) db.save('settings', { id: `set_${key}`, key, value: v });
      }
      return S.settings();
    });

  // ---------- Authentification ----------
  S.needsSetup = () => db.get('SELECT COUNT(*) c FROM users WHERE deleted = 0').c === 0;
  S.login = (pin) => {
    const users = db.list('users', { active: 1 });
    const u = users.find((x) => checkPin(pin, x.pin_hash));
    if (!u) throw new Error('Code PIN incorrect');
    audit(u, 'connexion', 'users', u.id);
    return S.publicUser(u);
  };
  S.publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, active: u.active, phone: u.phone, rights: ROLES[u.role] || [] });
  S.users = () => db.list('users', {}, 'name').map(S.publicUser);
  S.saveUser = (data) => {
    const row = { id: data.id, name: data.name, role: data.role, phone: data.phone, active: data.active ? 1 : 0 };
    if (data.pin) {
      if (!/^\d{4,8}$/.test(data.pin)) throw new Error('Le PIN doit contenir 4 à 8 chiffres');
      const clash = db.list('users').find((x) => x.id !== data.id && checkPin(data.pin, x.pin_hash));
      if (clash) throw new Error('Ce PIN est déjà utilisé');
      row.pin_hash = hashPin(data.pin);
    } else if (!data.id) throw new Error('PIN requis');
    return S.publicUser(db.save('users', row));
  };

  // ---------- Hôtel ----------
  S.rooms = () =>
    db.all(`SELECT r.*, t.name AS type_name, t.color AS type_color, COALESCE(NULLIF(NULLIF(r.price, ''), 0), t.base_price) AS rate,
              t.capacity
            FROM rooms r LEFT JOIN room_types t ON t.id = r.type_id
            WHERE r.deleted = 0 ORDER BY CAST(r.number AS INTEGER), r.number`);

  S.roomBoard = () => {
    const d = today();
    const rooms = S.rooms();
    const current = db.all(`SELECT r.*, g.first_name, g.last_name FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        WHERE r.deleted = 0 AND r.status = 'en_cours'`);
    const arriving = db.all(`SELECT r.*, g.first_name, g.last_name FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id
        WHERE r.deleted = 0 AND r.status = 'confirmee' AND r.check_in <= ?`, d);
    return rooms.map((room) => ({
      ...room,
      current: current.find((x) => x.room_id === room.id) || null,
      arriving: arriving.find((x) => x.room_id === room.id) || null,
    }));
  };

  S.conflicts = (room_id, check_in, check_out, excludeId) =>
    db.all(`SELECT * FROM reservations WHERE deleted = 0 AND room_id = ? AND id <> ?
              AND status IN ('confirmee','en_cours') AND check_in < ? AND check_out > ?`,
    room_id, excludeId || '', check_out, check_in);

  S.availableRooms = (check_in, check_out, excludeId) =>
    S.rooms().filter((r) => r.status !== 'maintenance' && S.conflicts(r.id, check_in, check_out, excludeId).length === 0);

  S.saveReservation = (data, user) =>
    db.tx(() => {
      if (!data.room_id) throw new Error('Choisissez une chambre');
      if (!data.check_in || !data.check_out || data.check_out <= data.check_in)
        throw new Error('La date de départ doit être après la date d’arrivée');
      const clash = S.conflicts(data.room_id, data.check_in, data.check_out, data.id);
      if (clash.length) throw new Error(`Chambre déjà réservée sur cette période (${clash[0].code})`);
      let guest_id = data.guest_id;
      if (!guest_id && data.guest) {
        if (!data.guest.last_name && !data.guest.first_name) throw new Error('Indiquez le nom du client');
        guest_id = db.save('guests', data.guest).id;
      }
      if (!guest_id) throw new Error('Indiquez le client');
      const prev = data.id ? db.byId('reservations', data.id) : null;
      const row = {
        id: data.id, guest_id, room_id: data.room_id, check_in: data.check_in, check_out: data.check_out,
        adults: data.adults, children: data.children, rate: round(data.rate), source: data.source, notes: data.notes,
      };
      if (!prev) Object.assign(row, { code: shortCode('R'), status: 'confirmee', user_id: user && user.id });
      const res = db.save('reservations', row);
      // Un changement de chambre pendant le séjour libère l'ancienne.
      if (prev && prev.status === 'en_cours' && prev.room_id !== data.room_id) {
        db.save('rooms', { id: prev.room_id, status: 'sale' });
        db.save('rooms', { id: data.room_id, status: 'occupee' });
      }
      audit(user, prev ? 'modification' : 'creation', 'reservations', res.id, { code: res.code });
      return res;
    });

  S.checkIn = (id, user) =>
    db.tx(() => {
      const r = db.byId('reservations', id);
      if (!r) throw new Error('Réservation introuvable');
      if (r.status !== 'confirmee') throw new Error('Cette réservation ne peut pas être enregistrée');
      const occupied = db.get(`SELECT code FROM reservations WHERE deleted = 0 AND status = 'en_cours' AND room_id = ?`, r.room_id);
      if (occupied) throw new Error(`Chambre encore occupée (${occupied.code})`);
      const d = today();
      const patch = { id, status: 'en_cours', checked_in_at: localStamp() };
      if (r.check_in > d) { // Arrivée anticipée : on décale la date d'arrivée.
        patch.check_in = d;
      }
      db.save('reservations', patch);
      db.save('rooms', { id: r.room_id, status: 'occupee' });
      audit(user, 'check-in', 'reservations', id);
      return db.byId('reservations', id);
    });

  S.folio = (id) => {
    const r = db.byId('reservations', id);
    if (!r) throw new Error('Réservation introuvable');
    const set = S.settings();
    const guest = db.byId('guests', r.guest_id);
    const room = S.rooms().find((x) => x.id === r.room_id);
    const end = r.status === 'en_cours' && today() > r.check_out ? today() : r.check_out;
    const nights = Math.max(1, daysBetween(r.check_in, end));
    const lines = [{ label: `Hébergement — chambre ${room ? room.number : ''} (${nights} nuit${nights > 1 ? 's' : ''})`,
      qty: nights, unit_price: r.rate, amount: round(nights * r.rate), kind: 'hebergement', date: r.check_in }];
    const cityTax = Number(set.city_tax) || 0;
    if (cityTax > 0) {
      const persons = Number(r.adults) || 1;
      lines.push({ label: `Taxe de séjour (${persons} pers. × ${nights} nuit${nights > 1 ? 's' : ''})`,
        qty: persons * nights, unit_price: cityTax, amount: round(persons * nights * cityTax), kind: 'taxe', date: r.check_in });
    }
    const items = db.list('folio_items', { reservation_id: id }, 'date');
    const payments = db.list('payments', { reservation_id: id }, 'date').filter((p) => p.method !== 'chambre');
    const all = [...lines, ...items];
    const total = round(all.reduce((s, l) => s + Number(l.amount || 0), 0));
    const paid = round(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
    return { reservation: r, guest, room, nights, lines: all, items, payments, total, paid, balance: round(total - paid) };
  };

  S.addFolioItem = (data, user) => {
    const amount = round((Number(data.qty) || 1) * (Number(data.unit_price) || 0));
    const it = db.save('folio_items', { ...data, qty: Number(data.qty) || 1, amount, date: data.date || localStamp(), kind: data.kind || 'service', user_id: user && user.id });
    audit(user, 'ajout folio', 'folio_items', it.id, { label: it.label, amount });
    return it;
  };

  S.pay = (data, user) => {
    if (!(Number(data.amount) > 0)) throw new Error('Montant invalide');
    const p = db.save('payments', { ...data, amount: round(data.amount), date: localStamp(), user_id: user && user.id });
    audit(user, 'encaissement', 'payments', p.id, { amount: p.amount, method: p.method });
    return p;
  };

  S.checkOut = (id, { force } = {}, user) =>
    db.tx(() => {
      const f = S.folio(id);
      if (f.reservation.status !== 'en_cours') throw new Error('Le client n’est pas enregistré dans la chambre');
      if (f.balance > 0.009 && !force) throw new Error(`Solde restant dû : ${f.balance}`);
      const d = today();
      db.save('reservations', { id, status: 'partie', checked_out_at: localStamp(), check_out: d > f.reservation.check_in ? d : f.reservation.check_out });
      db.save('rooms', { id: f.reservation.room_id, status: 'sale' });
      audit(user, 'check-out', 'reservations', id, { balance: f.balance });
      return S.folio(id);
    });

  S.setReservationStatus = (id, status, user) => {
    if (!['annulee', 'no_show', 'confirmee'].includes(status)) throw new Error('Statut invalide');
    const r = db.byId('reservations', id);
    if (r.status === 'en_cours' || r.status === 'partie') throw new Error('Séjour déjà commencé');
    db.save('reservations', { id, status });
    audit(user, status, 'reservations', id);
    return db.byId('reservations', id);
  };

  S.reservations = ({ from, to, status, q } = {}) => {
    const where = ['r.deleted = 0'];
    const p = [];
    if (from) { where.push('r.check_out >= ?'); p.push(from); }
    if (to) { where.push('r.check_in <= ?'); p.push(to); }
    if (status) { where.push('r.status = ?'); p.push(status); }
    if (q) {
      where.push(`(r.code LIKE ? OR g.last_name LIKE ? OR g.first_name LIKE ? OR g.phone LIKE ? OR rm.number LIKE ?)`);
      p.push(...Array(5).fill(`%${q}%`));
    }
    return db.all(`SELECT r.*, g.first_name, g.last_name, g.phone, g.vip, rm.number AS room_number
        FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE ${where.join(' AND ')} ORDER BY r.check_in DESC LIMIT 1000`, ...p);
  };

  S.planning = (from, days = 21) => {
    const to = addDays(from, days);
    return {
      from, to, days,
      rooms: S.rooms(),
      reservations: db.all(`SELECT r.*, g.first_name, g.last_name, g.vip FROM reservations r
          LEFT JOIN guests g ON g.id = r.guest_id
          WHERE r.deleted = 0 AND r.status IN ('confirmee','en_cours','partie') AND r.check_in < ? AND r.check_out > ?`, to, from),
    };
  };

  S.guests = (q) => {
    const p = [];
    let where = 'g.deleted = 0';
    if (q) { where += ' AND (g.last_name LIKE ? OR g.first_name LIKE ? OR g.phone LIKE ? OR g.email LIKE ? OR g.company LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
    return db.all(`SELECT g.*,
        (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.deleted = 0 AND r.status IN ('en_cours','partie')) AS stays,
        (SELECT MAX(check_in) FROM reservations r WHERE r.guest_id = g.id AND r.deleted = 0) AS last_stay,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN reservations r ON r.id = p.reservation_id
            WHERE r.guest_id = g.id AND p.deleted = 0 AND p.method <> 'chambre') AS spent
      FROM guests g WHERE ${where} ORDER BY g.last_name, g.first_name LIMIT 1000`, ...p);
  };

  // ---------- Point de vente (bar / restaurant) ----------
  S.catalog = (outlet) => {
    const cats = db.list('categories', {}, 'sort').filter((c) => !outlet || c.outlet === 'both' || c.outlet === outlet);
    const prods = db.all(`SELECT p.*, COALESCE(s.qty,0) AS stock FROM products p
        LEFT JOIN stock_levels s ON s.product_id = p.id
        WHERE p.deleted = 0 AND p.active = 1 ORDER BY p.name`)
      .filter((p) => !outlet || p.outlet === 'both' || p.outlet === outlet);
    return { categories: cats, products: prods };
  };

  S.tables = (outlet) =>
    db.all(`SELECT t.*, o.id AS order_id, o.total AS order_total, o.opened_at, o.covers,
              (SELECT name FROM users u WHERE u.id = o.server_id) AS server_name
            FROM dining_tables t
            LEFT JOIN orders o ON o.table_id = t.id AND o.deleted = 0 AND o.status = 'ouverte'
            WHERE t.deleted = 0 AND t.outlet = ? ORDER BY t.sort, t.name`, outlet);

  S.openOrders = (outlet) =>
    db.all(`SELECT o.*, t.name AS table_name, (SELECT name FROM users u WHERE u.id = o.server_id) AS server_name
            FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id
            WHERE o.deleted = 0 AND o.status = 'ouverte' ${outlet ? 'AND o.outlet = ?' : ''} ORDER BY o.opened_at`,
    ...(outlet ? [outlet] : []));

  S.openOrder = ({ outlet, table_id, customer, covers }, user) => {
    if (table_id) {
      const ex = db.get(`SELECT id FROM orders WHERE deleted = 0 AND status = 'ouverte' AND table_id = ?`, table_id);
      if (ex) return S.order(ex.id);
    }
    const o = db.save('orders', {
      number: shortCode(outlet === 'bar' ? 'B' : 'T'), outlet, table_id: table_id || null, customer: customer || null,
      covers: covers || 1, status: 'ouverte', server_id: user && user.id, opened_at: localStamp(),
    });
    return S.order(o.id);
  };

  S.order = (id) => {
    const o = db.byId('orders', id);
    if (!o) throw new Error('Commande introuvable');
    const items = db.list('order_items', { order_id: id }, 'created_at');
    const table = o.table_id ? db.byId('dining_tables', o.table_id) : null;
    const payments = db.list('payments', { order_id: id });
    return { ...o, items, table, payments };
  };

  const recalc = (order_id) => {
    const o = db.byId('orders', order_id);
    const sub = round(db.get(`SELECT COALESCE(SUM(amount),0) s FROM order_items WHERE order_id = ? AND deleted = 0`, order_id).s);
    const total = round(Math.max(0, sub - (Number(o.discount) || 0)));
    db.save('orders', { id: order_id, subtotal: sub, total });
    return S.order(order_id);
  };

  const assertOpen = (order_id) => {
    const o = db.byId('orders', order_id);
    if (!o || o.status !== 'ouverte') throw new Error('Commande clôturée');
    return o;
  };

  S.addItem = (order_id, product_id, qty = 1) =>
    db.tx(() => {
      assertOpen(order_id);
      const p = db.byId('products', product_id);
      if (!p) throw new Error('Produit introuvable');
      const same = db.get(`SELECT * FROM order_items WHERE order_id = ? AND product_id = ? AND deleted = 0 AND sent = 0 AND (note IS NULL OR note = '')`, order_id, product_id);
      if (same) {
        const q = Number(same.qty) + qty;
        db.save('order_items', { id: same.id, qty: q, amount: round(q * same.unit_price) });
      } else {
        db.save('order_items', { order_id, product_id, name: p.name, qty, unit_price: p.price, cost: p.cost, amount: round(qty * p.price), created_at: localStamp() });
      }
      return recalc(order_id);
    });

  S.updateItem = (item_id, patch, user) =>
    db.tx(() => {
      const it = db.byId('order_items', item_id);
      assertOpen(it.order_id);
      const qty = patch.qty != null ? Number(patch.qty) : Number(it.qty);
      if (qty <= 0) {
        db.remove('order_items', item_id);
        if (it.sent) audit(user, 'annulation article', 'order_items', item_id, { name: it.name, qty: it.qty });
      } else {
        const unit = patch.unit_price != null ? Number(patch.unit_price) : it.unit_price;
        db.save('order_items', { id: item_id, qty, unit_price: unit, amount: round(qty * unit), note: patch.note != null ? patch.note : it.note });
      }
      return recalc(it.order_id);
    });

  S.updateOrder = (id, patch) => {
    assertOpen(id);
    const allowed = {};
    for (const k of ['discount', 'covers', 'customer', 'notes', 'table_id']) if (patch[k] !== undefined) allowed[k] = patch[k];
    db.save('orders', { id, ...allowed });
    return recalc(id);
  };

  // Envoi en cuisine/bar : renvoie les articles à imprimer sur le bon.
  S.sendOrder = (id) =>
    db.tx(() => {
      const items = db.list('order_items', { order_id: id, sent: 0 });
      for (const it of items) db.save('order_items', { id: it.id, sent: 1 });
      return { order: S.order(id), sent: items };
    });

  const consumeStock = (order, user) => {
    const items = db.list('order_items', { order_id: order.id });
    for (const it of items) {
      const p = db.byId('products', it.product_id);
      if (p && p.track_stock) {
        db.save('stock_moves', { product_id: p.id, date: localStamp(), qty: -Number(it.qty), type: 'vente', unit_cost: p.cost, order_id: order.id, user_id: user && user.id });
      }
    }
  };

  S.checkoutOrder = (id, payments, user) =>
    db.tx(() => {
      const o = assertOpen(id);
      const items = db.list('order_items', { order_id: id });
      if (!items.length) throw new Error('La commande est vide');
      const total = Number(o.total);
      const paid = round(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
      if (paid + 0.009 < total) throw new Error(`Montant insuffisant : ${paid} / ${total}`);
      // On n'enregistre que le montant dû (la monnaie rendue n'est pas un encaissement).
      let left = total;
      for (const p of payments) {
        const amt = round(Math.min(Number(p.amount), left));
        if (amt <= 0) continue;
        left = round(left - amt);
        db.save('payments', { date: localStamp(), amount: amt, method: p.method, reference: p.reference || null, source: o.outlet, order_id: id, user_id: user && user.id });
      }
      db.save('orders', { id, status: 'payee', closed_at: localStamp() });
      consumeStock(o, user);
      audit(user, 'encaissement commande', 'orders', id, { total });
      return S.order(id);
    });

  S.chargeToRoom = (id, reservation_id, user) =>
    db.tx(() => {
      const o = assertOpen(id);
      const r = db.byId('reservations', reservation_id);
      if (!r || r.status !== 'en_cours') throw new Error('Le client doit être présent (séjour en cours)');
      if (!db.list('order_items', { order_id: id }).length) throw new Error('La commande est vide');
      const label = `${o.outlet === 'bar' ? 'Bar' : 'Restaurant'} — ticket ${o.number}`;
      db.save('folio_items', { reservation_id, date: localStamp(), label, qty: 1, unit_price: o.total, amount: o.total, kind: o.outlet, order_id: id, user_id: user && user.id });
      db.save('orders', { id, status: 'chambre', reservation_id, closed_at: localStamp() });
      consumeStock(o, user);
      audit(user, 'transfert chambre', 'orders', id, { reservation_id, total: o.total });
      return S.order(id);
    });

  S.cancelOrder = (id, reason, user) =>
    db.tx(() => {
      assertOpen(id);
      db.save('orders', { id, status: 'annulee', cancel_reason: reason || '', closed_at: localStamp() });
      audit(user, 'annulation commande', 'orders', id, { reason });
      return S.order(id);
    });

  S.orders = ({ from, to, outlet, status } = {}) => {
    const where = ['o.deleted = 0'];
    const p = [];
    if (from) { where.push('substr(COALESCE(o.closed_at, o.opened_at),1,10) >= ?'); p.push(from); }
    if (to) { where.push('substr(COALESCE(o.closed_at, o.opened_at),1,10) <= ?'); p.push(to); }
    if (outlet) { where.push('o.outlet = ?'); p.push(outlet); }
    if (status) { where.push('o.status = ?'); p.push(status); }
    return db.all(`SELECT o.*, t.name AS table_name, u.name AS server_name FROM orders o
        LEFT JOIN dining_tables t ON t.id = o.table_id LEFT JOIN users u ON u.id = o.server_id
        WHERE ${where.join(' AND ')} ORDER BY COALESCE(o.closed_at, o.opened_at) DESC LIMIT 2000`, ...p);
  };

  // ---------- Stocks ----------
  S.stock = () =>
    db.all(`SELECT p.*, c.name AS category_name, COALESCE(s.qty,0) AS stock,
              (COALESCE(s.qty,0) * p.cost) AS value, sp.name AS supplier_name
            FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id
            LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers sp ON sp.id = p.supplier_id
            WHERE p.deleted = 0 ORDER BY c.sort, p.name`);

  S.stockMove = (data, user) => {
    const qty = Number(data.qty);
    if (!qty) throw new Error('Quantité invalide');
    const signed = ['perte', 'sortie'].includes(data.type) ? -Math.abs(qty) : data.type === 'entree' ? Math.abs(qty) : qty;
    const m = db.save('stock_moves', { product_id: data.product_id, date: localStamp(), qty: signed, type: data.type, unit_cost: Number(data.unit_cost) || 0, note: data.note, supplier_id: data.supplier_id, user_id: user && user.id });
    if (data.type === 'entree' && Number(data.unit_cost) > 0) db.save('products', { id: data.product_id, cost: Number(data.unit_cost) });
    return m;
  };

  // Inventaire : on enregistre l'écart entre le compté et le théorique.
  S.inventory = (counts, user) =>
    db.tx(() => {
      let n = 0;
      for (const { product_id, counted } of counts) {
        const cur = db.get('SELECT qty FROM stock_levels WHERE product_id = ?', product_id);
        const diff = round(Number(counted) - (cur ? cur.qty : 0));
        if (diff !== 0) {
          db.save('stock_moves', { product_id, date: localStamp(), qty: diff, type: 'inventaire', note: `Inventaire : compté ${counted}`, user_id: user && user.id });
          n++;
        }
      }
      audit(user, 'inventaire', 'stock_moves', null, { lines: n });
      return n;
    });

  S.stockMoves = (product_id) =>
    db.all(`SELECT m.*, p.name AS product_name, u.name AS user_name FROM stock_moves m
        LEFT JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
        WHERE m.deleted = 0 ${product_id ? 'AND m.product_id = ?' : ''} ORDER BY m.date DESC LIMIT 500`,
    ...(product_id ? [product_id] : []));

  // ---------- Caisse ----------
  S.payments = ({ from, to, method, source } = {}) => {
    const where = ['p.deleted = 0'];
    const prm = [];
    if (from) { where.push('substr(p.date,1,10) >= ?'); prm.push(from); }
    if (to) { where.push('substr(p.date,1,10) <= ?'); prm.push(to); }
    if (method) { where.push('p.method = ?'); prm.push(method); }
    if (source) { where.push('p.source = ?'); prm.push(source); }
    return db.all(`SELECT p.*, u.name AS user_name, o.number AS order_number, r.code AS reservation_code
        FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN orders o ON o.id = p.order_id
        LEFT JOIN reservations r ON r.id = p.reservation_id
        WHERE ${where.join(' AND ')} ORDER BY p.date DESC LIMIT 5000`, ...prm);
  };

  S.zReport = (day = today()) => {
    const pays = S.payments({ from: day, to: day });
    const byMethod = {};
    const bySource = {};
    for (const p of pays) {
      byMethod[p.method] = round((byMethod[p.method] || 0) + p.amount);
      bySource[p.source] = round((bySource[p.source] || 0) + p.amount);
    }
    const expenses = db.all(`SELECT * FROM expenses WHERE deleted = 0 AND substr(date,1,10) = ?`, day);
    const cashExpenses = round(expenses.filter((e) => e.method === 'especes').reduce((s, e) => s + e.amount, 0));
    const orders = db.all(`SELECT status, COUNT(*) n, COALESCE(SUM(total),0) t FROM orders WHERE deleted = 0
        AND substr(closed_at,1,10) = ? GROUP BY status`, day);
    const cancelled = db.all(`SELECT o.number, o.total, o.cancel_reason, u.name AS user_name FROM orders o
        LEFT JOIN users u ON u.id = o.server_id WHERE o.deleted = 0 AND o.status = 'annulee' AND substr(o.closed_at,1,10) = ?`, day);
    return {
      day, payments: pays.length, total: round(pays.reduce((s, p) => s + p.amount, 0)), byMethod, bySource,
      expenses: round(expenses.reduce((s, e) => s + e.amount, 0)), cashExpenses,
      cashInDrawer: round((byMethod.especes || 0) - cashExpenses), orders, cancelled,
    };
  };

  S.expenses = ({ from, to } = {}) => {
    const where = ['e.deleted = 0'];
    const p = [];
    if (from) { where.push('substr(e.date,1,10) >= ?'); p.push(from); }
    if (to) { where.push('substr(e.date,1,10) <= ?'); p.push(to); }
    return db.all(`SELECT e.*, s.name AS supplier_name FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
        WHERE ${where.join(' AND ')} ORDER BY e.date DESC LIMIT 5000`, ...p);
  };

  // ---------- Tableau de bord ----------
  // Revenu hébergement d'un jour = somme des tarifs des séjours qui couvrent cette nuit.
  const roomNights = (from, to, withBooked = false) => {
    const st = withBooked ? "'en_cours','partie','confirmee'" : "'en_cours','partie'";
    const rows = db.all(`SELECT check_in, check_out, rate FROM reservations WHERE deleted = 0
        AND status IN (${st}) AND check_in <= ? AND check_out > ?`, to, from);
    const perDay = {};
    for (let d = from; d <= to; d = addDays(d, 1)) perDay[d] = { nights: 0, revenue: 0 };
    for (const r of rows) {
      for (let d = r.check_in < from ? from : r.check_in; d < r.check_out && d <= to; d = addDays(d, 1)) {
        perDay[d].nights += 1;
        perDay[d].revenue += Number(r.rate) || 0;
      }
    }
    return perDay;
  };

  const activityRevenue = (from, to) => {
    const nights = roomNights(from, to);
    const days = {};
    for (const [d, v] of Object.entries(nights)) days[d] = { day: d, hebergement: v.revenue, nights: v.nights, restaurant: 0, bar: 0, services: 0 };
    const sales = db.all(`SELECT substr(closed_at,1,10) d, outlet, SUM(total) t FROM orders WHERE deleted = 0
        AND status IN ('payee','chambre') AND substr(closed_at,1,10) BETWEEN ? AND ? GROUP BY d, outlet`, from, to);
    for (const s of sales) if (days[s.d]) days[s.d][s.outlet === 'bar' ? 'bar' : 'restaurant'] += s.t;
    const svc = db.all(`SELECT substr(date,1,10) d, SUM(amount) t FROM folio_items WHERE deleted = 0
        AND kind NOT IN ('bar','restaurant','hebergement') AND substr(date,1,10) BETWEEN ? AND ? GROUP BY d`, from, to);
    for (const s of svc) if (days[s.d]) days[s.d].services += s.t;
    return Object.values(days).map((d) => ({ ...d, total: round(d.hebergement + d.restaurant + d.bar + d.services) }));
  };

  const sumRange = (from, to) => {
    const days = activityRevenue(from, to);
    const t = { hebergement: 0, restaurant: 0, bar: 0, services: 0, total: 0, nights: 0 };
    for (const d of days) for (const k of Object.keys(t)) t[k] += d[k];
    for (const k of Object.keys(t)) t[k] = round(t[k]);
    return t;
  };

  S.dashboard = ({ from, to } = {}) => {
    const d = today();
    from = from || addDays(d, -29);
    to = to || d;
    const span = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const rooms = S.rooms();
    const roomCount = rooms.filter((r) => r.status !== 'maintenance').length || 1;

    const series = activityRevenue(from, to);
    const cur = sumRange(from, to);
    const prev = sumRange(prevFrom, prevTo);
    const occupancy = round((cur.nights / (roomCount * span)) * 100);
    const prevOcc = round((prev.nights / (roomCount * span)) * 100);
    const adr = cur.nights ? round(cur.hebergement / cur.nights) : 0;
    const prevAdr = prev.nights ? round(prev.hebergement / prev.nights) : 0;
    const revpar = round(cur.hebergement / (roomCount * span));
    const prevRevpar = round(prev.hebergement / (roomCount * span));

    const orderStats = (a, b) => db.get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) t, COALESCE(SUM(covers),0) c
        FROM orders WHERE deleted = 0 AND status IN ('payee','chambre') AND substr(closed_at,1,10) BETWEEN ? AND ?`, a, b);
    const os = orderStats(from, to);
    const pos = orderStats(prevFrom, prevTo);

    const cash = db.get(`SELECT COALESCE(SUM(amount),0) t FROM payments WHERE deleted = 0 AND substr(date,1,10) BETWEEN ? AND ?`, from, to).t;
    const prevCash = db.get(`SELECT COALESCE(SUM(amount),0) t FROM payments WHERE deleted = 0 AND substr(date,1,10) BETWEEN ? AND ?`, prevFrom, prevTo).t;
    const expenses = db.get(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE deleted = 0 AND substr(date,1,10) BETWEEN ? AND ?`, from, to).t;
    const prevExpenses = db.get(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE deleted = 0 AND substr(date,1,10) BETWEEN ? AND ?`, prevFrom, prevTo).t;
    const cogsOf = (a, b) => db.get(`SELECT COALESCE(SUM(i.qty * i.cost),0) t FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.deleted = 0 AND o.deleted = 0 AND o.status IN ('payee','chambre') AND substr(o.closed_at,1,10) BETWEEN ? AND ?`, a, b).t;
    const cogs = cogsOf(from, to);
    const prevCogs = cogsOf(prevFrom, prevTo);

    const methods = db.all(`SELECT method, SUM(amount) t FROM payments WHERE deleted = 0 AND substr(date,1,10) BETWEEN ? AND ?
        GROUP BY method ORDER BY t DESC`, from, to);
    const topProducts = db.all(`SELECT i.name, SUM(i.qty) qty, SUM(i.amount) amount, SUM(i.amount - i.qty * i.cost) margin, o.outlet
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.deleted = 0 AND o.deleted = 0 AND o.status IN ('payee','chambre') AND substr(o.closed_at,1,10) BETWEEN ? AND ?
        GROUP BY i.product_id ORDER BY amount DESC LIMIT 10`, from, to);
    const hours = db.all(`SELECT CAST(substr(closed_at,12,2) AS INTEGER) h, COUNT(*) n, SUM(total) t FROM orders
        WHERE deleted = 0 AND status IN ('payee','chambre') AND substr(closed_at,1,10) BETWEEN ? AND ? GROUP BY h`, from, to);
    const weekdays = db.all(`SELECT CAST(strftime('%w', substr(closed_at,1,10)) AS INTEGER) wd, SUM(total) t FROM orders
        WHERE deleted = 0 AND status IN ('payee','chambre') AND substr(closed_at,1,10) BETWEEN ? AND ? GROUP BY wd`, from, to);
    const staff = db.all(`SELECT u.name, COUNT(o.id) n, SUM(o.total) t FROM orders o JOIN users u ON u.id = o.server_id
        WHERE o.deleted = 0 AND o.status IN ('payee','chambre') AND substr(o.closed_at,1,10) BETWEEN ? AND ?
        GROUP BY u.id ORDER BY t DESC LIMIT 8`, from, to);
    const expenseCats = db.all(`SELECT COALESCE(category,'Autre') category, SUM(amount) t FROM expenses WHERE deleted = 0
        AND substr(date,1,10) BETWEEN ? AND ? GROUP BY category ORDER BY t DESC`, from, to);
    const sources = db.all(`SELECT COALESCE(NULLIF(source,''),'Direct') source, COUNT(*) n FROM reservations WHERE deleted = 0
        AND status <> 'annulee' AND check_in BETWEEN ? AND ? GROUP BY 1 ORDER BY n DESC`, from, to);

    // Prévisions d'occupation sur 14 jours (réservations confirmées comprises).
    const fc = roomNights(d, addDays(d, 13), true);
    const forecast = Object.entries(fc).map(([day, v]) => ({ day, occupancy: round((v.nights / roomCount) * 100), nights: v.nights }));

    const statusCount = (s) => rooms.filter((r) => r.status === s).length;
    const lowStock = db.all(`SELECT p.name, p.unit, p.stock_min, COALESCE(s.qty,0) stock FROM products p
        LEFT JOIN stock_levels s ON s.product_id = p.id
        WHERE p.deleted = 0 AND p.active = 1 AND p.track_stock = 1 AND COALESCE(s.qty,0) <= p.stock_min ORDER BY stock LIMIT 12`);
    const arrivals = db.all(`SELECT r.*, g.first_name, g.last_name, rm.number room_number FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE r.deleted = 0 AND r.status = 'confirmee' AND r.check_in <= ? ORDER BY r.check_in`, d);
    const departures = db.all(`SELECT r.*, g.first_name, g.last_name, rm.number room_number FROM reservations r
        LEFT JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE r.deleted = 0 AND r.status = 'en_cours' AND r.check_out <= ? ORDER BY r.check_out`, d);
    const open = db.get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) t FROM orders WHERE deleted = 0 AND status = 'ouverte'`);
    const todayRev = sumRange(d, d);
    const yRev = sumRange(addDays(d, -1), addDays(d, -1));
    const inHouse = db.get(`SELECT COUNT(*) n, COALESCE(SUM(adults + children),0) p FROM reservations WHERE deleted = 0 AND status = 'en_cours'`);
    const stockValue = db.get(`SELECT COALESCE(SUM(COALESCE(s.qty,0) * p.cost),0) v FROM products p
        LEFT JOIN stock_levels s ON s.product_id = p.id WHERE p.deleted = 0 AND p.track_stock = 1`).v;
    const recent = db.all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.deleted = 0 AND a.action <> 'connexion' ORDER BY a.date DESC LIMIT 12`);

    const fbRevenue = round(cur.restaurant + cur.bar);
    return {
      from, to, prevFrom, prevTo, span,
      kpi: {
        revenue: cur.total, prevRevenue: prev.total,
        cash: round(cash), prevCash: round(prevCash),
        occupancy, prevOcc, adr, prevAdr, revpar, prevRevpar,
        nights: cur.nights, prevNights: prev.nights,
        tickets: os.n, prevTickets: pos.n,
        avgTicket: os.n ? round(os.t / os.n) : 0, prevAvgTicket: pos.n ? round(pos.t / pos.n) : 0,
        covers: os.c,
        expenses: round(expenses), prevExpenses: round(prevExpenses),
        cogs: round(cogs), fbRevenue,
        foodCost: fbRevenue ? round((cogs / fbRevenue) * 100) : 0,
        grossProfit: round(cur.total - cogs - expenses), prevGrossProfit: round(prev.total - prevCogs - prevExpenses),
        todayRevenue: todayRev.total, yesterdayRevenue: yRev.total,
        inHouse: inHouse.n, guestsInHouse: inHouse.p, openOrders: open.n, openOrdersTotal: round(open.t),
        stockValue: round(stockValue),
      },
      split: { hebergement: cur.hebergement, restaurant: cur.restaurant, bar: cur.bar, services: cur.services },
      series, forecast, methods, topProducts, hours, weekdays, staff, expenseCats, sources,
      rooms: { total: rooms.length, libre: statusCount('libre'), occupee: statusCount('occupee'), sale: statusCount('sale'), maintenance: statusCount('maintenance') },
      lowStock, arrivals, departures, recent,
    };
  };

  // ---------- Rapports ----------
  S.salesReport = ({ from, to }) => ({
    products: db.all(`SELECT i.name, c.name category, o.outlet, SUM(i.qty) qty, SUM(i.amount) amount, SUM(i.qty * i.cost) cost
        FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE i.deleted = 0 AND o.deleted = 0 AND o.status IN ('payee','chambre') AND substr(o.closed_at,1,10) BETWEEN ? AND ?
        GROUP BY i.product_id, o.outlet ORDER BY amount DESC`, from, to),
    daily: activityRevenue(from, to),
    totals: sumRange(from, to),
  });

  S.auditLog = (limit = 300) =>
    db.all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.deleted = 0 ORDER BY a.date DESC LIMIT ?`, limit);

  // ---------- Données de démonstration ----------
  S.seedDemo = () =>
    db.tx(() => {
      const types = [
        ['Standard', 25000, 2, '#3b82f6'], ['Confort', 35000, 2, '#8b5cf6'], ['Suite', 60000, 4, '#f59e0b'],
      ].map(([name, base_price, capacity, color]) => db.save('room_types', { name, base_price, capacity, color }));
      const rooms = [];
      for (let i = 1; i <= 12; i++) {
        const t = i <= 6 ? types[0] : i <= 10 ? types[1] : types[2];
        rooms.push(db.save('rooms', { number: String(100 + i), type_id: t.id, floor: i <= 6 ? '1' : '2', status: 'libre' }));
      }
      const cats = [
        ['Entrées', 'restaurant', '#22c55e'], ['Plats', 'restaurant', '#f97316'], ['Desserts', 'restaurant', '#ec4899'],
        ['Bières', 'both', '#eab308'], ['Softs', 'both', '#06b6d4'], ['Cocktails', 'bar', '#a855f7'], ['Vins & Spiritueux', 'both', '#ef4444'],
      ].map(([name, outlet, color], sort) => db.save('categories', { name, outlet, color, sort }));
      const prods = [
        ['Salade composée', 0, 3500, 1200, 0], ['Soupe du jour', 0, 2500, 700, 0],
        ['Poulet braisé', 1, 6000, 2500, 0], ['Poisson grillé', 1, 8000, 3500, 0], ['Brochettes de bœuf', 1, 7000, 3000, 0], ['Riz sauce arachide', 1, 4500, 1500, 0],
        ['Fondant chocolat', 2, 3000, 900, 0], ['Salade de fruits', 2, 2500, 800, 0],
        ['Bière locale 65cl', 3, 1500, 750, 1], ['Bière importée 33cl', 3, 2000, 1100, 1],
        ['Coca-Cola', 4, 1000, 450, 1], ['Eau minérale 1,5L', 4, 1000, 350, 1], ['Jus naturel', 4, 1500, 500, 1],
        ['Mojito', 5, 4500, 1500, 0], ['Piña Colada', 5, 5000, 1700, 0],
        ['Verre de vin', 6, 3000, 1200, 1], ['Whisky (verre)', 6, 4000, 1500, 1],
      ].map(([name, c, price, cost, track]) => db.save('products', { name, category_id: cats[c].id, price, cost, track_stock: track, stock_min: track ? 12 : 0, outlet: cats[c].outlet, active: 1 }));
      for (let i = 1; i <= 10; i++) db.save('dining_tables', { name: `T${i}`, outlet: 'restaurant', seats: i % 3 ? 4 : 6, zone: i <= 6 ? 'Salle' : 'Terrasse', sort: i });
      for (let i = 1; i <= 6; i++) db.save('dining_tables', { name: `Bar ${i}`, outlet: 'bar', seats: 2, zone: 'Comptoir', sort: i });

      const names = [['Kouassi', 'Aya'], ['Diallo', 'Mamadou'], ['Traoré', 'Fatou'], ['Martin', 'Julien'], ['Ndiaye', 'Awa'], ['Koné', 'Ibrahim'], ['Mensah', 'Kofi'], ['Bamba', 'Mariam'], ['Dupont', 'Claire'], ['Ouédraogo', 'Paul']];
      const guests = names.map(([last_name, first_name], i) => db.save('guests', { last_name, first_name, phone: `+225 07 ${String(10 + i).padStart(2, '0')} 45 67 ${String(20 + i)}`, nationality: i % 4 === 3 ? 'France' : 'Côte d’Ivoire', vip: i === 2 ? 1 : 0 }));
      const users = S.users();
      const uid = users[0] && users[0].id;
      // Personnel de démonstration (PIN : 1111 serveur, 2222 barman, 3333 réception).
      const taken = (pin) => db.list('users').some((x) => checkPin(pin, x.pin_hash));
      const staff = [['Awa (serveuse)', 'serveur', '1111'], ['Koffi (barman)', 'barman', '2222'], ['Fanta (réception)', 'reception', '3333']]
        .filter(([, , pin]) => !taken(pin)).map(([name, role, pin]) => S.saveUser({ name, role, pin, active: 1 }));
      const servers = { restaurant: [staff[0], users[0]].filter(Boolean), bar: [staff[1], staff[0]].filter(Boolean) };
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const sourcesList = ['Direct', 'Booking.com', 'Téléphone', 'Expedia', 'Agence'];
      // Historique : 60 jours de séjours et de ventes.
      const d0 = today();
      for (let back = 60; back >= -10; back -= 1) {
        const day = addDays(d0, -back);
        for (const room of rooms) {
          if (Math.random() < 0.18) {
            const n = 1 + Math.floor(Math.random() * 4);
            const out = addDays(day, n);
            if (S.conflicts(room.id, day, out).length) continue;
            const t = types.find((x) => x.id === room.type_id);
            const g = guests[Math.floor(Math.random() * guests.length)];
            let status = 'confirmee';
            if (out < d0) status = 'partie';
            else if (day < d0) status = 'en_cours'; // départs du jour inclus
            // les séjours qui commencent aujourd'hui restent « confirmée » : arrivées à enregistrer
            if (status === 'en_cours' && db.get(`SELECT 1 FROM reservations WHERE room_id = ? AND status = 'en_cours' AND deleted = 0`, room.id)) continue;
            const r = db.save('reservations', { code: shortCode('R'), guest_id: g.id, room_id: room.id, check_in: day, check_out: out, adults: 1 + (Math.random() < 0.5 ? 1 : 0), children: 0, rate: t.base_price, status, source: sourcesList[Math.floor(Math.random() * sourcesList.length)], user_id: uid });
            if (status === 'partie') db.save('payments', { date: `${out}T11:${pad(Math.floor(Math.random() * 59))}:00`, amount: n * t.base_price, method: Math.random() < 0.5 ? 'carte' : 'especes', source: 'hotel', reservation_id: r.id, user_id: uid });
            if (status === 'en_cours') db.save('rooms', { id: room.id, status: 'occupee' });
          }
        }
        if (back < 0) continue;
        const nOrders = 8 + Math.floor(Math.random() * 14);
        for (let k = 0; k < nOrders; k++) {
          const outlet = Math.random() < 0.55 ? 'restaurant' : 'bar';
          const hour = outlet === 'bar' ? 17 + Math.floor(Math.random() * 7) : (Math.random() < 0.5 ? 12 + Math.floor(Math.random() * 3) : 19 + Math.floor(Math.random() * 3));
          const stamp = `${day}T${pad(Math.min(hour, 23))}:${pad(Math.floor(Math.random() * 60))}:00`;
          const pool = prods.filter((p) => p.outlet === 'both' || p.outlet === outlet);
          const srv = (pick(servers[outlet]) || {}).id || uid;
          const o = db.save('orders', { number: shortCode(outlet === 'bar' ? 'B' : 'T'), outlet, status: 'payee', server_id: srv, opened_at: stamp, closed_at: stamp, covers: 1 + Math.floor(Math.random() * 4) });
          let total = 0;
          const lines = 1 + Math.floor(Math.random() * 4);
          for (let l = 0; l < lines; l++) {
            const p = pool[Math.floor(Math.random() * pool.length)];
            const qty = 1 + Math.floor(Math.random() * 3);
            total += qty * p.price;
            db.save('order_items', { order_id: o.id, product_id: p.id, name: p.name, qty, unit_price: p.price, cost: p.cost, amount: qty * p.price, sent: 1, created_at: stamp });
            if (p.track_stock) db.save('stock_moves', { product_id: p.id, date: stamp, qty: -qty, type: 'vente', unit_cost: p.cost, order_id: o.id });
          }
          db.save('orders', { id: o.id, subtotal: total, total });
          const r = Math.random();
          db.save('payments', { date: stamp, amount: total, method: r < 0.5 ? 'especes' : r < 0.75 ? 'mobile_money' : 'carte', source: outlet, order_id: o.id, user_id: srv });
        }
        if (back % 3 === 0) {
          const cats2 = ['Achats cuisine', 'Boissons', 'Électricité', 'Entretien', 'Salaires', 'Blanchisserie'];
          const c = cats2[Math.floor(Math.random() * cats2.length)];
          db.save('expenses', { date: `${day}T09:00:00`, category: c, label: c, amount: 15000 + Math.floor(Math.random() * 90) * 1000, method: 'especes' });
        }
      }
      // Mouvements du jour garantis : deux arrivées attendues et un départ à clôturer.
      let arrivals = 0;
      for (const room of rooms) {
        if (arrivals >= 2) break;
        if (S.conflicts(room.id, d0, addDays(d0, 2)).length) continue;
        const t = types.find((x) => x.id === room.type_id);
        db.save('reservations', { code: shortCode('R'), guest_id: guests[arrivals + 4].id, room_id: room.id, check_in: d0, check_out: addDays(d0, 2), adults: 2, children: 0, rate: t.base_price, status: 'confirmee', source: 'Booking.com', user_id: uid });
        arrivals++;
      }
      const leaving = db.get(`SELECT id FROM reservations WHERE status = 'en_cours' AND deleted = 0 AND check_out > ? ORDER BY check_out LIMIT 1`, d0);
      if (leaving) db.save('reservations', { id: leaving.id, check_out: d0 });
      const sups = ['Brasserie du Nord', 'Marché central', 'Distrib Boissons SA'].map((name) => db.save('suppliers', { name }));
      // Stock initial calculé pour finir positif (quelques articles volontairement sous le seuil).
      prods.filter((p) => p.track_stock).forEach((p, i) => {
        const sold = -db.get('SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE product_id = ? AND deleted = 0', p.id).q;
        const target = i % 4 === 0 ? 4 + Math.floor(Math.random() * 6) : 30 + Math.floor(Math.random() * 90);
        db.save('stock_moves', { product_id: p.id, date: `${addDays(d0, -61)}T08:00:00`, qty: sold + target, type: 'entree', unit_cost: p.cost, note: 'Stock initial', supplier_id: sups[2].id });
      });
      return true;
    });

  return S;
}

module.exports = { createServices, localStamp, today, addDays, daysBetween, hashPin, checkPin, ROLES, DEFAULT_SETTINGS };
