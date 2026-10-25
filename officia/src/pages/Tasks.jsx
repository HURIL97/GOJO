import { useEffect, useState } from 'react';
import { Columns3, List, BellRing, Plus, Check, Clock, Repeat, AlarmClockOff, Users2, CalendarClock, Search, Download } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { TASK_STATUS, PRIORITY, REPEAT, relDay, fmtTime, localDay, stamp } from '../lib/format';
import { Tabs, Card, Badge, Empty, Select } from '../components/ui';

const COLS = [['a_faire', 'À faire'], ['en_cours', 'En cours'], ['attente', 'En attente'], ['terminee', 'Terminé']];

function DueBadge({ due, done }) {
  if (!due) return null;
  const t = localDay();
  const kind = done ? '' : due < t ? 'bad' : due === t ? 'warn' : '';
  return <Badge kind={kind}><CalendarClock size={11} />{due < t && !done ? 'En retard · ' : ''}{relDay(due)}</Badge>;
}

function Board({ tasks, open }) {
  const [over, setOver] = useState(null);
  const drop = async (status, e) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/task');
    if (id) await act(() => call('tasks.save', { id, status }));
  };
  return (
    <div className="kanban">
      {COLS.map(([k, l]) => {
        const items = tasks.filter((t) => t.status === k);
        return (
          <div key={k} className={`kcol ${over === k ? 'drop' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(k, e)}>
            <h4><span className="dot" style={{ background: k === 'terminee' ? 'var(--good)' : k === 'en_cours' ? 'var(--accent)' : k === 'attente' ? 'var(--warn)' : 'var(--muted)' }} />{l}<span className="badge" style={{ marginLeft: 'auto' }}>{items.length}</span></h4>
            {items.map((t) => (
              <div key={t.id} className={`kcard ${k === 'terminee' ? 'done' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} onClick={() => open('task', t)}>
                <div className="row" style={{ alignItems: 'flex-start' }}><i className={`prio prio-${t.priority}`} style={{ marginTop: 6 }} /><div className="ttl">{t.title}</div></div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <DueBadge due={t.due} done={k === 'terminee'} />
                  {t.assignee && <span className="badge">{t.assignee}</span>}
                  {t.meeting_title && <span className="badge info" title={t.meeting_title}><Users2 size={11} />PV</span>}
                </div>
              </div>
            ))}
            {k === 'a_faire' && <button className="btn ghost sm" style={{ width: '100%' }} onClick={() => open('task', { status: 'a_faire' })}><Plus size={14} />Ajouter</button>}
          </div>
        );
      })}
    </div>
  );
}

