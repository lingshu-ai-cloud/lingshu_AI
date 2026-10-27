/** One-time recovery of committed assistant writes misclassified by the old
 * null/text adapter. Dry run by default; never steals an uncertain claim. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pbGetStrict, pbListStrict, pbDeleteStrict } from '../server/storage/pb.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const keys = ['conversationResetVersion', 'deletedAt', 'title', 'creationDraft', 'tenantId', 'userId', 'source', 'agentId',
  'version', 'messages', 'draftInput', 'scrollPosition', 'unreadCount', 'isFollowingLatest', 'paused', 'taskCards',
  'focusedTaskId', 'pendingContentTaskBinding', 'updatedAt'];
const optional = ['conversationResetVersion', 'deletedAt', 'title', 'creationDraft', 'pendingContentTaskBinding'];
const apply = process.argv.includes('--apply');
const backupDir = process.env.RECOVERY_BACKUP_DIR;
if (apply && !backupDir) throw new Error('RECOVERY_BACKUP_DIR is required for apply');
const claims = await pbListStrict<Record<string, unknown>>('datastore_cas_claims', { perPage: 200 });
if (claims.totalItems > claims.items.length) throw new Error('Refusing incomplete claim inventory');
for (const claim of claims.items) {
  const target = String(claim.target_key || '');
  if (!/^assistant_threads:[a-z0-9]{15}$/.test(target)) continue;
  const id = target.split(':')[1];
  const row = await pbGetStrict('assistant_threads', id) as Record<string, unknown> | null;
  const expired = Date.parse(String(claim.lease_expires_at)) + 120_000 < Date.now();
  if (!row || row.source !== 'desktop' || row.focusedTaskId !== '' || !expired) continue;
  const expected = { tenantId: row.tenantId, userId: row.userId, agentId: row.agentId, version: Number(row.version) - 1 };
  const data = Object.fromEntries(keys.map(key => [key, row[key]]));
  data.focusedTaskId = null; data.pendingContentTaskBinding = row.pendingContentTaskBinding ?? null;
  let proven = false;
  // Historical save payloads gained these fields over time. A cryptographic
  // match proves the entire submitted snapshot, including every message.
  for (let mask = 0; mask < 32; mask++) {
    const candidate = { ...data };
    optional.forEach((key, index) => { if (mask & (1 << index)) delete candidate[key]; });
    if (hash(expected) === claim.expected_fingerprint
      && hash({ kind: 'compare_and_swap', expected, data: candidate }) === claim.operation_fingerprint) proven = true;
  }
  if (!proven) { console.log(JSON.stringify({ target, status: 'unproven_preserved' })); continue; }
  if (apply) {
    const freshClaim = await pbGetStrict('datastore_cas_claims', String(claim.id));
    const freshRow = await pbGetStrict('assistant_threads', id);
    if (canonical(freshClaim) !== canonical(claim) || canonical(freshRow) !== canonical(row)) {
      throw new Error(`Concurrent change; preserved ${target}`);
    }
    await mkdir(backupDir!, { recursive: true, mode: 0o700 });
    await writeFile(path.join(backupDir!, `${claim.id}.json`), JSON.stringify({ claim, row }), { flag: 'wx', mode: 0o600 });
    if (!await pbDeleteStrict('datastore_cas_claims', String(claim.id))) throw new Error(`Claim release failed: ${target}`);
  }
  console.log(JSON.stringify({ target, status: apply ? 'committed_claim_released' : 'committed_claim_proven' }));
}
