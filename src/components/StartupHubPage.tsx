import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Code2,
  Handshake,
  Loader2,
  PanelLeft,
  RefreshCcw,
  ServerCog,
  Users,
} from 'lucide-react';
import type { StartupHubCreateInput, StartupHubRecordKind, StartupHubSnapshot } from '../../shared/startupHub';
import { createStartupHubApi } from '../lib/startupHubApi';
import type { StartupHubActions } from '../lib/startupHubUi';
import StartupCollaborationCenter from './StartupCollaborationCenter';
import StartupCompanyCenter from './StartupCompanyCenter';
import StartupCustomerCenter from './StartupCustomerCenter';
import StartupInfrastructureCenter from './StartupInfrastructureCenter';
import StartupProductCenter from './StartupProductCenter';
import './startupHub.css';

interface Props { preview?: boolean }
type HubView = 'overview' | 'company' | 'collaboration' | 'customers' | 'product' | 'infrastructure';

const EMPTY_SNAPSHOT: StartupHubSnapshot = {
  company: null, tasks: [], taxRecords: [], announcements: [], products: [],
  apiEndpoints: [], logSources: [], issues: [], resources: [], deployments: [], members: [], documents: [],
  decisions: [], sops: [], sopRuns: [], capabilities: [], leads: [], leadActivities: [], leadChatImports: [], updatedAt: null,
};

const NAVIGATION: Array<{
  id: HubView;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'overview', label: '经营总览', description: '状态与待办', icon: Activity },
  { id: 'company', label: '公司中心', description: '公司、财税与人员', icon: Building2 },
  { id: 'collaboration', label: '协作中心', description: '任务、同步与提醒', icon: Users },
  { id: 'customers', label: '客户资源', description: '线索、伙伴与推进', icon: Handshake },
  { id: 'product', label: '产品', description: '产品、API 与 Bug', icon: Code2 },
  { id: 'infrastructure', label: '服务器与设置', description: '部署、费用、容量与权限', icon: ServerCog },
];

function countOpen(snapshot: StartupHubSnapshot) {
  return {
    tasks: snapshot.tasks.filter(item => item.status !== 'completed').length,
    taxes: snapshot.taxRecords.filter(item => !['filed', 'paid'].includes(item.status)).length,
    issues: snapshot.issues.filter(item => item.status !== 'closed').length,
    resources: snapshot.resources.filter(item => item.status === 'warning' || item.status === 'offline').length,
    blockedSops: snapshot.sopRuns.filter(item => item.status === 'blocked').length,
    decisionReviews: snapshot.decisions.filter(item => item.status === 'active' && isPastDate(item.reviewDate)).length,
  };
}

function isPastDate(value?: string) {
  return Boolean(value && new Date(`${value}T23:59:59`).getTime() < Date.now());
}

function isPastInstant(value?: string) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

function daysUntil(value?: string) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function formatUpdatedAt(value: string | null) {
  if (!value) return '尚无业务数据';
  return `最近更新 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))}`;
}

