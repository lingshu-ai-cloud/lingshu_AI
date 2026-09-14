import type { StarterRecord } from './repository.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function starterDisplayText(value: unknown, max = 300): string {
  return typeof value === 'string'
    ? value.replace(DISPLAY_CONTROLS, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

export function starterSafeTimestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

const TASK_PRESENTATION: Record<string, { title: string; why: string }> = {
  starter_context_snapshot: { title: '核验本轮经营上下文', why: '锁定本轮事实、策略、权限和预算版本。' },
  starter_content_research: { title: '整理趋势与选题依据', why: '灵小图只从租户内可追溯证据形成候选方向。' },
  starter_content_production: { title: '生产本轮内容', why: '灵小图按已确认事实生成脚本、素材和版本。' },
  starter_content_quality_gate: { title: '核验内容质量', why: '检查事实、格式、风险和可发布性。' },
  starter_content_release_approval: { title: '确认内容发布版本', why: '人工确认冻结版本后才允许生成发布包。' },
  starter_publication_package: { title: '生成平台发布包', why: '灵小量整理文件和文案，不调用平台发布接口。' },
  starter_publication_evidence: { title: '核验人工发布证据', why: '只依据公开链接或平台帖子编号记录结果。' },
  starter_inquiry_intake: { title: '整理询盘必要字段', why: '灵小售只处理报价所需的结构化商业条件。' },
  starter_quote_draft: { title: '生成确定性报价草稿', why: '价格只由已确认规则计算，不由模型决定。' },
  starter_result_summary: { title: '汇总本轮经营结果', why: '灵小枢按已落库证据汇总真实结果。' },
};

export function starterTaskPresentation(task: StarterRecord): { title: string; why: string } {
  return TASK_PRESENTATION[text(task.task_key)] ?? { title: '标准工作流任务', why: '任务详情按固定工作图执行。' };
}

/** Only versioned, structured task schemas may contribute customer-facing copy. */
export function starterTaskOutputSummary(task: StarterRecord): string | null {
  const output = object(task.output);
  const schema = text(output?.schemaVersion);
  if (schema === 'starter-198.context-snapshot-output.v1') return '本轮事实、策略、权限与预算版本已锁定';
  if (schema === 'starter-198.content-research-output.v1') {
    const count = Array.isArray(output?.candidates) ? Math.min(output.candidates.length, 20) : 0;
    return count ? `已形成 ${count} 条带依据的内容候选` : '趋势与选题依据已整理';
  }
  if (schema === 'starter-198.publication-package-output.v1') return '发布包已生成，等待用户人工发布';
  if (schema === 'starter-198.publication-evidence-wait.v1') return '发布包已就绪，尚未取得可核验证据';
  if (schema === 'starter-198.registered-handler-wait.v1') return '该标准节点的生产处理器尚未接通';
  if (schema === 'starter-198.orchestrator-worker-failure.v1') return '任务未通过完整性检查，未继续执行';
  return ['succeeded', 'skipped'].includes(text(task.status)) ? '任务已完成，成果已归档' : null;
}
