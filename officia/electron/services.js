// Logique métier d'OfficiaTech : agenda, réunions et PV, tâches, rappels, notifications, courrier, appels, recherche.
const crypto = require('node:crypto');
const { stamp } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const today = () => stamp().slice(0, 10);
const toDate = (s) => new Date(s.length === 10 ? `${s}T00:00:00` : s);
function addDays(day, n) { const d = toDate(day); d.setDate(d.getDate() + n); return stamp(d).slice(0, 10); }
function addMinutes(ts, n) { const d = toDate(ts); d.setMinutes(d.getMinutes() + n); return stamp(d); }
function shift(ts, unit, n) {
  const d = toDate(ts);
  if (unit === 'daily') d.setDate(d.getDate() + n);
  else if (unit === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (unit === 'monthly') d.setMonth(d.getMonth() + n);
  else if (unit === 'yearly') d.setFullYear(d.getFullYear() + n);
  return stamp(d);
}
const minutesBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 60000);

const DEFAULT_SETTINGS = {
  user_name: '', user_title: 'Assistante de direction', organisation: '', org_address: '', org_phone: '',
  manager_name: '', workday_start: '08:00', workday_end: '18:00', default_reminder: '15',
  notify_native: '1', notify_sound: '1', minimize_to_tray: '1', start_with_windows: '0',
  task_digest_hour: '08:00', lock_pin: '', mail_sync_minutes: '5', theme: 'dark', phone_country: '225',
  // Papier à en-tête
  org_email: '', org_footer: '', org_logo: '', org_city: '', letter_signatory: '',
  // Rappels automatiques
  visitor_reminder: '1', visitor_reminder_hour: '16:00', courrier_auto_relance: '0', courrier_relance_days: '3',
  // Sécurité
  lock_idle_minutes: '10', backup_dir: '', backup_keep: '30',
  // Équipe (serveur sur le VPS)
  sync_url: '', sync_token: '', sync_interval: '30', device_name: '',
  // Connexion Microsoft (Outlook, Hotmail, Microsoft 365)
  ms_client_id: '', ms_tenant: 'common',
};

const TYPES = ['reunion', 'rdv', 'appel', 'deplacement', 'echeance', 'perso', 'autre'];

