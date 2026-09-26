import './loadEnvironment.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import express from 'express';
import compression from 'compression';
import { configureNetworkProxy } from './lib/networkEnvironment.js';
import { copywritingRouter } from './routes/copywriting.js';
import { translationRouter } from './routes/translation.js';
import { competitorRouter } from './routes/competitor.js';
import { competitorAccountsRouter } from './routes/competitorAccounts.js';
import { strategyRouter } from './routes/strategy.js';
import { videosRouter } from './routes/videos.js';
import { scriptsRouter } from './routes/scripts.js';
import { trendsRouter } from './routes/trends.js';
import { assetsRouter } from './routes/assets.js';
import { enterpriseRouter, productApiRouter } from './routes/enterprise.js';
import { agentChatRouter } from './routes/agentChat.js';
import { draftReplyRouter } from './routes/draftReply.js';
import { customerSuggestionsRouter } from './routes/customerSuggestions.js';
import { channelsRouter } from './routes/channels.js';
import { schedulerRouter } from './routes/scheduler.js';
import { pluginsRouter } from './routes/plugins.js';
import { studioRouter } from './routes/studio.js';
import { authRouter } from './routes/auth.js';
import { youtubeRouter } from './routes/youtube.js';
import { socialRouter } from './routes/social.js';
import { socialEngagementRouter } from './routes/socialEngagement.js';
import { socialDiscoveryRouter } from './routes/socialDiscovery.js';
import { socialProgramsRouter } from './routes/socialPrograms.js';
import { socialChannelsRouter } from './socialChannels/router.js';
import { wecomCustomerServiceRouter } from './routes/wecomCustomerService.js';
import { platformIntegrationsRouter } from './routes/platformIntegrations.js';
import { adminRouter } from './routes/admin.js';
import { assistantThreadsRouter } from './routes/assistantThreads.js';
import { webhookRouter } from './routes/webhooks.js';
import { isDemoMode, demoLimits } from './lib/demo.js';
import { assistLinksRouter } from './routes/assistLinks.js';
import { whatsappOAuthRouter } from './routes/whatsappOAuth.js';
import { publishingRecoveryRouter } from './routes/publishingRecovery.js';
import { publishingRouter } from './routes/publishing.js';
import { backfillTrendVideoContentFormat, ensureDeliveryCollections, ensureTrendVideoAnalysisCapacity } from './storage/ensureDeliveryCollections.js';
import { supportAccessRouter } from './routes/supportAccess.js';
import { crawlWorkerRouter } from './routes/crawlWorker.js';
import { requireScopedAsset, syncAssetSession } from './lib/assetAccess.js';
import { cloudMaterialMediaRouter } from './routes/cloudMaterialMedia.js';
import { agentMemoryRouter } from './routes/agentMemory.js';
import { socialMetricsRouter } from './routes/socialMetrics.js';
import { followupTemplatesRouter } from './routes/followupTemplates.js';
import { digitalEmployeesRouter } from './routes/digitalEmployees.js';
import { startBackgroundJobs } from './runtime/backgroundJobs.js';
import { parseProcessRole, processRoleStartsBackgroundJobs, processRoleStartsHttp } from './runtime/processRole.js';
import { starter198Router } from './starter198/router.js';
import { requireAuth } from './middleware/auth.js';
import { quoteSkillRouter } from './routes/quoteSkill.js';
import { platformAdsRouter } from './routes/platformAds.js';
import { platformAdHandoffRouter } from './routes/platformAdHandoff.js';
import { platformAdConnectionsRouter } from './routes/platformAdConnections.js';
import { platformAdExecutionRouter } from './routes/platformAdExecution.js';
import { platformAdMetricsRouter } from './routes/platformAdMetrics.js';
import { platformAdImportsRouter } from './routes/platformAdImports.js';
import { accountHubRouter } from './routes/accountHub.js';
import { agentNotificationsRouter } from './routes/agentNotifications.js';
import {
  apiRateLimitConfig,
  configureHttpServer,
  createRateLimiter,
  jsonBodyLimits,
  requestSafetyHeaders,
} from './runtime/httpSafety.js';
import { createRuntimeReadinessProbe, runtimeCapabilities } from './runtime/readiness.js';
import { dataAuthorityRequestScope } from './storage/dataAuthority.js';
import { objectStorageConfigurationIssues } from './storage/objectStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processRole = parseProcessRole(process.env.PROCESS_ROLE);
console.log(`[runtime] role=${processRole} http=${processRoleStartsHttp(processRole)} backgroundJobs=${processRoleStartsBackgroundJobs(processRole)}`);
await ensureLocalPocketBase();
configureNetworkProxy();
const startupReadinessIssues: string[] = [];
const storageConfigurationIssues = objectStorageConfigurationIssues();
if (storageConfigurationIssues.length) {
  startupReadinessIssues.push(`object_storage_config_invalid:${storageConfigurationIssues.join(',')}`);
  console.error(`[storage] invalid configuration: ${storageConfigurationIssues.join(', ')}`);
}
const runtimeSchemaRepairRequested = process.env.RUNTIME_SCHEMA_REPAIR_ENABLED === 'true';
if (runtimeSchemaRepairRequested && process.env.NODE_ENV === 'production') {
  // Production schema has one authority: versioned PocketBase migrations.
  // Keeping runtime repair code available in non-production makes local
  // recovery possible without allowing application replicas to race writes.
  startupReadinessIssues.push('runtime_schema_repair_forbidden_in_production');
  console.error('[pb-init] RUNTIME_SCHEMA_REPAIR_ENABLED is forbidden in production; run versioned migrations instead');
} else if (runtimeSchemaRepairRequested) {
  try {
    await ensureDeliveryCollections();
    await ensureTrendVideoAnalysisCapacity();
    await backfillTrendVideoContentFormat();
  } catch (error) {
    startupReadinessIssues.push('runtime_schema_repair_failed');
    console.error('[pb-init] runtime schema repair failed:', error instanceof Error ? error.message : error);
  }
}

