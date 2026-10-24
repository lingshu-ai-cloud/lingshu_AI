import { ArrowRight, Headphones, Megaphone, Sparkles } from 'lucide-react';
import type { Page } from '../pageRegistry';
import type { ContentQueueItem, DigitalEmployeeOverview, PublishingPlatform, WorkflowTask } from '../lib/digitalEmployees';
import type { VideoCreationPlan } from '../lib/videoCreationPlan';
import { ThumbnailImage, VideoThumbnail } from './inspiration/InspirationMedia';

type WorkKind = 'content' | 'traffic' | 'customer';
export type DigitalEmployeeHomeWorkItem = {
  id: string; kind: WorkKind; label: string; title: string; activity: string; status: string;
  thumbnailUrl?: string; platform?: PublishingPlatform; page: Page;
};

const activeStatus = /^(?:planned|pending|queued|active|running|producing|waiting_review|waiting_external|waiting_approval|waiting_human|blocked)$/i;
const terminalStatus = /^(?:completed|succeeded|done|cancelled|failed)$/i;
const trafficSignal = /投流|广告|发布|账号|数据复盘|\bads?\b|publish|distribution|performance/i;
const customerSignal = /客服|询盘|客户|跟进|销售|customer|inquiry|followup|sales/i;
const contentSignal = /内容|脚本|分镜|素材|成片|content|script|storyboard|render|quality/i;

function taskText(task: WorkflowTask) {
  return [task.task_key, task.title, task.description, task.kind, task.business_domain, task.capability_key].filter(Boolean).join(' ');
}

function matchingTasks(tasks: WorkflowTask[], pattern: RegExp): WorkflowTask[] {
  const matching = tasks.filter(task => pattern.test(taskText(task)));
  return [...matching.filter(task => !terminalStatus.test(task.status)), ...matching.filter(task => terminalStatus.test(task.status))].slice(0, 3);
}

function plans(data: DigitalEmployeeOverview): VideoCreationPlan[] {
  return data.plan?.businessPackage?.tasks.find(task => task.templateId === 'production')?.videoPlans || data.goal?.videoPlans || [];
}

function planForItem(allPlans: VideoCreationPlan[], item: ContentQueueItem | null, index: number): VideoCreationPlan | null {
  return allPlans.find(plan => Boolean(item?.contentId && plan.contentId === item.contentId))
    || allPlans.filter(plan => plan.productionRole !== 'platform_adaptation')[index]
    || allPlans[index]
    || null;
}

function previewUrl(item: ContentQueueItem | null, plan: VideoCreationPlan | null): string {
  for (const preview of [item?.preproduction, plan?.preproduction]) {
    const storyboard = preview?.materials.storyboard?.find(frame => frame.status === 'ready' && frame.materialPreviewUrl)?.materialPreviewUrl;
    if (storyboard) return storyboard;
    const material = preview?.materials.items.find(asset => asset.status === 'ready' && asset.previewUrl)?.previewUrl;
    if (material) return material;
  }
  return item?.preproduction?.benchmark.thumbnailUrl || plan?.preproduction?.benchmark.thumbnailUrl || plan?.planningEvidence?.referenceThumbnailUrl || '';
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    planned: '待执行', pending: '待执行', queued: '排队中', active: '进行中', running: '进行中', producing: '制作中',
    waiting_review: '待确认', waiting_external: '等待回执', waiting_approval: '待确认', waiting_human: '待处理', blocked: '需处理',
    completed: '已完成', succeeded: '已完成', failed: '执行失败', cancelled: '已取消',
  };
  return labels[status] || status || '状态待核验';
}

function emptyWork(kind: WorkKind, label: string, page: Page, index: number): DigitalEmployeeHomeWorkItem {
  const activity = kind === 'traffic' ? '暂无进行中的投流任务' : kind === 'customer' ? '暂无进行中的客服任务' : '暂无进行中的内容任务';
  return { id: `${kind}-empty-${index}`, kind, label, title: '暂无可核验任务', activity, status: '暂无进行中', page };
}

function taskWork(kind: WorkKind, label: string, page: Page, task: WorkflowTask, index: number): DigitalEmployeeHomeWorkItem {
  return { id: `${kind}-${task.id || index}`, kind, label, title: task.title || task.description || '未命名任务', activity: task.description || task.blocked_reason || task.title || `当前${label}任务`, status: statusLabel(task.status), page };
}

function padColumn(items: DigitalEmployeeHomeWorkItem[], kind: WorkKind, label: string, page: Page) {
  const next = items.slice(0, 3);
  while (next.length < 3) next.push(emptyWork(kind, label, page, next.length));
  return next;
}

