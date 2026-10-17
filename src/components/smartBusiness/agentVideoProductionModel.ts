import type { AgentCalendarTask } from './AgentWeeklyCalendar';

export type VideoProductionStageKey =
  | 'planning'
  | 'directing'
  | 'materials'
  | 'production'
  | 'quality'
  | 'distribution'
  | 'learning';

export type VideoProductionStage = {
  key: VideoProductionStageKey;
  title: string;
  owner: string;
  steps: string[];
  invocation: string;
  input: string;
  handoff: string;
  qualityGate: string;
};

export const VIDEO_PRODUCTION_STAGES: VideoProductionStage[] = [
  {
    key: 'planning', title: '经营定题', owner: '经营 Agent',
    steps: ['business_outline', 'business_schedule'],
    invocation: '周任务包启用或上一轮数据回流后，由经营 Agent 按视频目标派单。',
    input: '经营目标、账号定位、预算边界与发布窗口。',
    handoff: '冻结主题、验收标准、目标账号与交付截止。',
    qualityGate: '目标、账号、预算和发布时间齐全后才进入编导。',
  },
  {
    key: 'directing', title: '编导成稿', owner: '编导 Agent',
    steps: ['benchmark_collection', 'benchmark_scoring', 'director_analysis', 'script', 'storyboard'],
    invocation: '经营定题完成后，为当前视频自动创建分析、脚本与分镜任务。',
    input: '冻结主题、对标证据、企业事实和可用素材清单。',
    handoff: '可执行脚本、逐镜分镜与镜头素材需求。',
    qualityGate: '事实可追溯、脚本时长可执行、分镜完整覆盖表达。',
  },
  {
    key: 'materials', title: '素材就绪', owner: '内容 Agent',
    steps: ['material_preparation', 'material_readiness', 'asset_generation'],
    invocation: '分镜冻结后，内容 Agent 按镜头逐项匹配、核验或生成素材。',
    input: '分镜素材需求、企业素材库、人物与产品授权。',
    handoff: '每个镜头都可访问、可授权使用的素材包。',
    qualityGate: '缺素材、身份不一致或授权不明时禁止进入渲染。',
  },
  {
    key: 'production', title: '成片生产', owner: '内容 Agent',
    steps: ['video_generation'],
    invocation: '素材门通过后，启动合成、数字人、配音、字幕与渲染。',
    input: '冻结分镜、已核验素材、声音与数字人配置。',
    handoff: '带运行回执的候选成片。',
    qualityGate: '逐镜保留来源与运行回执；失败只重试受影响节点。',
  },
  {
    key: 'quality', title: '质检验收', owner: '内容 Agent + 人工',
    steps: ['quality_check', 'rework', 'user_approval'],
    invocation: '渲染完成自动质检；失败进入局部返工，通过后请求人工验收。',
    input: '候选成片、脚本事实、镜头要求和版权依据。',
    handoff: '质检通过且已确认的最终成片。',
    qualityGate: '事实、画面、音频、字幕、版权与平台规格全部通过。',
  },
  {
    key: 'distribution', title: '发布承接', owner: '内容 Agent + 客服 Agent',
    steps: ['publishing', 'customer_channel_readiness', 'customer_inquiry_handoff'],
    invocation: '验收通过后按目标账号发布，并同步开启对应渠道的询盘承接。',
    input: '最终成片、文案、账号授权、发布时间与客户承接策略。',
    handoff: '平台发布回执、内容标识与可归因的客户会话。',
    qualityGate: '没有平台回执不视为发布成功；询盘必须绑定来源内容。',
  },
  {
    key: 'learning', title: '数据复盘', owner: '经营 Agent',
    steps: ['performance_monitoring', 'weekly_review', 'template_extraction', 'template_performance_validation'],
    invocation: '发布回执建立后持续采集指标，统计窗口结束再冻结复盘。',
    input: '平台指标、线索结果、质检记录与生产成本。',
    handoff: '表现结论、可复用模板与下一轮确定性建议。',
    qualityGate: '缺失指标保持未知，不用估算值替代真实结果。',
  },
];

export type VideoProductionLane = {
  id: string;
  videoTaskId: string | null;
  title: string;
  context: string;
  platform: string | null;
  publishWindow: string | null;
  previewThumbnailUrl: string | null;
  previewVideoUrl: string | null;
  tasks: AgentCalendarTask[];
  stages: Record<VideoProductionStageKey, AgentCalendarTask[]>;
  status: AgentCalendarTask['status'];
  completed: number;
  total: number;
};

const terminal = new Set<AgentCalendarTask['status']>(['completed', 'cancelled', 'no_data']);

