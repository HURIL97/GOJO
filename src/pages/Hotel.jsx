import { useMemo, useState } from 'react';
import { LayoutGrid, CalendarDays, List, Plus, ChevronLeft, ChevronRight, Sparkles, Wrench, Crown, LogIn, LogOut, BedDouble } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { money, fmtDate, fmtShort, localDay, addDays, daysBetween, weekday, RES_STATUS, ROOM_STATUS, guestName } from '../lib/format';
import { Tabs, Badge, StatusBadge, SearchBox, Select, Empty, Card } from '../components/ui';
import { ReservationModal, FolioModal } from './HotelModals';

function RoomBoard({ openFolio, newRes }) {
  const [rooms, reload] = useData('hotel.roomBoard');
  const [filter, setFilter] = useState('');
  if (!rooms) return null;
  const counts = Object.fromEntries(Object.keys(ROOM_STATUS).map((k) => [k, rooms.filter((r) => r.status === k).length]));
  const setStatus = async (e, room, status) => {
    e.stopPropagation();
    if (await act(() => call('hotel.setRoomStatus', room.id, status), `Chambre ${room.number} : ${ROOM_STATUS[status][0]}`)) reload();
  };
  const floors = [...new Set(rooms.map((r) => r.floor || '—'))];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row wrap">
        <button className={`btn sm ${!filter ? 'primary' : ''}`} onClick={() => setFilter('')}>Toutes ({rooms.length})</button>
        {Object.entries(ROOM_STATUS).map(([k, [l]]) => (
          <button key={k} className={`btn sm ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}><span className={`dot st-${k}`} style={{ background: 'var(--st)' }} />{l} ({counts[k]})</button>
        ))}
      </div>
      {floors.map((fl) => {
        const list = rooms.filter((r) => (r.floor || '—') === fl && (!filter || r.status === filter));
        if (!list.length) return null;
        return (
          <div key={fl}>
            <div className="nav-label" style={{ paddingLeft: 2 }}>Étage {fl}</div>
            <div className="rooms-grid">
              {list.map((r) => {
                const res = r.current || r.arriving;
                return (
                  <div key={r.id} className={`room st-${r.status}`} onClick={() => (res ? openFolio(res.id) : newRes({ room_id: r.id }))}>
                    <div className="row between">
                      <span className="num">{r.number}</span>
                      <StatusBadge map={ROOM_STATUS} value={r.status} />
                    </div>
                    <div className="type">{r.type_name} · {money(r.rate)}</div>
                    <div className="who">
                      {r.current ? (<><b>{guestName(r.current)}</b><br /><span className="muted">Départ {fmtShort(r.current.check_out)}</span></>)
                        : r.arriving ? (<><Badge kind="info"><LogIn size={12} />Arrivée</Badge> <b>{guestName(r.arriving)}</b></>)
                          : <span className="muted">Disponible — cliquer pour réserver</span>}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 8 }}>
                      {r.status === 'sale' && <button className="btn sm" onClick={(e) => setStatus(e, r, r.current ? 'occupee' : 'libre')}><Sparkles size={14} />Nettoyée</button>}
                      {r.status === 'libre' && <button className="btn sm ghost" title="Mettre en maintenance" onClick={(e) => setStatus(e, r, 'maintenance')}><Wrench size={14} /></button>}
                      {r.status === 'maintenance' && <button className="btn sm" onClick={(e) => setStatus(e, r, 'libre')}>Remettre en service</button>}
                      {r.status === 'occupee' && <button className="btn sm ghost" title="Signaler à nettoyer" onClick={(e) => setStatus(e, r, 'sale')}><Sparkles size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!rooms.length && <Empty icon={BedDouble}>Aucune chambre. Ajoutez-les dans Paramètres › Chambres.</Empty>}
    </div>
  );
}

const CELL = 64;
const ROOMCOL = 150;
function Planning({ openFolio, newRes }) {
  const [from, setFrom] = useState(addDays(localDay(), -2));
  const days = 21;
  const [p] = useData('hotel.planning', [from, days], [from]);
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from]);
  const t = localDay();
  if (!p) return null;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <button className="btn sm icon" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} /></button>
        <button className="btn sm" onClick={() => setFrom(addDays(localDay(), -2))}>Aujourd’hui</button>
        <button className="btn sm icon" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} /></button>
        <b style={{ marginLeft: 8 }}>{fmtDate(from)} → {fmtDate(addDays(from, days - 1))}</b>
        <div className="legend right">
          <span><i style={{ background: '#6a5cff' }} />Confirmée</span><span><i style={{ background: '#2fbf71' }} />En séjour</span><span><i style={{ background: '#4a5573' }} />Partie</span>
        </div>
      </div>
      <div className="planning" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <div className="plan-grid" style={{ gridTemplateColumns: `${ROOMCOL}px repeat(${days}, ${CELL}px)` }}>
          <div className="plan-head plan-room" style={{ zIndex: 4, top: 0 }}>Chambre</div>
          {dates.map((d) => (
            <div key={d} className="plan-head" style={d === t ? { color: 'var(--accent)' } : null}>
              {weekday(d)}<b style={d === t ? { color: 'var(--accent)' } : null}>{d.slice(8)}</b>
            </div>
          ))}
          {p.rooms.map((room, ri) => (
            <div key={room.id} style={{ display: 'contents' }}>
              <div className="plan-room">{room.number} <small>{room.type_name}</small></div>
              {dates.map((d) => {
                const wd = new Date(`${d}T12:00:00`).getDay();
                return (
                  <div key={d} className={`plan-cell free ${d === t ? 'today' : wd === 0 || wd === 6 ? 'we' : ''}`}
                    title={`Réserver ${room.number} le ${fmtDate(d)}`}
                    onClick={() => newRes({ room_id: room.id, check_in: d, check_out: addDays(d, 1), rate: room.rate })} />
                );
              })}
              {p.reservations.filter((r) => r.room_id === room.id).map((r) => {
                const start = Math.max(0, daysBetween(from, r.check_in));
                const end = Math.min(days, daysBetween(from, r.check_out));
                if (end <= 0 || start >= days) return null;
                // Les séjours vont de midi à midi : la barre démarre au milieu de la case d'arrivée.
                const left = ROOMCOL + start * CELL + (r.check_in >= from ? CELL / 2 : 0);
                const right = ROOMCOL + end * CELL + (r.check_out <= addDays(from, days - 1) ? CELL / 2 : 0);
                return (
                  <div key={r.id} className={`plan-bar ${r.status}`} title={`${guestName(r)} · ${r.code}`}
                    style={{ top: 46 + ri * 46 + 6, left: left + 2, width: Math.max(24, right - left - 4) }}
                    onClick={() => openFolio(r.id)}>
                    {r.vip ? <Crown size={12} /> : null}{guestName(r)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReservationsList({ openFolio }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows] = useData('hotel.reservations', [{ q, status }], [q, status]);
  return (
    <Card>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Code, nom, téléphone, chambre…" width={320} />
        <div style={{ width: 200 }}><Select value={status} onChange={setStatus} placeholder="Tous les statuts" options={Object.entries(RES_STATUS).map(([k, [l]]) => [k, l])} /></div>
        <span className="muted small right">{rows ? rows.length : 0} réservation(s)</span>
      </div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="tbl">
          <thead><tr><th>Code</th><th>Client</th><th>Chambre</th><th>Arrivée</th><th>Départ</th><th className="r">Nuits</th><th className="r">Tarif</th><th className="r">Montant</th><th>Provenance</th><th>Statut</th></tr></thead>
          <tbody>
            {(rows || []).map((r) => {
              const n = daysBetween(r.check_in, r.check_out);
              return (
                <tr key={r.id} className="click" onClick={() => openFolio(r.id)}>
                  <td className="strong">{r.code}</td>
                  <td>{r.vip ? <Crown size={13} color="var(--warn)" /> : null} {guestName(r)}<div className="muted small">{r.phone}</div></td>
                  <td><b>{r.room_number}</b></td>
                  <td>{fmtDate(r.check_in)}</td><td>{fmtDate(r.check_out)}</td>
                  <td className="r num">{n}</td><td className="r num">{money(r.rate)}</td><td className="r num strong">{money(n * r.rate)}</td>
                  <td className="muted">{r.source}</td>
                  <td><StatusBadge map={RES_STATUS} value={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows && !rows.length && <Empty>Aucune réservation</Empty>}
      </div>
    </Card>
  );
}

function Movements({ openFolio }) {
  const t = localDay();
  const [arr] = useData('hotel.reservations', [{ status: 'confirmee', to: t }], []);
  const [inHouse] = useData('hotel.inHouse');
  const deps = (inHouse || []).filter((r) => r.check_out <= t);
  const row = (r, icon) => (
    <div key={r.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => openFolio(r.id)}>
      {icon}<div style={{ flex: 1 }}><b>{guestName(r)}</b><div className="muted small">{r.code} · Ch. {r.room_number}</div></div>
      <span className="small muted">{fmtShort(r.check_in)} → {fmtShort(r.check_out)}</span>
    </div>
  );
  return (
    <div className="grid g3">
      <Card title="Arrivées du jour" right={<Badge kind="info">{(arr || []).filter((r) => r.check_in <= t).length}</Badge>}>
        {(arr || []).filter((r) => r.check_in <= t).map((r) => row(r, <LogIn size={16} color="var(--good)" />))}
        {arr && !arr.filter((r) => r.check_in <= t).length && <Empty>Aucune arrivée</Empty>}
      </Card>
      <Card title="Départs du jour" right={<Badge kind="warn">{deps.length}</Badge>}>
        {deps.map((r) => row(r, <LogOut size={16} color="var(--warn)" />))}
        {!deps.length && <Empty>Aucun départ</Empty>}
      </Card>
      <Card title="Clients en séjour" right={<Badge kind="good">{(inHouse || []).length}</Badge>}>
        <div style={{ maxHeight: 520, overflow: 'auto' }}>{(inHouse || []).map((r) => row(r, <BedDouble size={16} color="var(--accent)" />))}</div>
        {inHouse && !inHouse.length && <Empty>Aucun client</Empty>}
      </Card>
    </div>
  );
}

export default function HotelPage() {
  const [tab, setTab] = useState('board');
  const [resModal, setResModal] = useState(null);
  const [folio, setFolio] = useState(null);
  return (
    <div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[['board', 'Plan des chambres', LayoutGrid], ['planning', 'Planning', CalendarDays], ['moves', 'Arrivées & départs', LogIn], ['list', 'Réservations', List]]} />
        <div className="grow" />
        <button className="btn primary" onClick={() => setResModal({})}><Plus size={16} />Nouvelle réservation</button>
      </div>
      {tab === 'board' && <RoomBoard openFolio={setFolio} newRes={setResModal} />}
      {tab === 'planning' && <Planning openFolio={setFolio} newRes={setResModal} />}
      {tab === 'moves' && <Movements openFolio={setFolio} />}
      {tab === 'list' && <ReservationsList openFolio={setFolio} />}
      {resModal && <ReservationModal initial={resModal} onClose={() => setResModal(null)} onSaved={(r) => setFolio(r.id)} />}
      {folio && <FolioModal id={folio} onClose={() => setFolio(null)} onEdit={(r) => setResModal(r)} />}
    </div>
  );
}
