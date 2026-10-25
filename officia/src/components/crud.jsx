import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { call } from '../lib/api';
import { act } from '../lib/hooks';
import { Modal, Field, Input, Select, confirmBox } from './ui';

// Formulaire générique : fields = [{ k, label, type: text|number|select|check|textarea|date|color, options, full }]
export function EditModal({ table, title, fields, initial = {}, onClose, onSaved, channel = 'db.save', deletable = true }) {
  const [f, setF] = useState(initial);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    for (const fl of fields) if (fl.required && (f[fl.k] === undefined || f[fl.k] === '')) return act(() => Promise.reject(new Error(`« ${fl.label} » est obligatoire`)));
    const r = await act(() => call(channel, ...(channel === 'db.save' ? [table, f] : [f])), 'Enregistré');
    if (r) { onSaved && onSaved(r); onClose(); }
  };
  const remove = async () => {
    if (!(await confirmBox('Supprimer définitivement cet élément ?', { danger: true, okLabel: 'Supprimer' }))) return;
    if (await act(() => call('db.remove', table, f.id), 'Supprimé')) { onSaved && onSaved(null); onClose(); }
  };
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        {f.id && deletable && <button className="btn danger" onClick={remove}><Trash2 size={16} />Supprimer</button>}
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" onClick={save}>Enregistrer</button>
      </>}>
      <div className="form">
        {fields.map((fl) => {
          const full = fl.full || fl.type === 'textarea';
          if (fl.type === 'check') {
            return (
              <label key={fl.k} className={`check ${full ? 'full' : ''}`} style={{ alignSelf: 'end', height: 38 }}>
                <input type="checkbox" checked={!!f[fl.k]} onChange={(e) => set(fl.k)(e.target.checked ? 1 : 0)} /> {fl.label}
              </label>
            );
          }
          let el;
          if (fl.type === 'select') el = <Select value={f[fl.k]} onChange={set(fl.k)} options={fl.options} placeholder={'placeholder' in fl ? fl.placeholder : '—'} />;
          else if (fl.type === 'textarea') el = <textarea className="input" value={f[fl.k] || ''} onChange={(e) => set(fl.k)(e.target.value)} />;
          else if (fl.type === 'color') el = <input type="color" className="input" style={{ padding: 4 }} value={f[fl.k] || '#5b8cff'} onChange={(e) => set(fl.k)(e.target.value)} />;
          else el = <Input type={fl.type || 'text'} value={f[fl.k]} onChange={set(fl.k)} placeholder={fl.placeholder} />;
          return <Field key={fl.k} label={fl.label} full={full}>{el}</Field>;
        })}
      </div>
    </Modal>
  );
}
