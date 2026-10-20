import { useMemo, useState } from 'react';
import {
  TrendingUp, Wallet, BedDouble, Percent, Receipt, Users, AlertTriangle, LogIn, LogOut, ClipboardList,
  Sparkles, Activity, CalendarRange, Coins, PiggyBank, Package, UtensilsCrossed,
} from 'lucide-react';
import { useData } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, compact, pct, num, fmtShort, localDay, addDays, METHODS, guestName, fmtDateTime } from '../lib/format';
import { Card, Delta, Badge, Empty, Tabs } from '../components/ui';
import { StackedBars, Lines, Donut, Bars, Spark, LegendRow, cssVar } from '../components/charts';

const RANGES = [
  ['today', 'Aujourd’hui'], ['7', '7 jours'], ['30', '30 jours'], ['month', 'Ce mois'], ['90', '90 jours'], ['year', 'Cette année'],
];
function rangeOf(k) {
  const t = localDay();
  if (k === 'today') return { from: t, to: t };
  if (k === 'month') return { from: `${t.slice(0, 7)}-01`, to: t };
  if (k === 'year') return { from: `${t.slice(0, 4)}-01-01`, to: t };
  return { from: addDays(t, -(Number(k) - 1)), to: t };
}
const WD = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function Kpi({ icon: Icon, label, value, unit, cur, prev, invert, spark, color, hint }) {
  return (
    <div className="card kpi">
      <div className="label"><span className="ico" style={color ? { background: `${color}22`, color } : null}><Icon size={16} /></span>{label}</div>
      <div className="value num">{value}{unit && <small>{unit}</small>}</div>
      {prev !== undefined ? <Delta cur={cur} prev={prev} invert={invert} /> : <div className="delta">{hint}</div>}
      {spark && <Spark data={spark} color={color || cssVar('--accent')} />}
    </div>
  );
}

