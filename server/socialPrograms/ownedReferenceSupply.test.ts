import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { SocialDiscoverySupplyItem } from '../../shared/contracts/socialContentWorkflow.js';
import { ownedReferenceSupply } from './ownedReferenceSupply.js';

function fixture() {
  const content = { tenantId: 't', accountId: 'connection', channelId: 'tiktok', externalContentId: 'video', status: 'published', publicUrl: 'https://example.com/video' };
  const snapshot = { tenantId: 't', snapshotId: 'metrics', accountId: 'connection', channelId: 'tiktok', externalContentId: 'video', capturedAt: '2026-10-01T00:00:00Z', source: 'provider', metrics: { views: 1000, likes: 80, shares: 12, comments: 5 } };
  const rows: Record<string, any[]> = {
    social_owned_accounts: [{ id: 'account', tenant_id: 't', program_id: 'p', payload: { programId: 'p', accountId: 'owned', connectionId: 'connection', platform: 'tiktok', version: 1 } }],
    social_external_contents: [{ id: 'history', tenant_id: 't', account_id: 'connection', channel_id: 'tiktok', external_content_id: 'video', content }],
    social_channel_metric_snapshots: [{ id: 'metricrow', tenant_id: 't', snapshot_id: 'metrics', account_id: 'connection', channel_id: 'tiktok', external_content_id: 'video', snapshot }],
  };
  const store = { async list(collection: string, query: any) { const items = rows[collection].filter(row => Object.entries(query.where).every(([key, value]) => row[key] === value)); return { items: structuredClone(items), totalItems: items.length }; } } as unknown as DataStore;
  const video = { candidateId: 'candidate', platform: 'tiktok', sourceUrl: content.publicUrl } as SocialDiscoverySupplyItem;
  return { rows, store, video, snapshot };
}

test('owned references require actual published ownership and preserve plays, likes, shares and comments', async () => {
  const f = fixture();
  const [result] = await ownedReferenceSupply(f.store, 't', 'p', [f.video], new Date('2026-10-09T00:00:00Z'));
  assert.equal(result.account.accountId, 'owned');
  assert.equal(result.evidenceRef, 'owned_content:history');
  assert.deepEqual(result.historicalPerformance?.metrics, { views: 1000, likes: 80, shares: 12, comments: 5 });
  f.rows.social_external_contents[0].content.status = 'draft';
  assert.deepEqual(await ownedReferenceSupply(f.store, 't', 'p', [f.video]), []);
});

test('foreign account, mismatched row identity and future snapshots cannot supply owned performance', async () => {
  const f = fixture();
  f.snapshot.capturedAt = '2099-10-01T00:00:00Z';
  assert.equal((await ownedReferenceSupply(f.store, 't', 'p', [f.video]))[0].historicalPerformance, null);
  f.rows.social_external_contents[0].content.accountId = 'foreign';
  assert.deepEqual(await ownedReferenceSupply(f.store, 't', 'p', [f.video]), []);
});

test('ambiguous owned account mappings require resolution instead of silently choosing a tone', async () => {
  const f = fixture();
  f.rows.social_owned_accounts.push({ ...f.rows.social_owned_accounts[0], id: 'another', payload: { ...f.rows.social_owned_accounts[0].payload, accountId: 'second-owned' } });
  await assert.rejects(ownedReferenceSupply(f.store, 't', 'p', [f.video]), { code: 'owned_reference_account_ambiguous' });
});
test('complete actual four-metric evidence ranks historical references before partial, synthetic or discovery order',async()=>{
 const f=fixture();const add=(id:string,metrics:Record<string,unknown>,source='provider')=>{const publicUrl=`https://example.com/${id}`,content={...f.rows.social_external_contents[0].content,publicUrl,externalContentId:id};f.rows.social_external_contents.push({...f.rows.social_external_contents[0],id:`history-${id}`,external_content_id:id,content});const snapshot={...f.snapshot,snapshotId:`metrics-${id}`,externalContentId:id,source,metrics};f.rows.social_channel_metric_snapshots.push({...f.rows.social_channel_metric_snapshots[0],id:`row-${id}`,snapshot_id:snapshot.snapshotId,external_content_id:id,snapshot});return {...f.video,candidateId:id,sourceUrl:publicUrl};};
 const partial=add('partial',{views:999999,likes:100,shares:null,comments:100}),fake=add('synthetic',{views:999999,likes:999,shares:999,comments:999},'fixture'),best=add('best',{views:2000,likes:1,shares:1,comments:1}),tie=add('tie',{views:2000,likes:0,shares:2,comments:0}),zero=add('zero',{views:0,likes:0,shares:0,comments:0});
 const result=await ownedReferenceSupply(f.store,'t','p',[partial,fake,f.video,best,tie,zero],new Date('2026-10-09T00:00:00Z'));
 assert.deepEqual(result.map(pair=>pair.video.candidateId),['tie','best','candidate','zero','partial','synthetic']);assert.deepEqual(result[3]!.historicalPerformance!.metrics,{views:0,likes:0,shares:0,comments:0});
});
