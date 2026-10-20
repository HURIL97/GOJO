import { useState } from 'react';
import { Wallet, Printer, Download, Lock } from 'lucide-react';
import { call } from '../lib/api';
import { useData } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, fmtDateTime, localDay, METHODS } from '../lib/format';
import { Card, Select, Empty, Badge, Tabs } from '../components/ui';
import { Donut, cssVar } from '../components/charts';
import { zHtml, printHtml } from '../lib/print';

const SOURCES = { hotel: 'Hôtel', restaurant: 'Restaurant', bar: 'Bar' };

function ZReport() {
  const { settings } = useApp();
  const [day, setDay] = useState(localDay());
  const [z] = useData('cash.z', [day], [day]);
  if (!z) return null;
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
      <Card title="Clôture de caisse (Z)" hint="Synthèse de la journée" right={<button className="btn primary sm" onClick={() => printHtml(zHtml(z, settings))}><Printer size={14} />Imprimer</button>}>
        <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
        <div className="list-row mt"><span>Total encaissé</span><b className="right num">{money(z.total)}</b></div>
        <div className="list-row"><span>Dépenses payées en espèces</span><b className="right num neg-val">- {money(z.cashExpenses)}</b></div>
        <div className="list-row"><span className="strong">Espèces attendues en caisse</span><b className="right num" style={{ fontSize: 20 }}>{money(z.cashInDrawer)}</b></div>
        <div className="list-row"><span>Nombre d’encaissements</span><b className="right">{z.payments}</b></div>
        <div className="list-row"><span>Commandes annulées</span><Badge kind={z.cancelled.length ? 'bad' : 'good'}>{z.cancelled.length}</Badge></div>
        {z.cancelled.map((c) => <div key={c.number} className="muted small">{c.number} · {money(c.total)} · {c.user_name} — {c.cancel_reason}</div>)}
      </Card>
      <Card title="Par mode de paiement">
        <Donut height={190} labels={Object.keys(z.byMethod).map((k) => METHODS[k] || k)} data={Object.values(z.byMethod)} sub="encaissé" />
        {Object.entries(z.byMethod).map(([k, v], i) => <div key={k} className="list-row small"><i className="dot" style={{ background: cssVar(['--s-heb', '--s-resto', '--s-bar', '--s-svc', '--s-5'][i % 5]) }} />{METHODS[k] || k}<b className="right num">{money(v)}</b></div>)}
        {!Object.keys(z.byMethod).length && <Empty>Aucun encaissement</Empty>}
      </Card>
      <Card title="Par activité">
        <Donut height={190} labels={Object.keys(z.bySource).map((k) => SOURCES[k] || k)} data={Object.values(z.bySource)}
          colors={Object.keys(z.bySource).map((k) => cssVar(k === 'hotel' ? '--s-heb' : k === 'restaurant' ? '--s-resto' : '--s-bar'))} sub="encaissé" />
        {Object.entries(z.bySource).map(([k, v]) => <div key={k} className="list-row small">{SOURCES[k] || k}<b className="right num">{money(v)}</b></div>)}
      </Card>
    </div>
  );
}

function Journal() {
  const [from, setFrom] = useState(localDay());
  const [to, setTo] = useState(localDay());
  const [method, setMethod] = useState('');
  const [source, setSource] = useState('');
  const [rows] = useData('cash.payments', [{ from, to, method, source }], [from, to, method, source]);
  const total = (rows || []).reduce((s, p) => s + p.amount, 0);
  return (
    <Card>
      <div className="toolbar">
        <input type="date" className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">→</span>
        <input type="date" className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <div style={{ width: 180 }}><Select value={method} onChange={setMethod} placeholder="Tous modes" options={Object.entries(METHODS).filter(([k]) => k !== 'chambre')} /></div>
        <div style={{ width: 160 }}><Select value={source} onChange={setSource} placeholder="Toutes activités" options={Object.entries(SOURCES)} /></div>
        <div className="grow" />
        <b className="num" style={{ fontSize: 18 }}>{money(total)}</b>
        <button className="btn" onClick={() => call('export.csv', 'encaissements', (rows || []).map((p) => ({ Date: p.date, Montant: p.amount, Mode: METHODS[p.method], Activite: SOURCES[p.source], Reference: p.reference, Ticket: p.order_number, Sejour: p.reservation_code, Caissier: p.user_name })))}><Download size={16} />Excel</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 290px)' }}>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Activité</th><th>Pièce</th><th>Mode</th><th>Référence</th><th>Caissier</th><th className="r">Montant</th></tr></thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id}><td>{fmtDateTime(p.date)}</td><td><Badge>{SOURCES[p.source] || p.source}</Badge></td><td className="muted">{p.order_number || p.reservation_code}</td>
                <td>{METHODS[p.method] || p.method}</td><td className="muted">{p.reference}</td><td>{p.user_name}</td><td className="r num strong">{money(p.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty icon={Wallet}>Aucun encaissement</Empty>}
      </div>
    </Card>
  );
}

export default function Cash() {
  const [tab, setTab] = useState('z');
  return (
    <div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[['z', 'Clôture du jour', Lock], ['journal', 'Journal des encaissements', Wallet]]} /></div>
      {tab === 'z' ? <ZReport /> : <Journal />}
    </div>
  );
}
