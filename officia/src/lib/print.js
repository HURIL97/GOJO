// Gabarits d'impression et de PDF : convocation, procès-verbal, agenda du jour, registre du courrier.
import { call } from './api';
import { fmtLong, fmtDate, fmtTime, fmtDateTime, TYPES, COURRIER_STATUS, contactName } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const para = (s) => esc(s).replace(/\n/g, '<br>');

const cssText = (s) => String(s || '').replace(/\\/g, '').replace(/"/g, '\'').replace(/[\r\n]+/g, ' ');
const CSS = (s = {}) => `
  @page { size: A4; margin: 18mm 18mm 20mm;
    @bottom-left { content: "${cssText(s.org_footer) || 'Document établi avec OfficiaTech v1.10'}"; font: 7.5pt 'Segoe UI', Arial, sans-serif; color: #9ca3af; }
    @bottom-right { content: "Page " counter(page) " / " counter(pages); font: 7.5pt 'Segoe UI', Arial, sans-serif; color: #6b7280; } }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111827; font-size: 11pt; line-height: 1.5; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #5a48e6; padding-bottom: 12px; margin-bottom: 18px; }
  .org { font-size: 15pt; font-weight: 700; } .muted { color: #6b7280; font-size: 9.5pt; }
  h1 { font-size: 19pt; margin: 0 0 4px; letter-spacing: -.3px; } h2 { font-size: 12.5pt; color: #5a48e6; margin: 20px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; break-after: avoid; }
  tr, .dec, .box, .ev { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10pt; }
  th { background: #f3f4f8; text-align: left; padding: 6px 8px; font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; color: #4b5563; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .box { background: #f6f5ff; border-left: 4px solid #5a48e6; padding: 10px 14px; border-radius: 6px; margin: 10px 0; }
  .dec { background: #eefaf3; border-left: 4px solid #18a058; padding: 8px 12px; border-radius: 6px; margin-top: 6px; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; } .sign div { width: 45%; border-top: 1px solid #9ca3af; padding-top: 6px; font-size: 10pt; color: #4b5563; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 8.5pt; background: #eef0f6; }
  .ev { display: flex; gap: 14px; padding: 10px 0; border-bottom: 1px solid #e5e7eb; } .ev .h { width: 90px; font-weight: 700; } .ev .bar { width: 4px; border-radius: 2px; }
  .logo { max-height: 58px; max-width: 170px; margin-right: 14px; } .brand { display: flex; align-items: center; }
  .sheet td { height: 34px; } .sheet td.sig { width: 32%; }
  .carried { margin: 4px 0 0 0; font-size: 9.5pt; } .carried td { padding: 3px 6px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; } .kpis div { flex: 1 1 22%; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; } .kpis b { display: block; font-size: 16pt; color: #111827; } .kpis span { color: #6b7280; font-size: 8.5pt; }
  .letter { font-size: 11.5pt; line-height: 1.6; } .letter .to { margin: 26px 0 26px 55%; } .letter .obj { margin: 18px 0; } .letter .sigblk { margin: 40px 0 0 55%; text-align: center; }
`;
const doc = (title, body, s) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(s)}</style></head><body>${body}</body></html>`;
const brand = (s) => `<div class="brand">${s.org_logo && /^data:image\//.test(s.org_logo) ? `<img class="logo" src="${s.org_logo}">` : ''}<div><div class="org">${esc(s.organisation || 'Secrétariat')}</div><div class="muted">${[s.org_address, s.org_phone, s.org_email].filter(Boolean).map(esc).join(' · ')}</div></div></div>`;
const header = (s, title, right = '') => `<div class="head">${brand(s)}<div style="text-align:right">${right}</div></div>${title ? `<h1>${esc(title)}</h1>` : ''}`;
const presenceLabel = { present: 'Présent(e)', excuse: 'Excusé(e)', absent: 'Absent(e)', '': '—' };

const STATUS_TASK = { a_faire: 'À faire', en_cours: 'En cours', attente: 'En attente', terminee: 'Terminée' };
const carried = (a) => (Array.isArray(a.carried) && a.carried.length ? `<table class="carried">${a.carried.map((t) => `<tr><td>• ${esc(t.title)}</td><td>${esc(t.owner || '')}</td><td>${t.due ? fmtDate(t.due) : ''}</td><td>${STATUS_TASK[t.status] || ''}</td></tr>`).join('')}</table>` : '');

export function convocationHtml(m, s) {
  const items = m.agenda.map((a, i) => `<tr><td style="width:30px">${i + 1}</td><td>${esc(a.title)}${carried(a)}</td><td>${esc(a.presenter || '')}</td><td>${a.duration ? `${a.duration} min` : ''}</td></tr>`).join('');
  const people = m.participants.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.role || '')}</td></tr>`).join('');
  return doc(`Convocation — ${m.title}`, `${header(s, 'Convocation', `<div class="muted">Le ${fmtDate(new Date().toISOString())}</div>`)}
    <p>Madame, Monsieur,</p>
    <p>Vous êtes convié(e) à la réunion <b>« ${esc(m.title)} »</b> qui se tiendra :</p>
    <div class="box"><b>${fmtLong(m.start)}</b> de ${fmtTime(m.start)} à ${fmtTime(m.end)}<br>${m.location ? `Lieu : ${esc(m.location)}<br>` : ''}${m.visio_url ? `Visioconférence : ${esc(m.visio_url)}` : ''}</div>
    ${m.objective ? `<p><b>Objet :</b> ${para(m.objective)}</p>` : ''}
    <h2>Ordre du jour</h2><table><tr><th>#</th><th>Point</th><th>Présenté par</th><th>Durée</th></tr>${items || '<tr><td colspan="4">À préciser</td></tr>'}</table>
    ${people ? `<h2>Participants convoqués</h2><table><tr><th>Nom</th><th>Fonction</th></tr>${people}</table>` : ''}
    <p>Votre présence est vivement souhaitée. En cas d’empêchement, merci d’en informer le secrétariat.</p>
    <div class="sign"><div>${esc(m.organizer || m.president || '')}<br>Organisateur</div><div>${esc(s.user_name || '')}<br>${esc(s.user_title || 'Secrétariat')}</div></div>`, s);
}

export function pvHtml(m, s) {
  const min = m.minutes || {};
  const people = (state) => m.participants.filter((p) => (p.presence || '') === state).map((p) => esc(p.name)).join(', ') || '—';
  const points = (min.points || []).map((p, i) => `<h2>${i + 1}. ${esc(p.title)}</h2>${p.discussion ? `<p>${para(p.discussion)}</p>` : ''}${p.decisions ? `<div class="dec"><b>Décision :</b> ${para(p.decisions)}</div>` : ''}`).join('');
  const actions = (min.actions || []).filter((a) => a.title).map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.owner || '')}</td><td>${a.due ? fmtDate(a.due) : ''}</td></tr>`).join('');
  return doc(`PV — ${m.title}`, `${header(s, 'Procès-verbal de réunion', `<span class="tag">${m.status === 'pv_valide' || m.status === 'pv_diffuse' ? 'Validé' : 'Projet'}</span>`)}
    <div class="box"><b>${esc(m.title)}</b><br>${fmtLong(m.start)}, de ${fmtTime(m.start)} à ${fmtTime(m.end)}${m.location ? ` — ${esc(m.location)}` : ''}</div>
    <table><tr><th style="width:24%">Présidence</th><td>${esc(m.president || '—')}</td></tr><tr><th>Secrétariat de séance</th><td>${esc(m.secretary || s.user_name || '—')}</td></tr>
    <tr><th>Présents</th><td>${people('present')}</td></tr><tr><th>Excusés</th><td>${people('excuse')}</td></tr><tr><th>Absents</th><td>${people('absent')}</td></tr></table>
    ${min.intro ? `<h2>Ouverture de la séance</h2><p>${para(min.intro)}</p>` : ''}
    ${points}
    ${actions ? `<h2>Relevé des actions</h2><table><tr><th>Action</th><th>Responsable</th><th>Échéance</th></tr>${actions}</table>` : ''}
    ${min.conclusion ? `<h2>Clôture</h2><p>${para(min.conclusion)}</p>` : ''}
    ${min.next_meeting ? `<p><b>Prochaine réunion :</b> ${fmtLong(min.next_meeting)}${min.next_meeting.length > 10 ? ` à ${fmtTime(min.next_meeting)}` : ''}</p>` : ''}
    ${m.pv_validated_by ? `<div class="box">Procès-verbal validé par <b>${esc(m.pv_validated_by)}</b>${m.pv_validated_at ? ` le ${fmtDate(m.pv_validated_at)}` : ''}.${m.pv_remarks ? `<br>Observations : ${para(m.pv_remarks)}` : ''}</div>` : ''}
    <div class="sign"><div>Le/La Président(e) de séance<br><b>${esc(m.president || '')}</b></div><div>Le/La Secrétaire de séance<br><b>${esc(m.secretary || s.user_name || '')}</b></div></div>`, s);
}

