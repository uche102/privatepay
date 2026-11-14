import { usePollar } from '@pollar/react';
import { useEffect, useState, type FormEvent } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').trim() || (
  typeof window !== 'undefined'
    ? (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin)
    : ''
);
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

function getInvoiceZecAmount(invoice: Invoice): string {
  const amount = invoice.amountNgn / invoice.exchangeRateNgnPerZec;
  return Number.isFinite(amount) ? amount.toFixed(8).replace(/\.?0+$/, '') : '0';
}

export default function App() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [exchangeRateNgnPerZec, setExchangeRateNgnPerZec] = useState('200');
  const [platformFeePercent, setPlatformFeePercent] = useState('0.00015');
  const [freelancerZcashAddress, setFreelancerZcashAddress] = useState('');
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [publicInvoice, setPublicInvoice] = useState<Invoice | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [paymentRequest, setPaymentRequest] = useState('');
  const [paymentState, setPaymentState] = useState('');
  const [paymentTxid, setPaymentTxid] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const invoiceId = new URLSearchParams(window.location.search).get('invoice');

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

  useEffect(() => {
    if (!invoiceId || publicInvoice?.status !== 'payment_submitted' || !publicInvoice.clientPaymentTxid) {
      return;
    }

    let stopped = false;
    let intervalId = 0;
    const checkPayment = async () => {
      if (stopped) return;
      setIsVerifyingPayment(true);
      try {
        const response = await fetch(`${API_BASE}/api/invoices/${invoiceId}/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientPaymentTxid: publicInvoice.clientPaymentTxid }),
        });
        const payload = await response.json().catch(() => ({}));
        if (payload.invoice) setPublicInvoice(payload.invoice as Invoice);
        setPaymentState(payload.message ?? payload.error ?? 'Checking payment with the Zcash network.');
        const status = payload.verification?.status ?? 'unavailable';
        setVerificationStatus(status);
        if (status === 'confirmed' || status === 'underpaid' || status === 'not_configured' || status === 'unavailable') {
          stopped = true;
          window.clearInterval(intervalId);
        }
      } catch {
        setVerificationStatus('unavailable');
        setPaymentState('Could not reach the payment verification service. Try again later.');
        stopped = true;
        window.clearInterval(intervalId);
      } finally {
        setIsVerifyingPayment(false);
      }
    };

    void checkPayment();
    intervalId = window.setInterval(() => void checkPayment(), 15000);
    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [invoiceId, publicInvoice?.status, publicInvoice?.clientPaymentTxid]);

  const estimatedFreelancerPayout = Number(amount || 0) > 0 && Number(platformFeePercent || 0) >= 0
    ? Number((Number(amount) * (1 - Number(platformFeePercent) / 100)).toFixed(2))
    : 0;
  const displayFreelancerPayout = Number.isFinite(estimatedFreelancerPayout) ? estimatedFreelancerPayout : 0;

  async function createInvoice(event: FormEvent) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (!wallet?.address) {
      setErrorMessage('Your Pollar wallet address is still loading. Please try again in a moment.');
      return;
    }

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

    if (!API_BASE || API_BASE === window.location.origin) {
      setErrorMessage('This deployment is missing a configured backend URL. Set VITE_API_BASE_URL to your deployed API host or proxy requests through the same origin before creating invoices.');
      return;
    }

    const walletAddress = wallet.address;
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

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_BASE}/api/invoices`, requestOptions);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to create invoice.');
      }

      const invoice = payload as Invoice;
      setCreatedInvoice(invoice);
      setAmount('');
      setDescription('');
      setFreelancerZcashAddress('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyShieldedAddress(invoice: Invoice) {
    const address = invoice.freelancerZcashAddress;
    const amount = getInvoiceZecAmount(invoice);
    setPaymentRequest(address);
    setPaymentState(`Enter ${amount} ZEC in your wallet to pay this invoice.`);

    try {
      await navigator.clipboard.writeText(address);
      setPaymentState(`Recipient address copied. Enter ${amount} ZEC in your wallet to pay this invoice.`);
    } catch {
      setPaymentState(`Copy the recipient address shown below, then enter ${amount} ZEC in your wallet.`);
    }
  }

  async function submitPaymentTxid(event: FormEvent) {
    event.preventDefault();
    if (!invoiceId || !paymentTxid.trim() || isVerifyingPayment) return;
    setIsVerifyingPayment(true);
    setVerificationStatus('checking');
    setPaymentState('Submitting the transaction ID for Zcash verification.');
    try {
      const response = await fetch(`${API_BASE}/api/invoices/${invoiceId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPaymentTxid: paymentTxid.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.invoice) setPublicInvoice(payload.invoice as Invoice);
      setPaymentState(payload.message ?? payload.error ?? 'Payment verification started.');
      setVerificationStatus(payload.verification?.status ?? 'unavailable');
      if (!response.ok && !payload.verification) {
        setPaymentState(payload.error ?? 'Could not submit this transaction ID.');
        setVerificationStatus('unavailable');
      }
    } catch {
      setPaymentState('Could not reach the payment verification service. Check the API deployment and try again.');
      setVerificationStatus('unavailable');
    } finally {
      setIsVerifyingPayment(false);
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
              <p className="muted">Send the ZEC amount below to the recipient address using your Zcash wallet.</p>
              <strong className="amount">₦{publicInvoice.amountNgn.toLocaleString()}</strong>
              <p className="muted">Amount to send: <strong>{getInvoiceZecAmount(publicInvoice)} ZEC</strong></p>
              <p className="muted">Recipient Zcash address</p>
              <code>{publicInvoice.freelancerZcashAddress}</code>
              {publicInvoice.status === 'pending' && <button onClick={() => void copyShieldedAddress(publicInvoice)}>Copy Zcash address</button>}
              {publicInvoice.status === 'payment_confirmed' || publicInvoice.status === 'payout_completed' ? (
                <p className="paid-message">Payment verified on the Zcash network.</p>
              ) : null}
              {(publicInvoice.status === 'pending' || publicInvoice.status === 'payment_submitted') && (
                <form className="payment-verify-form" onSubmit={submitPaymentTxid}>
                  <label>
                    Zcash transaction ID
                    <input
                      value={paymentTxid || publicInvoice.clientPaymentTxid || ''}
                      onChange={(event) => setPaymentTxid(event.target.value)}
                      placeholder="Paste the transaction ID from your wallet"
                      autoComplete="off"
                      required
                    />
                  </label>
                  <button type="submit" disabled={isVerifyingPayment}>
                    {isVerifyingPayment ? 'Checking Zcash...' : publicInvoice.status === 'payment_submitted' ? 'Check payment' : 'Verify payment'}
                  </button>
                  <div className={`verification-status ${verificationStatus === 'confirmed' ? 'is-confirmed' : ''}`} role="status" aria-live="polite">
                    <span className={`verification-indicator ${isVerifyingPayment ? 'is-active' : ''}`} aria-hidden="true" />
                    <div>
                      <strong>{verificationStatus === 'confirmed' ? 'Payment confirmed' : isVerifyingPayment ? 'Verifying transaction' : 'Payment verification'}</strong>
                      <p>{paymentState || 'After sending, paste the transaction ID to check its amount and confirmations.'}</p>
                    </div>
                  </div>
                  <small>The connected Zcash wallet must be able to view this shielded address for verification to work.</small>
                </form>
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
          <p className="eyebrow">PRIVATE INVOICING FOR FREELANCERS</p>
          <h1 className="display-title">Invoice in NGN.<br /><em>Receive ZEC.</em></h1>
          <p className="muted">Create a shareable invoice, let your client pay from a Zcash wallet, and check the transaction against the connected Zcash node.</p>
        </div>

        {isAuthenticated ? (
          <div className="session">
            <p>Logged in wallet</p>
            <code>{wallet?.address ?? 'Wallet address pending'}</code>
            <button type="button" className="ghost-button" onClick={() => void logout()}>Log out</button>
            <hr />
            <h2>Create an invoice</h2>
            <form onSubmit={createInvoice} className="form">
              <label>
                Your Pollar wallet address
                <input
                  value={wallet?.address ?? ''}
                  placeholder="Wallet address"
                  readOnly
                />
                <small>Assigned to the email account currently signed in.</small>
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
                <input type="number" min="1" step="0.01" value={exchangeRateNgnPerZec} onChange={(event) => setExchangeRateNgnPerZec(event.target.value)} placeholder="200" required />
              </label>
              <label>
                Platform fee (%)
                <input type="number" min="0" max="100" step="0.00001" value={platformFeePercent} onChange={(event) => setPlatformFeePercent(event.target.value)} placeholder="0.00015" required />
              </label>
              <label>
                Description
                <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Logo design" required />
              </label>
              <div className="invoice-summary">
                <p className="muted">Estimated freelancer payout: <strong>₦{displayFreelancerPayout.toLocaleString()}</strong></p>
              </div>
              <button type="submit" disabled={isSubmitting} className={isSubmitting ? 'is-loading' : ''}>
                {isSubmitting ? 'Creating invoice...' : 'Create payment link'} <span>↗</span>
              </button>
            </form>

            {errorMessage && <p className="wallet-error" role="alert">{errorMessage}</p>}

            {createdInvoice && (
              <div className="invoice" aria-live="polite">
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
            <div className="landing-steps" aria-label="How PrivatePay works">
              <article><span>01</span><strong>Create</strong><p>Set invoice terms and your shielded Zcash address.</p></article>
              <article><span>02</span><strong>Share</strong><p>Send your client a link with the ZEC amount due.</p></article>
              <article><span>03</span><strong>Verify</strong><p>Submit the transaction ID for a network check.</p></article>
            </div>
            <div className="wallet-status-banner" role="note">
              Zcash testnet demo. Payments require a Zcash wallet that can monitor the receiving address.
            </div>
            <p className="login-notice">Two sign-in options: use your email with Pollar, or connect an existing wallet.</p>
            <button type="button" onClick={openLoginModal}>Continue with Pollar <span>↗</span></button>
            <p className="login-notice"><span>i</span> Your Pollar wallet address identifies your invoices.</p>
          </div>
        )}
      </section>
    </main>
  );
}