const PORT = Number(process.env.PORT ?? 8788);
const app = express();
const limits = jsonBodyLimits();
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isSafeInteger(trustProxyHops) && trustProxyHops > 0 && trustProxyHops <= 10) {
  app.set('trust proxy', trustProxyHops);
}

async function ensureLocalPocketBase(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.PB_AUTO_START !== 'true') return;
  const url = process.env.PB_URL || 'http://127.0.0.1:8090';
  try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return; } catch { /* start below */ }
  const bin = process.env.PB_BIN || '';
  const dataDir = process.env.PB_DATA_DIR || '';
  if (!bin || !dataDir) { console.warn('[pb] auto-start skipped: PB_BIN/PB_DATA_DIR missing'); return; }
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) { console.warn('[pb] auto-start requires a loopback database URL'); return; }
  const child = spawn(bin, ['serve', `--http=${parsed.hostname}:${parsed.port || '8090'}`, `--dir=${dataDir}`], { cwd: path.dirname(bin), stdio: 'ignore', detached: true });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) { console.log(`[pb] auto-started at ${url}`); return; } } catch { /* retry */ }
  }
  console.error(`[pb] auto-start failed at ${url}`);
}

app.use(requestSafetyHeaders);
app.use(dataAuthorityRequestScope);
const readinessProbe = createRuntimeReadinessProbe({ role: processRole, startupIssues: startupReadinessIssues });

// Liveness and dependency-aware readiness are operational probes, not product
// traffic. Register them before the general API limiter and cache readiness
// briefly so load balancers cannot amplify PocketBase load.
app.get('/api/overseas/health', (_req, res) => {
  res.json({
    status: startupReadinessIssues.length ? 'degraded' : 'ok',
    service: 'overseas-marketing-agent',
    port: PORT,
    role: processRole,
    demoMode: isDemoMode(),
    demoLimits: demoLimits(),
    capabilities: runtimeCapabilities(processRole),
    startupIssues: startupReadinessIssues,
  });
});

app.get('/api/overseas/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const report = await readinessProbe();
  if (report.status !== 'ready') {
    res.status(503).json(report);
    return;
  }
  res.json(report);
});

app.use('/api', createRateLimiter(apiRateLimitConfig()));

