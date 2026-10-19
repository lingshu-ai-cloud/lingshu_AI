import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareWeeklyEnterpriseFactFixture } from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import { issueWeeklyPublicationProductSelections, readWeeklyPublicationProductSelectionChoices } from './weeklyPublicationProductSelection.js';
import { adoptWeeklyAutomationTemplate } from './weeklyAutomationTemplate.js';
import { readWeeklyCtaContact, saveWeeklyCtaContact } from './weeklyCtaContact.js';
import { readWeeklySamplePolicyCandidateContext, readWeeklySamplePolicyEvidence, submitWeeklySamplePolicyCandidate,
  WEEKLY_SIGNED_SAMPLE_POLICIES, type SamplePolicyTerms } from './weeklySamplePolicyEvidence.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { encryptSecret } from '../lib/tenantPlatformApps.js';
import { whatsappAssetAuthorityHash } from '../whatsapp/assetAuthority.js';
import type { SignedSamplePolicy } from './weeklySignedSamplePolicy.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {runWeeklyCtaEvidenceRecoveryScan} from '../runtime/weeklyCtaEvidenceRecoveryScan.js';
import {getWeeklyExecutionTaskRow} from './executionTasks.js';

test('only current issuer signature, revocation and live matching Meta account admit frozen CTA', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'weekly-cta-positive-'));
  const env = { storage: process.env.LOCAL_OBJECT_STORAGE_ROOT, driver: process.env.OBJECT_STORAGE_DRIVER,
    key: process.env.TENANT_PLATFORM_APP_KEY };
  process.env.LOCAL_OBJECT_STORAGE_ROOT = root; process.env.OBJECT_STORAGE_DRIVER = 'local';
  process.env.TENANT_PLATFORM_APP_KEY = 'isolated-cta-test-key';
  try {
    const f = await prepareWeeklyEnterpriseFactFixture(t);
    const scope = { tenantId: f.task.tenantId, programId: f.task.programId,
      packageId: f.task.packageId, packageVersion: 1, publicationTaskId: 'pub' };
    const pkg = (await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
    const publication = { ...pkg.payload.socialContentPackage.publicationTasks[0], motherContentId: 'mother', status: 'planned' };
    await f.store.update('social_weekly_operating_packages', pkg.id, { payload: { ...pkg.payload,
      socialContentPackage: { ...pkg.payload.socialContentPackage, publicationTasks: [publication] } } });
    const choices = await readWeeklyPublicationProductSelectionChoices(f.store, scope);
    await issueWeeklyPublicationProductSelections(f.store, scope, 'owner', { expectedContextHash: choices.contextHash,
      productId: f.profile.products.items![0]!.id!, publicationTaskIds: ['pub'] });
    await adoptWeeklyAutomationTemplate(f.store, scope, 'owner');
    const terms: SamplePolicyTerms = { sampleFeeCny: 0, maximumFreeQuantity: 1,
      shippingFeePayer: 'buyer', customsDutyPayer: 'buyer', eligibleMarkets: ['US'],
      eligibleCustomerTypes: ['brand buyer'], validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-12-31T23:59:59Z' };
    const context = await readWeeklySamplePolicyCandidateContext(f.store, scope);
    const candidate = await submitWeeklySamplePolicyCandidate({ store: f.store, scope, actorUserId: 'owner',
      expectedContextHash: context.contextHash, terms, pdfBytes: Buffer.from('%PDF-1.7\nPolicy document\n%%EOF') });
    const contact = await readWeeklyCtaContact(f.store, scope);
    const saved = await saveWeeklyCtaContact(f.store, scope, 'owner', { contactChannel: 'whatsapp',
      contactValue: '+12025550123', expectedContextHash: contact.contextHash, expectedReceiptId: null });
    const app = { id: 'meta-app', tenant_id: scope.tenantId, platform: 'meta', status: 'active',
      app_id: 'app', app_secret: encryptSecret('secret'), access_token: encryptSecret('token'),
      waba_id: 'waba', phone_number_id: 'phone', wa_public_number: '+12025550123' } as any;
    app.last_checklist = JSON.stringify({ whatsappAssetProof: { authorityHash: whatsappAssetAuthorityHash(app), verifiedAt: new Date().toISOString() } });
    await f.store.create('tenant_platform_apps', app);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const body = { kind: 'weekly-sample-policy-attestation.v1' as const, issuerId: 'external-issuer', keyId: 'key-1',
      policyId: 'policy-1', scope, selectionHash: candidate.selectionHash, productId: candidate.productId,
      productSku: candidate.productSku, enterpriseFactContentHash: candidate.enterpriseFactContentHash,
      frozenCtaHash: candidate.frozenCtaHash, contactReceiptId: saved.receiptId!,
      contactHash: socialRequestHash(saved.receipt), sourceSha256: candidate.sourceSha256, terms,
      issuedAt: '2026-10-18T00:00:00Z' };
    const policy: SignedSamplePolicy = { ...body,
      signatureBase64: sign(null, Buffer.from(socialRequestHash(body)), privateKey).toString('base64') };
    await f.store.create(WEEKLY_SIGNED_SAMPLE_POLICIES, { id: policy.policyId,
      tenant_id: scope.tenantId, program_id: scope.programId, package_id: scope.packageId,
      package_version: scope.packageVersion, publication_task_id: scope.publicationTaskId,
      content_hash: socialRequestHash(policy), payload: policy });
    let revoked = false, metaCalls = 0;
    const authority = { roots: [{ issuerId: body.issuerId, keyId: body.keyId,
      tenantId: scope.tenantId, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
      isRevoked: async () => revoked, metaProvider: {
        listPhoneNumbers: async () => { metaCalls++; return { data: [{ id: 'phone' }] }; },
        getPhoneNumber: async () => ({ id: 'phone', display_phone_number: '+1 202 555 0123' }),
      } };
    const now = new Date('2026-10-19T00:00:00Z');
    assert.equal((await readWeeklySamplePolicyEvidence({ store: f.store, scope, authority, now }))?.authorizesProduction, true);
    assert.equal(metaCalls, 1);
    const blocked={...f.task,taskId:'cta-preparation',publicationTaskId:'pub',status:'blocked' as const,
      ownBlockingReasons:['weekly_production_cta_evidence_required','independent_hold'],
      lastError:{code:'weekly_production_cta_evidence_required',message:'policy pending',retryable:false,occurredAt:now.toISOString()},
      schedule:{...f.task.schedule,stepKind:'material_preparation' as const}} as WeeklyExecutionTask;
    await f.store.create('social_weekly_execution_tasks',{tenant_id:scope.tenantId,program_id:scope.programId,
      package_id:scope.packageId,package_version:scope.packageVersion,task_id:blocked.taskId,
      idempotency_key:blocked.idempotencyKey,status:'blocked',payload:blocked});
    const scriptBlocked={...blocked,taskId:'cta-script',idempotencyKey:'cta-script-unique',schedule:{...blocked.schedule,stepKind:'script' as const}};
    await f.store.create('social_weekly_execution_tasks',{tenant_id:scope.tenantId,program_id:scope.programId,
      package_id:scope.packageId,package_version:scope.packageVersion,task_id:scriptBlocked.taskId,
      idempotency_key:scriptBlocked.idempotencyKey,status:'blocked',payload:scriptBlocked});
    revoked=true;
    assert.equal((await runWeeklyCtaEvidenceRecoveryScan({store:f.store,scope,authority})).resumed,0,
      'revoked policy must leave the same task blocked');
    revoked=false;
    const recovery=await runWeeklyCtaEvidenceRecoveryScan({store:f.store,scope,authority});
    assert.equal(recovery.resumed,2,JSON.stringify(recovery));
    const resumed=(await getWeeklyExecutionTaskRow(f.store,scope.tenantId,blocked.taskId)).payload;
    assert.equal(resumed.taskId,blocked.taskId);
    assert.deepEqual(resumed.ownBlockingReasons,['independent_hold']);
    assert.deepEqual((await getWeeklyExecutionTaskRow(f.store,scope.tenantId,scriptBlocked.taskId)).payload.ownBlockingReasons,['independent_hold']);
    assert.equal((await runWeeklyCtaEvidenceRecoveryScan({store:f.store,scope,authority})).resumed,0,
      'repeat scans cannot resume the same blocker twice');
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store, scope, authority: {
      ...authority, metaProvider: { ...authority.metaProvider, getPhoneNumber: async () => {
        await f.store.create('tenant_platform_apps', { ...app, id: 'meta-app-duplicate' });
        return { id: 'phone', display_phone_number: '+1 202 555 0123' };
      } },
    }, now }), null, 'a second active local binding created during the Meta read must close admission');
    await f.store.update('tenant_platform_apps', 'meta-app-duplicate', { status: 'inactive' });
    let revocationChecks = 0;
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store, scope,
      authority: { ...authority, isRevoked: async () => ++revocationChecks === 2 }, now }), null,
    'a policy revoked while the Meta read was in flight cannot authorize paid work');
    revoked = true;
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store, scope, authority, now }), null);
    revoked = false;
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store, scope,
      authority: { ...authority, roots: [] }, now }), null);
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store, scope,
      authority: { ...authority, metaProvider: { ...authority.metaProvider,
        getPhoneNumber: async () => ({ id: 'phone', display_phone_number: '+1 202 555 0999' }) } }, now }), null);
    assert.equal(await readWeeklySamplePolicyEvidence({ store: f.store,
      scope: { ...scope, packageVersion: 2 }, authority, now }).catch(() => null), null);
  } finally {
    if (env.storage === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = env.storage;
    if (env.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = env.driver;
    if (env.key === undefined) delete process.env.TENANT_PLATFORM_APP_KEY; else process.env.TENANT_PLATFORM_APP_KEY = env.key;
    await rm(root, { recursive: true, force: true });
  }
});
