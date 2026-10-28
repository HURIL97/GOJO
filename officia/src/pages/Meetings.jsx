import { useEffect, useState } from 'react';
import {
  Users2, Plus, ArrowLeft, Save, Send, FileDown, Printer, Trash2, ListOrdered, ClipboardCheck, FileSignature,
  CheckCircle2, Wand2, MapPin, Video, UserPlus, Search, Mic, History, CalendarClock, ClipboardList, MessageSquareWarning,
} from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtLong, fmtShort, fmtTime, relDay, MEETING_STATUS, contactName, addMinutes, stamp, localDay, TASK_STATUS } from '../lib/format';
import { Card, Tabs, Badge, StatusBadge, Empty, Field, Input, Select, toast, confirmBox } from '../components/ui';
import { convocationHtml, pvHtml, attendanceHtml, printHtml, savePdf } from '../lib/print';

const FLOW = ['preparation', 'convoquee', 'tenue', 'pv_valide', 'pv_diffuse'];
const FLOW_LABEL = { preparation: 'Préparation', convoquee: 'Convocation', tenue: 'Séance', pv_valide: 'PV validé', pv_diffuse: 'PV diffusé' };
const dt = (s) => (s ? s.slice(0, 16) : '');
const full = (s) => (s && s.length === 16 ? `${s}:00` : s);
const blank = () => {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
  const start = stamp(d);
  return { title: '', start, end: addMinutes(start, 90), location: '', agenda: [], participants: [], minutes: { intro: '', points: [], actions: [], conclusion: '', next_meeting: '' }, status: 'preparation' };
};

function Stepper({ status }) {
  const i = FLOW.indexOf(status);
  return (
    <div className="steps-bar">
      {FLOW.map((s, j) => <div key={s} className={`st ${j < i ? 'done' : j === i ? 'cur' : ''}`}>{j < i ? '✓ ' : ''}{FLOW_LABEL[s]}</div>)}
    </div>
  );
}

