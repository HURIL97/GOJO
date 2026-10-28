import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Printer, MapPin, Repeat, CalendarDays, Video, Upload, Download } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import {
  localDay, addDays, addMinutes, startOfWeek, monthTitle, fmtLong, fmtDay, fmtTime, fmtShort, weekdayShort, TYPES, EV_STATUS, stamp, minutesBetween, contactName, duration,
} from '../lib/format';
import { Tabs, Empty, StatusBadge, toast } from '../components/ui';
import { dayHtml, printHtml } from '../lib/print';

const HOUR = 52;
const WD = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Répartit les évènements qui se chevauchent sur plusieurs colonnes.
function layout(events) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const out = [];
  let cluster = [];
  let clusterEnd = '';
  const flush = () => {
    const lanes = [];
    for (const e of cluster) {
      let lane = lanes.findIndex((end) => end <= e.start);
      if (lane === -1) { lane = lanes.length; lanes.push(e.end); } else lanes[lane] = e.end;
      e._lane = lane;
    }
    for (const e of cluster) out.push({ ...e, _lanes: lanes.length });
    cluster = [];
    clusterEnd = '';
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push({ ...e });
    if (e.end > clusterEnd) clusterEnd = e.end;
  }
  if (cluster.length) flush();
  return out;
}

function TimeGrid({ days, events, onOpen, onCreate, onMove }) {
  const body = useRef(null);
  const [dropAt, setDropAt] = useState(null);
  const now = stamp();
  useEffect(() => { if (body.current) body.current.scrollTop = 7 * HOUR - 10; }, [days[0]]);
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  return (
    <div className="week" style={{ '--days': days.length }}>
      <div style={{ borderBottom: '1px solid var(--border)' }} />
      {days.map((d) => (
        <div key={d} className={`wk-head ${d === localDay() ? 'today' : ''}`}>{weekdayShort(d)}<b>{Number(d.slice(8))}</b></div>
      ))}
      <div className="muted small" style={{ padding: '6px 4px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Journée</div>
      {days.map((d) => (
        <div key={d} className="wk-allday">
          {allDay.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d).map((e) => <div key={e.occ_id} className={`chip allday tc-${e.type}`} onClick={() => onOpen(e)}>{e.title}</div>)}
        </div>
      ))}
      <div className="wk-body" ref={body}>
        <div className="wk-hours">{Array.from({ length: 24 }, (_, h) => <div key={h}>{h ? `${String(h).padStart(2, '0')}:00` : ''}</div>)}</div>
        {days.map((d) => {
          const evs = layout(timed.filter((e) => e.start.slice(0, 10) === d));
          return (
            <div key={d} className="wk-col">
              {Array.from({ length: 48 }, (_, i) => (
                <div key={i} className="slot" style={dropAt === `${d}-${i}` ? { background: 'var(--accent-soft)', boxShadow: 'inset 0 2px 0 var(--accent)' } : null}
                  onClick={() => onCreate(`${d}T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)}
                  onDragOver={(e) => { e.preventDefault(); setDropAt(`${d}-${i}`); }}
                  onDrop={(e) => { e.preventDefault(); setDropAt(null); const id = e.dataTransfer.getData('text/event'); if (id) onMove(id, `${d}T${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00`); }} />
              ))}
              {evs.map((e) => {
                const startMin = Number(e.start.slice(11, 13)) * 60 + Number(e.start.slice(14, 16));
                const len = Math.max(22, (Math.min(minutesBetween(e.start, e.end), 24 * 60 - startMin) / 60) * HOUR);
                const w = 100 / e._lanes;
                return (
                  <div key={e.occ_id} className={`wk-ev tc-${e.type} ${e.status}`} title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)} — glisser pour déplacer`}
                    draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/event', e.id); setTimeout(() => document.body.classList.add('dragging-ev'), 0); }} onDragEnd={() => { setDropAt(null); document.body.classList.remove('dragging-ev'); }}
                    style={{ top: (startMin / 60) * HOUR + 1, height: len - 2, left: `calc(${e._lane * w}% + 3px)`, width: `calc(${w}% - 6px)`, right: 'auto' }}
                    onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}>
                    <b>{e.title}</b>
                    <span className="muted">{fmtTime(e.start)}–{fmtTime(e.end)}{e.location && len > 50 ? ` · ${e.location}` : ''}</span>
                  </div>
                );
              })}
              {d === now.slice(0, 10) && <div className="now-line" style={{ top: ((Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))) / 60) * HOUR }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Month({ anchor, events, onOpen, onCreate, onDay }) {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const t = localDay();
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="cal-head">{WD.map((w) => <div key={w}>{w}</div>)}</div>
      <div className="month">
        {days.map((d) => {
          const evs = events.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d);
          return (
            <div key={d} className={`mday ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'out' : ''} ${d === t ? 'today' : ''}`} onClick={() => onCreate(`${d}T09:00`)}>
              <div className="row between"><span className="dnum" onClick={(e) => { e.stopPropagation(); onDay(d); }}>{Number(d.slice(8))}</span></div>
              {evs.slice(0, 3).map((e) => (
                <div key={e.occ_id} className={`chip tc-${e.type} ${e.all_day ? 'allday' : ''}`} onClick={(x) => { x.stopPropagation(); onOpen(e); }}>
                  {!e.all_day && <span className="t">{fmtTime(e.start)}</span>}{e.title}
                </div>
              ))}
              {evs.length > 3 && <span className="more" onClick={(x) => { x.stopPropagation(); onDay(d); }}>+ {evs.length - 3} autre{evs.length - 3 > 1 ? 's' : ''}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ events, onOpen }) {
  const groups = {};
  for (const e of events) (groups[e.start.slice(0, 10)] ||= []).push(e);
  const keys = Object.keys(groups).sort();
  if (!keys.length) return <Empty icon={CalendarDays}>Aucun évènement sur cette période</Empty>;
  return (
    <div className="col" style={{ gap: 14 }}>
      {keys.map((d) => (
        <div key={d} className="card">
          <div className="card-head"><h3 style={{ textTransform: 'capitalize' }}>{fmtDay(d)}</h3><span className="hint">{groups[d].length} évènement(s)</span></div>
          {groups[d].map((e) => (
            <div key={e.occ_id} className={`tl-item tc-${e.type}`} style={{ marginBottom: 8 }} onClick={() => onOpen(e)}>
              <div className="row between">
                <div className="row" style={{ gap: 14 }}>
                  <b className="num" style={{ width: 96 }}>{e.all_day ? 'Journée' : `${fmtTime(e.start)} – ${fmtTime(e.end)}`}</b>
                  <div>
                    <b>{e.title}</b>
                    <div className="row wrap muted small" style={{ gap: 10 }}>
                      <span>{TYPES[e.type]}</span>
                      {e.location && <span className="row" style={{ gap: 4 }}><MapPin size={12} />{e.location}</span>}
                      {e.visio_url && <span className="row" style={{ gap: 4 }}><Video size={12} />Visio</span>}
                      {(e.first_name || e.last_name || e.company) && <span>{contactName(e)}</span>}
                      {e.recurrence !== 'none' && <span className="row" style={{ gap: 4 }}><Repeat size={12} />Récurrent</span>}
                    </div>
                  </div>
                </div>
                <div className="row"><span className="muted small">{e.all_day ? '' : duration(minutesBetween(e.start, e.end))}</span><StatusBadge map={EV_STATUS} value={e.status} /></div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Agenda() {
  const { open, go, nav, settings } = useApp();
  const [view, setView] = useState(() => { try { return localStorage.getItem('agendaView') || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(nav.date ? nav.date.slice(0, 10) : localDay());
  const [hidden, setHidden] = useState([]);
  useEffect(() => { try { localStorage.setItem('agendaView', view); } catch { /* ignoré */ } }, [view]);

  const range = useMemo(() => {
    if (view === 'month') { const s = startOfWeek(`${anchor.slice(0, 7)}-01`); return [s, addDays(s, 41)]; }
    if (view === 'week') { const s = startOfWeek(anchor); return [s, addDays(s, 6)]; }
    if (view === 'day') return [anchor, anchor];
    return [anchor, addDays(anchor, 59)];
  }, [view, anchor]);
  const [events] = useData('agenda.range', range, [range[0], range[1]]);
  const shown = (events || []).filter((e) => !hidden.includes(e.type));

  useEffect(() => {
    if (nav.type === 'event' && nav.id) call('db.get', 'events', nav.id).then((e) => e && open('event', e)).catch(() => {});
  }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (n) => {
    if (view === 'month') { const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00`); d.setMonth(d.getMonth() + n); setAnchor(localDay(d)); }
    else setAnchor(addDays(anchor, n * (view === 'week' ? 7 : view === 'day' ? 1 : 30)));
  };
  const openEv = async (e) => {
    if (e.type === 'reunion' && e.meeting_id) return go('meetings', { id: e.meeting_id });
    const base = await call('db.get', 'events', e.id);
    open('event', base || e);
  };
  const create = (start) => open('event', { start: `${start}:00` });
  // Glisser-déposer : déplace l'évènement en conservant sa durée.
  const move = async (id, start) => {
    const ev = await call('db.get', 'events', id);
    if (!ev) return;
    if (ev.recurrence && ev.recurrence !== 'none') return toast('Pour un évènement répétitif, modifiez l’horaire depuis sa fiche', 'info');
    if (ev.start === start) return;
    const end = addMinutes(start, Math.max(15, minutesBetween(ev.start, ev.end)));
    const clash = (await call('agenda.conflicts', start, end, id)).length;
    await act(() => call('agenda.save', { ...ev, start, end }), `« ${ev.title} » déplacé au ${fmtShort(start)} à ${fmtTime(start)}${clash ? ' — attention : conflit d’agenda' : ''}`);
  };
  const title = view === 'month' ? monthTitle(anchor) : view === 'week' ? `${fmtShort(range[0])} – ${fmtShort(range[1])} ${range[1].slice(0, 4)}` : view === 'day' ? fmtLong(anchor) : `À partir du ${fmtShort(anchor)}`;
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range[0], i)) : [anchor];

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button className="btn icon" onClick={() => step(-1)}><ChevronLeft size={17} /></button>
        <button className="btn" onClick={() => setAnchor(localDay())}>Aujourd’hui</button>
        <button className="btn icon" onClick={() => step(1)}><ChevronRight size={17} /></button>
        <h2 style={{ margin: '0 8px', fontSize: 19, textTransform: 'capitalize' }}>{title}</h2>
        <div className="grow" />
        <Tabs value={view} onChange={setView} tabs={[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['list', 'Liste']]} />
        <button className="btn" title="Imprimer" onClick={() => printHtml(dayHtml(view === 'day' ? anchor : localDay(), (events || []).filter((e) => e.start.slice(0, 10) === (view === 'day' ? anchor : localDay())), [], settings))}><Printer size={16} /></button>
        <button className="btn icon" title="Importer un agenda (.ics : Google Agenda, Outlook, téléphone)" onClick={async () => { const r = await act(() => call('agenda.importIcs')); if (r) toast(`${r.added} évènement(s) importé(s)${r.updated ? `, ${r.updated} mis à jour` : ''}`, 'success'); }}><Upload size={16} /></button>
        <button className="btn icon" title="Exporter l’agenda (.ics)" onClick={async () => { const r = await act(() => call('agenda.exportIcs')); if (r) toast(`${r.count} évènement(s) exporté(s)`, 'success'); }}><Download size={16} /></button>
        <button className="btn primary" onClick={() => open('event')}><Plus size={16} />Nouvel évènement</button>
      </div>
      <div className="type-legend">
        {Object.entries(TYPES).map(([k, l]) => (
          <span key={k} className={`tc-${k} ${hidden.includes(k) ? 'off' : ''}`} onClick={() => setHidden((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]))}><i />{l}</span>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', cursor: 'default' }}>Cliquez sur un créneau libre pour créer · glissez un évènement pour le déplacer</span>
      </div>
      {!events ? null : view === 'month' ? <Month anchor={anchor} events={shown} onOpen={openEv} onCreate={create} onDay={(d) => { setAnchor(d); setView('day'); }} />
        : view === 'list' ? <ListView events={shown} onOpen={openEv} />
          : <TimeGrid days={days} events={shown} onOpen={openEv} onCreate={create} onMove={move} />}
    </div>
  );
}
