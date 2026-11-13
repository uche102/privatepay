import { usePollar } from '@pollar/react';
import { useState, type FormEvent } from 'react';

type Invoice = { id: string; amount: string; description: string; recipient: string; zcashAddress: string; status: 'pending' | 'paid'; };
const demoZcashAddress = 'utest152yu6ln3kfhf204k6u6gr42307tq05gekuyvxuzy275zf37z43ruuvx58hvy6lfrcxkh4cz7njx5lfauqvndns0f82p5axtd2epau9dkue5fwx94nx0emyyky3eelztlzc3e2f0gfzhgggxrp2j0xyuu2ffpj6ep6wz9f0hzrgsxkezt';

const storageKey = 'privatepay-invoices';

function readInvoices(): Invoice[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Invoice[]; } catch { return []; }
}

export default function App() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();
  const [invoices, setInvoices] = useState<Invoice[]>(readInvoices);
  const invoiceId = new URLSearchParams(window.location.search).get('invoice');
  const publicInvoice = invoiceId ? invoices.find((invoice) => invoice.id === invoiceId) : null;
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<Invoice | null>(null);

  function createInvoice(event: FormEvent) {
    event.preventDefault();
    if (!amount || Number(amount) <= 0 || !description.trim()) return;
    const invoice: Invoice = { id: crypto.randomUUID().slice(0, 8), amount, description: description.trim(), recipient: wallet?.address ?? 'testnet-wallet', zcashAddress: demoZcashAddress, status: 'pending' };
    const next = [invoice, ...invoices];
    setInvoices(next); setCreated(invoice); setAmount(''); setDescription('');
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function markPaid(invoice: Invoice) {
    const next = invoices.map((item) => item.id === invoice.id ? { ...item, status: 'paid' as const } : item);
    setInvoices(next); setCreated(next.find((item) => item.id === invoice.id) ?? null); localStorage.setItem(storageKey, JSON.stringify(next));
  }

  if (invoiceId) {
    return (
      <main>
        <section className="card public-invoice">
          <p className="eyebrow">PRIVATEPAY · SECURE INVOICE</p>
          {publicInvoice ? <>
            <span className="badge">{publicInvoice.status === 'paid' ? 'PAYMENT COMPLETE' : 'PAYMENT REQUEST'}</span>
            <h1>{publicInvoice.description}</h1>
            <p className="muted">Pay this invoice securely on Pollar testnet.</p>
            <strong className="amount">₦{Number(publicInvoice.amount).toLocaleString()}</strong>
            <p className="muted">Pollar settlement wallet</p>
            <code>{publicInvoice.recipient}</code>
            {publicInvoice.status === 'pending' ? <button onClick={() => markPaid(publicInvoice)}>Pay with Pollar testnet</button> : <><p className="paid-message">✓ Pollar payment confirmed</p><div className="payout"><span className="badge">ZCASH PAYOUT PENDING</span><p>Send <strong>0.001 ZEC</strong> on Zcash testnet to:</p><code>{publicInvoice.zcashAddress ?? demoZcashAddress}</code><p className="muted">The sender approves this payout in Noir Wallet.</p></div></>}
          </> : <><h1>Invoice not found</h1><p className="muted">This invoice link may have expired or is unavailable in this browser.</p></>}
        </section>
      </main>
    );
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
