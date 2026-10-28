const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const hoodiecrow = require('hoodiecrow-imap');
const { SMTPServer } = require('smtp-server');
const { DB } = require('../electron/db');
const { createMail } = require('../electron/mail');

const enc = (s) => Buffer.from(s).toString('base64');
const dec = (s) => Buffer.from(s, 'base64').toString();
const raw = (n, subj) => `From: "Claire Dubois" <c.dubois@banque.ci>\r\nTo: secretariat@exemple.ci\r\nSubject: =?UTF-8?B?${Buffer.from(subj).toString("base64")}?=\r\nMessage-ID: <f${n}@banque.ci>\r\nDate: Mon, 26 Oct 2026 0${n}:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMessage ${n}.\r\n`;
const listen = (srv, ...a) => new Promise((r) => srv.listen(0, ...a, r));

function imapServer(users) {
  return hoodiecrow({
    plugins: ['ID', 'UIDPLUS', 'ENABLE', 'SPECIAL-USE', 'SASL-IR', 'XOAUTH2'], users,
    storage: {
      INBOX: { messages: [{ raw: raw(1, 'Non lu') }, { raw: raw(2, 'Déjà lu'), flags: ['\\Seen'] }] },
      '': { separator: '/', folders: {
        'Sent Items': { 'special-use': '\\Sent', messages: [{ raw: raw(3, 'Envoyé depuis le téléphone'), flags: ['\\Seen'] }] },
        Spam: { messages: [{ raw: raw(4, 'Publicité') }] },
        Archives: { 'special-use': '\\Archive' },
      } },
    },
  });
}
const flagsOf = (server, box, uid) => server.getMailbox(box).messages.find((m) => m.uid === uid).flags;

test('messagerie : dossiers Envoyés/Indésirables, copie des envois dans « Envoyés », lu/non lu dans les deux sens', async () => {
  const imap = imapServer({ 'secretariat@exemple.ci': { password: 'secret' } });
  await listen(imap);
  const received = [];
  const smtp = new SMTPServer({ disabledCommands: ['STARTTLS'], allowInsecureAuth: true, onAuth: (a, s, cb) => cb(null, { user: 1 }),
    onData(stream, s, cb) { let d = ''; stream.on('data', (c) => { d += c; }); stream.on('end', () => { received.push(d); cb(); }); } });
  await listen(smtp, '127.0.0.1');
  const db = new DB(':memory:');
  const M = createMail(db, { encrypt: enc, decrypt: dec, filesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'officia-')) });
  const acc = M.saveAccount({ email: 'secretariat@exemple.ci', password: 'secret', imap_host: '127.0.0.1', imap_port: imap.server.address().port, imap_secure: 0,
    smtp_host: '127.0.0.1', smtp_port: smtp.server.address().port, smtp_secure: 0 });
  try {
    const r = await M.fetch(acc.id);
    assert.equal(r.fetched, 2); // seuls les messages de la boîte de réception sont signalés comme nouveaux
    assert.deepEqual(M.list({ folder: 'inbox' }).map((m) => [m.subject, m.read]).sort(), [['Déjà lu', 1], ['Non lu', 0]]);
    assert.equal(M.list({ folder: 'sent' })[0].subject, 'Envoyé depuis le téléphone');
    assert.equal(M.list({ folder: 'junk' })[0].subject, 'Publicité');

    // Lu dans OfficiaTech → \Seen sur le serveur.
    const unread = M.list({ folder: 'inbox' }).find((m) => !m.read);
    M.get(unread.id);
    M.update(unread.id, { starred: 1 });
    // Lu sur le téléphone → lu dans OfficiaTech (et inversement « marqué non lu »).
    const seen = M.list({ folder: 'inbox' }).find((m) => m.subject === 'Déjà lu');
    imap.getMailbox('INBOX').messages.find((m) => m.uid === 2).flags = [];
    await M.fetch(acc.id);
    assert.ok(flagsOf(imap, 'INBOX', 1).includes('\\Seen'));
    assert.ok(flagsOf(imap, 'INBOX', 1).includes('\\Flagged'));
    assert.equal(db.byId('mails', seen.id).read, 0);

    // Envoi : SMTP puis copie dans « Éléments envoyés », sans doublon à la relève suivante.
    const s = await M.send({ account_id: acc.id, to_addr: 'dg@exemple.ci', subject: 'Note de service', text: 'Bonjour' });
    assert.equal(s.status, 'sent');
    assert.equal(received.length, 1);
    const box = imap.getMailbox('Sent Items').messages;
    assert.equal(box.length, 2);
    assert.match(String(box[1].raw), /Subject: Note de service/);
    await M.fetch(acc.id);
    assert.equal(M.list({ folder: 'sent' }).filter((m) => m.subject === 'Note de service').length, 1);
    assert.ok(db.byId('mails', s.id).uid, 'la copie locale est reliée au message du serveur');
  } finally { imap.close(); smtp.close(); }
});

