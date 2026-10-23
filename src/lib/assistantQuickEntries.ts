import type { Page } from '../pageRegistry';

export type AssistantQuickEntryConfirmation = 'none' | 'preview' | 'double';

export type AssistantQuickQuestion = {
  id: string;
  kind: 'question';
  label: string;
  prompt: string;
};

export type AssistantQuickExecution = {
  id: string;
  kind: 'execute';
  label: string;
  prompt: string;
  confirmation: AssistantQuickEntryConfirmation;
  taskId?: string;
  expectedVersion?: string;
  operation?: 'start' | 'open' | 'create' | 'revise';
  artifactId?: string;
  disabledReason?: string;
  href?: string;
};

export type AssistantQuickEntry = AssistantQuickQuestion | AssistantQuickExecution;

/**
 * Page-local entry suggestions only. These entries never claim that a task or
 * decision exists; real pending-decision cards continue to come from the
 * server-backed decision feed.
 */
const PAGE_QUICK_ENTRIES: Partial<Record<Page, readonly AssistantQuickEntry[]>> = {
  digitalEmployees: [
    { id: 'business-week-progress', kind: 'question', label: '本周经营进展', prompt: '结合当前经营总览、企业知识库和必要的外部信息，总结本周经营进展、风险与下一步。' },
    { id: 'business-priority', kind: 'question', label: '今天优先做什么', prompt: '根据当前经营数据和任务依赖，告诉我今天最应优先处理的三件事，并说明依据。' },
  ],
  socialInspiration: [
    { id: 'inspiration-trends', kind: 'question', label: '最近哪些趋势可用', prompt: '结合当前灵感页、企业产品知识和外部实时趋势，推荐适合我们的内容趋势并标明依据。' },
    { id: 'inspiration-benchmark', kind: 'question', label: '分析当前对标内容', prompt: '分析当前页面里的对标内容，指出可借鉴结构、不可照搬部分和适配建议。' },
  ],
  smartAssets: [
    { id: 'assets-production-status', kind: 'question', label: '制作进度如何', prompt: '结合当前内容制作页和任务数据，汇总制作进度、质量风险和阻塞项。' },
    { id: 'assets-content-suggestion', kind: 'question', label: '下一条做什么内容', prompt: '根据本周计划、知识库和已确认灵感，建议下一条最值得制作的内容及原因。' },
  ],
  traffic: [
    { id: 'publishing-status', kind: 'question', label: '本周发布安排', prompt: '结合当前发布页和本周计划，概括各平台发布安排、缺口与风险。' },
    { id: 'publishing-timing', kind: 'question', label: '哪个时间发布更好', prompt: '根据当前账号历史表现和必要的外部平台趋势，建议发布时间并说明依据。' },
  ],
  conversion: [
    { id: 'conversation-priority', kind: 'question', label: '优先跟进谁', prompt: '根据当前真实客户会话、意向和时效，列出最应优先跟进的客户并说明依据。' },
    { id: 'conversation-summary', kind: 'question', label: '总结当前会话', prompt: '总结当前客户会话的需求、已确认事实、异议和建议下一步。' },
  ],
  enterprise: [
    { id: 'enterprise-gaps', kind: 'question', label: '知识库缺什么', prompt: '检查当前企业知识库覆盖情况，列出会影响经营或回答准确性的真实缺口。' },
    { id: 'enterprise-conflicts', kind: 'question', label: '哪些资料有冲突', prompt: '检查当前企业资料中的版本冲突、过期信息和来源不一致，并标明证据。' },
  ],
  plugins: [
    { id: 'plugins-health', kind: 'question', label: '哪些集成异常', prompt: '基于当前集成中心的真实连接状态，说明异常连接、影响范围和处理建议。' },
    { id: 'plugins-needed', kind: 'question', label: '还需要接什么平台', prompt: '结合当前经营目标与已有集成，建议需要补充的平台连接及其价值。' },
  ],
};

export const ASSISTANT_QUICK_ENTRY_PAGES = Object.freeze(Object.keys(PAGE_QUICK_ENTRIES) as Page[]);

export function assistantQuickEntriesForPage(page: Page): readonly AssistantQuickEntry[] {
  // Executable entries are supplied by the backend for the selected object.
  // A static prompt is not evidence that an executable pipeline exists.
  return (PAGE_QUICK_ENTRIES[page] ?? []).filter(entry => entry.kind === 'question');
}
