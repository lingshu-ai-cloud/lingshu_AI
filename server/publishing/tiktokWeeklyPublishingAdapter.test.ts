import {prepareTikTokAttemptReceipt,tikTokAccountIdentityHash,type TikTokDirectPostOptions} from '../lib/tikTokDirectPostContract.js';
import type {DurablePublicationAttempt} from './weeklyLineage.js';
import type {StarterPublicationPackage} from './starterPublicationPackage.js';
import type {WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {buildPublicationAssignment} from '../digitalEmployees/publishingExecution.js';
import {persistPublicationAssignment} from './weeklyLineage.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { sealAccountCredential, socialAccessToken } from '../lib/accountCredentials.js';
import { createTikTokWeeklyPublishingAdapter } from './tiktokWeeklyPublishingAdapter.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return {
    // Explicit isolated, controlled provider fixture capability.
    supportsAtomicOperationLease: () => true,
    rows,
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = [...(rows.get(collection) || [])];
      for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
      if (query.sort) { const desc = query.sort.startsWith('-'), key = desc ? query.sort.slice(1) : query.sort; items.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (desc ? -1 : 1)); }
      const page = query.page ?? 1, perPage = query.perPage ?? 500;
      return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems: items.length, totalPages: Math.ceil(items.length / perPage), page, perPage };
    },
    async getById<T>(collection: string, id: string) { return (rows.get(collection) || []).find(row => row.id === id) as T || null; },
    async create<T>(collection: string, data: Record<string, unknown>) { const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data }; rows.set(collection, [...(rows.get(collection) || []), item]); return item as T; }, async update(collection:string,id:string,data:Record<string,unknown>) {const r=(rows.get(collection)||[]).find(r=>r.id===id);if(!r)return false;Object.assign(r,data);return true;}, async delete() { return false; },
  };
}

