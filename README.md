# PrivatePay

Private invoice collection for freelancers and small merchants.

This repository contains:

- `web`: Vite + React + TypeScript frontend
- `server`: Express + TypeScript API with SQLite persistence

The project is intentionally structured so the backend is the source of truth for invoice status and the frontend never stores wallet secrets or seed phrases.

## Required environment values

The invoice backend requires an authentication key for freelancer actions and a real Zcash RPC connection for payouts.

Create `server/.env` from `server/.env.example` and set:

```env
PORT=3001
DATABASE_PATH=./privatepay.db
WEB_ORIGIN=http://localhost:5173
PRIVATEPAY_API_KEY=replace-with-a-strong-random-key
ZCASH_RPC_URL=http://127.0.0.1:18232
ZCASH_RPC_USER=your-zcash-rpc-user
ZCASH_RPC_PASS=your-zcash-rpc-password
```

The frontend only needs:

```env
VITE_API_BASE_URL=http://localhost:3001
VITE_POLLAR_API_KEY=your-pollar-testnet-publishable-key
```

If you want real shielded payouts, the Zcash wallet backend must expose a JSON-RPC endpoint that supports commands such as `z_sendmany` and `gettransaction`. Without those credentials the API will refuse to fabricate a transaction ID.

## Zcash payout requirement

The application does not hardcode any wallet address. Each freelancer must provide their real shielded Zcash address when creating an invoice. The backend validates that address and rejects invalid data.

A genuine Zcash payout requires:

1. a Zcash node or wallet with RPC enabled,
2. `ZCASH_RPC_URL`, `ZCASH_RPC_USER`, and `ZCASH_RPC_PASS` set in the server environment,
3. the wallet containing the funds or a properly configured wallet account,
4. a valid shielded testnet recipient address for each invoice.

The server will not create or claim a payout transaction when the RPC configuration is missing.

## Local development

```bash
cd server
npm install
copy .env.example .env
npm run dev
```

In another terminal:

```bash
cd web
npm install
copy .env.example .env
npm run dev
```

The frontend runs on `http://localhost:5173` and the API on `http://localhost:3001`.

## Invoice flow

- The freelancer creates an invoice with their wallet and shielded Zcash address.
- Public invoice pages expose only the information needed for payment.
- The client can submit a payment reference and transaction id.
- The backend records the payment and enforces the required state machine before any payout is attempted.
- Payouts use the configured Zcash RPC layer and only mark success after verification.

## Vercel deployment

Deploy the `web` directory as the Vercel project root (Project Settings → Root Directory → `web`). Use `npm run build` as the build command and `dist` as the output directory. Add `VITE_POLLAR_API_KEY` and optionally `VITE_API_BASE_URL` in Vercel Environment Variables. The server remains a separate service and must be deployed with the real Zcash RPC values above.

