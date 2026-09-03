import path from 'path';
import { timingSafeEqual } from 'node:crypto';
import 'express-async-errors';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { copywritingRouter } from './routes/copywriting.js';
import { translationRouter } from './routes/translation.js';
import { competitorRouter } from './routes/competitor.js';
import { competitorAccountsRouter } from './routes/competitorAccounts.js';
import { strategyRouter } from './routes/strategy.js';
import { initCrawlerOpsWorker, initPocketBaseVideoBackfill, videosRouter } from './routes/videos.js';
import { scriptsRouter } from './routes/scripts.js';
import { trendsRouter } from './routes/trends.js';
import { assetsRouter } from './routes/assets.js';
import { enterpriseRouter, productApiRouter } from './routes/enterprise.js';
import { agentChatRouter } from './routes/agentChat.js';
import { draftReplyRouter } from './routes/draftReply.js';
import { customerSuggestionsRouter } from './routes/customerSuggestions.js';
import { channelsRouter } from './routes/channels.js';
import { schedulerRouter, initScheduler } from './routes/scheduler.js';
import { pluginsRouter } from './routes/plugins.js';
import { studioRouter } from './routes/studio.js';
import { authRouter } from './routes/auth.js';
import { youtubeRouter } from './routes/youtube.js';
import { socialRouter } from './routes/social.js';
import { socialEngagementRouter } from './routes/socialEngagement.js';
import { platformIntegrationsRouter } from './routes/platformIntegrations.js';
import { adminRouter } from './routes/admin.js';
import { assistantThreadsRouter } from './routes/assistantThreads.js';
import { webhookRouter } from './routes/webhooks.js';
import { isDemoMode, demoLimits } from './lib/demo.js';
import { initTenantPlatformTokenMonitor, stopTenantPlatformTokenMonitor } from './routes/tenantPlatformTokenMonitor.js';
import { assistLinksRouter } from './routes/assistLinks.js';
import { initWhatsAppCustomerMaintenance } from './whatsapp/historyImport.js';
import { inboundReceiptHealthCheck } from './whatsapp/inboundReceipt.js';
import { whatsappOAuthRouter } from './routes/whatsappOAuth.js';
import { publishingRouter } from './routes/publishing.js';
import { initScheduledPublisher } from './publishing/scheduledPublisher.js';
import { backfillTrendVideoContentFormat, ensureDeliveryCollections, ensureTrendVideoAnalysisCapacity } from './storage/ensureDeliveryCollections.js';
import { supportAccessRouter } from './routes/supportAccess.js';
import { crawlWorkerRouter, initCrawlWorkerCloudFallback } from './routes/crawlWorker.js';
import { requireScopedAsset, syncAssetSession } from './lib/assetAccess.js';
import { cloudMaterialMediaRouter } from './routes/cloudMaterialMedia.js';
import { agentMemoryRouter } from './routes/agentMemory.js';
import { socialMetricsRouter } from './routes/socialMetrics.js';
import { digitalEmployeesRouter, startDigitalEmployeeWorker, stopDigitalEmployeeWorker } from './routes/digitalEmployees.js';
import { initDigitalEmployeeOutboxWorker } from './digitalEmployees/outboxWorker.js';
import {
  registerCoreReadinessChecks,
  registerHealthCheck,
  runReadinessChecks,
  setProcessDraining,
} from './ops/health.js';
import { renderPrometheusMetrics, requestTelemetry, structuredLog } from './ops/observability.js';
import { fixedWindowRateLimit, securityHeaders } from './ops/httpSafety.js';
import { assertProductionConfiguration, validateProductionConfiguration } from './ops/productionConfig.js';
import { PbError } from './storage/pb.js';
import { store } from './storage/index.js';
import { apiAuthenticationBoundary, apiRoleBoundary } from './middleware/apiAccessPolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
// 跨版本共用的本机密钥配置。项目文件优先，统一配置只补齐缺失项。
dotenv.config({ path: path.join(os.homedir(), '.config', 'lingshu-ai', '.env') });
dotenv.config({ path: path.join(os.homedir(), '.config', 'lingshu-ai', '.env.local') });
// An orchestrator-selected production mode and its injected secrets are an
// immutable trust boundary. A stale developer .env.local must never downgrade
// NODE_ENV or replace production credentials before fail-fast validation.
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
}
const startupConfiguration = validateProductionConfiguration();
if (!startupConfiguration.ok) {
  structuredLog('error', 'production.configuration.invalid', { issues: startupConfiguration.issues });
  // Fail before datastore bootstrapping, workers, listeners, or outbound
  // provider probes. A permanently not-ready zombie container can otherwise
  // keep acquiring leases or accumulating retries while orchestration waits.
  assertProductionConfiguration();
}
await ensureLocalPocketBase();
configureNetworkProxy();
registerCoreReadinessChecks();
registerHealthCheck('whatsapp-inbound-receipts', () => inboundReceiptHealthCheck({ store }), {
  critical: false,
  timeoutMs: 3_000,
});
registerHealthCheck('production-configuration', () => {
  const result = validateProductionConfiguration();
  return result.ok
    ? { ok: true }
    : { ok: false, message: 'production_configuration_invalid', details: { issues: result.issues } };
}, { critical: true });
try {
  await ensureDeliveryCollections();
  await ensureTrendVideoAnalysisCapacity();
  await backfillTrendVideoContentFormat();
} catch (error) {
  structuredLog('error', 'pocketbase.bootstrap.failed', { error: error instanceof Error ? error.message : String(error) });
  if (process.env.NODE_ENV === 'production') throw error;
}
if (process.env.NODE_ENV === 'production') {
  const startupReadiness = await runReadinessChecks();
  if (startupReadiness.status === 'not_ready') {
    structuredLog('error', 'production.startup.readiness_failed', { checks: startupReadiness.checks });
    throw new Error(`production startup readiness failed: ${startupReadiness.checks
      .filter(check => check.critical && !check.ok)
      .map(check => `${check.name}:${check.message || 'failed'}`)
      .join(', ')}`);
  }
}

