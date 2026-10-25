import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Home as HomeIcon, CalendarDays, Users2, Mail as MailIcon, ListChecks, Contact, Inbox, PhoneCall, Settings as Cog,
  Search, Bell, Plus, Sun, Moon, Lock, Sparkles, CalendarPlus, Handshake, BellRing, Send, FileText, Phone, StickyNote,
  CheckCheck, Trash2, X, CornerDownLeft, UserRound,
} from 'lucide-react';
import { call, on } from './lib/api';
import { AppCtx } from './lib/context';
import { ago, initials } from './lib/format';
import { ABOUT } from './lib/about';
import { Toasts, ConfirmHost, toast } from './components/ui';
import { ModalHost } from './components/modals';
import Setup, { LockScreen } from './pages/Setup';
import Home from './pages/Home';
import Agenda from './pages/Agenda';
import Meetings from './pages/Meetings';
import Mail from './pages/Mail';
import Tasks from './pages/Tasks';
import Contacts from './pages/Contacts';
import Courrier from './pages/Courrier';
import Calls from './pages/Calls';
import Settings from './pages/Settings';

const PAGES = [
  { id: 'home', label: 'Ma journée', icon: HomeIcon, comp: Home, group: 'Accueil' },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays, comp: Agenda, group: 'Organisation' },
  { id: 'meetings', label: 'Réunions & PV', icon: Users2, comp: Meetings, group: 'Organisation' },
  { id: 'tasks', label: 'Tâches & rappels', icon: ListChecks, comp: Tasks, group: 'Organisation', badge: 'tasks' },
  { id: 'mail', label: 'Messagerie', icon: MailIcon, comp: Mail, group: 'Communication', badge: 'mail' },
  { id: 'calls', label: 'Appels', icon: PhoneCall, comp: Calls, group: 'Communication', badge: 'calls' },
  { id: 'courrier', label: 'Courrier', icon: Inbox, comp: Courrier, group: 'Communication', badge: 'courrier' },
  { id: 'contacts', label: 'Contacts', icon: Contact, comp: Contacts, group: 'Communication' },
  { id: 'settings', label: 'Paramètres', icon: Cog, comp: Settings, group: 'Système' },
];

const QUICK = [
  ['event', 'Rendez-vous', CalendarPlus], ['meeting', 'Réunion', Handshake], ['task', 'Tâche', ListChecks], ['reminder', 'Rappel', BellRing],
  ['mail', 'Message', Send], ['courrier', 'Courrier', FileText], ['call', 'Appel reçu', Phone], ['note', 'Pense-bête', StickyNote],
];

const NOTIF_ICON = { meeting: Users2, event: CalendarDays, reminder: BellRing, task: ListChecks, mail: MailIcon, call: PhoneCall, courrier: Inbox, info: Sparkles };
const LINK_PAGE = { meeting: 'meetings', event: 'agenda', reminder: 'tasks', tasks: 'tasks', courrier: 'courrier', calls: 'calls', mail: 'mail', home: 'home' };
const SEARCH_PAGE = { contact: 'contacts', event: 'agenda', meeting: 'meetings', task: 'tasks', mail: 'mail', courrier: 'courrier', call: 'calls' };
const SEARCH_LABEL = { contact: 'Contacts', event: 'Agenda', meeting: 'Réunions', task: 'Tâches', mail: 'Messages', courrier: 'Courrier', call: 'Appels' };