function ListView({ tasks, open }) {
  const toggle = (t) => act(() => call('tasks.save', { id: t.id, status: t.status === 'terminee' ? 'a_faire' : 'terminee' }));
  return (
    <Card>
      <table className="tbl">
        <thead><tr><th style={{ width: 40 }} /><th>Tâche</th><th>Priorité</th><th>Échéance</th><th>Responsable</th><th>Origine</th><th>Statut</th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="click" onClick={() => open('task', t)}>
              <td><button className={`checkbox ${t.status === 'terminee' ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(t); }}>{t.status === 'terminee' && <Check size={13} />}</button></td>
              <td style={t.status === 'terminee' ? { textDecoration: 'line-through', color: 'var(--muted)' } : null}><b>{t.title}</b>{t.description && <div className="muted small">{t.description.slice(0, 90)}</div>}</td>
              <td><Badge kind={PRIORITY[t.priority][1]}>{PRIORITY[t.priority][0]}</Badge></td>
              <td><DueBadge due={t.due} done={t.status === 'terminee'} /></td>
              <td>{t.assignee || '—'}</td>
              <td className="muted small">{t.meeting_title ? `Réunion : ${t.meeting_title}` : '—'}</td>
              <td>{TASK_STATUS[t.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tasks.length && <Empty>Aucune tâche</Empty>}
    </Card>
  );
}

function Reminders({ open }) {
  const [showDone, setShowDone] = useState(false);
  const [rows] = useData('reminders.list', [{ include_done: showDone }], [showDone]);
  const now = stamp();
  return (
    <Card title="Rappels programmés" hint="Une notification Windows s’affiche à l’heure prévue" right={<>
      <label className="check small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Afficher les rappels traités</label>
      <button className="btn sm primary" onClick={() => open('reminder')}><Plus size={14} />Rappel</button></>}>
      {(rows || []).map((r) => (
        <div key={r.id} className="list-row" style={{ cursor: 'pointer', opacity: r.done ? 0.5 : 1 }} onClick={() => open('reminder', r)}>
          <div className="ico" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: r.due <= now && !r.done ? 'var(--bad-soft)' : 'var(--accent-soft)' }}>
            <BellRing size={17} color={r.due <= now && !r.done ? 'var(--bad)' : 'var(--accent)'} />
          </div>
          <div style={{ flex: 1 }}>
            <b>{r.title}</b>
            <div className="muted small row" style={{ gap: 8 }}><Clock size={12} />{relDay(r.due)} à {fmtTime(r.due)}{r.repeat !== 'none' && <><Repeat size={12} />{REPEAT[r.repeat]}</>}{r.note ? ` · ${r.note}` : ''}</div>
          </div>
          {!r.done && <>
            <button className="btn sm" title="Reporter de 10 minutes" onClick={(e) => { e.stopPropagation(); act(() => call('reminders.snooze', r.id, 10), 'Reporté de 10 min'); }}><AlarmClockOff size={14} />+10 min</button>
            <button className="btn sm good" onClick={(e) => { e.stopPropagation(); act(() => call('reminders.done', r.id), r.repeat !== 'none' ? 'Reprogrammé à la prochaine échéance' : 'Rappel traité'); }}><Check size={14} />Fait</button>
          </>}
        </div>
      ))}
      {rows && !rows.length && <Empty icon={BellRing}>Aucun rappel</Empty>}
    </Card>
  );
}

export default function Tasks() {
  const { open, nav } = useApp();
  const [tab, setTab] = useState(nav.type === 'reminder' ? 'reminders' : 'board');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('');
  const [tasks] = useData('tasks.list', [{ q, scope }], [q, scope]);
  useEffect(() => {
    if (nav.type === 'reminder' && nav.id) { setTab('reminders'); call('db.get', 'reminders', nav.id).then((r) => r && open('reminder', r)).catch(() => {}); }
    if (nav.type === 'task' && nav.id) call('db.get', 'tasks', nav.id).then((t) => t && open('task', t)).catch(() => {});
  }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = tasks || [];
  const t = localDay();
  const stats = { open: list.filter((x) => x.status !== 'terminee').length, late: list.filter((x) => x.status !== 'terminee' && x.due && x.due < t).length, today: list.filter((x) => x.status !== 'terminee' && x.due === t).length, done: list.filter((x) => x.status === 'terminee').length };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <div className="card kpi"><div className="label">Tâches ouvertes</div><div className="value">{stats.open}</div><div className="delta">à traiter</div></div>
        <div className="card kpi"><div className="label">Pour aujourd’hui</div><div className="value" style={{ color: stats.today ? 'var(--warn)' : undefined }}>{stats.today}</div><div className="delta">échéance du jour</div></div>
        <div className="card kpi"><div className="label">En retard</div><div className="value" style={{ color: stats.late ? 'var(--bad)' : undefined }}>{stats.late}</div><div className="delta">échéance dépassée</div></div>
        <div className="card kpi"><div className="label">Terminées</div><div className="value" style={{ color: 'var(--good)' }}>{stats.done}</div><div className="delta">{list.length ? Math.round((stats.done / list.length) * 100) : 0} % du total</div></div>
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs value={tab} onChange={setTab} tabs={[['board', 'Tableau', Columns3], ['list', 'Liste', List], ['reminders', 'Rappels', BellRing]]} />
        {tab !== 'reminders' && <>
          <div className="search" style={{ width: 260 }}><Search size={16} /><input className="input" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div style={{ width: 190 }}><Select value={scope} onChange={setScope} placeholder="Toutes les tâches" options={[['today', 'À faire aujourd’hui'], ['late', 'En retard']]} /></div>
        </>}
        <div className="grow" />
        {tab !== 'reminders' && <button className="btn" onClick={() => call('export.csv', 'taches', list.map((x) => ({ Tache: x.title, Priorite: PRIORITY[x.priority][0], Echeance: x.due || '', Responsable: x.assignee || '', Statut: TASK_STATUS[x.status], Reunion: x.meeting_title || '' })))}><Download size={16} />Excel</button>}
        <button className="btn primary" onClick={() => open(tab === 'reminders' ? 'reminder' : 'task')}><Plus size={16} />{tab === 'reminders' ? 'Nouveau rappel' : 'Nouvelle tâche'}</button>
      </div>
      {tab === 'board' && <Board tasks={list} open={open} />}
      {tab === 'list' && <ListView tasks={list} open={open} />}
      {tab === 'reminders' && <Reminders open={open} />}
    </div>
  );
}
