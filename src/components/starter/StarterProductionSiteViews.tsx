import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Lightbulb,
  PackageCheck,
  Radar,
  ReceiptText,
  Search,
  ShieldCheck,
  UserSearch,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { StarterProductionSiteId, StarterWorkspace } from '../../lib/starterWorkspace';

type ProductionSite = StarterWorkspace['productionSites'][number];
type ProductionSection = ProductionSite['sections'][number];
type ProductionItem = ProductionSection['items'][number];

const STATUS_LABEL: Record<string, string> = {
  empty: '暂无数据', available: '可查看', partial: '部分数据', unavailable: '尚未接通',
  pending: '等待执行', queued: '已排队', ready: '准备就绪', running: '正在运行',
  waiting_external: '等待外部结果', waiting_approval: '等待审批', waiting_user: '等待用户', waiting_human: '等待用户',
  blocked: '系统能力待接通',
  succeeded: '已完成', completed: '已完成', skipped: '无数据，已跳过', failed: '执行失败', cancelled: '已取消',
  draft_ready: '报价待审核', approved: '已批准', returned: '已退回', artifact_pending: '报价文件生成中',
  awaiting_user_publish: '等待人工发布', evidence_submitted: '发布证据待验真', evidence_rejected: '证据需修正',
  published: '发布证据已验证', send_evidence_pending_verification: '发送记录待验真',
};

const statusLabel = (value: string): string => STATUS_LABEL[value] || '状态待同步';

const FLOW_STEPS: Record<StarterProductionSiteId, Array<{ label: string; icon: LucideIcon }>> = {
  inspiration: [
    { label: '趋势信号', icon: Radar },
    { label: '对标拆解', icon: Search },
    { label: '选题池', icon: Lightbulb },
    { label: '依据留档', icon: FileCheck2 },
  ],
  content: [
    { label: '脚本', icon: FileText },
    { label: '素材', icon: Search },
    { label: '制作', icon: WandSparkles },
    { label: '质检', icon: ShieldCheck },
    { label: '成品', icon: CheckCircle2 },
  ],
  traffic: [
    { label: '平台适配', icon: BarChart3 },
    { label: '发布包', icon: PackageCheck },
    { label: '人工发布', icon: Clock3 },
    { label: '证据回填', icon: ReceiptText },
  ],
  sales: [
    { label: '询盘', icon: UserSearch },
    { label: '缺项补齐', icon: Search },
    { label: '确定性计价', icon: BarChart3 },
    { label: '报价审批', icon: FileCheck2 },
    { label: '结果回写', icon: ReceiptText },
  ],
};

function formattedTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('zh-CN');
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white px-5 py-8 text-center">
      <p className="text-xs text-text-muted">{label}暂无可观察产物；系统不会用演示内容补齐。</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{statusLabel(status)}</span>;
}

function Evidence({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-[10px] leading-relaxed text-text-muted">
      <FileCheck2 size={12} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 break-all">依据：{value}</span>
    </div>
  );
}

function FlowRail({ siteId }: { siteId: StarterProductionSiteId }) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-white p-3" aria-label="固定 Agent 工作流">
      {FLOW_STEPS[siteId].map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex shrink-0 items-center gap-2">
            <div className="flex min-w-28 items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">
              <Icon size={14} className="text-accent" aria-hidden="true" />{step.label}
            </div>
            {index < FLOW_STEPS[siteId].length - 1 && <ArrowRight size={13} className="text-text-muted" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeading({ section }: { section: ProductionSection }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold text-text-primary">{section.label}</h2>
      <span className="text-[10px] font-semibold text-text-muted">
        {section.count === null ? '数量待同步' : `${section.count} 项`} · {statusLabel(section.status)}
      </span>
    </div>
  );
}

function InspirationView({ sections }: { sections: ProductionSection[] }) {
  return <>{sections.map(section => (
    <section key={section.id}>
      <SectionHeading section={section} />
      {section.items.length === 0 ? <EmptySection label={section.label} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {section.items.map((item, index) => (
            <article key={item.id} className="relative overflow-hidden rounded-xl border border-border bg-white p-4">
              <div className="absolute inset-y-0 left-0 w-1 bg-amber-400" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-[10px] font-bold text-amber-700">候选 {String(index + 1).padStart(2, '0')}</p><h3 className="mt-1 text-sm font-bold text-text-primary">{item.title}</h3></div>
                <StatusBadge status={item.status} />
              </div>
              {item.summary && <p className="mt-3 text-xs leading-relaxed text-text-secondary">{item.summary}</p>}
              <Evidence value={item.evidence} />
              {formattedTime(item.updatedAt) && <time dateTime={item.updatedAt || undefined} className="mt-2 block text-[10px] text-text-muted">信号更新：{formattedTime(item.updatedAt)}</time>}
            </article>
          ))}
        </div>
      )}
    </section>
  ))}</>;
}

