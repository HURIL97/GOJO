import { Phone, MessageCircle, MessageSquareText } from 'lucide-react';
import { useApp } from '../lib/context';
import { telUrl, waUrl, smsUrl, openPhone } from '../lib/phone';
import { toast } from './ui';

// Boutons Appeler / WhatsApp / SMS pour un numéro. « text » préremplit WhatsApp et le SMS.
export function PhoneActions({ phone, text = '', size = 'sm', labels = false, onCalled }) {
  const { settings } = useApp();
  if (!phone) return null;
  const cc = settings.phone_country || '225';
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const go = async (url, msg) => {
    try { await openPhone(url); if (msg) toast(msg, 'info'); } catch (e) { toast(e.message, 'error'); }
  };
  const sms = async () => {
    if (text) { try { await navigator.clipboard.writeText(text); } catch { /* presse-papiers indisponible */ } }
    go(smsUrl(phone, cc, text), text ? 'SMS préparé — le texte est aussi copié : collez-le (Ctrl+V) si l’application SMS ne l’a pas repris.' : null);
  };
  const cls = `btn ${size} ${labels ? '' : 'icon'}`;
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <button className={cls} title={`Appeler ${phone}`} onClick={stop(() => { go(telUrl(phone, cc), 'Appel lancé via « Lien avec Windows »'); if (onCalled) onCalled(); })}><Phone size={14} color="var(--t-appel)" />{labels && 'Appeler'}</button>
      <button className={cls} title="Envoyer un message WhatsApp" onClick={stop(() => go(waUrl(phone, cc, text)))}><MessageCircle size={14} color="#25d366" />{labels && 'WhatsApp'}</button>
      <button className={cls} title="Envoyer un SMS" onClick={stop(sms)}><MessageSquareText size={14} color="var(--accent)" />{labels && 'SMS'}</button>
    </span>
  );
}
