import { useEffect, useState } from 'react';
import { Building2, BedDouble, LayoutGrid, UserCog, Cloud, HardDrive, Plus, Save, RefreshCw, PlugZap, FolderOpen, Upload, Download, Copy } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, ROLES, OUTLETS, ROOM_STATUS } from '../lib/format';
import { Tabs, Card, Field, Input, Badge, StatusBadge, Empty, toast } from '../components/ui';
import { EditModal } from '../components/crud';

function General() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState(settings);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await act(() => call('settings.save', f), 'Paramètres enregistrés')) reloadSettings(); };
  return (
    <Card title="Établissement" hint="Ces informations apparaissent sur les factures et tickets" right={<button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>}>
      <div className="form" style={{ maxWidth: 900 }}>
        <Field label="Nom commercial"><Input value={f.hotel_name} onChange={set('hotel_name')} /></Field>
        <Field label="N° contribuable / RCCM"><Input value={f.tax_id} onChange={set('tax_id')} /></Field>
        <Field label="Adresse" full><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="E-mail"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Devise"><Input value={f.currency} onChange={set('currency')} placeholder="FCFA, €, MAD, GNF…" /></Field>
        <Field label="TVA incluse dans les prix (%)"><Input type="number" value={f.vat_rate} onChange={set('vat_rate')} /></Field>
        <Field label="Taxe de séjour par personne et par nuit"><Input type="number" value={f.city_tax} onChange={set('city_tax')} /></Field>
        <Field label="Heure de libération des chambres"><Input type="time" value={f.checkout_hour} onChange={set('checkout_hour')} /></Field>
        <Field label="Message de bas de facture / ticket" full><Input value={f.invoice_footer} onChange={set('invoice_footer')} /></Field>
      </div>
    </Card>
  );
}

function Rooms() {
  const [types, reloadTypes] = useData('db.list', ['room_types', {}, 'name']);
  const [rooms, reloadRooms] = useData('hotel.rooms');
  const [editType, setEditType] = useState(null);
  const [editRoom, setEditRoom] = useState(null);
  if (!types || !rooms) return null;
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
      <Card title="Types de chambre" right={<button className="btn sm primary" onClick={() => setEditType({ capacity: 2 })}><Plus size={14} />Type</button>}>
        {types.map((t) => (
          <div key={t.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => setEditType(t)}>
            <i className="dot" style={{ background: t.color || 'var(--accent)' }} /><div style={{ flex: 1 }}><b>{t.name}</b><div className="muted small">{t.capacity} pers. · {rooms.filter((r) => r.type_id === t.id).length} chambre(s)</div></div><b className="num">{money(t.base_price)}</b>
          </div>
        ))}
        {!types.length && <Empty>Créez d’abord un type (Standard, Suite…)</Empty>}
      </Card>
      <Card title="Chambres" hint={`${rooms.length} chambre(s)`} right={<button className="btn sm primary" disabled={!types.length} onClick={() => setEditRoom({ status: 'libre', type_id: types[0] && types[0].id })}><Plus size={14} />Chambre</button>}>
        <table className="tbl">
          <thead><tr><th>N°</th><th>Type</th><th>Étage</th><th className="r">Tarif</th><th>Statut</th><th>Notes</th></tr></thead>
          <tbody>{rooms.map((r) => (
            <tr key={r.id} className="click" onClick={() => setEditRoom(r)}><td className="strong">{r.number}</td><td>{r.type_name}</td><td>{r.floor}</td><td className="r num">{money(r.rate)}{r.price ? <Badge kind="info">spécifique</Badge> : null}</td><td><StatusBadge map={ROOM_STATUS} value={r.status} /></td><td className="muted">{r.notes}</td></tr>
          ))}</tbody>
        </table>
      </Card>
      {editType && <EditModal table="room_types" title="Type de chambre" initial={editType} onClose={() => setEditType(null)} onSaved={() => { reloadTypes(); reloadRooms(); }}
        fields={[{ k: 'name', label: 'Nom', required: true }, { k: 'base_price', label: 'Tarif par nuit', type: 'number', required: true }, { k: 'capacity', label: 'Capacité (personnes)', type: 'number' }, { k: 'color', label: 'Couleur', type: 'color' }, { k: 'description', label: 'Description / équipements', type: 'textarea' }]} />}
      {editRoom && <EditModal table="rooms" title="Chambre" initial={editRoom} onClose={() => setEditRoom(null)} onSaved={reloadRooms}
        fields={[{ k: 'number', label: 'Numéro', required: true }, { k: 'type_id', label: 'Type', type: 'select', options: types.map((t) => [t.id, t.name]), required: true }, { k: 'floor', label: 'Étage' },
          { k: 'price', label: 'Tarif spécifique (vide = tarif du type)', type: 'number' }, { k: 'status', label: 'Statut', type: 'select', options: Object.entries(ROOM_STATUS).map(([k, [l]]) => [k, l]), placeholder: undefined }, { k: 'notes', label: 'Notes', type: 'textarea' }]} />}
    </div>
  );
}

