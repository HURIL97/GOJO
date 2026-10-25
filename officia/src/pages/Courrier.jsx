import { useEffect, useState } from 'react';
import { Plus, Download, Printer, Inbox, Send, Paperclip, FileText, Search } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtShort, localDay, COURRIER_STATUS, COURRIER_MODE } from '../lib/format';
import { Tabs, Card, StatusBadge, Empty, Select } from '../components/ui';
import { registerHtml, printHtml } from '../lib/print';

export default function Courrier() {
  const { open, nav, settings } = useApp();
  const [direction, setDirection] = useState('arrivee');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [year, setYear] = useState(localDay().slice(0, 4));
  const [rows] = useData('courrier.list', [{ direction, status, q, year }], [direction, status, q, year]);
  const [all] = useData('courrier.list', [{ year }], [year]);
  useEffect(() => { if (nav.id) call('db.get', 'courrier', nav.id).then((c) => c && open('courrier', c)).catch(() => {}); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = rows || [];
  const t = localDay();
  const s = (dir, st) => (all || []).filter((c) => c.direction === dir && (!st || st.includes(c.status))).length;
  const label = direction === 'arrivee' ? 'Registre du courrier arrivée' : 'Registre du courrier départ';
  const exportRows = list.map((c) => ({ Numero: c.number, Date: c.date, Correspondant: c.correspondent, Objet: c.object, Reference: c.reference || '', Mode: COURRIER_MODE[c.mode] || c.mode, AttribueA: c.assigned_to || '', Statut: (COURRIER_STATUS[c.status] || [c.status])[0], Echeance: c.due || '' }));
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <div className="card kpi"><div className="label"><span className="ico"><Inbox size={16} /></span>Courriers reçus</div><div className="value">{s('arrivee')}</div><div className="delta">en {year}</div></div>
        <div className="card kpi"><div className="label"><span className="ico"><Send size={16} /></span>Courriers envoyés</div><div className="value">{s('depart')}</div><div className="delta">en {year}</div></div>
        <div className="card kpi"><div className="label">À traiter</div><div className="value" style={{ color: 'var(--warn)' }}>{s('arrivee', ['enregistre', 'en_traitement'])}</div><div className="delta">courriers arrivée en attente</div></div>
        <div className="card kpi"><div className="label">Échéance dépassée</div><div className="value" style={{ color: 'var(--bad)' }}>{(all || []).filter((c) => c.due && c.due < t && ['enregistre', 'en_traitement'].includes(c.status)).length}</div><div className="delta">réponse attendue</div></div>
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs value={direction} onChange={setDirection} tabs={[['arrivee', 'Arrivée', Inbox], ['depart', 'Départ', Send]]} />
        <div className="search" style={{ width: 280 }}><Search size={16} /><input className="input" placeholder="N°, correspondant, objet…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ width: 170 }}><Select value={status} onChange={setStatus} placeholder="Tous statuts" options={Object.entries(COURRIER_STATUS).map(([k, [l]]) => [k, l])} /></div>
        <div style={{ width: 100 }}><Select value={year} onChange={setYear} options={[0, 1, 2, 3].map((i) => String(Number(localDay().slice(0, 4)) - i))} /></div>
        <div className="grow" />
        <button className="btn" onClick={() => printHtml(registerHtml(list, `${label} — ${year}`, settings))}><Printer size={16} /></button>
        <button className="btn" onClick={() => call('export.csv', `courrier-${direction}-${year}`, exportRows)}><Download size={16} />Excel</button>
        <button className="btn primary" onClick={() => open('courrier', { direction })}><Plus size={16} />Enregistrer</button>
      </div>
      <Card title={label} hint={`${list.length} enregistrement(s) · numérotation automatique`}>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 420px)' }}>
          <table className="tbl">
            <thead><tr><th>N° d’ordre</th><th>Date</th><th>{direction === 'arrivee' ? 'Expéditeur' : 'Destinataire'}</th><th>Objet</th><th>Réf.</th><th>Mode</th><th>Attribué à</th><th>Échéance</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="click" onClick={() => open('courrier', c)}>
                  <td style={{ whiteSpace: 'nowrap' }}><b className="num">{c.number}</b></td><td style={{ whiteSpace: 'nowrap' }}>{fmtShort(c.date)}</td><td className="strong">{c.correspondent}</td><td>{c.object}</td>
                  <td className="muted small">{c.reference}</td><td className="muted">{COURRIER_MODE[c.mode] || c.mode}</td><td>{c.assigned_to}</td>
                  <td className={c.due && c.due < t && ['enregistre', 'en_traitement'].includes(c.status) ? 'neg-val' : ''}>{c.due ? fmtShort(c.due) : ''}</td>
                  <td><StatusBadge map={COURRIER_STATUS} value={c.status} /></td>
                  <td>{c.attachment ? <button className="btn ghost sm icon" title="Ouvrir la pièce numérisée" onClick={(e) => { e.stopPropagation(); act(() => call('file.open', c.attachment)); }}><Paperclip size={14} /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !list.length && <Empty icon={FileText}>Aucun courrier enregistré</Empty>}
        </div>
      </Card>
    </div>
  );
}
