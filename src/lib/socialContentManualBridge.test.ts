import assert from 'node:assert/strict';
import type {
  CreateSocialArtifactInput,
  SocialContentArtifact,
  SocialContentTaskDetail,
} from '../../shared/contracts/socialContentWorkflow.js';
import {
  buildManualSocialArtifact,
  manualSocialArtifactMatchesSubmission,
  submitManualSocialArtifact,
  type ManualSocialArtifactPort,
} from './socialContentManualBridge.js';

const taskId = 'socialtask_manual_bridge';
const artifacts: SocialContentArtifact[] = [];
const operationKeys: string[] = [];
const received: CreateSocialArtifactInput[] = [];
const mediaUploads: string[] = [];
let loseNextCreateResponse = false;

const detail = (): SocialContentTaskDetail => ({ taskId, artifacts: [...artifacts] } as SocialContentTaskDetail);
const port: ManualSocialArtifactPort = {
  getTask: async () => detail(),
  uploadArtifactMedia: async (receivedTaskId, file, name, operationKey) => {
    assert.equal(receivedTaskId, taskId);
    assert.equal(file.type, 'video/mp4');
    assert.equal(name, 'social-video.mp4');
    assert.ok(operationKey?.startsWith('socialmanual:media:'));
    mediaUploads.push(operationKey!);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return {
      fileRef: `socialfile:socialfile_${'a'.repeat(24)}`,
      name,
      mimeType: file.type,
      size: file.size,
      sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
    };
  },
  createArtifact: async (receivedTaskId, input, operationKey) => {
    assert.equal(receivedTaskId, taskId);
    assert.ok(operationKey?.startsWith('socialmanual:'));
    operationKeys.push(operationKey!);
    received.push(input);
    const artifactId = `socialart_${artifacts.length + 1}`;
    const artifact: SocialContentArtifact = {
      artifactId,
      taskId,
      kind: input.kind,
      platform: input.platform ?? null,
      language: input.language ?? null,
      version: '1',
      status: 'review_required',
      origin: input.origin,
      resourceRef: input.resourceRef ?? null,
      content: input.content ? {
        ...input.content,
        media: {
          artifactId,
          fileRef: input.resourceRef,
          name: input.content.mediaName,
          mimeType: input.content.mediaMimeType,
          size: input.content.mediaSize,
          sha256: input.content.mediaSha256,
        },
      } : null,
      parentArtifactId: input.parentArtifactId ?? null,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    };
    if (input.parentArtifactId) {
      const parent = artifacts.find(item => item.artifactId === input.parentArtifactId);
      if (parent) parent.status = 'superseded';
    }
    artifacts.push(artifact);
    if (loseNextCreateResponse) {
      loseNextCreateResponse = false;
      throw new Error('network response lost');
    }
    return { artifact, task: detail() };
  },
};

