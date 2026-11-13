# PrivatePay

Private invoice collection for freelancers and small merchants.

This repository contains:

- `web`: Vite + React + TypeScript frontend
- `server`: Express + TypeScript API with SQLite persistence

The current scaffold targets Pollar testnet for login and leaves Zcash payout integration as a clearly marked simulation.

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

Put the Pollar publishable testnet key in `web/.env` as `VITE_POLLAR_API_KEY=...`. Do not put it in `server/.env`; the server currently does not use a Pollar key.

The frontend runs on `http://localhost:5173` and the API on `http://localhost:3001`.

## Vercel deployment

Deploy the `web` directory as the Vercel project root (Project Settings → Root Directory → `web`). Use `npm run build` as the build command and `dist` as the output directory. Add `VITE_POLLAR_API_KEY` in Vercel Environment Variables using a fresh Pollar testnet publishable key. The committed example intentionally contains no usable credential.

The Express/SQLite server is a separate service; do not deploy it as a static Vite project. Set the frontend's API base URL when the API service is hosted separately.