export function dayHtml(day, events, tasks, s) {
  const rows = events.map((e) => `<div class="ev"><div class="h">${e.all_day ? 'Journée' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}</div><div class="bar" style="background:#5a48e6"></div><div><b>${esc(e.title)}</b> <span class="tag">${TYPES[e.type] || ''}</span><br><span class="muted">${esc(e.location || '')}${e.first_name || e.last_name ? ` · ${esc(contactName(e))}` : ''}</span>${e.description ? `<br>${para(e.description)}` : ''}</div></div>`).join('');
  const t = tasks.map((x) => `<tr><td>☐ ${esc(x.title)}</td><td>${esc(x.assignee || '')}</td><td>${x.due ? fmtDate(x.due) : ''}</td></tr>`).join('');
  return doc(`Agenda du ${day}`, `${header(s, `Agenda — ${fmtLong(day)}`, `<div class="muted">${esc(s.manager_name ? `Pour ${s.manager_name}` : '')}</div>`)}
    ${rows || '<p class="muted">Aucun rendez-vous.</p>'}
    ${t ? `<h2>Tâches du jour</h2><table><tr><th>Tâche</th><th>Responsable</th><th>Échéance</th></tr>${t}</table>` : ''}
    <p class="muted" style="margin-top:30px">Imprimé le ${new Date().toLocaleString('fr-FR')}</p>`, s);
}

