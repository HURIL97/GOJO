import { useMemo, useState } from 'react';
import { Package, Plus, ArrowDownToLine, ClipboardCheck, History, Tags, Truck, AlertTriangle, Download, MinusCircle } from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { money, num, fmtDateTime, OUTLETS } from '../lib/format';
import { Tabs, Card, Badge, SearchBox, Empty, Modal, Field, Input, Select } from '../components/ui';
import { EditModal } from '../components/crud';

const MOVE_TYPES = { entree: ['Entrée', 'good'], vente: ['Vente', 'info'], perte: ['Perte / casse', 'bad'], sortie: ['Sortie', 'warn'], ajustement: ['Ajustement', ''], inventaire: ['Inventaire', ''] };

function MoveModal({ products, suppliers, initial, onClose }) {
  const [f, setF] = useState({ type: 'entree', qty: '', unit_cost: '', ...initial });
  const p = products.find((x) => x.id === f.product_id);
  const save = async () => { if (await act(() => call('stock.move', f), 'Mouvement enregistré')) onClose(); };
  return (
    <Modal title="Mouvement de stock" icon={<ArrowDownToLine size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></>}>
      <div className="form">
        <Field label="Article" full><Select value={f.product_id} onChange={(v) => setF((x) => ({ ...x, product_id: v, unit_cost: (products.find((y) => y.id === v) || {}).cost }))} placeholder="— Choisir —" options={products.filter((x) => x.track_stock).map((x) => [x.id, `${x.name} (stock ${num(x.stock)})`])} /></Field>
        <Field label="Type"><Select value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v }))} options={[['entree', 'Entrée (réception)'], ['perte', 'Perte / casse'], ['sortie', 'Sortie (usage interne)'], ['ajustement', 'Ajustement (+/-)']]} /></Field>
        <Field label={`Quantité${p ? ` (${p.unit})` : ''}`}><Input type="number" value={f.qty} onChange={(v) => setF((x) => ({ ...x, qty: v }))} /></Field>
        {f.type === 'entree' && <>
          <Field label="Coût unitaire d’achat"><Input type="number" value={f.unit_cost} onChange={(v) => setF((x) => ({ ...x, unit_cost: v }))} /></Field>
          <Field label="Fournisseur"><Select value={f.supplier_id} onChange={(v) => setF((x) => ({ ...x, supplier_id: v }))} options={suppliers.map((s) => [s.id, s.name])} /></Field>
        </>}
        <Field label="Note" full><Input value={f.note} onChange={(v) => setF((x) => ({ ...x, note: v }))} placeholder="N° bon de livraison, motif…" /></Field>
      </div>
    </Modal>
  );
}

