interface TaskReportAction {
  label: string;
  agentLabel: string;
}

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { store } from "../storage/index.js";
import type { ScheduledTask } from "./schedulerTaskStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_SCRIPT = path.join(__dirname, '../../scripts/render-task-report-pdf.py');
function pdfPythonPath(): string {
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  if (fs.existsSync(bundled)) return bundled;
  return process.env.PYTHON || 'python3';
}

export function formatTaskTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无';
}

interface WeeklyVideoReport {
  rangeLabel: string;
  startAt: string;
  endAt: string;
  newVideos: number;
  completed: number;
  exactCompleted: number;
  analyzing: number;
  queued: number;
  basicOnly: number;
  failed: number;
  byPlatform: Array<{ platform: string; newVideos: number; completed: number; processing: number; basicOnly: number; failed: number }>;
}

export function beijingWeekWindow(nowMs = Date.now()): { startMs: number; endMs: number; rangeLabel: string } {
  const offsetMs = 8 * 60 * 60 * 1000;
  const beijingNow = new Date(nowMs + offsetMs);
  const daysSinceMonday = (beijingNow.getUTCDay() + 6) % 7;
  const startMs = Date.UTC(
    beijingNow.getUTCFullYear(),
    beijingNow.getUTCMonth(),
    beijingNow.getUTCDate() - daysSinceMonday,
  ) - offsetMs;
  const label = (value: number, withTime = false) => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
  return {
    startMs,
    endMs: nowMs,
    rangeLabel: `${label(startMs)} 00:00 至 ${label(nowMs, true)}（北京时间，本周一开始）`,
  };
}

