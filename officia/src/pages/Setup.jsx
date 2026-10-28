import { useCallback, useEffect, useState } from 'react';
import { Sparkles, CalendarDays, Users2, Mail, Delete, Plus, Lock, ArrowLeft, Trash2, FlaskConical, ChevronRight } from 'lucide-react';
import { call } from '../lib/api';
import { Field, Input, Badge, toast, confirmBox } from '../components/ui';
import { initials, ago } from '../lib/format';
import { ABOUT } from '../lib/about';

const DEMO_SETTINGS = { user_name: 'Awa Kouassi', user_title: 'Assistante de direction', organisation: 'Société de démonstration', manager_name: 'Mme Aminata Koné, Directrice générale' };

export function Art() {
  return (
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
  );
}

// Création d'une session : données réelles (par défaut) ou démonstration.
function CreateForm({ onCreated, onBack }) {
  const [f, setF] = useState({ user_name: '', user_title: 'Assistante de direction', organisation: '', manager_name: '', pin: '', pin2: '', demo: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (!f.user_name.trim()) return toast('Indiquez votre nom', 'error');
    if (f.pin && f.pin !== f.pin2) return toast('Les deux codes ne correspondent pas', 'error');
    setBusy(true);
    try {
      const { demo, pin, pin2, ...settings } = f; // eslint-disable-line no-unused-vars
      await call('session.create', { settings, demo, pin: pin || undefined });
      onCreated();
    } catch (err) { toast(err.message, 'error'); setBusy(false); }
  };
  return (
    <form className="login-box col" style={{ gap: 13, width: 400 }} onSubmit={submit}>
      {onBack && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}><ArrowLeft size={15} />Sessions</button>}
      <h2 style={{ margin: 0 }}>Nouvelle session</h2>
      <p className="muted" style={{ margin: 0 }}>Une session vierge pour vos données réelles. Elle est totalement séparée des autres sessions.</p>
      <Field label="Votre nom"><Input autoFocus value={f.user_name} onChange={set('user_name')} placeholder="Prénom Nom" /></Field>
      <Field label="Votre fonction"><Input value={f.user_title} onChange={set('user_title')} /></Field>
      <Field label="Organisation"><Input value={f.organisation} onChange={set('organisation')} placeholder="Société, ministère, cabinet…" /></Field>
      <Field label="Personne assistée (facultatif)"><Input value={f.manager_name} onChange={set('manager_name')} placeholder="Mme la Directrice générale" /></Field>
      <div className="form" style={{ gap: 10 }}>
        <Field label="Code de session (facultatif)"><Input type="password" inputMode="numeric" value={f.pin} onChange={set('pin')} placeholder="4 à 8 chiffres" /></Field>
        <Field label="Confirmer le code"><Input type="password" inputMode="numeric" value={f.pin2} onChange={set('pin2')} /></Field>
      </div>
      <label className="check small"><input type="checkbox" checked={f.demo} onChange={(e) => set('demo')(e.target.checked)} /> Remplir avec des données de démonstration</label>
      <button className="btn primary lg" type="submit" disabled={busy}>{busy ? 'Création…' : 'Créer ma session'}</button>
    </form>
  );
}

