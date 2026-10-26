const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SMTPServer } = require('smtp-server');
const { DB, stamp } = require('../electron/db');
const { createServices, today, addDays } = require('../electron/services');
const { createMail } = require('../electron/mail');

const fresh = () => { const db = new DB(':memory:'); return { db, S: createServices(db) }; };
const enc = (s) => Buffer.from(s).toString('base64');
const dec = (s) => Buffer.from(s, 'base64').toString();

test('agenda : récurrence hebdomadaire et conflits', () => {
  const { S } = fresh();
  const d = today();
  S.saveEvent({ title: 'Point hebdo', type: 'autre', start: `${d}T09:00:00`, end: `${d}T10:00:00`, recurrence: 'weekly' });
  const occ = S.agenda(d, addDays(d, 27));
  assert.equal(occ.length, 4);
  assert.equal(occ[1].start, `${addDays(d, 7)}T09:00:00`);
  const c = S.conflicts(`${addDays(d, 14)}T09:30:00`, `${addDays(d, 14)}T11:00:00`);
  assert.equal(c.length, 1);
  assert.equal(S.conflicts(`${d}T10:00:00`, `${d}T11:00:00`).length, 0);
});

test('réunion : fiche créée depuis l’agenda, actions du PV transformées en tâches', () => {
  const { db, S } = fresh();
  const d = today();
  const ev = S.saveEvent({ title: 'Comité', type: 'reunion', start: `${d}T10:00:00`, end: `${d}T12:00:00` });
  assert.ok(ev.meeting_id);
  const m = S.meeting(ev.meeting_id);
  m.minutes = { intro: 'Ouverture', points: [{ title: 'Budget', discussion: '…', decisions: 'Adopté' }], actions: [{ title: 'Envoyer la note', owner: 'DAF', due: addDays(d, 2) }] };
  const saved = S.saveMeeting(m);
  assert.equal(saved.tasks.length, 1);
  assert.ok(saved.minutes.actions[0].task_id);
  S.saveMeeting(saved); // pas de doublon au second enregistrement
  assert.equal(db.list('tasks', { meeting_id: m.id }).length, 1);
  saved.start = `${addDays(d, 1)}T15:00:00`;
  saved.end = `${addDays(d, 1)}T16:00:00`;
  S.saveMeeting(saved);
  assert.equal(db.byId('events', ev.id).start, `${addDays(d, 1)}T15:00:00`);
});

test('notifications : évènement imminent, rappel échu, récapitulatif des tâches, sans doublon', () => {
  const { S } = fresh();
  const now = stamp();
  const inTen = new Date(Date.now() + 10 * 60000);
  const start = stamp(inTen);
  S.saveEvent({ title: 'RDV client', type: 'rdv', start, end: stamp(new Date(inTen.getTime() + 3600000)), reminder_min: 15 });
  S.saveReminder({ title: 'Appeler la banque', due: stamp(new Date(Date.now() - 60000)) });
  S.saveTask({ title: 'Dossier', due: today() });
  S.saveSettings({ task_digest_hour: '00:00' });
  const first = S.tick(now);
  const kinds = first.map((n) => n.kind).sort();
  assert.deepEqual(kinds, ['event', 'reminder', 'task']);
  assert.equal(S.tick(now).length, 0);
  assert.equal(S.unreadCount(), 3);
});

test('rappel récurrent : terminé = reprogrammé', () => {
  const { S } = fresh();
  const r = S.saveReminder({ title: 'Hebdo', due: `${addDays(today(), -1)}T08:00:00`, repeat: 'weekly' });
  const next = S.completeReminder(r.id);
  assert.ok(next.due > stamp());
  assert.equal(next.done, 0);
});

test('courrier : numérotation chronologique par sens et par année', () => {
  const { S } = fresh();
  const y = today().slice(0, 4);
  const a1 = S.saveCourrier({ direction: 'arrivee', correspondent: 'X', object: 'A' });
  const a2 = S.saveCourrier({ direction: 'arrivee', correspondent: 'Y', object: 'B' });
  const d1 = S.saveCourrier({ direction: 'depart', correspondent: 'Z', object: 'C' });
  assert.equal(a1.number, `A-${y}-0001`);
  assert.equal(a2.number, `A-${y}-0002`);
  assert.equal(d1.number, `D-${y}-0001`);
});

test('données de démonstration, tableau de bord et recherche', () => {
  const { S } = fresh();
  S.seedDemo();
  const d = S.dashboard();
  assert.ok(d.kpi.eventsToday >= 4);
  assert.ok(d.kpi.unread >= 2);
  assert.equal(d.load.length, 7);
  assert.ok(S.search('Mensah').length >= 2);
  const pv = S.meetings({ status: 'pv_valide' });
  assert.equal(pv.length, 1);
  assert.equal(S.meeting(pv[0].id).minutes.points.length, 3);
});

