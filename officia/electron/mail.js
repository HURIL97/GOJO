// Messagerie : envoi SMTP (nodemailer), réception IMAP (imapflow + mailparser), boîte d'envoi hors ligne.
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const crypto = require('node:crypto');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { stamp } = require('./db');
const { refreshMicrosoft } = require('./oauth');

const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ESOCKET', 'ECONNECTION']);
const isNetworkError = (e) => NETWORK_CODES.has(e.code) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|Greeting never received|Connection timeout/i.test(String(e.message));

// Réglages courants, préremplis à partir de l'adresse.
const PRESETS = {
  'gmail.com': { smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: 1, imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: 1 },
  'outlook.com': { smtp_host: 'smtp-mail.outlook.com', smtp_port: 587, smtp_secure: 0, imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: 1 },
  'hotmail.com': { smtp_host: 'smtp-mail.outlook.com', smtp_port: 587, smtp_secure: 0, imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: 1 },
  'office365.com': { smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: 0, imap_host: 'outlook.office365.com', imap_port: 993, imap_secure: 1 },
  'yahoo.com': { smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465, smtp_secure: 1, imap_host: 'imap.mail.yahoo.com', imap_port: 993, imap_secure: 1 },
  'yahoo.fr': { smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465, smtp_secure: 1, imap_host: 'imap.mail.yahoo.com', imap_port: 993, imap_secure: 1 },
  'orange.fr': { smtp_host: 'smtp.orange.fr', smtp_port: 465, smtp_secure: 1, imap_host: 'imap.orange.fr', imap_port: 993, imap_secure: 1 },
};

// Autorités de certification : celles de Node.js + celles installées dans Windows.
// Indispensable quand un antivirus (Avast, AVG, Kaspersky, ESET…) analyse les e-mails : il présente son propre
// certificat, reconnu par Windows mais pas par la liste intégrée de Node.js (réception OK, envoi refusé…).
let CA;
const trustedCAs = () => {
  if (CA !== undefined) return CA;
  try {
    const sys = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
    CA = sys.length ? [...new Set([...tls.getCACertificates('default'), ...sys])] : null;
  } catch { CA = null; }
  return CA;
};
const tlsOptions = () => (trustedCAs() ? { minVersion: 'TLSv1.2', ca: trustedCAs() } : { minVersion: 'TLSv1.2' });

// Hébergeurs qui rangent eux-mêmes une copie des messages envoyés par SMTP dans « Envoyés ».
const AUTO_SENT = /(^|[.-])(gmail|googlemail|office365|outlook|hotmail|live)\.com$/i;
// Dossiers du serveur relevés et leur équivalent dans OfficiaTech.
const FOLDER_MAP = [['inbox', null], ['sent', '\\Sent'], ['archive', '\\Archive'], ['junk', '\\Junk']];
const NAME_HINT = { sent: /^(sent|envoy|éléments envoyés|sent items|sent mail|messages envoyés)/i, archive: /^(archive)/i, junk: /^(junk|spam|courrier indésirable|indésirables|bulk)/i };