function Palette({ onClose, go, open }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim().length >= 2) call('search', q).then((r) => { setRes(r); setSel(0); }).catch(() => {}); else setRes([]); }, 150);
    return () => clearTimeout(t);
  }, [q]);
  const actions = q.trim().length < 2 ? QUICK.map(([k, l, I]) => ({ type: 'action', id: k, title: `Nouveau : ${l}`, icon: I })) : [];
  const items = [...actions, ...res];
  const choose = (it) => {
    onClose();
    if (it.type === 'action') open(it.id);
    else go(SEARCH_PAGE[it.type], { id: it.id, type: it.type, date: it.date });
  };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter' && items[sel]) choose(items[sel]);
    if (e.key === 'Escape') onClose();
  };
  let lastGroup = null;
  return (
    <div className="palette" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box2">
        <div style={{ position: 'relative' }}>
          <Search size={20} style={{ position: 'absolute', left: 18, top: 19, color: 'var(--muted)' }} />
          <input autoFocus placeholder="Rechercher un contact, un rendez-vous, un message, un courrier…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} />
        </div>
        <div className="res">
          {items.map((it, i) => {
            const grp = it.type === 'action' ? 'Créer' : SEARCH_LABEL[it.type];
            const head = grp !== lastGroup ? <div className="grp">{grp}</div> : null;
            lastGroup = grp;
            const I = it.icon || { contact: UserRound, event: CalendarDays, meeting: Users2, task: ListChecks, mail: MailIcon, courrier: Inbox, call: PhoneCall }[it.type];
            return (
              <div key={`${it.type}-${it.id}`}>
                {head}
                <div className={`ri ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => choose(it)}>
                  <I size={17} color="var(--accent)" />
                  <div style={{ flex: 1, minWidth: 0 }}><div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>{it.sub && <div className="muted small">{it.sub}</div>}</div>
                  {i === sel && <CornerDownLeft size={14} color="var(--muted)" />}
                </div>
              </div>
            );
          })}
          {q.trim().length >= 2 && !res.length && <div className="empty">Aucun résultat pour « {q} »</div>}
        </div>
      </div>
    </div>
  );
}

function NotifDrawer({ onClose, go }) {
  const [list, setList] = useState([]);
  const load = useCallback(() => call('notif.list').then(setList).catch(() => {}), []);
  useEffect(() => { load(); return on('data:changed', (t) => t.includes('notifications') && load()); }, [load]);
  const openN = async (n) => { await call('notif.read', n.id); onClose(); if (LINK_PAGE[n.link_type]) go(LINK_PAGE[n.link_type], { id: n.link_id, type: n.link_type }); };
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={onClose} />
      <div className="drawer">
        <div className="head">
          <Bell size={18} color="var(--accent)" /><b style={{ fontSize: 16 }}>Notifications</b>
          <div className="right row" style={{ gap: 6 }}>
            <button className="btn sm ghost" title="Tout marquer comme lu" onClick={() => call('notif.read', null).then(load)}><CheckCheck size={15} /></button>
            <button className="btn sm ghost" title="Effacer les notifications lues" onClick={() => call('notif.clear').then(load)}><Trash2 size={15} /></button>
            <button className="btn sm ghost icon" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="items">
          {list.map((n) => {
            const I = NOTIF_ICON[n.kind] || Bell;
            return (
              <div key={n.id} className={`nitem ${n.read ? '' : 'unread'}`} onClick={() => openN(n)}>
                <div className="ic"><I size={16} color="var(--accent)" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="strong">{n.title}</div>
                  {n.body && <div className="muted small">{n.body}</div>}
                  <div className="muted small" style={{ marginTop: 4 }}>{ago(n.date)}</div>
                </div>
                {!n.read && <i className="dot" style={{ background: 'var(--accent)', marginTop: 6 }} />}
              </div>
            );
          })}
          {!list.length && <div className="empty"><Bell size={34} style={{ opacity: 0.4 }} /><div>Aucune notification</div></div>}
        </div>
      </div>
    </>
  );
}

function QuickMenu({ onClose, open }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div className="card" style={{ position: 'fixed', top: 70, left: 270, zIndex: 41, width: 440, padding: 14, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}>
        <div className="quick">
          {QUICK.map(([k, l, I]) => <button key={k} onClick={() => { onClose(); open(k); }}><I size={20} color="var(--accent)" />{l}</button>)}
        </div>
      </div>
    </>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);
  return (
    <div className="col" style={{ gap: 0, textAlign: 'right' }}>
      <b className="num">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b>
      <span className="muted small">{now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | setup | locked | ready
  const [settings, setSettings] = useState(null);
  const [nav, setNav] = useState({ page: 'home' });
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [quick, setQuick] = useState(false);
  const [modal, setModal] = useState(null);
  const [badges, setBadges] = useState({});
  const navKey = useRef(0);

  const reloadSettings = useCallback(async () => { const s = await call('settings.get'); setSettings(s); return s; }, []);

  useEffect(() => {
    (async () => {
      const s = await reloadSettings();
      const info = await call('app.info');
      if (info.firstRun) return setPhase('setup');
      if (await call('app.autoUnlock')) setPhase('ready'); else setPhase('locked');
      if (s.theme && !localStorage.getItem('theme')) { document.documentElement.dataset.theme = s.theme; setTheme(s.theme); }
    })().catch((e) => toast(e.message, 'error'));
  }, [reloadSettings]);

  const loadBadges = useCallback(async () => {
    try {
      const [unread, counts, dash] = await Promise.all([call('notif.unread'), call('mail.counts'), call('dashboard')]);
      setBadges({ notif: unread, mail: (counts.inbox || {}).unread || 0, tasks: dash.kpi.lateTasks + dash.tasksToday.filter((t) => t.due === dash.today).length, calls: dash.kpi.callsTodo, courrier: dash.kpi.courrierTodo });
    } catch { /* verrouillé */ }
  }, []);
  useEffect(() => {
    if (phase !== 'ready') return undefined;
    loadBadges();
    const offs = [on('data:changed', loadBadges), on('notifications:new', (list) => { loadBadges(); for (const n of list.slice(0, 2)) toast(n.title, 'info'); })];
    return () => offs.forEach((f) => f());
  }, [phase, loadBadges]);

  const go = useCallback((page, opts = {}) => { navKey.current += 1; setNav({ page, ...opts, k: navKey.current }); }, []);
  const open = useCallback((kind, data = {}) => {
    if (kind === 'meeting') return go('meetings', { create: true, data });
    if (kind === 'mail') return setModal({ kind: 'compose', data });
    setModal({ kind, data });
  }, [go]);
  useEffect(() => on('navigate', (link) => link && go(link.page, link)), [go]);

  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); setQuick(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* ignoré */ }
    setTheme(t);
  };
  const lock = async () => { if (await call('app.lock')) setPhase('locked'); else toast('Définissez un code de verrouillage dans Paramètres › Sécurité', 'info'); };

  const ctx = useMemo(() => ({ settings, reloadSettings, go, open, theme, nav }), [settings, reloadSettings, go, open, theme, nav]);

  if (phase === 'loading' || !settings) return null;
  if (phase === 'setup') return <AppCtx.Provider value={ctx}><Setup onDone={async () => { await reloadSettings(); setPhase('ready'); }} /><Toasts /></AppCtx.Provider>;
  if (phase === 'locked') return <AppCtx.Provider value={ctx}><LockScreen settings={settings} onUnlock={() => setPhase('ready')} /><Toasts /></AppCtx.Provider>;

  const current = PAGES.find((p) => p.id === nav.page) || PAGES[0];
  const Comp = current.comp;
  const groups = [...new Set(PAGES.map((p) => p.group))];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo"><Sparkles size={20} /></div>
            <div><b>OfficiaTech</b><small>{settings.organisation || 'Assistant administratif'}</small></div>
          </div>
          <button className="btn primary" style={{ margin: '0 4px 6px', height: 40 }} onClick={() => setQuick(true)}><Plus size={17} />Nouveau</button>
          {groups.map((g) => (
            <div key={g}>
              <div className="nav-label">{g}</div>
              {PAGES.filter((p) => p.group === g).map((p) => (
                <button key={p.id} className={`nav-item ${current.id === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
                  <p.icon size={18} /> {p.label}
                  {p.badge && badges[p.badge] > 0 && <span className={`count ${p.badge === 'mail' ? 'hot' : ''}`}>{badges[p.badge]}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="sidebar-foot">
            <div className="user-chip">
              <div className="avatar">{initials(settings.user_name)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.user_name}</div>
                <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.user_title}</div>
              </div>
              <button className="btn ghost sm icon right" title="Thème clair / sombre" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
              <button className="btn ghost sm icon" title="Verrouiller" onClick={lock}><Lock size={16} /></button>
            </div>
            <div className="muted" style={{ fontSize: 10.5, textAlign: 'center', lineHeight: 1.4 }}>{ABOUT.name} v{ABOUT.version}<br />par {ABOUT.author}</div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar" style={{ position: 'relative' }}>
            <div>
              <h1>{current.label}</h1>
              <div className="sub">{settings.organisation}</div>
            </div>
            <div className="spacer" />
            <button className="search-btn" onClick={() => setPalette(true)}><Search size={16} />Rechercher partout…<kbd>Ctrl K</kbd></button>
            <button className="icon-btn" title="Notifications" onClick={() => setDrawer(true)}>
              <Bell size={18} />{badges.notif > 0 && <span className="count">{badges.notif > 99 ? '99+' : badges.notif}</span>}
            </button>
            <Clock />
          </header>
          <div className="content">
            <Comp key={current.id} />
          </div>
        </main>
      </div>
      {quick && <QuickMenu onClose={() => setQuick(false)} open={open} />}
      {palette && <Palette onClose={() => setPalette(false)} go={go} open={open} />}
      {drawer && <NotifDrawer onClose={() => { setDrawer(false); loadBadges(); }} go={go} />}
      <ModalHost modal={modal} onClose={() => setModal(null)} />
      <Toasts />
      <ConfirmHost />
    </AppCtx.Provider>
  );
}

