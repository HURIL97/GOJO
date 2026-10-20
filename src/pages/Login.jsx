import { useCallback, useEffect, useState } from 'react';
import { Hotel, BedDouble, UtensilsCrossed, CloudCog, Delete } from 'lucide-react';
import { call } from '../lib/api';
import { Field, Input, toast } from '../components/ui';

function Setup({ onDone }) {
  const [f, setF] = useState({ hotel_name: '', name: '', pin: '', pin2: '', demo: true });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (f.pin !== f.pin2) return toast('Les deux codes PIN ne correspondent pas', 'error');
    try {
      await call('auth.setup', { name: f.name || 'Administrateur', pin: f.pin, hotel_name: f.hotel_name, demo: f.demo });
      const u = await call('auth.login', f.pin);
      onDone(u);
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <form className="login-box col" style={{ gap: 14 }} onSubmit={submit}>
      <h2 style={{ margin: 0 }}>Première configuration</h2>
      <p className="muted" style={{ margin: 0 }}>Créez le compte administrateur de cet établissement.</p>
      <Field label="Nom de l’établissement"><Input value={f.hotel_name} onChange={set('hotel_name')} placeholder="Hôtel Les Palmiers" required /></Field>
      <Field label="Votre nom"><Input value={f.name} onChange={set('name')} placeholder="Directeur" required /></Field>
      <div className="form">
        <Field label="Code PIN (4 à 8 chiffres)"><Input type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} required /></Field>
        <Field label="Confirmer le PIN"><Input type="password" inputMode="numeric" value={f.pin2} onChange={set('pin2')} required /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.demo} onChange={(e) => set('demo')(e.target.checked)} /> Charger des données de démonstration (chambres, carte, historique)</label>
      <button className="btn primary lg" type="submit">Créer et démarrer</button>
    </form>
  );
}

function PinLogin({ onLogin }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const submit = useCallback(async (p) => {
    try {
      onLogin(await call('auth.login', p));
    } catch {
      setErr(true);
      setTimeout(() => { setErr(false); setPin(''); }, 400);
    }
  }, [onLogin]);
  const press = useCallback((k) => {
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return pin.length >= 4 && submit(pin);
    setPin((p) => (p.length < 8 ? p + k : p));
  }, [pin, submit]);
  useEffect(() => {
    const h = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [press]);
  return (
    <div className="login-box">
      <h2 style={{ margin: 0, textAlign: 'center' }}>Connexion</h2>
      <p className="muted" style={{ textAlign: 'center', margin: '6px 0 0' }}>Saisissez votre code PIN</p>
      <div className={`pin-dots ${err ? 'shake' : ''}`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? 'on' : ''} style={err ? { borderColor: 'var(--bad)' } : null} />)}
      </div>
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} onClick={() => press(k)} style={k === 'ok' ? { background: 'linear-gradient(135deg,var(--accent),var(--accent-2))', color: '#fff', borderColor: 'transparent' } : null}>
            {k === 'del' ? <Delete size={20} /> : k === 'ok' ? 'OK' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Login({ settings, onLogin }) {
  const [setup, setSetup] = useState(null);
  useEffect(() => { call('auth.needsSetup').then(setSetup).catch(() => setSetup(false)); }, []);
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo"><Hotel size={20} /></div>
          <div><b>Hospitalis</b><small style={{ color: '#9aa6c4' }}>Hôtel · Bar · Restaurant</small></div>
        </div>
        <div>
          <h1>{settings.hotel_name && settings.hotel_name !== 'Mon Hôtel' ? settings.hotel_name : 'Toute votre exploitation, un seul logiciel.'}</h1>
          <p>Réservations, chambres, caisse bar et restaurant, stocks et tableau de bord en temps réel. Fonctionne sans Internet, se synchronise avec votre serveur dès que la connexion revient.</p>
        </div>
        <div className="login-feats">
          <div><BedDouble size={20} /><b>Hôtel</b>Planning, check-in/out, factures</div>
          <div><UtensilsCrossed size={20} /><b>Bar & Resto</b>Caisse tactile, tables, stocks</div>
          <div><CloudCog size={20} /><b>Hors-ligne</b>Synchro auto avec le VPS</div>
        </div>
      </div>
      <div className="login-panel">
        {setup === null ? null : setup ? <Setup onDone={onLogin} /> : <PinLogin onLogin={onLogin} />}
      </div>
    </div>
  );
}
