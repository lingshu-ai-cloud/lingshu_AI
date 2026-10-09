import '../server/loadEnvironment.js';

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localAccountRecordsFile, readLocalAccountRecords } from '../server/lib/localAccountStore.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
import { store } from '../server/storage/index.js';
import { isDiscoveryVideoEligible } from '../shared/contracts/discoveryVideoPolicy.js';

const TENANT_ID = 'local_tenant_customer_aurelia_beauty';
const EMAIL = 'beauty-showcase@local.test';
const BATCH_ID = 'beauty_tiktok_short_benchmarks_v1';
const TARGET_ACCOUNTS = 5;
const VIDEOS_PER_ACCOUNT = 2;
const ROOT = process.cwd();
const ANALYSIS_HEARTBEAT_MS = 30_000;

type CandidateAccount = {
  accountUrl: string;
  accountName: string;
  focus: string;
};

const candidates: CandidateAccount[] = [
  { accountUrl: 'https://www.tiktok.com/@yuchengcosmeticsfactory', accountName: 'Yucheng Cosmetics Factory', focus: '彩妆 OEM/ODM、工厂流程与产品打样' },
  { accountUrl: 'https://www.tiktok.com/@cosmetics_factoryoem7', accountName: 'Cosmetics Factory OEM', focus: '美妆工具与化妆品 OEM/ODM 采购内容' },
  { accountUrl: 'https://www.tiktok.com/@xinhuayang179', accountName: 'Xinhuayang Cosmetics OEM', focus: '美妆制造、灌装包装与工厂过程' },
  { accountUrl: 'https://www.tiktok.com/@zoemir_official', accountName: 'Zoemir Packaging', focus: '化妆品包材、包装供应与生产过程' },
  { accountUrl: 'https://www.tiktok.com/@aoqi.beauty', accountName: 'Aoqi Beauty Factory', focus: '美妆工厂直供、OEM/ODM 与产品开发' },
  { accountUrl: 'https://www.tiktok.com/@noesisbeauty', accountName: 'Noesis Beauty', focus: '护肤品制造、配方与品牌开发' },
];

function assertLocalCustomer(): void {
  const account = readLocalAccountRecords(localAccountRecordsFile()).find(item => item.email.toLowerCase() === EMAIL);
  if (!account || account.tenantId !== TENANT_ID || account.accountType !== 'customer') {
    throw new Error('Aurelia 本地客户账号不存在或租户映射不正确');
  }
}