function ContentItem({ item, index }: { item: ProductionItem; index: number }) {
  return (
    <article className="grid gap-3 rounded-xl border border-border bg-white p-4 sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:items-start">
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-bold text-accent">{index + 1}</div>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-text-primary">{item.title}</h3>
        {item.summary && <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{item.summary}</p>}
        <Evidence value={item.evidence} />
        {formattedTime(item.updatedAt) && <time dateTime={item.updatedAt || undefined} className="mt-2 block text-[10px] text-text-muted">生产更新：{formattedTime(item.updatedAt)}</time>}
      </div>
      <StatusBadge status={item.status} />
    </article>
  );
}

function ContentView({ sections }: { sections: ProductionSection[] }) {
  return <>{sections.map(section => (
    <section key={section.id}>
      <SectionHeading section={section} />
      {section.items.length === 0 ? <EmptySection label={section.label} /> : <div className="space-y-3">{section.items.map((item, index) => <ContentItem key={item.id} item={item} index={index} />)}</div>}
    </section>
  ))}</>;
}

function TrafficView({ sections }: { sections: ProductionSection[] }) {
  return <div className="grid gap-5 xl:grid-cols-2">{sections.map(section => (
    <section key={section.id} className="min-w-0">
      <SectionHeading section={section} />
      {section.items.length === 0 ? <EmptySection label={section.label} /> : (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          {section.items.map(item => (
            <article key={item.id} className="rounded-lg border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold text-sky-700">发布与回执</p><h3 className="mt-1 text-sm font-bold text-text-primary">{item.title}</h3></div><StatusBadge status={item.status} /></div>
              {item.summary && <p className="mt-2 text-xs leading-relaxed text-text-secondary">{item.summary}</p>}
              <Evidence value={item.evidence} />
              {formattedTime(item.updatedAt) && <time dateTime={item.updatedAt || undefined} className="mt-2 block text-[10px] text-text-muted">状态更新：{formattedTime(item.updatedAt)}</time>}
            </article>
          ))}
        </div>
      )}
    </section>
  ))}</div>;
}

function SalesView({ sections }: { sections: ProductionSection[] }) {
  return <>{sections.map(section => (
    <section key={section.id}>
      <SectionHeading section={section} />
      {section.items.length === 0 ? <EmptySection label={section.label} /> : (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-4 border-b border-border bg-surface-2 px-4 py-2 text-[10px] font-bold text-text-muted md:grid">
            <span>询盘／报价对象</span><span>确定性计价摘要</span><span>状态</span>
          </div>
          {section.items.map(item => (
            <article key={item.id} className="grid gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0"><div className="flex items-center gap-2"><UserSearch size={14} className="shrink-0 text-violet-700" /><h3 className="truncate text-sm font-bold text-text-primary">{item.title}</h3></div>{formattedTime(item.updatedAt) && <time dateTime={item.updatedAt || undefined} className="mt-1 block text-[10px] text-text-muted">{formattedTime(item.updatedAt)}</time>}</div>
              <div className="min-w-0"><p className="text-xs leading-relaxed text-text-secondary">{item.summary || '计价摘要待生成'}</p><Evidence value={item.evidence} /></div>
              <StatusBadge status={item.status} />
            </article>
          ))}
        </div>
      )}
    </section>
  ))}</>;
}

export function StarterProductionSiteViews({ site }: { site: ProductionSite }) {
  return (
    <>
      <FlowRail siteId={site.id} />
      <div className="mt-6 space-y-6">
        {site.sections.length === 0 ? <EmptySection label={site.title} /> : null}
        {site.id === 'inspiration' && <InspirationView sections={site.sections} />}
        {site.id === 'content' && <ContentView sections={site.sections} />}
        {site.id === 'traffic' && <TrafficView sections={site.sections} />}
        {site.id === 'sales' && <SalesView sections={site.sections} />}
      </div>
    </>
  );
}
