import type { BusinessWorkItem } from './businessWorkProjection';
import type { ContentQueueItem, DigitalEmployeeOverview } from './digitalEmployees';

export type WeeklyLaneKey = 'content' | 'traffic' | 'customer' | 'material' | 'review';
export type WeeklyLaneNode = { id: string; date: string; label: string; detail: string; status: 'planned' | 'working' | 'attention' | 'done'; taskId?: string };
export type WeeklyBusinessLane = {
  key: WeeklyLaneKey; label: string; status: string; current: string; next: string;
  needsAttention: boolean; updatedAt: string; nodes: WeeklyLaneNode[];
};
export type WeeklyBusinessProjection = {
  started: boolean; title: string; weekDays: string[]; originalCount: number | null;
  publicationCount: number | null; attentionCount: number; updatedAt: string;
  lanes: WeeklyBusinessLane[];
};

const validDate = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
const latest = (values: string[]) => values.filter(value => Number.isFinite(Date.parse(value))).sort().at(-1) || '';
const dayNumbers: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function reviewWindow(schedule: string | undefined): { weekday: number; time: string; label: string } | null {
  const raw = schedule?.trim() || '周日 16:00';
  const match = raw.match(/(?:周|星期)([一二三四五六日天])\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  const weekday = dayNumbers[match[1]!];
  const [hour, minute] = match[2]!.split(':').map(Number);
  if (weekday === undefined || !Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return null;
  return { weekday, time: match[2]!, label: `周${match[1] === '天' ? '日' : match[1]} ${match[2]}` };
}

export function operatingWeekDays(start: string): string[] {
  const date = validDate(start);
  if (!date) return [];
  const first = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(first.getTime())) return [];
  return Array.from({ length: 7 }, (_, index) => new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

function contentNode(item: ContentQueueItem, index: number): WeeklyLaneNode | null {
  const date = validDate(item.plannedPublishDate || item.contentPlan?.publishAt?.slice(0, 10));
  if (!date) return null;
  return {
    id: item.id, date, taskId: item.socialContentTaskId || undefined,
    label: `内容 ${index + 1}`,
    detail: `${item.title} · ${item.status === 'completed' ? '成片完成，发布待核验' : item.status === 'blocked' ? '需要处理' : '计划发布'}`,
    status: item.status === 'blocked' || item.status === 'waiting_review' ? 'attention'
      : item.status === 'completed' ? 'done' : item.status === 'producing' ? 'working' : 'planned',
  };
}

/** Read-only projection: missing provider evidence never becomes a synthetic task or success. */
export function projectWeeklyBusinessSwimlane(
  data: DigitalEmployeeOverview,
  traffic: BusinessWorkItem[],
  customers: BusinessWorkItem[],
): WeeklyBusinessProjection | null {
  const goal = data.goal;
  if (!goal) return null;
  const weekDays = operatingWeekDays(goal.startsAt);
  const slots = data.plan?.businessPackage?.mixedContentSlots;
  const originalCount = slots ? slots.filter(slot => slot.productionRole === 'original').length : null;
  const publicationCount = slots?.length ?? null;
  const items = (data.contentQueue?.items || []).filter(item => item.origin === 'weekly_plan');
  const contentAttention = items.filter(item => item.status === 'blocked' || item.status === 'waiting_review');
  const completedContent = items.filter(item => item.status === 'completed').length;
  const weeklyTraffic = traffic.filter(item => item.kind === 'traffic' && item.task.sourceContext?.goalId === goal.id);
  const trafficAttention = weeklyTraffic.filter(item => item.needsAction);
  const customerAttention = customers.filter(item => item.kind === 'customer' && item.needsAction);
  const scheduledReview = reviewWindow(data.config?.reviewSchedule);
  const reviewDate = scheduledReview ? weekDays.find(day => new Date(`${day}T00:00:00Z`).getUTCDay() === scheduledReview.weekday) || '' : '';
  const reviewGenerated = data.review?.status === 'generated';
  const started = Boolean(data.run?.id);
  const attentionCount = contentAttention.length + trafficAttention.length + customerAttention.length;
  const nodes = items.map(contentNode).filter((item): item is WeeklyLaneNode => Boolean(item && weekDays.includes(item.date)));
  const lanes: WeeklyBusinessLane[] = [
    {
      key: 'content', label: '内容与发布',
      status: !started ? '待确认' : contentAttention.length ? `${contentAttention.length} 条需处理` : items.some(item => item.status === 'producing') ? '制作中' : '已启动',
      current: items.length ? `成片已完成 ${completedContent} 条；制作任务 ${items.length} 条` : !data.contentQueue ? '内容任务状态尚未取得' : started ? '已启动，内容任务尚未派生' : '等待确认周计划',
      next: contentAttention[0] ? `${contentAttention[0].title}：${contentAttention[0].reason || '需要核对原任务'}` : '发布以各平台真实回执为准',
      needsAttention: contentAttention.length > 0,
      updatedAt: latest(items.map(item => item.updatedAt)), nodes,
    },
    {
      key: 'traffic', label: '投流',
      status: trafficAttention.length ? `${trafficAttention.length} 项需处理` : weeklyTraffic.length ? '计划已读取' : '尚未取得执行计划',
      current: weeklyTraffic.length ? `${weeklyTraffic.length} 项本周关联计划；状态以原投流回执为准`
        : goal.promotionPlans?.length ? `${goal.promotionPlans.length} 项拟投放，尚未取得对应投流计划回执` : '本周暂无拟投放项',
      next: trafficAttention[0]?.next || '付费投放需单独授权', needsAttention: trafficAttention.length > 0,
      updatedAt: latest(weeklyTraffic.map(item => item.updatedAt)), nodes: [],
    },
    {
      key: 'customer', label: '客服',
      status: customerAttention.length ? `${customerAttention.length} 项待处理` : '监听状态尚未取得',
      current: customers.length ? `已读取 ${customers.length} 条真实待办会话` : '暂无真实待办会话；监听状态尚未取得',
      next: customerAttention[0]?.next || '新消息以真实渠道回执为准', needsAttention: customerAttention.length > 0,
      updatedAt: latest(customers.map(item => item.updatedAt)), nodes: [],
    },
    {
      key: 'material', label: '素材', status: '处理回执尚未取得',
      current: '本周上传与分析结果尚未取得', next: '新素材入库后按原任务回执更新',
      needsAttention: false, updatedAt: '', nodes: [],
    },
    {
      key: 'review', label: '周报', status: reviewGenerated ? '报告已生成' : started ? '等待生成窗口' : '待确认',
      current: reviewGenerated ? '报告已生成；送达回执尚未取得' : scheduledReview ? `目标：${scheduledReview.label} 生成；送达另行核验` : '周报生成时间尚未取得',
      next: reviewGenerated ? '核对送达状态' : '汇集各分支真实结果与阻塞', needsAttention: false,
      updatedAt: data.review?.created_at || '',
      nodes: reviewDate ? [{ id: 'review-window', date: reviewDate, label: `${scheduledReview!.time} 周报`, detail: reviewGenerated ? '报告已生成 · 送达待核验' : `${scheduledReview!.label} 目标生成窗口`, status: reviewGenerated ? 'done' : 'planned' }] : [],
    },
  ];
  return {
    started, title: !started ? '本周计划待确认' : data.run?.status === 'succeeded' ? '本周运营已完成'
      : attentionCount ? `本周运营中 · ${attentionCount} 项待处理` : '本周运营已启动',
    weekDays, originalCount, publicationCount, attentionCount,
    updatedAt: latest([goal.updatedAt, ...lanes.map(lane => lane.updatedAt)]), lanes,
  };
}
