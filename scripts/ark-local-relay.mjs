import http from 'node:http';

// Temporary, deliberately narrow supplier relay. Never proxy application or auth routes.
const port = Number(process.env.ARK_LOCAL_RELAY_PORT || 8788);
const backend = String(process.env.ARK_LOCAL_RELAY_BACKEND || 'http://127.0.0.1:8790');
const localReturn = String(process.env.ARK_LOCAL_RETURN_URL || 'http://127.0.0.1:5177/?page=enterprise&arkVerification=complete');

export function createArkLocalRelay() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://relay.local');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405).end(); return; }
    if (url.pathname === '/' && url.searchParams.get('arkVerification') === 'complete' && [...url.searchParams.keys()].every(key => key === 'arkVerification')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.writeHead(200).end(`<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>方舟验证已返回</title><body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>已返回验证入口</h1><p>请切回原来的灵枢本地预览页面，刷新方舟认证状态。若在同一台电脑操作，也可点击下方按钮。</p><a href="${localReturn}">返回灵枢本地预览</a></body></html>`);
      return;
    }
    if (!url.pathname.startsWith('/media/object-storage/') || !url.searchParams.has('assetToken') || [...url.searchParams.keys()].some(key => key !== 'assetToken') || url.href.length > 8192) {
      response.writeHead(404).end(); return;
    }
    const upstream = http.request(`${backend}${url.pathname}${url.search}`, { method: request.method, timeout: 30_000 }, source => {
      response.writeHead(source.statusCode || 502, {
        'Content-Type': source.headers['content-type'] || 'application/octet-stream',
        ...(source.headers['content-length'] ? { 'Content-Length': source.headers['content-length'] } : {}),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      source.pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); });
    upstream.end();
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createArkLocalRelay().listen(port, '127.0.0.1', () => process.stdout.write(`Ark local relay listening on 127.0.0.1:${port}\n`));
}