const PORT = Number(process.env.PORT ?? 8788);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? Number(process.env.TRUST_PROXY_HOPS ?? 1) : false);

async function ensureLocalPocketBase(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.PB_AUTO_START !== 'true') return;
  const url = process.env.PB_URL || 'http://127.0.0.1:8090';
  try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return; } catch { /* start below */ }
  const bin = process.env.PB_BIN || '';
  const dataDir = process.env.PB_DATA_DIR || '';
  if (!bin || !dataDir) { console.warn('[pb] auto-start skipped: PB_BIN/PB_DATA_DIR missing'); return; }
  const parsed = new URL(url);
  const child = spawn(bin, ['serve', `--http=${parsed.hostname}:${parsed.port || '8090'}`, `--dir=${dataDir}`], { cwd: path.dirname(bin), stdio: 'ignore', detached: true });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) { console.log(`[pb] auto-started at ${url}`); return; } } catch { /* retry */ }
  }
  console.error(`[pb] auto-start failed at ${url}`);
}

function configureNetworkProxy(): void {
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
  console.log(`[network] using proxy ${proxy} (NO_PROXY=${process.env.NO_PROXY})`);
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

app.use(requestTelemetry);
app.use(securityHeaders);

function operationalTokenMatches(header: unknown): boolean {
  const expected = Buffer.from(String(process.env.METRICS_TOKEN || '').trim());
  const supplied = Buffer.from(String(header || '').replace(/^Bearer\s+/i, '').trim());
  return Boolean(expected.length && expected.length === supplied.length && timingSafeEqual(expected, supplied));
}

const healthEndpointRateLimit = fixedWindowRateLimit({ name: 'health', limit: 120, windowMs: 60_000 });

app.get('/api/overseas/livez', healthEndpointRateLimit, (_req, res) => {
  res.json({ status: 'alive', service: 'overseas-marketing-agent', uptimeSeconds: Math.floor(process.uptime()) });
});

app.get('/api/overseas/readyz', healthEndpointRateLimit, async (req, res) => {
  const snapshot = await runReadinessChecks();
  const detailed = process.env.NODE_ENV !== 'production' || operationalTokenMatches(req.headers.authorization);
  res.status(snapshot.status === 'not_ready' ? 503 : 200).json(detailed ? snapshot : { status: snapshot.status });
});

app.get('/api/overseas/metrics', healthEndpointRateLimit, (req, res) => {
  if (process.env.NODE_ENV === 'production' && !operationalTokenMatches(req.headers.authorization)) {
    res.status(401).json({ error: 'metrics_auth_required' });
    return;
  }
  res.type('text/plain; version=0.0.4').send(renderPrometheusMetrics());
});

app.use('/api', fixedWindowRateLimit({
  name: 'api',
  limit: Math.max(60, Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 600) || 600),
}));
app.use('/api/overseas/auth', fixedWindowRateLimit({
  name: 'auth',
  limit: Math.max(5, Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 30) || 30),
}));

