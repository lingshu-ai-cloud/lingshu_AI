import '../loadEnvironment.js';
import { execFileSync } from 'node:child_process';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
export function configureNetworkProxy(): void {
  const configured = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.CRAWLER_PROXY;
  // Prefer a healthy direct connection. A listening local port is not enough to
  // prove that it is an HTTP proxy (other apps commonly occupy these ports).
  // Gemini and YouTube can have different reachability on the same network.
  // Only stay on the direct route when both services are reachable.
  const proxy = configured || (canReachGoogleDirectly() && canReachYouTubeDirectly() ? '' : detectLocalProxy());
  if (!proxy) return;
  process.env.HTTPS_PROXY ||= proxy;
  process.env.HTTP_PROXY ||= proxy;
  process.env.https_proxy ||= proxy;
  process.env.http_proxy ||= proxy;
  process.env.CRAWLER_PROXY ||= proxy;
  process.env.NODE_USE_ENV_PROXY ||= '1';
  // ProxyAgent 涓嶈 NO_PROXY锛屼細鎶婂彂寰€ localhost锛圥ocketBase 绛夛級鐨勮姹備篃濉炶繘浠ｇ悊瀵艰嚧闈欓粯澶辫触锛?
  // EnvHttpProxyAgent 鎸?NO_PROXY 缁曡鏈湴鍜?PB 涓绘満銆?
  const pbHost = (() => { try { return new URL(process.env.PB_URL || 'http://localhost:8090').hostname; } catch { return ''; } })();
  const noProxy = ['localhost', '127.0.0.1', '::1', pbHost].filter(Boolean).join(',');
  process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${noProxy}` : noProxy;
  process.env.no_proxy = process.env.NO_PROXY;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log('[network] configured application proxy; local database uses direct connection');
}
function curlCanReach(args: string[]): boolean {
  try {
    const status = execFileSync('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--connect-timeout', '2', '--max-time', '6', ...args,
      'https://generativelanguage.googleapis.com/',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 7000 }).trim();
    return status !== '' && status !== '000';
  } catch {
    return false;
  }
}

function canReachGoogleDirectly(): boolean {
  return curlCanReach(['--noproxy', '*']);
}

function canReachYouTubeDirectly(): boolean {
  try {
    const status = execFileSync('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--connect-timeout', '2', '--max-time', '6', '--noproxy', '*',
      'https://www.youtube.com/',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 7000 }).trim();
    return status !== '' && status !== '000';
  } catch {
    return false;
  }
}

function detectLocalProxy(): string {
  if (process.env.NODE_ENV === 'production') return '';
  // Clash Verge defaults to 7897 for its mixed proxy. Prefer it over 7890,
  // which may belong to another local proxy process that accepts connections
  // but cannot establish a valid TLS tunnel to YouTube.
  for (const port of [7897, 7890, 1087, 1080, 20171]) {
    try {
      execFileSync('nc', ['-z', '127.0.0.1', String(port)], { stdio: 'ignore', timeout: 600 });
      const proxy = `http://127.0.0.1:${port}`;
      if (curlCanReach(['--proxy', proxy])) return proxy;
    } catch { /* try next */ }
  }
  return '';
}
