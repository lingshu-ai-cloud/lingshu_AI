import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

export type ObjectStorageDriver = 'local' | 'cos';
export interface StoredObjectHead { size: number; contentType: string; etag?: string }
export interface ObjectStorageStream extends StoredObjectHead { body: AsyncIterable<Uint8Array>; contentLength?: number; contentRange?: string; acceptRanges?: string; lastModified?: Date }

const localRoot = () => path.resolve(process.env.LOCAL_OBJECT_STORAGE_ROOT || 'data/media/object-storage');
const driver = (): ObjectStorageDriver => {
  const configured = String(process.env.OBJECT_STORAGE_DRIVER || '').trim().toLowerCase();
  if (configured === 'local' || configured === 'cos') return configured;
  return process.env.NODE_ENV === 'production' ? 'cos' : 'local';
};
function safeLocalPath(key: string): string {
  const normalized = String(key || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('对象存储 key 无效');
  const root = localRoot(), resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('对象存储 key 越界');
  return resolved;
}
function cosConfig() {
  const region = String(process.env.COS_REGION || process.env.OBJECT_STORAGE_REGION || '').trim();
  const bucket = String(process.env.COS_BUCKET || process.env.OBJECT_STORAGE_BUCKET_NAME || '').trim();
  const accessKeyId = String(process.env.COS_SECRET_ID || process.env.OBJECT_STORAGE_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.COS_SECRET_KEY || process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim();
  const endpoint = String(process.env.COS_ENDPOINT || process.env.OBJECT_STORAGE_ENDPOINT || '').trim() || (region ? `https://cos.${region}.myqcloud.com` : '');
  return { region, bucket, accessKeyId, secretAccessKey, endpoint };
}
function cosClient() {
  const config = cosConfig();
  if (!config.region || !config.bucket || !config.accessKeyId || !config.secretAccessKey || !config.endpoint) throw new Error('腾讯 COS 未配置：需要 COS_REGION、COS_BUCKET、COS_SECRET_ID、COS_SECRET_KEY');
  return { bucket: config.bucket, client: new S3Client({ region: config.region, endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) };
}
export function objectStorageDriver(): ObjectStorageDriver { return driver(); }
export function objectStorageConfigurationIssues(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredDriver = String(env.OBJECT_STORAGE_DRIVER || '').trim().toLowerCase();
  const effectiveDriver = configuredDriver || (env.NODE_ENV === 'production' ? 'cos' : 'local');
  if (effectiveDriver !== 'local' && effectiveDriver !== 'cos') return ['OBJECT_STORAGE_DRIVER must be local or cos'];
  if (env.NODE_ENV === 'production' && effectiveDriver !== 'cos') return ['production requires OBJECT_STORAGE_DRIVER=cos'];
  if (effectiveDriver === 'local') return [];
  return [
    !String(env.COS_REGION || env.OBJECT_STORAGE_REGION || '').trim() && 'COS_REGION',
    !String(env.COS_BUCKET || env.OBJECT_STORAGE_BUCKET_NAME || '').trim() && 'COS_BUCKET',
    !String(env.COS_SECRET_ID || env.OBJECT_STORAGE_ACCESS_KEY_ID || '').trim() && 'COS_SECRET_ID',
    !String(env.COS_SECRET_KEY || env.OBJECT_STORAGE_SECRET_ACCESS_KEY || '').trim() && 'COS_SECRET_KEY',
  ].filter(Boolean) as string[];
}
export function objectStorageEnabled(): boolean {
  if (driver() === 'local') return true;
  const c = cosConfig(); return Boolean(c.region && c.bucket && c.accessKeyId && c.secretAccessKey && c.endpoint);
}
export function objectStorageSupplierDeliveryReady(): boolean {
  return driver() === 'cos' ? objectStorageEnabled() : /^https:\/\//i.test(String(process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL || '').trim());
}
export async function objectStorageUpload(input: { key: string; body: Buffer; contentType: string }): Promise<string> {
  if (driver() === 'local') {
    const file = safeLocalPath(input.key); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, input.body, { mode: 0o600 });
    await fs.writeFile(`${file}.meta.json`, JSON.stringify({ contentType: input.contentType }), { mode: 0o600 }); return objectStoragePublicUrl(input.key);
  }
  const { client, bucket } = cosClient(); await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: input.body, ContentType: input.contentType }));
  return objectStoragePublicUrl(input.key);
}
export async function objectStorageUploadFile(input: { key: string; filePath: string; contentType: string; contentLength: number }): Promise<void> {
  if (driver() === 'local') {
    const destination = safeLocalPath(input.key); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(input.filePath, destination); await fs.chmod(destination, 0o600);
    await fs.writeFile(`${destination}.meta.json`, JSON.stringify({ contentType: input.contentType }), { mode: 0o600 }); return;
  }
  const { client, bucket } = cosClient(); await client.send(new PutObjectCommand({ Bucket: bucket, Key: input.key, Body: createReadStream(input.filePath), ContentType: input.contentType, ContentLength: input.contentLength }));
}
async function localContentType(file: string): Promise<string> { try { return String(JSON.parse(await fs.readFile(`${file}.meta.json`, 'utf8')).contentType || 'application/octet-stream'); } catch { return 'application/octet-stream'; } }
export async function objectStorageHead(key: string): Promise<StoredObjectHead | null> {
  if (driver() === 'local') { try { const file = safeLocalPath(key), stat = await fs.stat(file); return { size: stat.size, contentType: await localContentType(file), etag: `local-${stat.size}-${Math.round(stat.mtimeMs)}` }; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }
  try { const { client, bucket } = cosClient(), r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return { size: r.ContentLength ?? 0, contentType: r.ContentType || 'application/octet-stream', etag: r.ETag }; }
  catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null; throw e; }
}
export async function objectStorageDownload(key: string): Promise<{ buf: Buffer; contentType: string } | null> {
  if (driver() === 'local') { try { const file = safeLocalPath(key); return { buf: await fs.readFile(file), contentType: await localContentType(file) }; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }
  const stream = await objectStorageGetObject(key); if (!stream) return null; const chunks: Uint8Array[] = []; for await (const chunk of stream.body) chunks.push(chunk); return { buf: Buffer.concat(chunks), contentType: stream.contentType };
}
export async function objectStorageGetObject(key: string, range?: string): Promise<ObjectStorageStream | null> {
  if (driver() === 'local') {
    try { const file = safeLocalPath(key), stat = await fs.stat(file), match = /^bytes=(\d+)-(\d*)$/.exec(range || ''); const start = match ? Number(match[1]) : 0, end = match?.[2] ? Number(match[2]) : stat.size - 1;
      return { body: createReadStream(file, { start, end }), size: end - start + 1, contentLength: end - start + 1, contentType: await localContentType(file), contentRange: range ? `bytes ${start}-${end}/${stat.size}` : undefined, acceptRanges: 'bytes', etag: `local-${stat.size}-${Math.round(stat.mtimeMs)}`, lastModified: stat.mtime }; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  try { const { client, bucket } = cosClient(), r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) })); if (!r.Body) return null;
    return { body: r.Body as AsyncIterable<Uint8Array>, size: r.ContentLength ?? 0, contentLength: r.ContentLength, contentType: r.ContentType || 'application/octet-stream', contentRange: r.ContentRange, acceptRanges: r.AcceptRanges, etag: r.ETag, lastModified: r.LastModified }; }
  catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null; throw e; }
}
export async function objectStorageDelete(key: string): Promise<void> {
  if (driver() === 'local') { const file = safeLocalPath(key); await fs.rm(file, { force: true }); await fs.rm(`${file}.meta.json`, { force: true }); return; }
  const { client, bucket } = cosClient(); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
export async function objectStorageSignedGetUrl(key: string, expiresIn = 900): Promise<string> {
  if (driver() === 'local') { const base = String(process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, ''); const relative = `/media/object-storage/${key.split('/').map(encodeURIComponent).join('/')}`; return base ? `${base}${relative}` : relative; }
  const { client, bucket } = cosClient(); return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: Math.max(60, Math.min(3600, Math.round(expiresIn))) });
}
export function objectStoragePublicUrl(key: string): string {
  if (driver() === 'local') { const base = String(process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, ''); return `${base}/media/object-storage/${key.split('/').map(encodeURIComponent).join('/')}`; }
  const configured = String(process.env.COS_PUBLIC_URL || process.env.OBJECT_STORAGE_PUBLIC_URL || '').replace(/\/$/, ''); if (configured) return `${configured}/${key}`;
  const c = cosConfig(); return `https://${c.bucket}.cos.${c.region}.myqcloud.com/${key}`;
}
