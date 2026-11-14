import { usePollar } from '@pollar/react';
import { useEffect, useState, type FormEvent } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const API_KEY = import.meta.env.VITE_PRIVATEPAY_API_KEY ?? import.meta.env.VITE_API_KEY ?? '';
const shieldedAddressPattern = /^(?:u|z)[A-Za-z0-9]{20,}$/i;

type Invoice = {
  id: string;
  amountNgn: number;
  freelancerReceivesNgn: number;
  exchangeRateNgnPerZec: number;
  platformFeePercent: number;
  description: string;
  status: string;
  freelancerZcashAddress: string;
  clientPaymentReference: string | null;
  clientPaymentTxid: string | null;
  zcashPayoutTxid: string | null;
  createdAt: string;
  updatedAt: string;
};

function isShieldedAddress(value: string): boolean {
  return shieldedAddressPattern.test(value.trim());
}

function buildZcashPaymentUri(address: string, memo: string, amount = '0.001'): string {
  return `zcash:${address}?amount=${amount}&memo=${encodeURIComponent(memo)}`;
}

export default function App() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [exchangeRateNgnPerZec, setExchangeRateNgnPerZec] = useState('1500');
  const [platformFeePercent, setPlatformFeePercent] = useState('2.5');
  const [freelancerWalletAddress, setFreelancerWalletAddress] = useState('');
  const [freelancerZcashAddress, setFreelancerZcashAddress] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [publicInvoice, setPublicInvoice] = useState<Invoice | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [paymentRequest, setPaymentRequest] = useState('');
  const [paymentState, setPaymentState] = useState('');
  const invoiceId = new URLSearchParams(window.location.search).get('invoice');

  useEffect(() => {
    if (wallet?.address) {
      setFreelancerWalletAddress(wallet.address);
    }
  }, [wallet?.address]);

  useEffect(() => {
    if (!invoiceId) {
      setPublicInvoice(null);
      return;
    }

    if (!API_BASE) {
      setPublicInvoice(null);
      return;
    }

    fetch(`${API_BASE}/api/invoices/${invoiceId}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Invoice not found');
        }
        return response.json() as Promise<Invoice>;
      })
      .then((invoice) => setPublicInvoice(invoice))
      .catch(() => setPublicInvoice(null));
  }, [invoiceId]);

  const estimatedFreelancerPayout = Number(amount || 0) > 0 && Number(platformFeePercent || 0) >= 0
    ? Number((Number(amount) * (1 - Number(platformFeePercent) / 100)).toFixed(2))
    : 0;

  async function createInvoice(event: FormEvent) {
    event.preventDefault();

    if (!amount || Number(amount) <= 0) {
      setErrorMessage('Enter a valid NGN amount.');
      return;
    }

    if (!description.trim()) {
      setErrorMessage('Add a description for the invoice.');
      return;
    }

    if (!freelancerZcashAddress.trim() || !isShieldedAddress(freelancerZcashAddress)) {
      setErrorMessage('Use a real shielded Zcash testnet receiving address.');
      return;
    }

    const exchangeRate = Number(exchangeRateNgnPerZec);
    const feePercent = Number(platformFeePercent);

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setErrorMessage('The conversion rate must be a positive number.');
      return;
    }

    if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
      setErrorMessage('The platform fee must be between 0 and 100.');
      return;
    }

    if (!API_BASE) {
      setErrorMessage('Missing VITE_API_BASE_URL. Set the deployed backend URL in the frontend environment before creating invoices.');
      return;
    }

    const walletAddress = freelancerWalletAddress.trim() || wallet?.address || 'wallet-unset';
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Freelancer-Wallet': walletAddress,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        amountNgn: Number(amount),
        description: description.trim(),
        freelancerZcashAddress: freelancerZcashAddress.trim(),
        exchangeRateNgnPerZec: exchangeRate,
        platformFeePercent: feePercent,
      }),
    };

    try {
      const response = await fetch(`${API_BASE}/api/invoices`, requestOptions);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to create invoice.');
      }

      const invoice = payload as Invoice;
      setCreatedInvoice(invoice);
      setErrorMessage('');
      setAmount('');
      setDescription('');
      setFreelancerZcashAddress('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error.';
      setErrorMessage(message);
    }
  }

  async function requestShieldedPayment(invoice: Invoice) {
    const uri = buildZcashPaymentUri(invoice.freelancerZcashAddress, `PrivatePay invoice ${invoice.id}`);
    setPaymentRequest(uri);
    setPaymentState('Attempting to open the shielded payment request.');

    try {
      await navigator.clipboard.writeText(uri);
      setPaymentState('Payment request copied to your clipboard. Paste it into a compatible Zcash wallet to complete the shielded payment.');
    } catch {
      setPaymentState('No clipboard permission was granted. You can still use the payment URI shown below.');
    }
  }

  if (invoiceId) {
    return (
      <main className="app-shell public-shell">
        <div className="coin coin-one">₿</div>
        <div className="coin coin-two">◆</div>
        <section className="card public-invoice">
          <div className="brand"><span className="brand-mark">✦</span> PRIVATEPAY</div>
          <p className="eyebrow">SECURE INVOICE · TESTNET</p>
          {publicInvoice ? (
            <>
              <span className="badge">{publicInvoice.status === 'payment_confirmed' || publicInvoice.status === 'payout_completed' ? 'PAYMENT COMPLETE' : 'PAYMENT REQUEST'}</span>
              <h1 className="display-title">{publicInvoice.description}</h1>
              <p className="muted">Pay this invoice using a shielded Zcash payment request.</p>
              <strong className="amount">₦{publicInvoice.amountNgn.toLocaleString()}</strong>
              <p className="muted">Recipient Zcash address</p>
              <code>{publicInvoice.freelancerZcashAddress}</code>
              {publicInvoice.status === 'pending' || publicInvoice.status === 'payment_submitted' ? (
                <button onClick={() => void requestShieldedPayment(publicInvoice)}>Pay with shielded Zcash <span>↗</span></button>
              ) : (
                <p className="paid-message">✓ Payment status: {publicInvoice.status}</p>
              )}
              {paymentRequest && <p className="request-note">{paymentRequest}</p>}
              {paymentState && <p className="request-note">{paymentState}</p>}
            </>
          ) : (
            <>
              <h1>Invoice not found</h1>
              <p className="muted">This invoice link may be invalid or unavailable.</p>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell dashboard-shell">
      <div className="coin coin-one">₿</div>
      <div className="coin coin-two">◆</div>
      <div className="coin coin-three">₿</div>
      <section className="card dashboard-card">
        <div className="topbar">
          <div className="brand"><span className="brand-mark">✦</span> PRIVATEPAY</div>
          <span className="network-pill"><i /> TESTNET</span>
        </div>

        <div className="hero-copy">
          <p className="eyebrow">PRIVATE PAYMENTS, SIMPLIFIED</p>
          <h1 className="display-title">Private invoices.<br /><em>Powerful payouts.</em></h1>
          <p className="muted">Add your real Zcash receiving address and create a shareable invoice.</p>
        </div>

        {isAuthenticated ? (
          <div className="session">
            <p>Logged in wallet</p>
            <code>{wallet?.address ?? 'Wallet address pending'}</code>
            <button className="ghost-button" onClick={() => void logout()}>Log out</button>
            <hr />
            <h2>Create an invoice</h2>
            <form onSubmit={createInvoice} className="form">
              <label>
                Freelancer wallet address
                <input
                  value={freelancerWalletAddress}
                  onChange={(event) => setFreelancerWalletAddress(event.target.value)}
                  placeholder="Wallet address"
                />
              </label>
              <label>
                Zcash shielded receiving address
                <input
                  value={freelancerZcashAddress}
                  onChange={(event) => setFreelancerZcashAddress(event.target.value)}
                  placeholder="u... or z..."
                  required
                />
              </label>
              <label>
                Amount (NGN)
                <input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="25000" required />
              </label>
              <label>
                Conversion rate (NGN per ZEC)
                <input type="number" min="1" step="0.01" value={exchangeRateNgnPerZec} onChange={(event) => setExchangeRateNgnPerZec(event.target.value)} placeholder="1500" required />
              </label>
              <label>
                Platform fee (%)
                <input type="number" min="0" max="100" step="0.1" value={platformFeePercent} onChange={(event) => setPlatformFeePercent(event.target.value)} placeholder="2.5" required />
              </label>
              <label>
                Description
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Logo design" required />
              </label>
              <div className="invoice-summary">
                <p className="muted">Estimated freelancer payout: <strong>₦{estimatedFreelancerPayout.toLocaleString()}</strong></p>
              </div>
              <button type="submit">Create payment link <span>↗</span></button>
            </form>

            {errorMessage && <p className="wallet-error">{errorMessage}</p>}

            {createdInvoice && (
              <div className="invoice">
                <span className="badge">{createdInvoice.status}</span>
                <h2>{createdInvoice.description}</h2>
                <strong>₦{createdInvoice.amountNgn.toLocaleString()}</strong>
                <p className="muted">Freelancer receives: ₦{createdInvoice.freelancerReceivesNgn.toLocaleString()} ({createdInvoice.platformFeePercent}% fee)</p>
                <p className="muted">Rate: ₦{createdInvoice.exchangeRateNgnPerZec.toLocaleString()} per ZEC</p>
                <code>{window.location.origin}/?invoice={createdInvoice.id}</code>
                <p className="muted">Zcash receiving address: {createdInvoice.freelancerZcashAddress}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="login-area">
            <button onClick={openLoginModal}>Log in with Pollar <span>↗</span></button>
            <p className="login-notice"><span>!</span> Use the actual wallet connection on the device that owns the freelancer account.</p>
          </div>
        )}
      </section>
    </main>
  );
}
