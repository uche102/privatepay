import 'dotenv/config';
import cors from 'cors';
import Database from 'better-sqlite3';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

import { isAllowedOrigin } from './cors.js';
import { getNextStatus, INVOICE_STATUSES, isValidZcashAddress, type InvoiceStatus } from './invoice-state.js';
import { verifyIncomingShieldedPayment } from './zcash.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const database = new Database(process.env.DATABASE_PATH ?? './privatepay.db');
const defaultExchangeRateNgnPerZec = Number(process.env.EXCHANGE_RATE_NGN_PER_ZEC ?? 1600);
const defaultPlatformFeePercent = Number(process.env.PLATFORM_FEE_PERCENT ?? 0.00015);
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
    freelancerReceivesNgn: Number(invoice.freelancerReceivesNgn ?? invoice.amountNgn),
    exchangeRateNgnPerZec: Number(invoice.exchangeRateNgnPerZec ?? defaultExchangeRateNgnPerZec),
    platformFeePercent: Number(invoice.platformFeePercent ?? defaultPlatformFeePercent),
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
    freelancerReceivesNgn REAL NOT NULL CHECK (freelancerReceivesNgn >= 0),
    exchangeRateNgnPerZec REAL NOT NULL CHECK (exchangeRateNgnPerZec > 0),
    platformFeePercent REAL NOT NULL CHECK (platformFeePercent >= 0),
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
database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_client_payment_txid_unique
  ON invoices (clientPaymentTxid)
  WHERE clientPaymentTxid IS NOT NULL AND clientPaymentTxid <> '';`);

const invoiceColumns = database.prepare('PRAGMA table_info(invoices)').all() as Array<Record<string, unknown>>;
const existingInvoiceColumns = new Set(invoiceColumns.map((column) => String(column.name)));
for (const columnName of ['freelancerReceivesNgn', 'exchangeRateNgnPerZec', 'platformFeePercent']) {
  if (!existingInvoiceColumns.has(columnName)) {
    const defaultValue = columnName === 'freelancerReceivesNgn' ? '0' : columnName === 'exchangeRateNgnPerZec' ? String(defaultExchangeRateNgnPerZec) : String(defaultPlatformFeePercent);
    database.exec(`ALTER TABLE invoices ADD COLUMN ${columnName} REAL NOT NULL DEFAULT ${defaultValue};`);
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
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
  const exchangeRateNgnPerZec = Number(body.exchangeRateNgnPerZec ?? defaultExchangeRateNgnPerZec);
  const platformFeePercent = Number(body.platformFeePercent ?? defaultPlatformFeePercent);

  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    return response.status(400).json({ error: 'amountNgn must be a positive number.' });
  }

  if (!Number.isFinite(exchangeRateNgnPerZec) || exchangeRateNgnPerZec <= 0) {
    return response.status(400).json({ error: 'exchangeRateNgnPerZec must be a positive number.' });
  }

  if (!Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100) {
    return response.status(400).json({ error: 'platformFeePercent must be between 0 and 100.' });
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

  const freelancerReceivesNgn = Number((amountNgn * (1 - platformFeePercent / 100)).toFixed(2));
  const now = currentIso();
  const invoice = {
    id: randomUUID(),
    freelancerWalletAddress,
    freelancerZcashAddress,
    amountNgn,
    freelancerReceivesNgn,
    exchangeRateNgnPerZec,
    platformFeePercent,
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
      `INSERT INTO invoices (id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, freelancerReceivesNgn, exchangeRateNgnPerZec, platformFeePercent, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt)
       VALUES (@id, @freelancerWalletAddress, @freelancerZcashAddress, @amountNgn, @freelancerReceivesNgn, @exchangeRateNgnPerZec, @platformFeePercent, @description, @status, @clientPaymentReference, @clientPaymentTxid, @zcashPayoutTxid, @createdAt, @updatedAt)`
    )
    .run(invoice);

  return response.status(201).json(publicInvoiceFields(invoice));
});

app.get('/api/invoices', requireFreelancerAuth, (request, response) => {
  const freelancerWalletAddress = String(response.locals.freelancerWalletAddress ?? '').trim();
  const rows = database
    .prepare(
      `SELECT id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, freelancerReceivesNgn, exchangeRateNgnPerZec, platformFeePercent, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt
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
      `SELECT id, freelancerWalletAddress, freelancerZcashAddress, amountNgn, freelancerReceivesNgn, exchangeRateNgnPerZec, platformFeePercent, description, status, clientPaymentReference, clientPaymentTxid, zcashPayoutTxid, createdAt, updatedAt
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

app.post('/api/invoices/:id/verify-payment', rateLimit(maxRequestsPerWindow, windowMs), async (request, response) => {
  const txid = typeof request.body?.clientPaymentTxid === 'string'
    ? request.body.clientPaymentTxid.trim().toLowerCase()
    : '';
  if (!/^[a-f0-9]{64}$/.test(txid)) {
    return response.status(400).json({ error: 'Enter the 64-character Zcash transaction ID from your wallet.' });
  }

  const invoice = database.prepare('SELECT * FROM invoices WHERE id = ?').get(request.params.id) as Record<string, unknown> | undefined;
  if (!invoice) {
    return response.status(404).json({ error: 'Invoice not found.' });
  }

  const currentStatus = String(invoice.status) as InvoiceStatus;
  if (currentStatus === 'payment_confirmed' || currentStatus === 'payout_completed') {
    return response.json({ invoice: publicInvoiceFields(invoice), verification: { status: 'confirmed' } });
  }
  if (currentStatus === 'failed' || currentStatus === 'payout_processing') {
    return response.status(409).json({ error: `This invoice cannot be verified while it is ${currentStatus}.` });
  }

  const txidOwner = database.prepare('SELECT id FROM invoices WHERE clientPaymentTxid = ? AND id <> ?').get(txid, request.params.id) as { id: string } | undefined;
  if (txidOwner) {
    return response.status(409).json({ error: 'That transaction ID has already been submitted for another invoice.' });
  }

  const submittedStatus = currentStatus === 'pending' ? getNextStatus(currentStatus, 'payment_submitted') : currentStatus;
  database.prepare('UPDATE invoices SET clientPaymentTxid = ?, status = ?, updatedAt = ? WHERE id = ?')
    .run(txid, submittedStatus, currentIso(), request.params.id);

  const expectedAmountZec = Number(invoice.amountNgn) / Number(invoice.exchangeRateNgnPerZec);
  try {
    const verification = await verifyIncomingShieldedPayment(
      String(invoice.freelancerZcashAddress ?? '').trim(),
      txid,
      expectedAmountZec
    );
    if (verification.status === 'confirmed') {
      const confirmedStatus = getNextStatus(submittedStatus, 'payment_confirmed');
      database.prepare('UPDATE invoices SET status = ?, updatedAt = ? WHERE id = ?')
        .run(confirmedStatus, currentIso(), request.params.id);
    }

    const updated = database.prepare('SELECT * FROM invoices WHERE id = ?').get(request.params.id) as Record<string, unknown>;
    const messages: Record<string, string> = {
      not_configured: 'Payment was submitted, but the server has no Zcash RPC connection yet.',
      not_found: 'The connected Zcash wallet cannot see this transaction for the invoice address yet. The address must be monitored by the wallet RPC.',
      pending: 'Payment found. Waiting for the required Zcash confirmation.',
      underpaid: `The transaction received ${verification.receivedAmountZec ?? 0} ZEC; this invoice requires at least ${verification.expectedAmountZec} ZEC.`,
      confirmed: 'Payment verified on the connected Zcash wallet.',
    };
    const httpStatus = verification.status === 'not_configured' ? 503 : 200;
    return response.status(httpStatus).json({
      invoice: publicInvoiceFields(updated),
      verification,
      message: messages[verification.status],
    });
  } catch {
    return response.status(503).json({
      invoice: publicInvoiceFields(database.prepare('SELECT * FROM invoices WHERE id = ?').get(request.params.id) as Record<string, unknown>),
      verification: { status: 'unavailable' },
      message: 'Could not inspect this shielded payment. The server wallet must be online and able to view the invoice receiving address.',
    });
  }
});

app.post('/api/invoices/:id/pay', (_request, response) => {
  return response.status(410).json({
    error: 'This payment endpoint no longer accepts manual confirmations or payout requests. Submit the wallet transaction ID to /api/invoices/:id/verify-payment.',
  });
});

app.listen(port, () => {
  console.log(`PrivatePay API listening on http://localhost:${port}`);
});
