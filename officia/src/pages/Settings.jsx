import { useEffect, useState } from 'react';
import { UserRound, BellRing, Mail, FileText, ShieldCheck, HardDrive, Save, Plus, PlugZap, Download, Upload, FolderOpen, CheckCircle2, XCircle } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { ago } from '../lib/format';
import { Tabs, Card, Field, Input, Select, Empty, Badge, toast, Modal } from '../components/ui';
import { EditModal } from '../components/crud';

function Profile() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await act(() => call('settings.save', f), 'Profil enregistré')) reloadSettings(); };
  return (
    <Card title="Profil et organisation" hint="Ces informations figurent sur les convocations, PV et documents imprimés" right={<button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>}>
      <div className="form" style={{ maxWidth: 900 }}>
        <Field label="Votre nom"><Input value={f.user_name} onChange={set('user_name')} /></Field>
        <Field label="Votre fonction"><Input value={f.user_title} onChange={set('user_title')} /></Field>
        <Field label="Personne assistée"><Input value={f.manager_name} onChange={set('manager_name')} placeholder="Utilisée par défaut pour les appels et le courrier" /></Field>
        <Field label="Organisation"><Input value={f.organisation} onChange={set('organisation')} /></Field>
        <Field label="Adresse" full><Input value={f.org_address} onChange={set('org_address')} /></Field>
        <Field label="Téléphone"><Input value={f.org_phone} onChange={set('org_phone')} /></Field>
        <Field label="Début de journée"><Input type="time" value={f.workday_start} onChange={set('workday_start')} /></Field>
      </div>
    </Card>
  );
}

function Notifications() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const check = (k, label, hint) => (
    <label className="list-row" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={f[k] === '1'} onChange={(e) => set(k)(e.target.checked ? '1' : '0')} />
      <div><b>{label}</b><div className="muted small">{hint}</div></div>
    </label>
  );
  const save = async () => { if (await act(() => call('settings.save', f), 'Préférences enregistrées')) reloadSettings(); };
  return (
    <div className="grid g2">
      <Card title="Notifications" right={<button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>}>
        {check('notify_native', 'Notifications Windows', 'Une bulle s’affiche en bas à droite de l’écran, même si Officia est réduit.')}
        {check('notify_sound', 'Son', 'Jouer le son de notification de Windows.')}
        <div className="form mt">
          <Field label="Rappel par défaut des rendez-vous"><Select value={f.default_reminder} onChange={set('default_reminder')} options={[['0', 'À l’heure'], ['5', '5 min avant'], ['10', '10 min avant'], ['15', '15 min avant'], ['30', '30 min avant'], ['60', '1 h avant']]} /></Field>
          <Field label="Récapitulatif des tâches à"><Input type="time" value={f.task_digest_hour} onChange={set('task_digest_hour')} /></Field>
        </div>
      </Card>
      <Card title="Démarrage et fenêtre">
        {check('start_with_windows', 'Lancer Officia au démarrage de Windows', 'L’application démarre discrètement dans la zone de notification.')}
        {check('minimize_to_tray', 'Garder Officia actif à la fermeture', 'La croix réduit la fenêtre près de l’horloge : les rappels continuent de s’afficher.')}
        <Field label="Relève de la messagerie (minutes)"><Input type="number" value={f.mail_sync_minutes} onChange={set('mail_sync_minutes')} /></Field>
      </Card>
    </div>
  );
}

