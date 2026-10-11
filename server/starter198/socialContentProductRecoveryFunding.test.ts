import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readProductRecoveryFunding} from './socialContentProductRecoveryFunding.js';
import type {MvpBudgetRecord} from '../lib/mvpBudgetAdmission.js';
import type {SocialTaskBudgetEntry} from '../lib/socialContentTaskBudget.js';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'original-funding-'));
  const fingerprint = sha('original-request');
  const scope = {tenantId: 'tenant', taskId: 'task', runId: 'run', productId: 'product', accountId: null, provider: 'seedance', model: 'original-model', shotIds: ['S04'],
    version: 7, session: 'B' as const, action: 'generate_media' as const, authority: 'customer' as const, expiresAt: '2020-01-01T00:00:00Z', revoked: false,
    authorizedBy: 'fixture-customer', authorizationRef: 'original-grant', budgetPoolId: 'pool', budgetLimitCny: 10};
  const record: MvpBudgetRecord = {schemaVersion: 1, id: 'pool', tenantId: 'tenant', taskId: 'task', session: 'B', limitCny: 10, authorizations: [scope],
    pricing: {verifiedAccountPrice: false, checkedAt: '2020-01-01', validUntil: '2020-01-01', balanceCny: 0, evidenceRef: '', operationQuotes: {}},
    entries: {original: {operationId: 'original', fingerprint, amountCny: 4, status: 'reserved', at: '2019-01-01'}}};
  const entry: SocialTaskBudgetEntry = {operationId: 'original', fingerprint, provider: 'seedance', model: 'original-model', accountRef: 'unbound', stage: 'video',
    shotId: 'S04', runId: 'run', planHash: sha('original-plan'), quoteRef: 'original-price-evidence', reservedMicros: 4e6, status: 'accepted', receiptRef: 'original-task'};
  const input = {budgetRoot: root, tenantId: 'tenant', taskId: 'task', runId: 'run', shotId: 'S04', productId: 'product', accountId: null,
    provider: 'seedance', model: 'original-model', fingerprint, operationId: 'original', wholeFilmEntries: [entry],
    binding: {poolId: 'pool', authorizationRef: scope.authorizationRef, scopeHash: sha(JSON.stringify(scope))}};
  const file = path.join(root, `${sha('pool')}.json`), write = () => fs.writeFileSync(file, JSON.stringify(record));
  write(); return {input, record, entry, write, file};
}
test('original accepted reservation remains readable without a fresh quote or balance despite expiry', () => {
  const f = fixture(), before = fs.readFileSync(f.file, 'utf8');
  assert.equal(readProductRecoveryFunding(f.input), 4); assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});
test('revocation, replacement grant, model/account changes and missing original ledger cannot impersonate recovery', () => {
  const f = fixture();
  for (const change of [{tenantId: 'other'}, {runId: 'other'}, {accountId: 'other'}, {model: 'other'}, {provider: 'other'}, {fingerprint: sha('changed')}]) {
    assert.throws(() => readProductRecoveryFunding({...f.input, ...change}));
  }
  f.record.authorizations[0]!.revoked = true;
  f.record.authorizations.push({...f.record.authorizations[0]!, revoked: false, authorizationRef: 'replacement-grant'}); f.write();
  assert.throws(() => readProductRecoveryFunding(f.input), /original_server_authorization_missing/);
  assert.throws(() => readProductRecoveryFunding({...f.input, wholeFilmEntries: []}), /original_whole_film_reservation_missing/);
});
test('changed original reservation amount is rejected rather than reserving another operation', () => {
  const f = fixture(); f.record.entries.original!.amountCny = 3; f.write();
  assert.throws(() => readProductRecoveryFunding(f.input), /original_server_authorization_missing/);
  f.record.entries.original!.amountCny = 4; f.record.entries.original!.fingerprint = sha('another-request'); f.write();
  assert.throws(() => readProductRecoveryFunding(f.input));
});
