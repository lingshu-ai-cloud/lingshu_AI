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
  const summary = await store.summary('7d');
  assert.equal(summary.totals.totalTokens, 12_900);
  assert.equal(summary.members[0]?.cachedInputTokens, 8_000);
  assert.equal(summary.recent[0]?.conversationHash?.length, 16);
  assert.notEqual(summary.recent[0]?.conversationHash, 'conversation-secret-id');

  const persisted = await fs.readFile(path.join(root, 'team-usage.json'), 'utf8');
  assert.doesNotMatch(persisted, new RegExp(created.ingestToken));
  assert.doesNotMatch(persisted, new RegExp(created.connectorToken));
  assert.doesNotMatch(persisted, /this must never be persisted|conversation-secret-id/);
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
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('team usage telemetry tests passed');
