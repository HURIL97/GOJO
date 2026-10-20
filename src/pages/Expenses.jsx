import { useState } from 'react';
import { Receipt, Plus, Download } from 'lucide-react';
import { call } from '../lib/api';
import { useData } from '../lib/hooks';
import { money, fmtDate, localDay, addDays, METHODS, OUTLETS } from '../lib/format';
import { Card, Empty, Badge } from '../components/ui';
import { EditModal } from '../components/crud';
import { Bars, cssVar } from '../components/charts';

export const EXPENSE_CATS = ['Achats cuisine', 'Boissons', 'Salaires', 'Électricité', 'Eau', 'Carburant / groupe', 'Entretien', 'Blanchisserie', 'Internet / téléphone', 'Loyer', 'Taxes', 'Marketing', 'Autre'];

export default function Expenses() {
  const [from, setFrom] = useState(`${localDay().slice(0, 7)}-01`);
  const [to, setTo] = useState(localDay());
  const [rows, reload] = useData('expenses.list', [{ from, to }], [from, to]);
  const [suppliers] = useData('db.list', ['suppliers', {}, 'name']);
  const [edit, setEdit] = useState(null);
  const total = (rows || []).reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  for (const e of rows || []) byCat[e.category || 'Autre'] = (byCat[e.category || 'Autre'] || 0) + e.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const fields = [
    { k: 'date', label: 'Date', type: 'date', required: true },
    { k: 'amount', label: 'Montant', type: 'number', required: true },
    { k: 'category', label: 'Catégorie', type: 'select', options: EXPENSE_CATS, required: true },
    { k: 'method', label: 'Payé par', type: 'select', options: Object.entries(METHODS).filter(([k]) => k !== 'chambre') },
    { k: 'label', label: 'Libellé', full: true, required: true },
    { k: 'supplier_id', label: 'Fournisseur', type: 'select', options: (suppliers || []).map((s) => [s.id, s.name]) },
    { k: 'outlet', label: 'Affecté à', type: 'select', options: Object.entries(OUTLETS) },
  ];
  return (
    <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
      <Card>
        <div className="toolbar">
          <input type="date" className="input" style={{ width: 170 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted">→</span>
          <input type="date" className="input" style={{ width: 170 }} value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn sm" onClick={() => { setFrom(addDays(localDay(), -29)); setTo(localDay()); }}>30 j</button>
          <div className="grow" />
          <button className="btn" onClick={() => call('export.csv', 'depenses', (rows || []).map((e) => ({ Date: e.date.slice(0, 10), Categorie: e.category, Libelle: e.label, Montant: e.amount, Mode: METHODS[e.method], Fournisseur: e.supplier_name })))}><Download size={16} />Excel</button>
          <button className="btn primary" onClick={() => setEdit({ date: localDay(), method: 'especes' })}><Plus size={16} />Dépense</button>
        </div>
        <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Catégorie</th><th>Libellé</th><th>Fournisseur</th><th>Mode</th><th className="r">Montant</th></tr></thead>
            <tbody>
              {(rows || []).map((e) => (
                <tr key={e.id} className="click" onClick={() => setEdit({ ...e, date: e.date.slice(0, 10) })}>
                  <td>{fmtDate(e.date)}</td><td><Badge>{e.category}</Badge></td><td className="strong">{e.label}</td><td className="muted">{e.supplier_name}</td><td>{METHODS[e.method]}</td><td className="r num strong">{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>Total</td><td className="r num">{money(total)}</td></tr></tfoot>
          </table>
          {rows && !rows.length && <Empty icon={Receipt}>Aucune dépense sur la période</Empty>}
        </div>
      </Card>
      <Card title="Répartition" hint={`Total : ${money(total)}`}>
        {cats.length ? <Bars horizontal height={Math.max(200, cats.length * 34)} labels={cats.map((c) => c[0])} data={cats.map((c) => c[1])} label="Dépenses" color={cssVar('--s-svc')} /> : <Empty>—</Empty>}
      </Card>
      {edit && <EditModal table="expenses" title={edit.id ? 'Modifier la dépense' : 'Nouvelle dépense'} fields={fields} initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
