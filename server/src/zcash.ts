import { isValidZcashAddress } from './invoice-state.js';

export type ShieldedTxStatus = 'pending' | 'confirmed' | 'failed' | 'not_configured';
export type IncomingPaymentStatus = 'not_configured' | 'not_found' | 'pending' | 'underpaid' | 'confirmed';

export type IncomingPaymentVerification = {
  status: IncomingPaymentStatus;
  expectedAmountZec: number;
  receivedAmountZec?: number;
  confirmations?: number;
};

function getRpcConfig() {
  return {
    url: process.env.ZCASH_RPC_URL ?? '',
    username: process.env.ZCASH_RPC_USER ?? '',
    password: process.env.ZCASH_RPC_PASS ?? '',
  };
}

function getRpcHeaders() {
  const { username, password } = getRpcConfig();
  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return {
    'Content-Type': 'application/json',
    Authorization: `Basic ${encoded}`,
  };
}

export function isRpcConfigured(): boolean {
  const { url, username, password } = getRpcConfig();
  return Boolean(url && username && password);
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const { url } = getRpcConfig();
  if (!isRpcConfigured()) {
    throw new Error(
      'Missing Zcash RPC configuration. Set ZCASH_RPC_URL, ZCASH_RPC_USER, and ZCASH_RPC_PASS in server/.env before sending real shielded payouts.'
    );
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: getRpcHeaders(),
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'privatepay',
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Zcash RPC request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Zcash RPC request failed');
  }

  return payload.result as T;
}

export async function sendShieldedPayout(
  address: string,
  amount: number,
  memo: string
): Promise<{ txid: string; status: 'pending' | 'confirmed' }> {
  if (!isValidZcashAddress(address)) {
    throw new Error('A valid shielded Zcash address is required for payout.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payout amount must be greater than zero.');
  }

  if (!isRpcConfigured()) {
    throw new Error(
      'Zcash payout is not configured. Add ZCASH_RPC_URL, ZCASH_RPC_USER, and ZCASH_RPC_PASS to server/.env and complete a real wallet test before sending payouts.'
    );
  }

  const payload = await rpcCall<{ txid?: string }>('z_sendmany', ['', [{ address, amount, memo }]]);
  const txid = payload.txid ?? '';
  if (!txid) {
    throw new Error('Zcash payout did not return a transaction id.');
  }

  return { txid, status: 'pending' };
}

export async function verifyShieldedPayout(txid: string): Promise<ShieldedTxStatus> {
  if (!txid.trim()) {
    return 'failed';
  }

  if (!isRpcConfigured()) {
    return 'not_configured';
  }

  try {
    const result = await rpcCall<{ confirmations?: number; status?: string }>('gettransaction', [txid]);
    if (!result) {
      return 'failed';
    }

    if (typeof result.confirmations === 'number' && result.confirmations > 0) {
      return 'confirmed';
    }

    return result.status === 'failed' ? 'failed' : 'pending';
  } catch (error) {
    return 'failed';
  }
}

export async function verifyIncomingShieldedPayment(
  address: string,
  txid: string,
  expectedAmountZec: number
): Promise<IncomingPaymentVerification> {
  const expected = Math.round(expectedAmountZec * 100_000_000) / 100_000_000;
  if (!isRpcConfigured()) {
    return { status: 'not_configured', expectedAmountZec: expected };
  }

  const received = await rpcCall<Array<{ txid: string; amount: number; confirmations: number }>>(
    'z_listreceivedbyaddress',
    [address, 0]
  );
  const payments = received.filter((item) => item.txid.toLowerCase() === txid.toLowerCase());
  if (payments.length === 0) {
    return { status: 'not_found', expectedAmountZec: expected };
  }

  const receivedAmountZec = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const result: IncomingPaymentVerification = {
    status: 'pending',
    expectedAmountZec: expected,
    receivedAmountZec,
    confirmations: Math.min(...payments.map((payment) => Number(payment.confirmations ?? 0))),
  };

  if (!Number.isFinite(receivedAmountZec) || receivedAmountZec + 0.000000005 < expected) {
    return { ...result, status: 'underpaid' };
  }

  const configuredConfirmations = Number(process.env.ZCASH_MIN_CONFIRMATIONS ?? 1);
  const minConfirmations = Number.isInteger(configuredConfirmations) && configuredConfirmations > 0
    ? configuredConfirmations
    : 1;
  if ((result.confirmations ?? 0) >= minConfirmations) {
    result.status = 'confirmed';
  }

  return result;
}
