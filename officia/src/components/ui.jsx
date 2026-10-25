import { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, ArrowUpRight, ArrowDownRight, Search } from 'lucide-react';
import { delta } from '../lib/format';

// ---------- Notifications ----------
let pushToast = () => {};
export const toast = (msg, kind = 'info') => pushToast({ msg, kind, id: Math.random() });

export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.kind === 'error' ? 6000 : 3200);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle size={18} color="var(--bad)" /> : t.kind === 'success' ? <CheckCircle2 size={18} color="var(--good)" /> : <Info size={18} color="var(--accent)" />}
          <div>{t.msg}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Boîtes de dialogue ----------
export function Modal({ title, icon, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`modal ${size}`}>
        <div className="modal-head">
          {icon}
          <h2>{title}</h2>
          <button className="btn ghost icon right" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

let openConfirm = () => {};
export function confirmBox(message, { danger, input, okLabel } = {}) {
  return new Promise((resolve) => openConfirm({ message, danger, input, okLabel, resolve }));
}
export function ConfirmHost() {
  const [c, setC] = useState(null);
  const [val, setVal] = useState('');
  useEffect(() => { openConfirm = (x) => { setVal(''); setC(x); }; }, []);
  if (!c) return null;
  const done = (v) => { c.resolve(v); setC(null); };
  return (
    <Modal title="Confirmation" onClose={() => done(false)}
      footer={<>
        <button className="btn" onClick={() => done(false)}>Annuler</button>
        <button className={`btn ${c.danger ? 'danger' : 'primary'}`} onClick={() => done(c.input ? val || '' : true)}>{c.okLabel || 'Confirmer'}</button>
      </>}>
      <p style={{ marginTop: 0 }}>{c.message}</p>
      {c.input && <input className="input" autoFocus placeholder={c.input} value={val} onChange={(e) => setVal(e.target.value)} />}
    </Modal>
  );
}

// ---------- Formulaires ----------
export function Field({ label, children, full }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Input({ value, onChange, ...p }) {
  return <input className="input" value={value ?? ''} onChange={(e) => onChange(p.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...p} />;
}

export function Select({ value, onChange, options, placeholder, ...p }) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Rechercher…', width = 280 }) {
  return (
    <div className="search" style={{ width }}>
      <Search size={16} />
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ---------- Affichage ----------
export function Badge({ children, kind = '' }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
export function StatusBadge({ map, value }) {
  const [label, kind] = map[value] || [value, ''];
  return <Badge kind={kind}>{label}</Badge>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(([k, label, Icon]) => (
        <button key={k} className={`tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>
          {Icon && <Icon size={15} />} {label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={34} style={{ opacity: 0.5, marginBottom: 8 }} />}
      <div>{children}</div>
    </div>
  );
}

export function Delta({ cur, prev, invert, suffix = 'vs période préc.' }) {
  const d = delta(cur, prev);
  const up = d >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="delta">
      <b style={{ color: Math.abs(d) < 0.05 ? 'var(--muted)' : good ? 'var(--good)' : 'var(--bad)' }}>
        <Icon size={14} />{Math.abs(d).toFixed(1).replace('.', ',')} %
      </b>
      <span>{suffix}</span>
    </div>
  );
}

export function Card({ title, hint, right, children, className = '', style }) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || right) && (
        <div className="card-head">
          <div>
            <h3>{title}</h3>
            {hint && <div className="hint">{hint}</div>}
          </div>
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
