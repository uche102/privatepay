import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextStatus, isValidZcashAddress } from './invoice-state.js';

test('payment transitions are allowed in the expected order', () => {
  assert.equal(getNextStatus('pending', 'payment_submitted'), 'payment_submitted');
  assert.equal(getNextStatus('payment_submitted', 'payment_confirmed'), 'payment_confirmed');
  assert.equal(getNextStatus('payment_confirmed', 'payout_processing'), 'payout_processing');
  assert.equal(getNextStatus('payout_processing', 'payout_completed'), 'payout_completed');
});

test('payout cannot happen twice or move backwards without a retry', () => {
  assert.throws(() => getNextStatus('payout_completed', 'payout_processing'), /cannot transition/i);
  assert.throws(() => getNextStatus('payment_confirmed', 'payment_submitted'), /cannot transition/i);
});

test('zcash addresses must be valid for testnet receiving wallets', () => {
  assert.equal(isValidZcashAddress('u1234567890abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(isValidZcashAddress('ztest1234567890abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(isValidZcashAddress('not-an-address'), false);
  assert.equal(isValidZcashAddress(''), false);
});
