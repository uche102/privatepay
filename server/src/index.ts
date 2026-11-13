import 'dotenv/config';
import cors from 'cors';
import Database from 'better-sqlite3';
import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const database = new Database(process.env.DATABASE_PATH ?? './privatepay.db');

database.exec(`CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, amountNgn REAL NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'payout_sent')), pollarPaymentRef TEXT, zcashTxid TEXT, freelancerZcashAddress TEXT NOT NULL, createdAt TEXT NOT NULL)`);

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.post('/api/invoices', (request, response) => {
  const { amountNgn, description, freelancerZcashAddress } = request.body as Record<string, unknown>;
  if (typeof amountNgn !== 'number' || amountNgn <= 0 || typeof description !== 'string' || !description.trim() || typeof freelancerZcashAddress !== 'string' || !freelancerZcashAddress.trim()) {
    response.status(400).json({ error: 'amountNgn, description, and freelancerZcashAddress are required' });
    return;
  }
  const invoice = { id: randomUUID(), amountNgn, description: description.trim(), status: 'pending', pollarPaymentRef: null, zcashTxid: null, freelancerZcashAddress: freelancerZcashAddress.trim(), createdAt: new Date().toISOString() };
  database.prepare('INSERT INTO invoices (id, amountNgn, description, status, pollarPaymentRef, zcashTxid, freelancerZcashAddress, createdAt) VALUES (@id, @amountNgn, @description, @status, @pollarPaymentRef, @zcashTxid, @freelancerZcashAddress, @createdAt)').run(invoice);
  response.status(201).json(invoice);
});

app.get('/api/invoices', (_request, response) => response.json(database.prepare('SELECT * FROM invoices ORDER BY createdAt DESC').all()));
app.get('/api/invoices/:id', (request, response) => {
  const invoice = database.prepare('SELECT * FROM invoices WHERE id = ?').get(request.params.id);
  invoice ? response.json(invoice) : response.status(404).json({ error: 'Invoice not found' });
});

app.listen(port, () => console.log(`PrivatePay API listening on http://localhost:${port}`));