export default function Dashboard() {
  const { theme, setPage, settings } = useApp();
  const [range, setRange] = useState('30');
  const r = useMemo(() => rangeOf(range), [range]);
  const [d] = useData('dashboard.stats', [r], [r.from, r.to]);

  if (!d) return <div className="muted">Chargement du tableau de bord…</div>;
  const k = d.kpi;
  const col = { heb: cssVar('--s-heb'), resto: cssVar('--s-resto'), bar: cssVar('--s-bar'), svc: cssVar('--s-svc') };
  const labels = d.series.map((x) => fmtShort(x.day));
  const totalSeries = d.series.map((x) => x.total);
  const splitTotal = d.split.hebergement + d.split.restaurant + d.split.bar + d.split.services;
  const occSeries = d.series.map((x) => (d.rooms.total ? Math.round((x.nights / Math.max(1, d.rooms.total - d.rooms.maintenance)) * 100) : 0));
  const hours = Array.from({ length: 24 }, (_, h) => (d.hours.find((x) => x.h === h) || {}).t || 0);
  const firstHour = Math.max(0, hours.findIndex((v) => v > 0));
  const lastHour = 23 - Math.max(0, [...hours].reverse().findIndex((v) => v > 0));

  return (
    <div className="col" style={{ gap: 16 }} key={theme}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs tabs={RANGES} value={range} onChange={setRange} />
        <span className="muted small row"><CalendarRange size={14} /> {fmtShort(d.from)} → {fmtShort(d.to)} · comparé au {fmtShort(d.prevFrom)} → {fmtShort(d.prevTo)}</span>
      </div>

      {/* Bandeau principal */}
      <div className="grid" style={{ gridTemplateColumns: '1.35fr 1fr 1fr' }}>
        <div className="card hero">
          <div className="row between">
            <div className="label row muted"><Sparkles size={16} color="var(--accent)" /> Chiffre d’affaires de la période</div>
            <Badge kind="info">{d.span} jour{d.span > 1 ? 's' : ''}</Badge>
          </div>
          <div className="big num" style={{ margin: '10px 0 2px' }}>{money(k.revenue)}</div>
          <Delta cur={k.revenue} prev={k.prevRevenue} />
          <div className="meter mt" style={{ display: 'flex', gap: 2, background: 'transparent' }}>
            {[[d.split.hebergement, col.heb], [d.split.restaurant, col.resto], [d.split.bar, col.bar], [d.split.services, col.svc]].map(([v, c], i) => (
              <i key={i} style={{ width: `${splitTotal ? (v / splitTotal) * 100 : 0}%`, background: c }} />
            ))}
          </div>
          <div className="mt"><LegendRow items={[
            ['Hébergement', col.heb, ` ${compact(d.split.hebergement)}`], ['Restaurant', col.resto, ` ${compact(d.split.restaurant)}`],
            ['Bar', col.bar, ` ${compact(d.split.bar)}`], ['Services', col.svc, ` ${compact(d.split.services)}`],
          ]} /></div>
        </div>
        <div className="card">
          <div className="label row muted"><Activity size={16} color="var(--accent)" /> Aujourd’hui</div>
          <div className="row between mt">
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }} className="num">{money(k.todayRevenue)}</div>
              <Delta cur={k.todayRevenue} prev={k.yesterdayRevenue} suffix="vs hier" />
            </div>
          </div>
          <div className="grid g2 mt" style={{ gap: 10 }}>
            <div><div className="muted small">Clients en séjour</div><b style={{ fontSize: 18 }}>{k.guestsInHouse}</b> <span className="muted small">({k.inHouse} ch.)</span></div>
            <div><div className="muted small">Commandes ouvertes</div><b style={{ fontSize: 18 }}>{k.openOrders}</b> <span className="muted small">{compact(k.openOrdersTotal)}</span></div>
            <div><div className="muted small">Arrivées attendues</div><b style={{ fontSize: 18 }}>{d.arrivals.length}</b></div>
            <div><div className="muted small">Départs prévus</div><b style={{ fontSize: 18 }}>{d.departures.length}</b></div>
          </div>
        </div>
        <div className="card">
          <div className="label row muted"><BedDouble size={16} color="var(--accent)" /> État des chambres</div>
          <div className="row" style={{ gap: 16, marginTop: 6 }}>
            <div style={{ width: 150 }}>
              <Donut height={150} labels={['Libres', 'Occupées', 'À nettoyer', 'Maintenance']} data={[d.rooms.libre, d.rooms.occupee, d.rooms.sale, d.rooms.maintenance]}
                colors={[cssVar('--good'), cssVar('--accent'), cssVar('--warn'), cssVar('--bad')]} center={`${d.rooms.total ? Math.round((d.rooms.occupee / d.rooms.total) * 100) : 0} %`} sub="occupées" />
            </div>
            <div className="col" style={{ gap: 8, flex: 1 }}>
              {[['Libres', d.rooms.libre, '--good'], ['Occupées', d.rooms.occupee, '--accent'], ['À nettoyer', d.rooms.sale, '--warn'], ['Maintenance', d.rooms.maintenance, '--bad']].map(([l, v, c]) => (
                <div key={l} className="row between"><span className="row small"><i className="dot" style={{ background: `var(${c})` }} />{l}</span><b>{v}</b></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="grid g6">
        <Kpi icon={Percent} label="Taux d’occupation" value={pct(k.occupancy)} cur={k.occupancy} prev={k.prevOcc} spark={occSeries} color={col.heb} />
        <Kpi icon={Coins} label="Prix moyen (ADR)" value={compact(k.adr)} unit={settings.currency} cur={k.adr} prev={k.prevAdr} color={col.heb} />
        <Kpi icon={TrendingUp} label="RevPAR" value={compact(k.revpar)} unit={settings.currency} cur={k.revpar} prev={k.prevRevpar} color={col.heb} />
        <Kpi icon={Receipt} label="Ticket moyen F&B" value={compact(k.avgTicket)} unit={settings.currency} cur={k.avgTicket} prev={k.prevAvgTicket} color={col.resto} />
        <Kpi icon={Wallet} label="Encaissements" value={compact(k.cash)} unit={settings.currency} cur={k.cash} prev={k.prevCash} spark={totalSeries} color={col.bar} />
        <Kpi icon={PiggyBank} label="Résultat brut" value={compact(k.grossProfit)} unit={settings.currency} cur={k.grossProfit} prev={k.prevGrossProfit} color={cssVar('--good')} />
      </div>

      {/* Revenus et occupation */}
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <Card title="Chiffre d’affaires par activité" hint="Hébergement (nuitées vendues), restaurant, bar et services, par jour"
          right={<LegendRow items={[['Hébergement', col.heb], ['Restaurant', col.resto], ['Bar', col.bar], ['Services', col.svc]]} />}>
          <StackedBars height={300} labels={labels} series={[
            { label: 'Hébergement', data: d.series.map((x) => x.hebergement), color: col.heb },
            { label: 'Restaurant', data: d.series.map((x) => x.restaurant), color: col.resto },
            { label: 'Bar', data: d.series.map((x) => x.bar), color: col.bar },
            { label: 'Services', data: d.series.map((x) => x.services), color: col.svc },
          ]} />
        </Card>
        <Card title="Répartition des revenus" hint="Part de chaque activité sur la période">
          <Donut height={210} labels={['Hébergement', 'Restaurant', 'Bar', 'Services']} data={[d.split.hebergement, d.split.restaurant, d.split.bar, d.split.services]}
            colors={[col.heb, col.resto, col.bar, col.svc]} sub="total" />
          <div className="col mt" style={{ gap: 8 }}>
            {[['Hébergement', d.split.hebergement, col.heb], ['Restaurant', d.split.restaurant, col.resto], ['Bar', d.split.bar, col.bar], ['Services', d.split.services, col.svc]].map(([l, v, c]) => (
              <div key={l} className="row between small">
                <span className="row"><i className="dot" style={{ background: c }} />{l}</span>
                <span className="num"><b>{money(v)}</b> <span className="muted">{splitTotal ? Math.round((v / splitTotal) * 100) : 0} %</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Prévision d’occupation" hint="14 prochains jours, réservations confirmées incluses">
          <Lines height={220} percent labels={d.forecast.map((x) => fmtShort(x.day))} series={[{ label: 'Occupation', data: d.forecast.map((x) => x.occupancy), color: col.heb }]} />
        </Card>
        <Card title="Modes de paiement" hint="Encaissements de la période">
          {d.methods.length ? (
            <>
              <Donut height={170} labels={d.methods.map((m) => METHODS[m.method] || m.method)} data={d.methods.map((m) => m.t)} sub="encaissé" />
              <div className="col mt" style={{ gap: 6 }}>
                {d.methods.map((m, i) => (
                  <div key={m.method} className="row between small"><span className="row"><i className="dot" style={{ background: cssVar(['--s-heb', '--s-resto', '--s-bar', '--s-svc', '--s-5', '--s-6'][i % 6]) }} />{METHODS[m.method] || m.method}</span><b className="num">{money(m.t)}</b></div>
                ))}
              </div>
            </>
          ) : <Empty icon={Wallet}>Aucun encaissement</Empty>}
        </Card>
        <Card title="Rentabilité" hint="Recettes, coût des marchandises, dépenses">
          <div className="col" style={{ gap: 14 }}>
            {[
              ['Chiffre d’affaires', k.revenue, 'var(--accent)'],
              ['Coût marchandises vendues', k.cogs, 'var(--warn)'],
              ['Dépenses', k.expenses, 'var(--bad)'],
              ['Résultat brut', k.grossProfit, 'var(--good)'],
            ].map(([l, v, c]) => (
              <div key={l}>
                <div className="row between small"><span>{l}</span><b className="num">{money(v)}</b></div>
                <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${k.revenue ? Math.max(0, Math.min(100, (v / k.revenue) * 100)) : 0}%`, background: c }} /></div>
              </div>
            ))}
            <div className="grid g2" style={{ gap: 10 }}>
              <div className="card" style={{ padding: 12, boxShadow: 'none' }}><div className="muted small">Food cost</div><b style={{ fontSize: 18 }}>{pct(k.foodCost)}</b></div>
              <div className="card" style={{ padding: 12, boxShadow: 'none' }}><div className="muted small">Marge nette</div><b style={{ fontSize: 18 }}>{pct(k.revenue ? (k.grossProfit / k.revenue) * 100 : 0)}</b></div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Top 10 des ventes" hint="Bar et restaurant, en chiffre d’affaires" className="span2" style={{ gridColumn: 'span 2' }}>
          {d.topProducts.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>#</th><th>Article</th><th>Point de vente</th><th className="r">Qté</th><th className="r">CA</th><th className="r">Marge</th><th style={{ width: '24%' }}>Poids</th></tr></thead>
                <tbody>
                  {d.topProducts.map((p, i) => (
                    <tr key={p.name}>
                      <td className="muted">{i + 1}</td><td className="strong">{p.name}</td>
                      <td><Badge>{p.outlet === 'bar' ? 'Bar' : 'Restaurant'}</Badge></td>
                      <td className="r num">{num(p.qty)}</td><td className="r num strong">{money(p.amount)}</td>
                      <td className="r num pos-val">{pct(p.amount ? (p.margin / p.amount) * 100 : 0)}</td>
                      <td><div className="meter"><i style={{ width: `${(p.amount / d.topProducts[0].amount) * 100}%`, background: p.outlet === 'bar' ? col.bar : col.resto }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={UtensilsCrossed}>Aucune vente sur la période</Empty>}
        </Card>
        <Card title="Heures de pointe" hint="CA bar & restaurant par heure">
          <Bars height={150} labels={hours.slice(firstHour, lastHour + 1).map((_, i) => `${firstHour + i}h`)} data={hours.slice(firstHour, lastHour + 1)} label="CA" color={col.resto} />
          <div className="card-head" style={{ margin: '14px 0 8px' }}><h3>Par jour de la semaine</h3></div>
          <Bars height={130} labels={[1, 2, 3, 4, 5, 6, 0].map((w) => WD[w])} data={[1, 2, 3, 4, 5, 6, 0].map((w) => (d.weekdays.find((x) => x.wd === w) || {}).t || 0)} label="CA" color={col.bar} />
        </Card>
      </div>

      <div className="grid g4">
        <Card title="Arrivées" hint="À enregistrer aujourd’hui" right={<Badge kind="info">{d.arrivals.length}</Badge>}>
          {d.arrivals.length ? d.arrivals.slice(0, 6).map((a) => (
            <div key={a.id} className="list-row"><LogIn size={16} color="var(--good)" /><div style={{ flex: 1 }}><b>{guestName(a)}</b><div className="muted small">Ch. {a.room_number} · {a.code}</div></div><span className="small muted">{fmtShort(a.check_in)}</span></div>
          )) : <Empty icon={LogIn}>Aucune arrivée</Empty>}
          {d.arrivals.length > 0 && <button className="btn sm mt" onClick={() => setPage('hotel')}>Ouvrir l’hôtel</button>}
        </Card>
        <Card title="Départs" hint="À clôturer aujourd’hui" right={<Badge kind="warn">{d.departures.length}</Badge>}>
          {d.departures.length ? d.departures.slice(0, 6).map((a) => (
            <div key={a.id} className="list-row"><LogOut size={16} color="var(--warn)" /><div style={{ flex: 1 }}><b>{guestName(a)}</b><div className="muted small">Ch. {a.room_number} · {a.code}</div></div><span className="small muted">{fmtShort(a.check_out)}</span></div>
          )) : <Empty icon={LogOut}>Aucun départ</Empty>}
        </Card>
        <Card title="Alertes stock" hint={`Valeur du stock : ${money(k.stockValue)}`} right={<Badge kind={d.lowStock.length ? 'bad' : 'good'}>{d.lowStock.length}</Badge>}>
          {d.lowStock.length ? d.lowStock.slice(0, 6).map((p) => (
            <div key={p.name} className="list-row"><AlertTriangle size={16} color={p.stock <= 0 ? 'var(--bad)' : 'var(--warn)'} /><div style={{ flex: 1 }}><b>{p.name}</b><div className="muted small">Seuil {num(p.stock_min)} {p.unit}</div></div><Badge kind={p.stock <= 0 ? 'bad' : 'warn'}>{num(p.stock, true)}</Badge></div>
          )) : <Empty icon={Package}>Stocks au-dessus des seuils</Empty>}
        </Card>
        <Card title="Équipe" hint="Ventes F&B par serveur">
          {d.staff.length ? d.staff.map((s) => (
            <div key={s.name} className="list-row"><div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{s.name.slice(0, 2).toUpperCase()}</div><div style={{ flex: 1 }}><b>{s.name}</b><div className="muted small">{s.n} tickets</div></div><b className="num small">{compact(s.t)}</b></div>
          )) : <Empty icon={Users}>Aucune donnée</Empty>}
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Évolution occupation" hint="Taux d’occupation quotidien sur la période">
          <Lines height={200} percent labels={labels} series={[{ label: 'Occupation', data: occSeries, color: col.heb }]} />
        </Card>
        <Card title="Dépenses par catégorie" hint={`Total : ${money(k.expenses)}`}>
          {d.expenseCats.length ? <Bars height={200} horizontal labels={d.expenseCats.map((e) => e.category)} data={d.expenseCats.map((e) => e.t)} label="Dépenses" color={col.svc} /> : <Empty icon={Receipt}>Aucune dépense</Empty>}
        </Card>
        <Card title="Activité récente" hint="Journal des opérations">
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {d.recent.length ? d.recent.map((a) => (
              <div key={a.id} className="list-row small"><ClipboardList size={14} color="var(--muted)" /><div style={{ flex: 1 }}><b style={{ textTransform: 'capitalize' }}>{a.action}</b> <span className="muted">· {a.user_name || '—'}</span></div><span className="muted">{fmtDateTime(a.date)}</span></div>
            )) : <Empty>Aucune activité</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g4">
        <Kpi icon={BedDouble} label="Nuitées vendues" value={num(k.nights)} cur={k.nights} prev={k.prevNights} color={col.heb} />
        <Kpi icon={Receipt} label="Tickets bar & resto" value={num(k.tickets)} cur={k.tickets} prev={k.prevTickets} color={col.resto} />
        <Kpi icon={Users} label="Couverts servis" value={num(k.covers)} hint="Restaurant et bar" color={col.resto} />
        <Kpi icon={Wallet} label="Dépenses" value={compact(k.expenses)} unit={settings.currency} cur={k.expenses} prev={k.prevExpenses} invert color={cssVar('--bad')} />
      </div>
      {d.sources.length > 0 && (
        <Card title="Canaux de réservation" hint="Arrivées de la période par provenance">
          <div className="grid g6">
            {d.sources.map((s) => (
              <div key={s.source} className="card" style={{ boxShadow: 'none', padding: 12 }}>
                <div className="muted small">{s.source}</div><b style={{ fontSize: 20 }}>{s.n}</b>
                <div className="meter" style={{ marginTop: 8 }}><i style={{ width: `${(s.n / d.sources[0].n) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
