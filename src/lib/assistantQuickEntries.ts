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
    { id: 'business-create-week-plan', kind: 'execute', label: '制定本周计划', prompt: '基于当前经营目标创建本周 Agent 执行计划并安排到最近可用时段。', confirmation: 'preview' },
    { id: 'business-retry-blocked', kind: 'execute', label: '处理阻塞任务', prompt: '检查当前真实阻塞任务，生成修复方案并准备执行；没有阻塞任务时不要创建任务。', confirmation: 'preview' },
    { id: 'business-refresh-data', kind: 'execute', label: '刷新经营数据', prompt: '刷新当前经营页依赖的内部数据，并只在需要时检索外部时效信息。', confirmation: 'none' },
  ],
  socialInspiration: [
    { id: 'inspiration-trends', kind: 'question', label: '最近哪些趋势可用', prompt: '结合当前灵感页、企业产品知识和外部实时趋势，推荐适合我们的内容趋势并标明依据。' },
    { id: 'inspiration-benchmark', kind: 'question', label: '分析当前对标内容', prompt: '分析当前页面里的对标内容，指出可借鉴结构、不可照搬部分和适配建议。' },
    { id: 'inspiration-collect', kind: 'execute', label: '采集新对标', prompt: '创建对标内容采集任务，按当前产品与平台要求检索、去重并进入 Agent 排期。', confirmation: 'preview' },
    { id: 'inspiration-score', kind: 'execute', label: '评估爆款潜力', prompt: '对当前真实候选内容创建评分任务，并把结果写回灵感候选列表。', confirmation: 'none' },
    { id: 'inspiration-create-brief', kind: 'execute', label: '生成创作简报', prompt: '基于选中的真实灵感与企业知识创建创作简报任务，并加入本周 Agent 排期。', confirmation: 'preview' },
  ],
  smartAssets: [
    { id: 'assets-production-status', kind: 'question', label: '制作进度如何', prompt: '结合当前内容制作页和任务数据，汇总制作进度、质量风险和阻塞项。' },
    { id: 'assets-content-suggestion', kind: 'question', label: '下一条做什么内容', prompt: '根据本周计划、知识库和已确认灵感，建议下一条最值得制作的内容及原因。' },
    { id: 'assets-create-script', kind: 'execute', label: '生成口播脚本', prompt: '为当前已确认主题创建口播脚本 Agent 任务，加入本周排期并进入现有三栏式生产页面第一步。', confirmation: 'preview' },
    { id: 'assets-create-storyboard', kind: 'execute', label: '生成分镜', prompt: '基于当前已确认脚本创建分镜 Agent 任务，并进入现有内容生产管线。', confirmation: 'preview' },
    { id: 'assets-quality-check', kind: 'execute', label: '检查成片质量', prompt: '对当前真实成片创建质量检查任务，记录问题与可执行返工建议。', confirmation: 'none' },
  ],
  traffic: [
    { id: 'publishing-status', kind: 'question', label: '本周发布安排', prompt: '结合当前发布页和本周计划，概括各平台发布安排、缺口与风险。' },
    { id: 'publishing-timing', kind: 'question', label: '哪个时间发布更好', prompt: '根据当前账号历史表现和必要的外部平台趋势，建议发布时间并说明依据。' },
    { id: 'publishing-schedule', kind: 'execute', label: '生成发布排期', prompt: '为已完成且通过检查的内容创建发布排期任务，并同步到 Agent 任务日历。', confirmation: 'preview' },
    { id: 'publishing-adapt-copy', kind: 'execute', label: '适配多平台文案', prompt: '为当前已确认内容创建多平台文案适配任务，不直接发布。', confirmation: 'none' },
    { id: 'publishing-publish', kind: 'execute', label: '执行已确认发布', prompt: '执行当前已确认的真实发布任务，并保留平台回执。', confirmation: 'double' },
  ],
  conversion: [
    { id: 'conversation-priority', kind: 'question', label: '优先跟进谁', prompt: '根据当前真实客户会话、意向和时效，列出最应优先跟进的客户并说明依据。' },
    { id: 'conversation-summary', kind: 'question', label: '总结当前会话', prompt: '总结当前客户会话的需求、已确认事实、异议和建议下一步。' },
    { id: 'conversation-draft', kind: 'execute', label: '生成跟进草稿', prompt: '基于当前客户会话与企业知识生成跟进草稿，不自动发送。', confirmation: 'none' },
    { id: 'conversation-followup', kind: 'execute', label: '创建跟进任务', prompt: '为当前真实客户创建跟进任务，并安排到最近可用时段。', confirmation: 'preview' },
    { id: 'conversation-send', kind: 'execute', label: '发送已确认回复', prompt: '向当前客户发送已由用户确认的回复，并记录发送回执。', confirmation: 'double' },
  ],
  enterprise: [
    { id: 'enterprise-gaps', kind: 'question', label: '知识库缺什么', prompt: '检查当前企业知识库覆盖情况，列出会影响经营或回答准确性的真实缺口。' },
    { id: 'enterprise-conflicts', kind: 'question', label: '哪些资料有冲突', prompt: '检查当前企业资料中的版本冲突、过期信息和来源不一致，并标明证据。' },
    { id: 'enterprise-organize', kind: 'execute', label: '整理新增资料', prompt: '对已导入的新增资料创建分类、去重和索引任务，不虚构缺失内容。', confirmation: 'none' },
    { id: 'enterprise-refresh', kind: 'execute', label: '更新知识索引', prompt: '为当前已变更的企业资料创建知识索引更新任务。', confirmation: 'preview' },
    { id: 'enterprise-review-expired', kind: 'execute', label: '复核过期资料', prompt: '仅对检测到的真实过期资料创建人工复核任务，并加入 Agent 排期。', confirmation: 'preview' },
  ],
  agentMemory: [
    { id: 'memory-applied', kind: 'question', label: '哪些记忆正在生效', prompt: '说明当前智能体正在使用的已确认记忆、适用范围和来源。' },
    { id: 'memory-conflicts', kind: 'question', label: '记忆是否有冲突', prompt: '检查当前智能体记忆中的冲突、重复和过期项，并给出证据。' },
    { id: 'memory-review', kind: 'execute', label: '复核记忆建议', prompt: '对真实存在的待确认记忆创建复核任务，不自动写入长期记忆。', confirmation: 'preview' },
    { id: 'memory-merge', kind: 'execute', label: '合并重复记忆', prompt: '准备合并已识别的重复记忆，展示影响范围后等待确认。', confirmation: 'preview' },
    { id: 'memory-remove', kind: 'execute', label: '清理已确认过期项', prompt: '清理用户已明确确认过期的智能体记忆，并记录变更。', confirmation: 'double' },
  ],
  plugins: [
    { id: 'plugins-health', kind: 'question', label: '哪些集成异常', prompt: '基于当前集成中心的真实连接状态，说明异常连接、影响范围和处理建议。' },
    { id: 'plugins-needed', kind: 'question', label: '还需要接什么平台', prompt: '结合当前经营目标与已有集成，建议需要补充的平台连接及其价值。' },
    { id: 'plugins-test', kind: 'execute', label: '检测全部连接', prompt: '对当前已有集成创建只读连通性检查任务，并汇总真实结果。', confirmation: 'none' },
    { id: 'plugins-reconnect', kind: 'execute', label: '修复失效连接', prompt: '为检测到的真实失效连接准备重连流程，涉及授权时等待用户确认。', confirmation: 'preview' },
    { id: 'plugins-sync', kind: 'execute', label: '同步最新数据', prompt: '为当前已授权连接创建增量同步任务，并写入 Agent 任务日历。', confirmation: 'preview' },
  ],
};

export const ASSISTANT_QUICK_ENTRY_PAGES = Object.freeze(Object.keys(PAGE_QUICK_ENTRIES) as Page[]);

export function assistantQuickEntriesForPage(page: Page): readonly AssistantQuickEntry[] {
  return PAGE_QUICK_ENTRIES[page] ?? [];
}