test('messagerie : envoi SMTP, boîte d’envoi hors ligne puis envoi au retour du réseau, import d’un message', async () => {
  const received = [];
  const server = new SMTPServer({
    disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    onAuth(auth, session, cb) { return auth.username === 'secretariat@exemple.ci' && auth.password === 'secret' ? cb(null, { user: 1 }) : cb(new Error('Identifiants invalides')); },
    onData(stream, session, cb) { let raw = ''; stream.on('data', (c) => { raw += c; }); stream.on('end', () => { received.push(raw); cb(); }); },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.server.address().port;
  const { db } = fresh();
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officia-'));
  const M = createMail(db, { encrypt: enc, decrypt: dec, filesDir });
  const acc = M.saveAccount({ email: 'secretariat@exemple.ci', display_name: 'Secrétariat', smtp_host: '127.0.0.1', smtp_port: port, smtp_secure: 0, password: 'secret' });
  assert.equal(acc.has_password, true);
  assert.equal(acc.password_enc, undefined);

  const r = await M.send({ account_id: acc.id, to_addr: 'dg@exemple.ci', subject: 'Convocation', text: 'Bonjour' });
  assert.equal(r.status, 'sent');
  assert.equal(received.length, 1);
  assert.match(received[0], /Subject: Convocation/);
  assert.equal(M.list({ folder: 'sent' }).length, 1);

  // Serveur injoignable : le message reste en boîte d'envoi.
  db.save('mail_accounts', { id: acc.id, smtp_port: 1 });
  const q = await M.send({ account_id: acc.id, to_addr: 'daf@exemple.ci', subject: 'PV', text: 'Ci-joint' });
  assert.equal(q.status, 'queued');
  assert.equal(M.list({ folder: 'outbox' }).length, 1);
  db.save('mail_accounts', { id: acc.id, smtp_port: port });
  const res = await M.processOutbox();
  assert.equal(res.sent, 1);
  assert.equal(M.list({ folder: 'outbox' }).length, 0);
  assert.equal(received.length, 2);
  server.close();

  const raw = 'From: "Claire Dubois" <c.dubois@banque.com>\r\nTo: secretariat@exemple.ci\r\nSubject: =?UTF-8?Q?R=C3=A9union?=\r\nMessage-ID: <abc@banque.com>\r\nDate: Tue, 20 Oct 2026 09:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBonjour, à demain.\r\n';
  const m = await M.importRaw(acc.id, raw, { uid: 7 });
  assert.equal(m.subject, 'Réunion');
  assert.equal(m.from_name, 'Claire Dubois');
  assert.equal(await M.importRaw(acc.id, raw, { uid: 7 }), null); // dédoublonnage
});

test('import de contacts CSV : en-têtes Outlook/Excel, séparateur auto, guillemets, doublons', () => {
  const { S } = fresh();
  const csv = '﻿Prénom;Nom;Société;E-mail;Téléphone;Notes\r\nAwa;Kouassi;"SIN; Abidjan";awa@sin.ci;0701;"Cliente ""VIP"""\r\nJean;Yao;;JY@x.ci;;\r\n;;;;;\r\n';
  assert.deepEqual(S.importContacts(csv), { added: 2, skipped: 0 });
  const awa = S.contacts('Kouassi')[0];
  assert.equal(awa.company, 'SIN; Abidjan');
  assert.equal(awa.notes, 'Cliente "VIP"');
  assert.deepEqual(S.importContacts('Name,E-mail Address\nClaire Dubois,c@b.com\nJean Yao,jy@x.ci\n'), { added: 1, skipped: 1 });
  assert.equal(S.contacts('Dubois')[0].first_name, 'Claire');
  assert.throws(() => S.importContacts('foo;bar\n1;2'), /Colonnes non reconnues/);
});

test('sessions : création, reprise des anciennes données, suppression limitée au dossier des profils', () => {
  const { Profiles, dbFileOf } = require('../electron/profiles');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'officia-prof-'));
  // Ancienne base unique (session de démonstration d'avant les sessions).
  const legacy = new DB(path.join(root, 'officia.db'));
  const L = createServices(legacy);
  L.saveSettings({ user_name: 'Awa Démo', organisation: 'Démo SA' });
  L.seedDemo();
  legacy.close();
  const P = new Profiles(root);
  const adopted = P.adoptLegacy();
  assert.equal(adopted.name, 'Awa Démo');
  assert.equal(adopted.demo, true);
  assert.equal(P.adoptLegacy(), null); // pas de doublon
  const real = P.add({ name: 'Joël Tetchi', organisation: 'Cabinet KOREY' });
  const db = new DB(dbFileOf(real));
  const S = createServices(db);
  assert.equal(S.contacts('').length, 0); // session vierge, séparée de la démo
  S.setLockPin('2468');
  assert.throws(() => S.unlock('1111'), /Code incorrect/);
  assert.equal(S.unlock('2468'), true);
  db.close();
  assert.equal(P.list().length, 2);
  P.remove(real.id);
  assert.equal(fs.existsSync(real.dir), false);
  P.remove(adopted.id); // la session d'origine vit à la racine : seule sa base est retirée
  assert.equal(fs.existsSync(root), true);
  assert.equal(P.list().length, 0);
});
