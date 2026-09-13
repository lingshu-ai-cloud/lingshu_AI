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
import { initTenantPlatformTokenMonitor } from './routes/tenantPlatformTokenMonitor.js';
import { assistLinksRouter } from './routes/assistLinks.js';
import { initWhatsAppCustomerMaintenance } from './whatsapp/historyImport.js';
import { whatsappOAuthRouter } from './routes/whatsappOAuth.js';
import { publishingRecoveryRouter } from './routes/publishingRecovery.js';
import { publishingRouter } from './routes/publishing.js';
import { initScheduledPublisher } from './publishing/scheduledPublisher.js';
import { backfillTrendVideoContentFormat, ensureDeliveryCollections, ensureTrendVideoAnalysisCapacity } from './storage/ensureDeliveryCollections.js';
import { supportAccessRouter } from './routes/supportAccess.js';
import { crawlWorkerRouter, initCrawlWorkerCloudFallback } from './routes/crawlWorker.js';
import { requireScopedAsset, syncAssetSession } from './lib/assetAccess.js';
import { cloudMaterialMediaRouter } from './routes/cloudMaterialMedia.js';
import { agentMemoryRouter } from './routes/agentMemory.js';
import { socialMetricsRouter } from './routes/socialMetrics.js';
import { followupTemplatesRouter } from './routes/followupTemplates.js';
import { digitalEmployeesRouter } from './routes/digitalEmployees.js';
import { quoteSkillRouter } from './routes/quoteSkill.js';
import { platformAdsRouter } from './routes/platformAds.js';
import { platformAdHandoffRouter } from './routes/platformAdHandoff.js';
import { platformAdConnectionsRouter } from './routes/platformAdConnections.js';
import { platformAdExecutionRouter } from './routes/platformAdExecution.js';
import { platformAdMetricsRouter } from './routes/platformAdMetrics.js';
import { platformAdImportsRouter } from './routes/platformAdImports.js';
import { startAdAutomationWorker } from './platformAds/automation.js';
import { initFollowupDispatchWorker } from './digitalEmployees/followupDispatchWorker.js';
import { initDigitalEmployeeRuntime } from './digitalEmployees/runtimeOrchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await ensureLocalPocketBase();
configureNetworkProxy();
try {
  await ensureDeliveryCollections();
  await ensureTrendVideoAnalysisCapacity();
  await backfillTrendVideoContentFormat();
} catch (error) {
  console.error('[pb-init] failed to ensure tenants / tenant_platform_apps collections:', error instanceof Error ? error.message : error);
}

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

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

// 璺宠繃 SSE 娴佸紡鍝嶅簲锛坱ext/event-stream锛夛紝鍚﹀垯 gzip 缂撳啿浼氭嫋鎱㈤瀛?
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
// Supports base64-encoded admin/manual video uploads (鈮?0MB raw video).
app.use(express.json({
  limit: '120mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = Buffer.from(buf);
  },
}));
app.use(syncAssetSession);

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
      quoteSkill: process.env.NODE_ENV === 'production' && process.env.QUOTE_SKILL_ENABLED !== 'true',
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
app.use('/api/overseas/publishing', publishingRecoveryRouter);
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

await initScheduler();
initScheduledPublisher();
initCrawlerOpsWorker();
initPocketBaseVideoBackfill();
initCrawlWorkerCloudFallback();
initTenantPlatformTokenMonitor();
await initWhatsAppCustomerMaintenance();
initFollowupDispatchWorker();
startAdAutomationWorker();
initDigitalEmployeeRuntime();

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[overseas-agent] http://0.0.0.0:${PORT}`);
});
