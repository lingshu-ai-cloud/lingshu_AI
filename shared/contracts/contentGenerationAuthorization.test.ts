import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentGenerationAuthorization,
  newContentGenerationAuthorization,
} from './contentGenerationAuthorization.js';

test('content generation authorization is explicit, versioned and metered without a spend ceiling', () => {
  const authorization = newContentGenerationAuthorization();
  assert.deepEqual(contentGenerationAuthorization(authorization), authorization);
  assert.equal(contentGenerationAuthorization({ ...authorization, granted: false }), null);
  assert.equal(contentGenerationAuthorization({ ...authorization, spendPolicy: 'capped' }), null);
  assert.equal(contentGenerationAuthorization(null), null);
});
