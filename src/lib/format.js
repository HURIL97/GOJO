let currency = 'FCFA';
export const setCurrency = (c) => { currency = c || 'FCFA'; };
export const getCurrency = () => currency;

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const num = (n, dec) => (dec ? nf2 : nf).format(Number(n) || 0);
export const money = (n) => `${nf.format(Math.round(Number(n) || 0))} ${currency}`;
export const compact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${nf2.format(v / 1e6)} M`;
  if (Math.abs(v) >= 1e3) return `${nf.format(v / 1e3)} k`;
  return nf.format(v);
};
export const pct = (n) => `${nf2.format(Number(n) || 0)} %`;

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
export const fmtDate = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtShort = (s) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—');
export const fmtDateTime = (s) => (s ? `${fmtShort(s)} ${s.slice(11, 16)}` : '—');
export const fmtTime = (s) => (s ? s.slice(11, 16) : '');
export const weekday = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' });
export const delta = (cur, prev) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : cur ? 100 : 0);

export const METHODS = {
  especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque', chambre: 'Sur chambre',
};
export const RES_STATUS = {
  confirmee: ['Confirmée', 'info'], en_cours: ['En séjour', 'good'], partie: ['Partie', ''], annulee: ['Annulée', 'bad'], no_show: ['No-show', 'warn'],
};
export const ROOM_STATUS = {
  libre: ['Libre', 'good'], occupee: ['Occupée', 'info'], sale: ['À nettoyer', 'warn'], maintenance: ['Maintenance', 'bad'],
};
export const ORDER_STATUS = {
  ouverte: ['Ouverte', 'info'], payee: ['Payée', 'good'], chambre: ['Sur chambre', 'warn'], annulee: ['Annulée', 'bad'],
};
export const ROLES = {
  admin: 'Administrateur', manager: 'Gérant', reception: 'Réception', serveur: 'Serveur', barman: 'Barman', caissier: 'Caissier',
};
export const OUTLETS = { restaurant: 'Restaurant', bar: 'Bar', both: 'Bar & Restaurant', hotel: 'Hôtel' };
export const guestName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
