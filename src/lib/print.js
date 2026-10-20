// Gabarits d'impression : facture de séjour (A4), ticket de caisse (80 mm), bon de commande, rapport Z.
import { call } from './api';
import { money, fmtDate, fmtDateTime, METHODS, num, guestName } from './format';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const A4 = `
  body{font-family:'Segoe UI',Arial,sans-serif;color:#111;margin:40px;font-size:13px}
  h1{font-size:26px;margin:0}.muted{color:#666}.r{text-align:right}
  table{width:100%;border-collapse:collapse;margin-top:18px}th{background:#f2f4f8;text-align:left;padding:9px;font-size:12px;text-transform:uppercase}
  td{padding:9px;border-bottom:1px solid #e6e8ee}.tot td{border:0;padding:5px 9px}.grand td{font-size:17px;font-weight:700;border-top:2px solid #111}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #3b6cf6;padding-bottom:18px}
  .box{background:#f7f8fb;border-radius:8px;padding:14px;margin-top:18px;display:flex;justify-content:space-between}
  .foot{margin-top:40px;text-align:center;color:#666;font-size:12px}`;

const TICKET = `
  @page{size:80mm auto;margin:0}body{font-family:'Consolas','Courier New',monospace;width:72mm;margin:4mm;font-size:12px;color:#000}
  .c{text-align:center}.r{text-align:right}h2{margin:0 0 4px;font-size:16px}table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}.sep{border-top:1px dashed #000;margin:6px 0}.big{font-size:16px;font-weight:700}`;

function header(s) {
  return `<div><h1>${esc(s.hotel_name)}</h1><div class="muted">${esc(s.address)}<br>${esc(s.phone)} ${esc(s.email)}<br>${s.tax_id ? `N° contribuable : ${esc(s.tax_id)}` : ''}</div></div>`;
}

