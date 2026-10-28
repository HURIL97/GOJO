// Format iCalendar (.ics) : invitations par e-mail, export et import de l'agenda (Google Agenda, Outlook, téléphone).
// Module autonome (aucune dépendance) : il est aussi utilisé par le serveur de l'équipe.
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// Les horaires locaux d'OfficiaTech sont convertis en UTC : chaque destinataire les voit dans son propre fuseau.
const utc = (s) => { const d = new Date(s.length === 10 ? `${s}T00:00:00` : s); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const dateOnly = (s) => s.slice(0, 10).replace(/-/g, '');
const text = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lignes de 75 octets au plus, continuées par une espace (RFC 5545).
const fold = (line) => {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
};
const RRULE = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
const STATUS = { annule: 'CANCELLED', confirme: 'CONFIRMED', planifie: 'CONFIRMED', reporte: 'TENTATIVE', termine: 'CONFIRMED' };

function vevent(ev, { organizer, attendees = [], method, privateAsBusy } = {}) {
  const hidden = privateAsBusy && ev.private;
  const l = ['BEGIN:VEVENT', `UID:${ev.id}@officiatech`, `DTSTAMP:${utc(stamp())}`, `SEQUENCE:${Number(ev.ics_seq) || 0}`];
  if (ev.all_day) {
    const end = new Date(`${(ev.end || ev.start).slice(0, 10)}T00:00:00`);
    end.setDate(end.getDate() + 1);
    l.push(`DTSTART;VALUE=DATE:${dateOnly(ev.start)}`, `DTEND;VALUE=DATE:${dateOnly(stamp(end))}`);
  } else l.push(`DTSTART:${utc(ev.start)}`, `DTEND:${utc(ev.end || ev.start)}`);
  l.push(`SUMMARY:${text(hidden ? 'Occupé' : ev.title)}`);
  if (!hidden) {
    if (ev.location) l.push(`LOCATION:${text(ev.location)}`);
    const desc = [ev.description, ev.visio_url ? `Visioconférence : ${ev.visio_url}` : ''].filter(Boolean).join('\n\n');
    if (desc) l.push(`DESCRIPTION:${text(desc)}`);
    if (ev.visio_url) l.push(`URL:${text(ev.visio_url)}`);
  }
  if (RRULE[ev.recurrence]) l.push(`RRULE:FREQ=${RRULE[ev.recurrence]}${ev.recur_until ? `;UNTIL=${dateOnly(ev.recur_until)}T235959Z` : ''}`);
  l.push(`STATUS:${method === 'CANCEL' ? 'CANCELLED' : STATUS[ev.status] || 'CONFIRMED'}`);
  if (organizer && organizer.email) l.push(`ORGANIZER;CN=${text(organizer.name || organizer.email)}:mailto:${organizer.email}`);
  for (const a of attendees) if (a.email) l.push(`ATTENDEE;CN=${text(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`);
  if (method !== 'CANCEL' && Number(ev.reminder_min) >= 0 && !ev.all_day) l.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(hidden ? 'Occupé' : ev.title)}`, `TRIGGER:-PT${Number(ev.reminder_min)}M`, 'END:VALARM');
  l.push('END:VEVENT');
  return l;
}

// Calendrier complet. method = 'REQUEST' pour une invitation, 'CANCEL' pour une annulation, rien pour un export.
function calendar(events, opts = {}) {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OfficiaTech//Agenda 1.10//FR', 'CALSCALE:GREGORIAN'];
  if (opts.method) l.push(`METHOD:${opts.method}`);
  if (opts.name) l.push(`X-WR-CALNAME:${text(opts.name)}`);
  for (const ev of events) l.push(...vevent(ev, opts));
  l.push('END:VCALENDAR');
  return `${l.map(fold).join('\r\n')}\r\n`;
}

// ---- Lecture d'un fichier .ics (export Google Agenda, Outlook, téléphone) ----
const unescape = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
function toLocal(value, params) {
  const v = String(value || '').trim();
  if (/^\d{8}$/.test(v) || /VALUE=DATE(?!-)/.test(params)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', z] = m;
  if (z) return { date: stamp(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec))) };
  return { date: `${y}-${mo}-${d}T${h}:${mi}:${sec}` }; // heure locale (TZID ou flottante)
}

function parse(ics) {
  const lines = String(ics || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  let depth = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:') && line !== 'END:VEVENT') { depth--; continue; }
    if (line === 'END:VEVENT') {
      if (cur.start) out.push(cur);
      cur = null;
      continue;
    }
    if (depth > 0) continue; // VALARM, etc.
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const [name, ...rest] = head.split(';');
    const params = rest.join(';');
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = unescape(value); break;
      case 'LOCATION': cur.location = unescape(value); break;
      case 'DESCRIPTION': cur.description = unescape(value); break;
      case 'URL': cur.visio_url = value; break;
      case 'STATUS': if (/CANCELLED/i.test(value)) cur.status = 'annule'; break;
      case 'DTSTART': { const t = toLocal(value, params); if (t) { cur.start = t.allDay ? `${t.date}T00:00:00` : t.date; cur.all_day = t.allDay ? 1 : 0; } break; }
      case 'DTEND': {
        const t = toLocal(value, params);
        if (t) {
          if (t.allDay) { const d = new Date(`${t.date}T00:00:00`); d.setDate(d.getDate() - 1); cur.end = `${stamp(d).slice(0, 10)}T23:59:00`; } else cur.end = t.date;
        }
        break;
      }
      case 'RRULE': {
        const f = (value.match(/FREQ=(\w+)/) || [])[1];
        const rec = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[f];
        if (rec) cur.recurrence = rec;
        const u = (value.match(/UNTIL=(\d{8})/) || [])[1];
        if (u) cur.recur_until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
        break;
      }
      default:
    }
  }
  return out;
}

module.exports = { calendar, parse, utc };
