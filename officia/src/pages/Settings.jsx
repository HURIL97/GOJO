import { useEffect, useState } from 'react';
import {
  UserRound, BellRing, Mail, FileText, ShieldCheck, HardDrive, Save, Plus, PlugZap, Download, Upload, FolderOpen, CheckCircle2, XCircle,
  Image as ImageIcon, Trash2, Users2, RefreshCw, Smartphone, Copy, CalendarDays, Lock, DownloadCloud, Server,
} from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { ago, fmtDateTime } from '../lib/format';
import { on } from '../lib/api';
import { ABOUT } from '../lib/about';
import { Tabs, Card, Field, Input, Select, Empty, Badge, toast, Modal, confirmBox } from '../components/ui';
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
        <Field label="Indicatif téléphonique par défaut"><Input value={f.phone_country} onChange={set('phone_country')} placeholder="225" /></Field>
      </div>
    </Card>
  );
}

// Papier à en-tête : utilisé pour les lettres, convocations, PV et registres imprimés.
function Letterhead() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const pick = async () => { const d = await act(() => call('settings.pickLogo')); if (d) set('org_logo')(d); };
  const save = async () => { if (await act(() => call('settings.save', { org_logo: f.org_logo, org_email: f.org_email, org_footer: f.org_footer, org_city: f.org_city, letter_signatory: f.letter_signatory, org_address: f.org_address, org_phone: f.org_phone }), 'Papier à en-tête enregistré')) reloadSettings(); };
  return (
    <Card title="Papier à en-tête" hint="Logo et mentions repris sur les lettres, convocations, PV et registres" right={<button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>}>
      <div className="grid" style={{ gridTemplateColumns: '220px 1fr', gap: 18 }}>
        <div className="col" style={{ gap: 8 }}>
          <div className="card" style={{ boxShadow: 'none', height: 130, display: 'grid', placeItems: 'center', background: '#fff' }}>
            {f.org_logo ? <img src={f.org_logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: 110 }} /> : <span className="muted small" style={{ color: '#888' }}>Aucun logo</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" style={{ flex: 1 }} onClick={pick}><ImageIcon size={14} />{f.org_logo ? 'Changer' : 'Choisir le logo'}</button>
            {f.org_logo && <button className="btn sm ghost icon" title="Retirer" onClick={() => set('org_logo')('')}><Trash2 size={14} /></button>}
          </div>
        </div>
        <div className="form">
          <Field label="Adresse" full><Input value={f.org_address} onChange={set('org_address')} placeholder="Rue, quartier, BP, ville" /></Field>
          <Field label="Téléphone"><Input value={f.org_phone} onChange={set('org_phone')} /></Field>
          <Field label="E-mail"><Input value={f.org_email} onChange={set('org_email')} /></Field>
          <Field label="Ville (« Fait à … »)"><Input value={f.org_city} onChange={set('org_city')} placeholder="Abidjan" /></Field>
          <Field label="Signataire des lettres (2 lignes possibles)"><textarea className="input" style={{ minHeight: 58 }} value={f.letter_signatory || ''} onChange={(e) => set('letter_signatory')(e.target.value)} placeholder={'La Directrice Générale\nMme …'} /></Field>
          <Field label="Pied de page (mentions légales)" full><Input value={f.org_footer} onChange={set('org_footer')} placeholder="SARL au capital de … — RCCM … — CC …" /></Field>
        </div>
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
        {check('notify_native', 'Notifications Windows', 'Une bulle s’affiche en bas à droite de l’écran, même si OfficiaTech est réduit.')}
        {check('notify_sound', 'Son', 'Jouer le son de notification de Windows.')}
        <div className="form mt">
          <Field label="Rappel par défaut des rendez-vous"><Select value={f.default_reminder} onChange={set('default_reminder')} options={[['0', 'À l’heure'], ['5', '5 min avant'], ['10', '10 min avant'], ['15', '15 min avant'], ['30', '30 min avant'], ['60', '1 h avant']]} /></Field>
          <Field label="Récapitulatif des tâches à"><Input type="time" value={f.task_digest_hour} onChange={set('task_digest_hour')} /></Field>
        </div>
      </Card>
      <Card title="Démarrage et fenêtre">
        {check('start_with_windows', 'Lancer OfficiaTech au démarrage de Windows', 'L’application démarre discrètement dans la zone de notification.')}
        {check('minimize_to_tray', 'Garder OfficiaTech actif à la fermeture', 'La croix réduit la fenêtre près de l’horloge : les rappels continuent de s’afficher.')}
        <Field label="Relève de la messagerie (minutes)"><Input type="number" value={f.mail_sync_minutes} onChange={set('mail_sync_minutes')} /></Field>
      </Card>
      <Card title="Rappels automatiques" hint="Envoyés depuis votre premier compte de messagerie" right={<button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>}>
        {check('visitor_reminder', 'Rappeler leurs rendez-vous aux visiteurs la veille', 'Un e-mail de rappel (avec l’invitation calendrier) part automatiquement. Les visiteurs sans e-mail sont listés dans « Ma journée » pour un rappel WhatsApp ou SMS.')}
        <div className="form" style={{ marginBottom: 6 }}><Field label="Heure d’envoi des rappels"><Input type="time" value={f.visitor_reminder_hour} onChange={set('visitor_reminder_hour')} /></Field></div>
        {check('courrier_auto_relance', 'Relancer automatiquement le courrier en retard', 'Quand la date de réponse est dépassée, le service destinataire (adresse e-mail renseignée dans le circuit) reçoit une relance.')}
        <div className="form"><Field label="Délai entre deux relances (jours)"><Input type="number" value={f.courrier_relance_days} onChange={set('courrier_relance_days')} /></Field></div>
      </Card>
    </div>
  );
}