// 跳过 SSE 流式响应，否则 gzip 缓冲会拖慢首字节。
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    // TTS responses include dense word-level timestamps. On Node 24 the gzip
    // stream can stall after long outbound AI calls, leaving the client with an
    // empty response even though synthesis completed.
    if (req.path === '/api/overseas/studio/tts' || req.path === '/api/overseas/studio/tts/batch') return false;
    return compression.filter(req, res);
  },
}));
// Authenticate and authorize before allocating large JSON bodies. Explicit
// webhook/OAuth/service-token exceptions are decided from method + path only.
app.use('/api', apiAuthenticationBoundary);
app.use('/api', apiRoleBoundary);
const captureRawBody = (req: IncomingMessage, _res: ServerResponse, buf: Buffer): void => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
};
// Signature verification needs exact bytes only for incoming provider
// webhooks. Retaining a second copy of large media JSON would double memory.
app.use('/api/webhooks', express.json({
  limit: process.env.WEBHOOK_JSON_BODY_LIMIT || '1mb', verify: captureRawBody,
}));
// Large base64 payloads are confined to the legacy media ingestion surfaces.
app.use(['/api/overseas/studio', '/api/overseas/videos'], express.json({
  limit: process.env.MEDIA_JSON_BODY_LIMIT || '120mb',
}));
app.use('/api/overseas/enterprise', express.json({
  limit: process.env.ENTERPRISE_JSON_BODY_LIMIT || '20mb',
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));
app.use(syncAssetSession);

// Backwards-compatible shallow health endpoint. Orchestrators must use readyz.
app.get('/api/overseas/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'overseas-marketing-agent',
    port: PORT,
    demoMode: isDemoMode(),
    demoLimits: demoLimits(),
    featureLocks: {
      geminiVideo: process.env.GEMINI_VIDEO_ENABLED !== 'true',
      seedanceVideo: process.env.SEEDANCE_VIDEO_ENABLED !== 'true',
      digitalHuman: !String(process.env.DIGITAL_HUMAN_API_URL || '').trim(),
    },
  });
});

// Legacy routes (stub 鈫?to be implemented separately)
app.use('/api/overseas/copywriting', copywritingRouter);
app.use('/api/overseas/translation', translationRouter);
app.use('/api/overseas/competitor', competitorRouter);
app.use('/api/overseas/competitor-accounts', competitorAccountsRouter);
app.use('/api/overseas/strategy', strategyRouter);

