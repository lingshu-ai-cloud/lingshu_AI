import https from 'node:https';
import { resolve4 } from 'node:dns/promises';

export function publicIPv4(ip: string) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && ![0, 10, 127].includes(p[0]) && p[0] < 224
    && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    && !(p[0] === 192 && (p[1] === 168 || p[1] === 0)) && !(p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    && !(p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
/** Pin the resolved public address; reject redirects, credentials and secondary URLs. */
export async function downloadSwapAsset(value: string, maxBytes: number): Promise<Buffer> {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new Error('素材必须使用公开 HTTPS 地址');
  const addresses = await resolve4(u.hostname);
  if (!addresses.length || addresses.some(ip => !publicIPv4(ip))) throw new Error('不支持内网素材地址');
  return new Promise((resolve, reject) => {
    const req = https.get(u, { lookup: ((_hostname: string, opts: any, cb: any) => opts?.all ? cb(null, [{ address: addresses[0], family: 4 }]) : cb(null, addresses[0], 4)) as any }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`素材下载失败 (${res.statusCode})`)); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('素材超过大小上限')); else chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('素材下载超时')), 120000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}
