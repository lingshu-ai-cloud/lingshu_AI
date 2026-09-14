import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { store } from '../storage/index.js';
import {
  PublishSourceVerificationError,
  digitalEmployeePublishSourceClaim,
  freezePublishSourceClaim,
  publishingUploadDir,
  verifyFrozenPublishSourceClaim,
} from './publishSourceClaim.js';

const tenantId = `publish-source-test-${process.pid}-${Date.now()}`;
const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-publish-source-'));
const uploadDir = publishingUploadDir(tenantId);
fs.mkdirSync(uploadDir, { recursive: true });
const sourceVideo = path.join(sourceDir, 'current.mp4');
const projectCopy = path.join(uploadDir, 'project-current.mp4');
const manualVideo = path.join(uploadDir, 'manual-current.mp4');
for (const file of [sourceVideo, projectCopy, manualVideo]) fs.writeFileSync(file, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]));

const generation = {
  generationKind: 'script' as const,
  generationProvenance: 'ai',
  qualityStatus: 'passed',
  publishable: true,
  generationRecordId: 'script-v1',
};
const studioProject: { id: string; tenant_id: string; status: string; spec: Record<string, any> } = {
  id: 'studio-1', tenant_id: tenantId, status: 'completed',
  spec: {
    script: 'current verified script', activeModeScriptId: 'script-v1', renderOutputPath: sourceVideo,
    modeScripts: [{ id: 'script-v1', script: 'current verified script', generationProvenance: 'ai', qualityStatus: 'passed', publishable: true }],
  },
};
const digitalProject: { id: string; tenant_id: string; status: string; spec: Record<string, any> } = {
  id: 'digital-1', tenant_id: tenantId, status: 'ready_for_approval',
  spec: { script: 'approved subject', automation: {
    managedBy: 'digital_employee', stage: 'completed', renderOutputPath: sourceVideo,
    contentVersion: 3, quality: { passed: true, ruleVersion: 9 },
  } },
};
const projects = new Map([[studioProject.id, studioProject], [digitalProject.id, digitalProject]]);
const originalGetById = store.getById;
store.getById = (async (collection: string, id: string) => collection === 'studio_projects'
  ? structuredClone(projects.get(id) || null)
  : null) as typeof store.getById;

try {
  await assert.rejects(
    freezePublishSourceClaim(tenantId, { videoPath: manualVideo }),
    error => error instanceof PublishSourceVerificationError && error.code === 'publish_source_required',
    'omitting projectId is not an implicit manual-upload bypass',
  );
  const manualClaim = await freezePublishSourceClaim(tenantId, { sourceKind: 'manual_upload', videoPath: manualVideo });
  assert.equal(manualClaim.sourceKind, 'manual_upload');
  fs.appendFileSync(manualVideo, Buffer.from([1]));
  await assert.rejects(
    verifyFrozenPublishSourceClaim(tenantId, manualClaim),
    error => error instanceof PublishSourceVerificationError && error.code === 'publish_source_claim_stale',
    'a frozen manual upload cannot be replaced after enqueue',
  );

  const studioClaim = await freezePublishSourceClaim(tenantId, {
    sourceKind: 'project', projectId: studioProject.id, sourceVideoPath: sourceVideo,
    videoPath: projectCopy, ...generation,
  });
  assert.equal(studioClaim.sourceKind, 'studio_project');
  assert.equal(studioClaim.sourceVideoPath, sourceVideo);
  assert.equal(studioClaim.deliveryVideoPath, projectCopy);
  await verifyFrozenPublishSourceClaim(tenantId, studioClaim);
  await assert.rejects(
    verifyFrozenPublishSourceClaim(tenantId, studioClaim, sourceVideo),
    error => error instanceof PublishSourceVerificationError && error.code === 'publish_delivery_artifact_stale',
    'editing only the calendar delivery path cannot bypass the frozen artifact binding',
  );
  studioProject.spec.script = 'manually changed after approval';
  await assert.rejects(
    verifyFrozenPublishSourceClaim(tenantId, studioClaim),
    error => error instanceof PublishSourceVerificationError && error.code === 'studio_generation_record_stale',
    'editing the active Studio script invalidates the frozen generation claim',
  );

  const digitalClaim = digitalEmployeePublishSourceClaim(tenantId, digitalProject, sourceVideo);
  await verifyFrozenPublishSourceClaim(tenantId, digitalClaim);
  digitalProject.spec.automation.quality.passed = false;
  await assert.rejects(
    verifyFrozenPublishSourceClaim(tenantId, digitalClaim),
    error => error instanceof PublishSourceVerificationError && error.code === 'digital_employee_generation_stale',
    'digital-employee quality invalidation must stop the approved artifact',
  );
} finally {
  store.getById = originalGetById;
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(uploadDir, { recursive: true, force: true });
}

const platformPublisher = fs.readFileSync(new URL('./platformPublisher.ts', import.meta.url), 'utf8');
const adjacentGuards = platformPublisher.match(/await publishLease\.beforeEffect\(\);\s*await revalidatePublishSource\(input\);\s*providerStarted = true;/g) || [];
assert.ok(adjacentGuards.length >= 4, 'every provider submit boundary must revalidate the frozen source immediately after renewing its lease');

const publishingRoute = fs.readFileSync(new URL('../routes/publishing.ts', import.meta.url), 'utf8');
assert.ok(
  publishingRoute.indexOf('await freezePublishSourceClaim') < publishingRoute.indexOf('const tracked = await createTrackedPostDraft', publishingRoute.indexOf("publishingRouter.post('/calendar'")),
  'calendar enqueue must freeze source provenance before it creates an actionable post',
);
assert.match(publishingRoute, /publishSourceClaim,/, 'calendar persistence must retain the frozen claim');

console.log('publish source claim and provider-boundary tests passed');