function Overview({ snapshot, onNavigate }: { snapshot: StartupHubSnapshot; onNavigate: (view: HubView) => void }) {
  const counts = countOpen(snapshot);
  const totalRecords = snapshot.tasks.length + snapshot.taxRecords.length + snapshot.announcements.length + snapshot.products.length + snapshot.apiEndpoints.length + snapshot.logSources.length + snapshot.issues.length + snapshot.resources.length + snapshot.deployments.length + snapshot.members.length + snapshot.documents.length + snapshot.decisions.length + snapshot.sops.length + snapshot.sopRuns.length + snapshot.capabilities.length + snapshot.leads.length + snapshot.leadActivities.length + snapshot.leadChatImports.length;
  const cards = [
    { view: 'company' as const, label: '公司中心', value: snapshot.company ? snapshot.company.name : '未配置', detail: counts.taxes ? `${counts.taxes} 项财税事项待处理` : `${snapshot.documents.length} 份公司文件`, icon: Building2 },
    { view: 'collaboration' as const, label: '协作中心', value: `${counts.tasks} 项待办`, detail: `${snapshot.sopRuns.filter(item => item.status === 'running').length} 个流程执行中 · ${counts.blockedSops} 个受阻`, icon: Users },
    { view: 'customers' as const, label: '客户资源', value: `${snapshot.leads.filter(item => !['won', 'lost'].includes(item.stage)).length} 条推进中`, detail: `${snapshot.leads.filter(item => item.intention === 'high').length} 条高意向 · ${snapshot.leads.filter(item => isPastInstant(item.nextFollowUpDate) && !['won', 'lost'].includes(item.stage)).length} 条逾期跟进`, icon: Handshake },
    { view: 'product' as const, label: '产品', value: `${snapshot.products.length} 个产品`, detail: `${snapshot.apiEndpoints.length} 个接口 · ${counts.issues} 个未关闭问题`, icon: Boxes },
    { view: 'infrastructure' as const, label: '服务器与设置', value: `${snapshot.resources.length} 项资源`, detail: `${snapshot.deployments.filter(item => item.status === 'running').length} 个部署运行中 · ${counts.resources} 项告警`, icon: ServerCog },
  ];
  const risks = [
    ...snapshot.tasks.filter(item => item.status === 'open' && isPastDate(item.dueDate)).map(item => ({ id: `task-${item.id}`, title: item.title, meta: `任务逾期 · ${item.owner} · 截止 ${item.dueDate}`, level: item.priority === 'high' ? 0 : 1, view: 'collaboration' as const })),
    ...snapshot.taxRecords.filter(item => !['filed', 'paid'].includes(item.status) && isPastDate(item.dueDate)).map(item => ({ id: `tax-${item.id}`, title: item.title, meta: `报税逾期 · ${item.owner} · 截止 ${item.dueDate}`, level: 0, view: 'company' as const })),
    ...snapshot.issues.filter(item => item.status !== 'closed' && ['critical', 'high'].includes(item.severity)).map(item => ({ id: `issue-${item.id}`, title: item.title, meta: `${item.severity === 'critical' ? '严重事故' : '高优问题'} · ${item.assignee}`, level: item.severity === 'critical' ? 0 : 1, view: 'product' as const })),
    ...snapshot.resources.filter(item => ['warning', 'offline'].includes(item.status)).map(item => ({ id: `resource-${item.id}`, title: item.name, meta: `${item.status === 'offline' ? '资源离线' : '资源告警'} · ${item.owner} · ${item.environment}`, level: item.status === 'offline' ? 0 : 1, view: 'infrastructure' as const })),
    ...snapshot.resources.filter(item => { const days = daysUntil(item.renewalDate); return days !== null && days <= 30; }).map(item => { const days = daysUntil(item.renewalDate) || 0; return ({ id: `renewal-${item.id}`, title: item.name, meta: days < 0 ? `订阅已逾期 ${Math.abs(days)} 天 · ${item.owner}` : `${days} 天后需要续费 · ${item.owner}`, level: days < 0 ? 0 : 2, view: 'infrastructure' as const }); }),
    ...snapshot.resources.filter(item => (item.storageTotalGb && item.storageUsedGb !== undefined && item.storageUsedGb / item.storageTotalGb >= .8) || (item.trafficTotalGb && item.trafficUsedGb !== undefined && item.trafficUsedGb / item.trafficTotalGb >= .8)).map(item => ({ id: `capacity-${item.id}`, title: item.name, meta: `容量使用已达到 80% · ${item.owner}`, level: 1, view: 'infrastructure' as const })),
    ...snapshot.deployments.filter(item => item.status === 'degraded').map(item => ({ id: `deployment-${item.id}`, title: item.name, meta: `部署状态异常 · ${item.owner} · ${item.environment}`, level: 0, view: 'infrastructure' as const })),
    ...snapshot.leads.filter(item => isPastInstant(item.nextFollowUpDate) && !['won', 'lost'].includes(item.stage)).map(item => ({ id: `lead-${item.id}`, title: item.companyName, meta: `客户跟进逾期 · ${item.owner} · ${item.nextAction || '未设置下一步'}`, level: item.intention === 'high' ? 0 : 1, view: 'customers' as const })),
    ...snapshot.sopRuns.filter(item => item.status === 'blocked').map(item => ({ id: `sop-${item.id}`, title: item.sopName, meta: `SOP 执行受阻 · ${item.owner}${item.note ? ` · ${item.note}` : ''}`, level: 1, view: 'collaboration' as const })),
    ...snapshot.decisions.filter(item => item.status === 'active' && isPastDate(item.reviewDate)).map(item => ({ id: `decision-${item.id}`, title: item.title, meta: `决策到期复盘 · ${item.owner} · ${item.reviewDate}`, level: 2, view: 'collaboration' as const })),
    ...snapshot.logSources.filter(item => item.status === 'error').map(item => ({ id: `log-${item.id}`, title: item.name, meta: `日志接入异常 · ${item.owner} · ${item.environment}`, level: 1, view: 'product' as const })),
    ...snapshot.products.filter(item => item.status !== 'archived' && isPastDate(item.targetDate)).map(item => ({ id: `product-${item.id}`, title: item.name, meta: `产品目标日期已过 · ${item.owner} · ${item.targetDate}`, level: 2, view: 'product' as const })),
  ].sort((a, b) => a.level - b.level || a.title.localeCompare(b.title, 'zh-CN'));
  const managementChecks = [
    { label: '公司主体资料已确认', passed: Boolean(snapshot.company) },
    { label: '团队责任人可分配', passed: snapshot.members.some(item => item.status === 'active') },
    { label: '产品有问题定义和成功指标', passed: snapshot.products.length > 0 && snapshot.products.every(item => Boolean(item.customerProblem && item.successMetric)) },
    { label: '关键工作已有可执行 SOP', passed: snapshot.sops.some(item => item.status === 'active') },
    { label: '客户推进都有下一步动作', passed: snapshot.leads.length > 0 && snapshot.leads.filter(item => !['won', 'lost'].includes(item.stage)).every(item => Boolean(item.nextAction && item.nextFollowUpDate)) },
    { label: '生产日志可以追踪', passed: snapshot.logSources.some(item => item.status === 'connected') },
  ];
  const activity = [
    ...snapshot.tasks.map(item => ({ id: item.id, title: item.title, meta: `任务 · ${item.owner}`, updatedAt: item.updatedAt, view: 'collaboration' as const })),
    ...snapshot.taxRecords.map(item => ({ id: item.id, title: item.title, meta: `税务 · ${item.owner}`, updatedAt: item.updatedAt, view: 'company' as const })),
    ...snapshot.documents.map(item => ({ id: item.id, title: item.name, meta: '公司文件', updatedAt: item.uploadedAt, view: 'company' as const })),
    ...snapshot.announcements.map(item => ({ id: item.id, title: item.title, meta: `团队同步 · ${item.audience}`, updatedAt: item.updatedAt, view: 'collaboration' as const })),
    ...snapshot.products.map(item => ({ id: item.id, title: item.name, meta: `产品 · ${item.owner}`, updatedAt: item.updatedAt, view: 'product' as const })),
    ...snapshot.issues.map(item => ({ id: item.id, title: item.title, meta: `问题 · ${item.assignee}`, updatedAt: item.updatedAt, view: 'product' as const })),
    ...snapshot.logSources.map(item => ({ id: item.id, title: item.name, meta: `日志源 · ${item.environment}`, updatedAt: item.updatedAt, view: 'product' as const })),
    ...snapshot.resources.map(item => ({ id: item.id, title: item.name, meta: `基础设施 · ${item.environment}`, updatedAt: item.updatedAt, view: 'infrastructure' as const })),
    ...snapshot.deployments.map(item => ({ id: item.id, title: item.name, meta: `部署 · ${item.environment}`, updatedAt: item.updatedAt, view: 'infrastructure' as const })),
    ...snapshot.leads.map(item => ({ id: item.id, title: item.companyName, meta: `客户资源 · ${item.owner}`, updatedAt: item.updatedAt, view: 'customers' as const })),
    ...snapshot.leadActivities.map(item => ({ id: item.id, title: item.summary, meta: `客户跟进 · ${item.owner}`, updatedAt: item.updatedAt, view: 'customers' as const })),
    ...snapshot.decisions.map(item => ({ id: item.id, title: item.title, meta: `决策 · ${item.owner}`, updatedAt: item.updatedAt, view: 'collaboration' as const })),
    ...snapshot.sops.map(item => ({ id: item.id, title: item.name, meta: `SOP · ${item.owner}`, updatedAt: item.updatedAt, view: 'collaboration' as const })),
    ...snapshot.capabilities.map(item => ({ id: item.id, title: item.name, meta: `复用能力 · ${item.owner}`, updatedAt: item.updatedAt, view: 'collaboration' as const })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);

  return <div className="space-y-4">
    {totalRecords === 0 && !snapshot.company && <section className="section-panel flex flex-col items-start justify-between gap-5 border-dashed p-6 sm:flex-row sm:items-center"><div className="flex items-start gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#edf5ef] text-accent"><PanelLeft size={20} /></span><div><h2 className="text-sm font-semibold">工作区已经就绪，当前没有业务数据</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">从左侧选择一个模块，录入真实公司资料、任务、产品或基础设施。页面只展示你实际创建或接口同步的数据。</p></div></div><button type="button" onClick={() => onNavigate('company')} className="btn-primary shrink-0 px-4 py-2 text-xs">配置公司档案</button></section>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map((card, index) => { const Icon = card.icon; return <button key={card.view} type="button" onClick={() => onNavigate(card.view)} className="section-panel startup-metric-card group min-h-[150px] p-4 text-left transition hover:-translate-y-0.5 hover:border-border-bright hover:shadow-[0_10px_28px_rgba(23,61,49,.07)]"><div className="flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf5ef] text-accent"><Icon size={17} /></span><span className="flex items-center gap-2"><span className="startup-index">0{index + 1}</span><ChevronRight size={15} className="text-text-muted transition-transform group-hover:translate-x-0.5" /></span></div><p className="mt-5 text-[10px] font-semibold text-text-muted">{card.label}</p><p className="mt-1 text-xl font-semibold tracking-[-.035em]">{card.value}</p><p className="mt-2 text-[10px] text-text-muted">{card.detail}</p></button>; })}</section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
      <div className="section-panel overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">风险行动队列</h2><p className="mt-1 text-[10px] text-text-muted">跨财税、协作、产品和基础设施自动聚合，严重事项优先</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${risks.length ? 'bg-red-50 text-red-700' : 'bg-[#e8f2eb] text-accent'}`}>{risks.length ? `${risks.length} 项需处理` : '当前无已知风险'}</span></div>{risks.length ? <div className="divide-y divide-border/70">{risks.slice(0, 10).map(item => <button key={item.id} type="button" onClick={() => onNavigate(item.view)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#fbfcfa]"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.level === 0 ? 'bg-red-600' : item.level === 1 ? 'bg-[#d27a38]' : 'bg-[#d2ac38]'}`} /><span className="min-w-0 flex-1"><strong className="block truncate text-[11px]">{item.title}</strong><span className="mt-1 block truncate text-[9px] text-text-muted">{item.meta}</span></span><ChevronRight size={12} className="text-text-muted" /></button>)}</div> : <div className="grid min-h-[260px] place-items-center px-6 text-center"><div><CheckCircle2 size={28} className="mx-auto text-accent" /><p className="mt-3 text-xs font-semibold">当前没有已识别风险</p><p className="mt-1 text-[10px] text-text-muted">新建真实任务、税务事项、事故或资源后，这里会持续判断优先级。</p></div></div>}</div>
      <div className="section-panel overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">管理闭环完整度</h2><p className="mt-1 text-[10px] text-text-muted">不是资料数量，而是系统能否推动工作</p></div><div className="divide-y divide-border/70">{managementChecks.map(item => <div key={item.label} className="flex items-center gap-3 px-5 py-4"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${item.passed ? 'bg-[#e8f2eb] text-accent' : 'bg-[#fff4e8] text-[#a6572a]'}`}>{item.passed ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}</span><span className="text-[10px] font-medium text-text-secondary">{item.label}</span></div>)}</div></div>
    </section>

    <section className="section-panel overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">最近更新</h2><p className="mt-1 text-[10px] text-text-muted">来自真实录入和后端持久化记录</p></div><ClipboardList size={16} className="text-accent" /></div>{activity.length ? <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-y-0">{activity.map(item => <button key={`${item.view}-${item.id}`} type="button" onClick={() => onNavigate(item.view)} className="flex w-full items-center gap-3 border-border px-5 py-3.5 text-left hover:bg-[#fbfcfa] md:border-b md:odd:border-r"><span className="h-2 w-2 rounded-full bg-accent" /><span className="min-w-0 flex-1"><strong className="block truncate text-[11px]">{item.title}</strong><span className="mt-1 block text-[9px] text-text-muted">{item.meta}</span></span><span className="text-[9px] text-text-muted">{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(item.updatedAt))}</span><ChevronRight size={12} className="text-text-muted" /></button>)}</div> : <div className="grid min-h-[220px] place-items-center px-6 text-center"><div><ClipboardList size={26} className="mx-auto text-text-muted" /><p className="mt-3 text-xs font-semibold">暂无更新记录</p><p className="mt-1 text-[10px] text-text-muted">创建第一条业务记录后会显示在这里。</p></div></div>}</section>
  </div>;
}

export default function StartupHubPage({ preview = false }: Props) {
  const api = useMemo(() => createStartupHubApi(preview), [preview]);
  const [view, setView] = useState<HubView>('overview');
  const [snapshot, setSnapshot] = useState<StartupHubSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setSnapshot(await api.snapshot()); setHasLoadedOnce(true); } catch (reason) { setError(reason instanceof Error ? reason.message : '创业中台数据加载失败'); } finally { setLoading(false); } }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!error || loading) return undefined;
    const reconnectTimer = window.setTimeout(() => void load(), 3_000);
    return () => window.clearTimeout(reconnectTimer);
  }, [error, load, loading]);
  const runMutation = async (mutation: () => Promise<void>, bubbleError = false) => { setSaving(true); setError(''); try { await mutation(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); if (bubbleError) throw reason; } finally { setSaving(false); } };
  const actions: StartupHubActions = {
    updateCompany: input => runMutation(async () => { await api.updateCompany(input); }, true),
    create: <K extends StartupHubRecordKind>(kind: K, input: StartupHubCreateInput<K>) => runMutation(async () => { await api.create(kind, input); }),
    update: <K extends StartupHubRecordKind>(kind: K, id: string, patch: Partial<StartupHubCreateInput<K>>) => runMutation(async () => { await api.update(kind, id, patch); }),
    acknowledgeAnnouncement: id => runMutation(async () => { await api.acknowledgeAnnouncement(id); }),
    uploadDocument: (file, metadata) => runMutation(async () => { await api.uploadDocument(file, metadata); }, true),
    downloadDocument: document => api.downloadDocument(document),
    loadDocumentBlob: document => api.loadDocumentBlob(document),
    deleteDocument: id => runMutation(async () => { await api.deleteDocument(id); }),
    uploadLeadChat: (file, leadId) => runMutation(async () => { await api.uploadLeadChat(file, leadId); }, true),
    downloadLeadChat: chatImport => api.downloadLeadChat(chatImport),
    deleteLeadChat: id => runMutation(async () => { await api.deleteLeadChat(id); }),
  };
  const activeNavigation = NAVIGATION.find(item => item.id === view) || NAVIGATION[0];

  return <div className="startup-os flex h-full min-h-0 flex-col bg-[#f5f7f3] text-text-primary md:flex-row">
    <aside className="startup-sidebar shrink-0 border-b border-border bg-[#fbfcfa] md:w-[238px] md:border-b-0 md:border-r"><div className="startup-brand border-b border-border px-4 py-4 md:px-5 md:py-6"><div className="flex items-center gap-3"><span className="startup-brand-mark" aria-hidden="true"><span /><span /></span><div><p className="text-[8px] font-bold tracking-[.28em] text-accent">STARTUP // CONTROL</p><h1 className="mt-1 text-lg font-semibold tracking-[-.035em]">领小鼠管理中台</h1></div></div><p className="mt-4 text-[9px] text-text-muted">{formatUpdatedAt(snapshot.updatedAt)}</p><div className="startup-link-status mt-3"><span aria-hidden="true" />SYSTEM LINK · ONLINE</div></div><nav aria-label="领小鼠管理中台功能" className="startup-nav flex gap-1 overflow-x-auto p-2 md:block md:space-y-1 md:p-3">{NAVIGATION.map((item, index) => { const Icon = item.icon; const active = view === item.id; return <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={active ? 'page' : undefined} className={`startup-nav-item flex min-w-[158px] items-center gap-3 rounded-lg px-3 py-3 text-left transition md:min-w-0 md:w-full ${active ? 'is-active bg-[#e8f2eb] text-text-primary' : 'text-text-secondary hover:bg-white hover:text-text-primary'}`}><span className="startup-nav-number">0{index + 1}</span><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-white text-accent shadow-sm' : 'text-text-muted'}`}><Icon size={15} /></span><span className="min-w-0"><strong className="block text-[11px]">{item.label}</strong><span className="mt-0.5 hidden truncate text-[8px] text-text-muted md:block">{item.description}</span></span></button>; })}</nav><div className="startup-sidebar-footer hidden md:block"><span>OPS CONSOLE</span><strong>{snapshot.company?.name || 'UNBOUND ENTITY'}</strong></div></aside>
    <main className="startup-main min-h-0 min-w-0 flex-1 overflow-y-auto"><div className="startup-main-inner mx-auto w-full max-w-[1420px] px-4 pb-12 pt-5 sm:px-6 lg:px-8"><header className="startup-header flex items-start justify-between gap-4 border-b border-border pb-4"><div><p className="text-[9px] font-semibold tracking-[.2em] text-accent">OPS / 0{NAVIGATION.findIndex(item => item.id === view) + 1} · {activeNavigation.description}</p><h2 className="mt-2 text-[28px] font-semibold tracking-[-.04em]">{activeNavigation.label}</h2></div><div className="flex items-center gap-3"><span className="startup-live hidden sm:flex"><i />LIVE DATA</span><button type="button" onClick={() => void load()} disabled={loading || saving} className="startup-refresh flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[10px] font-semibold text-text-secondary hover:border-border-bright hover:text-text-primary disabled:opacity-50"><RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />刷新</button></div></header>
      {error && <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[11px] text-red-800"><span>{error}</span><button type="button" onClick={() => void load()} className="font-semibold underline">重试</button></div>}
      {loading && !hasLoadedOnce ? <div className="grid min-h-[420px] place-items-center"><div className="text-center"><Loader2 size={22} className="mx-auto animate-spin text-accent" /><p className="mt-3 text-xs text-text-muted">正在读取工作区数据…</p></div></div> : !hasLoadedOnce ? <section className="section-panel mt-5 grid min-h-[360px] place-items-center px-6 text-center"><div><CircleAlert size={28} className="mx-auto text-accent" /><h3 className="mt-4 text-sm font-semibold">服务连接暂时中断</h3><p className="mt-2 max-w-lg text-[10px] leading-5 text-text-muted">页面尚未取得服务端资料，因此不会把空状态当作真实数据展示。你的公司资料和文件仍保存在服务端。</p><button type="button" onClick={() => void load()} className="btn-primary mt-5 px-4 py-2 text-[10px]">重新连接</button></div></section> : <div className="mt-5">
        {view === 'overview' && <Overview snapshot={snapshot} onNavigate={setView} />}
        {view === 'company' && <StartupCompanyCenter snapshot={snapshot} actions={actions} saving={saving} />}
        {view === 'collaboration' && <StartupCollaborationCenter snapshot={snapshot} actions={actions} saving={saving} />}
        {view === 'customers' && <StartupCustomerCenter snapshot={snapshot} actions={actions} saving={saving} />}
        {view === 'product' && <StartupProductCenter snapshot={snapshot} actions={actions} saving={saving} />}
        {view === 'infrastructure' && <StartupInfrastructureCenter snapshot={snapshot} actions={actions} saving={saving} />}
      </div>}
    </div></main>
  </div>;
}
