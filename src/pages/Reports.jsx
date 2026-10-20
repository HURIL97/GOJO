import { useState } from 'react';
import { BarChart3, Download, ShieldCheck, FileSpreadsheet, Printer } from 'lucide-react';
import { call } from '../lib/api';
import { useData } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, num, pct, fmtDate, fmtShort, fmtDateTime, localDay, addDays } from '../lib/format';
import { Card, Tabs, Empty, Badge } from '../components/ui';
import { StackedBars, LegendRow, cssVar } from '../components/charts';
import { printHtml } from '../lib/print';

function Sales() {
  const { settings } = useApp();
  const [from, setFrom] = useState(`${localDay().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDay());
  const [r] = useData('reports.sales', [{ from, to }], [from, to]);
  if (!r) return null;
  const t = r.totals;
  const col = { heb: cssVar('--s-heb'), resto: cssVar('--s-resto'), bar: cssVar('--s-bar'), svc: cssVar('--s-svc') };
  const exportDaily = () => call('export.csv', 'ca-journalier', r.daily.map((d) => ({ Jour: d.day, Nuitees: d.nights, Hebergement: d.hebergement, Restaurant: d.restaurant, Bar: d.bar, Services: d.services, Total: d.total })));
  const exportProducts = () => call('export.csv', 'ventes-articles', r.products.map((p) => ({ Article: p.name, Categorie: p.category, PointDeVente: p.outlet, Quantite: p.qty, CA: p.amount, Cout: p.cost, Marge: p.amount - p.cost })));
  const printReport = () => {
    const rows = r.daily.map((d) => `<tr><td>${fmtDate(d.day)}</td><td class="r">${d.nights}</td><td class="r">${money(d.hebergement)}</td><td class="r">${money(d.restaurant)}</td><td class="r">${money(d.bar)}</td><td class="r">${money(d.services)}</td><td class="r"><b>${money(d.total)}</b></td></tr>`).join('');
    printHtml(`<html><head><meta charset="utf-8"><style>body{font-family:Segoe UI,Arial;margin:30px;font-size:12px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}h1{margin:0}</style></head><body>
      <h1>${settings.hotel_name}</h1><h2>Rapport d’activité du ${fmtDate(from)} au ${fmtDate(to)}</h2>
      <table><tr><th>Jour</th><th class="r">Nuitées</th><th class="r">Hébergement</th><th class="r">Restaurant</th><th class="r">Bar</th><th class="r">Services</th><th class="r">Total</th></tr>${rows}
      <tr><th>Total</th><th class="r">${t.nights}</th><th class="r">${money(t.hebergement)}</th><th class="r">${money(t.restaurant)}</th><th class="r">${money(t.bar)}</th><th class="r">${money(t.services)}</th><th class="r">${money(t.total)}</th></tr></table></body></html>`, { pdf: true, title: `Rapport-${from}-${to}` });
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <input type="date" className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">→</span>
        <input type="date" className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn sm" onClick={() => { setFrom(addDays(localDay(), -6)); setTo(localDay()); }}>7 j</button>
        <button className="btn sm" onClick={() => { setFrom(`${localDay().slice(0, 7)}-01`); setTo(localDay()); }}>Mois</button>
        <button className="btn sm" onClick={() => { setFrom(`${localDay().slice(0, 4)}-01-01`); setTo(localDay()); }}>Année</button>
        <div className="grow" />
        <button className="btn" onClick={printReport}><Printer size={16} />PDF</button>
        <button className="btn" onClick={exportDaily}><FileSpreadsheet size={16} />CA journalier</button>
        <button className="btn" onClick={exportProducts}><Download size={16} />Ventes par article</button>
      </div>
      <div className="grid g4">
        {[['Hébergement', t.hebergement, col.heb, `${t.nights} nuitées`], ['Restaurant', t.restaurant, col.resto], ['Bar', t.bar, col.bar], ['Total', t.total, 'var(--accent)', `dont services ${money(t.services)}`]].map(([l, v, c, h]) => (
          <div key={l} className="card kpi"><div className="label"><i className="dot" style={{ background: c }} />{l}</div><div className="value num">{money(v)}</div><div className="delta">{h || `${t.total ? Math.round((v / t.total) * 100) : 0} % du total`}</div></div>
        ))}
      </div>
      <Card title="Chiffre d’affaires quotidien" right={<LegendRow items={[['Hébergement', col.heb], ['Restaurant', col.resto], ['Bar', col.bar], ['Services', col.svc]]} />}>
        <StackedBars height={260} labels={r.daily.map((d) => fmtShort(d.day))} series={[
          { label: 'Hébergement', data: r.daily.map((d) => d.hebergement), color: col.heb },
          { label: 'Restaurant', data: r.daily.map((d) => d.restaurant), color: col.resto },
          { label: 'Bar', data: r.daily.map((d) => d.bar), color: col.bar },
          { label: 'Services', data: r.daily.map((d) => d.services), color: col.svc },
        ]} />
      </Card>
      <Card title="Ventes par article" hint="Bar et restaurant, marges incluses">
        <div className="table-wrap" style={{ maxHeight: 460 }}>
          <table className="tbl">
            <thead><tr><th>Article</th><th>Catégorie</th><th>Point de vente</th><th className="r">Qté</th><th className="r">CA</th><th className="r">Coût</th><th className="r">Marge</th><th className="r">Taux</th></tr></thead>
            <tbody>
              {r.products.map((p, i) => (
                <tr key={i}><td className="strong">{p.name}</td><td className="muted">{p.category}</td><td><Badge>{p.outlet === 'bar' ? 'Bar' : 'Restaurant'}</Badge></td>
                  <td className="r num">{num(p.qty, true)}</td><td className="r num strong">{money(p.amount)}</td><td className="r num muted">{money(p.cost)}</td>
                  <td className="r num pos-val">{money(p.amount - p.cost)}</td><td className="r num">{pct(p.amount ? ((p.amount - p.cost) / p.amount) * 100 : 0)}</td></tr>
              ))}
            </tbody>
          </table>
          {!r.products.length && <Empty icon={BarChart3}>Aucune vente</Empty>}
        </div>
      </Card>
    </div>
  );
}

function Audit() {
  const [rows] = useData('reports.audit');
  return (
    <Card title="Journal d’audit" hint="Traçabilité de toutes les opérations sensibles (annulations, encaissements, check-in/out…)">
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th></tr></thead>
          <tbody>
            {(rows || []).map((a) => (
              <tr key={a.id}><td>{fmtDateTime(a.date)}</td><td>{a.user_name || '—'}</td><td><Badge kind={/annul/.test(a.action) ? 'bad' : ''}>{a.action}</Badge></td><td className="muted">{a.entity}</td><td className="muted small">{a.details}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  return (
    <div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[['sales', 'Activité & ventes', BarChart3], ['audit', 'Journal d’audit', ShieldCheck]]} /></div>
      {tab === 'sales' ? <Sales /> : <Audit />}
    </div>
  );
}
