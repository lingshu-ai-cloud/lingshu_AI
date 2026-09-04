import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Server-only adapter for files already authorized by the tenant asset loader.
 * Never expose this function as a client-manifest endpoint. The desktop renderer
 * still accepts only authorized HTTP origins: no file://, arbitrary disk paths,
 * credential forwarding or redirect-policy exceptions are added there.
 */
export async function withLocalRenderAssets<T>(
  manifest: any,
  operation: (manifest: any) => Promise<T>,
): Promise<T> {
  const assets = new Map<string, { file?: string; bytes?: Buffer; size: number }>();
  const registered = new Map<string, string>();
  const register = (value: unknown, maxBytes: number): unknown => {
    if (typeof value !== 'string' || !value) return value;
    if (!path.isAbsolute(value) && !value.startsWith('data:')) return value;
    if (registered.has(value)) return registered.get(value);
    let asset: { file?: string; bytes?: Buffer; size: number };
    let extension = '';
    if (value.startsWith('data:')) {
      const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
      if (!match || match[2].length > Math.ceil(maxBytes * 4 / 3) + 8) throw new Error('invalid_or_oversized_render_data');
      const bytes = Buffer.from(match[2], 'base64');
      asset = { bytes, size: bytes.length };
    } else {
      const stat = fs.statSync(value);
      if (!stat.isFile()) throw new Error('render_asset_not_file');
      asset = { file: value, size: stat.size };
      extension = path.extname(value).replace(/[^a-z0-9.]/gi, '').slice(0, 12);
    }
    if (!asset.size || asset.size > maxBytes) throw new Error('render_asset_size_limit');
    const key = `/${randomUUID()}${extension}`;
    assets.set(key, asset);
    registered.set(value, key);
    return key;
  };
  const timeline = (manifest.timeline || []).map((item: any) => ({
    ...item, url: register(item.url, (item.type === 'image' ? 32 : 512) * 1024 * 1024),
  }));
  const voiceover = { ...manifest.voiceover, url: register(manifest.voiceover?.url, 128 * 1024 * 1024) };
  const bgm = { ...manifest.bgm, url: register(manifest.bgm?.url, 128 * 1024 * 1024) };
  const server = http.createServer((req, res) => {
    const asset = assets.get(req.url || '');
    if (!asset || !['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': asset.size, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    if (asset.bytes) { res.end(asset.bytes); return; }
    const stream = fs.createReadStream(asset.file!);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('render_asset_server_address_missing');
  const origin = `http://127.0.0.1:${address.port}`;
  const url = (value: unknown) => typeof value === 'string' && assets.has(value) ? `${origin}${value}` : value;
  try {
    return await operation({
      ...manifest, assetOrigin: origin,
      allowedAssetOrigins: manifest.allowedAssetOrigins || [],
      // Local adapter must never forward application credentials.
      assetHeaders: {},
      timeline: timeline.map((item: any) => ({ ...item, url: url(item.url) })),
      voiceover: { ...voiceover, url: url(voiceover.url) }, bgm: { ...bgm, url: url(bgm.url) },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