// Core routes
app.use('/api/overseas/videos', videosRouter);
app.use('/api/overseas/scripts', scriptsRouter);
app.use('/api/overseas/trends', trendsRouter);
app.use('/api/overseas/assets', assetsRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas/agents', agentChatRouter);
app.use('/api/overseas/agents', draftReplyRouter);
app.use('/api/overseas/customers', customerSuggestionsRouter);
app.use('/api/overseas/channels', channelsRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/oauth/whatsapp', whatsappOAuthRouter);
app.use('/api/overseas/publishing', publishingRouter);
app.use('/api', assistLinksRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/social-engagement', socialEngagementRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/admin', adminRouter);
app.use('/api/overseas/support-access', supportAccessRouter);
app.use('/api/overseas/crawl-worker', crawlWorkerRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/platform-integrations', platformIntegrationsRouter);
app.use('/api/overseas/assistant-threads', assistantThreadsRouter);
app.use('/api/overseas/agent-memory', agentMemoryRouter);
app.use('/api/overseas/social-metrics', socialMetricsRouter);
app.use('/api/overseas/digital-employees', digitalEmployeesRouter);
app.use('/api/v1/products', productApiRouter);
app.use('/api/webhooks', webhookRouter);

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = String((req as express.Request & { requestId?: string }).requestId || req.headers['x-request-id'] || 'unknown');
  const candidate = error as { type?: string; status?: number; statusCode?: number };
  const bodyTooLarge = candidate?.type === 'entity.too.large' || candidate?.status === 413;
  const invalidJson = error instanceof SyntaxError && candidate?.status === 400;
  const datastoreUnavailable = error instanceof PbError;
  const status = bodyTooLarge ? 413 : invalidJson ? 400 : datastoreUnavailable ? 503 : 500;
  structuredLog('error', 'http.request.failed', {
    requestId, method: req.method, path: req.path, status,
    errorCode: error instanceof PbError ? error.code : candidate?.type,
    error: error instanceof Error ? error.message : String(error),
  });
  if (!res.headersSent) res.status(status).json({
    error: bodyTooLarge ? 'request_body_too_large' : invalidJson ? 'invalid_json' : datastoreUnavailable ? 'datastore_unavailable' : 'internal_error',
    requestId,
  });
});

await initScheduler();
const scheduledPublisher = initScheduledPublisher();
initCrawlerOpsWorker();
initPocketBaseVideoBackfill();
initCrawlWorkerCloudFallback();
initTenantPlatformTokenMonitor();
await initWhatsAppCustomerMaintenance();
startDigitalEmployeeWorker();
const digitalEmployeeOutboxWorker = initDigitalEmployeeOutboxWorker();

// 绱犳潗搴撴湰鍦版枃浠舵墭绠★紙POST /studio/materials 涓婁紶鍒?data/media/锛?
const mediaDir = path.join(__dirname, '..', 'data', 'media');
const privateAssetHeaders = (res: express.Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
};
app.use('/cloud-files', cloudMaterialMediaRouter);
// Neutral alias for browsers/extensions that block paths containing "cloud-files".
app.use('/studio-media', cloudMaterialMediaRouter);
app.use('/media', requireScopedAsset, express.static(mediaDir, {
  setHeaders: privateAssetHeaders,
}));

// BGM 鏇插簱鏈湴鏂囦欢鎵樼锛圥OST /studio/bgm 涓婁紶锛?
const bgmDir = path.join(__dirname, '..', 'data', 'bgm');
app.use('/bgm', requireScopedAsset, express.static(bgmDir, { setHeaders: privateAssetHeaders }));

// TTS 閰嶉煶闊抽鎵樼锛圥OST /studio/tts 鐢熸垚鍒?data/tts/锛?
const ttsDir = path.join(__dirname, '..', 'data', 'tts');
app.use('/tts', requireScopedAsset, express.static(ttsDir, { setHeaders: privateAssetHeaders }));

// 鐪熶汉闊宠壊鏍锋湰鎵樼锛圥OST /studio/voice-samples 涓婁紶锛?
const voiceSamplesDir = path.join(__dirname, '..', 'data', 'voice-samples');
app.use('/voice-samples', requireScopedAsset, express.static(voiceSamplesDir, { setHeaders: privateAssetHeaders }));

// 灏侀潰 SVG 鎵樼锛圥OST /studio/cover 鐢熸垚鍒?data/covers/锛?
const coversDir = path.join(__dirname, '..', 'data', 'covers');
app.use('/covers', requireScopedAsset, express.static(coversDir, { setHeaders: privateAssetHeaders }));

// Serve built frontend
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  structuredLog('info', 'server.started', { address: `http://0.0.0.0:${PORT}`, nodeEnv: process.env.NODE_ENV || 'development' });
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void (async () => {
      setProcessDraining(true);
      structuredLog('info', 'server.shutdown.started', { signal });
      // Stop accepting new sockets immediately. Existing requests and all
      // durable workers are allowed to drain within the common hard timeout.
      const httpClosed = new Promise<Error | null>(resolve => {
        server.close(error => resolve(error || null));
      });
      stopTenantPlatformTokenMonitor();
      await Promise.allSettled([
        stopDigitalEmployeeWorker(Math.max(1_000, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? 20_000) || 20_000)),
        scheduledPublisher.stop(),
        digitalEmployeeOutboxWorker.stop(),
      ]);
      const error = await httpClosed;
      if (error) structuredLog('error', 'server.shutdown.failed', { signal, error: error.message });
      else structuredLog('info', 'server.shutdown.completed', { signal });
      process.exit(error ? 1 : 0);
    })();
    setTimeout(() => {
      structuredLog('error', 'server.shutdown.timeout', { signal });
      process.exit(1);
    }, Math.max(1_000, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? 20_000) || 20_000)).unref();
  });
}
