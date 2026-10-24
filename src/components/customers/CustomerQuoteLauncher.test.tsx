import test from 'node:test';
import assert from 'node:assert/strict';
import { customerNeedsQuote } from './CustomerQuoteLauncher';
import { createQuoteMockCustomers } from '../../mocks/quoteCustomerProfiles';
import { createMockCustomers } from '../../mocks/customerProfiles';

test('quotation entry follows actual quote intent and profile stage, including Chinese and English inquiries', () => {
  for (const customer of createQuoteMockCustomers()) assert.equal(customerNeedsQuote(customer), true, customer.name);
  const customer = createMockCustomers('local-foreign-trade-factory').find(c => c.id === 'mock-free-sandbox')!;
  assert.equal(customerNeedsQuote(customer), false);
  assert.equal(customerNeedsQuote({ ...customer, tags: ['待报价'] }), true);
  assert.equal(customerNeedsQuote({ ...customer, progressionGoal: { dimension: 'need', label: '待报价', reason: '', question: '', questionStyle: 'spin_indirect', updatedAt: '' } }), true);
  assert.equal(customerNeedsQuote({ ...customer, estimatedValue: '待报价', readOnly: true }), false);
  assert.equal(customerNeedsQuote({ ...customer, estimatedValue: '待报价', isHistorical: true }), false);
});
