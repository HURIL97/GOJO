// Messagerie : envoi SMTP (nodemailer), réception IMAP (imapflow + mailparser), boîte d'envoi hors ligne.
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('node:fs');
const path = require('node:path');
const { stamp } = require('./db');

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

function createMail(db, { encrypt, decrypt, filesDir }) {
  const M = {};
  const pub = (a) => {
    if (!a) return a;
    const { password_enc, ...rest } = a;
    return { ...rest, has_password: !!password_enc };
  };

  M.preset = (email) => PRESETS[String(email || '').split('@')[1]?.toLowerCase()] || null;
  M.accounts = () => db.list('mail_accounts', {}, 'name').map(pub);
  M.saveAccount = (data) => {
    if (!data.email) throw new Error('Indiquez l’adresse e-mail');
    const row = { ...data };
    delete row.has_password;
    if (data.password) row.password_enc = encrypt(data.password);
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

  const transport = (a) => nodemailer.createTransport({
    host: a.smtp_host, port: Number(a.smtp_port) || 587, secure: !!Number(a.smtp_secure),
    auth: a.username ? { user: a.username, pass: a.password } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' },
  });
  const imap = (a) => new ImapFlow({
    host: a.imap_host, port: Number(a.imap_port) || 993, secure: !!Number(a.imap_secure),
    auth: { user: a.username, pass: a.password }, logger: false, socketTimeout: 30000,
  });

  M.testAccount = async (id) => {
    const a = account(id);
    const res = { smtp: null, imap: null };
    try { await transport(a).verify(); res.smtp = 'ok'; } catch (e) { res.smtp = e.message; }
    if (a.imap_host) {
      const c = imap(a);
      try { await c.connect(); res.imap = 'ok'; await c.logout(); } catch (e) { res.imap = e.message; }
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
    if (m && !m.read) db.save('mails', { id, read: 1 });
    return m;
  };
  M.counts = () => {
    const rows = db.all(`SELECT folder, COUNT(*) n, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) unread FROM mails WHERE deleted = 0 GROUP BY folder`);
    const out = {};
    for (const r of rows) out[r.folder] = { n: r.n, unread: r.unread };
    out.starred = { n: db.get(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND starred = 1`).n };
    return out;
  };
  M.update = (id, patch) => {
    const allowed = {};
    for (const k of ['read', 'starred', 'folder']) if (patch[k] !== undefined) allowed[k] = patch[k];
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

  const sendOne = async (m) => {
    const a = account(m.account_id);
    const from = a.display_name ? `"${a.display_name.replace(/"/g, '')}" <${a.email}>` : a.email;
    const atts = (Array.isArray(m.attachments) ? m.attachments : []).filter((x) => x.path && fs.existsSync(x.path)).map((x) => ({ filename: x.filename, path: x.path }));
    const info = await transport(a).sendMail({
      from, to: m.to_addr, cc: m.cc || undefined, bcc: m.bcc || undefined, subject: m.subject || '',
      text: m.text || '', html: m.html || undefined, attachments: atts, inReplyTo: m.in_reply_to || undefined,
    });
    db.save('mails', { id: m.id, folder: 'sent', message_id: info.messageId, from_addr: a.email, from_name: a.display_name || '', date: stamp(), error: null });
    return info;
  };

  // Envoie toute la boîte d'envoi ; une erreur réseau laisse le message en attente.
  M.processOutbox = async () => {
    const pending = db.all(`SELECT * FROM mails WHERE deleted = 0 AND folder = 'outbox' ORDER BY date`);
    const res = { sent: 0, waiting: 0, failed: 0 };
    for (const m of pending) {
      try { await sendOne(m); res.sent++; } catch (e) {
        const network = isNetworkError(e);
        db.save('mails', { id: m.id, tries: (m.tries || 0) + 1, error: network ? `En attente de connexion (${e.code || e.message})` : e.message });
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
      db.save('mails', { id: row.id, tries: 1, error: network ? `En attente de connexion (${e.code || e.message})` : e.message });
      if (!network) throw new Error(`Envoi refusé par le serveur : ${e.message}`);
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

  M.importRaw = async (accountId, raw, { uid, folder = 'inbox' } = {}) => {
    const parsed = await simpleParser(raw);
    const messageId = parsed.messageId || `${accountId}-${uid || Date.now()}`;
    if (db.get(`SELECT 1 FROM mails WHERE message_id = ? AND account_id = ? AND deleted = 0`, messageId, accountId)) return null;
    const from = parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0] : {};
    const row = db.save('mails', {
      account_id: accountId, folder, uid: uid || null, message_id: messageId,
      from_addr: from.address || '', from_name: from.name || '', to_addr: parsed.to ? parsed.to.text : '', cc: parsed.cc ? parsed.cc.text : '',
      subject: parsed.subject || '', text: parsed.text || '', html: parsed.html || null,
      date: stamp(parsed.date || new Date()), read: 0, starred: 0, in_reply_to: parsed.inReplyTo || null, attachments: [],
    });
    const atts = saveAttachments(row.id, parsed.attachments);
    if (atts.length) db.save('mails', { id: row.id, attachments: atts });
    return db.byId('mails', row.id);
  };

  M.fetch = async (accountId, { max = 100 } = {}) => {
    const a = account(accountId);
    if (!a.imap_host) return { fetched: 0 };
    const c = imap(a);
    const fresh = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock('INBOX');
      try {
        const status = c.mailbox;
        const lastUid = Number(a.last_uid) || 0;
        let range;
        if (lastUid) range = `${lastUid + 1}:*`;
        else range = `${Math.max(1, status.exists - max + 1)}:*`;
        const useUid = !!lastUid;
        let maxUid = lastUid;
        if (status.exists > 0) {
          for await (const msg of c.fetch(range, { uid: true, source: true }, { uid: useUid })) {
            if (msg.uid <= lastUid) continue;
            const m = await M.importRaw(a.id, msg.source, { uid: msg.uid });
            if (m) fresh.push(m);
            if (msg.uid > maxUid) maxUid = msg.uid;
          }
        }
        db.save('mail_accounts', { id: a.id, last_uid: maxUid, last_sync: stamp(), last_error: null });
      } finally { lock.release(); }
      await c.logout();
    } catch (e) {
      db.save('mail_accounts', { id: a.id, last_error: e.message });
      try { await c.logout(); } catch { /* déjà fermé */ }
      if (!isNetworkError(e)) throw e;
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
