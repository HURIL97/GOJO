import { useEffect, useState } from 'react';
import { FileText, Paperclip, ScanLine, Trash2, X, Send, Forward, BellRing, CheckCircle2, Archive, StickyNote, Reply, FileDown, Printer, Eye, PenLine, Inbox } from 'lucide-react';
import { call } from '../lib/api';
import { act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { COURRIER_STATUS, COURRIER_MODE, localDay, contactName, fmtDateTime, fmtDate } from '../lib/format';
import { Modal, Field, Input, Select, confirmBox, toast, Badge } from './ui';
import { letterHtml, printHtml, savePdf } from '../lib/print';

const STEP = {
  enregistre: ['Enregistré', Inbox, 'var(--info)'], transmis: ['Transmis', Forward, 'var(--accent)'], relance: ['Relance', BellRing, 'var(--warn)'],
  reponse: ['Réponse envoyée', Reply, 'var(--good)'], traite: ['Traité', CheckCircle2, 'var(--good)'], archive: ['Archivé', Archive, 'var(--muted)'], note: ['Note', StickyNote, 'var(--muted)'],
};
// Pièces jointes : liste « files », avec reprise de l'ancien champ unique « attachment ».
const filesOf = (c) => {
  const list = Array.isArray(c.files) ? [...c.files] : [];
  if (c.attachment && !list.some((x) => x.path === c.attachment)) list.unshift({ filename: c.attachment.split(/[\\/]/).pop().replace(/^\d+-/, ''), path: c.attachment });
  return list;
};

function DeleteBtn({ id, onDone }) {
  if (!id) return null;
  return <button className="btn danger" onClick={async () => { if (await confirmBox('Supprimer définitivement ce courrier ?', { danger: true, okLabel: 'Supprimer' })) { if (await act(() => call('db.remove', 'courrier', id), 'Supprimé')) onDone(); } }}><Trash2 size={16} />Supprimer</button>;
}

function Circuit({ c, onChange }) {
  const { open } = useApp();
  const [form, setForm] = useState(null);
  const steps = Array.isArray(c.circuit) ? c.circuit : [];
  const step = async (s, msg) => { const r = await act(() => call('courrier.step', c.id, s), msg); if (r) { onChange(r); setForm(null); } };
  const relance = async () => {
    const msg = await act(() => call('courrier.relance', c.id));
    if (!msg) return;
    if (!c.assigned_email) return toast('Renseignez l’e-mail du service destinataire (bouton « Transmettre »)', 'error');
    open('mail', { to_addr: c.assigned_email, subject: msg.subject, text: msg.text, courrier_step: { id: c.id, action: 'relance', to: c.assigned_email, note: 'Relance par e-mail' }, title: `Relancer — ${c.number}` });
  };
  const done = ['traite', 'archive'].includes(c.status);
  return (
    <div className="full">
      <div className="nav-label" style={{ padding: '6px 0' }}>Circuit de traitement</div>
      <div className="col" style={{ gap: 0 }}>
        {steps.map((s, i) => {
          const [label, I, color] = STEP[s.action] || [s.action, StickyNote, 'var(--muted)'];
          return (
            <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '6px 0', borderLeft: '2px solid var(--border)', marginLeft: 9, paddingLeft: 14, position: 'relative' }}>
              <span style={{ position: 'absolute', left: -10, top: 6, width: 18, height: 18, borderRadius: 9, background: 'var(--panel)', display: 'grid', placeItems: 'center' }}><I size={13} color={color} /></span>
              <div style={{ flex: 1 }}><b>{label}</b>{s.to ? <span> → {s.to}</span> : null}{s.note ? <div className="muted small">{s.note}</div> : null}</div>
              <span className="muted small">{fmtDateTime(s.date)}{s.by ? ` · ${s.by}` : ''}</span>
            </div>
          );
        })}
      </div>
      {form && (
        <div className="card mt" style={{ boxShadow: 'none' }}>
          <div className="form">
            {form.action === 'transmis' && <>
              <Field label="Transmis à (service, personne)"><Input value={form.to} onChange={(v) => setForm((f) => ({ ...f, to: v }))} /></Field>
              <Field label="E-mail (pour les relances)"><Input value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="service@exemple.ci" /></Field>
              <Field label="Réponse attendue avant le"><Input type="date" value={form.due} onChange={(v) => setForm((f) => ({ ...f, due: v }))} /></Field>
            </>}
            <Field label="Commentaire" full><Input value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: v }))} placeholder={form.action === 'transmis' ? 'Pour attribution, pour avis, pour information…' : ''} /></Field>
          </div>
          <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setForm(null)}>Annuler</button>
            <button className="btn primary" onClick={() => step(form, form.action === 'transmis' ? `Transmis à ${form.to || '—'}` : 'Ajouté au circuit')}>Valider</button>
          </div>
        </div>
      )}
      {!form && c.id && (
        <div className="row wrap mt" style={{ gap: 6 }}>
          {!done && <button className="btn sm" onClick={() => setForm({ action: 'transmis', to: c.assigned_to || '', email: c.assigned_email || '', due: c.due || '', note: '' })}><Forward size={14} />Transmettre</button>}
          {!done && c.direction === 'arrivee' && <button className="btn sm" onClick={relance}><BellRing size={14} />Relancer</button>}
          {!done && <button className="btn sm good" onClick={() => step({ action: 'traite' }, 'Courrier traité')}><CheckCircle2 size={14} />Traité</button>}
          <button className="btn sm" onClick={() => setForm({ action: 'note', note: '' })}><StickyNote size={14} />Note</button>
          {c.status !== 'archive' && <button className="btn sm ghost" onClick={() => step({ action: 'archive' }, 'Courrier archivé')}><Archive size={14} />Archiver</button>}
        </div>
      )}
    </div>
  );
}

