import { useState } from 'react';
import { BarChart3, Printer, FileDown, Download, Users2, CalendarDays, Inbox, Send, PhoneCall, ListChecks, Mail, Timer, FileSignature, AlertTriangle } from 'lucide-react';
import { call } from '../lib/api';
import { useData } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtShort, fmtTime, monthTitle, localDay, TYPES, MEETING_STATUS } from '../lib/format';
import { Card, Delta, Empty, Select, StatusBadge } from '../components/ui';
import { StackedBars, Donut, cssVar } from '../components/charts';
import { reportHtml, printHtml, savePdf } from '../lib/print';

const months = () => Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return localDay(d).slice(0, 7); });

// Rapport mensuel d'activité du secrétariat, à présenter à la Direction.
export default function Reports() {
  const { settings, go } = useApp();
  const [month, setMonth] = useState(localDay().slice(0, 7));
  const [r] = useData('report.month', [month], [month]);
  if (!r) return <div className="muted">Chargement…</div>;
  const k = r.kpi;
  const p = r.prev;
  const title = `Rapport d’activité — ${monthTitle(`${month}-01`)}`;
  const tiles = [
    [Users2, 'Réunions tenues', k.meetings, p.meetings, '--t-reunion'], [CalendarDays, 'Rendez-vous', k.rdv, null, '--t-rdv'],
    [FileSignature, 'PV validés', k.pvValidated, p.pvValidated, '--good'], [Inbox, 'Courriers reçus', k.courrierIn, p.courrierIn, '--accent'],
    [Send, 'Courriers envoyés', k.courrierOut, p.courrierOut, '--accent-2'], [PhoneCall, 'Appels reçus', k.calls, p.calls, '--t-appel'],
    [ListChecks, 'Tâches terminées', k.tasksDone, p.tasksDone, '--good'], [Mail, 'E-mails envoyés', k.mailsSent, p.mailsSent, '--t-deplacement'],
  ];
  const exportRows = [
    ['Réunions tenues', k.meetings, p.meetings], ['PV validés', k.pvValidated, p.pvValidated], ['PV diffusés', k.pvSent, p.pvSent], ['Rendez-vous', k.rdv, ''],
    ['Heures planifiées', k.hours, ''], ['Courriers reçus', k.courrierIn, p.courrierIn], ['Courriers traités', k.courrierTreated, p.courrierTreated], ['Courriers envoyés', k.courrierOut, p.courrierOut],
    ['Appels reçus', k.calls, p.calls], ['Appels rappelés', k.callsBack, p.callsBack], ['Tâches terminées', k.tasksDone, p.tasksDone], ['E-mails envoyés', k.mailsSent, p.mailsSent], ['E-mails reçus', k.mailsIn, p.mailsIn],
  ].map(([Indicateur, Mois, MoisPrecedent]) => ({ Indicateur, [monthTitle(`${month}-01`)]: Mois, [monthTitle(`${r.prevMonth}-01`)]: MoisPrecedent }));
  const html = () => reportHtml(r, settings);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div style={{ width: 220 }}><Select value={month} onChange={setMonth} options={months().map((m) => [m, monthTitle(`${m}-01`).replace(/^./, (c) => c.toUpperCase())])} /></div>
        <span className="muted small">Comparaison avec {monthTitle(`${r.prevMonth}-01`)}</span>
        <div className="grow" />
        <button className="btn" onClick={() => printHtml(html())}><Printer size={16} />Imprimer</button>
        <button className="btn" onClick={() => call('export.csv', `rapport-activite-${month}`, exportRows)}><Download size={16} />Excel</button>
        <button className="btn primary" onClick={() => savePdf(html(), title)}><FileDown size={16} />PDF pour la Direction</button>
      </div>
      <div className="grid g4">
        {tiles.map(([I, label, v, prev, color]) => (
          <div key={label} className="card kpi">
            <div className="label"><span className="ico" style={{ background: `color-mix(in srgb, var(${color}) 18%, transparent)`, color: `var(${color})` }}><I size={16} /></span>{label}</div>
            <div className="value num">{v}</div>
            {prev !== null ? <Delta cur={v} prev={prev} suffix="vs mois précédent" /> : <div className="delta">{k.hours.toString().replace('.', ',')} h planifiées</div>}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <Card title="Activité par semaine" hint="Rendez-vous, réunions, courriers et appels">
          <StackedBars height={260} labels={r.weeks.map((w) => `${fmtShort(w.from)} – ${fmtShort(w.to)}`)} series={[
            { label: 'Rendez-vous', data: r.weeks.map((w) => w.rdv), color: cssVar('--t-rdv') }, { label: 'Réunions', data: r.weeks.map((w) => w.meetings), color: cssVar('--t-reunion') },
            { label: 'Courriers', data: r.weeks.map((w) => w.courrier), color: cssVar('--accent-2') }, { label: 'Appels', data: r.weeks.map((w) => w.calls), color: cssVar('--t-appel') }]} />
        </Card>
        <Card title="Agenda du mois" hint={`${k.events} évènement(s)`}>
          {r.types.length ? <Donut height={220} labels={r.types.map((t) => TYPES[t.type])} data={r.types.map((t) => t.n)} colors={r.types.map((t) => cssVar(`--t-${t.type}`))} center={k.events} sub="évènements" /> : <Empty icon={CalendarDays}>Aucun évènement</Empty>}
        </Card>
      </div>
      <div className="grid g3">
        <Card title="Courrier" hint="Délai moyen de traitement">
          <div className="row" style={{ gap: 14 }}><Timer size={30} color="var(--accent)" /><div><div className="value num" style={{ fontSize: 30, fontWeight: 750 }}>{r.delay === null ? '—' : `${String(r.delay).replace('.', ',')} j`}</div><div className="muted small">entre l’arrivée et le traitement</div></div></div>
          <div className="list-row mt"><span>Traités sur le mois</span><b className="right">{k.courrierTreated} / {k.courrierIn}</b></div>
          <div className="list-row"><span>En attente (tous mois)</span><b className="right" style={{ color: r.openCourrier ? 'var(--warn)' : undefined }}>{r.openCourrier}</b></div>
          <div className="list-row"><span>Appels rappelés</span><b className="right">{k.callsBack} / {k.calls}</b></div>
        </Card>
        <Card title="Réunions du mois" right={<button className="btn sm" onClick={() => go('meetings')}>Ouvrir</button>}>
          {r.meetings.length ? r.meetings.map((m) => (
            <div key={m.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => go('meetings', { id: m.id })}>
              <Users2 size={15} color="var(--t-reunion)" /><div style={{ flex: 1, minWidth: 0 }}><div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div><div className="muted small">{fmtShort(m.start)} · {fmtTime(m.start)}</div></div>
              <StatusBadge map={MEETING_STATUS} value={m.status} />
            </div>
          )) : <Empty icon={Users2}>Aucune réunion</Empty>}
        </Card>
        <Card title="Actions en retard" hint={`${r.lateCount} à fin de mois`}>
          {r.lateTasks.length ? r.lateTasks.slice(0, 8).map((t) => (
            <div key={t.id} className="list-row"><AlertTriangle size={15} color="var(--bad)" /><div style={{ flex: 1, minWidth: 0 }}><div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div><div className="muted small">{t.assignee || '—'} · échéance {fmtShort(t.due)}</div></div></div>
          )) : <Empty icon={BarChart3}>Aucune action en retard</Empty>}
        </Card>
      </div>
    </div>
  );
}