function Inventory({ products, onDone }) {
  const tracked = products.filter((p) => p.track_stock);
  const [counts, setCounts] = useState({});
  const save = async () => {
    const list = Object.entries(counts).filter(([, v]) => v !== '' && v != null).map(([product_id, counted]) => ({ product_id, counted }));
    const n = await act(() => call('stock.inventory', list));
    if (n !== undefined) { setCounts({}); onDone(n); }
  };
  return (
    <Card title="Inventaire physique" hint="Saisissez les quantités comptées ; l’écart est enregistré automatiquement." right={<button className="btn primary" onClick={save}><ClipboardCheck size={16} />Valider l’inventaire</button>}>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="tbl">
          <thead><tr><th>Article</th><th>Catégorie</th><th className="r">Théorique</th><th style={{ width: 160 }}>Compté</th><th className="r">Écart</th><th className="r">Valeur écart</th></tr></thead>
          <tbody>
            {tracked.map((p) => {
              const c = counts[p.id];
              const diff = c === undefined || c === '' ? null : Number(c) - p.stock;
              return (
                <tr key={p.id}>
                  <td className="strong">{p.name}</td><td className="muted">{p.category_name}</td><td className="r num">{num(p.stock, true)} {p.unit}</td>
                  <td><Input type="number" value={c ?? ''} onChange={(v) => setCounts((x) => ({ ...x, [p.id]: v }))} /></td>
                  <td className={`r num ${diff > 0 ? 'pos-val' : diff < 0 ? 'neg-val' : ''}`}>{diff == null ? '' : num(diff, true)}</td>
                  <td className="r num">{diff == null ? '' : money(diff * p.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Stock() {
  const [tab, setTab] = useState('products');
  const [products, reload] = useData('stock.list');
  const [cats, reloadCats] = useData('db.list', ['categories', {}, 'sort']);
  const [suppliers, reloadSup] = useData('db.list', ['suppliers', {}, 'name']);
  const [moves] = useData('stock.moves', [], [tab]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  const [editCat, setEditCat] = useState(null);
  const [editSup, setEditSup] = useState(null);

  const list = useMemo(() => (products || []).filter((p) => (!cat || p.category_id === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))), [products, q, cat]);
  if (!products || !cats || !suppliers) return null;
  const tracked = products.filter((p) => p.track_stock);
  const low = tracked.filter((p) => p.stock <= p.stock_min);
  const value = tracked.reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0);

  const productFields = [
    { k: 'name', label: 'Désignation', required: true, full: true },
    { k: 'category_id', label: 'Catégorie', type: 'select', options: cats.map((c) => [c.id, c.name]) },
    { k: 'outlet', label: 'Vendu au', type: 'select', options: Object.entries(OUTLETS).filter(([k]) => k !== 'hotel'), placeholder: undefined },
    { k: 'price', label: 'Prix de vente TTC', type: 'number', required: true },
    { k: 'cost', label: 'Coût de revient / achat', type: 'number' },
    { k: 'unit', label: 'Unité', placeholder: 'bouteille, kg, portion…' },
    { k: 'stock_min', label: 'Seuil d’alerte', type: 'number' },
    { k: 'supplier_id', label: 'Fournisseur', type: 'select', options: suppliers.map((s) => [s.id, s.name]) },
    { k: 'barcode', label: 'Code-barres' },
    { k: 'track_stock', label: 'Suivre le stock', type: 'check' },
    { k: 'active', label: 'Actif à la vente', type: 'check' },
  ];

  return (
    <div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="label"><span className="ico"><Package size={16} /></span>Articles</div><div className="value">{products.length}</div><div className="delta">{tracked.length} suivis en stock</div></div>
        <div className="card kpi"><div className="label"><span className="ico"><Package size={16} /></span>Valeur du stock</div><div className="value num">{money(value)}</div><div className="delta">au coût d’achat</div></div>
        <div className="card kpi"><div className="label"><span className="ico" style={{ color: 'var(--warn)', background: 'var(--warn-soft)' }}><AlertTriangle size={16} /></span>Sous le seuil</div><div className="value">{low.length}</div><div className="delta">à réapprovisionner</div></div>
        <div className="card kpi"><div className="label"><span className="ico" style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}><MinusCircle size={16} /></span>En rupture</div><div className="value">{tracked.filter((p) => p.stock <= 0).length}</div><div className="delta">stock nul ou négatif</div></div>
      </div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[['products', 'Articles', Package], ['moves', 'Mouvements', History], ['inventory', 'Inventaire', ClipboardCheck], ['cats', 'Catégories', Tags], ['suppliers', 'Fournisseurs', Truck]]} />
        <div className="grow" />
        <button className="btn" onClick={() => call('export.csv', 'stock', products.map((p) => ({ Article: p.name, Categorie: p.category_name, Stock: p.stock, Unite: p.unit, Seuil: p.stock_min, Cout: p.cost, Prix: p.price, Valeur: p.value })))}><Download size={16} />Excel</button>
        <button className="btn" onClick={() => setMove({})}><ArrowDownToLine size={16} />Mouvement</button>
        <button className="btn primary" onClick={() => setEdit({ track_stock: 1, active: 1, outlet: 'both', unit: 'unité' })}><Plus size={16} />Article</button>
      </div>

      {tab === 'products' && (
        <Card>
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} />
            <div style={{ width: 220 }}><Select value={cat} onChange={setCat} placeholder="Toutes catégories" options={cats.map((c) => [c.id, c.name])} /></div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 400px)' }}>
            <table className="tbl">
              <thead><tr><th>Article</th><th>Catégorie</th><th>Vente</th><th className="r">Prix</th><th className="r">Coût</th><th className="r">Marge</th><th className="r">Stock</th><th className="r">Valeur</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                    <td className="strong">{p.name} {!p.active && <Badge>inactif</Badge>}</td><td className="muted">{p.category_name}</td><td>{OUTLETS[p.outlet]}</td>
                    <td className="r num">{money(p.price)}</td><td className="r num muted">{money(p.cost)}</td>
                    <td className="r num pos-val">{p.price ? Math.round(((p.price - p.cost) / p.price) * 100) : 0} %</td>
                    <td className="r">{p.track_stock ? <Badge kind={p.stock <= 0 ? 'bad' : p.stock <= p.stock_min ? 'warn' : 'good'}>{num(p.stock, true)} {p.unit}</Badge> : <span className="muted">—</span>}</td>
                    <td className="r num">{p.track_stock ? money(p.value) : ''}</td>
                    <td className="r">{p.track_stock ? <button className="btn sm" onClick={(e) => { e.stopPropagation(); setMove({ product_id: p.id, unit_cost: p.cost }); }}><Plus size={13} />Entrée</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <Empty icon={Package}>Aucun article</Empty>}
          </div>
        </Card>
      )}
      {tab === 'moves' && (
        <Card>
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Article</th><th>Type</th><th className="r">Quantité</th><th className="r">Coût unit.</th><th>Note</th><th>Par</th></tr></thead>
              <tbody>
                {(moves || []).map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDateTime(m.date)}</td><td className="strong">{m.product_name}</td>
                    <td><Badge kind={(MOVE_TYPES[m.type] || [])[1]}>{(MOVE_TYPES[m.type] || [m.type])[0]}</Badge></td>
                    <td className={`r num ${m.qty > 0 ? 'pos-val' : 'neg-val'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty, true)}</td>
                    <td className="r num">{m.unit_cost ? money(m.unit_cost) : ''}</td><td className="muted">{m.note}</td><td>{m.user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === 'inventory' && <Inventory products={products} onDone={(n) => { reload(); act(async () => n, `${n} écart(s) enregistré(s)`); }} />}
      {tab === 'cats' && (
        <Card right={<button className="btn primary sm" onClick={() => setEditCat({ outlet: 'both', sort: cats.length })}><Plus size={14} />Catégorie</button>} title="Catégories de la carte">
          <div className="grid g4">
            {cats.map((c) => (
              <div key={c.id} className="card" style={{ cursor: 'pointer', boxShadow: 'none', borderLeft: `4px solid ${c.color || 'var(--accent)'}` }} onClick={() => setEditCat(c)}>
                <b>{c.name}</b><div className="muted small">{OUTLETS[c.outlet]} · {products.filter((p) => p.category_id === c.id).length} article(s)</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === 'suppliers' && (
        <Card right={<button className="btn primary sm" onClick={() => setEditSup({})}><Plus size={14} />Fournisseur</button>} title="Fournisseurs">
          <table className="tbl">
            <thead><tr><th>Nom</th><th>Téléphone</th><th>E-mail</th><th>Adresse</th></tr></thead>
            <tbody>{suppliers.map((s) => <tr key={s.id} className="click" onClick={() => setEditSup(s)}><td className="strong">{s.name}</td><td>{s.phone}</td><td>{s.email}</td><td className="muted">{s.address}</td></tr>)}</tbody>
          </table>
          {!suppliers.length && <Empty icon={Truck}>Aucun fournisseur</Empty>}
        </Card>
      )}

      {edit && <EditModal table="products" title={edit.id ? 'Modifier l’article' : 'Nouvel article'} fields={productFields} initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {move && <MoveModal products={products} suppliers={suppliers} initial={move} onClose={() => { setMove(null); reload(); }} />}
      {editCat && <EditModal table="categories" title="Catégorie" initial={editCat} onClose={() => setEditCat(null)} onSaved={reloadCats}
        fields={[{ k: 'name', label: 'Nom', required: true, full: true }, { k: 'outlet', label: 'Point de vente', type: 'select', options: Object.entries(OUTLETS).filter(([k]) => k !== 'hotel'), placeholder: undefined }, { k: 'sort', label: 'Ordre d’affichage', type: 'number' }, { k: 'color', label: 'Couleur', type: 'color' }]} />}
      {editSup && <EditModal table="suppliers" title="Fournisseur" initial={editSup} onClose={() => setEditSup(null)} onSaved={reloadSup}
        fields={[{ k: 'name', label: 'Nom', required: true, full: true }, { k: 'phone', label: 'Téléphone' }, { k: 'email', label: 'E-mail' }, { k: 'address', label: 'Adresse', full: true }, { k: 'notes', label: 'Notes', type: 'textarea' }]} />}
    </div>
  );
}