function schedulerVideoAnalysis(record: Record<string, unknown>): Record<string, unknown> {
  try {
    const value = record.aiAnalysis;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function weeklyVideoReport(task: ScheduledTask, tenantId: string): Promise<WeeklyVideoReport> {
  const window = beijingWeekWindow();
  const configuredPlatforms = new Set(splitTextList(task.config.platforms).map(item => item.toLowerCase()));
  const records: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await store.list<Record<string, unknown>>('trend_videos', {
      where: { tenantId, contentFormat: 'video' },
      sort: '-crawledAt',
      page,
      perPage: 100,
    });
    records.push(...result.items);
    totalPages = Math.max(1, result.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= 50);

  const seen = new Set<string>();
  const weekly = records.filter(record => {
    const platform = String(record.platform || '').toLowerCase();
    if (configuredPlatforms.size && !configuredPlatforms.has(platform)) return false;
    const crawledAt = Date.parse(String(record.crawledAt || ''));
    if (!Number.isFinite(crawledAt) || crawledAt < window.startMs || crawledAt > window.endMs) return false;
    const sourceKey = String(record.sourceUrl || record.id || '').trim();
    if (sourceKey && seen.has(sourceKey)) return false;
    if (sourceKey) seen.add(sourceKey);
    return true;
  });

  const platformStats = new Map<string, { newVideos: number; completed: number; processing: number; basicOnly: number; failed: number }>();
  let completed = 0;
  let exactCompleted = 0;
  let analyzing = 0;
  let queued = 0;
  let basicOnly = 0;
  let failed = 0;

  for (const record of weekly) {
    const analysis = schedulerVideoAnalysis(record);
    const platform = String(record.platform || 'unknown').toLowerCase();
    const row = platformStats.get(platform) || { newVideos: 0, completed: 0, processing: 0, basicOnly: 0, failed: 0 };
    row.newVideos += 1;
    const recordStatus = String(record.status || '');
    const downloadStatus = String(analysis.downloadStatus || '');
    const geminiStatus = String(analysis.geminiStatus || '');
    const isFailed = recordStatus === 'failed'
      || ['failed', 'manual_required'].includes(downloadStatus)
      || ['video_failed', 'ops_failed'].includes(geminiStatus);
    const isCompleted = !isFailed
      && analysis.analysisQuality === 'video'
      && Boolean(analysis.gemini)
      && (!geminiStatus || geminiStatus === 'analyzed');
    const isAnalyzing = !isFailed && !isCompleted && ['downloading', 'analyzing'].includes(downloadStatus);
    const isQueued = !isFailed && !isCompleted && !isAnalyzing
      && ['queued', 'download_retrying', 'ops_queued'].includes(downloadStatus);

    if (isFailed) { failed += 1; row.failed += 1; }
    else if (isCompleted) {
      completed += 1;
      row.completed += 1;
      if (analysis.analysisMode === 'exact') exactCompleted += 1;
    } else if (isAnalyzing) { analyzing += 1; row.processing += 1; }
    else if (isQueued) { queued += 1; row.processing += 1; }
    else { basicOnly += 1; row.basicOnly += 1; }
    platformStats.set(platform, row);
  }

  return {
    rangeLabel: window.rangeLabel,
    startAt: new Date(window.startMs).toISOString(),
    endAt: new Date(window.endMs).toISOString(),
    newVideos: weekly.length,
    completed,
    exactCompleted,
    analyzing,
    queued,
    basicOnly,
    failed,
    byPlatform: [...platformStats.entries()].map(([platform, values]) => ({ platform, ...values })),
  };
}

export function renderTaskReportPdf(payload: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lingshu-task-report-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    const child = spawn(pdfPythonPath(), [PDF_SCRIPT, output], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `PDF render failed with code ${code}`));
        return;
      }
      try {
        const pdf = fs.readFileSync(output);
        fs.rmSync(output, { force: true });
        resolve(pdf);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function splitTextList(value: unknown): string[] {
  return String(value || '')
    .split(/[\n,，;；、/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}


export function taskReportActions(taskType: string): TaskReportAction[] {
  if (taskType === 'holiday_push') {
    return [
      { label: '整理节日前 7 天主推 SKU 与库存水位', agentLabel: '首页' },
      { label: '生成社媒预热脚本和短视频内容方向', agentLabel: '我的社媒' },
      { label: '生成私域触达话术并安排近 90 天询盘跟进', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'trend_report') {
    return [
      { label: '把高频话题转成 3 条 TikTok 脚本方向', agentLabel: '我的社媒' },
      { label: '挑选 2 个产品卖点做 A/B 内容测试', agentLabel: '我的社媒' },
      { label: '将适配市场和语言写回企业中心学习记录', agentLabel: '首页' },
    ];
  }
  if (['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(taskType)) {
    return [
      { label: '查看新入库视频并筛选可复用素材', agentLabel: '我的社媒' },
      { label: '选择高互动视频生成克隆脚本', agentLabel: '我的社媒' },
      { label: '复盘失败下载链接并补充关键词', agentLabel: '首页' },
    ];
  }
  if (taskType === 'exchange_rate') {
    return [
      { label: '生成多币种询盘报价话术', agentLabel: '我的客户' },
      { label: '更新报价风险和利润提醒', agentLabel: '首页' },
      { label: '整理老客补货报价提醒', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'market_intelligence') {
    return [
      { label: '按市场拆解本周报价和选品动作', agentLabel: '首页' },
      { label: '把行业动态转成社媒内容方向', agentLabel: '我的社媒' },
      { label: '生成重点客户跟进理由', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'weekly_review') {
    return [
      { label: '拆解下周社媒内容任务', agentLabel: '我的社媒' },
      { label: '生成询盘转化跟进动作', agentLabel: '我的客户' },
      { label: '生成老客复购唤醒动作', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'crm_wakeup') {
    return [
      { label: '生成老客唤醒分层和触达节奏', agentLabel: '我的客户' },
      { label: '生成 WhatsApp 跟进话术', agentLabel: '我的客户' },
      { label: '生成复购内容素材方向', agentLabel: '我的社媒' },
    ];
  }
  return [{ label: '交给首页拆解后续任务', agentLabel: '首页' }];
}
