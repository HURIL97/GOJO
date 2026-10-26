import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, MessageSquareText, CalendarPlus, AlertTriangle, ListChecks, BellRing, Phone, FileText, UserRound, StickyNote, Trash2, Send, Video, Paperclip, X } from 'lucide-react';
import { call } from '../lib/api';
import { act } from '../lib/hooks';
import { useApp } from '../lib/context';
import {
  TYPES, EV_STATUS, REMINDER_OPTIONS, REPEAT, PRIORITY, TASK_STATUS, COURRIER_STATUS, COURRIER_MODE, CALL_STATUS,
  addMinutes, localDay, stamp, contactName, fmtTime,
} from '../lib/format';
import { Modal, Field, Input, Select, confirmBox, toast } from './ui';
import { ComposeModal, confirmationDraft } from './compose';
import { openPhone, waUrl, smsUrl, rdvMessage } from '../lib/phone';

const nextSlot = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return stamp(d).slice(0, 16);
};
const dt = (s) => (s ? s.slice(0, 16) : '');
const full = (s) => (s && s.length === 16 ? `${s}:00` : s);

function DeleteBtn({ table, id, onDone, label = 'Supprimer' }) {
  if (!id) return null;
  return <button className="btn danger" onClick={async () => { if (await confirmBox('Supprimer définitivement cet élément ?', { danger: true, okLabel: 'Supprimer' })) { if (await act(() => call('db.remove', table, id), 'Supprimé')) onDone(); } }}><Trash2 size={16} />{label}</button>;
}

function ContactPicker({ value, onChange, contacts, placeholder = '— Aucun —' }) {
  return <Select value={value} onChange={onChange} placeholder={placeholder} options={contacts.map((c) => [c.id, `${contactName(c)}${c.company ? ` · ${c.company}` : ''}`])} />;
}

