import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedOrigin } from './cors.js';

test('allows localhost origins with and without trailing slashes', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedOrigin('http://localhost:5173/'), true);
  assert.equal(isAllowedOrigin('http://localhost:4173'), true);
  assert.equal(isAllowedOrigin('https://privatepay-nu.vercel.app'), false);
});