const isMs = (email) => /@(outlook|hotmail|live|msn)\.[a-z.]+$/i.test(email || '');

function AccountModal({ data, onClose }) {
  const { settings } = useApp();
  const [f, setF] = useState({ smtp_port: 465, smtp_secure: 1, imap_port: 993, imap_secure: 1, ...data, password: '' });
  const [msBusy, setMsBusy] = useState(false);
  const microsoft = async () => {
    if (!String(settings.ms_client_id || '').trim()) return toast('Renseignez d’abord l’identifiant d’application Microsoft (encadré « Connexion Microsoft »)', 'error');
    setMsBusy(true);
    toast('Votre navigateur s’ouvre : connectez-vous sur la page officielle de Microsoft', 'info');
    const r = await act(() => call('mail.microsoft', { id: f.id, email: f.email, display_name: f.display_name, signature: f.signature, save_sent: f.save_sent }), 'Compte Microsoft connecté');
    setMsBusy(false);
    if (r) setF((x) => ({ ...x, ...r, password: '' }));
  };
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
        {(isMs(f.email) || f.auth_type === 'oauth_ms') && (
          <div className="full card" style={{ boxShadow: 'none', background: 'var(--accent-soft, rgba(123,108,255,.08))' }}>
            <div className="row between wrap" style={{ gap: 10 }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <b>Outlook, Hotmail, Microsoft 365</b>
                <div className="muted small">{f.auth_type === 'oauth_ms' && f.has_oauth ? 'Compte connecté par Microsoft : aucun mot de passe n’est enregistré dans OfficiaTech.' : 'Microsoft refuse la connexion par simple mot de passe : connectez le compte sur la page officielle de Microsoft.'}</div>
              </div>
              <button className="btn primary" disabled={msBusy} onClick={microsoft}>
                <svg width="15" height="15" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
                {msBusy ? 'En attente du navigateur…' : f.auth_type === 'oauth_ms' && f.has_oauth ? 'Reconnecter' : 'Se connecter avec Microsoft'}
              </button>
            </div>
          </div>
        )}
        {f.auth_type !== 'oauth_ms' && <>
          <Field label="Identifiant (souvent l’adresse)"><Input value={f.username} onChange={set('username')} placeholder={f.email} /></Field>
          <Field label={f.has_password ? 'Mot de passe (laisser vide pour conserver)' : 'Mot de passe / mot de passe d’application'}><Input type="password" value={f.password} onChange={set('password')} /></Field>
        </>}
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
        <Field label="Copie des messages envoyés dans « Envoyés » du serveur" full><Select value={f.save_sent == null || f.save_sent === '' ? '' : String(f.save_sent)} onChange={(v) => set('save_sent')(v === '' ? null : Number(v))} placeholder="Automatique (recommandé)" options={[['1', 'Oui : visibles aussi sur le téléphone et le webmail'], ['0', 'Non']]} /></Field>
        <Field label="Signature" full><textarea className="input" value={f.signature || ''} onChange={(e) => set('signature')(e.target.value)} placeholder={'Awa Kouassi\nAssistante de Direction\nTél. : …'} /></Field>
        {test && test !== '…' && <div className="full card" style={{ boxShadow: 'none' }}><div className="list-row"><b style={{ width: 120 }}>Envoi</b>{ok(test.smtp)}</div><div className="list-row"><b style={{ width: 120 }}>Réception</b>{ok(test.imap)}</div>
          {test.smtp_suggest && (
            <div className="row between mt" style={{ background: 'var(--good-soft)', borderRadius: 10, padding: '10px 12px', gap: 10 }}>
              <span className="small">Sur ce poste, l’envoi fonctionne avec le port <b>{test.smtp_suggest.port}</b> ({test.smtp_suggest.secure ? 'SSL/TLS' : 'STARTTLS'}).</span>
              <button className="btn sm primary" onClick={async () => { setF((x) => ({ ...x, smtp_port: test.smtp_suggest.port, smtp_secure: test.smtp_suggest.secure })); const r = await act(() => call('mail.saveAccount', { ...f, smtp_port: test.smtp_suggest.port, smtp_secure: test.smtp_suggest.secure }), 'Réglage d’envoi corrigé'); if (r) { setTest('…'); setTest(await act(() => call('mail.test', r.id)) || null); } }}>Utiliser ce réglage</button>
            </div>
          )}
        </div>}
        {test === '…' && <div className="full muted">Test en cours…</div>}
        <div className="full muted small"><ShieldCheck size={13} /> Le mot de passe est chiffré par Windows sur ce poste. Gmail et Yahoo : utilisez un « mot de passe d’application ». OfficiaTech relève la boîte de réception, les Envoyés, les Archives et les Indésirables ; lu/non lu et favoris sont synchronisés avec le téléphone.</div>
      </div>
    </Modal>
  );
}