const snapshot = {
  sourceKey: 'studio_session_1',
  projectId: 'project-1',
  title: '新品短视频',
  contentMode: 'video' as const,
  platform: 'tiktok',
  language: 'zh',
  aspectRatio: '9:16',
  durationSeconds: 20,
  body: '真实正文',
  generationKind: 'script' as const,
  generationProvenance: 'ai',
  qualityStatus: 'passed',
  publishable: true,
  generationRecordId: 'script-v1',
  outputUrl: 'file:///private/output.mp4',
};
const validSnapshot = {
  ...snapshot,
  outputUrl: null,
  outputMedia: new Blob([new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' }),
};

const payload = buildManualSocialArtifact(snapshot);
assert.equal(payload.origin, 'manual');
assert.equal(payload.kind, 'short_video');
assert.equal(payload.resourceRef, null, 'local filesystem paths must never cross the task API boundary');
assert.equal(payload.content?.title, '新品短视频');
assert.equal(payload.content?.projectId, 'project-1');
assert.equal(payload.content?.generationProvenance, 'ai');
assert.equal(payload.content?.qualityStatus, 'passed');
assert.equal(payload.content?.publishable, true);
assert.equal(payload.content?.generationRecordId, 'script-v1');
assert.throws(
  () => buildManualSocialArtifact({ ...snapshot, generationProvenance: 'manual_draft' }),
  /缺少已通过的 AI 来源、质量或可发布记录/,
  'a manually edited Studio script must not reuse an earlier generation approval',
);
assert.throws(
  () => buildManualSocialArtifact({ ...snapshot, generationRecordId: '' }),
  /缺少已通过的 AI 来源、质量或可发布记录/,
  'a Studio submission must be bound to an auditable generation record',
);

await assert.rejects(() => submitManualSocialArtifact(taskId, snapshot, port), /无法安全读取/);

const created = await submitManualSocialArtifact(taskId, validSnapshot, port);
assert.equal(created.replayed, false);
assert.equal(received.length, 1);
assert.equal(received[0]?.parentArtifactId, null);
assert.match(received[0]?.resourceRef || '', /^socialfile:/);
assert.equal(mediaUploads.length, 1);

const replayed = await submitManualSocialArtifact(taskId, validSnapshot, port);
assert.equal(replayed.replayed, true);
assert.equal(received.length, 1, 'repeated confirmation must not create a duplicate artifact');
assert.equal(mediaUploads.length, 1, 'replay must not upload duplicate media');

const firstInput = received[0]!;
const firstArtifact = artifacts[0]!;
assert.equal(manualSocialArtifactMatchesSubmission(taskId, firstArtifact, firstInput), true);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, { ...firstArtifact, taskId: 'socialtask_other' }, firstInput),
  false,
  'a matching artifact from another task must not be replayed',
);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, { ...firstArtifact, platform: 'youtube' }, firstInput),
  false,
  'platform remains part of the retry identity',
);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, { ...firstArtifact, language: 'en' }, firstInput),
  false,
  'language remains part of the retry identity',
);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, { ...firstArtifact, version: '' }, firstInput),
  false,
  'an invalid unversioned artifact must not be accepted as a replay result',
);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, {
    ...firstArtifact,
    content: {
      ...firstArtifact.content,
      media: { ...(firstArtifact.content?.media as Record<string, unknown>), sha256: 'b'.repeat(64) },
    },
  }, firstInput),
  false,
  'the server media descriptor must remain bound to the actual uploaded media hash',
);
const versionedInput: CreateSocialArtifactInput = {
  ...firstInput,
  content: { ...firstInput.content, renderVersion: 'render-v1' },
};
const versionedArtifact: SocialContentArtifact = {
  ...firstArtifact,
  content: { ...firstArtifact.content, renderVersion: 'render-v1' },
};
assert.equal(manualSocialArtifactMatchesSubmission(taskId, versionedArtifact, versionedInput), true);
assert.equal(
  manualSocialArtifactMatchesSubmission(taskId, versionedArtifact, {
    ...versionedInput,
    content: { ...versionedInput.content, renderVersion: 'render-v2' },
  }),
  false,
  'authored version fields must not be discarded by normalization',
);

artifacts[0]!.status = 'changes_requested';
const resubmitted = await submitManualSocialArtifact(taskId, validSnapshot, port);
assert.equal(resubmitted.replayed, false, 'a returned artifact must be resubmitted as a new review version');
assert.equal(received[1]?.parentArtifactId, 'socialart_1');

const revised = await submitManualSocialArtifact(taskId, { ...validSnapshot, body: '调整后的真实正文' }, port);
assert.equal(revised.replayed, false);
assert.equal(received.length, 3);
assert.equal(received[2]?.parentArtifactId, 'socialart_2');
assert.notEqual(operationKeys[1], operationKeys[2]);
assert.equal(artifacts[0]?.status, 'superseded');
assert.equal(artifacts[1]?.status, 'superseded');
assert.equal(artifacts[2]?.status, 'review_required');

const responseLostSnapshot = { ...validSnapshot, body: '响应丢失后的真实正文' };
loseNextCreateResponse = true;
await assert.rejects(
  () => submitManualSocialArtifact(taskId, responseLostSnapshot, port),
  /network response lost/,
);
const artifactCountAfterLostResponse = artifacts.length;
const createCountAfterLostResponse = received.length;
const uploadCountAfterLostResponse = mediaUploads.length;
const committedAfterLostResponse = artifacts.at(-1)!;
assert.equal(committedAfterLostResponse.status, 'review_required');

const recovered = await submitManualSocialArtifact(taskId, responseLostSnapshot, port);
assert.equal(recovered.replayed, true, 'retry must recover the committed artifact after its response was lost');
assert.equal(artifacts.length, artifactCountAfterLostResponse, 'retry must not create another artifact');
assert.equal(received.length, createCountAfterLostResponse, 'retry must not repeat the create request');
assert.equal(mediaUploads.length, uploadCountAfterLostResponse, 'retry must not upload the same media again');
assert.equal(committedAfterLostResponse.status, 'review_required', 'retry must not supersede the committed artifact');

await assert.rejects(
  () => submitManualSocialArtifact('../wrong-task', validSnapshot, port),
  /当前社媒任务已失效/,
);

console.log('social content manual bridge tests passed');
