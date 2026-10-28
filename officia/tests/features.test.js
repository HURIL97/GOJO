const test = require('node:test');
const assert = require('node:assert');
const { DB, stamp } = require('../electron/db');
const { createServices, today, addDays } = require('../electron/services');
const ics = require('../electron/ics');

const fresh = () => { const db = new DB(':memory:'); return { db, S: createServices(db) }; };

test('rappel des visiteurs la veille : e-mail si adresse connue, sinon liste WhatsApp/SMS ; nouveau rappel si le rendez-vous est déplacé', () => {
  const { db, S } = fresh();
  const tomorrow = addDays(today(), 1);
  const a = db.save('contacts', { first_name: 'Claire', last_name: 'Dubois', email: 'c.dubois@banque.ci' });
  const b = db.save('contacts', { first_name: 'M.', last_name: 'Konan', mobile: '0707070707' });
  const ev = S.saveEvent({ title: 'RDV banque', type: 'rdv', start: `${tomorrow}T10:00:00`, end: `${tomorrow}T11:00:00`, contact_id: a.id, location: 'Salle Ébène' });
  S.saveEvent({ title: 'Devis transport', type: 'rdv', start: `${tomorrow}T15:00:00`, end: `${tomorrow}T15:30:00`, contact_id: b.id });
  S.saveEvent({ title: 'Annulé', type: 'rdv', start: `${tomorrow}T16:00:00`, end: `${tomorrow}T17:00:00`, contact_id: a.id, status: 'annule' });
  assert.equal(S.automationBatch(`${today()}T09:00:00`).visitors.length, 0); // avant l'heure choisie (16:00)
  const batch = S.automationBatch(`${today()}T16:05:00`);
  assert.equal(batch.visitors.length, 1);
  assert.equal(batch.visitors[0].to, 'c.dubois@banque.ci');
  assert.match(batch.visitors[0].text, /Bonjour Claire Dubois/);
  assert.match(batch.visitors[0].text, /10h00, Salle Ébène/);
  assert.deepEqual(batch.phones.map((e) => e.title), ['Devis transport']);
  S.markVisitorReminded(ev.id);
  assert.equal(S.automationBatch(`${today()}T16:05:00`).visitors.length, 0);
  // Déplacé à 11 h : l'invitation change de version et le visiteur sera prévenu à nouveau.
  const moved = S.saveEvent({ ...db.byId('events', ev.id), start: `${tomorrow}T11:00:00`, end: `${tomorrow}T12:00:00` });
  assert.equal(moved.ics_seq, 1);
  assert.equal(S.automationBatch(`${today()}T16:05:00`).visitors.length, 1);
  S.saveSettings({ visitor_reminder: '0' });
  assert.equal(S.automationBatch(`${today()}T16:05:00`).visitors.length, 0);
});

test('réunions : suivi des actions non terminées et planification de la séance suivante', () => {
  const { S } = fresh();
  const d = today();
  const m1 = S.saveMeeting({ title: 'Comité de direction', start: `${addDays(d, -7)}T10:00:00`, end: `${addDays(d, -7)}T12:00:00`, participants: [{ name: 'DG', presence: 'present' }],
    minutes: { points: [], actions: [{ title: 'Budget révisé', owner: 'DAF', due: d }, { title: 'Note de service', owner: 'RH' }, { title: 'Offre d’emploi', owner: 'RH' }] } });
  S.saveTask({ id: m1.tasks.find((t) => t.title === 'Note de service').id, status: 'terminee' });
  S.saveTask({ id: m1.tasks.find((t) => t.title === 'Offre d’emploi').id, status: 'en_cours' });
  // Séance suivante créée depuis la première.
  const next = S.planNextMeeting(m1.id, `${addDays(d, 7)}T10:00:00`);
  assert.equal(next.previous_id, m1.id);
  assert.equal(next.participants[0].presence, '');
  const follow = next.agenda.find((a) => a.carried);
  assert.deepEqual(follow.carried.map((t) => [t.title, t.status]), [['Budget révisé', 'a_faire'], ['Offre d’emploi', 'en_cours']]);
  assert.equal(next.end, `${addDays(d, 7)}T12:00:00`);
  // Réunion créée à la main avec le même intitulé : le suivi se retrouve aussi.
  const m3 = S.saveMeeting({ title: 'Comité de direction', start: `${d}T15:00:00`, agenda: [{ title: 'Validation du PV' }, { title: 'Divers' }] });
  const withFollow = S.carryActions(m3.id);
  assert.equal(withFollow.agenda[1].carried.length, 2);
  assert.equal(S.carryActions(m3.id).agenda.filter((a) => a.carried).length, 1); // pas de doublon
  const v = S.validatePv(m1.id, 'Mme Koné', 'RAS');
  assert.equal(v.status, 'pv_valide');
  assert.equal(v.pv_validated_by, 'Mme Koné');
});

