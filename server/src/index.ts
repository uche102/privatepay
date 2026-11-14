import 'dotenv/config';
import cors from 'cors';
import Database from 'better-sqlite3';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

import { getNextStatus, INVOICE_STATUSES, isValidZcashAddress, type InvoiceStatus } from './invoice-state.js';
import { sendShieldedPayout, verifyShieldedPayout } from './zcash.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const database = new Database(process.env.DATABASE_PATH ?? './privatepay.db');
const windowMs = 60_000;
const maxRequestsPerWindow = 60;
const requestHistory = new Map<string, number[]>();

function currentIso() {
  return new Date().toISOString();
}

function publicInvoiceFields(invoice: Record<string, unknown>) {
  return {
    id: invoice.id,
    amountNgn: Number(invoice.amountNgn),
    description: invoice.description,
    status: invoice.status,
    freelancerZcashAddress: invoice.freelancerZcashAddress,
    clientPaymentReference: invoice.clientPaymentReference,
    clientPaymentTxid: invoice.clientPaymentTxid,
    zcashPayoutTxid: invoice.zcashPayoutTxid,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function requireFreelancerAuth(request: Request, response: Response, next: NextFunction) {
  const configuredKey = process.env.PRIVATEPAY_API_KEY?.trim();
  if (!configuredKey) {
    return response.status(503).json({
      error: 'Missing PRIVATEPAY_API_KEY',
      required: 'Set PRIVATEPAY_API_KEY in server/.env and send Authorization: Bearer <PRIVATEPAY_API_KEY> with X-Freelancer-Wallet: <wallet-address>.',
    });
  }

  const walletAddress = String(request.get('x-freelancer-wallet') ?? '').trim();

  if (!walletAddress) {
    return response.status(400).json({
      error: 'Missing freelancer wallet address',
      required: 'Include the X-Freelancer-Wallet header with the authenticated freelancer wallet address.',
    });
  }

  const authorization = request.get('authorization') ?? '';
  const providedKey = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : String(request.get('x-privatepay-key') ?? '').trim();

  if (providedKey !== configuredKey) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  response.locals.freelancerWalletAddress = walletAddress;
  return next();
}

function rateLimit(maxAllowed: number, windowInMs: number) {
  return (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip ?? request.headers['x-forwarded-for'] ?? 'anonymous';
    const now = Date.now();
    const history = requestHistory.get(String(key)) ?? [];
    const recent = history.filter((timestamp) => now - timestamp < windowInMs);
    recent.push(now);

    requestHistory.set(String(key), recent);
    if (recent.length > maxAllowed) {
      return response.status(429).json({
        error: 'Too many requests. Please wait a moment before retrying.',
      });
    }

    return next();
  };
}

const invoiceTableSql = `
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    freelancerWalletAddress TEXT NOT NULL,
    freelancerZcashAddress TEXT NOT NULL,
    amountNgn REAL NOT NULL CHECK (amountNgn > 0),
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'payment_submitted', 'payment_confirmed', 'payout_processing', 'payout_completed', 'failed')),
    clientPaymentReference TEXT,
    clientPaymentTxid TEXT,
    zcashPayoutTxid TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_freelancer_wallet ON invoices (freelancerWalletAddress);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
  CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices (createdAt);
`;

database.exec(invoiceTableSql);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === process.env.WEB_ORIGIN || origin === 'http://localhost:5173' || /^http:\/\/localhost:\d+$/.test(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use('/api/invoices', rateLimit(maxRequestsPerWindow, windowMs));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'privatepay-api', testnetOnly: true, states: INVOICE_STATUSES });
});

app.post('/api/invoices', requireFreelancerAuth, (request, response) => {
  const body = request.body as Record<string, unknown>;
  const freelancerWalletAddress = String(response.locals.freelancerWalletAddress ?? '').trim();
  const amountNgn = Number(body.amountNgn);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const freelancerZcashAddress = typeof body.freelancerZcashAddress === 'string' ? body.freelancerZcashAddress.trim() : '';

  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    return response.status(400).json({ error: 'amountNgn must be a positive number.' });
  }

  if (!description) {
    return response.status(400).json({ error: 'description is required.' });
  }

  if (!freelancerZcashAddress || !isValidZcashAddress(freelancerZcashAddress)) {
    return response.status(400).json({
      error: 'freelancerZcashAddress must be a valid shielded Zcash address.',
      required: 'Use your actual Zcash testnet receiving address. Do not use a hardcoded demo address.',
    });
  }

  const now = currentIso();
  const invoice = {
    id: randomUUID(),
    freelancerWalletAddress,
    freelancerZcashAddress,
    amountNgn,
    description,
    status: 'pending' as InvoiceStatus,
    clientPaymentReference: `pay-${randomUUID().slice(0, 8)}`,
    clientPaymentTxid: null,
    zcashPayoutTxid: null,
    createdAt: now,
    updatedAt: now,
  };

  database
    .prepare(
      `INSERT INTO invoices (id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt)
       VALUES (@id, @freelancerWalletAddress, @freelancerZcashAddress, @amountNgn, @description, @status, @clientPaymentReference, @clientPaymentTxid, @zcashPayoutTxid, @createdAt, @updatedAt)`
    )
    .run(invoice);

  return response.status(201).json(publicInvoiceFields(invoice));
});

app.get('/api/invoices', requireFreelancerAuth, (request, response) => {
  const freelancerWalletAddress = String(response.locals.freelancerWalletAddress ?? '').trim();
  const rows = database
    .prepare(
      `SELECT id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt
       FROM invoices
       WHERE freelancerWalletAddress = ?
       ORDER BY createdAt DESC`
    )
    .all(freelancerWalletAddress) as Array<Record<string, unknown>>;

  return response.json(rows.map(publicInvoiceFields));
});