export function projectDigitalEmployeeHomeWork(data: DigitalEmployeeOverview): DigitalEmployeeHomeWorkItem[] {
  const queue = [...(data.contentQueue?.items || [])].sort((left, right) => Number(activeStatus.test(right.status)) - Number(activeStatus.test(left.status)));
  const allPlans = plans(data);
  const anchorItem = queue[0] || null;
  const anchorPlan = planForItem(allPlans, anchorItem, 0);
  const anchorThumbnail = previewUrl(anchorItem, anchorPlan);
  const anchorPlatform = anchorItem?.platform || anchorPlan?.platform || 'tiktok';
  const content: DigitalEmployeeHomeWorkItem[] = queue.slice(0, 3).map((item, index) => {
    const plan = planForItem(allPlans, item, index);
    return { id: `content-${item.id || index}`, kind: 'content', label: '内容创作', title: item.title || plan?.publication?.title || plan?.theme || item.productName || plan?.productName || '未命名内容', activity: item.stage || item.reason || '内容任务已进入队列', status: statusLabel(item.status), thumbnailUrl: previewUrl(item, plan), platform: item.platform || plan?.platform || anchorPlatform, page: 'smartAssets' };
  });
  for (const [index, task] of matchingTasks(data.tasks, contentSignal).slice(0, 3 - content.length).entries()) content.push({ ...taskWork('content', '内容创作', 'smartAssets', task, index), platform: anchorPlatform, thumbnailUrl: anchorThumbnail });
  const traffic = matchingTasks(data.tasks, trafficSignal).map((task, index) => taskWork('traffic', '智能投流', 'adsOverview', task, index));
  const customer = matchingTasks(data.tasks, customerSignal).map((task, index) => taskWork('customer', '智能客服', 'conversion', task, index));
  return [...padColumn(content, 'content', '内容创作', 'smartAssets'), ...padColumn(traffic, 'traffic', '智能投流', 'adsOverview'), ...padColumn(customer, 'customer', '智能客服', 'conversion')];
}

const workIcons = { content: Sparkles, traffic: Megaphone, customer: Headphones } satisfies Record<WorkKind, typeof Sparkles>;
const columns: Array<{ kind: WorkKind; label: string; page: Page }> = [
  { kind: 'content', label: '内容创作', page: 'smartAssets' }, { kind: 'traffic', label: '智能投流', page: 'adsOverview' }, { kind: 'customer', label: '智能客服', page: 'conversion' },
];

export default function DigitalEmployeeHomeWork({ data, onNavigate }: { data: DigitalEmployeeOverview | null; onNavigate?: (page: Page) => void }) {
  const items = data ? projectDigitalEmployeeHomeWork(data) : [];
  return <section className="creator-home__canvas" aria-label="数字员工正在进行的工作"><div className="creator-home__work-grid">
    {columns.map(column => {
      const Icon = workIcons[column.kind];
      const entries = items.filter(item => item.kind === column.kind);
      const visible = entries.length ? entries : [0, 1, 2].map(index => emptyWork(column.kind, column.label, column.page, index));
      return <div className="creator-home__work-column" key={column.kind}><div className="creator-home__work-label"><Icon size={17}/><strong>{column.label}</strong><span>{entries.filter(item => item.status !== '暂无进行中').length} 项</span></div><div className="creator-home__work-list">
        {visible.map(item => <button type="button" key={item.id} data-work-kind={item.kind} onClick={() => onNavigate?.(item.page)} className="creator-home__work-entry"><span className="creator-home__work-body"><span className={`creator-home__work-preview${item.kind === 'content' ? '' : ' creator-home__work-preview--task'}`}>{item.kind === 'content' ? <><VideoThumbnail platform={item.platform || 'tiktok'} title={item.title}/>{item.thumbnailUrl && <ThumbnailImage src={item.thumbnailUrl} platform={item.platform || 'tiktok'} title={item.title} className="absolute inset-0 h-full w-full object-cover"/>}</> : <><Icon size={24} aria-hidden="true"/><span>{item.kind === 'traffic' ? '投放任务' : '客户承接'}</span></>}</span><span className="creator-home__work-copy"><span className="creator-home__work-status">{item.status}</span><strong>{item.title}</strong><span>{item.activity}</span></span></span><span className="creator-home__work-action">进入{column.label}<ArrowRight size={14}/></span></button>)}
      </div></div>;
    })}
  </div></section>;
}
