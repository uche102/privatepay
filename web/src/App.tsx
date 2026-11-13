import { usePollar } from '@pollar/react';

export default function App() {
  const { isAuthenticated, wallet, openLoginModal, logout } = usePollar();

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
          </div>
        ) : (
          <button onClick={openLoginModal}>Log in with Pollar</button>
        )}
      </section>
    </main>
  );
}
