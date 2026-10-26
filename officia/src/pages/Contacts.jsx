import { useEffect, useState } from 'react';
import { Plus, Star, Mail, Phone, Smartphone, Building2, MapPin, CalendarPlus, PhoneCall, Inbox, Download, Upload, Contact as ContactIcon, Pencil, Search } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { contactName, initials, fmtDateTime, fmtShort, TYPES } from '../lib/format';
import { Card, Empty, Badge, toast } from '../components/ui';

export default function Contacts() {
  const { open, nav } = useApp();
  const [q, setQ] = useState('');
  const [rows] = useData('contacts.list', [q], [q]);
  const [sel, setSel] = useState(nav.id || null);
  const [hist, setHist] = useState(null);
  useEffect(() => { if (nav.id) setSel(nav.id); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = (rows || []).find((x) => x.id === sel) || null;
  useEffect(() => { if (sel) call('contacts.history', sel).then(setHist).catch(() => setHist(null)); else setHist(null); }, [sel, rows]);
  const groups = {};
  for (const x of rows || []) { const L = x.favorite ? '★' : (contactName(x)[0] || '#').toUpperCase(); (groups[L] ||= []).push(x); }

  return (
    <div className="grid" style={{ gridTemplateColumns: '380px 1fr', height: 'calc(100vh - 150px)' }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0 }}>
        <div className="row" style={{ padding: 12, borderBottom: '1px solid var(--border-soft)' }}>
          <div className="search" style={{ flex: 1 }}><Search size={15} /><input className="input" placeholder="Nom, société, téléphone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn primary icon" title="Nouveau contact" onClick={() => open('contact')}><Plus size={17} /></button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {Object.entries(groups).map(([L, list]) => (
            <div key={L}>
              <div className="nav-label" style={{ padding: '10px 16px 4px' }}>{L === '★' ? 'Favoris' : L}</div>
              {list.map((x) => (
                <div key={x.id} className={`mitem ${sel === x.id ? 'active' : ''}`} style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center' }} onClick={() => setSel(x.id)}>
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, background: x.color || undefined }}>{initials(contactName(x))}</div>
                  <div style={{ minWidth: 0 }}><div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactName(x)}</div><div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[x.title, x.company].filter(Boolean).join(' · ')}</div></div>
                </div>
              ))}
            </div>
          ))}
          {rows && !rows.length && <Empty icon={ContactIcon}>Aucun contact</Empty>}
        </div>
        <div style={{ padding: 10, borderTop: '1px solid var(--border-soft)' }}>
          <button className="btn sm" style={{ width: '100%', marginBottom: 6 }} onClick={async () => { const r = await act(() => call('contacts.import')); if (r) toast(`${r.added} contact(s) importé(s)${r.skipped ? `, ${r.skipped} ignoré(s) (doublons ou lignes vides)` : ''}`, 'success'); }}><Upload size={14} />Importer (Excel, Outlook, Gmail)</button>
          <button className="btn sm" style={{ width: '100%' }} onClick={() => call('export.csv', 'contacts', (rows || []).map((x) => ({ Prenom: x.first_name, Nom: x.last_name, Societe: x.company, Fonction: x.title, Email: x.email, Telephone: x.phone, Mobile: x.mobile, Adresse: x.address })))}><Download size={14} />Exporter ({(rows || []).length})</button>
        </div>
      </div>
      {c ? (
        <div className="col" style={{ gap: 16, overflowY: 'auto' }}>
          <div className="card hero">
            <div className="row wrap" style={{ gap: 18 }}>
              <div className="avatar" style={{ width: 72, height: 72, fontSize: 24, background: c.color || undefined }}>{initials(contactName(c))}</div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <h2 style={{ margin: 0 }}>{contactName(c)} {c.favorite ? <Star size={18} color="var(--warn)" fill="var(--warn)" /> : null}</h2>
                <div className="muted">{[c.title, c.company].filter(Boolean).join(' — ')}</div>
                <div className="row wrap mt" style={{ gap: 6 }}>{(c.tags || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t} kind="info">{t}</Badge>)}</div>
              </div>
              <div className="row wrap">
                {c.email && <button className="btn" onClick={() => open('mail', { to_addr: c.email })}><Mail size={16} />Écrire</button>}
                <button className="btn" onClick={() => open('event', { type: 'rdv', contact_id: c.id, title: `Rendez-vous avec ${contactName(c)}` })}><CalendarPlus size={16} />Rendez-vous</button>
                <button className="btn" onClick={() => open('call', { contact_id: c.id, caller: contactName(c), company: c.company, phone: c.phone || c.mobile })}><PhoneCall size={16} />Noter un appel</button>
                <button className="btn primary" onClick={() => open('contact', c)}><Pencil size={16} />Modifier</button>
              </div>
            </div>
          </div>
          <div className="grid g2">
            <Card title="Coordonnées">
              {[[Mail, c.email, c.email && `mailto:${c.email}`], [Phone, c.phone], [Smartphone, c.mobile], [Building2, c.company], [MapPin, c.address]].filter(([, v]) => v).map(([I, v], i) => (
                <div key={i} className="list-row" style={{ userSelect: 'text' }}><I size={16} color="var(--accent)" />{v}</div>
              ))}
              {c.notes && <div className="sticky mt" style={{ '--nc': '#7b6cff' }}>{c.notes}</div>}
            </Card>
            <Card title="Historique des rendez-vous">
              {(hist?.events || []).slice(0, 8).map((e) => <div key={e.id} className="list-row small"><i className="dot" style={{ background: `var(--t-${e.type})` }} /><div style={{ flex: 1 }}><b>{e.title}</b><div className="muted">{TYPES[e.type]}</div></div><span className="muted">{fmtShort(e.start)}</span></div>)}
              {hist && !hist.events.length && <Empty>Aucun rendez-vous</Empty>}
            </Card>
            <Card title="Appels">
              {(hist?.calls || []).map((x) => <div key={x.id} className="list-row small"><PhoneCall size={14} /><div style={{ flex: 1 }}>{x.message || '—'}</div><span className="muted">{fmtDateTime(x.date)}</span></div>)}
              {hist && !hist.calls.length && <Empty>Aucun appel enregistré</Empty>}
            </Card>
            <Card title="Courriers">
              {(hist?.courrier || []).map((x) => <div key={x.id} className="list-row small"><Inbox size={14} /><div style={{ flex: 1 }}><b>{x.number}</b> {x.object}</div><span className="muted">{fmtShort(x.date)}</span></div>)}
              {hist && !hist.courrier.length && <Empty>Aucun courrier</Empty>}
            </Card>
          </div>
        </div>
      ) : <div className="card" style={{ display: 'grid', placeItems: 'center' }}><Empty icon={ContactIcon}>Sélectionnez un contact</Empty></div>}
    </div>
  );
}