function MicrosoftConfig() {
  const { settings, reloadSettings } = useApp();
  const [id, setId] = useState(settings.ms_client_id || '');
  const [tenant, setTenant] = useState(settings.ms_tenant || 'common');
  const save = async () => { if (await act(() => call('settings.save', { ms_client_id: id.trim(), ms_tenant: tenant.trim() || 'common' }), 'Connexion Microsoft configurée')) reloadSettings(); };
  return (
    <Card title="Connexion Microsoft (Outlook, Hotmail, Microsoft 365)" hint="À faire une seule fois, par vous ou votre informaticien" right={<button className="btn primary sm" onClick={save}><Save size={14} />Enregistrer</button>}>
      <div className="form">
        <Field label="Identifiant d’application (client ID)"><Input value={id} onChange={setId} placeholder="00000000-0000-0000-0000-000000000000" /></Field>
        <Field label="Annuaire (tenant)"><Input value={tenant} onChange={setTenant} placeholder="common" /></Field>
      </div>
      <ol className="muted small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
        <li>Ouvrez <b>entra.microsoft.com</b> › Applications › Inscriptions d’applications › <b>Nouvelle inscription</b> (gratuit).</li>
        <li>Nom : OfficiaTech. Types de comptes : <b>tous les comptes Microsoft</b> (professionnels et personnels).</li>
        <li>URI de redirection : plateforme <b>« Client public / natif (mobile et bureau) »</b>, adresse <code>http://localhost</code>.</li>
        <li>Autorisations d’API › Ajouter › <b>Office 365 Exchange Online</b> (ou « API utilisées par mon organisation ») : <code>IMAP.AccessAsUser.All</code> et <code>SMTP.Send</code>.</li>
        <li>Copiez « ID d’application (client) » ici. Microsoft 365 entreprise : l’administrateur doit aussi autoriser l’IMAP et le SMTP authentifié pour la boîte.</li>
      </ol>
    </Card>
  );
}

