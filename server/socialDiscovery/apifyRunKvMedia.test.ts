import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ffmpegStatic from 'ffmpeg-static';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { readSameRunApifyKvVideo, type VerifiedRunKvMediaBinding } from './apifyRunKvMedia.js';
import { mappingReceiptId, recordRunKvMapping, type RunKvMappingStatement,
  type SignedRunKvMapping } from './apifyRunKvMappingReceipt.js';

const h = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const scope = { tenantId: 'tenant123', packageId: 'package123', packageVersion: 7, jobId: 'job12345',
  runId: 'RUNabc123', datasetId: 'DATAabc123', defaultKeyValueStoreId: 'KVabc123',
  datasetVideoId: '7533731959172861206', recordKey: 'video-7533731959172861206.mp4' };
const runBytes = Buffer.from(JSON.stringify({ data: { id: scope.runId, defaultDatasetId: scope.datasetId,
  defaultKeyValueStoreId: scope.defaultKeyValueStoreId, status: 'SUCCEEDED' } }));
const itemBytes = Buffer.from(JSON.stringify([{ id: scope.datasetVideoId }]));
const keysBytes = Buffer.from(JSON.stringify({ data: { items: [{ key: scope.recordKey }] } }));
const runUrl = `https://api.apify.com/v2/actor-runs/${scope.runId}`;
const itemUrl = `https://api.apify.com/v2/datasets/${scope.datasetId}/items?format=json&clean=false&offset=0&limit=1`;
const keysUrl = `https://api.apify.com/v2/key-value-stores/${scope.defaultKeyValueStoreId}/keys?limit=1000`;
const videoUrl = `https://api.apify.com/v2/key-value-stores/${scope.defaultKeyValueStoreId}/records/${scope.recordKey}`;

