import { useCallback, useEffect, useState } from 'react';
import { Sparkles, CalendarDays, Users2, Mail, Delete } from 'lucide-react';
import { call } from '../lib/api';
import { Field, Input, toast } from '../components/ui';
import { initials } from '../lib/format';
import { ABOUT } from '../lib/about';

export default function Setup({ onDone }) {
  const [f, setF] = useState({ user_name: '', user_title: 'Assistante de direction', organisation: '', manager_name: '', demo: true });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.user_name) return toast('Indiquez votre nom', 'error');
    try {
      const { demo, ...settings } = f;
      await call('app.setup', { settings, demo });
      onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="login">
      <div className="login-art" style={{ background: 'radial-gradient(800px 500px at 20% 10%, rgba(123,108,255,.42), transparent 60%), radial-gradient(700px 500px at 90% 90%, rgba(31,181,204,.32), transparent 60%), #0b0d1c' }}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo"><Sparkles size={20} /></div>
          <div><b>OfficiaTech</b><small style={{ color: '#9aa6c4' }}>Assistant administratif · v{ABOUT.version}</small></div>
        </div>
        <div>
          <h1>Votre secrétariat, parfaitement orchestré.</h1>
          <p>Agenda, rendez-vous, réunions et procès-verbaux, messagerie, courrier, appels, tâches et rappels : tout ce qu’une assistante de direction gère au quotidien, réuni dans une seule application élégante.</p>
        </div>
        <div className="login-feats">
          <div><CalendarDays size={20} /><b>Agenda</b>Rendez-vous, conflits, rappels</div>
          <div><Users2 size={20} /><b>Réunions</b>Convocations et PV en PDF</div>
          <div><Mail size={20} /><b>Messagerie</b>Modèles, envoi hors ligne</div>
        </div>
        <div style={{ color: '#9aa6c4', fontSize: 12.5, lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 14, maxWidth: 560 }}>
          <b style={{ color: '#eef2fb' }}>{ABOUT.name} — version {ABOUT.version}</b><br />
          Développé par <span style={{ whiteSpace: 'nowrap' }}>{ABOUT.author}</span>, {ABOUT.role}<br />{ABOUT.phones.map((t) => <span key={t} style={{ whiteSpace: 'nowrap', marginRight: 12 }}>{t}</span>)}<span style={{ whiteSpace: 'nowrap' }}>{ABOUT.email}</span>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-box col" style={{ gap: 14, width: 380 }} onSubmit={submit}>
          <h2 style={{ margin: 0 }}>Bienvenue</h2>
          <p className="muted" style={{ margin: 0 }}>Quelques informations pour personnaliser OfficiaTech.</p>
          <Field label="Votre nom"><Input value={f.user_name} onChange={set('user_name')} placeholder="Awa Kouassi" /></Field>
          <Field label="Votre fonction"><Input value={f.user_title} onChange={set('user_title')} /></Field>
          <Field label="Organisation"><Input value={f.organisation} onChange={set('organisation')} placeholder="Société, ministère, cabinet…" /></Field>
          <Field label="Personne assistée (facultatif)"><Input value={f.manager_name} onChange={set('manager_name')} placeholder="Mme la Directrice générale" /></Field>
          <label className="check"><input type="checkbox" checked={f.demo} onChange={(e) => set('demo')(e.target.checked)} /> Charger des données de démonstration</label>
          <button className="btn primary lg" type="submit">Commencer</button>
        </form>
      </div>
    </div>
  );
}

export function LockScreen({ settings, onUnlock }) {
  const hasLock = settings.has_lock === '1';
  const [since] = useState(() => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const submit = useCallback(async (p) => {
    try { await call('app.unlock', p); onUnlock(); } catch { setErr(true); setTimeout(() => { setErr(false); setPin(''); }, 400); }
  }, [onUnlock]);
  const press = useCallback((k) => {
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return pin.length >= 4 && submit(pin);
    setPin((p) => (p.length < 8 ? p + k : p));
  }, [pin, submit]);
  useEffect(() => {
    if (!hasLock) return undefined;
    const h = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok'); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [press, hasLock]);
  const reopen = async () => { try { if (await call('app.autoUnlock')) onUnlock(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="lock">
      <div className="card" style={{ width: 380, padding: 32, textAlign: 'center' }}>
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, margin: '0 auto 12px' }}>{initials(settings.user_name)}</div>
        <h2 style={{ margin: 0 }}>{settings.user_name}</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>Session fermée à {since}{hasLock ? ' — saisissez votre code' : ''}</p>
        {!hasLock ? (
          <div className="col" style={{ gap: 12, marginTop: 24 }}>
            <button className="btn primary lg" onClick={reopen}>Ouvrir la session</button>
            <p className="muted small" style={{ margin: 0 }}>Aucun code n’est défini. Pour protéger votre session, ajoutez un code dans Paramètres › Sécurité.</p>
          </div>
        ) : <>
        <div className={`pin-dots ${err ? 'shake' : ''}`}>{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
        <div className="pinpad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
            <button key={k} onClick={() => press(k)} style={k === 'ok' ? { background: 'linear-gradient(135deg,var(--accent),var(--accent-2))', color: '#fff', borderColor: 'transparent' } : null}>
              {k === 'del' ? <Delete size={20} /> : k === 'ok' ? 'OK' : k}
            </button>
          ))}
        </div>
        </>}
        <div className="muted small" style={{ marginTop: 18 }}>{ABOUT.name} v{ABOUT.version} · {ABOUT.author}</div>
      </div>
    </div>
  );
}
