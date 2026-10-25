import { useEffect, useState } from 'react';
import { Plus, PhoneCall, PhoneIncoming, PhoneOutgoing, Check, CalendarPlus, Download, Search } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtDateTime, ago, CALL_STATUS } from '../lib/format';
import { Tabs, Card, Badge, StatusBadge, Empty } from '../components/ui';

export default function Calls() {
  const { open, nav } = useApp();
  const [status, setStatus] = useState('a_rappeler');
  const [q, setQ] = useState('');
  const [rows] = useData('calls.list', [{ status, q }], [status, q]);
  useEffect(() => { if (nav.id && nav.type === 'call') call('db.get', 'calls', nav.id).then((c) => c && open('call', c)).catch(() => {}); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = rows || [];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <Tabs value={status} onChange={setStatus} tabs={[['a_rappeler', 'À rappeler'], ['rappele', 'Rappelés'], ['info', 'Pour information'], ['', 'Tous']]} />
        <div className="search" style={{ width: 280 }}><Search size={16} /><input className="input" placeholder="Nom, société, message…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grow" />
        <button className="btn" onClick={() => call('export.csv', 'journal-appels', list.map((c) => ({ Date: c.date, Appelant: c.caller, Societe: c.company, Telephone: c.phone, Pour: c.for_whom, Message: c.message, Urgent: c.urgent ? 'oui' : '', Statut: CALL_STATUS[c.status][0] })))}><Download size={16} />Excel</button>
        <button className="btn primary" onClick={() => open('call')}><Plus size={16} />Message téléphonique</button>
      </div>
      <Card title="Journal des appels" hint="Messages pris pendant l’absence de vos interlocuteurs">
        {list.map((c) => (
          <div key={c.id} className="list-row" style={{ cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => open('call', c)}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: c.urgent && c.status === 'a_rappeler' ? 'var(--bad-soft)' : 'var(--accent-soft)', flex: 'none' }}>
              {c.direction === 'sortant' ? <PhoneOutgoing size={17} color="var(--accent)" /> : <PhoneIncoming size={17} color={c.urgent && c.status === 'a_rappeler' ? 'var(--bad)' : 'var(--accent)'} />}
            </div>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8 }}><b>{c.caller}</b>{c.company && <span className="muted">· {c.company}</span>}{c.urgent ? <Badge kind="bad">Urgent</Badge> : null}</div>
              <div style={{ margin: '3px 0' }}>{c.message || <span className="muted">Pas de message</span>}</div>
              <div className="muted small">{fmtDateTime(c.date)} ({ago(c.date)}){c.for_whom ? ` · pour ${c.for_whom}` : ''}{c.phone ? ` · ${c.phone}` : ''}</div>
            </div>
            <StatusBadge map={CALL_STATUS} value={c.status} />
            {c.status === 'a_rappeler' && <>
              <button className="btn sm" title="Planifier le rappel" onClick={(e) => { e.stopPropagation(); open('event', { type: 'appel', title: `Rappeler ${c.caller}`, contact_id: c.contact_id, description: c.message }); }}><CalendarPlus size={14} /></button>
              <button className="btn sm good" onClick={(e) => { e.stopPropagation(); act(() => call('calls.save', { id: c.id, status: 'rappele' }), 'Marqué comme rappelé'); }}><Check size={14} />Rappelé</button>
            </>}
          </div>
        ))}
        {rows && !list.length && <Empty icon={PhoneCall}>Aucun appel</Empty>}
      </Card>
    </div>
  );
}
