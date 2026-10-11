import { Button, Tag } from 'antd';
import type { VideoCreationPlan } from '../../lib/videoCreationPlan';
import { scheduleWeeklyVideos, weeklyPipelineCards } from '../../lib/weeklyGoalSchedule';
const labels = { tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube' };
export default function WeeklyGoalScheduleCards({ plans, startsAt, endsAt, onEdit, accounts = [] }: { plans: VideoCreationPlan[]; accounts?: Array<{ accountId: string; accountLabel: string }>; startsAt: string; endsAt: string; onEdit: () => void }) {
  const scheduled = scheduleWeeklyVideos(plans, startsAt, endsAt);
  const accountPlans = new Map<string, VideoCreationPlan[]>();
  for (const plan of scheduled) {
    const key = `${plan.platform}:${plan.matrix?.accountId || 'planned'}`;
    accountPlans.set(key, [...(accountPlans.get(key) || []), plan]);
  }
  return <section aria-label="本周完整任务排期" className="mt-4 rounded-lg border border-border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-text-primary">本周计划</h3><Button onClick={onEdit}>调整产出目标与账号</Button></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{weeklyPipelineCards(startsAt, endsAt, plans.length).map((card, index) => <article key={card.id} className="rounded-lg border border-border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><Tag>{index + 1} · {card.id === 'review' ? '周末汇总' : ['production', 'publishing'].includes(card.id) ? '全周分批' : '周初准备'}</Tag><span className="text-xs text-text-secondary">{card.owner}</span></div><h4 className="mt-3 text-sm font-semibold text-text-primary">{card.title}</h4><p className="mt-2 text-xs leading-5 text-text-secondary">{card.output}</p><p className="mt-3 text-xs text-text-secondary">{card.dependsOn.length ? '前置任务就绪后执行' : '确认后启动'}</p></article>)}</div>
    <div className="mt-4 flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-text-primary">账号发布节奏</h4><Tag>{plans.length} 条视频 / 本周</Tag></div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">{[...accountPlans].map(([key, videos]) => <article key={key} className="rounded-lg border border-border p-3"><p className="text-sm font-semibold text-text-primary">{labels[videos[0].platform]} · {videos[0].matrix?.accountId?.startsWith('planned:') ? '待接入账号' : accounts.find(account => account.accountId === videos[0].matrix?.accountId)?.accountLabel || '待确认账号'} · {videos.length} 条</p><div className="mt-2 flex flex-wrap gap-1">{videos.map((video, index) => <Tag key={index}>{video.plannedPublishDate?.slice(5) || '待排期'}</Tag>)}</div></article>)}</div>
    <p className="mt-3 text-xs leading-5 text-text-secondary">发布日期是计划目标。先完成配置核验与编导采集，再逐批制作和分发；前置任务未就绪时显示阻塞，不自动绕过验收或授权。</p>
  </section>;
}