function backupLocalCollections(): string {
  const directory = path.resolve(ROOT, 'data', 'backups', `beauty-short-benchmarks-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const name of ['trend_videos.json', 'competitor_accounts.json']) {
    const source = path.resolve(ROOT, 'data', 'local-store', name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(directory, name));
  }
  return directory;
}

function jsonRecord(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function analyzeExactly(recordId: string, account: CandidateAccount): Promise<void> {
  const { analyzeSourceVideoJob, inferPlatformFromUrl } = await import('../server/routes/videos.js');
  const initialRecord = await store.getById<Record<string, unknown>>('trend_videos', recordId);
  if (!initialRecord) throw new Error(`采集记录不存在：${recordId}`);
  const sourceUrl = String(initialRecord.sourceUrl || '');
  if (!isDiscoveryVideoEligible({ platform: String(initialRecord.platform || ''), duration: Number(initialRecord.duration || 0), sourceUrl })) {
    throw new Error(`候选不符合 60 秒硬规则：${recordId}`);
  }
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const record = await store.getById<Record<string, unknown>>('trend_videos', recordId);
    if (!record) throw new Error(`采集记录不存在：${recordId}`);
    const previous = jsonRecord(record.aiAnalysis);
    const analysisRunId = randomUUID();
    const analysisStartedAt = new Date().toISOString();
    const curatedAnalysis = {
      ...previous,
      requestedAnalysisMode: 'exact',
      analysisRunId,
      analysisRunMode: 'exact',
      analysisQueueKind: 'maintenance_exact',
      analysisQueueState: 'running',
      analysisQueuedAt: analysisStartedAt,
      reanalyzeQueuedAt: analysisStartedAt,
      analysisStartedAt,
      geminiStatus: 'analyzing',
      analysisError: undefined,
      sourceAccount: account.accountUrl,
      sourceAccountName: account.accountName,
      buyerModel: 'B2B',
      benchmarkRefreshBatch: BATCH_ID,
      candidateEvidence: {
        ...jsonRecord(previous.candidateEvidence),
        relevance: { level: 'high', reasons: ['TikTok 美妆 B2B 对标账号', account.focus, '企业客户采购与生产语境'] },
        transferability: { level: 'high', mechanisms: ['前三秒钩子', '产品/工厂证据', '询盘导向 CTA'], limitations: ['仅学习结构，不复用原媒体'] },
      },
    };
    const updated = await store.update<Record<string, unknown>>('trend_videos', recordId, {
      tags: JSON.stringify([...new Set([...jsonArray(record.tags), 'B2B', '美妆OEM', '工厂', 'TikTok短视频'])]),
      status: 'pending',
      seedBatchId: BATCH_ID,
      maintenanceHeartbeatAt: analysisStartedAt,
      aiAnalysis: JSON.stringify(curatedAnalysis),
    });
    if (!updated) throw new Error(`无法更新分析任务：${recordId}`);
    const analysisRecord = await store.getById<Record<string, unknown>>('trend_videos', recordId);
    if (!analysisRecord) throw new Error(`更新后无法读取分析任务：${recordId}`);
    let heartbeatWrite: Promise<void> = Promise.resolve();
    const heartbeat = setInterval(() => {
      heartbeatWrite = heartbeatWrite.then(async () => {
        const latest = await store.getById<Record<string, unknown>>('trend_videos', recordId);
        const latestAnalysis = jsonRecord(latest?.aiAnalysis);
        if (latestAnalysis.analysisRunId !== analysisRunId
          || latestAnalysis.analysisQueueKind !== 'maintenance_exact'
          || latestAnalysis.analysisQueueState !== 'running') return;
        // Keep the heartbeat outside aiAnalysis so it cannot race a stage or
        // completion write by replacing that whole JSON blob with stale state.
        const heartbeatAt = new Date().toISOString();
        const persisted = await store.update<Record<string, unknown>>('trend_videos', recordId, {
          maintenanceHeartbeatAt: heartbeatAt,
        });
        if (!persisted) throw new Error(`无法更新分析心跳：${recordId}`);
      }).catch(error => {
        console.warn(`记录 ${recordId} 分析心跳写入失败：${error instanceof Error ? error.message : error}`);
      });
    }, ANALYSIS_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      await analyzeSourceVideoJob({
        record: analysisRecord,
        sourceUrl,
        title: String(analysisRecord.title || account.accountName),
        platform: inferPlatformFromUrl(sourceUrl),
        suppressOpsRequeue: true,
        suppressVisibleBackfill: true,
      });
    } finally {
      clearInterval(heartbeat);
      await heartbeatWrite;
    }
    const completed = await store.getById<Record<string, unknown>>('trend_videos', recordId);
    const completedAnalysis = jsonRecord(completed?.aiAnalysis);
    if (completedAnalysis.analysisMode === 'exact'
      && ['video', 'video_review_required'].includes(String(completedAnalysis.analysisQuality || ''))
      && completedAnalysis.gemini) return;
    if (attempt < 2) {
      console.warn(`记录 ${recordId} 第 ${attempt} 次分析未落盘，重新接管：${String(completedAnalysis.analysisError || completedAnalysis.geminiStatus || 'unknown')}`);
      await new Promise(resolve => setTimeout(resolve, 2_000));
      continue;
    }
    throw new Error(`全片精确分析未完成：${recordId} · ${String(completedAnalysis.analysisError || completedAnalysis.geminiStatus || 'unknown')}`);
  }
}

async function run(): Promise<void> {
  assertLocalCustomer();
  const backupDirectory = backupLocalCollections();
  const { crawlVideosForTenant } = await import('../server/routes/videos.js');
  const selected: Array<{ account: CandidateAccount; recordIds: string[] }> = [];

  for (const account of candidates) {
    if (selected.length >= TARGET_ACCOUNTS) break;
    console.log(`采集账号 ${account.accountName} …`);
    try {
      const result = await crawlVideosForTenant({
        tenantId: TENANT_ID,
        platform: 'tiktok',
        mode: 'account',
        accountUrl: account.accountUrl,
        accountName: account.accountName,
        limit: VIDEOS_PER_ACCOUNT,
        cloudFallback: true,
        disableBackfill: true,
        suppressAnalysisQueue: true,
      });
      const recordIds = [...new Set(result.candidateIds || [])].slice(0, VIDEOS_PER_ACCOUNT);
      if (recordIds.length !== VIDEOS_PER_ACCOUNT) {
        console.warn(`跳过 ${account.accountName}：仅得到 ${recordIds.length}/${VIDEOS_PER_ACCOUNT} 条合格短视频`);
        continue;
      }
      selected.push({ account, recordIds });
    } catch (error) {
      console.warn(`跳过 ${account.accountName}：${error instanceof Error ? error.message : error}`);
    }
  }

  if (selected.length !== TARGET_ACCOUNTS) {
    throw new Error(`只找到 ${selected.length}/${TARGET_ACCOUNTS} 个可采集的高匹配账号；备份位于 ${backupDirectory}`);
  }

  const jobs = selected.flatMap(item => item.recordIds.map(recordId => ({ recordId, account: item.account })));
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    console.log(`分析进度 ${index + 1}/${jobs.length} · ${job.account.accountName} …`);
    await analyzeExactly(job.recordId, job.account);
  }

  const previousAccounts = await store.list<Record<string, unknown>>('competitor_accounts', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 });
  for (const account of previousAccounts.items) await store.delete('competitor_accounts', String(account.id));
  const observedAt = new Date().toISOString();
  for (const item of selected) {
    await store.create('competitor_accounts', {
      tenantId: TENANT_ID,
      platform: 'tiktok',
      accountUrl: item.account.accountUrl,
      accountName: item.account.accountName,
      handle: new URL(item.account.accountUrl).pathname.split('/').filter(Boolean)[0] || '',
      note: `高匹配 B2B 对标账号；${item.account.focus}；仅学习内容结构，不复用原媒体。`,
      matchScore: 92,
      matchSignals: JSON.stringify(['TikTok', 'B2B', '美妆供应链', item.account.focus]),
      lastCrawledAt: observedAt,
      lastCrawlCount: item.recordIds.length,
      sourceBatchId: BATCH_ID,
      createdAt: observedAt,
    });
  }

  const allVideos = await store.list<Record<string, unknown>>('trend_videos', { where: { tenantId: TENANT_ID }, page: 1, perPage: 500 });
  for (const record of allVideos.items) {
    if (jobs.some(job => job.recordId === record.id)) continue;
    if (isDiscoveryVideoEligible({ platform: String(record.platform || ''), duration: Number(record.duration || 0), sourceUrl: String(record.sourceUrl || '') })) continue;
    const analysis = jsonRecord(record.aiAnalysis);
    await store.update('trend_videos', String(record.id), {
      aiAnalysis: JSON.stringify({ ...analysis, userVisible: false, discoveryPolicyExcludedAt: observedAt, discoveryPolicyReason: '视频须为 1–60 秒；YouTube 仅 Shorts' }),
    });
  }

  console.log(JSON.stringify({
    ok: true,
    backupDirectory,
    accountCount: selected.length,
    videoCount: jobs.length,
    accounts: selected.map(item => ({ name: item.account.accountName, url: item.account.accountUrl, videos: item.recordIds.length })),
  }, null, 2));
}

await runWithDataAuthority('local', run);