function Tables() {
  const [rows, reload] = useData('db.list', ['dining_tables', {}, 'sort']);
  const [edit, setEdit] = useState(null);
  if (!rows) return null;
  return (
    <Card title="Tables et emplacements" hint="Organisez la salle du restaurant et le bar par zones" right={<button className="btn sm primary" onClick={() => setEdit({ outlet: 'restaurant', seats: 4, zone: 'Salle', sort: rows.length + 1 })}><Plus size={14} />Table</button>}>
      <div className="grid g2">
        {['restaurant', 'bar'].map((o) => (
          <div key={o}>
            <div className="nav-label">{OUTLETS[o]}</div>
            <div className="tables">
              {rows.filter((t) => t.outlet === o).map((t) => (
                <div key={t.id} className="dtable" style={{ minHeight: 80 }} onClick={() => setEdit(t)}><span className="tname">{t.name}</span><span className="muted small">{t.zone} · {t.seats} places</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {edit && <EditModal table="dining_tables" title="Table" initial={edit} onClose={() => setEdit(null)} onSaved={reload}
        fields={[{ k: 'name', label: 'Nom', required: true }, { k: 'outlet', label: 'Point de vente', type: 'select', options: [['restaurant', 'Restaurant'], ['bar', 'Bar']], placeholder: undefined }, { k: 'zone', label: 'Zone (Salle, Terrasse, VIP…)' }, { k: 'seats', label: 'Places', type: 'number' }, { k: 'sort', label: 'Ordre', type: 'number' }]} />}
    </Card>
  );
}

function UsersTab() {
  const [rows, reload] = useData('users.list');
  const [edit, setEdit] = useState(null);
  if (!rows) return null;
  return (
    <Card title="Utilisateurs" hint="Chaque employé se connecte avec son propre code PIN ; ses droits dépendent de son rôle." right={<button className="btn sm primary" onClick={() => setEdit({ role: 'serveur', active: 1 })}><Plus size={14} />Utilisateur</button>}>
      <table className="tbl">
        <thead><tr><th>Nom</th><th>Rôle</th><th>Téléphone</th><th>Accès</th><th>État</th></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.id} className="click" onClick={() => setEdit(u)}><td className="strong">{u.name}</td><td><Badge kind="info">{ROLES[u.role]}</Badge></td><td>{u.phone}</td>
            <td className="muted small">{u.rights.includes('*') ? 'Tout' : u.rights.join(', ')}</td><td>{u.active ? <Badge kind="good">Actif</Badge> : <Badge>Désactivé</Badge>}</td></tr>
        ))}</tbody>
      </table>
      {edit && <EditModal channel="users.save" table="users" deletable={false} title={edit.id ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'} initial={edit} onClose={() => setEdit(null)} onSaved={reload}
        fields={[{ k: 'name', label: 'Nom', required: true }, { k: 'role', label: 'Rôle', type: 'select', options: Object.entries(ROLES), placeholder: undefined }, { k: 'phone', label: 'Téléphone' },
          { k: 'pin', label: edit.id ? 'Nouveau PIN (laisser vide pour garder)' : 'Code PIN (4 à 8 chiffres)', type: 'password' }, { k: 'active', label: 'Compte actif', type: 'check' }]} />}
    </Card>
  );
}

function Sync() {
  const { settings, reloadSettings } = useApp();
  const [f, setF] = useState({ sync_url: settings.sync_url, sync_token: settings.sync_token, sync_interval: settings.sync_interval, device_name: settings.device_name });
  const [status, setStatus] = useState(null);
  const [remote, setRemote] = useState(null);
  const [info, setInfo] = useState(null);
  useEffect(() => { call('sync.status').then(setStatus); call('app.info').then(setInfo); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await act(() => call('settings.save', f), 'Configuration enregistrée')) { reloadSettings(); setTimeout(() => call('sync.status').then(setStatus), 1500); } };
  const test = async () => {
    await call('settings.save', f);
    const r = await act(() => call('settings.syncTest'));
    if (r) { setRemote(r); toast('Connexion au serveur réussie', 'success'); }
  };
  const now = async () => setStatus(await act(() => call('settings.syncNow')) || status);
  return (
    <div className="grid g2">
      <Card title="Serveur de synchronisation (VPS)" hint="Laissez vide pour travailler uniquement en local">
        <div className="form">
          <Field label="Adresse du serveur" full><Input value={f.sync_url} onChange={set('sync_url')} placeholder="https://sync.mon-hotel.com" /></Field>
          <Field label="Jeton secret (SYNC_TOKEN)" full><Input type="password" value={f.sync_token} onChange={set('sync_token')} /></Field>
          <Field label="Nom de ce poste"><Input value={f.device_name} onChange={set('device_name')} placeholder="Réception, Bar, Caisse resto…" /></Field>
          <Field label="Fréquence (secondes)"><Input type="number" value={f.sync_interval} onChange={set('sync_interval')} /></Field>
        </div>
        <div className="row mt">
          <button className="btn primary" onClick={save}><Save size={16} />Enregistrer</button>
          <button className="btn" onClick={test}><PlugZap size={16} />Tester</button>
          <button className="btn" onClick={now}><RefreshCw size={16} />Synchroniser maintenant</button>
        </div>
      </Card>
      <Card title="État">
        {status && (
          <>
            <div className="list-row"><span>Statut</span><span className="right">{status.status === 'ok' ? <Badge kind="good">Connecté</Badge> : status.status === 'error' ? <Badge kind="warn">Hors ligne</Badge> : status.status === 'off' ? <Badge>Local uniquement</Badge> : <Badge kind="info">En cours</Badge>}</span></div>
            <div className="list-row"><span>Dernière synchronisation</span><b className="right">{status.lastSync ? new Date(status.lastSync).toLocaleString('fr-FR') : 'jamais'}</b></div>
            <div className="list-row"><span>Modifications en attente d’envoi</span><b className="right">{status.pending}</b></div>
            {status.lastError && <div className="list-row"><span>Dernière erreur</span><span className="right neg-val small">{status.lastError}</span></div>}
          </>
        )}
        {info && <div className="list-row"><span>Identifiant du poste</span><code className="right small muted">{info.deviceId}</code></div>}
        {remote && (
          <div className="mt">
            <div className="nav-label" style={{ padding: '6px 0' }}>Postes connus du serveur</div>
            {remote.devices.map((d) => <div key={d.id} className="list-row small"><b>{d.name || d.id.slice(0, 8)}</b><span className="right muted">{new Date(d.last_seen).toLocaleString('fr-FR')}</span></div>)}
          </div>
        )}
        <p className="muted small mt">Chaque poste garde une copie complète des données et continue de fonctionner sans Internet. Les modifications sont envoyées au serveur dès que la connexion revient ; en cas de modification simultanée, la plus récente l’emporte. Le stock est calculé à partir des mouvements, il ne peut donc pas être écrasé.</p>
      </Card>
    </div>
  );
}

function Backup() {
  const [info, setInfo] = useState(null);
  useEffect(() => { call('app.info').then(setInfo); }, []);
  return (
    <div className="grid g2">
      <Card title="Sauvegardes" hint="Une sauvegarde automatique est faite chaque jour (30 jours conservés).">
        <div className="col">
          <button className="btn" onClick={async () => { const p = await act(() => call('settings.backup')); if (p) toast(`Sauvegarde créée : ${p}`, 'success'); }}><Download size={16} />Créer une sauvegarde…</button>
          <button className="btn danger" onClick={() => act(() => call('settings.restore'))}><Upload size={16} />Restaurer une sauvegarde…</button>
          <button className="btn" onClick={() => call('settings.openData')}><FolderOpen size={16} />Ouvrir le dossier des données</button>
        </div>
      </Card>
      <Card title="À propos">
        {info && <>
          <div className="list-row"><span>Version</span><b className="right">Hospitalis {info.version}</b></div>
          <div className="list-row"><span>Dossier des données</span><code className="right small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.dataDir}</code>
            <button className="btn ghost sm icon" onClick={() => { navigator.clipboard.writeText(info.dataDir); toast('Copié'); }}><Copy size={14} /></button></div>
        </>}
      </Card>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[['general', 'Établissement', Building2], ['rooms', 'Chambres', BedDouble], ['tables', 'Tables', LayoutGrid], ['users', 'Utilisateurs', UserCog], ['sync', 'Synchronisation', Cloud], ['backup', 'Sauvegarde', HardDrive]]} />
      </div>
      {tab === 'general' && <General />}
      {tab === 'rooms' && <Rooms />}
      {tab === 'tables' && <Tables />}
      {tab === 'users' && <UsersTab />}
      {tab === 'sync' && <Sync />}
      {tab === 'backup' && <Backup />}
    </div>
  );
}