export function invoiceHtml(f, s) {
  const vat = Number(s.vat_rate) || 0;
  const ht = f.total / (1 + vat / 100);
  const rows = f.lines.map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.label)}</td><td class="r">${num(l.qty, true)}</td><td class="r">${money(l.unit_price)}</td><td class="r">${money(l.amount)}</td></tr>`).join('');
  const pays = f.payments.map((p) => `<tr class="tot"><td colspan="4" class="r">Règlement ${esc(METHODS[p.method] || p.method)} du ${fmtDate(p.date)}</td><td class="r">- ${money(p.amount)}</td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>${A4}</style></head><body>
  <div class="head">${header(s)}<div class="r"><h1>FACTURE</h1><div>N° ${esc(f.reservation.code)}</div><div class="muted">Émise le ${fmtDate(new Date().toISOString())}</div></div></div>
  <div class="box"><div><b>Client</b><br>${esc(guestName(f.guest || {}))}<br>${esc(f.guest?.company || '')}<br>${esc(f.guest?.phone || '')}</div>
  <div class="r"><b>Séjour</b><br>Chambre ${esc(f.room?.number || '')} — ${esc(f.room?.type_name || '')}<br>Du ${fmtDate(f.reservation.check_in)} au ${fmtDate(f.reservation.check_out)}<br>${f.nights} nuit(s)</div></div>
  <table><thead><tr><th>Date</th><th>Désignation</th><th class="r">Qté</th><th class="r">P.U.</th><th class="r">Montant</th></tr></thead><tbody>${rows}
  <tr class="tot"><td colspan="4" class="r">Total HT</td><td class="r">${money(ht)}</td></tr>
  <tr class="tot"><td colspan="4" class="r">TVA ${vat} %</td><td class="r">${money(f.total - ht)}</td></tr>
  <tr class="grand"><td colspan="4" class="r">Total TTC</td><td class="r">${money(f.total)}</td></tr>${pays}
  <tr class="grand"><td colspan="4" class="r">Reste à payer</td><td class="r">${money(f.balance)}</td></tr></tbody></table>
  <div class="foot">${esc(s.invoice_footer)}</div></body></html>`;
}

export function receiptHtml(o, s, extra = {}) {
  const vat = Number(s.vat_rate) || 0;
  const lines = o.items.map((i) => `<tr><td>${num(i.qty, true)} × ${esc(i.name)}</td><td class="r">${money(i.amount)}</td></tr>`).join('');
  const pays = (o.payments || []).map((p) => `<tr><td>${esc(METHODS[p.method] || p.method)}</td><td class="r">${money(p.amount)}</td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>${TICKET}</style></head><body>
  <div class="c"><h2>${esc(s.hotel_name)}</h2>${esc(s.address)}<br>${esc(s.phone)}</div><div class="sep"></div>
  Ticket ${esc(o.number)}<br>${o.table ? `Table ${esc(o.table.name)} · ` : ''}${fmtDateTime(o.closed_at || o.opened_at)}<br>${extra.server ? `Servi par ${esc(extra.server)}` : ''}
  <div class="sep"></div><table>${lines}</table><div class="sep"></div>
  <table>${o.discount ? `<tr><td>Remise</td><td class="r">- ${money(o.discount)}</td></tr>` : ''}
  <tr class="big"><td>TOTAL</td><td class="r">${money(o.total)}</td></tr>
  <tr><td>dont TVA ${vat} %</td><td class="r">${money(o.total - o.total / (1 + vat / 100))}</td></tr></table>
  ${pays ? `<div class="sep"></div><table>${pays}${extra.change ? `<tr><td>Rendu</td><td class="r">${money(extra.change)}</td></tr>` : ''}</table>` : ''}
  ${o.status === 'chambre' ? '<div class="sep"></div><div class="c">Porté sur la note de chambre<br><br>Signature :</div>' : ''}
  ${o.status === 'ouverte' ? '<div class="sep"></div><div class="c big">ADDITION — NON PAYÉE</div>' : ''}
  <div class="sep"></div><div class="c">${esc(s.invoice_footer)}</div></body></html>`;
}

export function kitchenHtml(o, items) {
  const lines = items.map((i) => `<tr><td class="big">${num(i.qty, true)} ×</td><td class="big">${esc(i.name)}${i.note ? `<br><i>→ ${esc(i.note)}</i>` : ''}</td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>${TICKET}</style></head><body>
  <div class="c"><h2>BON ${o.outlet === 'bar' ? 'BAR' : 'CUISINE'}</h2>${o.table ? `TABLE ${esc(o.table.name)}` : esc(o.customer || 'Comptoir')} · ${o.covers || 1} couvert(s)<br>${new Date().toLocaleTimeString('fr-FR')}</div>
  <div class="sep"></div><table>${lines}</table><div class="sep"></div><div class="c">${esc(o.number)}</div></body></html>`;
}

export function zHtml(z, s) {
  const rows = (obj, map = {}) => Object.entries(obj).map(([k, v]) => `<tr><td>${esc(map[k] || k)}</td><td class="r">${money(v)}</td></tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>${TICKET}</style></head><body>
  <div class="c"><h2>${esc(s.hotel_name)}</h2><b>RAPPORT Z — CLÔTURE</b><br>${fmtDate(z.day)}</div><div class="sep"></div>
  <b>Par mode de paiement</b><table>${rows(z.byMethod, METHODS)}</table><div class="sep"></div>
  <b>Par activité</b><table>${rows(z.bySource, { hotel: 'Hôtel', bar: 'Bar', restaurant: 'Restaurant' })}</table><div class="sep"></div>
  <table><tr class="big"><td>TOTAL ENCAISSÉ</td><td class="r">${money(z.total)}</td></tr>
  <tr><td>Dépenses en espèces</td><td class="r">- ${money(z.cashExpenses)}</td></tr>
  <tr class="big"><td>ESPÈCES EN CAISSE</td><td class="r">${money(z.cashInDrawer)}</td></tr></table>
  <div class="sep"></div>${z.cancelled.length} commande(s) annulée(s)<br>${z.payments} encaissement(s)<div class="sep"></div>
  <div class="c">Imprimé le ${new Date().toLocaleString('fr-FR')}</div></body></html>`;
}

export const printHtml = (html, opts = {}) => call('print.html', html, opts);
