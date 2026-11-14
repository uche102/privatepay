export const INVOICE_STATUSES = [
  'pending',
  'payment_submitted',
  'payment_confirmed',
  'payout_processing',
  'payout_completed',
  'failed',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const allowedTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
  pending: ['payment_submitted', 'failed'],
  payment_submitted: ['payment_confirmed', 'failed'],
  payment_confirmed: ['payout_processing', 'failed'],
  payout_processing: ['payout_completed', 'failed'],
  payout_completed: [],
  failed: ['pending', 'payment_submitted', 'payment_confirmed', 'payout_processing'],
};

export function getNextStatus(current: InvoiceStatus, next: InvoiceStatus): InvoiceStatus {
  if (current === next) {
    throw new Error(`cannot transition from ${current} to itself`);
  }

  const allowed = allowedTransitions[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`cannot transition from ${current} to ${next}`);
  }

  return next;
}

export function isValidZcashAddress(address: string): boolean {
  const normalized = address.trim();
  if (!normalized || normalized.length < 20) {
    return false;
  }

  return /^(?:u|z)[A-Za-z0-9]{20,}$/.test(normalized);
}
