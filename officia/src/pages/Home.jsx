import { useEffect, useState } from 'react';
import {
  CalendarDays, Users2, AlertTriangle, Mail, Inbox, PhoneCall, Clock3, MapPin, Video, Printer, Plus, Check, BellRing,
  FileSignature, ChevronRight, Star, Timer, CalendarPlus, ListChecks, StickyNote,
} from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtLong, fmtTime, fmtShort, relDay, weekdayShort, stamp, minutesBetween, TYPES, PRIORITY, MEETING_STATUS, contactName, ago, duration } from '../lib/format';
import { Card, Badge, Empty, StatusBadge } from '../components/ui';
import { Bars, Donut, cssVar } from '../components/charts';
import { dayHtml, printHtml } from '../lib/print';

function useNow() {
  const [now, setNow] = useState(stamp());
  useEffect(() => { const t = setInterval(() => setNow(stamp()), 30000); return () => clearInterval(t); }, []);
  return now;
}

function Kpi({ icon: Icon, label, value, hint, color, onClick, alert }) {
  return (
    <div className="card kpi" style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div className="label"><span className="ico" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}><Icon size={16} /></span>{label}</div>
      <div className="value num" style={alert ? { color: 'var(--bad)' } : null}>{value}</div>
      <div className="delta">{hint}</div>
    </div>
  );
}

