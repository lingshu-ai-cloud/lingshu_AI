/** Isolated development callback gateway. No credentials, generic proxy or auto-enable. */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const callbackPath = '/api/overseas/platform-ads/oauth/meta/callback';
export function createAdCallbackRelay({ enabled = false, upstreamPort = 8890, transport = fetch, clock = Date.now } = {}) {
  if (!Number.isSafeInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) throw new Error('Invalid local upstream port');
  // Operator-selected port only. Neither public requests nor configuration can
  // redirect this gateway to another host, protocol, or API path.
  const upstream = `http://127.0.0.1:${upstreamPort}${callbackPath}`;
  let windowStart = clock(), count = 0, inflight = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const reply = (status, message) => { res.statusCode = status; res.end(message); };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); reply(405, 'Method not allowed'); return; }
    const raw = req.url || '';
    if (raw.split('?')[0] !== callbackPath) { reply(404, 'Not found'); return; }
    if (!enabled) { reply(503, 'OAuth forwarding is disabled pending explicit approval.'); return; }
    if (raw.length > 12000 || req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0) { reply(413, 'Request rejected'); return; }
    if (clock() - windowStart >= 60_000) { windowStart = clock(); count = 0; }
    if (++count > 30 || inflight >= 4) { reply(429, 'Too many requests'); return; }
    const query = new URL(raw, 'http://local').searchParams;
    const allowed = new Set(['state', 'code', 'error', 'error_reason', 'error_description', 'error_code']);
    if ([...query.keys()].some(key => !allowed.has(key) || query.getAll(key).length !== 1)) { reply(400, 'Invalid callback parameters'); return; }
    const state = query.get('state') || '', code = query.get('code') || '', error = query.get('error') || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || Boolean(code) === Boolean(error) || code.length > 10000 || error.length > 128) { reply(400, 'Invalid callback parameters'); return; }
    const target = new URL(upstream);
    target.search = new URLSearchParams({ state, ...(code ? { code } : { error }) }).toString();
    inflight++;
    try {
      const response = await transport(target, { method: 'GET', redirect: 'error', headers: { Accept: 'text/plain' }, signal: AbortSignal.timeout(45_000) });
      // Do not echo upstream bodies, authorization codes or query values.
      await response.body?.cancel();
      reply(response.ok ? 200 : response.status >= 400 && response.status < 600 ? response.status : 502,
        response.ok ? 'Meta 授权回调已处理。请返回本地灵枢页面检查结果并选择账户和主页。' : '授权未完成。请返回本地灵枢查看原因；不要重复创建广告或上传素材。');
    } catch { reply(502, '授权服务暂不可达，请返回本地灵枢检查授权状态。'); }
    finally { inflight--; }
  });
  server.maxHeadersCount = 30;
  server.headersTimeout = 10_000;
  server.requestTimeout = 50_000;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production') throw new Error('This temporary relay is not a production deployment path');
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--enable-approved-callback' && !/^--upstream-port=\d{1,5}$/.test(arg))) throw new Error('Unknown relay option');
  const ports = args.filter(arg => arg.startsWith('--upstream-port='));
  if (ports.length > 1) throw new Error('Duplicate upstream port');
  const upstreamPort = ports.length ? Number(ports[0].split('=')[1]) : 8890;
  const enabled = args.includes('--enable-approved-callback');
  const relay = createAdCallbackRelay({ enabled, upstreamPort });
  relay.listen(8892, '127.0.0.1', () => console.log(`Ads callback gateway on 127.0.0.1:8892; forwarding=${enabled ? 'enabled' : 'DISABLED'}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => relay.close(() => process.exit(0)));
}
