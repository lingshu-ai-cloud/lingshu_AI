import assert from 'node:assert/strict';
import { demandGenOperations, GoogleExecutionAdapter } from './googleExecutionAdapter.js';
import { AdProviderError } from './metaAdapter.js';
process.env.GOOGLE_ADS_API_VERSION = 'v25';
const plan = { customerId: '1234567890', name: 'Lead generation', totalBudget: 100, targetCpa: 10, startDate: '2027-01-01', endDate: '2027-01-10', videoAssetId: '1', logoAssetId: '2', finalUrl: 'https://example.com', businessName: 'Factory', headline: 'Factory supply', longHeadline: 'Factory direct supply', description: 'Request a quote', locationIds: ['2840'] };
const operations = demandGenOperations(plan) as any[];
assert.equal(operations[0].campaignBudgetOperation.create.totalAmountMicros, '100000000');
assert.equal(operations[1].campaignOperation.create.status, 'PAUSED');
assert.equal(operations[1].campaignOperation.create.advertisingChannelType, 'DEMAND_GEN');
assert.equal(operations[2].adGroupOperation.create.demandGenAdGroupSettings.channelControls.selectedChannels.display, false);
assert.throws(() => demandGenOperations({ ...plan, videoAssetId: '../2' }));
const calls: any[] = [];
const adapter = new GoogleExecutionAdapter('private', (async (_url: any, init: any) => {
  calls.push({ body: JSON.parse(init.body), headers: init.headers });
  return Response.json({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/1' } }, { campaignResult: { resourceName: 'customers/1234567890/campaigns/2' } }, { adGroupResult: { resourceName: 'customers/1234567890/adGroups/3' } }, { adGroupAdResult: { resourceName: 'customers/1234567890/adGroupAds/3~4' } }] });
}) as typeof fetch);
assert.equal((await adapter.createPaused(plan)).campaignId, 'customers/1234567890/campaigns/2');
assert.equal(calls[0].body.validateOnly, true);
assert.equal(calls[1].body.validateOnly, false);
assert.equal(calls[1].body.partialFailure, false);
assert.equal(calls[0].headers['developer-token'], undefined);
let changed = false;
const uncertain = new GoogleExecutionAdapter('private', (async (_url: any, init: any) => {
  const body = JSON.parse(init.body);
  if (body.mutateOperations) { changed = true; return Response.json({}); }
  if (changed) return Response.json({ error: {} }, { status: 403 });
  if (body.query.includes('FROM ad_group_ad')) return Response.json({ results: [{ adGroup: { resourceName: 'customers/1234567890/adGroups/3', campaign: 'customers/1234567890/campaigns/2' }, adGroupAd: { resourceName: 'customers/1234567890/adGroupAds/3~4' } }] });
  return Response.json({ results: [{ campaign: { status: 'PAUSED' } }] });
}) as typeof fetch);
await assert.rejects(uncertain.setStatus('1234567890', { campaignId: 'customers/1234567890/campaigns/2', adgroupId: 'customers/1234567890/adGroups/3', adId: 'customers/1234567890/adGroupAds/3~4' }, 'PAUSED'), (error: unknown) => error instanceof AdProviderError && error.uncertain);
console.log('Google Demand Gen adapter contract tests passed');
