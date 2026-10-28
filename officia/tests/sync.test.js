const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DB } = require('../electron/db');
const { createServices, today, addDays } = require('../electron/services');
const { SyncEngine } = require('../electron/sync');
const { createServer } = require('../server/server');

const TOKEN = 'jeton-de-test-0123456789abcdef';

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officia-srv-'));
  const server = createServer({ token: TOKEN, dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const poste = (name) => {
    const db = new DB(':memory:');
    const S = createServices(db);
    S.saveSettings({ user_name: name, sync_url: url, sync_token: TOKEN });
    const sync = new SyncEngine(db, S.settings);
    return { db, S, sync };
  };
  return { server, url, poste };
}
const j = async (r) => { const b = await r.json(); if (!r.ok) throw Object.assign(new Error(b.error), { status: r.status }); return b; };

test('équipe : deux postes partagent agenda, réunions et tâches ; la version la plus récente gagne ; paramètres et messages restent locaux', async () => {
  const { server, poste } = await setup();
  try {
    const A = poste('Awa');
    const B = poste('Fanta');
    const d = today();
    A.S.saveEvent({ title: 'RDV banque', type: 'rdv', start: `${d}T11:00:00`, end: `${d}T12:00:00` });
    const ev = A.S.saveEvent({ title: 'Comité', type: 'reunion', start: `${d}T15:00:00`, end: `${d}T16:00:00` });
    A.db.save('mails', { folder: 'inbox', subject: 'privé', account_id: 'x' });
    A.sync.start(); A.sync.stop();
    await A.sync.run();
    assert.equal(A.sync.state.status, 'ok', A.sync.state.lastError);
    assert.equal(A.db.pendingCount(), 0);
    await B.sync.run();
    assert.equal(B.S.agenda(d, d).length, 2);
    assert.equal(B.S.meetings({}).length, 1); // la fiche réunion suit
    assert.equal(B.db.list('mails').length, 0);
    assert.equal(B.S.settings().user_name, 'Fanta');

    // Modification sur B, puis plus tard sur A : la dernière gagne partout.
    B.S.saveEvent({ ...B.db.byId('events', ev.id), location: 'Salle B' });
    await new Promise((r) => setTimeout(r, 5));
    A.S.saveEvent({ ...A.db.byId('events', ev.id), location: 'Salle du Conseil' });
    await B.sync.run(); await A.sync.run(); await B.sync.run();
    assert.equal(A.db.byId('events', ev.id).location, 'Salle du Conseil');
    assert.equal(B.db.byId('events', ev.id).location, 'Salle du Conseil');

    // Suppression propagée.
    A.db.remove('events', ev.id);
    await A.sync.run(); await B.sync.run();
    assert.equal(B.db.byId('events', ev.id), null);
  } finally { server.close(); }
});

test('accès mobile : connexion par code, agenda (rendez-vous privés masqués), validation du PV reçue par le poste, flux iCal', async () => {
  const { server, url, poste } = await setup();
  try {
    const A = poste('Awa');
    const d = today();
    A.S.saveMobileUser({ name: 'Mme Koné', login: 'dg', code: '246810' });
    assert.throws(() => A.S.saveMobileUser({ name: 'X', login: 'dg', code: '123456' }), /déjà utilisé/);
    A.S.saveEvent({ title: 'Visite médicale', type: 'perso', start: `${d}T08:00:00`, end: `${d}T09:00:00`, private: 1 });
    A.S.saveEvent({ title: 'Point hebdo', type: 'reunion', start: `${addDays(d, -7)}T10:00:00`, end: `${addDays(d, -7)}T11:00:00`, recurrence: 'weekly' });
    const m = A.S.meetings({})[0];
    A.S.saveMeeting({ ...A.S.meeting(m.id), minutes: { intro: 'Ouverture', points: [{ title: 'Budget', discussion: '…', decisions: 'Adopté' }], actions: [] } });
    A.S.setMeetingStatus(m.id, 'tenue');
    await A.sync.run();

    const post = (p, body, tok) => fetch(`${url}/m/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
    const get = (p, tok) => fetch(`${url}/m/api${p}`, { headers: { Authorization: `Bearer ${tok}` } });
    await assert.rejects(j(await post('/login', { login: 'dg', code: '000000' })), /incorrect/);
    const { token, name } = await j(await post('/login', { login: 'DG', code: '246810' }));
    assert.equal(name, 'Mme Koné');
    assert.equal((await get('/summary', 'faux.jeton')).status, 401);

    const ag = await j(await get(`/agenda?from=${d}&to=${d}`, token));
    assert.deepEqual(ag.map((e) => e.title).sort(), ['Occupé', 'Point hebdo']); // récurrence développée, rendez-vous privé masqué
    const s = await j(await get('/summary', token));
    assert.equal(s.pvToValidate, 1);
    const pv = await j(await get(`/meetings/${m.id}`, token));
    assert.equal(pv.minutes.points[0].decisions, 'Adopté');
    await j(await post(`/meetings/${m.id}/validate`, { remarks: 'RAS' }, token));
    await assert.rejects(j(await post(`/meetings/${m.id}/validate`, {}, token)), /pas en attente/);

    await A.sync.run();
    const back = A.S.meeting(m.id);
    assert.equal(back.status, 'pv_valide');
    assert.equal(back.pv_validated_by, 'Mme Koné');
    assert.equal(back.pv_remarks, 'RAS');

    // Flux d'agenda à s'abonner depuis Google Agenda / Outlook.
    const feed = await fetch(`${url}/ical/${server.feedKey}.ics`);
    assert.equal(feed.status, 200);
    const cal = await feed.text();
    assert.match(cal, /BEGIN:VCALENDAR/);
    assert.match(cal, /SUMMARY:Occupé/);
    assert.match(cal, /RRULE:FREQ=WEEKLY/);
    assert.doesNotMatch(cal, /Visite médicale/);
    assert.equal((await fetch(`${url}/ical/${'0'.repeat(32)}.ics`)).status, 404);

    // Accès désactivé sur le poste : coupé dès la synchronisation suivante.
    const u = A.S.mobileUsers()[0];
    A.S.saveMobileUser({ ...u, active: 0 });
    await A.sync.run();
    assert.equal((await get('/summary', token)).status, 401);
  } finally { server.close(); }
});
