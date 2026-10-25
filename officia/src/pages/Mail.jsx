import { useEffect, useState } from 'react';
import {
  Inbox, Star, Send, FileEdit, Clock, Archive, Trash2, RefreshCw, Reply, Forward, PenSquare, Paperclip, ListChecks,
  CalendarPlus, Search, MailOpen, AlertTriangle, Settings2, ShieldCheck,
} from 'lucide-react';
import { call, on } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtDateTime, fmtLong, ago, fmtTime, relDay } from '../lib/format';
import { Empty, toast } from '../components/ui';

const FOLDERS = [
  ['inbox', 'Boîte de réception', Inbox], ['starred', 'Favoris', Star], ['sent', 'Envoyés', Send], ['drafts', 'Brouillons', FileEdit],
  ['outbox', 'Boîte d’envoi', Clock], ['archive', 'Archives', Archive], ['trash', 'Corbeille', Trash2],
];
const quote = (m) => `\n\n\nLe ${fmtLong(m.date)} à ${fmtTime(m.date)}, ${m.from_name || m.from_addr} a écrit :\n${String(m.text || '').split('\n').map((l) => `> ${l}`).join('\n')}`;

export default function Mail() {
  const { open, go, nav } = useApp();
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(nav.id || null);
  const [msg, setMsg] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [list, reload] = useData(folder === 'starred' ? 'mail.starred' : 'mail.list', folder === 'starred' ? [] : [{ folder, q }], [folder, q]);
  const [counts, reloadCounts] = useData('mail.counts');
  const [accounts] = useData('mail.accounts');
  useEffect(() => on('mail:synced', () => { reload(); reloadCounts(); setSyncing(false); }), [reload, reloadCounts]);
  useEffect(() => {
    if (!sel) return setMsg(null);
    call('mail.get', sel).then((m) => { setMsg(m); reloadCounts(); }).catch(() => setMsg(null));
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nav.id) setSel(nav.id); }, [nav.k]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => { setSyncing(true); await act(() => call('mail.sync')); setSyncing(false); reload(); reloadCounts(); };
  const move = async (folderTo, label) => { if (!msg) return; await act(() => call('mail.update', msg.id, { folder: folderTo }), label); setSel(null); reload(); reloadCounts(); };
  const star = async () => { const r = await act(() => call('mail.update', msg.id, { starred: msg.starred ? 0 : 1 })); if (r) { setMsg(r); reload(); } };
  const remove = async () => { if (msg.folder === 'trash') { await call('db.remove', 'mails', msg.id); setSel(null); reload(); reloadCounts(); } else move('trash', 'Message placé dans la corbeille'); };
  const reply = (all) => open('mail', { to_addr: msg.from_addr, cc: all ? msg.cc : '', subject: /^re\s*:/i.test(msg.subject || '') ? msg.subject : `Re : ${msg.subject || ''}`, text: quote(msg), in_reply_to: msg.message_id, account_id: msg.account_id !== 'demo' ? msg.account_id : undefined, title: 'Répondre' });
  const forward = () => open('mail', { subject: `Tr : ${msg.subject || ''}`, text: `\n\n---------- Message transféré ----------\nDe : ${msg.from_name || ''} <${msg.from_addr}>\nDate : ${fmtDateTime(msg.date)}\nObjet : ${msg.subject}\n\n${msg.text || ''}`, attachments: msg.attachments || [], title: 'Transférer' });
  const toTask = () => open('task', { title: msg.subject || 'Suite à donner au message', description: `Message de ${msg.from_name || msg.from_addr} du ${fmtDateTime(msg.date)} :\n\n${(msg.text || '').slice(0, 800)}` });
  const toEvent = () => open('event', { title: msg.subject || '', type: 'rdv', description: `Suite au message de ${msg.from_name || msg.from_addr}` });
  const openItem = (m) => { if (folder === 'drafts') return open('mail', { ...m, title: 'Brouillon' }); setSel(m.id); };

  return (
    <div className="mail">
      <div className="mail-folders">
        <button className="btn primary" style={{ marginBottom: 10 }} onClick={() => open('mail')}><PenSquare size={16} />Nouveau message</button>
        {FOLDERS.map(([k, l, I]) => {
          const c = k === 'starred' ? counts?.starred?.n : k === 'inbox' ? counts?.inbox?.unread : k === 'outbox' || k === 'drafts' ? counts?.[k]?.n : 0;
          return (
            <button key={k} className={`nav-item ${folder === k ? 'active' : ''}`} onClick={() => { setFolder(k); setSel(null); }}>
              <I size={16} />{l}{c > 0 && <span className={`count ${k === 'inbox' ? 'hot' : ''}`}>{c}</span>}
            </button>
          );
        })}
        <div style={{ marginTop: 'auto' }} className="col">
          {(accounts || []).map((a) => (
            <div key={a.id} className="small" style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--panel)' }}>
              <div className="strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.email}</div>
              <div className={a.last_error ? 'neg-val' : 'muted'} style={{ fontSize: 11 }}>{a.last_error ? 'Erreur de connexion' : a.last_sync ? `Relevé ${ago(a.last_sync)}` : 'Jamais relevé'}</div>
            </div>
          ))}
          {accounts && !accounts.length && <button className="btn sm" onClick={() => go('settings', { tab: 'mail' })}><Settings2 size={14} />Configurer un compte</button>}
        </div>
      </div>

      <div className="mail-list">
        <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--border-soft)' }}>
          <div className="search" style={{ flex: 1 }}><Search size={15} /><input className="input" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn icon" title="Relever les messages" onClick={sync}><RefreshCw size={16} className={syncing ? 'spin' : ''} /></button>
        </div>
        <div className="items">
          {(list || []).map((m) => (
            <div key={m.id} className={`mitem ${sel === m.id ? 'active' : ''} ${m.read ? '' : 'unread'}`} onClick={() => openItem(m)}>
              <span className="who">{folder === 'sent' || folder === 'outbox' || folder === 'drafts' ? `À : ${m.to_addr || '—'}` : m.from_name || m.from_addr}</span>
              <span className="when">{relDay(m.date) === 'Aujourd’hui' ? fmtTime(m.date) : relDay(m.date)}</span>
              <span className="subj">{m.starred ? '★ ' : ''}{(Array.isArray(m.attachments) && m.attachments.length) ? '📎 ' : ''}{m.subject || '(sans objet)'}</span>
              <span className="prev">{m.error ? <span className="neg-val">{m.error}</span> : m.preview}</span>
            </div>
          ))}
          {list && !list.length && <Empty icon={MailOpen}>Aucun message</Empty>}
        </div>
        {folder === 'outbox' && list && list.length > 0 && <div style={{ padding: 10, borderTop: '1px solid var(--border-soft)' }}><button className="btn sm" style={{ width: '100%' }} onClick={sync}><RefreshCw size={14} />Réessayer l’envoi maintenant</button></div>}
      </div>

      <div className="mail-read">
        {msg ? (
          <>
            <div className="head">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <h2 style={{ margin: 0, fontSize: 19, userSelect: 'text' }}>{msg.subject || '(sans objet)'}</h2>
                <button className="btn ghost icon" title="Favori" onClick={star}><Star size={18} color={msg.starred ? 'var(--warn)' : undefined} fill={msg.starred ? 'var(--warn)' : 'none'} /></button>
              </div>
              <div className="row mt" style={{ gap: 12 }}>
                <div className="avatar">{(msg.from_name || msg.from_addr || '?').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0, userSelect: 'text' }}>
                  <div><b>{msg.from_name || msg.from_addr}</b> <span className="muted small">&lt;{msg.from_addr}&gt;</span></div>
                  <div className="muted small">À : {msg.to_addr}{msg.cc ? ` · Cc : ${msg.cc}` : ''}</div>
                </div>
                <span className="muted small">{fmtDateTime(msg.date)}</span>
              </div>
              {msg.error && <div className="row small mt" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} />{msg.error}</div>}
              <div className="row wrap mt" style={{ gap: 6 }}>
                {msg.folder !== 'outbox' && <><button className="btn sm" onClick={() => reply(false)}><Reply size={14} />Répondre</button><button className="btn sm" onClick={() => reply(true)}>Répondre à tous</button><button className="btn sm" onClick={forward}><Forward size={14} />Transférer</button></>}
                <button className="btn sm" onClick={toTask}><ListChecks size={14} />Créer une tâche</button>
                <button className="btn sm" onClick={toEvent}><CalendarPlus size={14} />Planifier</button>
                <div className="right row" style={{ gap: 6 }}>
                  {msg.folder !== 'archive' && msg.folder !== 'outbox' && <button className="btn sm ghost" title="Archiver" onClick={() => move('archive', 'Message archivé')}><Archive size={15} /></button>}
                  {msg.folder === 'trash' || msg.folder === 'archive' ? <button className="btn sm ghost" title="Remettre dans la boîte de réception" onClick={() => move('inbox', 'Message restauré')}><Inbox size={15} /></button> : null}
                  <button className="btn sm ghost" title="Supprimer" onClick={remove}><Trash2 size={15} /></button>
                </div>
              </div>
              {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                <div className="row wrap mt" style={{ gap: 6 }}>
                  {msg.attachments.map((a, i) => <span key={i} className="att" onClick={() => call('file.open', a.path).catch((e) => toast(e.message, 'error'))}><Paperclip size={13} />{a.filename}</span>)}
                </div>
              )}
            </div>
            <div className="body">
              {msg.html ? (
                <>
                  <div className="row muted small" style={{ gap: 6, marginBottom: 8 }}><ShieldCheck size={13} />Affichage sécurisé : scripts et images distantes bloqués.</div>
                  <iframe title="message" sandbox="" srcDoc={msg.html} style={{ height: 'calc(100% - 30px)' }} />
                </>
              ) : msg.text}
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <Empty icon={MailOpen}>Sélectionnez un message<br /><span className="small">{(counts?.inbox?.unread || 0)} non lu(s) dans la boîte de réception</span></Empty>
          </div>
        )}
      </div>
    </div>
  );
}
