import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Plus, Minus, Send, Printer, Wallet, BedDouble, Ban, Percent, ShoppingBag, Banknote, CreditCard, Smartphone,
  Landmark, FileCheck, Trash2, StickyNote, History, LayoutGrid, Clock, Users, Search,
} from 'lucide-react';
import { call } from '../lib/api';
import { useData, act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { money, num, fmtTime, fmtDateTime, METHODS, ORDER_STATUS, localDay, guestName } from '../lib/format';
import { Modal, Tabs, Badge, StatusBadge, Empty, Field, Input, confirmBox, toast, Card } from '../components/ui';
import { receiptHtml, kitchenHtml, printHtml } from '../lib/print';

const PAY_ICONS = { especes: Banknote, carte: CreditCard, mobile_money: Smartphone, virement: Landmark, cheque: FileCheck };

function PaymentModal({ order, onClose, onPaid }) {
  const { settings } = useApp();
  const [method, setMethod] = useState('especes');
  const [entry, setEntry] = useState('');
  const [lines, setLines] = useState([]);
  const paid = lines.reduce((s, l) => s + l.amount, 0);
  const remaining = Math.max(0, order.total - paid);
  const typed = Number(entry) || 0;
  const change = Math.max(0, paid + typed - order.total);
  const press = (k) => setEntry((e) => (k === 'C' ? '' : k === '←' ? e.slice(0, -1) : (e + k).replace(/^0+(?=\d)/, '')));
  const quick = useMemo(() => {
    const r = remaining;
    const set = new Set([r]);
    for (const step of [1000, 2000, 5000, 10000]) set.add(Math.ceil(r / step) * step);
    return [...set].filter((x) => x > 0).sort((a, b) => a - b).slice(0, 4);
  }, [remaining]);

  const addLine = () => {
    const amount = typed || remaining;
    if (!amount) return;
    setLines((l) => [...l, { method, amount }]);
    setEntry('');
  };
  const finish = async () => {
    const all = typed ? [...lines, { method, amount: typed }] : lines.length ? lines : [{ method, amount: remaining }];
    const total = all.reduce((s, l) => s + l.amount, 0);
    if (total + 0.009 < order.total) return toast(`Il manque ${money(order.total - total)}`, 'error');
    const res = await act(() => call('pos.checkout', order.id, all), 'Commande encaissée');
    if (res) {
      const rendu = Math.max(0, total - order.total);
      onPaid(res);
      if (await confirmBox(`${rendu ? `Monnaie à rendre : ${money(rendu)}. ` : ''}Imprimer le ticket ?`, { okLabel: 'Imprimer' })) {
        printHtml(receiptHtml(res, settings, { change: rendu }));
      }
    }
  };

  return (
    <Modal size="wide" title={`Encaissement — ${order.number}`} icon={<Wallet size={20} color="var(--good)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn good lg" onClick={finish}>Valider l’encaissement</button></>}>
      <div className="grid g2" style={{ gap: 22 }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="card hero" style={{ boxShadow: 'none' }}>
            <div className="muted">Total à payer</div>
            <div className="big num">{money(order.total)}</div>
            {lines.map((l, i) => (
              <div key={i} className="list-row small"><span>{METHODS[l.method]}</span><b className="right num">{money(l.amount)}</b>
                <button className="btn ghost sm icon" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>
            ))}
            <div className="row between mt"><span>Reste</span><b className="num" style={{ fontSize: 20 }}>{money(Math.max(0, remaining - typed))}</b></div>
            {change > 0 && <div className="row between"><span className="pos-val">Monnaie à rendre</span><b className="num pos-val" style={{ fontSize: 20 }}>{money(change)}</b></div>}
          </div>
          <div className="paymethods">
            {Object.entries(METHODS).filter(([k]) => k !== 'chambre').map(([k, l]) => {
              const I = PAY_ICONS[k];
              return <button key={k} className={`paym ${method === k ? 'active' : ''}`} onClick={() => setMethod(k)}><I size={20} />{l}</button>;
            })}
          </div>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="input num" style={{ height: 54, fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>{entry ? num(entry) : <span className="muted">{num(remaining)}</span>}</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {quick.map((q) => <button key={q} className="btn sm" onClick={() => setEntry(String(q))}>{num(q)}</button>)}
          </div>
          <div className="keypad">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '←'].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}
          </div>
          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={() => press('C')}>Effacer</button>
            <button className="btn" style={{ flex: 2 }} onClick={addLine}><Plus size={16} />Paiement partiel / mixte</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RoomChargeModal({ order, onClose, onDone }) {
  const [list] = useData('pos.inHouse');
  const [q, setQ] = useState('');
  const charge = async (r) => {
    if (!(await confirmBox(`Porter ${money(order.total)} sur la chambre ${r.room_number} (${guestName(r)}) ?`))) return;
    const res = await act(() => call('pos.chargeToRoom', order.id, r.id), `Transféré sur la chambre ${r.room_number}`);
    if (res) onDone(res);
  };
  const rows = (list || []).filter((r) => !q || `${r.room_number} ${guestName(r)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Transférer sur une chambre" icon={<BedDouble size={20} color="var(--accent)" />} onClose={onClose}>
      <div className="search" style={{ marginBottom: 12 }}><Search size={16} /><input className="input" autoFocus placeholder="N° de chambre ou nom…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {rows.map((r) => (
        <div key={r.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => charge(r)}>
          <div className="avatar">{r.room_number}</div><div style={{ flex: 1 }}><b>{guestName(r)}</b><div className="muted small">{r.code}</div></div><BedDouble size={16} />
        </div>
      ))}
      {list && !rows.length && <Empty icon={BedDouble}>Aucun client en séjour</Empty>}
    </Modal>
  );
}

function OrderScreen({ outlet, orderId, onBack }) {
  const { settings, user } = useApp();
  const [order, setOrder] = useState(null);
  const [catalog] = useData('pos.catalog', [outlet], [outlet]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [pay, setPay] = useState(false);
  const [room, setRoom] = useState(false);
  const load = () => call('pos.order', orderId).then(setOrder).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => {
    if (!catalog) return [];
    return catalog.products.filter((p) => (!cat || p.category_id === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  }, [catalog, cat, q]);
  const catColor = (id) => (catalog?.categories.find((c) => c.id === id) || {}).color || 'var(--accent)';

  if (!order) return null;
  const closed = order.status !== 'ouverte';
  const add = async (p) => { const r = await act(() => call('pos.addItem', order.id, p.id, 1)); if (r) setOrder(r); };
  const qty = async (it, d) => {
    if (it.sent && it.qty + d <= 0 && !(await confirmBox(`« ${it.name} » a déjà été envoyé. Annuler l’article ?`, { danger: true }))) return;
    const r = await act(() => call('pos.updateItem', it.id, { qty: it.qty + d })); if (r) setOrder(r);
  };
  const note = async (it) => {
    const n = await confirmBox(`Note pour « ${it.name} » (cuisson, sans sel…)`, { input: 'Note', okLabel: 'Enregistrer' });
    if (n === false) return;
    const r = await act(() => call('pos.updateItem', it.id, { note: n })); if (r) setOrder(r);
  };
  const discount = async () => {
    const v = await confirmBox('Remise sur la commande (montant, ou pourcentage suivi de %)', { input: 'ex. 1000 ou 10%', okLabel: 'Appliquer' });
    if (v === false) return;
    const amount = String(v).trim().endsWith('%') ? Math.round((order.subtotal * parseFloat(v)) / 100) : Number(v) || 0;
    const r = await act(() => call('pos.updateOrder', order.id, { discount: amount }), 'Remise appliquée'); if (r) setOrder(r);
  };
  const send = async () => {
    const r = await act(() => call('pos.send', order.id));
    if (!r) return;
    setOrder(r.order);
    if (!r.sent.length) return toast('Rien de nouveau à envoyer');
    toast(`${r.sent.length} article(s) envoyé(s) en ${outlet === 'bar' ? 'préparation bar' : 'cuisine'}`, 'success');
    printHtml(kitchenHtml(r.order, r.sent)).catch(() => {});
  };
  const cancel = async () => {
    const reason = await confirmBox('Motif de l’annulation de la commande', { input: 'Motif (obligatoire)', danger: true, okLabel: 'Annuler la commande' });
    if (reason === false) return;
    if (!reason) return toast('Le motif est obligatoire', 'error');
    if (await act(() => call('pos.cancel', order.id, reason), 'Commande annulée')) onBack();
  };

  return (
    <div className="pos">
      <div className="pos-left">
        <div className="row">
          <button className="btn" onClick={onBack}><ArrowLeft size={16} />Retour</button>
          <div className="search" style={{ flex: 1 }}><Search size={16} /><input className="input" placeholder="Rechercher un article…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="cats">
          <button className={`cat ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>Tout</button>
          {catalog?.categories.map((c) => (
            <button key={c.id} className={`cat ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}><i className="dot" style={{ background: c.color }} />{c.name}</button>
          ))}
        </div>
        <div className="products">
          {products.map((p) => (
            <button key={p.id} className="product" disabled={closed} onClick={() => add(p)}>
              <span className="stripe" style={{ background: catColor(p.category_id) }} />
              <span className="pname">{p.name}</span>
              {p.track_stock ? <span className={`stock badge ${p.stock <= 0 ? 'bad' : p.stock <= p.stock_min ? 'warn' : ''}`}>{num(p.stock)}</span> : null}
              <span className="price num">{money(p.price)}</span>
            </button>
          ))}
          {catalog && !products.length && <Empty>Aucun article</Empty>}
        </div>
      </div>
      <div className="card ticket">
        <div className="ticket-head">
          <div className="row between">
            <div>
              <b style={{ fontSize: 18 }}>{order.table ? `Table ${order.table.name}` : order.customer || 'Vente comptoir'}</b>
              <div className="muted small">{order.number} · ouverte à {fmtTime(order.opened_at)} · {user.name}</div>
            </div>
            <StatusBadge map={ORDER_STATUS} value={order.status} />
          </div>
          {!closed && (
            <div className="row small mt" style={{ gap: 6 }}>
              <Users size={14} /> Couverts
              <button className="btn sm icon" onClick={async () => { const r = await act(() => call('pos.updateOrder', order.id, { covers: Math.max(1, order.covers - 1) })); if (r) setOrder(r); }}><Minus size={12} /></button>
              <b>{order.covers}</b>
              <button className="btn sm icon" onClick={async () => { const r = await act(() => call('pos.updateOrder', order.id, { covers: order.covers + 1 })); if (r) setOrder(r); }}><Plus size={12} /></button>
            </div>
          )}
        </div>
        <div className="ticket-lines">
          {order.items.map((it) => (
            <div key={it.id} className="tline">
              <div>
                <div className="strong">{it.name} {it.sent ? <Badge kind="good">envoyé</Badge> : null}</div>
                <div className="muted small">{money(it.unit_price)} {it.note && <i>· {it.note}</i>}</div>
              </div>
              <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
                <b className="num">{money(it.amount)}</b>
                {!closed && (
                  <div className="qty">
                    <button onClick={() => note(it)} title="Note"><StickyNote size={12} /></button>
                    <button onClick={() => qty(it, -1)}><Minus size={12} /></button>
                    <b className="num" style={{ minWidth: 20, textAlign: 'center' }}>{num(it.qty, true)}</b>
                    <button onClick={() => qty(it, 1)}><Plus size={12} /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!order.items.length && <Empty icon={ShoppingBag}>Touchez un article pour l’ajouter</Empty>}
        </div>
        <div className="ticket-foot">
          <div className="total-line"><span>Sous-total</span><span className="num">{money(order.subtotal)}</span></div>
          {order.discount > 0 && <div className="total-line"><span>Remise</span><span className="num neg-val">- {money(order.discount)}</span></div>}
          <div className="total-line"><span>dont TVA {settings.vat_rate} %</span><span className="num">{money(order.total - order.total / (1 + (Number(settings.vat_rate) || 0) / 100))}</span></div>
          <div className="total-line grand"><span>Total</span><span className="num">{money(order.total)}</span></div>
          {!closed ? (
            <>
              <div className="grid g4" style={{ gap: 8 }}>
                <button className="btn" title="Envoyer en cuisine / bar" onClick={send}><Send size={15} /></button>
                <button className="btn" title="Imprimer l’addition" onClick={() => printHtml(receiptHtml(order, settings, { server: user.name }))}><Printer size={15} /></button>
                <button className="btn" title="Remise" onClick={discount}><Percent size={15} /></button>
                <button className="btn danger" title="Annuler la commande" onClick={cancel}><Ban size={15} /></button>
              </div>
              <div className="grid g2" style={{ gap: 8 }}>
                <button className="btn lg" disabled={!order.items.length} onClick={() => setRoom(true)}><BedDouble size={18} />Sur chambre</button>
                <button className="btn good lg" disabled={!order.items.length} onClick={() => setPay(true)}><Wallet size={18} />Encaisser</button>
              </div>
            </>
          ) : (
            <button className="btn lg" onClick={() => printHtml(receiptHtml(order, settings, { server: user.name }))}><Printer size={18} />Réimprimer le ticket</button>
          )}
        </div>
      </div>
      {pay && <PaymentModal order={order} onClose={() => setPay(false)} onPaid={() => { setPay(false); onBack(); }} />}
      {room && <RoomChargeModal order={order} onClose={() => setRoom(false)} onDone={() => { setRoom(false); onBack(); }} />}
    </div>
  );
}

function TablesView({ outlet, onOpen }) {
  const [tables] = useData('pos.tables', [outlet], [outlet]);
  const [open] = useData('pos.openOrders', [outlet], [outlet]);
  const counter = (open || []).filter((o) => !o.table_id);
  const zones = [...new Set((tables || []).map((t) => t.zone || 'Salle'))];
  return (
    <div className="col" style={{ gap: 18 }}>
      {counter.length > 0 && (
        <div>
          <div className="nav-label" style={{ paddingLeft: 2 }}>Ventes comptoir en cours</div>
          <div className="tables">
            {counter.map((o) => (
              <div key={o.id} className="dtable busy" onClick={() => onOpen(o.id)}>
                <span className="tname">{o.customer || 'Comptoir'}</span><span className="muted small">{o.number}</span><b className="num">{money(o.total)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      {zones.map((z) => (
        <div key={z}>
          <div className="nav-label" style={{ paddingLeft: 2 }}>{z}</div>
          <div className="tables">
            {tables.filter((t) => (t.zone || 'Salle') === z).map((t) => (
              <div key={t.id} className={`dtable ${t.order_id ? 'busy' : ''}`} onClick={async () => {
                const o = await act(() => call('pos.openOrder', { outlet, table_id: t.id }));
                if (o) onOpen(o.id);
              }}>
                <div className="row between"><span className="tname">{t.name}</span><span className="muted small row" style={{ gap: 4 }}><Users size={13} />{t.order_id ? t.covers : t.seats}</span></div>
                {t.order_id ? (
                  <>
                    <b className="num" style={{ fontSize: 17 }}>{money(t.order_total)}</b>
                    <span className="muted small row" style={{ gap: 4 }}><Clock size={12} />{fmtTime(t.opened_at)} · {t.server_name}</span>
                  </>
                ) : <span className="muted small">Libre</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {tables && !tables.length && <Empty icon={LayoutGrid}>Aucune table. Ajoutez-les dans Paramètres › Tables, ou utilisez la vente comptoir.</Empty>}
    </div>
  );
}

function HistoryView({ outlet }) {
  const [day, setDay] = useState(localDay());
  const [rows] = useData('pos.history', [{ from: day, to: day, outlet }], [day, outlet]);
  const [view, setView] = useState(null);
  const total = (rows || []).filter((o) => ['payee', 'chambre'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  return (
    <Card>
      <div className="toolbar">
        <input type="date" className="input" style={{ width: 180 }} value={day} onChange={(e) => setDay(e.target.value)} />
        <span className="right muted">{(rows || []).length} commande(s) · <b style={{ color: 'var(--text)' }}>{money(total)}</b></span>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Ticket</th><th>Heure</th><th>Table</th><th>Serveur</th><th className="r">Couverts</th><th className="r">Total</th><th>Statut</th></tr></thead>
          <tbody>
            {(rows || []).map((o) => (
              <tr key={o.id} className="click" onClick={async () => setView(await call('pos.order', o.id))}>
                <td className="strong">{o.number}</td><td>{fmtDateTime(o.closed_at || o.opened_at)}</td><td>{o.table_name || 'Comptoir'}</td><td>{o.server_name}</td>
                <td className="r">{o.covers}</td><td className="r num strong">{money(o.total)}</td><td><StatusBadge map={ORDER_STATUS} value={o.status} />{o.cancel_reason ? <span className="muted small"> {o.cancel_reason}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !rows.length && <Empty icon={History}>Aucune commande ce jour</Empty>}
      </div>
      {view && <OrderDetail order={view} onClose={() => setView(null)} />}
    </Card>
  );
}

function OrderDetail({ order, onClose }) {
  const { settings } = useApp();
  return (
    <Modal title={`Ticket ${order.number}`} onClose={onClose}
      footer={<button className="btn" onClick={() => printHtml(receiptHtml(order, settings))}><Printer size={16} />Réimprimer</button>}>
      <table className="tbl">
        <tbody>{order.items.map((i) => <tr key={i.id}><td>{num(i.qty, true)} × {i.name}</td><td className="r num">{money(i.amount)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td className="r num">{money(order.total)}</td></tr></tfoot>
      </table>
      <div className="mt">{order.payments.map((p) => <div key={p.id} className="list-row small"><span>{METHODS[p.method]}</span><b className="right">{money(p.amount)}</b></div>)}</div>
    </Modal>
  );
}

export default function Pos({ outlet }) {
  const [orderId, setOrderId] = useState(null);
  const [tab, setTab] = useState('tables');
  const [counterName, setCounterName] = useState(false);
  if (orderId) return <OrderScreen outlet={outlet} orderId={orderId} onBack={() => setOrderId(null)} />;
  const quickSale = async (customer) => {
    const o = await act(() => call('pos.openOrder', { outlet, customer }));
    if (o) setOrderId(o.id);
  };
  return (
    <div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[['tables', 'Salle', LayoutGrid], ['history', 'Historique', History]]} />
        <div className="grow" />
        <button className="btn" onClick={() => setCounterName(true)}><Plus size={16} />Vente nommée</button>
        <button className="btn primary" onClick={() => quickSale(null)}><ShoppingBag size={16} />Vente rapide</button>
      </div>
      {tab === 'tables' ? <TablesView outlet={outlet} onOpen={setOrderId} /> : <HistoryView outlet={outlet} />}
      {counterName && <NamePrompt onClose={() => setCounterName(false)} onOk={(n) => { setCounterName(false); quickSale(n); }} />}
    </div>
  );
}

function NamePrompt({ onClose, onOk }) {
  const [n, setN] = useState('');
  return (
    <Modal title="Nouvelle vente au comptoir" onClose={onClose} footer={<button className="btn primary" onClick={() => onOk(n || null)}>Ouvrir</button>}>
      <Field label="Nom du client ou repère (ex. « Groupe Konaté », « À emporter »)"><Input autoFocus value={n} onChange={setN} /></Field>
    </Modal>
  );
}
