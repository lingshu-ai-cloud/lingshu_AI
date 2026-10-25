import assert from 'node:assert/strict';
import test from 'node:test';
import { adReceiptState } from './adReceiptState.js';
const receipt = (action: string, at: string, status = 'VERIFIED', resourceId = 'campaign', connectionId = 'account') => ({ action, createdAt: at, status, resourceId, connectionId });
test('state follows latest verified switch action, ignoring budget, failures and other resources', () => {
  const rows = [receipt('create','01'),receipt('activate','02'),receipt('adjust_budget','03'),receipt('pause','04','FAILED'),receipt('pause','05','VERIFIED','other'),receipt('pause','06','VERIFIED','campaign','other')];
  assert.equal(adReceiptState(rows,'account','campaign').expected,'ACTIVE');
  rows.push(receipt('pause','07')); assert.equal(adReceiptState(rows,'account','campaign').expected,'PAUSED');
  rows.push(receipt('resume','08')); assert.equal(adReceiptState(rows.reverse(),'account','campaign').expected,'ACTIVE');
});
test('pending operations cannot be represented as a confirmed match', () => {
  const state = adReceiptState([receipt('create','01'),receipt('activate','02','UNKNOWN')],'account','campaign');
  assert.equal(state.expected,'PAUSED'); assert.equal(state.pending,true);
  assert.equal(adReceiptState([],'account','campaign').expected,null);
});
