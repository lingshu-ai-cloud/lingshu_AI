import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamUsageStore } from './teamUsage.js';

function attr(key: string, value: string | number) {
  return {
    key,
    value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
  };
}

function pauseNextRead(store: TeamUsageStore): {
  reached: Promise<void>;
  release: () => void;
  restore: () => void;
} {
  const internal = store as unknown as { read: () => Promise<unknown> };
  const original = internal.read.bind(store);
  let markReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { markReached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  internal.read = async () => {
    const document = await original();
    markReached();
    await gate;
    return document;
  };
  return { reached, release, restore: () => { internal.read = original; } };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-team-usage-'));
let current = new Date('2026-09-22T08:00:00.000Z');

try {
  const store = new TeamUsageStore({ dataDir: root, now: () => current });
  const created = await store.createMember('吴小姐');
  assert.match(created.ingestToken, /^cdu_/);
  assert.match(created.connectorToken, /^cdc_/);
  assert.equal((await store.authenticateIngestToken(created.ingestToken)).id, created.member.id);
  assert.equal((await store.authenticateConnectorToken(created.connectorToken)).id, created.member.id);
  await assert.rejects(() => store.authenticateConnectorToken(created.ingestToken), /invalid_ingest_token/);
  await assert.rejects(() => store.authenticateIngestToken(created.connectorToken), /invalid_ingest_token/);
  await assert.rejects(() => store.createMember('cookie=session=member-secret'), /credential_material_not_accepted/);
  assert.equal((await store.listMembers())[0]?.name, '吴小姐');

  const payload = {
    resourceLogs: [{
      resource: { attributes: [attr('service.name', 'codex_desktop'), attr('app.version', '0.155.1')] },
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: '1790064000000000000',
          body: { stringValue: 'event codex.sse_event' },
          attributes: [
            attr('event.name', 'codex.sse_event'),
            attr('event.kind', 'response.completed'),
            attr('conversation.id', 'conversation-secret-id'),
            attr('model', 'gpt-5.6-terra'),
            attr('gen_ai.usage.input_tokens', 12_000),
            attr('gen_ai.usage.cache_read.input_tokens', 8_000),
            attr('gen_ai.usage.cache_write.input_tokens', 500),
            attr('gen_ai.usage.output_tokens', 900),
            attr('codex.usage.reasoning_output_tokens', 250),
            attr('codex.usage.total_tokens', 12_900),
            attr('prompt', 'this must never be persisted'),
          ],
        }],
      }],
    }],
  };

  assert.deepEqual(await store.ingest(created.ingestToken, payload), { accepted: 1, memberId: created.member.id });
  assert.equal((await store.ingest(created.ingestToken, payload)).accepted, 0, 'duplicate OTLP batches must be idempotent');
  const hiddenTelemetryCredential = 'refresh_token=opaque-telemetry-secret';
  const maliciousPayload = {
    resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: '1790064001000000000',
      attributes: [
        attr('model', hiddenTelemetryCredential),
        attr('service.name', 'codex_desktop'),
        attr('app.version', '0.155.1'),
        attr('gen_ai.usage.input_tokens', 1),
        attr('gen_ai.usage.output_tokens', 1),
      ],
    }] }] }],
  };
  await assert.rejects(
    () => store.ingest(created.ingestToken, maliciousPayload),
    /credential_material_not_accepted/,
  );
  const maliciousConversationPayload = {
    resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: '1790064002000000000',
      attributes: [
        attr('conversation.id', hiddenTelemetryCredential),
        attr('model', 'gpt-5.6-terra'),
        attr('gen_ai.usage.input_tokens', 1),
        attr('gen_ai.usage.output_tokens', 1),
      ],
    }] }] }],
  };
  await assert.rejects(
    () => store.ingest(created.ingestToken, maliciousConversationPayload),
    /credential_material_not_accepted/,
  );
  const summary = await store.summary('7d');
  assert.equal(summary.totals.totalTokens, 12_900);
  assert.equal(summary.members[0]?.cachedInputTokens, 8_000);
  assert.equal(summary.recent[0]?.conversationHash?.length, 16);
  assert.notEqual(summary.recent[0]?.conversationHash, 'conversation-secret-id');

  const persisted = await fs.readFile(path.join(root, 'team-usage.json'), 'utf8');
  assert.doesNotMatch(persisted, new RegExp(created.ingestToken));
  assert.doesNotMatch(persisted, new RegExp(created.connectorToken));
  assert.doesNotMatch(persisted, /this must never be persisted|conversation-secret-id/);
  assert.doesNotMatch(persisted, new RegExp(hiddenTelemetryCredential));
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(hiddenTelemetryCredential));
  assert.match(persisted, /ingestTokenHash/);

  current = new Date('2026-09-22T08:03:01.000Z');
  assert.equal((await store.summary('1d')).members[0]?.online, false);

  const rotated = await store.rotateToken(created.member.id);
  await assert.rejects(() => store.authenticateIngestToken(created.ingestToken), /invalid_ingest_token/);
  await assert.rejects(() => store.authenticateConnectorToken(created.connectorToken), /invalid_ingest_token/);
  assert.equal((await store.authenticateIngestToken(rotated.ingestToken)).id, created.member.id);
  assert.equal((await store.authenticateConnectorToken(rotated.connectorToken)).id, created.member.id);
  await assert.rejects(() => store.ingest(created.ingestToken, payload), /invalid_ingest_token/);
  assert.equal((await store.ingest(rotated.ingestToken, payload)).accepted, 0);

  await store.setMemberEnabled(created.member.id, false);
  await assert.rejects(() => store.authenticateIngestToken(rotated.ingestToken), /invalid_ingest_token/);
  await assert.rejects(() => store.authenticateConnectorToken(rotated.connectorToken), /invalid_ingest_token/);
  await assert.rejects(() => store.ingest(rotated.ingestToken, payload), /invalid_ingest_token/);

  const firstProcess = new TeamUsageStore({ dataDir: root, now: () => current });
  const secondProcess = new TeamUsageStore({ dataDir: root, now: () => current });
  const concurrent = await firstProcess.createMember('并发成员');

  const disableBarrier = pauseNextRead(secondProcess);
  const concurrentIngest = secondProcess.ingest(concurrent.ingestToken, payload);
  await disableBarrier.reached;
  const concurrentDisable = firstProcess.setMemberEnabled(concurrent.member.id, false);
  await Promise.race([concurrentDisable.then(() => undefined), new Promise(resolve => setTimeout(resolve, 75))]);
  disableBarrier.release();
  const disableRace = await Promise.allSettled([concurrentDisable, concurrentIngest]);
  disableBarrier.restore();
  assert.equal(disableRace[0]?.status, 'fulfilled');
  assert.equal(
    (await secondProcess.listMembers()).find(member => member.id === concurrent.member.id)?.enabled,
    false,
    'a concurrent ingest must never overwrite a committed disable',
  );
  await assert.rejects(() => firstProcess.authenticateIngestToken(concurrent.ingestToken), /invalid_ingest_token/);
  await assert.rejects(() => firstProcess.authenticateConnectorToken(concurrent.connectorToken), /invalid_ingest_token/);

  await secondProcess.setMemberEnabled(concurrent.member.id, true);
  const rotationBarrier = pauseNextRead(secondProcess);
  const oldTokenIngest = secondProcess.ingest(concurrent.ingestToken, payload);
  await rotationBarrier.reached;
  const concurrentRotation = firstProcess.rotateToken(concurrent.member.id);
  await Promise.race([concurrentRotation.then(() => undefined), new Promise(resolve => setTimeout(resolve, 75))]);
  rotationBarrier.release();
  const rotationRace = await Promise.allSettled([concurrentRotation, oldTokenIngest]);
  rotationBarrier.restore();
  if (rotationRace[0].status !== 'fulfilled') throw rotationRace[0].reason;
  await assert.rejects(() => firstProcess.authenticateIngestToken(concurrent.ingestToken), /invalid_ingest_token/);
  await assert.rejects(() => firstProcess.authenticateConnectorToken(concurrent.connectorToken), /invalid_ingest_token/);
  await assert.rejects(() => secondProcess.ingest(concurrent.ingestToken, payload), /invalid_ingest_token/);
  assert.equal(
    (await secondProcess.authenticateIngestToken(rotationRace[0].value.ingestToken)).id,
    concurrent.member.id,
  );
  assert.equal(
    (await secondProcess.authenticateConnectorToken(rotationRace[0].value.connectorToken)).id,
    concurrent.member.id,
  );

  const lockFile = path.join(root, '.team-usage.lock');
  await fs.writeFile(lockFile, JSON.stringify({ owner: 'stale-test' }), { mode: 0o600 });
  const staleTime = new Date(Date.now() - 31_000);
  await fs.utimes(lockFile, staleTime, staleTime);
  await firstProcess.setMemberEnabled(concurrent.member.id, false);
  await assert.rejects(() => fs.stat(lockFile), (error: unknown) => (
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  ));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('team usage telemetry tests passed');
