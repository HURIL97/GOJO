// Gabarits d'impression et de PDF : convocation, procès-verbal, agenda du jour, registre du courrier.
import { call } from './api';
import { fmtLong, fmtDate, fmtTime, fmtDateTime, TYPES, COURRIER_STATUS, contactName } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const para = (s) => esc(s).replace(/\n/g, '<br>');

const CSS = `
  @page { size: A4; margin: 18mm 18mm 20mm;
    @bottom-left { content: "Document établi avec OfficiaTech v1.00"; font: 7.5pt 'Segoe UI', Arial, sans-serif; color: #9ca3af; }
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
`;
const doc = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
const header = (s, title, right = '') => `<div class="head"><div><div class="org">${esc(s.organisation || 'Secrétariat')}</div><div class="muted">${esc(s.org_address || '')} ${esc(s.org_phone || '')}</div></div><div style="text-align:right">${right}</div></div><h1>${esc(title)}</h1>`;
const presenceLabel = { present: 'Présent(e)', excuse: 'Excusé(e)', absent: 'Absent(e)', '': '—' };

export function convocationHtml(m, s) {
  const items = m.agenda.map((a, i) => `<tr><td style="width:30px">${i + 1}</td><td>${esc(a.title)}</td><td>${esc(a.presenter || '')}</td><td>${a.duration ? `${a.duration} min` : ''}</td></tr>`).join('');
  const people = m.participants.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.role || '')}</td></tr>`).join('');
  return doc(`Convocation — ${m.title}`, `${header(s, 'Convocation', `<div class="muted">Le ${fmtDate(new Date().toISOString())}</div>`)}
    <p>Madame, Monsieur,</p>
    <p>Vous êtes convié(e) à la réunion <b>« ${esc(m.title)} »</b> qui se tiendra :</p>
    <div class="box"><b>${fmtLong(m.start)}</b> de ${fmtTime(m.start)} à ${fmtTime(m.end)}<br>${m.location ? `Lieu : ${esc(m.location)}<br>` : ''}${m.visio_url ? `Visioconférence : ${esc(m.visio_url)}` : ''}</div>
    ${m.objective ? `<p><b>Objet :</b> ${para(m.objective)}</p>` : ''}
    <h2>Ordre du jour</h2><table><tr><th>#</th><th>Point</th><th>Présenté par</th><th>Durée</th></tr>${items || '<tr><td colspan="4">À préciser</td></tr>'}</table>
    ${people ? `<h2>Participants convoqués</h2><table><tr><th>Nom</th><th>Fonction</th></tr>${people}</table>` : ''}
    <p>Votre présence est vivement souhaitée. En cas d’empêchement, merci d’en informer le secrétariat.</p>
    <div class="sign"><div>${esc(m.organizer || m.president || '')}<br>Organisateur</div><div>${esc(s.user_name || '')}<br>${esc(s.user_title || 'Secrétariat')}</div></div>`);
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
    <div class="sign"><div>Le/La Président(e) de séance<br><b>${esc(m.president || '')}</b></div><div>Le/La Secrétaire de séance<br><b>${esc(m.secretary || s.user_name || '')}</b></div></div>`);
}

export function dayHtml(day, events, tasks, s) {
  const rows = events.map((e) => `<div class="ev"><div class="h">${e.all_day ? 'Journée' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}</div><div class="bar" style="background:#5a48e6"></div><div><b>${esc(e.title)}</b> <span class="tag">${TYPES[e.type] || ''}</span><br><span class="muted">${esc(e.location || '')}${e.first_name || e.last_name ? ` · ${esc(contactName(e))}` : ''}</span>${e.description ? `<br>${para(e.description)}` : ''}</div></div>`).join('');
  const t = tasks.map((x) => `<tr><td>☐ ${esc(x.title)}</td><td>${esc(x.assignee || '')}</td><td>${x.due ? fmtDate(x.due) : ''}</td></tr>`).join('');
  return doc(`Agenda du ${day}`, `${header(s, `Agenda — ${fmtLong(day)}`, `<div class="muted">${esc(s.manager_name ? `Pour ${s.manager_name}` : '')}</div>`)}
    ${rows || '<p class="muted">Aucun rendez-vous.</p>'}
    ${t ? `<h2>Tâches du jour</h2><table><tr><th>Tâche</th><th>Responsable</th><th>Échéance</th></tr>${t}</table>` : ''}
    <p class="muted" style="margin-top:30px">Imprimé le ${new Date().toLocaleString('fr-FR')}</p>`);
}

export function registerHtml(rows, title, s) {
  const tr = rows.map((c) => `<tr><td>${esc(c.number)}</td><td>${fmtDate(c.date)}</td><td>${esc(c.correspondent)}</td><td>${esc(c.object)}</td><td>${esc(c.reference || '')}</td><td>${esc(c.assigned_to || '')}</td><td>${(COURRIER_STATUS[c.status] || [c.status])[0]}</td></tr>`).join('');
  return doc(title, `${header(s, title, `<div class="muted">${rows.length} enregistrement(s)</div>`)}<table><tr><th>N°</th><th>Date</th><th>Correspondant</th><th>Objet</th><th>Réf.</th><th>Attribué à</th><th>Statut</th></tr>${tr}</table>`);
}

export const printHtml = (html) => call('print.html', html);
export const savePdf = (html, name) => call('print.pdf', html, name);
export { fmtDateTime };
