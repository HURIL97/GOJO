import { useEffect, useState } from 'react';
import { CalendarPlus, FileText, LogIn, LogOut, Printer, Plus, Trash2, Wallet, FileDown, Ban, UserX } from 'lucide-react';
import { call } from '../lib/api';
import { act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, fmtDate, daysBetween, addDays, localDay, METHODS, RES_STATUS, guestName, num } from '../lib/format';
import { Modal, Field, Input, Select, StatusBadge, confirmBox, toast, Badge } from '../components/ui';
import { invoiceHtml, printHtml } from '../lib/print';

const SOURCES = ['Direct', 'Téléphone', 'Walk-in', 'Booking.com', 'Expedia', 'Airbnb', 'Agence', 'Entreprise'];

export function ReservationModal({ initial = {}, onClose, onSaved }) {
  const t = localDay();
  const [f, setF] = useState({ check_in: t, check_out: addDays(t, 1), adults: 1, children: 0, source: 'Direct', ...initial });
  const [guestMode, setGuestMode] = useState(initial.guest_id ? 'existing' : 'new');
  const [guest, setGuest] = useState({ last_name: '', first_name: '', phone: '', email: '', id_doc: '', nationality: '' });
  const [guests, setGuests] = useState([]);
  const [rooms, setRooms] = useState([]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { call('guests.list', '').then(setGuests).catch(() => {}); }, []);
  useEffect(() => {
    if (f.check_in && f.check_out && f.check_out > f.check_in) call('hotel.available', f.check_in, f.check_out, f.id).then(setRooms).catch(() => {});
  }, [f.check_in, f.check_out, f.id]);

  const room = rooms.find((r) => r.id === f.room_id);
  useEffect(() => { if (room && !f.id && !f.rateTouched) setF((x) => ({ ...x, rate: room.rate })); }, [room, f.id, f.rateTouched]);
  const nights = f.check_out > f.check_in ? daysBetween(f.check_in, f.check_out) : 0;

  const save = async () => {
    const payload = { ...f };
    delete payload.rateTouched;
    if (guestMode === 'new') { delete payload.guest_id; payload.guest = guest; }
    const r = await act(() => call('hotel.saveReservation', payload), f.id ? 'Réservation modifiée' : 'Réservation créée');
    if (r) { onSaved && onSaved(r); onClose(); }
  };

  return (
    <Modal title={f.id ? `Réservation ${f.code}` : 'Nouvelle réservation'} icon={<CalendarPlus size={20} color="var(--accent)" />} onClose={onClose} size="wide"
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="grid g2" style={{ gap: 22 }}>
        <div className="form">
          <Field label="Arrivée"><Input type="date" value={f.check_in} onChange={set('check_in')} /></Field>
          <Field label="Départ"><Input type="date" value={f.check_out} onChange={set('check_out')} /></Field>
          <Field label="Chambre disponible" full>
            <Select value={f.room_id} onChange={set('room_id')} placeholder="— Choisir —"
              options={rooms.map((r) => [r.id, `${r.number} · ${r.type_name || ''} · ${money(r.rate)}/nuit · ${r.capacity || 2} pers.`])} />
          </Field>
          <Field label="Adultes"><Input type="number" min="1" value={f.adults} onChange={set('adults')} /></Field>
          <Field label="Enfants"><Input type="number" min="0" value={f.children} onChange={set('children')} /></Field>
          <Field label="Tarif par nuit"><Input type="number" value={f.rate} onChange={(v) => setF((x) => ({ ...x, rate: v, rateTouched: true }))} /></Field>
          <Field label="Provenance"><Select value={f.source} onChange={set('source')} options={SOURCES} /></Field>
          <Field label="Notes" full><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} placeholder="Demandes particulières, heure d’arrivée…" /></Field>
          <div className="full card" style={{ boxShadow: 'none', background: 'var(--panel-2)' }}>
            <div className="row between"><span className="muted">{nights} nuit{nights > 1 ? 's' : ''} × {money(f.rate)}</span><b style={{ fontSize: 20 }}>{money(nights * (Number(f.rate) || 0))}</b></div>
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="row between">
            <b>Client</b>
            {!f.id && (
              <div className="tabs">
                <button className={`tab ${guestMode === 'new' ? 'active' : ''}`} onClick={() => setGuestMode('new')}>Nouveau</button>
                <button className={`tab ${guestMode === 'existing' ? 'active' : ''}`} onClick={() => setGuestMode('existing')}>Existant</button>
              </div>
            )}
          </div>
          {guestMode === 'existing' ? (
            <Field label="Client enregistré">
              <Select value={f.guest_id} onChange={set('guest_id')} placeholder="— Choisir —" options={guests.map((g) => [g.id, `${guestName(g)}${g.phone ? ` · ${g.phone}` : ''}`])} />
            </Field>
          ) : (
            <div className="form">
              <Field label="Nom"><Input value={guest.last_name} onChange={(v) => setGuest((g) => ({ ...g, last_name: v }))} /></Field>
              <Field label="Prénom"><Input value={guest.first_name} onChange={(v) => setGuest((g) => ({ ...g, first_name: v }))} /></Field>
              <Field label="Téléphone"><Input value={guest.phone} onChange={(v) => setGuest((g) => ({ ...g, phone: v }))} /></Field>
              <Field label="E-mail"><Input value={guest.email} onChange={(v) => setGuest((g) => ({ ...g, email: v }))} /></Field>
              <Field label="Pièce d’identité"><Input value={guest.id_doc} onChange={(v) => setGuest((g) => ({ ...g, id_doc: v }))} placeholder="CNI / Passeport n°" /></Field>
              <Field label="Nationalité"><Input value={guest.nationality} onChange={(v) => setGuest((g) => ({ ...g, nationality: v }))} /></Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function FolioModal({ id, onClose, onEdit }) {
  const { settings } = useApp();
  const [f, setF] = useState(null);
  const [item, setItem] = useState({ label: '', qty: 1, unit_price: '', kind: 'service' });
  const [pay, setPay] = useState({ amount: '', method: 'especes', reference: '' });
  const load = () => call('hotel.folio', id).then((x) => { setF(x); setPay((p) => ({ ...p, amount: x.balance > 0 ? x.balance : '' })); }).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const r = f.reservation;

  const addItem = async () => {
    if (!item.label || !item.unit_price) return toast('Libellé et prix requis', 'error');
    if (await act(() => call('hotel.addFolioItem', { ...item, reservation_id: id }), 'Prestation ajoutée')) { setItem({ label: '', qty: 1, unit_price: '', kind: 'service' }); load(); }
  };
  const doPay = async () => {
    if (await act(() => call('hotel.pay', { ...pay, reservation_id: id }), 'Paiement enregistré')) { setPay({ amount: '', method: 'especes', reference: '' }); load(); }
  };
  const checkIn = async () => { if (await act(() => call('hotel.checkIn', id), 'Client enregistré — bon séjour !')) load(); };
  const checkOut = async () => {
    let force = false;
    if (f.balance > 0) {
      force = await confirmBox(`Il reste ${money(f.balance)} à payer. Clôturer quand même le séjour (impayé) ?`, { danger: true, okLabel: 'Clôturer avec solde' });
      if (!force) return;
    }
    const res = await act(() => call('hotel.checkOut', id, { force }), 'Départ enregistré, chambre à nettoyer');
    if (res) { setF(res); if (await confirmBox('Imprimer la facture ?', { okLabel: 'Imprimer' })) printHtml(invoiceHtml(res, settings)); }
  };
  const setStatus = async (st, label) => {
    if (!(await confirmBox(`${label} cette réservation ?`, { danger: true }))) return;
    if (await act(() => call('hotel.setStatus', id, st), 'Statut mis à jour')) load();
  };
  const removeItem = async (it) => {
    if (!(await confirmBox(`Supprimer « ${it.label} » ?`, { danger: true }))) return;
    if (await act(() => call('hotel.removeFolioItem', it.id))) load();
  };

  return (
    <Modal size="xl" title={`Séjour ${r.code}`} icon={<FileText size={20} color="var(--accent)" />} onClose={onClose}
      footer={<>
        {r.status === 'confirmee' && <><button className="btn danger" onClick={() => setStatus('annulee', 'Annuler')}><Ban size={16} />Annuler</button>
          <button className="btn" onClick={() => setStatus('no_show', 'Marquer en no-show')}><UserX size={16} />No-show</button></>}
        <div style={{ flex: 1 }} />
        {['confirmee', 'en_cours'].includes(r.status) && <button className="btn" onClick={() => { onClose(); onEdit(r); }}>Modifier</button>}
        <button className="btn" onClick={() => printHtml(invoiceHtml(f, settings), { pdf: true, title: `Facture-${r.code}` })}><FileDown size={16} />PDF</button>
        <button className="btn" onClick={() => printHtml(invoiceHtml(f, settings))}><Printer size={16} />Imprimer</button>
        {r.status === 'confirmee' && <button className="btn good" onClick={checkIn}><LogIn size={16} />Check-in</button>}
        {r.status === 'en_cours' && <button className="btn primary" onClick={checkOut}><LogOut size={16} />Check-out</button>}
      </>}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 18 }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="row between"><b style={{ fontSize: 18 }}>{guestName(f.guest || {})}</b><StatusBadge map={RES_STATUS} value={r.status} /></div>
            <div className="muted small" style={{ marginTop: 4 }}>{f.guest?.phone} {f.guest?.email}</div>
            {f.guest?.vip ? <Badge kind="warn">VIP</Badge> : null}
            <div className="list-row mt"><span className="muted">Chambre</span><b className="right">{f.room?.number} · {f.room?.type_name}</b></div>
            <div className="list-row"><span className="muted">Arrivée</span><b className="right">{fmtDate(r.check_in)}</b></div>
            <div className="list-row"><span className="muted">Départ</span><b className="right">{fmtDate(r.check_out)}</b></div>
            <div className="list-row"><span className="muted">Nuits</span><b className="right">{f.nights}</b></div>
            <div className="list-row"><span className="muted">Occupants</span><b className="right">{r.adults} ad. {r.children ? `+ ${r.children} enf.` : ''}</b></div>
            <div className="list-row"><span className="muted">Provenance</span><b className="right">{r.source || '—'}</b></div>
            {r.notes && <div className="muted small mt">{r.notes}</div>}
          </div>
          <div className="card hero" style={{ boxShadow: 'none' }}>
            <div className="list-row"><span className="muted">Total séjour</span><b className="right num">{money(f.total)}</b></div>
            <div className="list-row"><span className="muted">Déjà réglé</span><b className="right num pos-val">{money(f.paid)}</b></div>
            <div className="row between mt"><b>Solde</b><b className={`num ${f.balance > 0 ? 'neg-val' : 'pos-val'}`} style={{ fontSize: 24 }}>{money(f.balance)}</b></div>
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="table-wrap" style={{ border: '1px solid var(--border-soft)' }}>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Prestation</th><th className="r">Qté</th><th className="r">P.U.</th><th className="r">Montant</th><th /></tr></thead>
              <tbody>
                {f.lines.map((l, i) => (
                  <tr key={l.id || i}>
                    <td className="muted">{fmtDate(l.date)}</td><td>{l.label}</td><td className="r num">{num(l.qty, true)}</td>
                    <td className="r num">{money(l.unit_price)}</td><td className="r num strong">{money(l.amount)}</td>
                    <td className="r">{l.id && !l.order_id && r.status === 'en_cours' && <button className="btn ghost sm icon" onClick={() => removeItem(l)}><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}
                {f.payments.map((p) => (
                  <tr key={p.id}><td className="muted">{fmtDate(p.date)}</td><td className="pos-val">Règlement — {METHODS[p.method] || p.method}{p.reference ? ` (${p.reference})` : ''}</td><td /><td /><td className="r num pos-val">- {money(p.amount)}</td><td /></tr>
                ))}
              </tbody>
            </table>
          </div>
          {['en_cours', 'confirmee'].includes(r.status) && (
            <div className="grid g2">
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="card-head"><h3>Ajouter une prestation</h3></div>
                <div className="form">
                  <Field label="Libellé" full><Input value={item.label} onChange={(v) => setItem((x) => ({ ...x, label: v }))} placeholder="Blanchisserie, transfert aéroport…" /></Field>
                  <Field label="Quantité"><Input type="number" value={item.qty} onChange={(v) => setItem((x) => ({ ...x, qty: v }))} /></Field>
                  <Field label="Prix unitaire"><Input type="number" value={item.unit_price} onChange={(v) => setItem((x) => ({ ...x, unit_price: v }))} /></Field>
                </div>
                <button className="btn mt" onClick={addItem}><Plus size={16} />Ajouter</button>
              </div>
              <div className="card" style={{ boxShadow: 'none' }}>
                <div className="card-head"><h3>Encaisser</h3></div>
                <div className="form">
                  <Field label="Montant"><Input type="number" value={pay.amount} onChange={(v) => setPay((x) => ({ ...x, amount: v }))} /></Field>
                  <Field label="Mode"><Select value={pay.method} onChange={(v) => setPay((x) => ({ ...x, method: v }))} options={Object.entries(METHODS).filter(([k]) => k !== 'chambre')} /></Field>
                  <Field label="Référence (n° transaction…)" full><Input value={pay.reference} onChange={(v) => setPay((x) => ({ ...x, reference: v }))} /></Field>
                </div>
                <button className="btn good mt" onClick={doPay}><Wallet size={16} />Enregistrer le paiement</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
