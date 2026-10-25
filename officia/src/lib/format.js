const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const localDay = (d = new Date()) => stamp(d).slice(0, 10);
export const toDate = (s) => new Date(s.length === 10 ? `${s}T00:00:00` : s);
export const addDays = (day, n) => { const d = toDate(day.slice(0, 10)); d.setDate(d.getDate() + n); return localDay(d); };
export const addMinutes = (ts, n) => { const d = toDate(ts); d.setMinutes(d.getMinutes() + n); return stamp(d); };
export const minutesBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 60000);
export const startOfWeek = (day) => { const d = toDate(day); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };

const fmt = (s, o) => (s ? toDate(s.length > 10 ? s : s.slice(0, 10)).toLocaleDateString('fr-FR', o) : '—');
export const fmtDate = (s) => fmt(s, { day: 'numeric', month: 'long', year: 'numeric' });
export const fmtShort = (s) => fmt(s, { day: '2-digit', month: 'short' });
export const fmtLong = (s) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDay = (s) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtTime = (s) => (s && s.length > 10 ? s.slice(11, 16).replace(':', 'h') : '');
export const fmtDateTime = (s) => (s ? `${fmtShort(s)} ${fmtTime(s)}` : '—');
export const weekdayShort = (s) => fmt(s, { weekday: 'short' });
export const monthTitle = (s) => fmt(s, { month: 'long', year: 'numeric' });
export const relDay = (s) => {
  if (!s) return '';
  const d = s.slice(0, 10);
  const t = localDay();
  if (d === t) return 'Aujourd’hui';
  if (d === addDays(t, 1)) return 'Demain';
  if (d === addDays(t, -1)) return 'Hier';
  return fmtShort(d);
};
export const ago = (s) => {
  const m = Math.round((Date.now() - toDate(s)) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
  return fmtShort(s);
};
export const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${pad(min % 60)}` : ''}` : `${min} min`);

export const TYPES = {
  reunion: 'Réunion', rdv: 'Rendez-vous', appel: 'Appel', deplacement: 'Déplacement', echeance: 'Échéance', perso: 'Personnel', autre: 'Autre',
};
export const EV_STATUS = { planifie: ['Planifié', 'info'], confirme: ['Confirmé', 'good'], termine: ['Terminé', ''], reporte: ['Reporté', 'warn'], annule: ['Annulé', 'bad'] };
export const MEETING_STATUS = {
  preparation: ['En préparation', ''], convoquee: ['Convocation envoyée', 'info'], tenue: ['Tenue — PV à rédiger', 'warn'],
  pv_valide: ['PV validé', 'good'], pv_diffuse: ['PV diffusé', 'good'],
};
export const TASK_STATUS = { a_faire: 'À faire', en_cours: 'En cours', attente: 'En attente', terminee: 'Terminée' };
export const PRIORITY = { urgente: ['Urgente', 'bad'], haute: ['Haute', 'warn'], normale: ['Normale', 'info'], basse: ['Basse', ''] };
export const REPEAT = { none: 'Une seule fois', daily: 'Tous les jours', weekly: 'Toutes les semaines', monthly: 'Tous les mois', yearly: 'Tous les ans' };
export const COURRIER_STATUS = { enregistre: ['Enregistré', 'info'], en_traitement: ['En traitement', 'warn'], traite: ['Traité', 'good'], archive: ['Archivé', ''] };
export const COURRIER_MODE = { poste: 'Poste', 'main propre': 'Remis en main propre', email: 'E-mail', coursier: 'Coursier', fax: 'Fax', autre: 'Autre' };
export const CALL_STATUS = { a_rappeler: ['À rappeler', 'warn'], rappele: ['Rappelé', 'good'], info: ['Pour information', ''] };
export const REMINDER_OPTIONS = [['-1', 'Aucun'], ['0', 'À l’heure'], ['5', '5 min avant'], ['10', '10 min avant'], ['15', '15 min avant'], ['30', '30 min avant'], ['60', '1 h avant'], ['120', '2 h avant'], ['1440', 'La veille']];
export const contactName = (c) => (c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company || c.email || '' : '');
export const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const delta = (cur, prev) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : cur ? 100 : 0);
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
export const compact = (n) => nf.format(Number(n) || 0);
export const money = compact;