function AccountModal({ data, onClose }) {
  const [f, setF] = useState({ smtp_port: 465, smtp_secure: 1, imap_port: 993, imap_secure: 1, ...data, password: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const [test, setTest] = useState(null);
  const applyPreset = async (email) => {
    set('email')(email);
    if (f.smtp_host) return;
    const p = await call('mail.preset', email).catch(() => null);
    if (p) setF((x) => ({ ...x, ...p, email }));
  };
  const save = async () => { const r = await act(() => call('mail.saveAccount', f), 'Compte enregistré'); if (r) { setF((x) => ({ ...x, id: r.id, password: '' })); return r; } return null; };
  const doTest = async () => { const r = await save(); if (!r) return; setTest('…'); const t = await act(() => call('mail.test', r.id)); setTest(t || null); };
  const ok = (v) => (v === 'ok' ? <span className="row pos-val" style={{ gap: 5 }}><CheckCircle2 size={15} />Connexion réussie</span> : v ? <span className="row neg-val small" style={{ gap: 5 }}><XCircle size={15} />{v}</span> : <span className="muted">—</span>);
  return (
    <Modal size="wide" title={f.id ? f.email : 'Ajouter un compte de messagerie'} icon={<Mail size={19} color="var(--accent)" />} onClose={onClose}
      footer={<><button className="btn" onClick={doTest}><PlugZap size={16} />Tester la connexion</button><div style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Fermer</button><button className="btn primary" onClick={async () => { if (await save()) onClose(); }}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Adresse e-mail"><Input value={f.email} onChange={applyPreset} placeholder="secretariat@exemple.com" /></Field>
        <Field label="Nom affiché"><Input value={f.display_name} onChange={set('display_name')} placeholder="Secrétariat de Direction" /></Field>
        <Field label="Identifiant (souvent l’adresse)"><Input value={f.username} onChange={set('username')} placeholder={f.email} /></Field>
        <Field label={f.has_password ? 'Mot de passe (laisser vide pour conserver)' : 'Mot de passe / mot de passe d’application'}><Input type="password" value={f.password} onChange={set('password')} /></Field>
        <div className="full nav-label" style={{ padding: '4px 0 0' }}>Envoi (SMTP)</div>
        <Field label="Serveur SMTP"><Input value={f.smtp_host} onChange={set('smtp_host')} placeholder="smtp.exemple.com" /></Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Port"><Input type="number" value={f.smtp_port} onChange={set('smtp_port')} /></Field>
          <Field label="Sécurité"><Select value={String(f.smtp_secure)} onChange={(v) => set('smtp_secure')(Number(v))} options={[['1', 'SSL/TLS (465)'], ['0', 'STARTTLS (587)']]} /></Field>
        </div>
        <div className="full nav-label" style={{ padding: '4px 0 0' }}>Réception (IMAP)</div>
        <Field label="Serveur IMAP"><Input value={f.imap_host} onChange={set('imap_host')} placeholder="imap.exemple.com" /></Field>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Port"><Input type="number" value={f.imap_port} onChange={set('imap_port')} /></Field>
          <Field label="Sécurité"><Select value={String(f.imap_secure)} onChange={(v) => set('imap_secure')(Number(v))} options={[['1', 'SSL/TLS (993)'], ['0', 'Aucune / STARTTLS (143)']]} /></Field>
        </div>
        <Field label="Signature" full><textarea className="input" value={f.signature || ''} onChange={(e) => set('signature')(e.target.value)} placeholder={'Awa Kouassi\nAssistante de Direction\nTél. : …'} /></Field>
        {test && test !== '…' && <div className="full card" style={{ boxShadow: 'none' }}><div className="list-row"><b style={{ width: 120 }}>Envoi</b>{ok(test.smtp)}</div><div className="list-row"><b style={{ width: 120 }}>Réception</b>{ok(test.imap)}</div></div>}
        {test === '…' && <div className="full muted">Test en cours…</div>}
        <div className="full muted small"><ShieldCheck size={13} /> Le mot de passe est chiffré par Windows sur ce poste. Pour Gmail ou Outlook avec validation en deux étapes, utilisez un « mot de passe d’application ».</div>
      </div>
    </Modal>
  );
}

function MailAccounts() {
  const [rows, reload] = useData('mail.accounts');
  const [edit, setEdit] = useState(null);
  return (
    <Card title="Comptes de messagerie" hint="Officia relève vos messages (IMAP) et les envoie (SMTP). Sans connexion, les envois patientent dans la boîte d’envoi." right={<button className="btn primary sm" onClick={() => setEdit({})}><Plus size={14} />Ajouter un compte</button>}>
      {(rows || []).map((a) => (
        <div key={a.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setEdit(a)}>
          <div className="avatar" style={{ width: 36, height: 36 }}><Mail size={16} /></div>
          <div style={{ flex: 1 }}><b>{a.display_name || a.name}</b><div className="muted small">{a.email} · {a.smtp_host || 'SMTP non configuré'}{a.imap_host ? ` · ${a.imap_host}` : ''}</div></div>
          {a.last_error ? <Badge kind="bad">Erreur</Badge> : a.last_sync ? <Badge kind="good">Relevé {ago(a.last_sync)}</Badge> : <Badge>Jamais relevé</Badge>}
        </div>
      ))}
      {rows && !rows.length && <Empty icon={Mail}>Aucun compte. Ajoutez votre adresse professionnelle pour envoyer convocations et PV directement depuis Officia.</Empty>}
      {edit && <AccountModal data={edit} onClose={() => { setEdit(null); reload(); }} />}
    </Card>
  );
}

function Templates() {
  const [rows, reload] = useData('db.list', ['templates', {}, 'name']);
  const [edit, setEdit] = useState(null);
  return (
    <Card title="Modèles de messages" hint="Variables disponibles : {{nom}} {{date}} {{heure}} {{lieu}} {{objet}} {{organisation}} {{signature}}" right={<button className="btn primary sm" onClick={() => setEdit({ category: 'Général' })}><Plus size={14} />Modèle</button>}>
      <div className="grid g3">
        {(rows || []).map((t) => (
          <div key={t.id} className="card" style={{ boxShadow: 'none', cursor: 'pointer' }} onClick={() => setEdit(t)}>
            <Badge kind="info">{t.category}</Badge>
            <div className="strong mt">{t.name}</div>
            <div className="muted small" style={{ whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>{t.body}</div>
          </div>
        ))}
      </div>
      {rows && !rows.length && <Empty icon={FileText}>Aucun modèle</Empty>}
      {edit && <EditModal table="templates" title="Modèle de message" initial={edit} onClose={() => setEdit(null)} onSaved={reload}
        fields={[{ k: 'name', label: 'Nom du modèle', required: true }, { k: 'category', label: 'Catégorie' }, { k: 'subject', label: 'Objet', full: true }, { k: 'body', label: 'Texte', type: 'textarea' }]} />}
    </Card>
  );
}

function Security() {
  const { settings, reloadSettings } = useApp();
  const [pin, setPin] = useState('');
  const save = async (value) => { if (await act(() => call('settings.lockPin', value), value ? 'Code de verrouillage activé' : 'Verrouillage désactivé')) { setPin(''); reloadSettings(); } };
  return (
    <Card title="Verrouillage" hint="Protégez l’agenda et les messages lorsque vous quittez votre bureau">
      <div className="row" style={{ gap: 10, maxWidth: 560 }}>
        <Input type="password" value={pin} onChange={setPin} placeholder="Nouveau code (4 à 8 chiffres)" />
        <button className="btn primary" onClick={() => save(pin)}>{settings.has_lock === '1' ? 'Changer le code' : 'Activer'}</button>
        {settings.has_lock === '1' && <button className="btn danger" onClick={() => save('')}>Désactiver</button>}
      </div>
      <p className="muted small mt">{settings.has_lock === '1' ? 'Le code est demandé à l’ouverture d’Officia et après un clic sur le cadenas.' : 'Aucun code : Officia s’ouvre directement.'}</p>
    </Card>
  );
}

function Backup() {
  const [info, setInfo] = useState(null);
  useEffect(() => { call('app.info').then(setInfo).catch(() => {}); }, []);
  return (
    <div className="grid g2">
      <Card title="Sauvegardes" hint="Une sauvegarde automatique est réalisée chaque jour (30 jours conservés).">
        <div className="col">
          <button className="btn" onClick={async () => { const p = await act(() => call('backup.create')); if (p) toast(`Sauvegarde créée : ${p}`, 'success'); }}><Download size={16} />Créer une sauvegarde…</button>
          <button className="btn danger" onClick={() => act(() => call('backup.restore'))}><Upload size={16} />Restaurer une sauvegarde…</button>
          <button className="btn" onClick={() => call('backup.openFolder')}><FolderOpen size={16} />Ouvrir le dossier des données</button>
        </div>
      </Card>
      <Card title="À propos">
        {info && <><div className="list-row"><span>Version</span><b className="right">Officia {info.version}</b></div><div className="list-row"><span>Données</span><code className="right small muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.dataDir}</code></div></>}
        <div className="list-row"><span>Raccourcis</span><span className="right muted small">Ctrl+K rechercher · Ctrl+N nouveau</span></div>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { nav } = useApp();
  const [tab, setTab] = useState(nav.tab || 'profile');
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs value={tab} onChange={setTab} tabs={[['profile', 'Profil', UserRound], ['notif', 'Notifications', BellRing], ['mail', 'Messagerie', Mail], ['templates', 'Modèles', FileText], ['security', 'Sécurité', ShieldCheck], ['backup', 'Sauvegarde', HardDrive]]} />
      </div>
      {tab === 'profile' && <Profile />}
      {tab === 'notif' && <Notifications />}
      {tab === 'mail' && <MailAccounts />}
      {tab === 'templates' && <Templates />}
      {tab === 'security' && <Security />}
      {tab === 'backup' && <Backup />}
    </div>
  );
}
