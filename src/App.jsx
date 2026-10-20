import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, BedDouble, UtensilsCrossed, Wine, Package, Users, Wallet, Receipt, BarChart3, Settings as Cog,
  LogOut, Hotel, Cloud, CloudOff, RefreshCw, Sun, Moon,
} from 'lucide-react';
import { call, on } from './lib/api';
import { AppCtx } from './lib/context';
import { setCurrency } from './lib/format';
import { Toasts, ConfirmHost, toast } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import HotelPage from './pages/Hotel';
import Pos from './pages/Pos';
import Stock from './pages/Stock';
import Guests from './pages/Guests';
import Cash from './pages/Cash';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const PAGES = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, right: 'dashboard', comp: Dashboard, group: 'Pilotage' },
  { id: 'hotel', label: 'Hôtel', icon: BedDouble, right: 'hotel', comp: HotelPage, group: 'Exploitation' },
  { id: 'restaurant', label: 'Restaurant', icon: UtensilsCrossed, right: 'pos', comp: Pos, props: { outlet: 'restaurant' }, group: 'Exploitation' },
  { id: 'bar', label: 'Bar', icon: Wine, right: 'pos', comp: Pos, props: { outlet: 'bar' }, group: 'Exploitation' },
  { id: 'guests', label: 'Clients', icon: Users, right: 'guests', comp: Guests, group: 'Exploitation' },
  { id: 'stock', label: 'Stocks', icon: Package, right: 'stock', comp: Stock, group: 'Gestion' },
  { id: 'cash', label: 'Caisse', icon: Wallet, right: 'cash', comp: Cash, group: 'Gestion' },
  { id: 'expenses', label: 'Dépenses', icon: Receipt, right: 'expenses', comp: Expenses, group: 'Gestion' },
  { id: 'reports', label: 'Rapports', icon: BarChart3, right: 'reports', comp: Reports, group: 'Gestion' },
  { id: 'settings', label: 'Paramètres', icon: Cog, right: 'settings', comp: Settings, group: 'Système' },
];

function SyncPill() {
  const [s, setS] = useState(null);
  useEffect(() => {
    call('sync.status').then(setS).catch(() => {});
    const off = on('sync:status', setS);
    const t = setInterval(() => call('sync.status').then(setS).catch(() => {}), 15000);
    return () => { off(); clearInterval(t); };
  }, []);
  if (!s) return null;
  const syncing = s.status === 'syncing';
  let icon = <CloudOff size={15} color="var(--muted)" />;
  let label = 'Mode local';
  if (s.status === 'ok') { icon = <Cloud size={15} color="var(--good)" />; label = 'Synchronisé'; }
  if (s.status === 'error') { icon = <CloudOff size={15} color="var(--warn)" />; label = 'Hors ligne'; }
  if (syncing) { icon = <RefreshCw size={15} className="spin" color="var(--accent)" />; label = 'Synchronisation…'; }
  const title = s.status === 'off' ? 'Aucun serveur configuré : les données restent sur ce poste.'
    : `${s.lastError ? `Erreur : ${s.lastError}\n` : ''}Dernière synchro : ${s.lastSync ? new Date(s.lastSync).toLocaleString('fr-FR') : 'jamais'}`;
  return (
    <button className="sync-pill" title={title} onClick={() => call('sync.now').then(setS).catch((e) => toast(e.message, 'error'))}>
      {icon}{label}{s.pending > 0 && s.status !== 'off' && <span className="badge warn">{s.pending} en attente</span>}
    </button>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return (
    <div className="col" style={{ gap: 0, textAlign: 'right' }}>
      <b className="num">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</b>
      <span className="muted small">{now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'dark');

  const reloadSettings = useCallback(async () => {
    const s = await call('settings.get');
    setCurrency(s.currency);
    setSettings(s);
    return s;
  }, []);
  useEffect(() => { reloadSettings().catch(() => {}); }, [reloadSettings]);
  useEffect(() => on('data:changed', (tables) => tables.includes('settings') && reloadSettings()), [reloadSettings]);

  const allowed = useMemo(() => {
    if (!user) return [];
    const r = user.rights || [];
    return PAGES.filter((p) => r.includes('*') || r.includes(p.right));
  }, [user]);

  useEffect(() => {
    if (user && !allowed.find((p) => p.id === page)) setPage(allowed[0] ? allowed[0].id : 'dashboard');
  }, [user, allowed, page]);

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch { /* ignoré */ }
    setTheme(t);
  };

  const logout = async () => { await call('auth.logout'); setUser(null); };

  const ctx = useMemo(() => ({ user, settings, reloadSettings, setPage, theme }), [user, settings, reloadSettings, theme]);

  if (!settings) return null;
  if (!user) {
    return (
      <AppCtx.Provider value={ctx}>
        <Login settings={settings} onLogin={(u) => { setUser(u); reloadSettings(); }} />
        <Toasts />
      </AppCtx.Provider>
    );
  }

  const current = allowed.find((p) => p.id === page) || allowed[0];
  const Comp = current ? current.comp : () => null;
  const groups = [...new Set(allowed.map((p) => p.group))];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo"><Hotel size={20} /></div>
            <div><b>Hospitalis</b><small>{settings.hotel_name}</small></div>
          </div>
          {groups.map((g) => (
            <div key={g}>
              <div className="nav-label">{g}</div>
              {allowed.filter((p) => p.group === g).map((p) => (
                <button key={p.id} className={`nav-item ${current && current.id === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)}>
                  <p.icon size={18} /> {p.label}
                </button>
              ))}
            </div>
          ))}
          <div className="sidebar-foot">
            <div className="user-chip">
              <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div className="muted small">{({ admin: 'Administrateur', manager: 'Gérant', reception: 'Réception', serveur: 'Serveur', barman: 'Barman', caissier: 'Caissier' })[user.role]}</div>
              </div>
              <button className="btn ghost sm icon right" title="Changer de thème" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
              <button className="btn ghost sm icon" title="Verrouiller / changer d’utilisateur" onClick={logout}><LogOut size={16} /></button>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div>
              <h1>{current && current.label}</h1>
              <div className="sub">{settings.hotel_name}</div>
            </div>
            <div className="spacer" />
            <SyncPill />
            <Clock />
          </header>
          <div className="content">
            {current && <Comp key={current.id} {...(current.props || {})} />}
          </div>
        </main>
      </div>
      <Toasts />
      <ConfirmHost />
    </AppCtx.Provider>
  );
}