// Skip compression for SSE and long TTS responses so intermediary buffering
// cannot delay the first byte or strand a completed synthesis response.
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
const captureRawJsonBody: NonNullable<Parameters<typeof express.json>[0]>['verify'] = (req, _res, buf) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
};
const jsonBody = (limit: string) => express.json({ limit, verify: captureRawJsonBody });

// Large JSON bodies are legacy base64 upload compatibility paths only. Authenticate
// before buffering them and keep the rest of the API at a small default limit.
// New clients should use the streamed `/studio/materials/file` endpoint.
app.use('/api/overseas/studio/materials', requireAuth, jsonBody(`${limits.legacyUpload}mb`));
app.use('/api/overseas/enterprise/assets', requireAuth, jsonBody(`${limits.legacyUpload}mb`));
app.use('/api/overseas/studio/voice-samples', requireAuth, jsonBody(`${limits.voiceUpload}mb`));
app.use('/api/overseas/studio/voiceover', requireAuth, jsonBody(`${limits.voiceUpload}mb`));
app.use('/api/overseas/studio/bgm', requireAuth, jsonBody(`${limits.voiceUpload}mb`));
app.use(jsonBody(`${limits.default}mb`));
app.use(syncAssetSession);

// Legacy routes (stub 鈫?to be implemented separately)
app.use('/api/overseas/copywriting', copywritingRouter);
app.use('/api/overseas/translation', translationRouter);
app.use('/api/overseas/competitor', competitorRouter);
app.use('/api/overseas/competitor-accounts', competitorAccountsRouter);
app.use('/api/overseas/strategy', strategyRouter);

// Core routes
app.use('/api/overseas/starter-198', starter198Router);
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
app.use('/api/overseas/publishing', publishingRecoveryRouter);
app.use('/api/overseas/publishing', publishingRouter);
app.use('/api', assistLinksRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/social-engagement', socialEngagementRouter);
app.use('/api/overseas/social-discovery', socialDiscoveryRouter);
app.use('/api/overseas/social-programs', socialProgramsRouter);
app.use('/api/overseas/social-channels', socialChannelsRouter);
app.use('/api/overseas/wecom-customer-service', wecomCustomerServiceRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/admin', adminRouter);
app.use('/api/overseas/account-hub', accountHubRouter);
app.use('/api/overseas/agent-notifications', agentNotificationsRouter);
app.use('/api/overseas/support-access', supportAccessRouter);
app.use('/api/overseas/crawl-worker', crawlWorkerRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/platform-integrations', platformIntegrationsRouter);
app.use('/api/overseas/assistant-threads', assistantThreadsRouter);
app.use('/api/overseas/agent-memory', agentMemoryRouter);
app.use('/api/overseas/social-metrics', socialMetricsRouter);
app.use('/api/overseas/digital-employees/followup', followupTemplatesRouter);
app.use('/api/overseas/digital-employees', digitalEmployeesRouter);
app.use('/api/overseas/quote-skill', quoteSkillRouter);
app.use('/api/overseas/platform-ads', platformAdConnectionsRouter);
app.use('/api/overseas/platform-ads', platformAdsRouter);
app.use('/api/overseas/platform-ads', platformAdHandoffRouter);
app.use('/api/overseas/platform-ads', platformAdExecutionRouter);
app.use('/api/overseas/platform-ads', platformAdMetricsRouter);
app.use('/api/overseas/platform-ads', platformAdImportsRouter);
app.use('/api/v1/products', productApiRouter);
app.use('/api/webhooks', webhookRouter);

if (processRoleStartsBackgroundJobs(processRole)) await startBackgroundJobs();

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

if (processRoleStartsHttp(processRole)) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[overseas-agent] http://0.0.0.0:${PORT}`);
  });
  configureHttpServer(server);
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[runtime] ${signal} received; draining HTTP connections`);
    server.close(error => {
      if (error) console.error('[runtime] graceful shutdown failed:', error);
      process.exitCode = error ? 1 : 0;
    });
    server.closeIdleConnections?.();
    setTimeout(() => {
      console.error('[runtime] graceful shutdown deadline exceeded');
      process.exitCode = 1;
      server.closeAllConnections?.();
    }, 30_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} else {
  console.log('[overseas-agent] HTTP listener disabled for worker role');
}