export function EventModal({ data = {}, onClose }) {
  const { settings } = useApp();
  const start0 = data.start ? dt(data.start) : nextSlot();
  const [f, setF] = useState({
    type: 'rdv', status: 'planifie', recurrence: 'none', reminder_min: Number(settings.default_reminder || 15), all_day: 0, participants: [],
    ...data, start: start0, end: data.end ? dt(data.end) : dt(addMinutes(full(start0), 60)),
  });
  const [contacts, setContacts] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [compose, setCompose] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  useEffect(() => {
    if (f.all_day || !f.start || !f.end) return setConflicts([]);
    const t = setTimeout(() => call('agenda.conflicts', full(f.start), full(f.end), f.id).then(setConflicts).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [f.start, f.end, f.id, f.all_day]);
  const changeStart = (v) => setF((x) => {
    const dur = x.start && x.end ? (new Date(x.end) - new Date(x.start)) / 60000 : 60;
    return { ...x, start: v, end: v ? dt(addMinutes(full(v), Math.max(15, dur))) : x.end };
  });
  const parts = Array.isArray(f.participants) ? f.participants : [];
  const remind = async (via) => {
    const row = { ...f, start: f.all_day ? `${f.start.slice(0, 10)}T00:00:00` : full(f.start), end: f.all_day ? `${f.end.slice(0, 10)}T23:59:00` : full(f.end), reminder_min: Number(f.reminder_min) };
    const r = await act(() => call('agenda.save', row));
    if (!r) return;
    const c = contacts.find((x) => x.id === r.contact_id);
    const text = rdvMessage(r, c ? contactName(c) : '', settings);
    const num = c.mobile || c.phone;
    try {
      if (via === 'sms') { try { await navigator.clipboard.writeText(text); } catch { /* ignoré */ } }
      await openPhone(via === 'wa' ? waUrl(num, settings.phone_country, text) : smsUrl(num, settings.phone_country, text));
      toast(via === 'wa' ? 'WhatsApp ouvert avec la confirmation prête à envoyer' : 'SMS préparé (texte aussi copié : Ctrl+V si besoin)', 'success');
      onClose(r);
    } catch (e) { toast(e.message, 'error'); }
  };
  const save = async (thenConfirm) => {
    const row = { ...f, start: f.all_day ? `${f.start.slice(0, 10)}T00:00:00` : full(f.start), end: f.all_day ? `${f.end.slice(0, 10)}T23:59:00` : full(f.end), reminder_min: Number(f.reminder_min) };
    const r = await act(() => call('agenda.save', row), f.id ? 'Évènement modifié' : 'Ajouté à l’agenda');
    if (!r) return;
    if (thenConfirm) setCompose(confirmationDraft(r, contacts.find((c) => c.id === r.contact_id)));
    else onClose(r);
  };
  const contact = contacts.find((c) => c.id === f.contact_id);
  if (compose) return <ComposeModal data={compose} onClose={() => onClose()} />;

  return (
    <Modal size="wide" title={f.id ? 'Modifier l’évènement' : 'Nouvel évènement'} icon={<CalendarPlus size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<>
        <DeleteBtn table="events" id={f.id} onDone={() => onClose()} />
        <div style={{ flex: 1 }} />
        {f.type === 'rdv' && contact && contact.email && <button className="btn" onClick={() => save(true)}><Send size={15} />Confirmer par e-mail</button>}
        {f.type === 'rdv' && contact && (contact.mobile || contact.phone) && <>
          <button className="btn" title="Enregistrer et envoyer la confirmation par WhatsApp" onClick={() => remind('wa')}><MessageCircle size={15} color="#25d366" />WhatsApp</button>
          <button className="btn" title="Enregistrer et envoyer la confirmation par SMS" onClick={() => remind('sms')}><MessageSquareText size={15} />SMS</button>
        </>}
        <button className="btn" onClick={() => onClose()}>Annuler</button>
        <button className="btn primary" onClick={() => save(false)}>Enregistrer</button>
      </>}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
        {Object.entries(TYPES).map(([k, l]) => (
          <button key={k} className={`chip tc-${k} ${f.type === k ? 'allday' : ''}`} style={{ fontSize: 12.5, padding: '6px 12px', border: 0 }} onClick={() => set('type')(k)}>{l}</button>
        ))}
      </div>
      <div className="form">
        <Field label="Titre" full><Input autoFocus value={f.title} onChange={set('title')} placeholder={f.type === 'reunion' ? 'Comité de direction…' : 'Rendez-vous avec…'} /></Field>
        <Field label={f.all_day ? 'Du' : 'Début'}><input className="input" type={f.all_day ? 'date' : 'datetime-local'} value={f.all_day ? f.start.slice(0, 10) : f.start} onChange={(e) => changeStart(f.all_day ? `${e.target.value}T00:00` : e.target.value)} /></Field>
        <Field label={f.all_day ? 'Au' : 'Fin'}><input className="input" type={f.all_day ? 'date' : 'datetime-local'} value={f.all_day ? f.end.slice(0, 10) : f.end} onChange={(e) => set('end')(f.all_day ? `${e.target.value}T23:59` : e.target.value)} /></Field>
        <label className="check full"><input type="checkbox" checked={!!f.all_day} onChange={(e) => set('all_day')(e.target.checked ? 1 : 0)} /> Toute la journée</label>
        {conflicts.length > 0 && (
          <div className="full card" style={{ boxShadow: 'none', background: 'var(--warn-soft)', padding: 12 }}>
            <div className="row" style={{ color: 'var(--warn)', fontWeight: 650 }}><AlertTriangle size={16} />Conflit d’agenda</div>
            {conflicts.slice(0, 3).map((c) => <div key={c.occ_id} className="small">{fmtTime(c.start)}–{fmtTime(c.end)} · {c.title}</div>)}
          </div>
        )}
        <Field label="Lieu"><Input value={f.location} onChange={set('location')} placeholder="Salle, adresse…" /></Field>
        <Field label={<span className="row" style={{ gap: 5 }}><Video size={13} />Lien de visioconférence</span>}><Input value={f.visio_url} onChange={set('visio_url')} placeholder="https://…" /></Field>
        <Field label={f.type === 'rdv' || f.type === 'appel' ? 'Interlocuteur' : 'Contact principal'}><ContactPicker value={f.contact_id} onChange={set('contact_id')} contacts={contacts} /></Field>
        <Field label="Statut"><Select value={f.status} onChange={set('status')} options={Object.entries(EV_STATUS).map(([k, [l]]) => [k, l])} /></Field>
        <Field label="Rappel"><Select value={String(f.reminder_min)} onChange={set('reminder_min')} options={REMINDER_OPTIONS} /></Field>
        <Field label="Répétition"><Select value={f.recurrence} onChange={set('recurrence')} options={[['none', 'Aucune'], ['daily', 'Tous les jours'], ['weekly', 'Toutes les semaines'], ['monthly', 'Tous les mois'], ['yearly', 'Tous les ans']]} /></Field>
        {f.recurrence !== 'none' && <Field label="Jusqu’au (facultatif)"><Input type="date" value={f.recur_until} onChange={set('recur_until')} /></Field>}
        <Field label="Participants" full>
          <div className="col" style={{ gap: 8 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              {parts.map((id) => { const c = contacts.find((x) => x.id === id); return c ? <span key={id} className="att">{contactName(c)}<X size={13} style={{ cursor: 'pointer' }} onClick={() => set('participants')(parts.filter((p) => p !== id))} /></span> : null; })}
            </div>
            <Select value="" onChange={(v) => v && !parts.includes(v) && set('participants')([...parts, v])} placeholder="+ Ajouter un participant" options={contacts.filter((c) => !parts.includes(c.id)).map((c) => [c.id, contactName(c)])} />
          </div>
        </Field>
        <Field label="Notes" full><textarea className="input" value={f.description || ''} onChange={(e) => set('description')(e.target.value)} placeholder="Ordre du jour, documents à préparer, consignes d’accueil…" /></Field>
        {f.type === 'reunion' && <div className="full muted small">Une fiche réunion (ordre du jour, convocation, PV) est créée automatiquement dans « Réunions & PV ».</div>}
      </div>
    </Modal>
  );
}

export function TaskModal({ data = {}, onClose }) {
  const [f, setF] = useState({ priority: 'normale', status: 'a_faire', ...data });
  const [contacts, setContacts] = useState([]);
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { const r = await act(() => call('tasks.save', f), 'Tâche enregistrée'); if (r) onClose(r); };
  return (
    <Modal title={f.id ? 'Tâche' : 'Nouvelle tâche'} icon={<ListChecks size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="tasks" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Intitulé" full><Input autoFocus value={f.title} onChange={set('title')} /></Field>
        <Field label="Échéance"><Input type="date" value={f.due} onChange={set('due')} /></Field>
        <Field label="Priorité"><Select value={f.priority} onChange={set('priority')} options={Object.entries(PRIORITY).map(([k, [l]]) => [k, l])} /></Field>
        <Field label="Statut"><Select value={f.status} onChange={set('status')} options={Object.entries(TASK_STATUS)} /></Field>
        <Field label="Responsable"><Input value={f.assignee} onChange={set('assignee')} placeholder="Moi, M. Yao…" /></Field>
        <Field label="Contact lié" full><ContactPicker value={f.contact_id} onChange={set('contact_id')} contacts={contacts} /></Field>
        <Field label="Détails" full><textarea className="input" value={f.description || ''} onChange={(e) => set('description')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ReminderModal({ data = {}, onClose }) {
  const [f, setF] = useState({ repeat: 'none', due: nextSlot(), ...data, due: data.due ? dt(data.due) : nextSlot() });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { const r = await act(() => call('reminders.save', { ...f, due: full(f.due) }), 'Rappel programmé'); if (r) onClose(r); };
  const quick = (min) => set('due')(dt(addMinutes(stamp(), min)));
  return (
    <Modal title={f.id ? 'Rappel' : 'Nouveau rappel'} icon={<BellRing size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="reminders" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Programmer</button></>}>
      <div className="form">
        <Field label="Me rappeler de…" full><Input autoFocus value={f.title} onChange={set('title')} placeholder="Rappeler M. Konan, envoyer le dossier…" /></Field>
        <Field label="Date et heure"><input className="input" type="datetime-local" value={f.due} onChange={(e) => set('due')(e.target.value)} /></Field>
        <Field label="Répétition"><Select value={f.repeat} onChange={set('repeat')} options={Object.entries(REPEAT)} /></Field>
        <div className="full row wrap" style={{ gap: 6 }}>
          {[[10, 'Dans 10 min'], [30, 'Dans 30 min'], [60, 'Dans 1 h'], [180, 'Dans 3 h']].map(([m, l]) => <button key={m} className="btn sm" onClick={() => quick(m)}>{l}</button>)}
          <button className="btn sm" onClick={() => set('due')(`${localDay(new Date(Date.now() + 86400000))}T09:00`)}>Demain 9 h</button>
        </div>
        <Field label="Note" full><textarea className="input" value={f.note || ''} onChange={(e) => set('note')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function CallModal({ data = {}, onClose }) {
  const { settings } = useApp();
  const [f, setF] = useState({ direction: 'entrant', status: 'a_rappeler', urgent: 0, for_whom: settings.manager_name || '', ...data, date: data.date ? dt(data.date) : stamp().slice(0, 16) });
  const [contacts, setContacts] = useState([]);
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const pickContact = (id) => {
    const c = contacts.find((x) => x.id === id);
    setF((x) => ({ ...x, contact_id: id, caller: c ? contactName(c) : x.caller, company: c ? c.company : x.company, phone: c ? c.phone || c.mobile : x.phone }));
  };
  const save = async () => { const r = await act(() => call('calls.save', { ...f, date: full(f.date) }), 'Appel enregistré'); if (r) onClose(r); };
  return (
    <Modal title={f.id ? 'Appel' : 'Message téléphonique'} icon={<Phone size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="calls" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Contact existant" full><ContactPicker value={f.contact_id} onChange={pickContact} contacts={contacts} placeholder="— Nouvel interlocuteur —" /></Field>
        <Field label="Appelant"><Input autoFocus value={f.caller} onChange={set('caller')} /></Field>
        <Field label="Société"><Input value={f.company} onChange={set('company')} /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Date et heure"><input className="input" type="datetime-local" value={f.date} onChange={(e) => set('date')(e.target.value)} /></Field>
        <Field label="Pour"><Input value={f.for_whom} onChange={set('for_whom')} placeholder="Destinataire du message" /></Field>
        <Field label="Suite à donner"><Select value={f.status} onChange={set('status')} options={Object.entries(CALL_STATUS).map(([k, [l]]) => [k, l])} /></Field>
        <Field label="Sens"><Select value={f.direction} onChange={set('direction')} options={[['entrant', 'Appel reçu'], ['sortant', 'Appel émis']]} /></Field>
        <label className="check" style={{ alignSelf: 'end', height: 38 }}><input type="checkbox" checked={!!f.urgent} onChange={(e) => set('urgent')(e.target.checked ? 1 : 0)} /> Urgent</label>
        <Field label="Message" full><textarea className="input" value={f.message || ''} onChange={(e) => set('message')(e.target.value)} placeholder="Objet de l’appel, message laissé…" /></Field>
      </div>
    </Modal>
  );
}

export function CourrierModal({ data = {}, onClose }) {
  const { settings } = useApp();
  const [f, setF] = useState({ direction: 'arrivee', mode: 'poste', status: 'enregistre', date: localDay(), assigned_to: settings.manager_name || '', ...data });
  const [contacts, setContacts] = useState([]);
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const pickContact = (id) => { const c = contacts.find((x) => x.id === id); setF((x) => ({ ...x, contact_id: id, correspondent: c ? (c.company || contactName(c)) : x.correspondent })); };
  const save = async () => { const r = await act(() => call('courrier.save', f), f.id ? 'Courrier modifié' : 'Courrier enregistré'); if (r) onClose(r); };
  const attach = async () => { const p = await act(() => call('file.attach')); if (p) set('attachment')(p); };
  return (
    <Modal size="wide" title={f.id ? `Courrier ${f.number}` : 'Enregistrer un courrier'} icon={<FileText size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="courrier" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[['arrivee', 'Courrier arrivée'], ['depart', 'Courrier départ']].map(([k, l]) => <button key={k} disabled={!!f.id} className={`tab ${f.direction === k ? 'active' : ''}`} onClick={() => set('direction')(k)}>{l}</button>)}
      </div>
      <div className="form">
        <Field label="Date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Mode"><Select value={f.mode} onChange={set('mode')} options={Object.entries(COURRIER_MODE)} /></Field>
        <Field label="Contact (facultatif)"><ContactPicker value={f.contact_id} onChange={pickContact} contacts={contacts} /></Field>
        <Field label={f.direction === 'depart' ? 'Destinataire' : 'Expéditeur'}><Input value={f.correspondent} onChange={set('correspondent')} /></Field>
        <Field label="Objet" full><Input value={f.object} onChange={set('object')} /></Field>
        <Field label="Référence"><Input value={f.reference} onChange={set('reference')} placeholder="N° / référence du courrier" /></Field>
        <Field label="Attribué à"><Input value={f.assigned_to} onChange={set('assigned_to')} /></Field>
        <Field label="Statut"><Select value={f.status} onChange={set('status')} options={Object.entries(COURRIER_STATUS).map(([k, [l]]) => [k, l])} /></Field>
        <Field label="À traiter avant le"><Input type="date" value={f.due} onChange={set('due')} /></Field>
        <Field label="Pièce numérisée" full>
          <div className="row">
            {f.attachment ? <span className="att" onClick={() => call('file.open', f.attachment)}><Paperclip size={13} />{f.attachment.split(/[\\/]/).pop().replace(/^\d+-/, '')}</span> : <span className="muted small">Aucun fichier</span>}
            <button className="btn sm" onClick={attach}><Paperclip size={14} />{f.attachment ? 'Remplacer' : 'Joindre le scan'}</button>
          </div>
        </Field>
        <Field label="Notes" full><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ContactModal({ data = {}, onClose }) {
  const [f, setF] = useState({ color: '#7b6cff', ...data });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.last_name && !f.first_name && !f.company) return act(() => Promise.reject(new Error('Indiquez au moins un nom ou une société')));
    const r = await act(() => call('db.save', 'contacts', f), 'Contact enregistré');
    if (r) onClose(r);
  };
  return (
    <Modal size="wide" title={f.id ? contactName(f) : 'Nouveau contact'} icon={<UserRound size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="contacts" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Prénom"><Input autoFocus value={f.first_name} onChange={set('first_name')} /></Field>
        <Field label="Nom"><Input value={f.last_name} onChange={set('last_name')} /></Field>
        <Field label="Société / organisme"><Input value={f.company} onChange={set('company')} /></Field>
        <Field label="Fonction"><Input value={f.title} onChange={set('title')} /></Field>
        <Field label="E-mail"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Téléphone fixe"><Input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Mobile"><Input value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="Étiquettes"><Input value={f.tags} onChange={set('tags')} placeholder="client, partenaire, VIP…" /></Field>
        <Field label="Adresse" full><Input value={f.address} onChange={set('address')} /></Field>
        <label className="check"><input type="checkbox" checked={!!f.favorite} onChange={(e) => set('favorite')(e.target.checked ? 1 : 0)} /> Contact favori</label>
        <Field label="Couleur"><input type="color" className="input" style={{ padding: 4 }} value={f.color || '#7b6cff'} onChange={(e) => set('color')(e.target.value)} /></Field>
        <Field label="Notes" full><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function NoteModal({ data = {}, onClose }) {
  const [f, setF] = useState({ color: '#f59f00', ...data });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { const r = await act(() => call('db.save', 'notes', f), 'Pense-bête enregistré'); if (r) onClose(r); };
  const colors = ['#f59f00', '#7b6cff', '#1fb5cc', '#2fbf71', '#e64980', '#ef5350'];
  return (
    <Modal title="Pense-bête" icon={<StickyNote size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<><DeleteBtn table="notes" id={f.id} onDone={() => onClose()} /><div style={{ flex: 1 }} /><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="col">
        <Input autoFocus value={f.title} onChange={set('title')} placeholder="Titre" />
        <textarea className="input" style={{ minHeight: 160 }} value={f.body || ''} onChange={(e) => set('body')(e.target.value)} placeholder="Votre note…" />
        <div className="row">
          {colors.map((c) => <button key={c} onClick={() => set('color')(c)} style={{ width: 26, height: 26, borderRadius: 8, background: c, border: f.color === c ? '3px solid var(--text)' : '0', cursor: 'pointer' }} />)}
          <label className="check right"><input type="checkbox" checked={!!f.pinned} onChange={(e) => set('pinned')(e.target.checked ? 1 : 0)} /> Épingler</label>
        </div>
      </div>
    </Modal>
  );
}

export function ModalHost({ modal, onClose }) {
  const Comp = useMemo(() => (modal ? { event: EventModal, task: TaskModal, reminder: ReminderModal, call: CallModal, courrier: CourrierModal, contact: ContactModal, note: NoteModal, compose: ComposeModal }[modal.kind] : null), [modal]);
  if (!modal || !Comp) return null;
  return <Comp data={modal.data} onClose={onClose} />;
}