export default function Home() {
  const { settings, go, open, theme } = useApp();
  const [d] = useData('dashboard');
  const now = useNow();
  if (!d) return <div className="muted">Chargement…</div>;
  const k = d.kpi;
  const hour = Number(now.slice(11, 13));
  const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const first = (settings.user_name || '').split(' ')[0];
  const next = d.next;
  const mins = next ? minutesBetween(now, next.start) : 0;
  const countdown = !next ? '' : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : relDay(next.start);
  const typeColor = (t) => cssVar(`--t-${t}`);
  const toggleTask = async (t) => act(() => call('tasks.save', { id: t.id, status: t.status === 'terminee' ? 'a_faire' : 'terminee' }), t.status === 'terminee' ? null : 'Tâche terminée');
  const printDay = async () => printHtml(dayHtml(d.today, d.todayEvents, d.tasksToday, settings));
  const timed = d.todayEvents.filter((e) => !e.all_day);
  const allDay = d.todayEvents.filter((e) => e.all_day);
  const nowIndex = timed.findIndex((e) => e.end > now);

  return (
    <div className="col" style={{ gap: 16 }} key={theme}>
      <div className="greet">
        <div>
          <h2>{hello}{first ? `, ${first}` : ''} 👋</h2>
          <p>{fmtLong(d.today).replace(/^./, (c) => c.toUpperCase())} — {k.eventsToday ? `${k.eventsToday} évènement${k.eventsToday > 1 ? 's' : ''} aujourd’hui` : 'aucun rendez-vous aujourd’hui'}{k.lateTasks ? `, ${k.lateTasks} tâche${k.lateTasks > 1 ? 's' : ''} en retard` : ''}.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={printDay}><Printer size={16} />Agenda du jour</button>
          <button className="btn" onClick={() => open('reminder')}><BellRing size={16} />Rappel</button>
          <button className="btn primary" onClick={() => open('event')}><CalendarPlus size={16} />Rendez-vous</button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.3fr 2fr' }}>
        <div className="card next-card">
          <div className="row between"><span className="muted row small" style={{ gap: 6 }}><Timer size={15} color="var(--accent)" />Prochain rendez-vous</span>{next && <Badge kind="info">{TYPES[next.type]}</Badge>}</div>
          {next ? (
            <div style={{ cursor: 'pointer' }} onClick={() => (next.type === 'reunion' && next.meeting_id ? go('meetings', { id: next.meeting_id }) : open('event', next))}>
              <div className="big">{next.title}</div>
              <div className="row wrap muted small" style={{ gap: 14 }}>
                <span className="row" style={{ gap: 5 }}><Clock3 size={14} />{relDay(next.start)} · {fmtTime(next.start)} – {fmtTime(next.end)}</span>
                {next.location && <span className="row" style={{ gap: 5 }}><MapPin size={14} />{next.location}</span>}
                {(next.first_name || next.last_name || next.company) && <span>{contactName(next)}</span>}
              </div>
              <div className="row between mt">
                <div><div className="muted small">Dans</div><div className="countdown num">{countdown}</div></div>
                {next.visio_url && <button className="btn primary" onClick={(e) => { e.stopPropagation(); window.open(next.visio_url); }}><Video size={16} />Rejoindre</button>}
              </div>
            </div>
          ) : <Empty icon={CalendarDays}>Rien de prévu dans les 30 prochains jours</Empty>}
        </div>
        <div className="grid g3">
          <Kpi icon={CalendarDays} label="Rendez-vous du jour" value={k.rdvToday} hint={`${k.eventsToday} évènements au total`} color="var(--t-rdv)" onClick={() => go('agenda')} />
          <Kpi icon={Users2} label="Réunions cette semaine" value={k.meetingsWeek} hint={`${String(k.weekHours).replace('.', ',')} h d’agenda planifiées`} color="var(--t-reunion)" onClick={() => go('meetings')} />
          <Kpi icon={AlertTriangle} label="Tâches en retard" value={k.lateTasks} hint={`${k.openTasks} ouvertes · ${k.doneWeek} faites cette semaine`} color="var(--bad)" alert={k.lateTasks > 0} onClick={() => go('tasks')} />
          <Kpi icon={Mail} label="Messages non lus" value={k.unread} hint={k.outbox ? `${k.outbox} en attente d’envoi` : 'Boîte d’envoi vide'} color="var(--accent)" onClick={() => go('mail')} />
          <Kpi icon={Inbox} label="Courriers à traiter" value={k.courrierTodo} hint={`Ce mois : ${k.courrierIn} reçus · ${k.courrierOut} envoyés`} color="var(--t-deplacement)" onClick={() => go('courrier')} />
          <Kpi icon={PhoneCall} label="Appels à rappeler" value={k.callsTodo} hint="Messages téléphoniques" color="var(--t-appel)" onClick={() => go('calls')} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card title="Programme de la journée" hint={fmtLong(d.today)} right={<button className="btn sm" onClick={() => go('agenda')}>Agenda<ChevronRight size={14} /></button>}>
          {allDay.map((e) => <div key={e.occ_id} className={`chip allday tc-${e.type}`} style={{ marginBottom: 8, padding: '6px 10px' }} onClick={() => open('event', e)}>{e.title}</div>)}
          {timed.length ? (
            <div className="timeline">
              {timed.map((e, i) => (
                <div key={e.occ_id}>
                  {i === nowIndex && e.start > now && <div className="tl-now" />}
                  <div className={`tl-item tc-${e.type} ${e.end < now ? 'past' : ''}`} onClick={() => (e.type === 'reunion' && e.meeting_id ? go('meetings', { id: e.meeting_id }) : open('event', e))}>
                    <span className="tl-time">{fmtTime(e.start)}</span>
                    <div className="row between">
                      <b>{e.title}</b>
                      <span className="muted small">{duration(minutesBetween(e.start, e.end))}</span>
                    </div>
                    <div className="row wrap muted small" style={{ gap: 12, marginTop: 3 }}>
                      <span style={{ color: typeColor(e.type), fontWeight: 650 }}>{TYPES[e.type]}</span>
                      {e.location && <span className="row" style={{ gap: 4 }}><MapPin size={12} />{e.location}</span>}
                      {(e.first_name || e.last_name || e.company) && <span>{contactName(e)}</span>}
                      {e.status === 'confirme' && <Badge kind="good">Confirmé</Badge>}
                    </div>
                  </div>
                </div>
              ))}
              {nowIndex === -1 && <div className="tl-now" />}
            </div>
          ) : !allDay.length && <Empty icon={CalendarDays}>Journée libre. <button className="btn sm" onClick={() => open('event')}><Plus size={13} />Planifier</button></Empty>}
        </Card>
        <div className="col" style={{ gap: 16 }}>
          <Card title="Tâches du jour" right={<button className="btn sm icon" onClick={() => open('task')}><Plus size={14} /></button>}>
            {d.tasksToday.length ? d.tasksToday.map((t) => (
              <div key={t.id} className="list-row">
                <button className={`checkbox ${t.status === 'terminee' ? 'on' : ''}`} onClick={() => toggleTask(t)}>{t.status === 'terminee' && <Check size={13} />}</button>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => open('task', t)}>
                  <div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                  <div className="muted small">{t.due < d.today ? <span className="neg-val">En retard · {fmtShort(t.due)}</span> : 'Aujourd’hui'}{t.assignee ? ` · ${t.assignee}` : ''}</div>
                </div>
                <i className={`prio prio-${t.priority}`} title={PRIORITY[t.priority][0]} />
              </div>
            )) : <Empty icon={ListChecks}>Tout est à jour 🎉</Empty>}
          </Card>
          <Card title="Rappels" right={<button className="btn sm icon" onClick={() => open('reminder')}><Plus size={14} /></button>}>
            {d.reminders.length ? d.reminders.map((r) => (
              <div key={r.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => open('reminder', r)}>
                <BellRing size={16} color={r.due <= now ? 'var(--bad)' : 'var(--accent)'} />
                <div style={{ flex: 1 }}><div className="strong">{r.title}</div><div className="muted small">{relDay(r.due)} à {fmtTime(r.due)}{r.repeat !== 'none' ? ' · récurrent' : ''}</div></div>
                <button className="btn sm ghost" title="Fait" onClick={(e) => { e.stopPropagation(); act(() => call('reminders.done', r.id), 'Rappel traité'); }}><Check size={14} /></button>
              </div>
            )) : <Empty icon={BellRing}>Aucun rappel</Empty>}
          </Card>
        </div>
      </div>

      <div className="grid g3">
        <Card title="Charge de la semaine" hint="Heures planifiées par jour">
          <Bars height={190} moneyAxis={false} labels={d.load.map((x) => `${weekdayShort(x.day)} ${x.day.slice(8)}`)} data={d.load.map((x) => x.hours)} label="Heures" color={cssVar('--accent')} />
        </Card>
        <Card title="Répartition de la semaine" hint="Par type d’évènement">
          {d.types.length ? (
            <div className="row" style={{ gap: 14 }}>
              <div style={{ width: 160 }}><Donut height={160} labels={d.types.map((t) => TYPES[t.type])} data={d.types.map((t) => t.n)} colors={d.types.map((t) => typeColor(t.type))} center={d.types.reduce((s, t) => s + t.n, 0)} sub="évènements" /></div>
              <div className="col" style={{ gap: 6, flex: 1 }}>
                {d.types.map((t) => <div key={t.type} className="row between small"><span className="row"><i className="dot" style={{ background: typeColor(t.type) }} />{TYPES[t.type]}</span><b>{t.n}</b></div>)}
              </div>
            </div>
          ) : <Empty>Semaine libre</Empty>}
        </Card>
        <Card title="Derniers messages" right={<button className="btn sm" onClick={() => go('mail')}>Messagerie<ChevronRight size={14} /></button>}>
          {d.recentMails.length ? d.recentMails.map((m) => (
            <div key={m.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => go('mail', { id: m.id })}>
              <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{(m.from_name || m.from_addr || '?').slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={m.read ? '' : 'strong'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.from_name || m.from_addr}</div>
                <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.subject}</div>
              </div>
              {m.starred ? <Star size={13} color="var(--warn)" fill="var(--warn)" /> : null}
              <span className="muted small">{ago(m.date)}</span>
            </div>
          )) : <Empty icon={Mail}>Aucun message</Empty>}
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Réunions à venir" right={<button className="btn sm" onClick={() => go('meetings')}>Tout voir<ChevronRight size={14} /></button>}>
          {d.meetings.length ? d.meetings.map((m) => (
            <div key={m.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => go('meetings', { id: m.id })}>
              <Users2 size={16} color="var(--t-reunion)" />
              <div style={{ flex: 1 }}><div className="strong">{m.title}</div><div className="muted small">{relDay(m.start)} · {fmtTime(m.start)}{m.location ? ` · ${m.location}` : ''}</div></div>
              <StatusBadge map={MEETING_STATUS} value={m.status} />
            </div>
          )) : <Empty icon={Users2}>Aucune réunion planifiée</Empty>}
          {d.pvTodo.length > 0 && <>
            <div className="nav-label" style={{ padding: '12px 0 4px' }}>PV à rédiger</div>
            {d.pvTodo.map((m) => (
              <div key={m.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => go('meetings', { id: m.id, tab: 'pv' })}>
                <FileSignature size={16} color="var(--warn)" /><div style={{ flex: 1 }}><b>{m.title}</b><div className="muted small">Tenue le {fmtShort(m.start)}</div></div><ChevronRight size={14} />
              </div>
            ))}
          </>}
        </Card>
        <Card title="Appels à rappeler" right={<button className="btn sm icon" onClick={() => open('call')}><Plus size={14} /></button>}>
          {d.calls.length ? d.calls.map((c) => (
            <div key={c.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => open('call', c)}>
              <PhoneCall size={16} color={c.urgent ? 'var(--bad)' : 'var(--t-appel)'} />
              <div style={{ flex: 1, minWidth: 0 }}><div className="strong">{c.caller}{c.company ? <span className="muted"> · {c.company}</span> : null}</div><div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.message}</div></div>
              {c.urgent ? <Badge kind="bad">Urgent</Badge> : <span className="muted small">{ago(c.date)}</span>}
            </div>
          )) : <Empty icon={PhoneCall}>Aucun appel en attente</Empty>}
        </Card>
        <Card title="Pense-bêtes" right={<button className="btn sm icon" onClick={() => open('note')}><Plus size={14} /></button>}>
          <div className="grid g2" style={{ gap: 10 }}>
            {d.notes.map((n) => <div key={n.id} className="sticky" style={{ '--nc': n.color }} onClick={() => open('note', n)}><b>{n.pinned ? '📌 ' : ''}{n.title}</b>{n.body}</div>)}
          </div>
          {!d.notes.length && <Empty icon={StickyNote}>Notez ici vos informations utiles</Empty>}
        </Card>
      </div>
    </div>
  );
}