export function CourrierModal({ data = {}, onClose }) {
  const { settings, open } = useApp();
  const [f, setF] = useState({ direction: 'arrivee', mode: 'poste', status: 'enregistre', date: localDay(), assigned_to: settings.manager_name || '', ...data, files: filesOf(data) });
  const [contacts, setContacts] = useState([]);
  const [scanning, setScanning] = useState(false);
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const pickContact = (id) => { const c = contacts.find((x) => x.id === id); setF((x) => ({ ...x, contact_id: id, correspondent: c ? (c.company || contactName(c)) : x.correspondent })); };
  const save = async () => {
    const row = { ...f, attachment: null };
    const r = await act(() => call('courrier.save', row), f.id ? 'Courrier modifié' : `Courrier enregistré`);
    if (r) { if (!f.id) toast(`Numéro d’ordre : ${r.number}`, 'success'); onClose(r); }
  };
  const attach = async () => { const list = await act(() => call('file.attach')); if (list && list.length) setF((x) => ({ ...x, files: [...x.files, ...list] })); };
  const scan = async () => {
    setScanning(true);
    const doc = await act(() => call('scan.acquire'));
    setScanning(false);
    if (doc) { setF((x) => ({ ...x, files: [...x.files, doc] })); toast('Document numérisé et joint en PDF', 'success'); }
  };
  const reply = () => { onClose(); open('letter', { reply_to: f }); };
  return (
    <Modal size="wide" title={f.id ? `Courrier ${f.number}` : 'Enregistrer un courrier'} icon={<FileText size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<>
        <DeleteBtn id={f.id} onDone={() => onClose()} />
        {f.id && f.direction === 'arrivee' && !['traite', 'archive'].includes(f.status) && <button className="btn" onClick={reply}><Reply size={16} />Répondre par lettre</button>}
        {f.id && f.letter && <button className="btn" onClick={() => { onClose(); open('letter', { courrier: f }); }}><PenLine size={16} />Modifier la lettre</button>}
        <div style={{ flex: 1 }} /><button className="btn" onClick={() => onClose()}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button>
      </>}>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {[['arrivee', 'Courrier arrivée'], ['depart', 'Courrier départ']].map(([k, l]) => <button key={k} disabled={!!f.id} className={`tab ${f.direction === k ? 'active' : ''}`} onClick={() => set('direction')(k)}>{l}</button>)}
        {f.id && <span className="right"><Badge kind={(COURRIER_STATUS[f.status] || [])[1]}>{(COURRIER_STATUS[f.status] || [f.status])[0]}</Badge></span>}
      </div>
      <div className="form">
        <Field label="Date"><Input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Mode"><Select value={f.mode} onChange={set('mode')} options={Object.entries(COURRIER_MODE)} /></Field>
        <Field label="Contact (facultatif)"><Select value={f.contact_id} onChange={pickContact} placeholder="— Aucun —" options={contacts.map((c) => [c.id, `${contactName(c)}${c.company ? ` · ${c.company}` : ''}`])} /></Field>
        <Field label={f.direction === 'depart' ? 'Destinataire' : 'Expéditeur'}><Input value={f.correspondent} onChange={set('correspondent')} /></Field>
        <Field label="Objet" full><Input value={f.object} onChange={set('object')} /></Field>
        <Field label="Référence"><Input value={f.reference} onChange={set('reference')} placeholder="N° / référence du courrier" /></Field>
        <Field label="Attribué à"><Input value={f.assigned_to} onChange={set('assigned_to')} /></Field>
        <Field label="Statut"><Select value={f.status} onChange={set('status')} options={Object.entries(COURRIER_STATUS).map(([k, [l]]) => [k, l])} /></Field>
        <Field label="Réponse attendue avant le"><Input type="date" value={f.due} onChange={set('due')} /></Field>
        <Field label="Pièces (scans, PDF, documents)" full>
          <div className="row wrap" style={{ gap: 6 }}>
            {f.files.map((x, i) => (
              <span key={x.path} className="att"><span onClick={() => call('file.open', x.path).catch((e) => toast(e.message, 'error'))} style={{ cursor: 'pointer' }}><Paperclip size={13} />{x.filename}</span>
                <X size={13} style={{ cursor: 'pointer' }} onClick={() => setF((y) => ({ ...y, files: y.files.filter((_, j) => j !== i) }))} /></span>
            ))}
            <button className="btn sm" disabled={scanning} onClick={scan}><ScanLine size={14} />{scanning ? 'Numérisation…' : 'Numériser'}</button>
            <button className="btn sm" onClick={attach}><Paperclip size={14} />Joindre des fichiers</button>
          </div>
        </Field>
        <Field label="Notes" full><textarea className="input" value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} /></Field>
        {f.id ? <Circuit c={f} onChange={(r) => setF((x) => ({ ...x, ...r, files: filesOf(r) }))} /> : <div className="full muted small">Le numéro d’ordre (A-/D-année-n°) est attribué à l’enregistrement. Le circuit de traitement (transmission, relances, réponse) apparaît ensuite ici.</div>}
      </div>
    </Modal>
  );
}