function createMail(db, { encrypt, decrypt, filesDir, oauth = () => ({}) }) {
  const M = {};
  const pub = (a) => {
    if (!a) return a;
    const { password_enc, oauth_enc, ...rest } = a;
    return { ...rest, has_password: !!password_enc, has_oauth: !!oauth_enc };
  };

  M.preset = (email) => {
    const domain = String(email || '').split('@')[1]?.toLowerCase();
    const p = PRESETS[domain];
    if (!p) return null;
    return { ...p, microsoft: /outlook|hotmail|live|office365/.test(domain) };
  };
  M.accounts = () => db.list('mail_accounts', {}, 'name').map(pub);
  M.saveAccount = (data) => {
    if (!data.email) throw new Error('Indiquez l’adresse e-mail');
    const row = { ...data };
    delete row.has_password; delete row.has_oauth; delete row.oauth;
    if (data.password) row.password_enc = encrypt(data.password);
    if (data.oauth) row.oauth_enc = encrypt(JSON.stringify(data.oauth));
    delete row.password;
    row.name = row.name || row.email;
    row.username = row.username || row.email;
    return pub(db.save('mail_accounts', row));
  };
  const account = (id) => {
    const a = db.byId('mail_accounts', id);
    if (!a) throw new Error('Compte de messagerie introuvable');
    return { ...a, password: a.password_enc ? decrypt(a.password_enc) : '' };
  };

  // Jeton d'accès Microsoft, renouvelé automatiquement avant expiration.
  const accessToken = async (a) => {
    const cur = db.byId('mail_accounts', a.id) || a; // jeton peut-être renouvelé entre-temps
    if (!cur.oauth_enc) throw Object.assign(new Error('Compte Microsoft non connecté : cliquez sur « Se connecter avec Microsoft »'), { oauth: true });
    let t = JSON.parse(decrypt(cur.oauth_enc));
    if (!t.expires_at || t.expires_at - Date.now() < 120000) {
      const cfg = oauth();
      t = await refreshMicrosoft({ ...cfg, refreshToken: t.refresh_token });
      db.save('mail_accounts', { id: a.id, oauth_enc: encrypt(JSON.stringify(t)) });
    }
    return t.access_token;
  };
  const isOauth = (a) => a.auth_type === 'oauth_ms';

  const transport = async (a, over = {}) => nodemailer.createTransport({
    host: a.smtp_host, port: Number(over.port ?? a.smtp_port) || 587, secure: !!Number(over.secure ?? a.smtp_secure),
    auth: isOauth(a) ? { type: 'OAuth2', user: a.username, accessToken: await accessToken(a) } : a.username && a.password ? { user: a.username, pass: a.password } : undefined,
    connectionTimeout: over.port ? 8000 : 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: tlsOptions(),
  });
  const imap = async (a) => new ImapFlow({
    host: a.imap_host, port: Number(a.imap_port) || 993, secure: !!Number(a.imap_secure),
    auth: isOauth(a) ? { user: a.username, accessToken: await accessToken(a) } : { user: a.username, pass: a.password },
    logger: false, socketTimeout: 30000, tls: tlsOptions(),
  });

  // Messages d'erreur compréhensibles (identifiants refusés, serveur introuvable…).
  const explain = (e) => {
    if (e.oauth) return e.message;
    if (e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535) {
      return /outlook|office365|hotmail|live/i.test(String(e.host || e.message || '')) || e.microsoft
        ? 'Connexion refusée par Microsoft : utilisez « Se connecter avec Microsoft »'
        : 'Identifiant ou mot de passe refusé par le serveur (Gmail/Yahoo : utilisez un mot de passe d’application)';
    }
    const msg = String(e.message || '');
    if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return 'Serveur introuvable : vérifiez l’adresse du serveur et la connexion Internet';
    if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|CERT_|certificate/i.test(`${e.code || ''} ${msg}`)) {
      return 'Certificat de sécurité non reconnu : un antivirus (Avast, AVG, Kaspersky, ESET…) ou un pare-feu d’entreprise intercepte probablement les e-mails. Désactivez son « analyse des e-mails sortants / SMTP » ou ajoutez OfficiaTech en exception.';
    }
    if (/wrong version number|ssl3_get_record|packet length too long|unknown protocol/i.test(msg)) return 'Mauvais réglage de sécurité pour ce port : 465 = SSL/TLS, 587 = STARTTLS';
    if (e.code === 'ETIMEDOUT' || /timeout|Greeting never received/i.test(msg)) return `Le serveur ne répond pas sur le port ${e.port || 'choisi'} : port bloqué par le réseau, le pare-feu ou l’antivirus de ce poste`;
    if (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return `Connexion refusée sur le port ${e.port || 'choisi'} : vérifiez le port, ou un pare-feu / antivirus bloque l’envoi`;
    if (e.code === 'ECONNRESET' || e.code === 'ESOCKET') return `Connexion interrompue (pare-feu ou antivirus ?) : ${msg}`;
    return msg;
  };
  const explainFor = (a) => (e) => { if (/outlook|office365|hotmail|live/i.test(`${a.smtp_host} ${a.imap_host}`) && !isOauth(a)) e.microsoft = true; return explain(e); };

  M.testAccount = async (id) => {
    const a = account(id);
    const ex = explainFor(a);
    const res = { smtp: null, imap: null };
    try { await (await transport(a)).verify(); res.smtp = 'ok'; } catch (e) {
      e.port = e.port || a.smtp_port;
      res.smtp = ex(e);
      // Envoi impossible sur ce port : on essaie l'autre réglage courant (465 SSL/TLS ↔ 587 STARTTLS).
      const authFail = e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535;
      if (!authFail && e.code !== 'ENOTFOUND' && !isOauth(a)) {
        const cur = `${Number(a.smtp_port)}/${Number(a.smtp_secure) ? 1 : 0}`;
        for (const alt of [{ port: 587, secure: 0 }, { port: 465, secure: 1 }, { port: 2525, secure: 0 }]) {
          if (`${alt.port}/${alt.secure}` === cur) continue;
          try { await (await transport(a, alt)).verify(); res.smtp_suggest = alt; break; } catch { /* essai suivant */ }
        }
      }
    }
    if (a.imap_host) {
      try { const c = await imap(a); await c.connect(); res.imap = 'ok'; await c.logout(); } catch (e) { res.imap = ex(e); }
    }
    return res;
  };

  // ---- Lecture locale ----
  M.list = ({ folder = 'inbox', account_id, q } = {}) => {
    const p = [folder];
    let w = 'deleted = 0 AND folder = ?';
    if (account_id) { w += ' AND account_id = ?'; p.push(account_id); }
    if (q) { w += ' AND (subject LIKE ? OR from_name LIKE ? OR from_addr LIKE ? OR to_addr LIKE ? OR text LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
    return db.all(`SELECT id, account_id, folder, from_addr, from_name, to_addr, cc, subject, substr(COALESCE(text,''),1,180) AS preview, date, read, starred,
        attachments, error FROM mails WHERE ${w} ORDER BY date DESC LIMIT 1000`, ...p);
  };
  M.get = (id) => {
    const m = db.byId('mails', id);
    if (m && !m.read) db.save('mails', { id, read: 1, flags_dirty: m.uid ? 1 : 0 });
    return m;
  };
  M.counts = () => {
    const rows = db.all(`SELECT folder, COUNT(*) n, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) unread FROM mails WHERE deleted = 0 GROUP BY folder`);
    const out = {};
    for (const r of rows) out[r.folder] = { n: r.n, unread: r.unread };
    out.starred = { n: db.get(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND starred = 1`).n };
    return out;
  };
  // Lu / non lu et favori sont aussi reportés sur le serveur (téléphone, webmail) à la relève suivante.
  M.update = (id, patch) => {
    const allowed = {};
    for (const k of ['read', 'starred', 'folder']) if (patch[k] !== undefined) allowed[k] = patch[k];
    const cur = db.byId('mails', id);
    if (cur && cur.uid && (allowed.read !== undefined || allowed.starred !== undefined)) allowed.flags_dirty = 1;
    return db.save('mails', { id, ...allowed });
  };
  M.starred = () => db.all(`SELECT id, account_id, folder, from_addr, from_name, to_addr, subject, substr(COALESCE(text,''),1,180) AS preview, date, read, starred, attachments
      FROM mails WHERE deleted = 0 AND starred = 1 ORDER BY date DESC LIMIT 500`);

  // ---- Rédaction et envoi ----
  M.saveDraft = (draft) => db.save('mails', { ...draft, folder: 'drafts', date: stamp(), read: 1 });

  M.queue = (draft) => {
    if (!draft.to_addr || !String(draft.to_addr).trim()) throw new Error('Indiquez au moins un destinataire');
    if (!draft.account_id) throw new Error('Configurez d’abord un compte de messagerie (Paramètres › Messagerie)');
    const row = db.save('mails', { ...draft, folder: 'outbox', date: stamp(), read: 1, tries: 0, error: null });
    return row;
  };

  const wantsSentCopy = (a) => (a.save_sent === null || a.save_sent === undefined || a.save_sent === '' ? !AUTO_SENT.test(String(a.smtp_host || '')) : !!Number(a.save_sent));

  // Boîtes spéciales du serveur (Envoyés, Archives, Indésirables).
  const specialBoxes = async (c) => {
    const list = await c.list();
    const out = { inbox: 'INBOX' };
    for (const [local, flag] of FOLDER_MAP) {
      if (!flag) continue;
      const hit = list.find((b) => b.specialUse === flag) || list.find((b) => NAME_HINT[local].test(b.name || '') || NAME_HINT[local].test(b.path || ''));
      if (hit) out[local] = hit.path;
    }
    return out;
  };

  // Copie du message envoyé dans le dossier « Envoyés » du serveur (visible sur le téléphone et le webmail).
  const appendSent = async (a, raw) => {
    const c = await imap(a);
    try {
      await c.connect();
      const boxes = await specialBoxes(c);
      if (!boxes.sent) return false;
      await c.append(boxes.sent, raw, ['\\Seen']);
      return boxes.sent;
    } finally { try { await c.logout(); } catch { /* déjà fermé */ } }
  };

  const sendOne = async (m) => {
    const a = account(m.account_id);
    const from = a.display_name ? `"${a.display_name.replace(/"/g, '')}" <${a.email}>` : a.email;
    const atts = (Array.isArray(m.attachments) ? m.attachments : []).filter((x) => x.path && fs.existsSync(x.path)).map((x) => ({ filename: x.filename, path: x.path }));
    const messageId = `<${crypto.randomUUID()}@${String(a.email).split('@')[1] || 'officiatech'}>`;
    const mail = {
      from, to: m.to_addr, cc: m.cc || undefined, bcc: m.bcc || undefined, subject: m.subject || '', messageId, date: new Date(),
      text: m.text || '', html: m.html || undefined, attachments: atts, inReplyTo: m.in_reply_to || undefined, references: m.in_reply_to || undefined,
    };
    if (m.ics) mail.icalEvent = { method: m.ics_method || 'REQUEST', filename: 'invitation.ics', content: m.ics };
    await (await transport(a)).sendMail(mail);
    db.save('mails', { id: m.id, folder: 'sent', message_id: messageId, from_addr: a.email, from_name: a.display_name || '', date: stamp(), error: null });
    if (a.imap_host && wantsSentCopy(a)) {
      try {
        const raw = await new MailComposer({ ...mail, bcc: undefined }).compile().build();
        const box = await appendSent(a, raw);
        if (box) db.save('mails', { id: m.id, imap_path: box });
      } catch (e) { console.error('Copie dans Envoyés impossible', e.message); }
    }
    return { messageId };
  };

  // Envoie toute la boîte d'envoi ; une erreur réseau laisse le message en attente.
  M.processOutbox = async () => {
    const pending = db.all(`SELECT * FROM mails WHERE deleted = 0 AND folder = 'outbox' ORDER BY date`);
    const res = { sent: 0, waiting: 0, failed: 0 };
    for (const m of pending) {
      try { await sendOne(m); res.sent++; } catch (e) {
        const network = isNetworkError(e);
        db.save('mails', { id: m.id, tries: (m.tries || 0) + 1, error: network ? `En attente de connexion (${e.code || e.message})` : explain(e) });
        if (network) res.waiting++; else res.failed++;
      }
    }
    return res;
  };

  M.send = async (draft) => {
    const row = M.queue(draft);
    try {
      await sendOne(db.byId('mails', row.id));
      return { status: 'sent', id: row.id };
    } catch (e) {
      const network = isNetworkError(e);
      const a = db.byId('mails', row.id) && account(draft.account_id);
      const msg = a ? explainFor(a)(e) : explain(e);
      db.save('mails', { id: row.id, tries: 1, error: network ? `En attente de connexion (${e.code || e.message})` : msg });
      if (!network) throw new Error(`Envoi refusé par le serveur : ${msg}`);
      return { status: 'queued', id: row.id };
    }
  };

  // ---- Réception ----
  const saveAttachments = (msgId, attachments) => {
    const dir = path.join(filesDir, 'mail', msgId);
    return (attachments || []).filter((a) => !a.related).map((a, i) => {
      fs.mkdirSync(dir, { recursive: true });
      const safe = (a.filename || `piece-jointe-${i + 1}`).replace(/[\\/:*?"<>|]/g, '_');
      const p = path.join(dir, safe);
      fs.writeFileSync(p, a.content);
      return { filename: safe, path: p, size: a.size || a.content.length, contentType: a.contentType };
    });
  };

  M.importRaw = async (accountId, raw, { uid, folder = 'inbox', imapPath, flags } = {}) => {
    const parsed = await simpleParser(raw);
    const messageId = parsed.messageId || `${accountId}-${imapPath || ''}-${uid || Date.now()}`;
    const known = db.get(`SELECT id, uid FROM mails WHERE message_id = ? AND account_id = ? AND deleted = 0`, messageId, accountId);
    if (known) {
      // Déjà présent (ex. message envoyé depuis OfficiaTech) : on le relie à sa copie sur le serveur.
      if (!known.uid && uid) db.save('mails', { id: known.id, uid, imap_path: imapPath || null });
      return null;
    }
    const from = parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0] : {};
    const fl = flags ? [...flags] : [];
    const row = db.save('mails', {
      account_id: accountId, folder, uid: uid || null, imap_path: imapPath || null, message_id: messageId,
      from_addr: from.address || '', from_name: from.name || '', to_addr: parsed.to ? parsed.to.text : '', cc: parsed.cc ? parsed.cc.text : '',
      subject: parsed.subject || '', text: parsed.text || '', html: parsed.html || null,
      date: stamp(parsed.date || new Date()), read: folder === 'sent' || fl.includes('\\Seen') ? 1 : 0, starred: fl.includes('\\Flagged') ? 1 : 0,
      in_reply_to: parsed.inReplyTo || null, attachments: [],
    });
    const atts = saveAttachments(row.id, parsed.attachments);
    if (atts.length) db.save('mails', { id: row.id, attachments: atts });
    return db.byId('mails', row.id);
  };

  // Relève un dossier du serveur : nouveaux messages (par UID), puis lu/non lu et favoris dans les deux sens.
  const syncBox = async (c, a, local, boxPath, state, max) => {
    const lock = await c.getMailboxLock(boxPath);
    const fresh = [];
    try {
      const mb = c.mailbox;
      const validity = String(mb.uidValidity || '');
      let st = state[boxPath] || {};
      if (local === 'inbox' && !st.last_uid && Number(a.last_uid)) st = { validity, last_uid: Number(a.last_uid) }; // ancienne version
      if (st.validity && st.validity !== validity) st = {};
      const lastUid = Number(st.last_uid) || 0;
      let maxUid = lastUid;
      if (mb.exists > 0) {
        const limit = local === 'inbox' ? max : Math.min(max, 50);
        const range = lastUid ? `${lastUid + 1}:*` : `${Math.max(1, mb.exists - limit + 1)}:*`;
        for await (const msg of c.fetch(range, { uid: true, flags: true, source: true }, { uid: !!lastUid })) {
          if (msg.uid <= lastUid) continue;
          const m = await M.importRaw(a.id, msg.source, { uid: msg.uid, folder: local, imapPath: boxPath, flags: msg.flags });
          if (m && local === 'inbox') fresh.push(m);
          if (msg.uid > maxUid) maxUid = msg.uid;
        }
      }
      // Changements faits dans OfficiaTech → serveur.
      const dirty = db.all(`SELECT id, uid, read, starred FROM mails WHERE deleted = 0 AND account_id = ? AND imap_path = ? AND flags_dirty = 1 AND uid IS NOT NULL`, a.id, boxPath);
      for (const m of dirty) {
        await (m.read ? c.messageFlagsAdd(String(m.uid), ['\\Seen'], { uid: true }) : c.messageFlagsRemove(String(m.uid), ['\\Seen'], { uid: true }));
        await (m.starred ? c.messageFlagsAdd(String(m.uid), ['\\Flagged'], { uid: true }) : c.messageFlagsRemove(String(m.uid), ['\\Flagged'], { uid: true }));
        db.run(`UPDATE mails SET flags_dirty = 0 WHERE id = ?`, m.id);
      }
      // Changements faits ailleurs (téléphone, webmail) → OfficiaTech, sur les 300 derniers messages.
      const recent = db.all(`SELECT id, uid, read, starred FROM mails WHERE deleted = 0 AND account_id = ? AND imap_path = ? AND uid IS NOT NULL AND flags_dirty = 0 ORDER BY uid DESC LIMIT 300`, a.id, boxPath);
      if (recent.length && mb.exists > 0) {
        const byUid = new Map(recent.map((m) => [m.uid, m]));
        const minUid = Math.min(...recent.map((m) => m.uid));
        const seen = new Set();
        for await (const msg of c.fetch(`${minUid}:*`, { uid: true, flags: true }, { uid: true })) {
          seen.add(msg.uid);
          const m = byUid.get(msg.uid);
          if (!m) continue;
          const read = msg.flags.has('\\Seen') ? 1 : 0;
          const starred = msg.flags.has('\\Flagged') ? 1 : 0;
          if (read !== m.read || starred !== m.starred) { db.run(`UPDATE mails SET read = ?, starred = ? WHERE id = ?`, read, starred, m.id); db.touch('mails'); }
        }
      }
      state[boxPath] = { validity, last_uid: maxUid };
    } finally { lock.release(); }
    return fresh;
  };

  M.fetch = async (accountId, { max = 100 } = {}) => {
    const a = account(accountId);
    if (!a.imap_host) return { fetched: 0 };
    const ex = explainFor(a);
    let c;
    const fresh = [];
    try {
      c = await imap(a);
      await c.connect();
      const state = a.folder_state && typeof a.folder_state === 'object' ? { ...a.folder_state } : {};
      let boxes = { inbox: 'INBOX' };
      try { boxes = await specialBoxes(c); } catch { /* LIST indisponible : boîte de réception seule */ }
      for (const [local] of FOLDER_MAP) {
        if (!boxes[local]) continue;
        fresh.push(...await syncBox(c, a, local, boxes[local], state, max));
      }
      db.save('mail_accounts', { id: a.id, last_uid: (state.INBOX || {}).last_uid || 0, folder_state: state, last_sync: stamp(), last_error: null });
      await c.logout();
    } catch (e) {
      if (process.env.OFFICIA_DEBUG) console.error(e);
      db.save('mail_accounts', { id: a.id, last_error: ex(e) });
      try { if (c) await c.logout(); } catch { /* déjà fermé */ }
      if (!isNetworkError(e)) throw new Error(ex(e));
      return { fetched: 0, offline: true };
    }
    return { fetched: fresh.length, mails: fresh };
  };

  M.fetchAll = async () => {
    let fetched = 0;
    const mails = [];
    for (const a of db.list('mail_accounts')) {
      if (!a.imap_host) continue;
      try { const r = await M.fetch(a.id); fetched += r.fetched; if (r.mails) mails.push(...r.mails); } catch { /* erreur conservée sur le compte */ }
    }
    return { fetched, mails };
  };

  return M;
}

module.exports = { createMail, isNetworkError };