test('messagerie : « Se connecter avec Microsoft » (jeton OAuth, renouvellement automatique, IMAP et SMTP en XOAUTH2)', async () => {
  // Faux serveur de jetons Microsoft.
  const grants = [];
  const tokenSrv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      const p = new URLSearchParams(b);
      grants.push(p.get('grant_type'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'jeton-neuf', refresh_token: 'refresh-2', expires_in: 3600 }));
    });
  });
  await listen(tokenSrv, '127.0.0.1');
  const imap = imapServer({ 'secretariat@outlook.com': { password: 'x', xoauth2: { accessToken: 'jeton-neuf' } } });
  await listen(imap);
  const tokens = [];
  const smtp = new SMTPServer({ disabledCommands: ['STARTTLS'], allowInsecureAuth: true, authMethods: ['XOAUTH2'],
    onAuth: (a, s, cb) => { tokens.push(a.accessToken); return a.accessToken === 'jeton-neuf' ? cb(null, { user: 1 }) : cb(null, { data: { status: '401' } }); },
    onData(stream, s, cb) { stream.resume(); stream.on('end', () => cb()); } });
  await listen(smtp, '127.0.0.1');
  const db = new DB(':memory:');
  const M = createMail(db, { encrypt: enc, decrypt: dec, filesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'officia-')),
    oauth: () => ({ clientId: 'app-test', authority: `http://127.0.0.1:${tokenSrv.address().port}` }) });
  // Jeton expiré : il doit être renouvelé avant la connexion.
  const acc = M.saveAccount({ email: 'secretariat@outlook.com', auth_type: 'oauth_ms', oauth: { access_token: 'vieux', refresh_token: 'refresh-1', expires_at: Date.now() - 1000 },
    imap_host: '127.0.0.1', imap_port: imap.server.address().port, imap_secure: 0, smtp_host: '127.0.0.1', smtp_port: smtp.server.address().port, smtp_secure: 0, save_sent: 0 });
  assert.equal(acc.has_oauth, true);
  assert.equal(acc.oauth_enc, undefined);
  try {
    const t = await M.testAccount(acc.id);
    assert.deepEqual(t, { smtp: 'ok', imap: 'ok' });
    assert.deepEqual(grants, ['refresh_token']); // un seul renouvellement, ensuite mis en cache
    assert.equal((await M.fetch(acc.id)).fetched, 2);
    assert.equal((await M.send({ account_id: acc.id, to_addr: 'dg@exemple.ci', subject: 'OAuth', text: 'ok' })).status, 'sent');
    assert.ok(tokens.every((x) => x === 'jeton-neuf'));
    assert.equal(JSON.parse(dec(db.byId('mail_accounts', acc.id).oauth_enc)).refresh_token, 'refresh-2');
  } finally { imap.close(); smtp.close(); tokenSrv.close(); }
});

test('messagerie : invitation calendrier (.ics) jointe, conservée si le message attend dans la boîte d’envoi', async () => {
  const received = [];
  const smtp = new SMTPServer({ disabledCommands: ['STARTTLS'], authOptional: true,
    onData(stream, s, cb) { let d = ''; stream.on('data', (c) => { d += c; }); stream.on('end', () => { received.push(d); cb(); }); } });
  await listen(smtp, '127.0.0.1');
  const db = new DB(':memory:');
  const M = createMail(db, { encrypt: enc, decrypt: dec, filesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'officia-')) });
  const ics = require('../electron/ics').calendar([{ id: 'ev1', title: 'Rendez-vous', start: '2026-11-02T10:00:00', end: '2026-11-02T11:00:00' }], { method: 'REQUEST' });
  const acc = M.saveAccount({ email: 'secretariat@exemple.ci', smtp_host: '127.0.0.1', smtp_port: 1, smtp_secure: 0 });
  try {
    assert.equal((await M.send({ account_id: acc.id, to_addr: 'visiteur@exemple.ci', subject: 'Invitation', text: 'Bonjour', ics })).status, 'queued');
    db.save('mail_accounts', { id: acc.id, smtp_port: smtp.server.address().port });
    assert.equal((await M.processOutbox()).sent, 1);
    assert.match(received[0], /Content-Type: text\/calendar; charset=utf-8; method=REQUEST/);
    assert.match(received[0], /invitation\.ics/);
  } finally { smtp.close(); }
});