process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'weekly-adapter-test-key';
const dataStore = memoryStore();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-tiktok-source-'));
const videoPath = path.join(mediaDir, 'video.mp4');
fs.writeFileSync(videoPath, Buffer.from('approved-video-fixture'));
const videoHash = createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
dataStore.rows.set('social_accounts', [{ id: 'account-1', tenantId: 'tenant-a', platform: 'tiktok', providerAccountId:'native-account', status: 'connected', accessToken: sealAccountCredential('token') }]);
const evidence = (capability: string) => ({ id: capability, tenant_id: 'tenant-a', account_id: 'account-1', platform: 'tiktok', capability, status: 'verified', evidence_source: 'provider_probe', evidence_ref: capability === 'publishing.receipt_lookup' ? 'provider:tiktok:receipt:v_pub_file~v2-1.123456789' : 'provider:tiktok:account:account-1', verified_at: '2026-09-25T23:50:00Z', expires_at: '2026-09-26T00:05:00Z', created_at: '2026-09-25T23:50:00Z', updated_at: '2026-09-25T23:50:00Z' });
dataStore.rows.set('social_platform_capability_evidence', [evidence('publishing.official'), evidence('publishing.receipt_lookup')]);
dataStore.rows.set('starter_social_content_artifacts', [{
  id: 'artifact-row', tenant_id: 'tenant-a', artifact_id: 'artifact-1', version: 'v1', status: 'approved',
  task_id: 'task-1', resource_ref: 'socialfile:socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', content_hash: videoHash, content: {
    productionResult: { productionResultId: 'production-1', version: 'v1', status: 'asset_review', technicalReview: { approved: true }, creativeReview: { approved: true } },
    mediaStorage: { video: { url: videoPath, fileId: 'socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', fileRef: 'socialfile:socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', sha256: videoHash } },
  },
}]);
const tiktokOptions:TikTokDirectPostOptions={privacyLevel:'SELF_ONLY',allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:true,userConsent:true};
let publishes = 0, reconciles = 0;
const adapter = await createTikTokWeeklyPublishingAdapter({ tenantId: 'tenant-a', accountId: 'account-1', dataStore, now: new Date('2026-09-26T00:00:00Z'), ports: {
  async publish(input) { publishes += 1; assert.equal(input.videoPath, videoPath); assert.equal(input.sourceClaim?.sourceKind, 'social_production_artifact');
    assert.deepEqual(input.tiktokPostOptions,tiktokOptions);
    assert.ok(input.onTikTokAttemptPrepared);assert.ok(input.onProviderReceipt);
    const prepared=prepareTikTokAttemptReceipt({tenantId:'tenant-a',accountId:'account-1',attemptId:'attempt-1',accountIdentityHash:'a'.repeat(64),creator:{creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60},options:tiktokOptions,videoSha256:videoHash,videoSize:fs.statSync(videoPath).size,durationSeconds:1,validatedAt:'2026-09-25T00:00:00Z'});
    await assert.rejects(input.onTikTokAttemptPrepared({...prepared,tenantId:'foreign'}),/tiktok_attempt_scope_changed/);
    await input.onTikTokAttemptPrepared(prepared);
    const durable=dataStore.rows.get('social_publication_attempts')![0]!;durable.provider='foreign';
    await assert.rejects(input.onProviderReceipt('v_pub_file~v2-1.123456789'),/tiktok_attempt_scope_changed/);durable.provider='tiktok-content-posting-api';
    await input.onProviderReceipt('v_pub_file~v2-1.123456789');await assert.rejects(input.onProviderReceipt('foreign-receipt'),/tiktok_attempt_scope_changed/);
    assert.equal(durable.provider_receipt_id,'v_pub_file~v2-1.123456789'); return { video: {}, tracking: {id:'controlled',tenant_id:'tenant-a',platform:'tiktok',track_code:'controlled'}, publishRecord: null, platformPostId: '', deliveryStatus: 'provider_accepted', providerReceiptId: 'v_pub_file~v2-1.123456789' }; },
  async reconcile() { reconciles += 1; return { status: 'published', providerReceiptId: 'v_pub_file~v2-1.123456789', platformPostId: 'post-1', platformUrl: 'https://tiktok.example/post-1', providerStatus: 'PUBLISH_COMPLETE', error: '' }; },
} });
assert.equal(adapter.capability, 'available');
const pub={publicationTaskId:'task-1',motherContentId:'legacy-mother',adaptationOfPublicationTaskId:null,platform:'tiktok' as const,accountId:'account-1',accountPositioning:'企业证明',businessProposition:'产品说明',cta:'询问',factRefs:[],metricTargets:[],publishWindow:'2026-09-26T12:00:00Z',status:'ready' as const};
const weekly:WeeklyOperatingPackage={packageId:'legacy-week',programId:'program',version:1,status:'active',weekStart:'2026-09-22',weekEnd:'2026-09-28',objective:'Legacy adapter unit test',enterpriseProfileRef:null,businessContentGoalRef:null,monthlyPlanRef:null,workflows:[],appliedWorkflowEvents:[],taskVersionMappings:[],planningBlockers:[],capacityPlanRef:null,automationPolicyRef:null,discoveryBudgetCny:null,workflowTasks:[{taskId:'workflow',kind:'publishing',taskRef:{type:'weekly_workflow_task',id:'workflow',version:1},dependsOnTaskIds:[],subjectRefs:[],status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[],carriedFromTaskId:null}],socialContentPackage:{contentPackageId:'content-package',operatingPackageId:'legacy-week',version:1,status:'active',originalContentTarget:1,adaptationVersionTarget:0,publicationTaskTarget:1,publicationTasks:[pub],weeklyBudgetCny:0,perItemBudgetCny:0,capacityNotes:[],authorization:{mode:'bounded',accountIds:['account-1'],maxPublishItems:1,weekStart:'2026-09-22',weekEnd:'2026-09-28',allowRealPublishing:true,authorizedBy:'owner',authorizedAt:'2026-09-21T00:00:00Z',revokedBy:null,revokedAt:null}},successCriteria:[],changeReason:null,previousVersion:null,createdBy:'owner',createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z'};
dataStore.rows.set('social_weekly_operating_packages',[{id:'legacy-week-row',tenant_id:'tenant-a',program_id:'program',package_id:weekly.packageId,version:1,payload:weekly}]);
const assignment=buildPublicationAssignment({tenantId:'tenant-a',operatingPackage:weekly,publicationTask:pub,productionResult:{productionResultId:'production-1',contentId:'artifact-1',contentVersion:'v1',contentHash:videoHash,title:'Title',body:'Body',assets:[{kind:'video',fileName:'video.mp4',downloadUrl:videoPath,contentHash:videoHash}],sourceRefs:[],acceptedAt:'2026-09-25T00:00:00Z'}});await persistPublicationAssignment(assignment,dataStore);
const publicationPackage:StarterPublicationPackage = { tiktokPostOptions:tiktokOptions,schemaVersion:1,packageId:assignment.packageId,tenantId:assignment.tenantId,platform:'tiktok',packageHash:'controlled-package',generatedAt:'2026-09-25T00:00:00Z',status:'awaiting_user_publish',publishingSteps:[], contentId: 'artifact-1:task-1', contentVersion: 'v1', contentHash: videoHash, operatingLineage: {...assignment.lineage,assignmentId:assignment.assignmentId,assignmentHash:assignment.assignmentHash}, copy: { title: 'Title', body: 'Body', hashtags: [] }, assets: [{ kind: 'video', fileName:'video.mp4', downloadUrl: `file://${videoPath}`, contentHash: videoHash }] };
dataStore.rows.set('social_publication_attempts',[{id:'attempt-row',tenant_id:assignment.tenantId,attempt_id:'attempt-1',assignment_id:assignment.assignmentId,package_id:assignment.packageId,provider:'tiktok-content-posting-api',status:'in_flight',started_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-25T00:00:00Z'}]);
assert.deepEqual(await adapter.publish({ assignment, publicationPackage, attemptId: 'attempt-1' }), { status: 'accepted', providerReceiptId: 'v_pub_file~v2-1.123456789' });
const attempt:DurablePublicationAttempt={id:'attempt-row',tenant_id:assignment.tenantId,attempt_id:'attempt-1',assignment_id:assignment.assignmentId,package_id:assignment.packageId,provider:'tiktok-content-posting-api',status:'unknown',provider_receipt_id:'v_pub_file~v2-1.123456789',started_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-25T00:00:00Z'};
const reconciled = await adapter.reconcile({ assignment, publicationPackage, attempt });
for(const corrupted of [{...attempt,tenant_id:'foreign'},{...attempt,assignment_id:'foreign'},{...attempt,package_id:'foreign'},{...attempt,provider:'foreign'}])assert.equal((await adapter.reconcile({assignment,publicationPackage,attempt:corrupted})).status,'unknown');
assert.equal(reconciled.status, 'published');
assert.equal(reconciled.platformPostId, 'post-1');
assert.equal(publishes, 1); assert.equal(reconciles, 1);
// Recover a lost outer callback only from the canonical persisted same-attempt ID.
const account=dataStore.rows.get('social_accounts')![0]!;
const canonicalReceipt=prepareTikTokAttemptReceipt({tenantId:'tenant-a',accountId:'account-1',attemptId:'attempt-1',accountIdentityHash:tikTokAccountIdentityHash({tenantId:'tenant-a',accountId:'account-1',providerAccountId:'native-account',accessToken:socialAccessToken(account)}),creator:{creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60},options:tiktokOptions,videoSha256:videoHash,videoSize:fs.statSync(videoPath).size,durationSeconds:1,validatedAt:'2026-09-25T00:00:00Z'});
dataStore.rows.set('posts',[{id:'canonical-post',tenant_id:'tenant-a',platform:'tiktok',stats:{publishResults:{'account-1':{status:'unknown',attemptId:'attempt-1',providerReceiptId:'v_pub_file~v2-1.123456789',tiktokValidationReceipt:canonicalReceipt}}}}]);
const savedAttempt=dataStore.rows.get('social_publication_attempts')![0]!;savedAttempt.status='unknown';delete savedAttempt.provider_receipt_id;
const recoveredOuter=await adapter.reconcile({assignment,publicationPackage,attempt:{...attempt,provider_receipt_id:undefined}});
assert.equal(recoveredOuter.status,'published');assert.equal(savedAttempt.provider_receipt_id,'v_pub_file~v2-1.123456789');assert.equal(publishes,1);assert.equal(reconciles,2);


const artifact = dataStore.rows.get('starter_social_content_artifacts')![0]!;
artifact.content.productionResult.technicalReview.approved = false;
await assert.rejects(
  adapter.publish({ assignment, publicationPackage, attemptId: 'attempt-after-revocation' }),
  /weekly_publish_source_evidence_invalid/, // Actual frozen weekly legacy evidence rejects before generic media validation.
  'the approved production row must be rechecked before each provider effect',
);
assert.equal(publishes, 1);
artifact.content.productionResult.technicalReview.approved = true;

dataStore.rows.set('social_platform_capability_evidence', [evidence('publishing.official')]);
const unavailable = await createTikTokWeeklyPublishingAdapter({ tenantId: 'tenant-a', accountId: 'account-1', dataStore, now: new Date('2026-09-26T00:00:00Z'), ports: { async publish() { throw new Error('must not run'); }, async reconcile() { throw new Error('must not run'); } } });
assert.equal(unavailable.capability, 'available', 'first publish requires only the official publish probe');
console.log('TikTok weekly official publishing adapter tests passed');
fs.rmSync(mediaDir, { recursive: true, force: true });