export function registerHtml(rows, title, s) {
  const tr = rows.map((c) => `<tr><td>${esc(c.number)}</td><td>${fmtDate(c.date)}</td><td>${esc(c.correspondent)}</td><td>${esc(c.object)}</td><td>${esc(c.reference || '')}</td><td>${esc(c.assigned_to || '')}</td><td>${(COURRIER_STATUS[c.status] || [c.status])[0]}</td></tr>`).join('');
  return doc(title, `${header(s, title, `<div class="muted">${rows.length} enregistrement(s)</div>`)}<table><tr><th>N°</th><th>Date</th><th>Correspondant</th><th>Objet</th><th>Réf.</th><th>Attribué à</th><th>Statut</th></tr>${tr}</table>`, s);
}

// Feuille de présence (émargement) à faire signer en séance.
export function attendanceHtml(m, s) {
  const rows = [...m.participants, ...Array.from({ length: Math.max(4, 12 - m.participants.length) }, () => ({ name: '', role: '' }))];
  return doc(`Feuille de présence — ${m.title}`, `${header(s, 'Feuille de présence', `<div class="muted">Réunion du ${fmtDate(m.start)}</div>`)}
    <div class="box"><b>${esc(m.title)}</b><br>${fmtLong(m.start)}, de ${fmtTime(m.start)} à ${fmtTime(m.end)}${m.location ? ` — ${esc(m.location)}` : ''}</div>
    <table class="sheet"><tr><th style="width:30px">N°</th><th>Nom et prénom</th><th>Fonction / organisme</th><th>Arrivée</th><th>Émargement</th></tr>
    ${rows.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.role || '')}</td><td style="width:60px"></td><td class="sig"></td></tr>`).join('')}</table>
    <p class="muted">Nombre de participants : ……  ·  Le/La secrétaire de séance : ${esc(m.secretary || s.user_name || '')}</p>`, s);
}

// Lettre sur papier à en-tête (courrier départ).
export function letterHtml(l, s) {
  const date = l.date || new Date().toISOString().slice(0, 10);
  return doc(l.object || 'Lettre', `<div class="letter">${header(s, '')}
    <div class="row" style="display:flex;justify-content:space-between;margin-top:6px"><div class="muted">${l.number ? `N° ${esc(l.number)}` : ''}${l.our_ref ? `<br>N/Réf. : ${esc(l.our_ref)}` : ''}${l.your_ref ? `<br>V/Réf. : ${esc(l.your_ref)}` : ''}</div>
    <div>${esc(s.org_city || '')}${s.org_city ? ', ' : ''}le ${fmtDate(date)}</div></div>
    <div class="to">${para(l.recipient || '')}</div>
    <div class="obj"><b>Objet :</b> ${esc(l.object || '')}${l.attachments ? `<br><b>P.J. :</b> ${esc(l.attachments)}` : ''}</div>
    <p>${esc(l.salutation || 'Madame, Monsieur,')}</p>
    ${String(l.body || '').split(/\n{2,}/).map((pp) => `<p>${para(pp)}</p>`).join('')}
    <p>${para(l.closing || 'Veuillez agréer, Madame, Monsieur, l’expression de nos salutations distinguées.')}</p>
    <div class="sigblk">${para(l.signatory || s.letter_signatory || s.manager_name || '')}<div style="height:70px"></div></div>
    ${l.copies ? `<p class="muted" style="margin-top:30px">Copie(s) : ${esc(l.copies)}</p>` : ''}</div>`, s);
}

// Rapport mensuel d'activité.
export function reportHtml(r, s) {
  const k = r.kpi;
  const p = r.prev;
  const mt = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const line = (label, a, b) => `<tr><td>${label}</td><td style="text-align:right"><b>${a}</b></td><td style="text-align:right">${b === null || b === undefined ? '—' : b}</td></tr>`;
  return doc(`Rapport d’activité — ${mt(r.month)}`, `${header(s, `Rapport d’activité — ${mt(r.month)}`, `<div class="muted">${esc(s.manager_name ? `À l’attention de ${s.manager_name}` : '')}</div>`)}
    <div class="kpis"><div><b>${k.meetings}</b><span>réunions tenues</span></div><div><b>${k.rdv}</b><span>rendez-vous</span></div><div><b>${k.courrierIn}</b><span>courriers reçus</span></div><div><b>${k.calls}</b><span>appels reçus</span></div>
    <div><b>${k.pvValidated}</b><span>PV validés</span></div><div><b>${k.courrierOut}</b><span>courriers envoyés</span></div><div><b>${k.tasksDone}</b><span>tâches terminées</span></div><div><b>${r.delay === null ? '—' : `${String(r.delay).replace('.', ',')} j`}</b><span>délai moyen de traitement du courrier</span></div></div>
    <h2>Indicateurs</h2><table><tr><th>Indicateur</th><th style="text-align:right">${mt(r.month)}</th><th style="text-align:right">${mt(r.prevMonth)}</th></tr>
    ${line('Réunions tenues', k.meetings, p.meetings)}${line('Procès-verbaux validés', k.pvValidated, p.pvValidated)}${line('Procès-verbaux diffusés', k.pvSent, p.pvSent)}
    ${line('Rendez-vous', k.rdv, null)}${line('Heures planifiées à l’agenda', String(k.hours).replace('.', ','), null)}${line('Courriers reçus', k.courrierIn, p.courrierIn)}${line('dont traités', k.courrierTreated, p.courrierTreated)}
    ${line('Courriers envoyés', k.courrierOut, p.courrierOut)}${line('Appels reçus', k.calls, p.calls)}${line('Appels rappelés', k.callsBack, p.callsBack)}${line('Tâches terminées', k.tasksDone, p.tasksDone)}${line('E-mails envoyés', k.mailsSent, p.mailsSent)}${line('E-mails reçus', k.mailsIn, p.mailsIn)}</table>
    <h2>Activité par semaine</h2><table><tr><th>Semaine</th><th>Rendez-vous</th><th>Réunions</th><th>Courriers</th><th>Appels</th></tr>${r.weeks.map((w) => `<tr><td>${fmtDate(w.from)} – ${fmtDate(w.to)}</td><td>${w.rdv}</td><td>${w.meetings}</td><td>${w.courrier}</td><td>${w.calls}</td></tr>`).join('')}</table>
    ${r.meetings.length ? `<h2>Réunions du mois</h2><table><tr><th>Date</th><th>Réunion</th></tr>${r.meetings.map((m) => `<tr><td>${fmtDate(m.start)}</td><td>${esc(m.title)}</td></tr>`).join('')}</table>` : ''}
    ${r.lateTasks.length ? `<h2>Actions en retard (${r.lateCount})</h2><table><tr><th>Action</th><th>Responsable</th><th>Échéance</th></tr>${r.lateTasks.map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.assignee || '')}</td><td>${fmtDate(t.due)}</td></tr>`).join('')}</table>` : ''}
    <p class="muted" style="margin-top:24px">Établi le ${new Date().toLocaleDateString('fr-FR')} par ${esc(s.user_name || '')}${s.user_title ? `, ${esc(s.user_title)}` : ''}.</p>`, s);
}

export const printHtml = (html) => call('print.html', html);
export const savePdf = (html, name) => call('print.pdf', html, name);
export { fmtDateTime };