app.get('/api/invoices/:id', (request, response) => {
  const row = database
    .prepare(
      `SELECT id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt
       FROM invoices WHERE id = ?`
    )
    .get(request.params.id) as Record<string, unknown> | undefined;

  if (!row) {
    return response.status(404).json({ error: 'Invoice not found' });
  }

  return response.json(publicInvoiceFields(row));
});

app.get('/api/invoices/:id/status', (request, response) => {
  const row = database
    .prepare(
      `SELECT id, status, clientPaymentTxid, zcashPayoutTxid, updatedAt, amountNgn, description, freelancerZcashAddress
       FROM invoices WHERE id = ?`
    )
    .get(request.params.id) as Record<string, unknown> | undefined;

  if (!row) {
    return response.status(404).json({ error: 'Invoice not found' });
  }

  return response.json({
    id: row.id,
    status: row.status,
    description: row.description,
    amountNgn: Number(row.amountNgn),
    freelancerZcashAddress: row.freelancerZcashAddress,
    clientPaymentTxid: row.clientPaymentTxid,
    zcashPayoutTxid: row.zcashPayoutTxid,
    updatedAt: row.updatedAt,
  });
});

app.post('/api/invoices/:id/pay', async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const invoiceRow = database
    .prepare(
      `SELECT * FROM invoices WHERE id = ?`
    )
    .get(request.params.id) as Record<string, unknown> | undefined;

  if (!invoiceRow) {
    return response.status(404).json({ error: 'Invoice not found' });
  }

  const currentStatus = String(invoiceRow.status) as InvoiceStatus;
  const clientPaymentReference = typeof body.clientPaymentReference === 'string' ? body.clientPaymentReference.trim() : undefined;
  const clientPaymentTxid = typeof body.clientPaymentTxid === 'string' ? body.clientPaymentTxid.trim() : '';
  const triggerPayout = Boolean(body.triggerPayout);
  const confirmPayment = Boolean(body.confirmPayment);
  const action = typeof body.action === 'string' ? body.action : 'submit';

  if (clientPaymentReference) {
    database
      .prepare('UPDATE invoices SET clientPaymentReference = ?, updatedAt = ? WHERE id = ?')
      .run(clientPaymentReference, currentIso(), request.params.id);
  }

  if (clientPaymentTxid) {
    database
      .prepare('UPDATE invoices SET clientPaymentTxid = ?, updatedAt = ? WHERE id = ?')
      .run(clientPaymentTxid, currentIso(), request.params.id);
  }

  try {
    if (triggerPayout) {
      if (currentStatus !== 'payment_confirmed') {
        return response.status(409).json({
          error: 'Payment confirmation is required before a payout can be sent.',
          status: currentStatus,
        });
      }

      if (invoiceRow.zcashPayoutTxid) {
        return response.status(409).json({
          error: 'This payout has already been attempted or completed.',
          status: currentStatus,
          zcashPayoutTxid: invoiceRow.zcashPayoutTxid,
        });
      }

      const payout = await sendShieldedPayout(
        String(invoiceRow.freelancerZcashAddress ?? '').trim(),
        Number(invoiceRow.amountNgn),
        `PrivatePay invoice ${request.params.id}`
      );

      const finalStatus = payout.status === 'pending' ? 'payout_processing' : 'payout_completed';
      const payoutState = finalStatus === 'payout_completed' ? 'payout_completed' : 'payout_processing';
      database
        .prepare(
          'UPDATE invoices SET zcashPayoutTxid = ?, status = ?, updatedAt = ? WHERE id = ?'
        )
        .run(payout.txid, payoutState, currentIso(), request.params.id);

      if (payoutState === 'payout_processing') {
        const verified = await verifyShieldedPayout(payout.txid);
        if (verified === 'confirmed') {
          database.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?').run('payout_completed', currentIso(), request.params.id);
        }
      }

      return response.status(202).json({
        id: request.params.id,
        status: payoutState,
        message: 'Payout request accepted. A real Zcash RPC transaction must be verified before the payout is marked completed.',
        zcashPayoutTxid: payout.txid,
      });
    }

    if ((action === 'confirm-payment' || confirmPayment) && currentStatus === 'payment_submitted') {
      const next = getNextStatus(currentStatus, 'payment_confirmed');
      database.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?').run(next, currentIso(), request.params.id);
      return response.json({ id: request.params.id, status: next });
    }

    if ((action === 'submit-payment' || action === 'pay' || (!confirmPayment && !triggerPayout)) && clientPaymentTxid) {
      if (currentStatus === 'payout_completed' || currentStatus === 'payout_processing') {
        return response.status(409).json({ error: 'This invoice is already in a payout state.', status: currentStatus });
      }

      const next = getNextStatus(currentStatus, 'payment_submitted');
      database.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?').run(next, currentIso(), request.params.id);
      return response.json({
        id: request.params.id,
        status: next,
        clientPaymentTxid,
        message: 'Payment submitted. Confirm the transaction before creating the payout.',
      });
    }

    return response.status(400).json({
      error: 'Unsupported payment action. Provide clientPaymentTxid plus action or confirmPayment=true.',
      validActions: ['submit-payment', 'confirm-payment', 'send-payout'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment processing failed';
    database.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?').run('failed', currentIso(), request.params.id);
    return response.status(400).json({ error: message, status: 'failed' });
  }
});

app.listen(port, () => {
  console.log(`PrivatePay API listening on http://localhost:${port}`);
});
