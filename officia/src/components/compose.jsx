import { useEffect, useState } from 'react';
import { Send, Paperclip, Save, X, FileText, Wand2 } from 'lucide-react';
import { call } from '../lib/api';
import { act } from '../lib/hooks';
import { useApp } from '../lib/context';
import { fmtLong, fmtTime, contactName } from '../lib/format';
import { Modal, Field, Select, toast } from './ui';

// Fenêtre de rédaction : destinataires avec suggestions, modèles, pièces jointes, PDF généré (convocation, PV).
export function ComposeModal({ data = {}, onClose }) {
  const { settings } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [m, setM] = useState({ to_addr: '', cc: '', subject: '', text: '', attachments: [], ...data, pdf: undefined });
  const [showCc, setShowCc] = useState(!!data.cc);
  const [sending, setSending] = useState(false);
  const set = (k) => (v) => setM((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    call('mail.accounts').then((a) => { setAccounts(a); setM((x) => ({ ...x, account_id: x.account_id || (a[0] && a[0].id) })); }).catch(() => {});
    call('contacts.list', '').then(setContacts).catch(() => {});
    call('db.list', 'templates', {}, 'name').then(setTemplates).catch(() => {});
  }, []);
  const account = accounts.find((a) => a.id === m.account_id);
  useEffect(() => {
    if (account && account.signature && !data.id && !m.signed) setM((x) => ({ ...x, text: `${x.text || ''}\n\n${account.signature}`.replace(/^\n+/, ''), signed: true }));
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastToken = (m.to_addr.split(/[,;]/).pop() || '').trim().toLowerCase();
  const already = m.to_addr.toLowerCase();
  const suggestions = lastToken.length >= 2 && !contacts.some((c) => c.email && c.email.toLowerCase() === lastToken)
    ? contacts.filter((c) => c.email && !already.includes(c.email.toLowerCase()) && `${contactName(c)} ${c.email} ${c.company || ''}`.toLowerCase().includes(lastToken)).slice(0, 6) : [];
  const pick = (c) => {
    const parts = m.to_addr.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    parts.pop();
    parts.push(c.email);
    set('to_addr')(`${parts.join(', ')}, `);
  };

  const applyTemplate = async (id) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const first = contacts.find((c) => c.email && m.to_addr.includes(c.email));
    const vars = {
      nom: first ? contactName(first) : 'Madame, Monsieur', organisation: settings.organisation, signature: account?.signature || `${settings.user_name}\n${settings.user_title}\n${settings.organisation}`,
      date: data.vars?.date || '', heure: data.vars?.heure || '', lieu: data.vars?.lieu || '', objet: data.vars?.objet || m.subject || '', ...(data.vars || {}),
    };
    const r = await call('templates.fill', tpl, vars);
    setM((x) => ({ ...x, subject: r.subject, text: r.body, signed: true }));
  };

  const attach = async () => { const files = await act(() => call('mail.pickFiles')); if (files && files.length) setM((x) => ({ ...x, attachments: [...(x.attachments || []), ...files] })); };
  const payload = () => { const p = { ...m }; delete p.signed; delete p.vars; delete p.pdfLabel; return p; };

  const sendNow = async () => {
    setSending(true);
    const r = await act(() => call('mail.send', payload(), data.pdf || null));
    setSending(false);
    if (!r) return;
    toast(r.status === 'sent' ? 'Message envoyé' : 'Pas de connexion : message placé en boîte d’envoi, il partira automatiquement', r.status === 'sent' ? 'success' : 'info');
    onClose(r);
  };
  const saveDraft = async () => { if (await act(() => call('mail.draft', payload()), 'Brouillon enregistré')) onClose(); };

  return (
    <Modal size="wide" title={data.id ? 'Brouillon' : data.title || 'Nouveau message'} icon={<Send size={19} color="var(--accent)" />} onClose={() => onClose()}
      footer={<>
        <button className="btn" onClick={attach}><Paperclip size={16} />Joindre</button>
        <button className="btn" onClick={saveDraft}><Save size={16} />Brouillon</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => onClose()}>Annuler</button>
        <button className="btn primary" disabled={sending} onClick={sendNow}><Send size={16} />{sending ? 'Envoi…' : 'Envoyer'}</button>
      </>}>
      <div className="col compose" style={{ gap: 12 }}>
        {!accounts.length && <div className="card" style={{ boxShadow: 'none', background: 'var(--warn-soft)', color: 'var(--warn)' }}>Aucun compte de messagerie : ajoutez votre adresse dans Paramètres › Messagerie pour envoyer des e-mails.</div>}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="De"><Select value={m.account_id} onChange={set('account_id')} options={accounts.map((a) => [a.id, `${a.display_name || a.name} <${a.email}>`])} placeholder={accounts.length ? undefined : '—'} /></Field>
          <Field label="Modèle"><Select value="" onChange={applyTemplate} placeholder="Insérer un modèle…" options={templates.map((t) => [t.id, `${t.category ? `${t.category} — ` : ''}${t.name}`])} /></Field>
        </div>
        <div style={{ position: 'relative' }}>
          <Field label={<span className="row between">À <button className="btn ghost sm" style={{ height: 20 }} onClick={() => setShowCc((v) => !v)}>Cc</button></span>}>
            <input className="input" value={m.to_addr} onChange={(e) => set('to_addr')(e.target.value)} placeholder="adresse@exemple.com, …" />
          </Field>
          {suggestions.length > 0 && (
            <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 64, zIndex: 5, padding: 6 }}>
              {suggestions.map((c) => <div key={c.id} className="ri row" style={{ padding: 8, borderRadius: 8, cursor: 'pointer' }} onClick={() => pick(c)}><b>{contactName(c)}</b><span className="muted small">{c.email}</span></div>)}
            </div>
          )}
        </div>
        {showCc && <Field label="Cc"><input className="input" value={m.cc || ''} onChange={(e) => set('cc')(e.target.value)} /></Field>}
        <Field label="Objet"><input className="input" value={m.subject} onChange={(e) => set('subject')(e.target.value)} /></Field>
        <Field label="Message"><textarea className="input" value={m.text} onChange={(e) => set('text')(e.target.value)} /></Field>
        <div className="row wrap" style={{ gap: 8 }}>
          {data.pdf && <span className="att"><FileText size={14} color="var(--bad)" />{data.pdf.filename}.pdf <span className="muted">(généré à l’envoi)</span></span>}
          {(m.attachments || []).map((a, i) => (
            <span key={i} className="att"><Paperclip size={13} />{a.filename}<X size={13} style={{ cursor: 'pointer' }} onClick={() => setM((x) => ({ ...x, attachments: x.attachments.filter((_, j) => j !== i) }))} /></span>
          ))}
          {!data.pdf && !(m.attachments || []).length && <span className="muted small row" style={{ gap: 6 }}><Wand2 size={13} />Astuce : les modèles remplissent automatiquement le nom, la date et votre signature.</span>}
        </div>
      </div>
    </Modal>
  );
}

// Prépare un message de confirmation de rendez-vous.
export function confirmationDraft(ev, contact) {
  return {
    to_addr: contact && contact.email ? contact.email : '',
    subject: `Confirmation de votre rendez-vous du ${fmtLong(ev.start)}`,
    vars: { date: fmtLong(ev.start), heure: fmtTime(ev.start), lieu: ev.location || 'dans nos locaux', objet: ev.title },
    text: '',
    title: 'Confirmer le rendez-vous',
  };
}