export function productionStageForTask(task: AgentCalendarTask): VideoProductionStage | null {
  return VIDEO_PRODUCTION_STAGES.find(stage => stage.steps.includes(task.executionStep || '')) ?? null;
}

export function productionStageContract(task: AgentCalendarTask): VideoProductionStage | null {
  return productionStageForTask(task);
}

function taskVideoIdentity(task: AgentCalendarTask): string | null {
  if (task.videoTaskId) return `publication:${task.videoTaskId}`;
  const targeted = task.publicationExecutionTarget?.publicationTaskId
    || task.customerExecutionTarget?.publicationTaskId
    || task.inventoryTarget?.publicationTaskId;
  if (targeted) return `publication:${targeted}`;
  if (task.deliverableGroup) {
    try {
      const values = JSON.parse(task.deliverableGroup) as unknown[];
      if (typeof values.at(-1) === 'string' && values.at(-1)) return `publication:${values.at(-1)}`;
    } catch { /* Legacy non-JSON delivery keys remain valid below. */ }
    return `delivery:${task.deliverableGroup}`;
  }
  if (task.productionTaskId) return `production:${task.productionTaskId}`;
  return null;
}

function cleanVideoTitle(task: AgentCalendarTask): string | null {
  if (task.videoTitle?.trim()) return task.videoTitle.trim();
  const parts = task.title.replace(/^\s*\d+[.、．]\s*/, '').split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  const candidate = parts.length > 1 ? parts.slice(1).join(' · ') : '';
  return candidate && !/待编导明确|待确认/.test(candidate) ? candidate : null;
}

function laneStatus(tasks: AgentCalendarTask[]): AgentCalendarTask['status'] {
  if (tasks.some(task => task.status === 'failed')) return 'failed';
  if (tasks.some(task => task.status === 'blocked')) return 'blocked';
  if (tasks.some(task => task.status === 'active')) return 'active';
  if (tasks.length && tasks.every(task => terminal.has(task.status))) return 'completed';
  return 'planned';
}

function emptyStages(): Record<VideoProductionStageKey, AgentCalendarTask[]> {
  return {
    planning: [], directing: [], materials: [], production: [], quality: [], distribution: [], learning: [],
  };
}

export function buildVideoProductionLanes(tasks: AgentCalendarTask[]): { lanes: VideoProductionLane[]; shared: AgentCalendarTask[] } {
  const groups = new Map<string, AgentCalendarTask[]>();
  const shared: AgentCalendarTask[] = [];
  for (const task of tasks) {
    const identity = taskVideoIdentity(task);
    if (!identity) { shared.push(task); continue; }
    groups.set(identity, [...(groups.get(identity) ?? []), task]);
  }
  const lanes = [...groups.entries()].map(([id, laneTasks], index): VideoProductionLane => {
    const ordered = [...laneTasks].sort((left, right) => {
      const leftIndex = VIDEO_PRODUCTION_STAGES.findIndex(stage => stage.steps.includes(left.executionStep || ''));
      const rightIndex = VIDEO_PRODUCTION_STAGES.findIndex(stage => stage.steps.includes(right.executionStep || ''));
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`);
    });
    const stages = emptyStages();
    for (const task of ordered) {
      const stage = productionStageForTask(task);
      if (stage) stages[stage.key].push(task);
    }
    const explicitVideoTaskId = ordered.find(task => task.videoTaskId)?.videoTaskId;
    const videoTaskId = explicitVideoTaskId || (id.startsWith('publication:') ? id.slice('publication:'.length) : null);
    const title = ordered.map(cleanVideoTitle).find(Boolean) || `视频任务 ${index + 1}`;
    const contextTask = ordered.find(task => task.platform || task.accountId || task.context) ?? ordered[0]!;
    return {
      id, videoTaskId, title,
      context: contextTask.context,
      platform: ordered.find(task => task.platform)?.platform ?? null,
      publishWindow: ordered.find(task => task.publishWindow)?.publishWindow ?? null,
      previewThumbnailUrl: ordered.find(task => task.previewThumbnailUrl)?.previewThumbnailUrl ?? null,
      previewVideoUrl: ordered.find(task => task.previewVideoUrl)?.previewVideoUrl ?? null,
      tasks: ordered, stages, status: laneStatus(ordered),
      completed: ordered.filter(task => terminal.has(task.status)).length,
      total: ordered.length,
    };
  }).sort((left, right) => {
    const severity = (lane: VideoProductionLane) => lane.status === 'failed' ? 0 : lane.status === 'blocked' ? 1 : lane.status === 'active' ? 2 : lane.status === 'planned' ? 3 : 4;
    return severity(left) - severity(right) || left.title.localeCompare(right.title, 'zh-CN');
  });
  return { lanes, shared };
}
