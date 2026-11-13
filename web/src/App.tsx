import { usePollar } from '@pollar/react';
import { useState, type FormEvent } from 'react';

type Invoice = { id: string; amount: string; description: string; recipient: string; status: 'pending' | 'paid'; };

const storageKey = 'privatepay-invoices';

function readInvoices(): Invoice[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Invoice[]; } catch { return []; }
}

export default function App() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();
  const [invoices, setInvoices] = useState<Invoice[]>(readInvoices);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<Invoice | null>(null);

  function createInvoice(event: FormEvent) {
    event.preventDefault();
    if (!amount || Number(amount) <= 0 || !description.trim()) return;
    const invoice: Invoice = { id: crypto.randomUUID().slice(0, 8), amount, description: description.trim(), recipient: wallet?.address ?? 'testnet-wallet', status: 'pending' };
    const next = [invoice, ...invoices];
    setInvoices(next); setCreated(invoice); setAmount(''); setDescription('');
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function markPaid(invoice: Invoice) {
    const next = invoices.map((item) => item.id === invoice.id ? { ...item, status: 'paid' as const } : item);
    setInvoices(next); setCreated(next.find((item) => item.id === invoice.id) ?? null); localStorage.setItem(storageKey, JSON.stringify(next));
  }

  return (
    <main>
      <section className="card">
        <p className="eyebrow">PRIVATEPAY · TESTNET</p>
        <h1>Private invoices, simpler payouts.</h1>
        <p className="muted">Connect your Pollar wallet to manage freelancer payments.</p>
        {isAuthenticated ? (
          <div className="session">
            <p>Logged in wallet</p>
            <code>{wallet?.address ?? 'Wallet address pending'}</code>
            <button onClick={() => void logout()}>Log out</button>
            <hr />
            <h2>Create an invoice</h2>
            <form onSubmit={createInvoice} className="form">
              <label>Amount (NGN)<input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="25000" required /></label>
              <label>What are you charging for?<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Logo design" required /></label>
              <button type="submit">Create payment link</button>
            </form>
            {created && <div className="invoice"><span className="badge">{created.status === 'paid' ? 'PAID' : 'PENDING'}</span><h2>{created.description}</h2><strong>₦{Number(created.amount).toLocaleString()}</strong><code>{window.location.origin}/?invoice={created.id}</code>{created.status === 'pending' && <button onClick={() => markPaid(created)}>Simulate testnet payment</button>}</div>}
            {invoices.length > 0 && <div className="history"><h2>Recent invoices</h2>{invoices.map((invoice) => <div className="row" key={invoice.id}><span>{invoice.description}<small>₦{Number(invoice.amount).toLocaleString()}</small></span><span className={invoice.status}>{invoice.status}</span></div>)}</div>}
          </div>
        ) : (
          <button onClick={openLoginModal}>Log in with Pollar</button>
        )}
      </section>
    </main>
  );
}
