import '../server/loadEnvironment.js';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { getPbAdminToken, getPbUrl } from '../server/storage/pb.js';
import { objectStorageDriver, objectStorageEnabled, objectStorageEnsureFile, objectStorageHead } from '../server/storage/objectStorage.js';
import {
  closePostgresPool,
  ensurePostgresSchema,
  postgresPool,
  type SqlExecutor,
} from '../server/storage/postgres.js';

type JsonRecord = Record<string, unknown> & { id: string };
type PocketBaseField = { name?: string; type?: string; maxSelect?: number };
export type PocketBaseCollection = { id: string; name: string; type?: string; fields?: PocketBaseField[]; indexes?: string[] };

export interface MigrationOptions {
  mode: 'plan' | 'apply' | 'verify';
  copyFiles: boolean;
  runId: string;
  collections?: Set<string>;
}

export interface CollectionMigrationReport {
  collection: string;
  sourceCount: number;
  targetCount: number;
  sourceDigest: string;
  targetDigest: string;
  fileReferences: number;
  copiedFiles: number;
  copiedBytes: number;
  verifiedFiles: number;
  appliedIndexes: number;
  verified: boolean;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sourceRecordHash(record: JsonRecord): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex');
}

export function collectionDigest(records: Array<{ id: string; sourceHash: string }>): string {
  const hash = createHash('sha256');
  for (const record of [...records].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(record.id).update('\0').update(record.sourceHash).update('\n');
  }
  return hash.digest('hex');
}

function postgresPartialIndexPredicate(value: string): string {
  let output = '';
  for (let cursor = 0; cursor < value.length;) {
    const rest = value.slice(cursor);
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) { output += whitespace; cursor += whitespace.length; continue; }
    const stringLiteral = rest.match(/^'(?:''|[^'])*'/)?.[0];
    if (stringLiteral) { output += stringLiteral; cursor += stringLiteral.length; continue; }
    const operator = rest.match(/^(?:!=|<>|>=|<=|=|>|<|\(|\))/)?.[0];
    if (operator) { output += operator; cursor += operator.length; continue; }
    const number = rest.match(/^-?\d+(?:\.\d+)?/)?.[0];
    if (number) { output += number; cursor += number.length; continue; }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (identifier) {
      const keyword = identifier.toUpperCase();
      if (['AND', 'OR', 'NOT', 'IS', 'NULL'].includes(keyword)) output += keyword;
      else if (keyword === 'TRUE' || keyword === 'FALSE') output += `'${keyword.toLowerCase()}'`;
      else output += `(data ->> '${identifier}')`;
      cursor += identifier.length;
      continue;
    }
    throw new Error(`Unsupported PocketBase partial index predicate near: ${rest.slice(0, 40)}`);
  }
  return output;
}

