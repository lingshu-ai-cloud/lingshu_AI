import { Alert, Button, Empty, Tabs, Tag } from 'antd';
import { ArrowRight, CalendarDays, CircleDollarSign, MessageSquareText } from 'lucide-react';
import type { BusinessMetric, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { Page } from '../../pageRegistry';
import { CalendarPlanner } from '../publishing/CalendarPlanner';

function MetricFact({ label, metric }: { label: string; metric: BusinessMetric | undefined }) {
  const known = metric?.status === 'available' && metric.value !== null && Number.isFinite(metric.value);
  return <div className="min-w-0 rounded-lg border border-border bg-white p-4">
    <p className="text-xs text-text-secondary">{label}</p>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">{known ? metric.value!.toLocaleString('zh-CN') : '—'}</p>
    <p className="mt-2 text-xs text-text-muted">{known ? `来源：${metric.source || '经营快照'}` : metric?.note || '当前没有可核验的数据'}</p>
  </div>;
}

export default function BusinessOverviewTabs({ data, onNavigate }: { data: DigitalEmployeeOverview; onNavigate?: (page: Page) => void }) {
  const snapshot = data.businessSnapshot;
  const ads = snapshot?.ads;
  const interaction = snapshot?.interactionReview;
  const adsAvailable = ads?.status === 'available';
  const inquiryAvailable = interaction?.status === 'available';

  return <section aria-label="经营总览业务页签" className="mt-5 rounded-xl border border-border bg-white p-4 sm:p-5">
    <Tabs aria-label="经营总览页内视图" destroyOnHidden items={[
      { key: 'calendar', label: <span className="inline-flex items-center gap-2"><CalendarDays size={15}/>发布日历</span>, children: <div className="pt-2">
        <p className="mb-4 text-xs text-text-secondary">同一租户的真实发布排期与平台回执；未知发布时间不会补造时刻。日历仅在打开本页签后读取。</p>
        <CalendarPlanner onOpenPost={() => onNavigate?.('traffic')}/>
      </div> },
      { key: 'ads', label: <span className="inline-flex items-center gap-2"><CircleDollarSign size={15}/>投流速览</span>, children: <div className="space-y-4 pt-2">
        {!adsAvailable ? <Alert type="info" showIcon title="投流数据尚未接通或不可核验" description={ads?.note || '当前没有可核验的投流花费、效果和归因字段；不会用预估数代替真实结果。'}/>
          : <><div className="flex flex-wrap items-center gap-2"><Tag color="success">已读取经营快照</Tag><span className="text-xs text-text-secondary">来源：{ads.source || '经营快照'} · 最近报告：{ads.latestReportedAt ? new Date(ads.latestReportedAt).toLocaleString('zh-CN') : '未知'}</span></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricFact label="曝光" metric={ads.performance?.impressions}/><MetricFact label="点击" metric={ads.performance?.clicks}/><MetricFact label="转化" metric={ads.performance?.conversions}/><MetricFact label="归因收入" metric={ads.performance?.attributedRevenue}/></div>
            {ads.spendByCurrency.length ? <div className="rounded-lg border border-border p-4"><h3 className="text-sm font-semibold">已报告花费（按币种）</h3><ul className="mt-2 space-y-1 text-sm text-text-secondary">{ads.spendByCurrency.map(item => <li key={item.currency}>{item.currency} {item.amount.toLocaleString('zh-CN')} · {item.rows} 条回执</li>)}</ul></div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可核验的花费回执"/>}</>}
        <p className="text-xs text-text-muted">本页只读，不会新建计划、启动投放或触发付费供应商。投流独立页面待真实账号、额度及权限核验后开放。</p>
      </div> },
      { key: 'inquiries', label: <span className="inline-flex items-center gap-2"><MessageSquareText size={15}/>询盘诊断</span>, children: <div className="space-y-4 pt-2">
        {!snapshot ? <Alert type="warning" showIcon title="经营快照尚未读取" description="无法判断询盘状态，请稍后刷新经营总览。"/>
          : <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricFact label="询盘总数" metric={snapshot.content.inquiries}/><MetricFact label="已归因客户" metric={snapshot.customer.attributed}/><MetricFact label="高意向客户" metric={snapshot.customer.highIntent}/><MetricFact label="需人工接手" metric={snapshot.customer.humanNeeded}/></div>
            {inquiryAvailable ? <div className="rounded-lg border border-border p-4"><h3 className="text-sm font-semibold">互动复盘</h3><p className="mt-2 text-sm text-text-secondary">评论 {interaction.comments ?? '未知'} · 询盘 {interaction.inquiries ?? '未知'} · 有效询盘 {interaction.qualifiedInquiries ?? '未知'} · 来源未知询盘 {interaction.unknownSourceInquiries ?? '未知'}</p><p className="mt-2 text-xs text-text-muted">{interaction.note || '仅展示已确认的互动回执，不推断成交或转化率。'}</p></div>
              : <Alert type="info" showIcon title="询盘诊断口径待补齐" description={interaction?.note || '当前缺少可核验的互动/来源诊断；下方客户事实仍可在智能客服中查看。'}/>}</>}
        <Button onClick={() => onNavigate?.('conversion')} icon={<ArrowRight size={14}/>}>进入智能客服查看客户</Button>
      </div> },
    ]}/>
  </section>;
}