test('courrier : circuit de traitement, réponse liée, relance automatique de l’échéance dépassée', () => {
  const { db, S } = fresh();
  const d = today();
  const c = S.saveCourrier({ direction: 'arrivee', correspondent: 'Ministère', object: 'Demande de rapport', date: addDays(d, -10) });
  assert.equal(c.circuit[0].action, 'enregistre');
  const t = S.courrierStep(c.id, { action: 'transmis', to: 'Direction financière', email: 'daf@exemple.ci', due: addDays(d, -1), note: 'Pour attribution' });
  assert.equal(t.status, 'en_traitement');
  assert.equal(t.assigned_email, 'daf@exemple.ci');
  assert.equal(S.automationBatch(`${d}T09:00:00`).relances.length, 0); // relance automatique désactivée par défaut
  S.saveSettings({ courrier_auto_relance: '1' });
  const rel = S.automationBatch(`${d}T09:00:00`).relances;
  assert.equal(rel.length, 1);
  assert.match(rel[0].subject, /Relance — courrier A-\d{4}-0001/);
  S.courrierStep(c.id, { action: 'relance', to: 'daf@exemple.ci' });
  assert.equal(S.automationBatch(`${d}T09:00:00`).relances.length, 0); // pas deux relances dans le délai
  // Réponse par lettre : le courrier arrivé passe en « Traité ».
  const rep = S.saveCourrier({ direction: 'depart', correspondent: 'Ministère', object: 'Réponse', reply_to_id: c.id, letter: { body: 'Texte' } });
  assert.match(rep.number, /^D-/);
  const back = db.byId('courrier', c.id);
  assert.equal(back.status, 'traite');
  assert.ok(back.treated_at);
  assert.equal(back.circuit.pop().action, 'reponse');
  // Mise à jour partielle (pièces jointes) sans ressaisir les champs obligatoires.
  assert.equal(S.saveCourrier({ id: rep.id, files: [{ filename: 'lettre.pdf', path: '/tmp/x.pdf' }] }).files.length, 1);
});

test('rapport mensuel d’activité et import d’un agenda .ics', () => {
  const { S } = fresh();
  S.seedDemo();
  const r = S.monthlyReport(today().slice(0, 7));
  assert.ok(r.kpi.rdv >= 3);
  assert.ok(r.kpi.courrierIn >= 1);
  assert.ok(r.weeks.length >= 4 && r.weeks.length <= 6);
  assert.equal(typeof r.prev.meetings, 'number');
  const file = ics.calendar([{ id: 'g1', title: 'Conseil d’administration', start: `${today()}T09:00:00`, end: `${today()}T11:00:00`, location: 'Siège' },
    { id: 'g2', title: 'Fête nationale', start: `${addDays(today(), 3)}T00:00:00`, end: `${addDays(today(), 3)}T23:59:00`, all_day: 1 }]);
  assert.deepEqual(S.importEvents(ics.parse(file)), { added: 2, updated: 0 });
  assert.deepEqual(S.importEvents(ics.parse(file)), { added: 0, updated: 2 }); // réimport sans doublon
  const ag = S.agenda(today(), addDays(today(), 3)).filter((e) => e.ics_uid);
  assert.equal(ag.length, 2);
  assert.equal(ag.find((e) => e.all_day).start, `${addDays(today(), 3)}T00:00:00`);
  assert.ok(stamp());
});
