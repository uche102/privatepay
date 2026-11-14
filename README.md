# PrivatePay

Private invoice collection for freelancers and small merchants.

This repository contains:

- `web`: Vite + React + TypeScript frontend
- `server`: Express + TypeScript API with SQLite persistence

The project is intentionally structured so the backend is the source of truth for invoice status and the frontend never stores wallet secrets or seed phrases.

## Required environment values

The invoice backend requires an authentication key for freelancer actions and a Zcash RPC wallet connection to verify shielded payments.

Create `server/.env` from `server/.env.example` and set:

```env
PORT=3001
DATABASE_PATH=./privatepay.db
EXCHANGE_RATE_NGN_PER_ZEC=500000
PLATFORM_FEE_PERCENT=0.00015
ZCASH_MIN_CONFIRMATIONS=1
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

Payment verification uses the Zcash wallet RPC. Without a reachable RPC wallet, invoices stay unverified; the app will not mark a payment complete based only on a client-provided transaction ID.

## Shielded payment verification

Each freelancer provides their shielded Zcash receiving address when creating an invoice. The client sends the displayed ZEC amount from a compatible wallet, then submits the transaction ID on the public invoice page. The server checks that the connected wallet sees a payment to that invoice address, that the received amount is sufficient, and that the transaction has the configured number of confirmations.

The RPC wallet must be synced and able to view the invoice receiving address. Shielded transaction details are not publicly visible from a transaction ID alone; the connected wallet needs the address or suitable incoming viewing capability. `z_listreceivedbyaddress` only reports shielded receipts for addresses the wallet can view. Never put spending keys or seed phrases in PrivatePay.

PrivatePay's current payment flow sends ZEC directly to the freelancer's shielded address. It verifies receipt; it does not provide escrow or automatically send a second payout.

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
- The client sends the displayed amount from a Zcash wallet and submits the transaction ID.
- The public invoice page checks payment status against the connected Zcash RPC wallet and refreshes while the transaction is pending.
- Payment status becomes confirmed only after the address, amount, and minimum confirmations are verified.

## Vercel deployment

Deploy the `web` directory as the Vercel project root (Project Settings → Root Directory → `web`). Use `npm run build` as the build command and `dist` as the output directory. Add `VITE_POLLAR_API_KEY` and optionally `VITE_API_BASE_URL` in Vercel Environment Variables. The server remains a separate service and must be deployed with the real Zcash RPC values above.