function store(): DataStore {
  const rows = new Map<string, Record_>();
  return { getById: async (_c, id) => structuredClone(rows.get(id) ?? null),
    create: async (_c, row) => { if (rows.has(String(row.id))) return null; rows.set(String(row.id), structuredClone(row as Record_)); return structuredClone(row as Record_); },
    update: async () => false, delete: async () => false,
    list: async () => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 100 }) } as DataStore;
}
async function fixture(t: test.TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apify-kv-media-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.mp4');
  execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=blue:s=160x288:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
  const bytes = await fs.readFile(source), calls: string[] = [], permitted: string[] = [];
  const responseBytes = new Map([[runUrl, runBytes], [itemUrl, itemBytes], [keysUrl, keysBytes], [videoUrl, bytes]]);
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-private-token');
    const body = responseBytes.get(String(url));
    if (!body) throw Error(`unexpected URL ${String(url)}`);
    return new Response(body, { headers: { 'Content-Type': String(url) === videoUrl ? 'video/mp4' : 'application/json' } });
  };
  const keys = generateKeyPairSync('ed25519');
  const statement: RunKvMappingStatement = { kind: 'apify-run-kv-mapping-human-review.v1',
    issuerId: 'independent-reviewer', keyId: 'key-1', reviewerId: 'auditor', submittedBy: 'uploader',
    ...scope, datasetOffset: 0, runGetSha256: h(runBytes), datasetItemGetSha256: h(itemBytes),
    runKvKeysGetSha256: h(keysBytes), mediaSha256: h(bytes), mediaByteLength: bytes.length,
    reviewedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
  const signed: SignedRunKvMapping = { statement,
    signatureBase64url: sign(null, Buffer.from(JSON.stringify(statement)), keys.privateKey).toString('base64url') };
  const s = store(), authorities = [{ issuerId: statement.issuerId, keyId: statement.keyId,
    reviewerId: statement.reviewerId,
    tenantId: scope.tenantId, publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
  const isRevoked = async () => false;
  const paidRead = {permitsPaidCollection:true as const,tokenFingerprint:h('fixture-private-token'),runId:scope.runId,datasetId:scope.datasetId,
    assertCurrent:async({url}:{url:string})=>{permitted.push(url);}};
  const base = { store: s, scope, token: 'fixture-private-token', authorities, isRevoked, fetcher,paidRead,
    now: new Date('2026-10-20T00:00:00.000Z') };
  return { directory, bytes, calls, permitted, responseBytes, fetcher, signed, base,
    binding: { ...scope, mappingReceiptId: mappingReceiptId(signed) } as VerifiedRunKvMediaBinding };
}

test('unrecorded mapping cannot fetch media; signed human review and three live snapshots can', async t => {
  const f = await fixture(t);
  const input = { binding: f.binding, store: f.base.store, mappingAuthorities: f.base.authorities,
    isMappingRevoked: f.base.isRevoked, token: f.base.token, outputDirectory: path.join(f.directory, 'canonical'), fetcher: f.fetcher,paidRead:f.base.paidRead };
  await assert.rejects(readSameRunApifyKvVideo(input), /mapping_receipt_invalid/);
  assert.equal(f.calls.length, 0);
  assert.equal(await recordRunKvMapping({ ...f.base, signed: f.signed }), f.binding.mappingReceiptId);
  const one = await readSameRunApifyKvVideo(input), two = await readSameRunApifyKvVideo(input);
  assert.deepEqual(one, two);
  assert.equal(one.contentSha256, h(f.bytes));
  assert.deepEqual(await fs.readFile(one.filePath), f.bytes);
  assert.ok(one.durationSeconds > 0);
  assert.equal(f.calls.filter(url => url === videoUrl).length, 2);
  assert.ok(f.calls.includes(runUrl) && f.calls.includes(itemUrl) && f.calls.includes(keysUrl));
  assert.deepEqual(f.permitted,f.calls);
});

test('wrong reviewer, scope, revocation and provider drift fail before MP4 GET', async t => {
  const f = await fixture(t);
  const wrongReviewer: SignedRunKvMapping = { ...f.signed,
    statement: { ...f.signed.statement, reviewerId: f.signed.statement.submittedBy } };
  await assert.rejects(recordRunKvMapping({ ...f.base, signed: wrongReviewer }), /mapping_review_invalid/);
  await recordRunKvMapping({ ...f.base, signed: f.signed });
  const input = { binding: f.binding, store: f.base.store, mappingAuthorities: f.base.authorities,
    isMappingRevoked: f.base.isRevoked, token: f.base.token, outputDirectory: path.join(f.directory, 'canonical'), fetcher: f.fetcher,paidRead:f.base.paidRead };
  await assert.rejects(readSameRunApifyKvVideo({ ...input, binding: { ...f.binding, jobId: 'wrongJob' } }), /mapping_receipt_invalid/);
  await assert.rejects(readSameRunApifyKvVideo({ ...input, isMappingRevoked: async () => true }), /mapping_revoked_or_unknown/);
  await assert.rejects(readSameRunApifyKvVideo({ ...input, isMappingRevoked: async () => null }), /mapping_revoked_or_unknown/);
  f.responseBytes.set(itemUrl, Buffer.from(JSON.stringify([{ id: '9999999999999999999' }])));
  await assert.rejects(readSameRunApifyKvVideo(input), /mapping_provider_evidence_changed/);
  assert.equal(f.calls.filter(url => url === videoUrl).length, 0);
  f.responseBytes.set(itemUrl, itemBytes);
  const alternate = path.join(f.directory, 'alternate.mp4');
  execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=red:s=160x288:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', alternate]);
  const swapped = await fs.readFile(alternate);
  assert.notEqual(h(swapped), h(f.bytes));
  f.responseBytes.set(videoUrl, swapped);
  await assert.rejects(readSameRunApifyKvVideo(input), /mapping_media_changed/);
  await assert.rejects(fs.access(input.outputDirectory));
});

test('every mapping and media GET requires same-token same-run paid authority',async t=>{
 const f=await fixture(t);
 await recordRunKvMapping({...f.base,signed:f.signed});
 const input={binding:f.binding,store:f.base.store,mappingAuthorities:f.base.authorities,isMappingRevoked:f.base.isRevoked,token:f.base.token,outputDirectory:path.join(f.directory,'canonical'),fetcher:f.fetcher,paidRead:f.base.paidRead};
 const before=f.calls.length;
 await assert.rejects(readSameRunApifyKvVideo({...input,paidRead:undefined as never}),/paid_read_permit_required/);
 await assert.rejects(readSameRunApifyKvVideo({...input,paidRead:{...f.base.paidRead,runId:'other'}}),/paid_read_permit_required/);
 await assert.rejects(readSameRunApifyKvVideo({...input,paidRead:{...f.base.paidRead,tokenFingerprint:h('other-token')}}),/paid_read_permit_required/);
 assert.equal(f.calls.length,before);
 await assert.rejects(readSameRunApifyKvVideo({...input,paidRead:{...f.base.paidRead,assertCurrent:async({kind})=>{if(kind==='kv_media_get')throw Error('paid-read-revoked');}}}),/paid-read-revoked/);
 assert.equal(f.calls.filter(url=>url===videoUrl).length,0);
});