export function postgresUniqueIndexStatement(collection: string, sourceSql: string): string | null {
  const match = sourceSql.trim().match(/^CREATE\s+UNIQUE\s+INDEX\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s+ON\s+[`"]?([A-Za-z_][A-Za-z0-9_]*)[`"]?\s*\(([^)]+)\)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;
  const [, sourceName, sourceCollection, rawColumns, rawWhere] = match;
  if (sourceCollection !== collection || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(collection)) {
    throw new Error(`PocketBase index collection mismatch: ${sourceSql}`);
  }
  const columns = rawColumns.split(',').map(raw => raw.trim().replace(/^[`"]|[`"]$/g, ''));
  if (!columns.length || columns.some(column => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    throw new Error(`Unsupported PocketBase index columns: ${sourceSql}`);
  }
  const fingerprint = createHash('sha256').update(sourceSql).digest('hex').slice(0, 10);
  const name = `pb_${sourceName.slice(0, 49)}_${fingerprint}`;
  const expressions = columns.map(column => `(data ->> '${column}')`).join(', ');
  const predicate = rawWhere ? ` AND (${postgresPartialIndexPredicate(rawWhere)})` : '';
  return `CREATE UNIQUE INDEX IF NOT EXISTS "${name}" ON lingshu_records (${expressions}) WHERE collection = '${collection}'${predicate}`;
}

export function parseMigrationOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): MigrationOptions {
  const requestedMode = argv.includes('--apply') ? 'apply' : argv.includes('--verify') ? 'verify' : 'plan';
  if (requestedMode === 'apply' && String(env.MIGRATION_APPLY || '').trim().toLowerCase() !== 'true') {
    throw new Error('Apply requires both --apply and MIGRATION_APPLY=true');
  }
  const copyFiles = argv.includes('--copy-files') || String(env.MIGRATION_COPY_FILES || '').trim().toLowerCase() === 'true';
  if (copyFiles && requestedMode !== 'apply') throw new Error('File copying is only available in apply mode');
  const only = argv.find(argument => argument.startsWith('--collections='))?.slice('--collections='.length);
  const collections = only ? new Set(only.split(',').map(value => value.trim()).filter(Boolean)) : undefined;
  const runId = String(env.MIGRATION_RUN_ID || `pb-pg-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`);
  return { mode: requestedMode, copyFiles, runId, collections };
}

async function pbRequest<T>(endpoint: string): Promise<T> {
  const token = await getPbAdminToken();
  if (!token) throw new Error('PocketBase admin authentication failed');
  const response = await fetch(`${getPbUrl()}${endpoint}`, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`PocketBase GET ${endpoint} failed (${response.status}): ${await response.text().catch(() => '')}`);
  return response.json() as Promise<T>;
}

async function listCollections(): Promise<PocketBaseCollection[]> {
  const result = await pbRequest<{ items?: PocketBaseCollection[] }>('/api/collections?perPage=500&page=1');
  return (result.items || [])
    // PocketBase internal auth/session collections and computed views are not
    // business source data. Users remain included for audit/reference, while
    // password verification stays on PocketBase during token exchange.
    .filter(collection => collection.name && !collection.name.startsWith('_') && collection.type !== 'view')
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listRecords(collection: PocketBaseCollection): Promise<JsonRecord[]> {
  const records: JsonRecord[] = [];
  for (let page = 1; ; page += 1) {
    const result = await pbRequest<{ items?: JsonRecord[]; totalPages?: number }>(
      `/api/collections/${encodeURIComponent(collection.name)}/records?page=${page}&perPage=500&skipTotal=0`,
    );
    records.push(...(result.items || []));
    if (page >= Number(result.totalPages || 1)) break;
  }
  return records;
}

function fileNames(record: JsonRecord, field: PocketBaseField): string[] {
  const value = field.name ? record[field.name] : undefined;
  if (typeof value === 'string' && value) return [value];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [];
}

function safeKeySegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'file';
}

async function downloadPocketBaseFile(input: {
  collection: PocketBaseCollection;
  record: JsonRecord;
  field: PocketBaseField;
  filename: string;
  directory: string;
}): Promise<{ path: string; size: number; sha256: string; contentType: string }> {
  // Always read from the source PocketBase, even when DATA_BACKEND=postgres is
  // already enabled for a canary process.
  const adminToken = await getPbAdminToken();
  if (!adminToken) throw new Error('PocketBase admin authentication failed while creating a file token');
  const tokenResponse = await fetch(`${getPbUrl()}/api/files/token`, {
    method: 'POST',
    headers: { Authorization: adminToken },
    signal: AbortSignal.timeout(30_000),
  });
  if (!tokenResponse.ok) throw new Error(`PocketBase file token request failed (${tokenResponse.status})`);
  const fileToken = ((await tokenResponse.json()) as { token?: string }).token || '';
  if (!fileToken) throw new Error(`Cannot create PocketBase file token for ${input.collection.name}/${input.record.id}/${input.filename}`);
  const url = `${getPbUrl()}/api/files/${encodeURIComponent(input.collection.name)}/${encodeURIComponent(input.record.id)}/${encodeURIComponent(input.filename)}?token=${encodeURIComponent(fileToken)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`PocketBase file download failed (${response.status})`);
  const destination = path.join(input.directory, `${safeKeySegment(input.field.name || 'file')}-${safeKeySegment(input.filename)}`);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(destination, { mode: 0o600 }));
  return {
    path: destination,
    size,
    sha256: hash.digest('hex'),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
}

async function migrateRecordFiles(
  collection: PocketBaseCollection,
  record: JsonRecord,
  directory: string,
): Promise<{ record: JsonRecord; copiedFiles: number; copiedBytes: number }> {
  const objectFiles: Record<string, Array<Record<string, unknown>>> = {};
  const canonicalMaterialKeys: Record<string, unknown> = {};
  let copiedFiles = 0;
  let copiedBytes = 0;
  for (const field of collection.fields || []) {
    if (field.type !== 'file' || !field.name) continue;
    for (const filename of fileNames(record, field)) {
      const downloaded = await downloadPocketBaseFile({ collection, record, field, filename, directory });
      const key = [
        'pocketbase-migration',
        safeKeySegment(collection.name),
        safeKeySegment(record.id),
        safeKeySegment(field.name),
        `${downloaded.sha256.slice(0, 16)}-${safeKeySegment(filename)}`,
      ].join('/');
      const stored = await objectStorageEnsureFile({
        key,
        filePath: downloaded.path,
        contentType: downloaded.contentType,
        contentLength: downloaded.size,
      });
      (objectFiles[field.name] ||= []).push({
        key,
        etag: stored.head.etag,
        size: downloaded.size,
        sha256: downloaded.sha256,
        contentType: downloaded.contentType,
        originalName: filename,
      });
      if (collection.name === 'materials' && field.name === 'videoFile' && !canonicalMaterialKeys.objectKey) {
        canonicalMaterialKeys.objectKey = key;
        canonicalMaterialKeys.objectEtag = stored.head.etag;
        canonicalMaterialKeys.storageBackend = 'object_storage';
      }
      if (collection.name === 'materials' && field.name === 'posterFile' && !canonicalMaterialKeys.posterObjectKey) {
        canonicalMaterialKeys.posterObjectKey = key;
        canonicalMaterialKeys.posterObjectEtag = stored.head.etag;
      }
      copiedFiles += stored.reused ? 0 : 1;
      copiedBytes += stored.reused ? 0 : downloaded.size;
      await fs.unlink(downloaded.path).catch(() => undefined);
    }
  }
  return {
    record: Object.keys(objectFiles).length ? { ...record, ...canonicalMaterialKeys, _objectFiles: objectFiles } : record,
    copiedFiles,
    copiedBytes,
  };
}

async function upsertTargetRecord(
  db: SqlExecutor,
  collection: PocketBaseCollection,
  record: JsonRecord,
  sourceHash: string,
): Promise<void> {
  const now = new Date().toISOString();
  const created = typeof record.created === 'string' && record.created ? record.created : now;
  const updated = typeof record.updated === 'string' && record.updated ? record.updated : created;
  const tenant = record.tenantId ?? record.tenant_id;
  await db.query(`
    INSERT INTO lingshu_records (collection, id, tenant_id, data, source_hash, created_at, updated_at, migrated_at)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, now())
    ON CONFLICT (collection, id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      data = CASE
        WHEN EXCLUDED.data ? '_objectFiles' THEN EXCLUDED.data
        ELSE EXCLUDED.data || jsonb_strip_nulls(jsonb_build_object(
          '_objectFiles', lingshu_records.data -> '_objectFiles',
          'objectKey', lingshu_records.data -> 'objectKey',
          'objectEtag', lingshu_records.data -> 'objectEtag',
          'posterObjectKey', lingshu_records.data -> 'posterObjectKey',
          'posterObjectEtag', lingshu_records.data -> 'posterObjectEtag',
          'storageBackend', lingshu_records.data -> 'storageBackend'
        ))
      END,
      source_hash = EXCLUDED.source_hash,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at,
      migrated_at = now()
  `, [collection.name, record.id, typeof tenant === 'string' && tenant ? tenant : null, JSON.stringify(record), sourceHash, created, updated]);
}

async function targetVerification(db: SqlExecutor, collection: string): Promise<{
  count: number;
  digest: string;
  records: Map<string, Record<string, unknown>>;
}> {
  const result = await db.query<{ id: string; source_hash: string; data: Record<string, unknown> }>(`
    SELECT id, source_hash, data FROM lingshu_records
    WHERE collection = $1 AND source_hash IS NOT NULL
    ORDER BY id
  `, [collection]);
  return {
    count: result.rows.length,
    digest: collectionDigest(result.rows.map(row => ({ id: row.id, sourceHash: row.source_hash }))),
    records: new Map(result.rows.map(row => [row.id, row.data])),
  };
}

type ExpectedFileReference = { recordId: string; field: string; originalName: string };

function expectedFileReferences(collection: PocketBaseCollection, records: JsonRecord[]): ExpectedFileReference[] {
  return records.flatMap(record => (collection.fields || []).flatMap(field => (
    field.type === 'file' && field.name
      ? fileNames(record, field).map(originalName => ({ recordId: record.id, field: field.name!, originalName }))
      : []
  )));
}

async function verifyTargetFiles(
  records: Map<string, Record<string, unknown>>,
  expected: ExpectedFileReference[],
): Promise<number> {
  let verified = 0;
  for (const item of expected) {
    const record = records.get(item.recordId);
    const rawFiles = record?._objectFiles;
    const files = rawFiles && typeof rawFiles === 'object' && !Array.isArray(rawFiles)
      ? rawFiles as Record<string, unknown>
      : {};
    const fieldReferences = Array.isArray(files[item.field]) ? files[item.field] as Array<Record<string, unknown>> : [];
    const reference = fieldReferences.find(candidate => candidate?.originalName === item.originalName);
    const key = String(reference?.key || '');
    if (!key) continue;
    const head = await objectStorageHead(key);
    if (!head) continue;
    const expectedSize = Number(reference?.size || 0);
    if (expectedSize > 0 && head.size !== expectedSize) continue;
    verified += 1;
  }
  return verified;
}

async function saveCollectionReport(db: SqlExecutor, runId: string, report: CollectionMigrationReport): Promise<void> {
  await db.query(`
    INSERT INTO lingshu_migration_collections
      (run_id, collection, source_count, target_count, source_digest, target_digest, copied_files, copied_bytes, verified_files, applied_indexes, error)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (run_id, collection) DO UPDATE SET
      source_count=EXCLUDED.source_count,
      target_count=EXCLUDED.target_count,
      source_digest=EXCLUDED.source_digest,
      target_digest=EXCLUDED.target_digest,
      copied_files=EXCLUDED.copied_files,
      copied_bytes=EXCLUDED.copied_bytes,
      verified_files=EXCLUDED.verified_files,
      applied_indexes=EXCLUDED.applied_indexes,
      error=EXCLUDED.error
  `, [
    runId, report.collection, report.sourceCount, report.targetCount,
    report.sourceDigest, report.targetDigest, report.copiedFiles, report.copiedBytes, report.verifiedFiles, report.appliedIndexes,
    report.verified ? null : 'count_or_digest_mismatch',
  ]);
}

async function applyCollectionUniqueIndexes(db: SqlExecutor, collection: PocketBaseCollection): Promise<number> {
  let applied = 0;
  for (const sourceSql of collection.indexes || []) {
    if (!/^CREATE\s+UNIQUE\s+INDEX/i.test(sourceSql.trim())) continue;
    const statement = postgresUniqueIndexStatement(collection.name, sourceSql);
    if (!statement) throw new Error(`Unsupported PocketBase unique index: ${sourceSql}`);
    await db.query(statement);
    applied += 1;
  }
  return applied;
}

export async function runMigration(options: MigrationOptions): Promise<CollectionMigrationReport[]> {
  if (options.copyFiles && (objectStorageDriver() !== 'cos' || !objectStorageEnabled())) {
    throw new Error('Tencent COS must be explicitly configured before --copy-files');
  }
  if (options.mode === 'verify' && (objectStorageDriver() !== 'cos' || !objectStorageEnabled())) {
    throw new Error('Tencent COS must be explicitly configured before independent verification');
  }
  const collections = (await listCollections()).filter(collection => !options.collections || options.collections.has(collection.name));
  if (!collections.length) throw new Error('No PocketBase collections selected');
  const db = options.mode === 'plan' ? null : postgresPool();
  if (options.mode !== 'plan') {
    await ensurePostgresSchema(db!);
    await db!.query(`
      INSERT INTO lingshu_migration_runs (id, source, status, report)
      VALUES ($1, $2, $3, '{}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, finished_at=NULL
    `, [options.runId, getPbUrl(), options.mode === 'verify' ? 'verifying' : 'running']);
  }
  const reports: CollectionMigrationReport[] = [];
  const directory = options.copyFiles ? await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-pb-pg-migration-')) : '';
  try {
    for (const collection of collections) {
      const records = await listRecords(collection);
      const sourceRows = records.map(record => ({ id: record.id, sourceHash: sourceRecordHash(record) }));
      const sourceDigest = collectionDigest(sourceRows);
      const expectedFiles = expectedFileReferences(collection, records);
      const fileReferences = expectedFiles.length;
      let copiedFiles = 0;
      let copiedBytes = 0;
      let appliedIndexes = 0;
      if (options.mode === 'apply') {
        for (const [index, sourceRecord] of records.entries()) {
          const migrated = options.copyFiles
            ? await migrateRecordFiles(collection, sourceRecord, directory)
            : { record: sourceRecord, copiedFiles: 0, copiedBytes: 0 };
          await upsertTargetRecord(db!, collection, migrated.record, sourceRows[index].sourceHash);
          copiedFiles += migrated.copiedFiles;
          copiedBytes += migrated.copiedBytes;
        }
        appliedIndexes = await applyCollectionUniqueIndexes(db!, collection);
      }
      const target = options.mode === 'plan'
        ? { count: 0, digest: '', records: new Map<string, Record<string, unknown>>() }
        : await targetVerification(db!, collection.name);
      const verifiedFiles = options.mode === 'plan' || !expectedFiles.length
        ? 0
        : await verifyTargetFiles(target.records, expectedFiles);
      const report: CollectionMigrationReport = {
        collection: collection.name,
        sourceCount: records.length,
        targetCount: target.count,
        sourceDigest,
        targetDigest: target.digest,
        fileReferences,
        copiedFiles,
        copiedBytes,
        verifiedFiles,
        appliedIndexes,
        verified: options.mode === 'plan'
          ? false
          : records.length === target.count
            && sourceDigest === target.digest
            && fileReferences === verifiedFiles,
      };
      reports.push(report);
      if (options.mode !== 'plan') await saveCollectionReport(db!, options.runId, report);
      console.log(JSON.stringify(report));
    }
    if (options.mode !== 'plan') {
      const failed = reports.filter(report => !report.verified);
      await db!.query(`
        UPDATE lingshu_migration_runs
        SET status=$2, finished_at=now(), report=$3::jsonb
        WHERE id=$1
      `, [options.runId, failed.length ? 'failed' : 'completed', JSON.stringify({ collections: reports.length, failed: failed.map(item => item.collection) })]);
      if (failed.length) throw new Error(`Migration verification failed for: ${failed.map(item => item.collection).join(', ')}`);
    }
    return reports;
  } catch (error) {
    if (db) {
      await db.query(`
        UPDATE lingshu_migration_runs
        SET status='failed', finished_at=now(), report=$2::jsonb
        WHERE id=$1
      `, [options.runId, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })]).catch(() => undefined);
    }
    throw error;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2));
  console.log(JSON.stringify({ mode: options.mode, runId: options.runId, copyFiles: options.copyFiles, destructive: false }));
  await runMigration(options);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main()
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closePostgresPool().catch(() => undefined));
}