// Rédaction d'une lettre sur papier à en-tête, enregistrée au registre du courrier départ.
export function LetterModal({ data = {}, onClose }) {
  const { settings, open } = useApp();
  const src = data.courrier;
  const orig = data.reply_to;
  const [l, setL] = useState(() => (src && src.letter ? { ...src.letter } : {
    recipient: orig ? orig.correspondent : '', object: orig ? `Réponse à votre courrier du ${fmtDate(orig.date)}` : '', your_ref: orig ? orig.reference || '' : '',
    our_ref: '', salutation: 'Madame, Monsieur,', body: orig ? `Nous accusons réception de votre courrier relatif à « ${orig.object} ».\n\n` : '',
    closing: 'Veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.', signatory: settings.letter_signatory || settings.manager_name || '', copies: '', attachments: '',
  }));
  const [contacts, setContacts] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('contacts.list', '').then(setContacts).catch(() => {}); }, []);
  const set = (k) => (v) => setL((x) => ({ ...x, [k]: v }));
  const pick = (id) => {
    const c = contacts.find((x) => x.id === id);
    if (!c) return;
    setL((x) => ({ ...x, contact_id: id, recipient: [c.title ? `${c.title}` : '', contactName(c), c.company, c.address].filter(Boolean).join('\n') }));
  };
  const preview = (extra = {}) => letterHtml({ ...l, number: src?.number, date: src?.date || localDay(), ...extra }, settings);
  // Enregistre au registre départ (numéro), génère le PDF et le joint au courrier.
  const register = async (thenMail) => {
    if (!l.object || !l.recipient) return toast('Indiquez le destinataire et l’objet', 'error');
    setBusy(true);
    try {
      const firstLine = l.recipient.split('\n').filter(Boolean);
      const contact = contacts.find((c) => c.id === l.contact_id);
      let c = src && src.id ? src : await call('courrier.save', {
        direction: 'depart', date: localDay(), correspondent: contact ? (contact.company || contactName(contact)) : (firstLine[1] || firstLine[0]), object: l.object, reference: l.our_ref || '',
        mode: thenMail ? 'email' : 'poste', status: 'traite', contact_id: l.contact_id || null, reply_to_id: orig ? orig.id : null, letter: l,
      });
      const pdf = await call('courrier.letterPdf', preview({ number: c.number, date: c.date }), `Lettre ${c.number} - ${l.object}`);
      const files = (Array.isArray(c.files) ? c.files : []).filter((x) => !/^Lettre /.test(x.filename));
      c = await call('courrier.save', { id: c.id, letter: l, object: l.object, files: [pdf, ...files] });
      toast(`Lettre enregistrée au registre départ : ${c.number}`, 'success');
      onClose(c);
      if (thenMail) open('mail', { to_addr: contact?.email || '', subject: `${l.object} — ${c.number}`, text: `${l.salutation}\n\nVeuillez trouver ci-joint notre courrier ${c.number} relatif à « ${l.object} ».\n\nBien cordialement,`, attachments: [pdf], title: 'Envoyer la lettre' });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal size="wide" title={src ? `Lettre ${src.number}` : orig ? `Réponse au courrier ${orig.number}` : 'Rédiger une lettre'} icon={<PenLine size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<>
        <button className="btn" onClick={() => printHtml(preview())}><Printer size={16} />Imprimer</button>
        <button className="btn" onClick={() => savePdf(preview(), l.object || 'Lettre')}><FileDown size={16} />PDF</button>
        <button className="btn" onClick={() => call('export.doc', preview(), l.object || 'Lettre').catch((e) => toast(e.message, 'error'))}><Eye size={16} />Word</button>
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => register(true)}><Send size={16} />Enregistrer et envoyer par e-mail</button>
        <button className="btn primary" disabled={busy} onClick={() => register(false)}><FileText size={16} />{src ? 'Mettre à jour' : 'Enregistrer au registre'}</button>
      </>}>
      <div className="form">
        <Field label="Destinataire (contact)"><Select value={l.contact_id} onChange={pick} placeholder="Choisir dans les contacts…" options={contacts.map((c) => [c.id, `${contactName(c)}${c.company ? ` · ${c.company}` : ''}`])} /></Field>
        <Field label="Signataire"><textarea className="input" style={{ minHeight: 38 }} rows={2} value={l.signatory || ''} onChange={(e) => set('signatory')(e.target.value)} /></Field>
        <Field label="Adresse du destinataire" full><textarea className="input" style={{ minHeight: 76 }} value={l.recipient} onChange={(e) => set('recipient')(e.target.value)} placeholder={'Monsieur le Directeur\nSociété …\nBP …, Abidjan'} /></Field>
        <Field label="Objet" full><Input value={l.object} onChange={set('object')} /></Field>
        <Field label="N/Réf."><Input value={l.our_ref} onChange={set('our_ref')} /></Field>
        <Field label="V/Réf."><Input value={l.your_ref} onChange={set('your_ref')} /></Field>
        <Field label="Formule d’appel"><Input value={l.salutation} onChange={set('salutation')} /></Field>
        <Field label="Pièces jointes (mention)"><Input value={l.attachments} onChange={set('attachments')} placeholder="Devis n° …" /></Field>
        <Field label="Texte de la lettre (une ligne vide = nouveau paragraphe) — dictée : Windows + H" full><textarea className="input" style={{ minHeight: 200 }} value={l.body} onChange={(e) => set('body')(e.target.value)} /></Field>
        <Field label="Formule de politesse" full><Input value={l.closing} onChange={set('closing')} /></Field>
        <Field label="Copie(s) à" full><Input value={l.copies} onChange={set('copies')} /></Field>
        <div className="full muted small">Logo, adresse et pied de page viennent de Paramètres › Profil › Papier à en-tête.</div>
      </div>
    </Modal>
  );
}