function MailAccounts() {
  const [rows, reload] = useData('mail.accounts');
  const [edit, setEdit] = useState(null);
  return (
    <div className="col" style={{ gap: 16 }}>
    <Card title="Comptes de messagerie" hint="OfficiaTech relève vos messages (IMAP) et les envoie (SMTP). Sans connexion, les envois patientent dans la boîte d’envoi." right={<button className="btn primary sm" onClick={() => setEdit({})}><Plus size={14} />Ajouter un compte</button>}>
      {(rows || []).map((a) => (
        <div key={a.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setEdit(a)}>
          <div className="avatar" style={{ width: 36, height: 36 }}><Mail size={16} /></div>
          <div style={{ flex: 1 }}><b>{a.display_name || a.name}</b><div className="muted small">{a.email} · {a.smtp_host || 'SMTP non configuré'}{a.imap_host ? ` · ${a.imap_host}` : ''}</div></div>
          {a.auth_type === 'oauth_ms' && <Badge kind="info">Microsoft</Badge>}
          {a.last_error ? <span title={a.last_error}><Badge kind="bad">Erreur</Badge></span> : a.last_sync ? <Badge kind="good">Relevé {ago(a.last_sync)}</Badge> : <Badge>Jamais relevé</Badge>}
          <button className="btn ghost sm icon" title="Supprimer ce compte" onClick={async (e) => { e.stopPropagation(); if (await confirmBox(`Supprimer le compte ${a.email} d’OfficiaTech ? Les messages déjà relevés restent consultables.`, { danger: true, okLabel: 'Supprimer' })) { await act(() => call('mail.removeAccount', a.id), 'Compte supprimé'); reload(); } }}><Trash2 size={14} /></button>
        </div>
      ))}
      {rows && !rows.length && <Empty icon={Mail}>Aucun compte. Ajoutez votre adresse professionnelle pour envoyer convocations et PV directement depuis OfficiaTech.</Empty>}
      {edit && <AccountModal data={edit} onClose={() => { setEdit(null); reload(); }} />}
    </Card>
    <MicrosoftConfig />
    </div>
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
  const [idle, setIdle] = useState(settings.lock_idle_minutes || '10');
  const save = async (value) => { if (await act(() => call('settings.lockPin', value), value ? 'Code de verrouillage activé' : 'Verrouillage désactivé')) { setPin(''); reloadSettings(); } };
  const saveIdle = async (v) => { setIdle(v); if (await act(() => call('settings.save', { lock_idle_minutes: v }), 'Préférence enregistrée')) reloadSettings(); };
  return (
    <div className="grid g2">
      <Card title="Code de la session" hint="Protégez l’agenda, les messages et le courrier">
        <div className="row" style={{ gap: 10 }}>
          <Input type="password" value={pin} onChange={setPin} placeholder="Nouveau code (4 à 8 chiffres)" />
          <button className="btn primary" onClick={() => save(pin)}>{settings.has_lock === '1' ? 'Changer' : 'Activer'}</button>
          {settings.has_lock === '1' && <button className="btn danger" onClick={() => save('')}>Désactiver</button>}
        </div>
        <p className="muted small mt">{settings.has_lock === '1' ? 'Le code est demandé à l’ouverture de la session et pour la déverrouiller.' : 'Aucun code : la session s’ouvre directement et ne peut pas être verrouillée.'}</p>
      </Card>
      <Card title="Verrouillage automatique" hint="La session se verrouille quand vous vous absentez">
        <Field label="Après une inactivité de"><Select value={String(idle)} onChange={saveIdle} options={[['0', 'Jamais'], ['3', '3 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 heure']]} /></Field>
        <p className="muted small mt"><Lock size={13} /> Également au verrouillage de Windows (touches <b>Windows + L</b>) et avec le cadenas en bas du menu (raccourci <b>Ctrl+Maj+L</b>). Les rappels continuent de s’afficher, sans leur contenu.{settings.has_lock !== '1' && <b className="neg-val"> Nécessite un code de session.</b>}</p>
      </Card>
    </div>
  );
}

function Backup() {
  const { settings, reloadSettings } = useApp();
  const [info, setInfo] = useState(null);
  const [list, reloadList] = useData('backup.list');
  const [st, reloadSt] = useData('backup.state');
  const [keep, setKeep] = useState(settings.backup_keep || '30');
  useEffect(() => { call('app.info').then(setInfo).catch(() => {}); }, []);
  const pickDir = async () => {
    const d = await act(() => call('backup.pickDir'));
    if (!d) return;
    if (await act(() => call('settings.save', { backup_dir: d }))) { await reloadSettings(); const p = await act(() => call('backup.external'), 'Première sauvegarde réalisée dans ce dossier'); if (p) { reloadList(); reloadSt(); } }
  };
  const now = async () => { const p = await act(() => call('backup.external'), 'Sauvegarde réalisée'); if (p) { reloadList(); reloadSt(); } };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g2">
        <Card title="Sauvegarde automatique externe" hint="Chaque jour et à la fermeture d’OfficiaTech">
          <div className="list-row"><HardDrive size={16} /><div style={{ flex: 1, minWidth: 0 }}><b>{settings.backup_dir || 'Aucun dossier choisi'}</b><div className="muted small">Clé USB, Google Drive pour ordinateur, OneDrive, Dropbox ou dossier réseau</div></div></div>
          {st && st.error ? <div className="neg-val small mt">{st.error}</div> : st && st.at ? <div className="pos-val small mt">Dernière sauvegarde externe : {fmtDateTime(st.at)}</div> : null}
          <div className="row wrap mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={pickDir}><FolderOpen size={16} />{settings.backup_dir ? 'Changer de dossier' : 'Choisir le dossier'}</button>
            {settings.backup_dir && <button className="btn" onClick={now}><Download size={16} />Sauvegarder maintenant</button>}
            {settings.backup_dir && <button className="btn ghost" onClick={async () => { if (await act(() => call('settings.save', { backup_dir: '' }), 'Sauvegarde externe désactivée')) reloadSettings(); }}>Désactiver</button>}
          </div>
          <div className="form mt"><Field label="Sauvegardes conservées"><Select value={String(keep)} onChange={async (v) => { setKeep(v); if (await act(() => call('settings.save', { backup_keep: v }))) reloadSettings(); }} options={[['7', '7 derniers jours'], ['15', '15 jours'], ['30', '30 jours'], ['90', '90 jours'], ['365', '1 an']]} /></Field></div>
        </Card>
        <Card title="Sauvegarde manuelle">
          <div className="col">
            <button className="btn" onClick={async () => { const p = await act(() => call('backup.create')); if (p) toast(`Sauvegarde créée : ${p}`, 'success'); }}><Download size={16} />Créer une sauvegarde…</button>
            <button className="btn danger" onClick={() => act(() => call('backup.restore'))}><Upload size={16} />Restaurer depuis un fichier…</button>
            <button className="btn" onClick={() => call('backup.openFolder')}><FolderOpen size={16} />Ouvrir le dossier des données</button>
          </div>
          {info && <p className="muted small mt" style={{ wordBreak: 'break-all' }}>Données : {info.dataDir}</p>}
        </Card>
      </div>
      <Card title="Restaurer en un clic" hint="Sauvegardes quotidiennes de cette session, sur ce poste et dans le dossier externe">
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Emplacement</th><th>Fichier</th><th>Taille</th><th /></tr></thead>
            <tbody>
              {(list || []).slice(0, 60).map((b) => (
                <tr key={b.path}><td>{fmtDateTime(b.date)}</td><td>{b.where === 'Dossier externe' ? <Badge kind="info">Externe</Badge> : <Badge>Ce poste</Badge>}</td><td className="muted small">{b.name}</td><td className="muted small">{Math.max(1, Math.round(b.size / 1024))} Ko</td>
                  <td><button className="btn sm" onClick={() => act(() => call('backup.restoreFile', b.path))}>Restaurer</button></td></tr>
              ))}
            </tbody>
          </table>
          {list && !list.length && <Empty icon={HardDrive}>Aucune sauvegarde pour l’instant</Empty>}
        </div>
      </Card>
    </div>
  );
}