const contactName = (c) => (c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || c.email || '' : '');
const hashPin = (pin) => { const salt = crypto.randomBytes(8).toString('hex'); return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`; };
const checkPin = (pin, stored) => {
  if (!stored) return true;
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(String(pin), salt, 32), Buffer.from(h, 'hex'));
};

function createServices(db) {
  const S = {};

  // ---------- Paramètres ----------
  S.settings = () => {
    const out = { ...DEFAULT_SETTINGS };
    for (const r of db.list('settings')) out[r.key] = r.value;
    out.has_lock = out.lock_pin ? '1' : '0';
    delete out.lock_pin;
    return out;
  };
  S.saveSettings = (values) =>
    db.tx(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!(key in DEFAULT_SETTINGS) || key === 'lock_pin') continue;
        db.save('settings', { id: `set_${key}`, key, value: value == null ? '' : String(value) });
      }
      return S.settings();
    });
  S.setLockPin = (pin) => {
    if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('Le code doit contenir 4 à 8 chiffres');
    db.save('settings', { id: 'set_lock_pin', key: 'lock_pin', value: pin ? hashPin(pin) : '' });
    return S.settings();
  };
  S.unlock = (pin) => {
    const r = db.get(`SELECT value FROM settings WHERE key = 'lock_pin' AND deleted = 0`);
    if (!checkPin(pin, r && r.value)) throw new Error('Code incorrect');
    return true;
  };
  S.isFirstRun = () => !db.get(`SELECT 1 FROM settings WHERE key = 'user_name' AND value <> '' AND deleted = 0`);

  // ---------- Contacts ----------
  S.contacts = (q) => {
    const p = [];
    let w = 'deleted = 0';
    if (q) { w += ' AND (first_name LIKE ? OR last_name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ? OR mobile LIKE ? OR tags LIKE ?)'; p.push(...Array(7).fill(`%${q}%`)); }
    return db.all(`SELECT * FROM contacts WHERE ${w} ORDER BY favorite DESC, last_name, first_name, company LIMIT 2000`, ...p);
  };
  S.contactHistory = (id) => ({
    events: db.all(`SELECT * FROM events WHERE deleted = 0 AND (contact_id = ? OR participants LIKE ?) ORDER BY start DESC LIMIT 50`, id, `%${id}%`),
    calls: db.all(`SELECT * FROM calls WHERE deleted = 0 AND contact_id = ? ORDER BY date DESC LIMIT 50`, id),
    courrier: db.all(`SELECT * FROM courrier WHERE deleted = 0 AND contact_id = ? ORDER BY date DESC LIMIT 50`, id),
  });

  // Import CSV (Excel, Outlook, Gmail) : colonnes reconnues automatiquement, doublons ignorés.
  const HEADERS = {
    first_name: ['prénom', 'prenom', 'first name', 'given name', 'firstname'],
    last_name: ['nom', 'last name', 'family name', 'surname', 'lastname', 'nom de famille'],
    full_name: ['name', 'nom complet', 'full name', 'contact'],
    company: ['société', 'societe', 'entreprise', 'company', 'organisation', 'organization', 'organization 1 - name', 'organisme'],
    title: ['fonction', 'poste', 'job title', 'title', 'titre', 'organization 1 - title'],
    email: ['e-mail', 'email', 'courriel', 'adresse e-mail', 'adresse de messagerie', 'e-mail address', 'email address', 'e-mail 1 - value', 'mail'],
    phone: ['téléphone', 'telephone', 'tél', 'tel', 'phone', 'business phone', 'téléphone bureau', 'téléphone (bureau)', 'phone 1 - value', 'fixe'],
    mobile: ['mobile', 'portable', 'mobile phone', 'téléphone mobile', 'tél. mobile', 'cellulaire', 'phone 2 - value'],
    address: ['adresse', 'address', 'business street', 'rue (bureau)', 'address 1 - formatted'],
    notes: ['notes', 'remarques', 'commentaire'],
  };
  const parseCsv = (text) => {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  };
  S.importContacts = (text) =>
    db.tx(() => {
      const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
      if (rows.length < 2) throw new Error('Le fichier ne contient aucun contact');
      const head = rows[0].map((h) => h.trim().toLowerCase());
      const col = {};
      for (const [k, names] of Object.entries(HEADERS)) {
        const i = head.findIndex((h) => names.includes(h));
        if (i >= 0) col[k] = i;
      }
      if (['last_name', 'first_name', 'full_name', 'email', 'company'].every((k) => col[k] === undefined)) {
        throw new Error('Colonnes non reconnues : la première ligne doit contenir des en-têtes comme « Nom », « Prénom », « E-mail », « Téléphone »');
      }
      const known = new Set(db.all(`SELECT lower(email) e FROM contacts WHERE deleted = 0 AND email <> ''`).map((r) => r.e));
      let added = 0;
      let skipped = 0;
      for (const r of rows.slice(1)) {
        const v = (k) => (col[k] !== undefined ? String(r[col[k]] || '').trim() : '');
        const c = { first_name: v('first_name'), last_name: v('last_name'), company: v('company'), title: v('title'), email: v('email'), phone: v('phone'), mobile: v('mobile'), address: v('address'), notes: v('notes') };
        if (!c.first_name && !c.last_name && v('full_name')) {
          const parts = v('full_name').split(/\s+/);
          c.first_name = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
          c.last_name = parts[parts.length - 1];
        }
        if (!c.first_name && !c.last_name && !c.company && !c.email) { skipped++; continue; }
        if (c.email && known.has(c.email.toLowerCase())) { skipped++; continue; }
        if (c.email) known.add(c.email.toLowerCase());
        db.save('contacts', { ...c, color: '#7b6cff' });
        added++;
      }
      return { added, skipped };
    });

  // ---------- Agenda ----------
  // Développe les occurrences d'un évènement récurrent dans l'intervalle [from, to].
  const occurrences = (ev, from, to) => {
    const dur = Math.max(0, minutesBetween(ev.start, ev.end || ev.start));
    const out = [];
    const until = ev.recur_until ? `${ev.recur_until}T23:59:59` : null;
    for (let i = 0, s = ev.start; i < 1500; i++, s = shift(ev.start, ev.recurrence, i)) {
      if (until && s > until) break;
      if (s > `${to}T23:59:59`) break;
      const e = addMinutes(s, dur);
      if (e >= `${from}T00:00:00` || s >= `${from}T00:00:00`) {
        out.push({ ...ev, occ_id: i ? `${ev.id}@${s}` : ev.id, start: s, end: e, occurrence: i });
      }
      if (!ev.recurrence || ev.recurrence === 'none') break;
    }
    return out;
  };

  S.agenda = (from, to) => {
    const rows = db.all(`SELECT e.*, c.first_name, c.last_name, c.company FROM events e LEFT JOIN contacts c ON c.id = e.contact_id
        WHERE e.deleted = 0 AND (
          (COALESCE(e.recurrence,'none') = 'none' AND e.start <= ? AND COALESCE(e.end, e.start) >= ?)
          OR (COALESCE(e.recurrence,'none') <> 'none' AND e.start <= ? AND (e.recur_until IS NULL OR e.recur_until = '' OR e.recur_until >= ?)))
        ORDER BY e.start`, `${to}T23:59:59`, `${from}T00:00:00`, `${to}T23:59:59`, from);
    const out = [];
    for (const ev of rows) out.push(...occurrences(ev, from, to));
    return out.sort((a, b) => a.start.localeCompare(b.start));
  };

  S.conflicts = (start, end, excludeId) => {
    if (!start || !end) return [];
    return S.agenda(start.slice(0, 10), end.slice(0, 10))
      .filter((e) => e.id !== excludeId && !e.all_day && e.status !== 'annule' && e.start < end && e.end > start);
  };

  S.saveEvent = (data) =>
    db.tx(() => {
      if (!data.title) throw new Error('Indiquez un titre');
      if (!data.start) throw new Error('Indiquez la date de début');
      const row = { ...data };
      if (!row.end || row.end < row.start) row.end = addMinutes(row.start, 60);
      if (!TYPES.includes(row.type)) row.type = 'autre';
      delete row.occ_id; delete row.occurrence; delete row.first_name; delete row.last_name; delete row.company;
      const before = row.id ? db.byId('events', row.id) : null;
      // Rendez-vous déplacé : nouvelle version de l'invitation, le visiteur sera prévenu à nouveau.
      if (before && (before.start !== row.start || before.end !== row.end || (before.status !== row.status && row.status === 'annule'))) {
        row.ics_seq = (Number(before.ics_seq) || 0) + 1;
        if (before.start !== row.start) row.visitor_reminded_at = null;
      }
      const ev = db.save('events', row);
      // Une réunion de l'agenda a toujours sa fiche réunion (ordre du jour, PV).
      if (ev.type === 'reunion') {
        const m = ev.meeting_id ? db.byId('meetings', ev.meeting_id) : null;
        const patch = { title: ev.title, start: ev.start, end: ev.end, location: ev.location, visio_url: ev.visio_url, event_id: ev.id };
        if (m) db.save('meetings', { id: m.id, ...patch });
        else {
          const created = db.save('meetings', { ...patch, objective: ev.description || '', agenda: [], participants: participantsFrom(ev), status: 'preparation' });
          db.save('events', { id: ev.id, meeting_id: created.id });
        }
      }
      return db.byId('events', ev.id);
    });

  const participantsFrom = (ev) => (Array.isArray(ev.participants) ? ev.participants : []).map((id) => {
    const c = db.byId('contacts', id);
    return c ? { contact_id: c.id, name: contactName(c), email: c.email || '', role: c.title || '', presence: '' } : null;
  }).filter(Boolean);

  S.setEventStatus = (id, status) => db.save('events', { id, status });

  // ---------- Réunions ----------
  S.meetings = ({ status, q } = {}) => {
    const p = [];
    let w = 'deleted = 0';
    if (status) { w += ' AND status = ?'; p.push(status); }
    if (q) { w += ' AND (title LIKE ? OR location LIKE ? OR objective LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    return db.all(`SELECT * FROM meetings WHERE ${w} ORDER BY start DESC LIMIT 1000`, ...p);
  };

  S.meeting = (id) => {
    const m = db.byId('meetings', id);
    if (!m) throw new Error('Réunion introuvable');
    m.agenda = Array.isArray(m.agenda) ? m.agenda : [];
    m.participants = Array.isArray(m.participants) ? m.participants : [];
    m.minutes = m.minutes && typeof m.minutes === 'object' ? m.minutes : { intro: '', points: [], actions: [], conclusion: '', next_meeting: '' };
    m.tasks = db.all(`SELECT * FROM tasks WHERE deleted = 0 AND meeting_id = ? ORDER BY due`, id);
    return m;
  };

  S.saveMeeting = (data) =>
    db.tx(() => {
      if (!data.title) throw new Error('Indiquez l’intitulé de la réunion');
      if (!data.start) throw new Error('Indiquez la date de la réunion');
      const row = { ...data };
      delete row.tasks;
      if (!row.end || row.end < row.start) row.end = addMinutes(row.start, 90);
      const m = db.save('meetings', row);
      // Synchronise l'évènement d'agenda correspondant.
      const evPatch = { title: m.title, type: 'reunion', start: m.start, end: m.end, location: m.location, visio_url: m.visio_url, meeting_id: m.id,
        participants: (m.participants || []).map((p) => p.contact_id).filter(Boolean) };
      if (m.event_id && db.byId('events', m.event_id)) db.save('events', { id: m.event_id, ...evPatch });
      else {
        const ev = db.save('events', { ...evPatch, status: 'planifie', reminder_min: 30, recurrence: 'none' });
        db.save('meetings', { id: m.id, event_id: ev.id });
      }
      // Les actions décidées deviennent des tâches suivies.
      const minutes = m.minutes && typeof m.minutes === 'object' ? m.minutes : null;
      if (minutes && Array.isArray(minutes.actions)) {
        let changed = false;
        for (const a of minutes.actions) {
          if (!a.title) continue;
          const t = { title: a.title, assignee: a.owner || '', due: a.due || null, meeting_id: m.id, priority: a.priority || 'normale', description: `Action décidée lors de « ${m.title} »` };
          if (a.task_id && db.byId('tasks', a.task_id)) db.save('tasks', { id: a.task_id, ...t });
          else { a.task_id = db.save('tasks', { ...t, status: 'a_faire' }).id; changed = true; }
        }
        if (changed) db.save('meetings', { id: m.id, minutes });
      }
      return S.meeting(m.id);
    });

  S.setMeetingStatus = (id, status, extra = {}) => {
    const patch = { id, status, ...extra };
    if (status === 'convoquee') patch.convocation_sent_at = stamp();
    if (status === 'pv_valide') patch.pv_validated_at = stamp();
    if (status === 'pv_diffuse') patch.pv_sent_at = stamp();
    db.save('meetings', patch);
    if (status === 'tenue' || status === 'pv_valide' || status === 'pv_diffuse') {
      const m = db.byId('meetings', id);
      if (m.event_id) db.save('events', { id: m.event_id, status: 'termine' });
    }
    return S.meeting(id);
  };

  // ---------- Tâches ----------
  S.tasks = ({ status, q, scope } = {}) => {
    const p = [];
    let w = 't.deleted = 0';
    if (status) { w += ' AND t.status = ?'; p.push(status); }
    if (q) { w += ' AND (t.title LIKE ? OR t.description LIKE ? OR t.assignee LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const d = today();
    if (scope === 'today') { w += ` AND t.status <> 'terminee' AND t.due <= ?`; p.push(d); }
    if (scope === 'late') { w += ` AND t.status <> 'terminee' AND t.due < ?`; p.push(d); }
    return db.all(`SELECT t.*, m.title AS meeting_title FROM tasks t LEFT JOIN meetings m ON m.id = t.meeting_id
        WHERE ${w} ORDER BY CASE t.status WHEN 'terminee' THEN 1 ELSE 0 END,
        CASE t.priority WHEN 'urgente' THEN 0 WHEN 'haute' THEN 1 WHEN 'normale' THEN 2 ELSE 3 END, COALESCE(t.due,'9999'), t.sort LIMIT 2000`, ...p);
  };
  S.saveTask = (data) => {
    if (!data.id && !data.title) throw new Error('Indiquez l’intitulé de la tâche');
    const row = { ...data };
    delete row.meeting_title;
    if (row.status === 'terminee' && !row.done_at) row.done_at = stamp();
    if (row.status && row.status !== 'terminee') row.done_at = null;
    return db.save('tasks', row);
  };

  // ---------- Rappels ----------
  S.reminders = ({ include_done } = {}) =>
    db.all(`SELECT * FROM reminders WHERE deleted = 0 ${include_done ? '' : 'AND done = 0'} ORDER BY done, due LIMIT 1000`);
  S.saveReminder = (data) => {
    if (!data.title) throw new Error('Indiquez l’objet du rappel');
    if (!data.due) throw new Error('Indiquez la date et l’heure du rappel');
    return db.save('reminders', { ...data, fired_at: data.id && data.due !== (db.byId('reminders', data.id) || {}).due ? null : data.fired_at });
  };
  S.completeReminder = (id) => {
    const r = db.byId('reminders', id);
    if (!r) throw new Error('Rappel introuvable');
    if (r.repeat && r.repeat !== 'none') {
      let next = shift(r.due, r.repeat, 1);
      while (next < stamp()) next = shift(next, r.repeat, 1);
      return db.save('reminders', { id, due: next, fired_at: null });
    }
    return db.save('reminders', { id, done: 1 });
  };
  S.snoozeReminder = (id, minutes = 10) => db.save('reminders', { id, due: addMinutes(stamp(), minutes), fired_at: null, done: 0 });

  // ---------- Notifications ----------
  const notify = (n) => {
    if (n.dedupe && db.get('SELECT 1 FROM notifications WHERE dedupe = ?', n.dedupe)) return null;
    return db.save('notifications', { date: stamp(), read: 0, ...n });
  };
  S.notify = notify;
  S.notifications = (limit = 100) => db.all(`SELECT * FROM notifications WHERE deleted = 0 ORDER BY date DESC LIMIT ?`, limit);
  S.unreadCount = () => db.get(`SELECT COUNT(*) n FROM notifications WHERE deleted = 0 AND read = 0`).n;
  S.markRead = (id) => (id ? db.save('notifications', { id, read: 1 }) : db.run(`UPDATE notifications SET read = 1 WHERE read = 0`));
  S.clearNotifications = () => { db.run(`UPDATE notifications SET deleted = 1 WHERE read = 1`); db.touch('notifications'); return true; };

  const hm = (s) => s.slice(11, 16);
  // Vérifie les échéances : à appeler régulièrement (toutes les 30 s). Renvoie les nouvelles notifications.
  S.tick = (now = stamp()) => {
    const fresh = [];
    const push = (n) => { const r = notify(n); if (r) fresh.push(r); };
    const day = now.slice(0, 10);
    // 1) Évènements qui commencent bientôt.
    for (const ev of S.agenda(day, addDays(day, 1))) {
      if (ev.status === 'annule' || ev.all_day) continue;
      const lead = Number(ev.reminder_min);
      if (!(lead >= 0)) continue;
      const at = addMinutes(ev.start, -lead);
      if (at <= now && ev.start >= addMinutes(now, -1)) {
        const label = { reunion: 'Réunion', rdv: 'Rendez-vous', appel: 'Appel', deplacement: 'Déplacement', echeance: 'Échéance' }[ev.type] || 'Évènement';
        const mins = minutesBetween(now, ev.start);
        push({ kind: ev.type === 'reunion' ? 'meeting' : 'event', title: `${label} ${mins > 0 ? `dans ${mins} min` : 'maintenant'} : ${ev.title}`,
          body: `${hm(ev.start)}–${hm(ev.end)}${ev.location ? ` · ${ev.location}` : ''}`, link_type: ev.type === 'reunion' && ev.meeting_id ? 'meeting' : 'event',
          link_id: ev.type === 'reunion' && ev.meeting_id ? ev.meeting_id : ev.id, dedupe: `ev:${ev.id}:${ev.start}` });
      }
    }
    // 2) Rappels arrivés à échéance.
    for (const r of db.all(`SELECT * FROM reminders WHERE deleted = 0 AND done = 0 AND due <= ? AND (fired_at IS NULL OR fired_at = '')`, now)) {
      push({ kind: 'reminder', title: `Rappel : ${r.title}`, body: r.note || `Prévu à ${hm(r.due)}`, link_type: 'reminder', link_id: r.id, dedupe: `rem:${r.id}:${r.due}` });
      db.save('reminders', { id: r.id, fired_at: now });
    }
    // 3) Récapitulatif quotidien des tâches (à l'heure choisie).
    const set = S.settings();
    if (now.slice(11, 16) >= (set.task_digest_hour || '08:00')) {
      const due = db.all(`SELECT * FROM tasks WHERE deleted = 0 AND status <> 'terminee' AND due IS NOT NULL AND due <= ?`, day);
      if (due.length) {
        const late = due.filter((t) => t.due < day).length;
        push({ kind: 'task', title: `${due.length} tâche${due.length > 1 ? 's' : ''} à traiter aujourd’hui`, body: late ? `dont ${late} en retard` : due.slice(0, 3).map((t) => t.title).join(' · '),
          link_type: 'tasks', dedupe: `tasks:${day}` });
      }
      const cour = db.get(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND status IN ('enregistre','en_traitement') AND due IS NOT NULL AND due <= ?`, day).n;
      if (cour) push({ kind: 'courrier', title: `${cour} courrier${cour > 1 ? 's' : ''} à traiter (échéance atteinte)`, body: 'Registre du courrier', link_type: 'courrier', dedupe: `cour:${day}` });
    }
    return fresh;
  };

  // ---------- Courrier ----------
  S.courrier = ({ direction, status, q, year } = {}) => {
    const p = [];
    let w = 'deleted = 0';
    if (direction) { w += ' AND direction = ?'; p.push(direction); }
    if (status) { w += ' AND status = ?'; p.push(status); }
    if (year) { w += ' AND substr(date,1,4) = ?'; p.push(String(year)); }
    if (q) { w += ' AND (number LIKE ? OR correspondent LIKE ? OR object LIKE ? OR reference LIKE ? OR assigned_to LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
    return db.all(`SELECT * FROM courrier WHERE ${w} ORDER BY date DESC, number DESC LIMIT 5000`, ...p);
  };
  S.saveCourrier = (data) =>
    db.tx(() => {
      if (!data.correspondent) throw new Error('Indiquez l’expéditeur ou le destinataire');
      if (!data.object) throw new Error('Indiquez l’objet du courrier');
      const row = { ...data, date: data.date || today() };
      if (!row.id) {
        // Numérotation chronologique par année et par sens : A-2026-0001 / D-2026-0001.
        const prefix = `${row.direction === 'depart' ? 'D' : 'A'}-${row.date.slice(0, 4)}-`;
        const last = db.get(`SELECT number FROM courrier WHERE number LIKE ? ORDER BY number DESC LIMIT 1`, `${prefix}%`);
        row.number = `${prefix}${String((last ? Number(last.number.slice(-4)) : 0) + 1).padStart(4, '0')}`;
        row.circuit = [{ date: stamp(), action: 'enregistre', to: '', note: row.direction === 'depart' ? 'Courrier départ' : 'Courrier arrivée', by: S.settings().user_name || '' }];
      }
      const before = row.id ? db.byId('courrier', row.id) : null;
      if (row.status === 'traite' && (!before || before.status !== 'traite') && !row.treated_at) row.treated_at = stamp();
      const saved = db.save('courrier', row);
      // Réponse à un courrier arrivé : celui-ci passe en « Traité ».
      if (!before && saved.reply_to_id) {
        const orig = db.byId('courrier', saved.reply_to_id);
        if (orig && !['traite', 'archive'].includes(orig.status)) S.courrierStep(orig.id, { action: 'reponse', note: `Réponse ${saved.number}` });
      }
      return saved;
    });

  // ---------- Appels ----------
  S.calls = ({ status, q } = {}) => {
    const p = [];
    let w = 'deleted = 0';
    if (status) { w += ' AND status = ?'; p.push(status); }
    if (q) { w += ' AND (caller LIKE ? OR company LIKE ? OR phone LIKE ? OR message LIKE ? OR for_whom LIKE ?)'; p.push(...Array(5).fill(`%${q}%`)); }
    return db.all(`SELECT * FROM calls WHERE ${w} ORDER BY date DESC LIMIT 2000`, ...p);
  };
  S.saveCall = (data) => {
    if (!data.caller) throw new Error('Indiquez le nom de l’appelant');
    const c = db.save('calls', { ...data, date: data.date || stamp() });
    if (!data.id && c.urgent && c.status === 'a_rappeler') {
      notify({ kind: 'call', title: `Appel urgent : ${c.caller}${c.company ? ` (${c.company})` : ''}`, body: c.message || `Rappeler au ${c.phone || '—'}`, link_type: 'calls', link_id: c.id, dedupe: `call:${c.id}` });
    }
    return c;
  };

  // ---------- Recherche globale ----------
  S.search = (q) => {
    if (!q || q.trim().length < 2) return [];
    const like = `%${q.trim()}%`;
    const out = [];
    for (const c of db.all(`SELECT * FROM contacts WHERE deleted = 0 AND (first_name LIKE ? OR last_name LIKE ? OR company LIKE ? OR email LIKE ? OR phone LIKE ?) LIMIT 8`, like, like, like, like, like))
      out.push({ type: 'contact', id: c.id, title: contactName(c), sub: [c.company, c.email, c.phone].filter(Boolean).join(' · ') });
    for (const e of db.all(`SELECT * FROM events WHERE deleted = 0 AND (title LIKE ? OR location LIKE ? OR description LIKE ?) ORDER BY start DESC LIMIT 8`, like, like, like))
      out.push({ type: 'event', id: e.id, title: e.title, sub: `${e.start.slice(0, 16).replace('T', ' ')}${e.location ? ` · ${e.location}` : ''}`, date: e.start });
    for (const m of db.all(`SELECT * FROM meetings WHERE deleted = 0 AND (title LIKE ? OR objective LIKE ? OR minutes LIKE ?) ORDER BY start DESC LIMIT 8`, like, like, like))
      out.push({ type: 'meeting', id: m.id, title: m.title, sub: m.start.slice(0, 16).replace('T', ' ') });
    for (const t of db.all(`SELECT * FROM tasks WHERE deleted = 0 AND (title LIKE ? OR description LIKE ?) LIMIT 8`, like, like))
      out.push({ type: 'task', id: t.id, title: t.title, sub: t.due ? `Échéance ${t.due}` : 'Sans échéance' });
    for (const m of db.all(`SELECT * FROM mails WHERE deleted = 0 AND (subject LIKE ? OR from_name LIKE ? OR from_addr LIKE ? OR to_addr LIKE ? OR text LIKE ?) ORDER BY date DESC LIMIT 8`, like, like, like, like, like))
      out.push({ type: 'mail', id: m.id, title: m.subject || '(sans objet)', sub: `${m.folder === 'sent' ? 'À ' + (m.to_addr || '') : m.from_name || m.from_addr || ''}` });
    for (const c of db.all(`SELECT * FROM courrier WHERE deleted = 0 AND (number LIKE ? OR correspondent LIKE ? OR object LIKE ?) LIMIT 8`, like, like, like))
      out.push({ type: 'courrier', id: c.id, title: `${c.number} — ${c.object}`, sub: c.correspondent });
    for (const c of db.all(`SELECT * FROM calls WHERE deleted = 0 AND (caller LIKE ? OR company LIKE ? OR message LIKE ?) LIMIT 5`, like, like, like))
      out.push({ type: 'call', id: c.id, title: c.caller, sub: c.message || c.phone || '' });
    return out;
  };

  // ---------- Tableau de bord « Ma journée » ----------
  S.dashboard = () => {
    const d = today();
    const now = stamp();
    const weekStart = (() => { const x = toDate(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return stamp(x).slice(0, 10); })();
    const todayEvents = S.agenda(d, d).filter((e) => e.status !== 'annule');
    const week = S.agenda(weekStart, addDays(weekStart, 6)).filter((e) => e.status !== 'annule');
    const next = S.agenda(d, addDays(d, 30)).find((e) => e.start >= now && e.status !== 'annule' && !e.all_day) || null;
    const load = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const evs = week.filter((e) => e.start.slice(0, 10) === day);
      return { day, count: evs.length, meetings: evs.filter((e) => e.type === 'reunion').length, rdv: evs.filter((e) => e.type === 'rdv').length,
        hours: Math.round(evs.reduce((s, e) => s + (e.all_day ? 0 : minutesBetween(e.start, e.end)), 0) / 6) / 10 };
    });
    const open = db.all(`SELECT * FROM tasks WHERE deleted = 0 AND status <> 'terminee'`);
    const byPriority = ['urgente', 'haute', 'normale', 'basse'].map((p) => ({ priority: p, n: open.filter((t) => t.priority === p).length }));
    const doneWeek = db.get(`SELECT COUNT(*) n FROM tasks WHERE deleted = 0 AND status = 'terminee' AND substr(done_at,1,10) >= ?`, weekStart).n;
    const tasksToday = S.tasks({ scope: 'today' }).slice(0, 8);
    const meetings = db.all(`SELECT * FROM meetings WHERE deleted = 0 AND start >= ? ORDER BY start LIMIT 5`, `${d}T00:00:00`);
    const pvTodo = db.all(`SELECT * FROM meetings WHERE deleted = 0 AND start < ? AND status IN ('preparation','convoquee','tenue') ORDER BY start DESC LIMIT 5`, now);
    const reminders = db.all(`SELECT * FROM reminders WHERE deleted = 0 AND done = 0 ORDER BY due LIMIT 6`);
    const unread = db.get(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND folder = 'inbox' AND read = 0`).n;
    const outbox = db.get(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND folder = 'outbox'`).n;
    const recentMails = db.all(`SELECT id, from_name, from_addr, subject, date, read, starred FROM mails WHERE deleted = 0 AND folder = 'inbox' ORDER BY date DESC LIMIT 5`);
    const courrierTodo = db.get(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND status IN ('enregistre','en_traitement')`).n;
    const courrierMonth = db.all(`SELECT direction, COUNT(*) n FROM courrier WHERE deleted = 0 AND substr(date,1,7) = ? GROUP BY direction`, d.slice(0, 7));
    const calls = db.all(`SELECT * FROM calls WHERE deleted = 0 AND status = 'a_rappeler' ORDER BY urgent DESC, date DESC LIMIT 6`);
    const types = TYPES.map((t) => ({ type: t, n: week.filter((e) => e.type === t).length })).filter((x) => x.n);
    const notes = db.all(`SELECT * FROM notes WHERE deleted = 0 ORDER BY pinned DESC, updated_at DESC LIMIT 6`);
    return {
      today: d, now, weekStart, todayEvents, next, load, byPriority, tasksToday, meetings, pvTodo, reminders, recentMails, calls, types, notes,
      kpi: {
        eventsToday: todayEvents.length, rdvToday: todayEvents.filter((e) => e.type === 'rdv').length,
        meetingsWeek: week.filter((e) => e.type === 'reunion').length, openTasks: open.length,
        lateTasks: open.filter((t) => t.due && t.due < d).length, doneWeek, unread, outbox, courrierTodo,
        callsTodo: db.get(`SELECT COUNT(*) n FROM calls WHERE deleted = 0 AND status = 'a_rappeler'`).n,
        courrierIn: (courrierMonth.find((x) => x.direction === 'arrivee') || {}).n || 0,
        courrierOut: (courrierMonth.find((x) => x.direction === 'depart') || {}).n || 0,
        weekHours: Math.round(load.reduce((s, x) => s + x.hours, 0) * 10) / 10,
      },
    };
  };

  // ---------- Import d'agenda (.ics) ----------
  S.importEvents = (events) =>
    db.tx(() => {
      let added = 0;
      let updated = 0;
      for (const e of events || []) {
        if (!e.start || !e.title) continue;
        const ex = e.uid ? db.get(`SELECT id FROM events WHERE ics_uid = ? AND deleted = 0`, e.uid) : null;
        const row = { title: e.title, start: e.start, end: e.end || addMinutes(e.start, 60), all_day: e.all_day || 0, location: e.location || '', description: e.description || '',
          visio_url: e.visio_url || '', recurrence: e.recurrence || 'none', recur_until: e.recur_until || null, status: e.status || 'planifie', ics_uid: e.uid || null };
        if (ex) { db.save('events', { id: ex.id, ...row }); updated++; } else { db.save('events', { type: 'autre', reminder_min: 15, participants: [], ...row }); added++; }
      }
      return { added, updated };
    });

  // ---------- Rappel automatique des visiteurs (la veille) ----------
  // Rendez-vous de demain avec un interlocuteur, à prévenir par e-mail, WhatsApp ou SMS.
  S.visitorReminders = (day = addDays(today(), 1)) =>
    S.agenda(day, day).filter((e) => ['rdv', 'appel'].includes(e.type) && e.contact_id && e.status !== 'annule' && !e.all_day && e.occurrence === 0)
      .map((e) => ({ ...e, contact: db.byId('contacts', e.contact_id) })).filter((e) => e.contact);
  S.markVisitorReminded = (id) => db.save('events', { id, visitor_reminded_at: stamp() });
  const fr = (s) => toDate(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  S.visitorMessage = (ev) => {
    const set = S.settings();
    const who = contactName(ev.contact) || 'Madame, Monsieur';
    return {
      subject: `Rappel : votre rendez-vous de demain à ${hm(ev.start).replace(':', 'h')}`,
      text: `Bonjour ${who},\n\nNous vous rappelons votre rendez-vous de demain, ${fr(ev.start)}, à ${hm(ev.start).replace(':', 'h')}${ev.location ? `, ${ev.location}` : ''}${set.organisation ? ` (${set.organisation})` : ''}.${ev.visio_url ? `\nLien de visioconférence : ${ev.visio_url}` : ''}\n\nEn cas d’empêchement, merci de nous prévenir.\n\nBien cordialement,\n${[set.user_name, set.user_title, set.organisation].filter(Boolean).join('\n')}`,
    };
  };
  // Travail à faire à l'heure choisie : messages à envoyer et visiteurs sans e-mail à prévenir par téléphone.
  S.automationBatch = (now = stamp()) => {
    const set = S.settings();
    const out = { visitors: [], phones: [], relances: [] };
    if (set.visitor_reminder === '1' && now.slice(11, 16) >= (set.visitor_reminder_hour || '16:00')) {
      for (const ev of S.visitorReminders(addDays(now.slice(0, 10), 1))) {
        if (ev.visitor_reminded_at) continue;
        if (ev.contact.email) out.visitors.push({ ev, to: ev.contact.email, ...S.visitorMessage(ev) });
        else if (ev.contact.mobile || ev.contact.phone) out.phones.push(ev);
      }
    }
    if (set.courrier_auto_relance === '1') {
      const gap = Math.max(1, Number(set.courrier_relance_days) || 3);
      for (const c of db.all(`SELECT * FROM courrier WHERE deleted = 0 AND direction = 'arrivee' AND status IN ('enregistre','en_traitement') AND due IS NOT NULL AND due <> '' AND due < ? AND assigned_email IS NOT NULL AND assigned_email <> ''`, now.slice(0, 10))) {
        const last = (Array.isArray(c.circuit) ? c.circuit : []).filter((x) => x.action === 'relance').pop();
        if (last && last.date > addDays(now.slice(0, 10), -gap)) continue;
        out.relances.push({ courrier: c, to: c.assigned_email, ...S.relanceMessage(c) });
      }
    }
    return out;
  };

  // ---------- Courrier : circuit de traitement ----------
  const STEP_LABEL = { enregistre: 'Enregistré', transmis: 'Transmis', relance: 'Relance', reponse: 'Réponse', traite: 'Traité', archive: 'Archivé', note: 'Note' };
  S.relanceMessage = (c) => ({
    subject: `Relance — courrier ${c.number} : ${c.object}`,
    text: `Bonjour${c.assigned_to ? ` ${c.assigned_to}` : ''},\n\nLe courrier ${c.number} reçu le ${fr(c.date)} de ${c.correspondent} (objet : « ${c.object} ») vous a été transmis pour traitement${c.due ? ` avant le ${fr(c.due)}` : ''}.\n\nPourriez-vous nous indiquer où en est sa réponse ?\n\nBien cordialement,\n${[S.settings().user_name, S.settings().user_title].filter(Boolean).join('\n')}`,
  });
  S.courrierStep = (id, step) =>
    db.tx(() => {
      const c = db.byId('courrier', id);
      if (!c) throw new Error('Courrier introuvable');
      if (!STEP_LABEL[step.action]) throw new Error('Étape inconnue');
      const circuit = [...(Array.isArray(c.circuit) ? c.circuit : []), { date: stamp(), action: step.action, to: step.to || '', note: step.note || '', by: S.settings().user_name || '' }];
      const patch = { id, circuit };
      if (step.action === 'transmis') Object.assign(patch, { status: 'en_traitement', assigned_to: step.to || c.assigned_to, assigned_email: step.email ?? c.assigned_email, due: step.due || c.due });
      if (step.action === 'reponse' || step.action === 'traite') Object.assign(patch, { status: 'traite', treated_at: stamp() });
      if (step.action === 'archive') patch.status = 'archive';
      return db.save('courrier', patch);
    });
  S.stepLabel = STEP_LABEL;

  // ---------- Réunions : séance suivante et suivi des actions ----------
  // Actions non terminées de la réunion précédente (même intitulé, ou réunion liée).
  S.previousMeeting = (m) => (m.previous_id ? db.byId('meetings', m.previous_id)
    : db.get(`SELECT * FROM meetings WHERE deleted = 0 AND title = ? AND start < ? AND id <> ? ORDER BY start DESC LIMIT 1`, m.title, m.start, m.id || ''));
  S.openActions = (meetingId) => {
    const m = db.byId('meetings', meetingId);
    if (!m) return { previous: null, tasks: [] };
    const prev = S.previousMeeting(m);
    if (!prev) return { previous: null, tasks: [] };
    return { previous: { id: prev.id, title: prev.title, start: prev.start }, tasks: db.all(`SELECT * FROM tasks WHERE deleted = 0 AND meeting_id = ? AND status <> 'terminee' ORDER BY due`, prev.id) };
  };
  const followUpItem = (prev, tasks) => ({
    title: `Suivi des actions de la réunion du ${fr(prev.start)}`, presenter: '', duration: Math.max(10, tasks.length * 5),
    carried: tasks.map((t) => ({ task_id: t.id, title: t.title, owner: t.assignee || '', due: t.due || '', status: t.status })),
  });
  S.planNextMeeting = (id, start) =>
    db.tx(() => {
      const m = S.meeting(id);
      const at = start || (m.minutes && m.minutes.next_meeting) || addDays(m.start.slice(0, 10), 7) + m.start.slice(10);
      const dur = Math.max(30, minutesBetween(m.start, m.end));
      const open = db.all(`SELECT * FROM tasks WHERE deleted = 0 AND meeting_id = ? AND status <> 'terminee' ORDER BY due`, id);
      const agenda = [{ title: 'Validation du procès-verbal de la séance précédente', presenter: m.president || '', duration: 10 }];
      if (open.length) agenda.push(followUpItem(m, open));
      agenda.push({ title: 'Questions diverses', presenter: '', duration: 15 });
      return S.saveMeeting({ title: m.title, start: at.length === 16 ? `${at}:00` : at, end: addMinutes(at.length === 16 ? `${at}:00` : at, dur), location: m.location, visio_url: m.visio_url,
        organizer: m.organizer, president: m.president, objective: m.objective, previous_id: m.id, status: 'preparation', agenda,
        participants: m.participants.map((p) => ({ ...p, presence: '' })), minutes: { intro: '', points: [], actions: [], conclusion: '', next_meeting: '' } });
    });
  // Ajoute (ou met à jour) le point « Suivi des actions » d'une réunion existante.
  S.carryActions = (id) =>
    db.tx(() => {
      const m = S.meeting(id);
      const { previous, tasks } = S.openActions(id);
      if (!previous) throw new Error('Aucune réunion précédente trouvée (même intitulé)');
      if (!tasks.length) throw new Error('Toutes les actions de la réunion précédente sont terminées');
      const agenda = m.agenda.filter((a) => !a.carried);
      agenda.splice(Math.min(1, agenda.length), 0, followUpItem(previous, tasks));
      return S.saveMeeting({ ...m, agenda, previous_id: m.previous_id || previous.id });
    });
  S.validatePv = (id, by, remarks) => {
    const m = db.byId('meetings', id);
    if (!m) throw new Error('Réunion introuvable');
    return S.setMeetingStatus(id, 'pv_valide', { pv_validated_by: by || '', pv_remarks: remarks || m.pv_remarks || null });
  };

  // ---------- Accès mobile de la Direction ----------
  S.mobileUsers = () => db.list('mobile_users', {}, 'name').map(({ code_hash, ...u }) => ({ ...u, has_code: !!code_hash })); // eslint-disable-line no-unused-vars
  S.saveMobileUser = (u) => {
    if (!u.name || !u.login) throw new Error('Indiquez le nom et l’identifiant');
    const login = String(u.login).trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(login)) throw new Error('Identifiant : 2 à 40 caractères (lettres, chiffres, point, tiret)');
    const dup = db.get(`SELECT id FROM mobile_users WHERE deleted = 0 AND login = ? AND id <> ?`, login, u.id || '');
    if (dup) throw new Error('Cet identifiant est déjà utilisé');
    const row = { id: u.id, name: u.name, login, role: u.role || 'direction', active: u.active === 0 ? 0 : 1 };
    if (u.code) {
      if (!/^\d{6,10}$/.test(u.code)) throw new Error('Le code mobile doit contenir 6 à 10 chiffres');
      row.code_hash = hashPin(u.code);
    } else if (!u.id) throw new Error('Choisissez un code d’accès');
    const r = db.save('mobile_users', row);
    delete r.code_hash;
    return r;
  };

  // ---------- Rapport mensuel d'activité ----------
  S.monthlyReport = (month = today().slice(0, 7)) => {
    const from = `${month}-01`;
    const d = toDate(from);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    const to = stamp(d).slice(0, 10);
    const prevD = toDate(from); prevD.setMonth(prevD.getMonth() - 1);
    const prevMonth = stamp(prevD).slice(0, 7);
    const inMonth = (col) => `substr(${col},1,7) = ?`;
    const count = (sql, ...p) => db.get(sql, ...p).n;
    const events = S.agenda(from, to).filter((e) => e.status !== 'annule');
    const block = (m) => ({
      meetings: count(`SELECT COUNT(*) n FROM meetings WHERE deleted = 0 AND ${inMonth('start')} AND status IN ('tenue','pv_valide','pv_diffuse')`, m),
      pvValidated: count(`SELECT COUNT(*) n FROM meetings WHERE deleted = 0 AND ${inMonth('pv_validated_at')}`, m),
      pvSent: count(`SELECT COUNT(*) n FROM meetings WHERE deleted = 0 AND ${inMonth('pv_sent_at')}`, m),
      courrierIn: count(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND direction = 'arrivee' AND ${inMonth('date')}`, m),
      courrierOut: count(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND direction = 'depart' AND ${inMonth('date')}`, m),
      courrierTreated: count(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND direction = 'arrivee' AND ${inMonth('date')} AND status IN ('traite','archive')`, m),
      calls: count(`SELECT COUNT(*) n FROM calls WHERE deleted = 0 AND ${inMonth('date')}`, m),
      callsBack: count(`SELECT COUNT(*) n FROM calls WHERE deleted = 0 AND ${inMonth('date')} AND status = 'rappele'`, m),
      tasksDone: count(`SELECT COUNT(*) n FROM tasks WHERE deleted = 0 AND status = 'terminee' AND ${inMonth('done_at')}`, m),
      mailsSent: count(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND folder = 'sent' AND ${inMonth('date')}`, m),
      mailsIn: count(`SELECT COUNT(*) n FROM mails WHERE deleted = 0 AND folder IN ('inbox','archive') AND ${inMonth('date')}`, m),
    });
    const cur = block(month);
    const prev = block(prevMonth);
    cur.rdv = events.filter((e) => e.type === 'rdv').length;
    cur.events = events.length;
    cur.hours = Math.round(events.reduce((s, e) => s + (e.all_day ? 0 : minutesBetween(e.start, e.end)), 0) / 6) / 10;
    const lateTasks = db.all(`SELECT * FROM tasks WHERE deleted = 0 AND status <> 'terminee' AND due IS NOT NULL AND due <> '' AND due <= ? ORDER BY due`, to);
    const treated = db.all(`SELECT date, treated_at FROM courrier WHERE deleted = 0 AND direction = 'arrivee' AND treated_at IS NOT NULL AND ${inMonth('treated_at')}`, month);
    const delay = treated.length ? Math.round(treated.reduce((s, c) => s + Math.max(0, minutesBetween(`${c.date}T00:00:00`, c.treated_at) / 1440), 0) / treated.length * 10) / 10 : null;
    // Activité par semaine du mois.
    const weeks = [];
    for (let s = from; s <= to; s = addDays(s, 7)) {
      const e = addDays(s, 6) > to ? to : addDays(s, 6);
      const evs = events.filter((x) => x.start.slice(0, 10) >= s && x.start.slice(0, 10) <= e);
      weeks.push({ from: s, to: e, rdv: evs.filter((x) => x.type === 'rdv').length, meetings: evs.filter((x) => x.type === 'reunion').length,
        courrier: count(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND date >= ? AND date <= ?`, s, e),
        calls: count(`SELECT COUNT(*) n FROM calls WHERE deleted = 0 AND substr(date,1,10) >= ? AND substr(date,1,10) <= ?`, s, e) });
    }
    const types = TYPES.map((t) => ({ type: t, n: events.filter((e) => e.type === t).length })).filter((x) => x.n);
    const meetings = db.all(`SELECT id, title, start, status FROM meetings WHERE deleted = 0 AND ${inMonth('start')} ORDER BY start`, month);
    return { month, from, to, prevMonth, kpi: cur, prev, delay, lateTasks: lateTasks.slice(0, 15), lateCount: lateTasks.length, weeks, types, meetings,
      openCourrier: count(`SELECT COUNT(*) n FROM courrier WHERE deleted = 0 AND direction = 'arrivee' AND status IN ('enregistre','en_traitement')`) };
  };

  // ---------- Modèles de messages ----------
  S.fillTemplate = (tpl, vars) => {
    const rep = (s) => String(s || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => (vars[k] != null ? vars[k] : `{{${k}}}`));
    return { subject: rep(tpl.subject), body: rep(tpl.body) };
  };

  // Modèles de messages standards, ajoutés à chaque nouvelle session.
  S.seedTemplates = () => {
    if (db.get(`SELECT 1 FROM templates WHERE deleted = 0`)) return;
    const tpl = (name, category, subject, body) => db.save('templates', { name, category, subject, body });
    tpl('Confirmation de rendez-vous', 'Rendez-vous', 'Confirmation de votre rendez-vous du {{date}}',
      'Bonjour {{nom}},\n\nNous avons le plaisir de vous confirmer votre rendez-vous le {{date}} à {{heure}}, {{lieu}}.\n\nEn cas d’empêchement, merci de nous prévenir au plus tôt.\n\nBien cordialement,\n{{signature}}');
    tpl('Report de rendez-vous', 'Rendez-vous', 'Report de votre rendez-vous',
      'Bonjour {{nom}},\n\nPour des raisons d’agenda, nous sommes contraints de reporter le rendez-vous prévu le {{date}}. Nous revenons vers vous très rapidement avec de nouvelles disponibilités.\n\nVeuillez nous excuser pour ce contretemps.\n\nBien cordialement,\n{{signature}}');
    tpl('Accusé de réception de courrier', 'Courrier', 'Accusé de réception — {{objet}}',
      'Madame, Monsieur,\n\nNous accusons bonne réception de votre courrier relatif à « {{objet}} ». Il a été transmis au service concerné qui ne manquera pas de vous répondre dans les meilleurs délais.\n\nVeuillez agréer nos salutations distinguées.\n\n{{signature}}');
    tpl('Relance', 'Suivi', 'Relance : {{objet}}',
      'Bonjour {{nom}},\n\nSauf erreur de notre part, nous restons dans l’attente de votre retour concernant « {{objet}} ». Pourriez-vous nous indiquer où en est ce dossier ?\n\nBien cordialement,\n{{signature}}');
    tpl('Remerciements', 'Suivi', 'Merci pour votre visite',
      'Bonjour {{nom}},\n\nNous vous remercions pour votre visite et pour la qualité de nos échanges. Nous restons à votre disposition pour toute information complémentaire.\n\nBien cordialement,\n{{signature}}');
  };

  // Réponses rapides proposées sous chaque message (ajoutées une seule fois par session).
  S.seedQuickReplies = () => {
    if (db.meta('quick_replies_seeded')) return;
    const q = (name, body) => db.save('templates', { name, category: 'Réponse rapide', subject: '', body });
    q('Bien reçu', 'Bonjour,\n\nBien reçu, merci. Je transmets à la Direction et reviens vers vous dans les meilleurs délais.\n\nBien cordialement,\n{{signature}}');
    q('Rendez-vous confirmé', 'Bonjour,\n\nC’est noté : votre rendez-vous est confirmé. À très bientôt.\n\nBien cordialement,\n{{signature}}');
    q('Je reviens vers vous', 'Bonjour,\n\nMerci pour votre message. Je vérifie les disponibilités de la Direction et je reviens vers vous très rapidement.\n\nBien cordialement,\n{{signature}}');
    q('Document en pièce jointe', 'Bonjour,\n\nVeuillez trouver ci-joint le document demandé.\n\nBien cordialement,\n{{signature}}');
    q('Absence de la Direction', 'Bonjour,\n\nLa Direction est actuellement en déplacement. Votre message lui sera transmis dès son retour.\n\nBien cordialement,\n{{signature}}');
    db.setMeta('quick_replies_seeded', '1');
  };

  // ---------- Données de démonstration ----------
  S.seedDemo = () =>
    db.tx(() => {
      const d = today();
      const at = (offset, time) => `${addDays(d, offset)}T${time}:00`;
      const people = [
        ['Aminata', 'Koné', 'Direction Générale', 'Directrice générale', 'a.kone@exemple.ci', '+225 07 08 11 22 33', 1, '#7c5cff'],
        ['Jean-Marc', 'Yao', 'Direction Financière', 'Directeur financier', 'jm.yao@exemple.ci', '+225 05 44 55 66 77', 1, '#22b8cf'],
        ['Fatoumata', 'Diarra', 'Ressources Humaines', 'Responsable RH', 'f.diarra@exemple.ci', '+225 01 02 03 04 05', 0, '#f59f00'],
        ['Paul', 'Mensah', 'Cabinet Mensah & Associés', 'Avocat', 'p.mensah@cabinet-mensah.com', '+225 27 20 30 40 50', 0, '#e8590c'],
        ['Claire', 'Dubois', 'Banque Atlantique', 'Chargée d’affaires', 'c.dubois@banque-atl.com', '+225 27 21 00 11 22', 0, '#2f9e44'],
        ['Ibrahim', 'Traoré', 'Informatique', 'Responsable SI', 'i.traore@exemple.ci', '+225 07 77 88 99 00', 0, '#1c7ed6'],
        ['Mariam', 'Bamba', 'Fournisseur BureauPlus', 'Commerciale', 'm.bamba@bureauplus.ci', '+225 05 12 34 56 78', 0, '#d6336c'],
        ['Kofi', 'Asante', 'Ministère du Commerce', 'Conseiller technique', 'k.asante@commerce.gouv', '+225 27 22 33 44 55', 0, '#5c940d'],
      ].map(([first_name, last_name, company, title, email, phone, favorite, color]) => db.save('contacts', { first_name, last_name, company, title, email, phone, favorite, color }));
      const [dg, daf, rh, avocat, banque, si, fourn, minist] = people;

      const ev = (o) => S.saveEvent({ status: 'planifie', reminder_min: 15, recurrence: 'none', participants: [], ...o });
      ev({ title: 'Point hebdomadaire avec la Direction', type: 'reunion', start: at(0, '09:00'), end: at(0, '10:00'), location: 'Bureau de la DG', participants: [dg.id, daf.id], recurrence: 'weekly', reminder_min: 15 });
      ev({ title: 'Rendez-vous Banque Atlantique', type: 'rdv', start: at(0, '11:30'), end: at(0, '12:15'), location: 'Salle Ébène', contact_id: banque.id, description: 'Renouvellement de la ligne de crédit' });
      ev({ title: 'Appel Cabinet Mensah — contrat bail', type: 'appel', start: at(0, '14:30'), end: at(0, '14:50'), contact_id: avocat.id });
      ev({ title: 'Entretien candidat — poste comptable', type: 'rdv', start: at(0, '16:00'), end: at(0, '17:00'), location: 'Salle RH', contact_id: rh.id });
      ev({ title: 'Comité de direction mensuel', type: 'reunion', start: at(1, '10:00'), end: at(1, '12:00'), location: 'Salle du Conseil', participants: [dg.id, daf.id, rh.id, si.id], reminder_min: 30 });
      ev({ title: 'Visite fournisseur BureauPlus', type: 'rdv', start: at(1, '15:00'), end: at(1, '15:45'), location: 'Accueil', contact_id: fourn.id });
      ev({ title: 'Déplacement Ministère du Commerce', type: 'deplacement', start: at(2, '08:30'), end: at(2, '11:00'), location: 'Plateau, Abidjan', contact_id: minist.id });
      ev({ title: 'Date limite déclaration fiscale', type: 'echeance', start: at(3, '00:00'), end: at(3, '23:59'), all_day: 1, reminder_min: 1440 });
      ev({ title: 'Réunion projet nouveau système informatique', type: 'reunion', start: at(3, '14:00'), end: at(3, '15:30'), location: 'Visioconférence', visio_url: 'https://meet.exemple.ci/projet-si', participants: [si.id, daf.id] });
      ev({ title: 'Déjeuner d’affaires — partenaire', type: 'rdv', start: at(4, '12:30'), end: at(4, '14:00'), location: 'Restaurant Le Pavillon' });
      ev({ title: 'Formation sécurité incendie', type: 'autre', start: at(6, '09:00'), end: at(6, '12:00'), location: 'Salle polyvalente' });
      ev({ title: 'Comité de direction', type: 'reunion', start: at(-6, '10:00'), end: at(-6, '12:00'), location: 'Salle du Conseil', participants: [dg.id, daf.id, rh.id], status: 'termine' });
      ev({ title: 'Rendez-vous avocat', type: 'rdv', start: at(-3, '15:00'), end: at(-3, '16:00'), location: 'Cabinet Mensah', contact_id: avocat.id, status: 'termine' });
      ev({ title: 'Anniversaire de Mme Koné', type: 'perso', start: at(5, '00:00'), end: at(5, '23:59'), all_day: 1, reminder_min: 1440 });

      // Réunion passée avec PV complet.
      const past = db.get(`SELECT * FROM meetings WHERE title = 'Comité de direction' AND deleted = 0`);
      const part = (c, presence) => ({ contact_id: c.id, name: contactName(c), email: c.email, role: c.title, presence });
      S.saveMeeting({ ...S.meeting(past.id), president: contactName(dg), secretary: '', organizer: contactName(dg), objective: 'Suivi mensuel de l’activité et arbitrages budgétaires',
        agenda: [{ title: 'Validation du PV précédent', presenter: contactName(dg), duration: 10 }, { title: 'Situation financière du trimestre', presenter: contactName(daf), duration: 30 },
          { title: 'Plan de recrutement', presenter: contactName(rh), duration: 30 }, { title: 'Questions diverses', presenter: '', duration: 15 }],
        participants: [part(dg, 'present'), part(daf, 'present'), part(rh, 'excuse'), part(si, 'absent')],
        minutes: { intro: 'La séance est ouverte à 10h05 sous la présidence de Mme Koné. Le quorum est atteint.',
          points: [
            { title: 'Validation du PV précédent', discussion: 'Le procès-verbal de la séance précédente a été lu.', decisions: 'Le PV est adopté à l’unanimité.' },
            { title: 'Situation financière du trimestre', discussion: 'Le DAF présente un chiffre d’affaires en hausse de 8 % et une trésorerie stable. Les charges de fonctionnement dépassent le budget de 3 %.', decisions: 'Gel des dépenses non prioritaires jusqu’à la fin du trimestre.' },
            { title: 'Plan de recrutement', discussion: 'En l’absence de la Responsable RH, le point est présenté par la DG. Deux postes sont prioritaires : comptable et chargé de communication.', decisions: 'Ouverture immédiate du recrutement du poste de comptable.' },
          ],
          actions: [
            { title: 'Envoyer la note de gel des dépenses à tous les services', owner: contactName(daf), due: addDays(d, -2) },
            { title: 'Publier l’offre d’emploi « Comptable »', owner: contactName(rh), due: addDays(d, 2) },
            { title: 'Préparer le budget révisé du trimestre', owner: contactName(daf), due: addDays(d, 6) },
          ],
          conclusion: 'L’ordre du jour étant épuisé, la séance est levée à 11h50.', next_meeting: at(1, '10:00') },
        status: 'pv_valide' });
      const doneAction = db.get(`SELECT id FROM tasks WHERE title LIKE 'Envoyer la note%'`);
      if (doneAction) S.saveTask({ id: doneAction.id, status: 'terminee' });

      const cod = db.get(`SELECT * FROM meetings WHERE title = 'Comité de direction mensuel' AND deleted = 0`);
      S.saveMeeting({ ...S.meeting(cod.id), president: contactName(dg), organizer: contactName(dg), objective: 'Revue mensuelle et préparation du budget révisé',
        agenda: [{ title: 'Validation du PV du dernier comité', presenter: contactName(dg), duration: 10 }, { title: 'Budget révisé du trimestre', presenter: contactName(daf), duration: 40 },
          { title: 'Avancement du projet informatique', presenter: contactName(si), duration: 30 }, { title: 'Questions diverses', duration: 15 }],
        participants: [part(dg, ''), part(daf, ''), part(rh, ''), part(si, '')], status: 'convoquee' });

      const task = (o) => S.saveTask({ status: 'a_faire', priority: 'normale', ...o });
      task({ title: 'Réserver la salle du Conseil pour le comité', due: d, priority: 'haute' });
      task({ title: 'Préparer le dossier du rendez-vous Banque Atlantique', due: d, priority: 'urgente', status: 'en_cours' });
      task({ title: 'Commander les fournitures de bureau', due: addDays(d, 3), contact_id: fourn.id });
      task({ title: 'Mettre à jour l’annuaire interne', due: addDays(d, 7), priority: 'basse' });
      task({ title: 'Relancer le cabinet Mensah pour le contrat de bail', due: addDays(d, -1), priority: 'haute' });
      task({ title: 'Organiser le déplacement au Ministère (véhicule)', due: addDays(d, 1), status: 'attente' });
      task({ title: 'Classer les factures du mois dernier', status: 'terminee', priority: 'basse' });

      const rem = (title, due, note, repeat = 'none') => db.save('reminders', { title, due, note, repeat, done: 0 });
      rem('Confirmer le rendez-vous de la banque', at(0, '10:30'), 'Appeler Mme Dubois');
      rem('Imprimer les dossiers du comité', at(1, '08:30'), '6 exemplaires');
      rem('Renouveler l’abonnement Internet', at(4, '09:00'), 'Contrat n° 4589');
      rem('Arroser les plantes de l’accueil', at(1, '08:00'), '', 'weekly');

      const cour = (o) => S.saveCourrier({ mode: 'poste', status: 'enregistre', ...o });
      cour({ direction: 'arrivee', date: addDays(d, -5), correspondent: 'Ministère du Commerce', object: 'Invitation à l’atelier sur la réglementation', reference: 'MC/DG/2026/118', assigned_to: contactName(dg), status: 'traite', contact_id: minist.id });
      cour({ direction: 'arrivee', date: addDays(d, -2), correspondent: 'Banque Atlantique', object: 'Proposition de renouvellement de crédit', reference: 'BA-CRD-4471', assigned_to: contactName(daf), status: 'en_traitement', due: d, contact_id: banque.id });
      cour({ direction: 'arrivee', date: addDays(d, -1), correspondent: 'CNPS', object: 'Appel de cotisations du trimestre', mode: 'main propre', assigned_to: contactName(rh), due: addDays(d, 5) });
      cour({ direction: 'arrivee', date: d, correspondent: 'Cabinet Mensah & Associés', object: 'Projet de contrat de bail commercial', mode: 'email', assigned_to: contactName(dg), contact_id: avocat.id });
      cour({ direction: 'depart', date: addDays(d, -4), correspondent: 'Ministère du Commerce', object: 'Confirmation de participation à l’atelier', reference: 'DG/2026/052', status: 'traite' });
      cour({ direction: 'depart', date: addDays(d, -1), correspondent: 'BureauPlus', object: 'Bon de commande fournitures n° 233', mode: 'email', status: 'traite' });

      const call = (o) => S.saveCall({ direction: 'entrant', status: 'a_rappeler', ...o });
      call({ date: at(0, '08:42'), caller: 'Claire Dubois', company: 'Banque Atlantique', phone: banque.phone, for_whom: contactName(daf), message: 'Souhaite avancer le rendez-vous de 15 min.', contact_id: banque.id });
      call({ date: at(0, '09:15'), caller: 'M. Konan', company: 'Transports Express', phone: '+225 07 55 44 33 22', for_whom: contactName(dg), message: 'Devis pour le transport du personnel.', urgent: 1 });
      call({ date: at(-1, '16:20'), caller: 'Paul Mensah', company: 'Cabinet Mensah', phone: avocat.phone, for_whom: contactName(dg), message: 'Le contrat de bail est prêt.', status: 'rappele', contact_id: avocat.id });

      S.seedTemplates();

      // Quelques messages de démonstration dans la boîte de réception locale.
      const mail = (o) => db.save('mails', { account_id: 'demo', folder: 'inbox', read: 0, starred: 0, attachments: [], ...o });
      mail({ from_name: 'Claire Dubois', from_addr: banque.email, to_addr: 'secretariat@exemple.ci', subject: 'Documents pour le rendez-vous de ce jour', date: at(0, '08:05'), starred: 1,
        text: 'Bonjour,\n\nPourriez-vous transmettre à M. Yao les états financiers du dernier trimestre avant notre rendez-vous ?\n\nCordialement,\nClaire Dubois\nBanque Atlantique' });
      mail({ from_name: 'Aminata Koné', from_addr: dg.email, to_addr: 'secretariat@exemple.ci', subject: 'Ordre du jour du comité de demain', date: at(0, '07:40'),
        text: 'Bonjour,\n\nMerci d’ajouter un point sur le projet informatique à l’ordre du jour du comité et d’envoyer la convocation à tous les membres.\n\nAminata Koné' });
      mail({ from_name: 'Paul Mensah', from_addr: avocat.email, to_addr: 'secretariat@exemple.ci', subject: 'Projet de contrat de bail', date: at(-1, '17:10'), read: 1,
        text: 'Bonjour,\n\nVeuillez trouver ci-joint le projet de contrat de bail pour relecture par la Direction.\n\nMaître Paul Mensah' });
      mail({ from_name: 'Mariam Bamba', from_addr: fourn.email, to_addr: 'secretariat@exemple.ci', subject: 'Votre commande n° 233 est expédiée', date: at(-1, '11:25'), read: 1,
        text: 'Bonjour,\n\nVotre commande de fournitures a été expédiée et sera livrée demain matin.\n\nMariam Bamba — BureauPlus' });
      mail({ folder: 'sent', from_name: 'Secrétariat', from_addr: 'secretariat@exemple.ci', to_addr: minist.email, subject: 'Confirmation de participation', date: at(-4, '10:00'), read: 1,
        text: 'Monsieur le Conseiller,\n\nNous vous confirmons la participation de Mme Koné à l’atelier.\n\nLe Secrétariat de Direction' });

      db.save('notes', { title: 'Codes d’accès salle du Conseil', body: 'Badge visiteurs : demander à l’accueil.\nVidéoprojecteur : télécommande dans le tiroir.', color: '#f59f00', pinned: 1 });
      db.save('notes', { title: 'À ne pas oublier', body: '• Commander les cartes de visite de M. Yao\n• Fleurs pour l’anniversaire de Mme Koné', color: '#7c5cff' });
      notify({ kind: 'info', title: 'Bienvenue dans OfficiaTech', body: 'Vos données de démonstration sont prêtes : explorez l’agenda, les réunions et la messagerie.', link_type: 'home', dedupe: 'welcome' });
      return true;
    });

  return S;
}

module.exports = { createServices, today, addDays, addMinutes, shift, contactName, DEFAULT_SETTINGS, TYPES };
