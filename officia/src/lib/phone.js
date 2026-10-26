// Appels, WhatsApp et SMS depuis OfficiaTech, via le téléphone relié à Windows (« Lien avec Windows ») ou WhatsApp.
import { call } from './api';
import { fmtLong, fmtTime } from './format';

// Numéro international sans « + » (ex. 2250719378057). Les numéros locaux à 10 chiffres reçoivent l'indicatif par défaut.
export function intl(raw, country = '225') {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (country && d.startsWith(country) && d.length > 10) return d;
  return `${String(country || '').replace(/\D/g, '')}${d}`;
}

export const telUrl = (raw, country) => { const n = intl(raw, country); return n ? `tel:+${n}` : ''; };
export const waUrl = (raw, country, text = '') => { const n = intl(raw, country); return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}` : ''; };
export const smsUrl = (raw, country, text = '') => { const n = intl(raw, country); return n ? `sms:+${n}${text ? `?body=${encodeURIComponent(text)}` : ''}` : ''; };

export const openPhone = (url) => call('phone.open', url);

// Textes prêts à envoyer.
export function rdvMessage(ev, contactLabel, s) {
  const lieu = ev.location ? ` (${ev.location})` : '';
  return `Bonjour${contactLabel ? ` ${contactLabel}` : ''},\nNous vous confirmons votre rendez-vous « ${ev.title} » le ${fmtLong(ev.start)} à ${fmtTime(ev.start)}${lieu}.\nEn cas d’empêchement, merci de nous prévenir.\nCordialement,\n${s.user_name || ''}${s.organisation ? ` — ${s.organisation}` : ''}`;
}
export function callbackMessage(c, s) {
  return `Bonjour${c.caller ? ` ${c.caller}` : ''},\nSuite à votre appel, ${s.manager_name || 'nous'} ${s.manager_name ? 'souhaite' : 'souhaitons'} vous recontacter. Quand êtes-vous joignable ?\nCordialement,\n${s.user_name || ''}${s.organisation ? ` — ${s.organisation}` : ''}`;
}
