import { useState } from 'react';
import { Users, Plus, Crown, Download } from 'lucide-react';
import { call } from '../lib/api';
import { useData } from '../lib/hooks';
import { money, fmtDate, RES_STATUS, guestName } from '../lib/format';
import { Card, SearchBox, Empty, Badge, Modal, StatusBadge } from '../components/ui';
import { EditModal } from '../components/crud';

const FIELDS = [
  { k: 'last_name', label: 'Nom', required: true }, { k: 'first_name', label: 'Prénom' },
  { k: 'phone', label: 'Téléphone' }, { k: 'email', label: 'E-mail' },
  { k: 'id_doc', label: 'Pièce d’identité' }, { k: 'nationality', label: 'Nationalité' },
  { k: 'company', label: 'Société' }, { k: 'vip', label: 'Client VIP', type: 'check' },
  { k: 'address', label: 'Adresse', full: true }, { k: 'notes', label: 'Préférences / notes', type: 'textarea' },
];

function GuestHistory({ guest, onClose, onEdit }) {
  const [rows] = useData('guests.history', [guest.id], [guest.id]);
  return (
    <Modal size="wide" title={guestName(guest)} icon={guest.vip ? <Crown size={20} color="var(--warn)" /> : <Users size={20} />} onClose={onClose}
      footer={<button className="btn" onClick={onEdit}>Modifier la fiche</button>}>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card" style={{ boxShadow: 'none' }}><div className="muted small">Séjours</div><b style={{ fontSize: 22 }}>{guest.stays}</b></div>
        <div className="card" style={{ boxShadow: 'none' }}><div className="muted small">Total réglé</div><b style={{ fontSize: 22 }}>{money(guest.spent)}</b></div>
        <div className="card" style={{ boxShadow: 'none' }}><div className="muted small">Dernier séjour</div><b style={{ fontSize: 22 }}>{fmtDate(guest.last_stay)}</b></div>
      </div>
      <div className="muted small" style={{ marginBottom: 10 }}>{[guest.phone, guest.email, guest.nationality, guest.id_doc].filter(Boolean).join(' · ')}</div>
      {guest.notes && <div className="card" style={{ boxShadow: 'none', marginBottom: 12 }}>{guest.notes}</div>}
      <table className="tbl">
        <thead><tr><th>Code</th><th>Chambre</th><th>Arrivée</th><th>Départ</th><th className="r">Tarif</th><th>Statut</th></tr></thead>
        <tbody>{(rows || []).map((r) => <tr key={r.id}><td>{r.code}</td><td>{r.room_number}</td><td>{fmtDate(r.check_in)}</td><td>{fmtDate(r.check_out)}</td><td className="r">{money(r.rate)}</td><td><StatusBadge map={RES_STATUS} value={r.status} /></td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

export default function Guests() {
  const [q, setQ] = useState('');
  const [rows, reload] = useData('guests.list', [q], [q]);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  return (
    <Card>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Nom, téléphone, e-mail, société…" width={340} />
        <span className="muted small">{rows ? rows.length : 0} client(s)</span>
        <div className="grow" />
        <button className="btn" onClick={() => call('export.csv', 'clients', (rows || []).map((g) => ({ Nom: g.last_name, Prenom: g.first_name, Telephone: g.phone, Email: g.email, Nationalite: g.nationality, Societe: g.company, Sejours: g.stays, Total: g.spent })))}><Download size={16} />Excel</button>
        <button className="btn primary" onClick={() => setEdit({})}><Plus size={16} />Nouveau client</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        <table className="tbl">
          <thead><tr><th>Client</th><th>Téléphone</th><th>E-mail</th><th>Nationalité</th><th className="r">Séjours</th><th>Dernier séjour</th><th className="r">Total réglé</th></tr></thead>
          <tbody>
            {(rows || []).map((g) => (
              <tr key={g.id} className="click" onClick={() => setView(g)}>
                <td className="strong">{g.vip ? <Crown size={13} color="var(--warn)" /> : null} {guestName(g)} {g.company && <span className="muted small">· {g.company}</span>}</td>
                <td>{g.phone}</td><td className="muted">{g.email}</td><td>{g.nationality}</td>
                <td className="r">{g.stays > 0 ? <Badge kind={g.stays >= 3 ? 'good' : ''}>{g.stays}</Badge> : '0'}</td>
                <td>{fmtDate(g.last_stay)}</td><td className="r num strong">{money(g.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty icon={Users}>Aucun client</Empty>}
      </div>
      {view && <GuestHistory guest={view} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null); }} />}
      {edit && <EditModal table="guests" title={edit.id ? 'Fiche client' : 'Nouveau client'} fields={FIELDS} initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </Card>
  );
}