function copy(text, label) { navigator.clipboard.writeText(text).then(() => toast(label || 'Copié', 'success')).catch(() => toast(text)); }

function MobileUserModal({ data, onClose }) {
  const [f, setF] = useState({ role: 'direction', active: 1, ...data, code: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const gen = () => set('code')(String(Math.floor(100000 + Math.random() * 900000)));
  const save = async () => { const r = await act(() => call('mobile.save', f), 'Accès mobile enregistré'); if (r) onClose(true); };
  return (
    <Modal title={f.id ? `Accès mobile — ${f.name}` : 'Nouvel accès mobile'} icon={<Smartphone size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<>{f.id && <button className="btn danger" onClick={async () => { if (await confirmBox('Supprimer cet accès ?', { danger: true })) { await act(() => call('mobile.remove', f.id), 'Accès supprimé'); onClose(true); } }}><Trash2 size={16} />Supprimer</button>}<div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Nom"><Input value={f.name} onChange={set('name')} placeholder="Mme Aminata Koné" /></Field>
        <Field label="Identifiant de connexion"><Input value={f.login} onChange={set('login')} placeholder="dg" /></Field>
        <Field label={f.id ? 'Nouveau code (laisser vide pour conserver)' : 'Code d’accès (6 à 10 chiffres)'}><div className="row" style={{ gap: 6 }}><Input value={f.code} onChange={set('code')} placeholder="••••••" /><button className="btn sm" onClick={gen}>Générer</button></div></Field>
        <label className="check" style={{ alignSelf: 'end', height: 38 }}><input type="checkbox" checked={f.active !== 0} onChange={(e) => set('active')(e.target.checked ? 1 : 0)} /> Accès actif</label>
        <div className="full muted small">Communiquez l’identifiant et le code de vive voix. L’accès permet de consulter l’agenda, les tâches et le courrier en cours, et de valider les procès-verbaux. Il est actif après la prochaine synchronisation.</div>
      </div>
    </Modal>
  );
}

function Team() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const [st, reloadSt] = useData('team.state');
  const [users, reloadUsers] = useData('mobile.list');
  const [edit, setEdit] = useState(null);
  useEffect(() => on('sync:status', () => reloadSt()), [reloadSt]);
  const save = async () => { if (await act(() => call('settings.save', { sync_url: f.sync_url, sync_token: f.sync_token, sync_interval: f.sync_interval, device_name: f.device_name }), 'Connexion au serveur enregistrée')) { reloadSettings(); setTimeout(reloadSt, 800); } };
  const test = async () => { const r = await act(() => call('team.test')); if (r) toast(`Serveur joignable : ${(r.devices || []).length} poste(s) connu(s)`, 'success'); };
  const status = !st ? null : st.status === 'off' ? <Badge>Non configuré</Badge> : st.status === 'error' ? <span title={st.lastError}><Badge kind="bad">Hors ligne</Badge></span> : st.status === 'syncing' ? <Badge kind="info">Synchronisation…</Badge> : <Badge kind="good">À jour</Badge>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g2">
        <Card title="Serveur de l’équipe (VPS)" hint="Agenda, réunions, tâches, courrier, appels et contacts partagés entre les postes" right={status}>
          <div className="form">
            <Field label="Adresse du serveur" full><Input value={f.sync_url} onChange={set('sync_url')} placeholder="https://equipe.mon-organisation.com" /></Field>
            <Field label="Jeton de l’équipe" full><Input type="password" value={f.sync_token} onChange={set('sync_token')} placeholder="SYNC_TOKEN du serveur" /></Field>
            <Field label="Nom de ce poste"><Input value={f.device_name} onChange={set('device_name')} placeholder={settings.user_name} /></Field>
            <Field label="Fréquence (secondes)"><Input type="number" value={f.sync_interval} onChange={set('sync_interval')} /></Field>
          </div>
          <div className="row wrap mt" style={{ gap: 8 }}>
            <button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>
            <button className="btn" onClick={test}><PlugZap size={16} />Tester</button>
            {st && st.status !== 'off' && <button className="btn" onClick={() => act(() => call('team.syncNow'), 'Synchronisé').then(reloadSt)}><RefreshCw size={16} />Synchroniser</button>}
          </div>
          {st && st.status !== 'off' && <p className="muted small mt">{st.lastSync ? `Dernière synchronisation : ${ago(st.lastSync)}` : 'Jamais synchronisé'} · {st.pending} modification(s) en attente{st.lastError ? ` · ${st.lastError}` : ''}</p>}
          <p className="muted small"><Server size={13} /> Paramètres, comptes et messages restent propres à chaque poste. Installation du serveur : voir le manuel (dossier « server »).</p>
        </Card>
        <Card title="Agenda sur le téléphone de la Direction" hint="Abonnement en lecture seule, mis à jour automatiquement">
          {st && st.icalUrl ? (
            <>
              <div className="list-row"><CalendarDays size={16} /><code className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{st.icalUrl}</code><button className="btn sm" onClick={() => copy(st.icalUrl, 'Lien de l’agenda copié')}><Copy size={14} /></button></div>
              <ul className="muted small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                <li><b>Google Agenda</b> (ordinateur) : Autres agendas › + › À partir de l’URL › collez le lien. Il apparaît ensuite sur Android.</li>
                <li><b>iPhone</b> : Réglages › Calendrier › Comptes › Ajouter un compte › Autre › Ajouter un calendrier avec abonnement.</li>
                <li><b>Outlook</b> : Ajouter un calendrier › S’abonner à partir du web.</li>
                <li>Les rendez-vous marqués « privé » apparaissent seulement comme « Occupé ». Gardez ce lien confidentiel.</li>
              </ul>
            </>
          ) : <Empty icon={CalendarDays}>Configurez d’abord le serveur de l’équipe</Empty>}
        </Card>
      </div>
      <Card title="Espace mobile de la Direction" hint={st && st.mobileUrl ? st.mobileUrl : 'Disponible une fois le serveur configuré'} right={<div className="row" style={{ gap: 6 }}>{st && st.mobileUrl && <button className="btn sm" onClick={() => copy(st.mobileUrl, 'Adresse copiée')}><Copy size={14} />Adresse</button>}<button className="btn primary sm" onClick={() => setEdit({})}><Plus size={14} />Accès</button></div>}>
        <p className="muted small" style={{ marginTop: 0 }}>Depuis son téléphone (navigateur), la personne assistée consulte son programme, l’agenda de la semaine, les tâches et le courrier en cours, et <b>valide les procès-verbaux</b> ou envoie ses remarques. Astuce : « Ajouter à l’écran d’accueil » pour l’ouvrir comme une application.</p>
        {(users || []).map((u) => (
          <div key={u.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setEdit(u)}>
            <div className="avatar" style={{ width: 34, height: 34 }}><Smartphone size={15} /></div>
            <div style={{ flex: 1 }}><b>{u.name}</b><div className="muted small">Identifiant : {u.login}</div></div>
            {u.active ? <Badge kind="good">Actif</Badge> : <Badge>Désactivé</Badge>}
          </div>
        ))}
        {users && !users.length && <Empty icon={Smartphone}>Aucun accès mobile</Empty>}
      </Card>
      {edit && <MobileUserModal data={edit} onClose={(changed) => { setEdit(null); if (changed) reloadUsers(); }} />}
    </div>
  );
}

function Updates() {
  const [u, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('update.state').then(setU).catch(() => {}); return on('update:state', setU); }, []);
  const check = async () => { setBusy(true); const r = await act(() => call('update.check')); setBusy(false); if (r) setU(r); };
  const install = async () => {
    if (!(await confirmBox(`Installer OfficiaTech ${u.version} maintenant ? L’application se ferme, s’installe en quelques secondes puis redémarre toute seule. Vos données sont conservées (une sauvegarde est faite avant).`, { okLabel: 'Redémarrer et mettre à jour' }))) return;
    await act(() => call('update.install'));
  };
  const setAuto = async (v) => { await act(() => call('update.setAuto', v), v ? 'Mises à jour automatiques activées' : 'Mises à jour automatiques désactivées'); setU(await call('update.state')); };
  const st = u ? u.status : 'idle';
  const line = !u ? 'Chargement…'
    : st === 'checking' ? 'Recherche d’une nouvelle version…'
      : st === 'downloading' ? `Téléchargement de la version ${u.version} : ${u.progress ?? 0} %`
        : st === 'ready' ? `Version ${u.version} téléchargée : elle s’installera automatiquement à la fermeture d’OfficiaTech.`
          : st === 'available' ? `Nouvelle version disponible : ${u.version}`
            : st === 'installing' ? 'Installation en cours…'
              : st === 'error' ? u.error
                : st === 'uptodate' ? `Vous utilisez la dernière version${u.checkedAt ? ` (vérifié ${ago(u.checkedAt)})` : ''}.`
                  : 'Vérification automatique au démarrage puis toutes les 4 heures.';
  return (
    <Card title="Mises à jour" hint="Publiées par le développeur sur GitHub, installées sans rien télécharger vous-même">
      <div className="row between wrap" style={{ gap: 12 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <b>Version installée : {u ? u.current : '…'}</b>
          <div className={`small ${st === 'error' ? 'neg-val' : st === 'ready' ? 'pos-val' : 'muted'}`}>{line}</div>
          {st === 'downloading' && <div style={{ height: 6, background: 'var(--panel-2)', borderRadius: 4, marginTop: 8, overflow: 'hidden' }}><div style={{ width: `${u.progress || 0}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' }} /></div>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy || st === 'checking' || st === 'downloading'} onClick={check}><RefreshCw size={16} className={busy || st === 'checking' ? 'spin' : ''} />Rechercher</button>
          {st === 'available' && <button className="btn primary" onClick={() => act(() => call('update.download'))}><DownloadCloud size={16} />Télécharger la {u.version}</button>}
          {st === 'ready' && <button className="btn primary" onClick={install}><DownloadCloud size={16} />Redémarrer et mettre à jour</button>}
        </div>
      </div>
      <label className="list-row mt" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={!u || u.auto !== false} onChange={(e) => setAuto(e.target.checked)} />
        <div><b>Mises à jour automatiques (recommandé)</b><div className="muted small">OfficiaTech cherche les nouvelles versions sur Internet, les télécharge en arrière-plan, vérifie leur intégrité et les installe en silence à la fermeture de l’application. Les données ne sont jamais touchées.</div></div>
      </label>
      {u && u.notes && ['available', 'downloading', 'ready'].includes(st) && <div className="card mt" style={{ boxShadow: 'none', whiteSpace: 'pre-wrap' }}>{u.notes}</div>}
    </Card>
  );
}

function About() {
  return (
    <Card title="À propos">
      <div className="row" style={{ gap: 14, marginBottom: 6 }}>
        <div className="brand-logo" style={{ width: 46, height: 46 }}><BellRing size={20} /></div>
        <div><b style={{ fontSize: 17 }}>{ABOUT.name}</b><div className="muted">Version {ABOUT.version} · Assistant administratif tout-en-un</div></div>
      </div>
      <div className="list-row"><span>Développé par</span><b className="right">{ABOUT.author}</b></div>
      <div className="list-row"><span>Fonction</span><span className="right">{ABOUT.role}</span></div>
      <div className="list-row"><span>Téléphone</span><span className="right" style={{ userSelect: 'text' }}>{ABOUT.phones.join(' / ')}</span></div>
      <div className="list-row"><span>E-mail</span><a className="right" style={{ color: 'var(--accent)' }} href={`mailto:${ABOUT.email}`}>{ABOUT.email}</a></div>
      <div className="list-row"><span>Copyright</span><span className="right muted">© {ABOUT.year} {ABOUT.author}</span></div>
      <div className="list-row"><span>Raccourcis</span><span className="right muted small">Ctrl+K rechercher · Ctrl+N nouveau · Ctrl+Maj+L verrouiller · Ctrl+L se déconnecter</span></div>
    </Card>
  );
}

export default function Settings() {
  const { nav } = useApp();
  const [tab, setTab] = useState(nav.tab || 'profile');
  useEffect(() => { if (nav.tab) setTab(nav.tab); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs value={tab} onChange={setTab} tabs={[['profile', 'Profil', UserRound], ['notif', 'Rappels', BellRing], ['mail', 'Messagerie', Mail], ['templates', 'Modèles', FileText], ['team', 'Équipe', Users2], ['security', 'Sécurité', ShieldCheck], ['backup', 'Sauvegarde', HardDrive], ['about', 'Mises à jour', DownloadCloud]]} />
      </div>
      {tab === 'profile' && <><Profile /><Letterhead /></>}
      {tab === 'team' && <Team />}
      {tab === 'about' && <><Updates /><About /></>}
      {tab === 'notif' && <Notifications />}
      {tab === 'mail' && <MailAccounts />}
      {tab === 'templates' && <Templates />}
      {tab === 'security' && <Security />}
      {tab === 'backup' && <Backup />}
    </div>
  );
}