export function PinPad({ profile, onBack, onOpened, unlock, hint = 'Saisissez votre code de session', backLabel = 'Sessions' }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const submit = useCallback(async (p) => {
    try { await (unlock ? call('session.unlock', p) : call('session.open', profile.id, p)); onOpened(); } catch { setErr(true); setTimeout(() => { setErr(false); setPin(''); }, 400); }
  }, [profile, onOpened, unlock]);
  const press = useCallback((k) => {
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return pin.length >= 4 && submit(pin);
    setPin((p) => (p.length < 8 ? p + k : p));
  }, [pin, submit]);
  useEffect(() => {
    const h = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok'); else if (e.key === 'Escape' && !unlock) onBack(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [press, onBack, unlock]);
  return (
    <div className="login-box" style={{ width: 360, textAlign: 'center' }}>
      <button className="btn ghost sm" style={{ float: 'left' }} onClick={onBack}><ArrowLeft size={15} />{backLabel}</button>
      <div style={{ clear: 'both' }} />
      <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, margin: '6px auto 12px' }}>{initials(profile.name)}</div>
      <h2 style={{ margin: 0 }}>{profile.name}</h2>
      <p className="muted" style={{ margin: '4px 0 0' }}>{hint}</p>
      <div className={`pin-dots ${err ? 'shake' : ''}`}>{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}</div>
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

// Écran des sessions : choisir une session, en créer une nouvelle, ouvrir la démonstration.
export default function Sessions({ onOpened }) {
  const [list, setList] = useState(null);
  const [mode, setMode] = useState('list'); // list | create | pin
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const st = await call('session.state');
    setList(st.profiles);
    if (!st.profiles.length) setMode('create');
  }, []);
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, [load]);

  const choose = async (p) => {
    if (p.has_lock) { setTarget(p); setMode('pin'); return; }
    try { await call('session.open', p.id); onOpened(); } catch (e) {
      if (/Code/.test(e.message)) { setTarget({ ...p, has_lock: true }); setMode('pin'); } else toast(e.message, 'error');
    }
  };
  const openDemo = async () => {
    setBusy(true);
    try { await call('session.create', { settings: DEMO_SETTINGS, demo: true }); onOpened(); } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const remove = async (e, p) => {
    e.stopPropagation();
    const ok = await confirmBox(`Supprimer définitivement la session « ${p.name} » et toutes ses données (agenda, messages, courriers…) ?`, { danger: true, okLabel: 'Supprimer' });
    if (!ok) return;
    let pin;
    if (p.has_lock) { pin = await confirmBox('Code de cette session', { input: 'Code', okLabel: 'Valider' }); if (pin === false) return; }
    try { await call('session.remove', p.id, pin); toast('Session supprimée', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
  };

  if (!list) return null;
  const hasDemo = list.some((p) => p.demo);
  const sorted = [...list].sort((a, b) => (a.demo - b.demo) || String(b.last_used || '').localeCompare(String(a.last_used || '')));
  return (
    <div className="login">
      <Art />
      <div className="login-panel">
        {mode === 'create' && <CreateForm onCreated={onOpened} onBack={list.length ? () => setMode('list') : null} />}
        {mode === 'pin' && target && <PinPad profile={target} onBack={() => setMode('list')} onOpened={onOpened} />}
        {mode === 'list' && (
          <div className="login-box col" style={{ gap: 14, width: 420 }}>
            <div>
              <h2 style={{ margin: 0 }}>Choisir une session</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Chaque session a ses propres données, sa messagerie et son code.</p>
            </div>
            <div className="col" style={{ gap: 10, maxHeight: '52vh', overflowY: 'auto' }}>
              {sorted.map((p) => (
                <div key={p.id} className="card row" style={{ padding: 14, cursor: 'pointer', boxShadow: 'none', gap: 12 }} onClick={() => choose(p)}>
                  <div className="avatar" style={{ width: 44, height: 44, fontSize: 15, background: p.demo ? 'linear-gradient(135deg,#f59f00,#e8590c)' : undefined }}>{p.demo ? <FlaskConical size={19} /> : initials(p.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</b>{p.has_lock && <Lock size={13} color="var(--muted)" />}</div>
                    <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.title, p.organisation].filter(Boolean).join(' · ') || '—'}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      {p.demo ? <Badge kind="warn">Démonstration</Badge> : <Badge kind="good">Données réelles</Badge>}
                      {p.last_used && <span className="muted" style={{ fontSize: 11 }}>Ouverte {ago(p.last_used)}</span>}
                    </div>
                  </div>
                  <button className="btn ghost sm icon" title="Supprimer cette session" onClick={(e) => remove(e, p)}><Trash2 size={14} /></button>
                  <ChevronRight size={18} color="var(--muted)" />
                </div>
              ))}
            </div>
            <button className="btn primary lg" onClick={() => setMode('create')}><Plus size={18} />Nouvelle session (données réelles)</button>
            {!hasDemo && <button className="btn" disabled={busy} onClick={openDemo}><FlaskConical size={16} />{busy ? 'Préparation…' : 'Ouvrir une session de démonstration'}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