function Editor({ id, initial, onBack, initialTab, onOpen }) {
  const { settings, open } = useApp();
  const [m, setM] = useState(null);
  const [tab, setTab] = useState(initialTab || 'prep');
  const [contacts, setContacts] = useState([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    call('contacts.list', '').then(setContacts).catch(() => {});
    if (id) call('meetings.get', id).then(setM).catch((e) => toast(e.message, 'error'));
    else setM({ ...blank(), ...(initial || {}) });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const set = (patch) => { setM((x) => ({ ...x, ...patch })); setDirty(true); };
  const setMin = (patch) => set({ minutes: { ...m.minutes, ...patch } });
  const save = async (quiet) => {
    const r = await act(() => call('meetings.save', m), quiet ? null : 'Réunion enregistrée');
    if (r) { setM(r); setDirty(false); }
    return r;
  };
  const status = async (st, msg) => { const saved = dirty || !m.id ? await save(true) : m; if (!saved) return; const r = await act(() => call('meetings.status', saved.id, st), msg); if (r) setM(r); };

  // Ordre du jour
  const agenda = m.agenda || [];
  const setItem = (i, patch) => set({ agenda: agenda.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const moveItem = (i, d) => { const a = [...agenda]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); set({ agenda: a }); };
  // Participants
  const parts = m.participants || [];
  const addParticipant = (cid) => { const c = contacts.find((x) => x.id === cid); if (!c || parts.some((p) => p.contact_id === cid)) return; set({ participants: [...parts, { contact_id: c.id, name: contactName(c), email: c.email || '', role: c.title || '', presence: '' }] }); };
  const setPart = (i, patch) => set({ participants: parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  // PV
  const min = m.minutes || {};
  const points = min.points || [];
  const actions = min.actions || [];
  const setPoint = (i, patch) => setMin({ points: points.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setAction = (i, patch) => setMin({ actions: actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const prefill = async () => {
    if (points.length && !(await confirmBox('Remplacer les points du PV par ceux de l’ordre du jour ?'))) return;
    setMin({ points: agenda.map((a) => ({ title: a.title, discussion: '', decisions: '' })), intro: min.intro || `La séance est ouverte à ${fmtTime(m.start)} sous la présidence de ${m.president || '…'}.` });
  };
  const emails = parts.map((p) => p.email).filter(Boolean).join(', ');
  const sendConvocation = async () => {
    const saved = await save(true); if (!saved) return;
    open('mail', { to_addr: emails, subject: `Convocation — ${saved.title} — ${fmtLong(saved.start)}`, title: 'Envoyer la convocation', link_type: 'meeting', link_id: saved.id, invite_event: saved.event_id,
      text: `Madame, Monsieur,\n\nVous êtes convié(e) à la réunion « ${saved.title} » qui se tiendra le ${fmtLong(saved.start)} de ${fmtTime(saved.start)} à ${fmtTime(saved.end)}${saved.location ? `, ${saved.location}` : ''}.${saved.visio_url ? `\nLien de visioconférence : ${saved.visio_url}` : ''}\n\nOrdre du jour :\n${(saved.agenda || []).map((a, i) => `${i + 1}. ${a.title}`).join('\n')}\n\nVous trouverez la convocation en pièce jointe.\n\nBien cordialement,`,
      pdf: { html: convocationHtml(saved, settings), filename: `Convocation - ${saved.title}`, kind: 'convocation' } });
  };
  const sendPv = async () => {
    const saved = await save(true); if (!saved) return;
    open('mail', { to_addr: emails, subject: `Procès-verbal — ${saved.title} du ${fmtShort(saved.start)}`, title: 'Diffuser le procès-verbal', link_type: 'meeting', link_id: saved.id,
      text: `Madame, Monsieur,\n\nVeuillez trouver ci-joint le procès-verbal de la réunion « ${saved.title} » du ${fmtLong(saved.start)}.\n\nRelevé des actions :\n${(saved.minutes.actions || []).filter((a) => a.title).map((a) => `• ${a.title}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` (avant le ${fmtShort(a.due)})` : ''}`).join('\n') || '—'}\n\nBien cordialement,`,
      pdf: { html: pvHtml(saved, settings), filename: `PV - ${saved.title} - ${saved.start.slice(0, 10)}`, kind: 'pv' } });
  };
  // Suivi : actions non terminées de la réunion précédente, séance suivante.
  const carry = async () => { const saved = dirty || !m.id ? await save(true) : m; if (!saved) return; const r = await act(() => call('meetings.carry', saved.id), 'Point « Suivi des actions » ajouté à l’ordre du jour'); if (r) { setM(r); setDirty(false); } };
  const planNext = async () => {
    const saved = dirty || !m.id ? await save(true) : m; if (!saved) return;
    if (!(await confirmBox(`Créer la prochaine séance « ${saved.title} »${saved.minutes.next_meeting ? ` le ${fmtLong(saved.minutes.next_meeting)}` : ' (dans 7 jours, modifiable)'} avec les mêmes participants et le suivi des actions en cours ?`, { okLabel: 'Planifier' }))) return;
    const r = await act(() => call('meetings.next', saved.id), 'Prochaine réunion planifiée');
    if (r && onOpen) onOpen(r.id);
  };
  const counts = { present: parts.filter((p) => p.presence === 'present').length, excuse: parts.filter((p) => p.presence === 'excuse').length, absent: parts.filter((p) => p.presence === 'absent').length };
  const totalDuration = agenda.reduce((s, a) => s + (Number(a.duration) || 0), 0);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button className="btn" onClick={onBack}><ArrowLeft size={16} />Réunions</button>
        <h2 style={{ margin: '0 8px', fontSize: 19 }}>{m.title || 'Nouvelle réunion'}</h2>
        {m.id && <StatusBadge map={MEETING_STATUS} value={m.status} />}
        <div className="grow" />
        {dirty && <span className="muted small">Modifications non enregistrées</span>}
        {m.id && <button className="btn danger icon" title="Supprimer" onClick={async () => { if (await confirmBox('Supprimer cette réunion et son évènement d’agenda ?', { danger: true })) { await call('db.remove', 'meetings', m.id); if (m.event_id) await call('db.remove', 'events', m.event_id); onBack(); } }}><Trash2 size={16} /></button>}
        <button className="btn primary" onClick={() => save()}><Save size={16} />Enregistrer</button>
      </div>
      <Card style={{ padding: '6px 18px' }}><Stepper status={m.status} /></Card>
      <Tabs value={tab} onChange={setTab} tabs={[['prep', 'Préparation', ListOrdered], ['seance', 'Séance & PV', ClipboardCheck], ['diffusion', 'Documents & diffusion', FileSignature]]} />

      {tab === 'prep' && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
          <Card title="Informations">
            <div className="form">
              <Field label="Intitulé" full><Input value={m.title} onChange={(v) => set({ title: v })} placeholder="Comité de direction, réunion de service…" /></Field>
              <Field label="Début"><input className="input" type="datetime-local" value={dt(m.start)} onChange={(e) => { const s = full(e.target.value); const dur = (new Date(m.end) - new Date(m.start)) / 60000 || 90; set({ start: s, end: addMinutes(s, dur) }); }} /></Field>
              <Field label="Fin"><input className="input" type="datetime-local" value={dt(m.end)} onChange={(e) => set({ end: full(e.target.value) })} /></Field>
              <Field label="Lieu"><Input value={m.location} onChange={(v) => set({ location: v })} /></Field>
              <Field label="Visioconférence"><Input value={m.visio_url} onChange={(v) => set({ visio_url: v })} placeholder="https://…" /></Field>
              <Field label="Président(e) de séance"><Input value={m.president} onChange={(v) => set({ president: v })} /></Field>
              <Field label="Organisateur"><Input value={m.organizer} onChange={(v) => set({ organizer: v })} /></Field>
              <Field label="Objet / objectif" full><textarea className="input" value={m.objective || ''} onChange={(e) => set({ objective: e.target.value })} /></Field>
            </div>
          </Card>
          <div className="col" style={{ gap: 16 }}>
            <Card title="Ordre du jour" hint={totalDuration ? `Durée prévue : ${totalDuration} min` : 'Ajoutez les points à traiter'} right={<div className="row" style={{ gap: 6 }}><button className="btn sm" title="Ajouter les actions non terminées de la réunion précédente (même intitulé)" onClick={carry}><History size={14} />Suivi des actions</button><button className="btn sm" onClick={() => set({ agenda: [...agenda, { title: '', presenter: '', duration: 15 }] })}><Plus size={14} />Point</button></div>}>
              {agenda.map((a, i) => (
                <div key={i}>
                <div className="agenda-item">
                  <span className="n">{i + 1}</span>
                  <input className="input" value={a.title} placeholder="Intitulé du point" onChange={(e) => setItem(i, { title: e.target.value })} />
                  <input className="input" value={a.presenter || ''} placeholder="Présenté par" onChange={(e) => setItem(i, { presenter: e.target.value })} />
                  <input className="input" type="number" value={a.duration || ''} placeholder="min" onChange={(e) => setItem(i, { duration: Number(e.target.value) })} />
                  <div className="col" style={{ gap: 2 }}>
                    {i > 0 && <button className="btn ghost sm icon" style={{ height: 18 }} onClick={() => moveItem(i, -1)}>▲</button>}
                    <button className="btn ghost sm icon" style={{ height: 18 }} onClick={() => set({ agenda: agenda.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
                  </div>
                </div>
                {Array.isArray(a.carried) && a.carried.length > 0 && (
                  <div style={{ margin: '-4px 0 10px 40px' }}>
                    {a.carried.map((t) => <div key={t.task_id} className="row small" style={{ gap: 8, padding: '3px 0' }}><span className="dot" style={{ background: t.status === 'en_cours' ? 'var(--info)' : 'var(--warn)' }} /><span style={{ flex: 1 }}>{t.title}</span><span className="muted">{t.owner}{t.due ? ` · ${fmtShort(t.due)}` : ''}</span><Badge kind={t.status === 'en_cours' ? 'info' : 'warn'}>{TASK_STATUS[t.status]}</Badge></div>)}
                  </div>
                )}
                </div>
              ))}
              {!agenda.length && <Empty icon={ListOrdered}>Aucun point pour l’instant</Empty>}
            </Card>
            <Card title="Participants" hint={`${parts.length} convoqué(s)`}>
              <Select value="" onChange={addParticipant} placeholder="+ Ajouter un participant depuis les contacts" options={contacts.filter((c) => !parts.some((p) => p.contact_id === c.id)).map((c) => [c.id, `${contactName(c)}${c.title ? ` — ${c.title}` : ''}`])} />
              <div className="mt">
                {parts.map((p, i) => (
                  <div key={i} className="list-row">
                    <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{p.name.slice(0, 2).toUpperCase()}</div>
                    <div style={{ flex: 1 }}><b>{p.name}</b><div className="muted small">{p.role}{p.email ? ` · ${p.email}` : ' · pas d’e-mail'}</div></div>
                    <button className="btn ghost sm icon" onClick={() => set({ participants: parts.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'seance' && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1.7fr' }}>
          <div className="col" style={{ gap: 16 }}>
            <Card title="Feuille de présence" hint={`${counts.present} présent(s) · ${counts.excuse} excusé(s) · ${counts.absent} absent(s)`} right={<button className="btn sm" title="Feuille d’émargement à faire signer" onClick={() => printHtml(attendanceHtml(m, settings))}><ClipboardList size={14} />Imprimer</button>}>
              {parts.map((p, i) => (
                <div key={i} className="list-row">
                  <div style={{ flex: 1 }}><b>{p.name}</b><div className="muted small">{p.role}</div></div>
                  <div className="presence">
                    {[['present', 'Présent'], ['excuse', 'Excusé'], ['absent', 'Absent']].map(([k, l]) => <button key={k} className={p.presence === k ? `on-${k}` : ''} onClick={() => setPart(i, { presence: p.presence === k ? '' : k })}>{l}</button>)}
                  </div>
                </div>
              ))}
              {!parts.length && <Empty icon={UserPlus}>Ajoutez les participants dans l’onglet Préparation</Empty>}
            </Card>
            <Card title="Séance">
              <div className="form">
                <Field label="Président(e)"><Input value={m.president} onChange={(v) => set({ president: v })} /></Field>
                <Field label="Secrétaire de séance"><Input value={m.secretary || settings.user_name} onChange={(v) => set({ secretary: v })} /></Field>
                <Field label="Prochaine réunion" full><input className="input" type="datetime-local" value={dt(min.next_meeting)} onChange={(e) => setMin({ next_meeting: full(e.target.value) })} /></Field>
              </div>
              {m.status === 'preparation' || m.status === 'convoquee' ? <button className="btn mt" onClick={() => status('tenue', 'Réunion marquée comme tenue')}><CheckCircle2 size={16} />Marquer la réunion comme tenue</button> : null}
            </Card>
          </div>
          <Card title="Procès-verbal" hint={<span className="row" style={{ gap: 5 }}><Mic size={13} />Dictée vocale : cliquez dans un champ puis appuyez sur <b>Windows + H</b></span>} right={<button className="btn sm" onClick={prefill}><Wand2 size={14} />Reprendre l’ordre du jour</button>}>
            {m.pv_remarks && <div className="card" style={{ boxShadow: 'none', background: 'var(--warn-soft)', marginBottom: 12 }}><div className="row" style={{ gap: 6, color: 'var(--warn)', fontWeight: 650 }}><MessageSquareWarning size={16} />Remarques de la Direction</div><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{m.pv_remarks}</div></div>}
            <Field label="Ouverture de la séance"><textarea className="input" value={min.intro || ''} onChange={(e) => setMin({ intro: e.target.value })} placeholder="La séance est ouverte à … sous la présidence de …" /></Field>
            <div className="mt">
              {points.map((p, i) => (
                <div key={i} className="pv-point">
                  <div className="row"><span className="n">{i + 1}</span><input className="input" value={p.title} placeholder="Point traité" onChange={(e) => setPoint(i, { title: e.target.value })} />
                    <button className="btn ghost sm icon" onClick={() => setMin({ points: points.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></div>
                  <textarea className="input" value={p.discussion || ''} placeholder="Résumé des échanges" onChange={(e) => setPoint(i, { discussion: e.target.value })} />
                  <textarea className="input" style={{ minHeight: 50, borderColor: 'color-mix(in srgb, var(--good) 40%, var(--border))' }} value={p.decisions || ''} placeholder="Décision(s) prise(s)" onChange={(e) => setPoint(i, { decisions: e.target.value })} />
                </div>
              ))}
              <button className="btn sm" onClick={() => setMin({ points: [...points, { title: '', discussion: '', decisions: '' }] })}><Plus size={14} />Ajouter un point</button>
            </div>
            <div className="card-head mt"><h3>Relevé des actions</h3><span className="hint">Chaque action devient une tâche suivie dans « Tâches & rappels »</span></div>
            {actions.map((a, i) => (
              <div key={i} className="agenda-item" style={{ gridTemplateColumns: '30px 1fr 180px 150px 36px' }}>
                <span className="n">{i + 1}</span>
                <input className="input" value={a.title} placeholder="Action à mener" onChange={(e) => setAction(i, { title: e.target.value })} />
                <input className="input" value={a.owner || ''} placeholder="Responsable" onChange={(e) => setAction(i, { owner: e.target.value })} />
                <input className="input" type="date" value={a.due || ''} onChange={(e) => setAction(i, { due: e.target.value })} />
                <button className="btn ghost sm icon" onClick={() => setMin({ actions: actions.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
              </div>
            ))}
            <button className="btn sm" onClick={() => setMin({ actions: [...actions, { title: '', owner: '', due: '' }] })}><Plus size={14} />Ajouter une action</button>
            {m.tasks && m.tasks.length > 0 && (
              <div className="row wrap mt" style={{ gap: 6 }}>{m.tasks.map((t) => <Badge key={t.id} kind={t.status === 'terminee' ? 'good' : 'info'}>{t.title.slice(0, 40)} · {TASK_STATUS[t.status]}</Badge>)}</div>
            )}
            <Field label="Clôture"><textarea className="input" value={min.conclusion || ''} onChange={(e) => setMin({ conclusion: e.target.value })} placeholder="L’ordre du jour étant épuisé, la séance est levée à …" /></Field>
          </Card>
        </div>
      )}

      {tab === 'diffusion' && (
        <div className="grid g2">
          <Card title="Feuille de présence" hint="Émargement à faire signer en début de séance">
            <p className="muted">Liste des participants convoqués, avec colonnes « arrivée » et « émargement », et des lignes libres pour les invités.</p>
            <div className="row wrap">
              <button className="btn" onClick={() => printHtml(attendanceHtml(m, settings))}><Printer size={16} />Imprimer</button>
              <button className="btn" onClick={() => savePdf(attendanceHtml(m, settings), `Feuille de presence - ${m.title}`)}><FileDown size={16} />PDF</button>
            </div>
          </Card>
          <Card title="Séance suivante" hint={min.next_meeting ? `Prévue le ${fmtLong(min.next_meeting)}` : 'Date à fixer'}>
            <p className="muted">Crée la prochaine réunion avec les mêmes participants, la validation du PV et le <b>suivi des actions non terminées</b> à l’ordre du jour.</p>
            <button className="btn primary" disabled={!m.id} onClick={planNext}><CalendarClock size={16} />Planifier la réunion suivante</button>
          </Card>
          <Card title="Convocation" hint={m.convocation_sent_at ? `Envoyée le ${fmtShort(m.convocation_sent_at)} à ${fmtTime(m.convocation_sent_at)}` : 'Non envoyée'}>
            <p className="muted">Document officiel reprenant la date, le lieu, l’ordre du jour et la liste des participants.</p>
            <div className="row wrap">
              <button className="btn" onClick={() => printHtml(convocationHtml(m, settings))}><Printer size={16} />Imprimer</button>
              <button className="btn" onClick={() => savePdf(convocationHtml(m, settings), `Convocation - ${m.title}`)}><FileDown size={16} />PDF</button>
              <button className="btn primary" disabled={!parts.length} onClick={sendConvocation}><Send size={16} />Envoyer aux participants</button>
            </div>
            {!emails && parts.length > 0 && <p className="small neg-val mt">Aucun participant n’a d’adresse e-mail.</p>}
          </Card>
          <Card title="Procès-verbal" hint={m.pv_sent_at ? `Diffusé le ${fmtShort(m.pv_sent_at)}` : m.pv_validated_at ? `Validé le ${fmtShort(m.pv_validated_at)}${m.pv_validated_by ? ` par ${m.pv_validated_by}` : ''}` : 'Projet'}>
            <p className="muted">PV mis en page avec présences, décisions, relevé des actions et zones de signature.</p>
            <div className="row wrap">
              <button className="btn" onClick={() => printHtml(pvHtml(m, settings))}><Printer size={16} />Imprimer</button>
              <button className="btn" onClick={() => savePdf(pvHtml(m, settings), `PV - ${m.title} - ${m.start.slice(0, 10)}`)}><FileDown size={16} />PDF</button>
              {!['pv_valide', 'pv_diffuse'].includes(m.status) && <button className="btn good" onClick={() => status('pv_valide', 'PV validé')}><CheckCircle2 size={16} />Valider le PV</button>}
              <button className="btn primary" disabled={!parts.length} onClick={sendPv}><Send size={16} />Diffuser le PV</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Meetings() {
  const { nav, go } = useApp();
  const [current, setCurrent] = useState(nav.id ? { id: nav.id, tab: nav.tab } : nav.create ? { create: true, data: nav.data } : null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows] = useData('meetings.list', [{ q, status }], [q, status]);
  useEffect(() => { if (nav.id) setCurrent({ id: nav.id, tab: nav.tab }); else if (nav.create) setCurrent({ create: true, data: nav.data }); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps

  if (current) return <Editor key={current.id || 'new'} id={current.id} initial={current.data} initialTab={current.tab} onOpen={(nid) => setCurrent({ id: nid })} onBack={() => { setCurrent(null); go('meetings'); }} />;
  const upcoming = (rows || []).filter((m) => m.start >= `${localDay()}T00:00:00`).reverse();
  const past = (rows || []).filter((m) => m.start < `${localDay()}T00:00:00`);
  const row = (m) => (
    <tr key={m.id} className="click" onClick={() => setCurrent({ id: m.id })}>
      <td><b>{m.title}</b><div className="muted small">{m.objective ? m.objective.slice(0, 80) : ''}</div></td>
      <td>{relDay(m.start)}<div className="muted small">{fmtTime(m.start)} – {fmtTime(m.end)}</div></td>
      <td>{m.location ? <span className="row" style={{ gap: 5 }}><MapPin size={13} />{m.location}</span> : m.visio_url ? <span className="row" style={{ gap: 5 }}><Video size={13} />Visio</span> : '—'}</td>
      <td>{(m.participants || []).length}</td>
      <td><StatusBadge map={MEETING_STATUS} value={m.status} /></td>
    </tr>
  );
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="search" style={{ width: 300 }}><Search size={16} /><input className="input" placeholder="Rechercher une réunion…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ width: 220 }}><Select value={status} onChange={setStatus} placeholder="Tous les statuts" options={Object.entries(MEETING_STATUS).map(([k, [l]]) => [k, l])} /></div>
        <div className="grow" />
        <button className="btn primary" onClick={() => setCurrent({ create: true })}><Plus size={16} />Nouvelle réunion</button>
      </div>
      <div className="grid g4">
        {FLOW.map((s) => (
          <div key={s} className="card kpi" style={{ display: s === 'pv_diffuse' ? 'none' : undefined }}>
            <div className="label">{FLOW_LABEL[s]}</div>
            <div className="value">{(rows || []).filter((m) => m.status === s).length}</div>
            <div className="delta">{s === 'tenue' ? 'PV à rédiger' : s === 'preparation' ? 'à convoquer' : s === 'convoquee' ? 'convocations envoyées' : 'PV prêts à diffuser'}</div>
          </div>
        ))}
      </div>
      <Card title="À venir" hint={`${upcoming.length} réunion(s)`}>
        {upcoming.length ? <table className="tbl"><thead><tr><th>Réunion</th><th>Date</th><th>Lieu</th><th>Participants</th><th>Statut</th></tr></thead><tbody>{upcoming.map(row)}</tbody></table> : <Empty icon={Users2}>Aucune réunion à venir</Empty>}
      </Card>
      <Card title="Réunions passées" hint="Suivi des procès-verbaux">
        {past.length ? <table className="tbl"><thead><tr><th>Réunion</th><th>Date</th><th>Lieu</th><th>Participants</th><th>Statut</th></tr></thead><tbody>{past.map(row)}</tbody></table> : <Empty>—</Empty>}
      </Card>
    </div>
  );
}

