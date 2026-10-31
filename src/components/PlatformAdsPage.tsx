import AdPlanConversationCreate from './AdPlanConversationCreate';
import MetaTargetingFields from './MetaTargetingFields';
import AdDraftMessageChannels from './AdDraftMessageChannels';
import { adMarketSummary } from '../../shared/metaMessageChoice';
import { emptyMetaTargeting, normalizeMetaTargeting } from '../../shared/metaTargeting';
import AdGoalExamples from './AdGoalExamples';
import AdCountrySelect from './AdCountrySelect';
import { adCountryName, metaNeedsWebsite } from '../../shared/metaAdJourney';
import { META_LEAD_DESCRIPTIONS } from '../../shared/metaAdObjectives';
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Collapse, Drawer, Modal, Tabs } from 'antd';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Layers3,
  Link2,
  Plus,
  Target,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type { Page } from "../App";
import { platformAdsApi, type PlatformAdTask } from "../lib/platformAds";
import { emptyAdPlanConfiguration, creationSourceLabels, managementModeLabels, adTaskStatusLabels, type AdManagement } from '../lib/platformAdsDomain';
import "./platformAds.css";
import { getAdPlanCapability, PLATFORM_AD_GOALS } from "../../shared/platformAdCapabilities";
import type { AdConnection } from './AdAccountConnections';
import { AdAccountConnections, AdTaskControls, AdTaskMetrics } from './PlatformAdsOperations';
import AdPerformanceOverview from './AdPerformanceOverview';
import AdMaterialPerformance from './AdMaterialPerformance';
import AdPlanManagement from './AdPlanManagement';
import AdPlanBudgetDialog from './AdPlanBudgetDialog';
import AdPlanMetricHistory from './AdPlanMetricHistory';
import { AdAccountDirectoryProvider } from './AdAccountDirectory';
import AdPlanAccountPicker from './AdPlanAccountPicker';
import AdMaterialPicker from './AdMaterialPicker';
import MetaPlanAuditPanel from './MetaPlanAuditPanel';
import AdManagedWorkspace from './AdManagedWorkspace';
import { PlatformAdsManagedPreview, PlatformAdsPerformancePreview } from './PlatformAdsPreviewSections';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { createForeignTradeMockAdTasks, isForeignTradeMockId } from '../mocks/foreignTradeOperations';
import { isPlatformAdsDemoEnabled as isLocalForeignTradeMockEnabled } from '../lib/platformAdsPreview';
import LsPageHeader from './ui/LsPageHeader';
import { useAdPlanNavigation, useAdPlanTasks } from '../lib/useAdPlanNavigation';

const channels = [
  {
    name: "Facebook",
    description: "放大视频触达，积累品牌关注",
  },
  {
    name: "Instagram",
    description: "用 Reels 提升观看与互动",
  },
  {
    name: "TikTok",
    description: "通过短视频获得更多有效观看",
  },
  {
    name: "YouTube",
    description: "覆盖 Shorts 与多种视频版位",
  },
];

function PlatformLogoGroup({ value, size = 20 }: { value: string; size?: number }) {
  const normalized = value.toLowerCase();
  if (normalized.includes('meta')) return <span className="inline-flex items-center gap-1" aria-label={value}><SocialPlatformIcon platform="facebook" size={size}/><SocialPlatformIcon platform="instagram" size={size}/></span>;
  if (normalized.includes('google')) return <span aria-label={value}><SocialPlatformIcon platform="youtube" size={size}/></span>;
  return <span aria-label={value}><SocialPlatformIcon platform={value} size={size}/></span>;
}
type Draft = AdManagement & Pick<PlatformAdTask, 'currency' | 'status' | 'version' | 'proposal' | 'authorization' | 'sourceContext'> & {
  id: string;
  name: string;
  video: string;
  goal: string;
  market: string;
  budget: string;
  channels: string[];
  createdAt?: string;
};
const taskToDraft = (task: PlatformAdTask): Draft => ({ ...task, currency: task.currency || 'USD', budget: String(task.budget) });
const withLocalMockAdTasks = (tasks: PlatformAdTask[]) => {
  if (!isLocalForeignTradeMockEnabled()) return tasks;
  const ids = new Set(tasks.map(task => task.id));
  return [...tasks, ...createForeignTradeMockAdTasks().filter(task => !ids.has(task.id))];
};
const toLocalDateTime = (value: string) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export default function PlatformAdsPage(props: { page: Page; onNavigate: (page: Page) => void; previewMode?: boolean }) {
  return <AdAccountDirectoryProvider enabled={!props.previewMode} onOpenCreative={() => props.onNavigate('adsCreatives')}><PlatformAdsWorkspace {...props}/></AdAccountDirectoryProvider>;
}
function PlatformAdsWorkspace({
  page,
  onNavigate,
  previewMode = false,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  previewMode?: boolean;
}) {
  const [dialog, setDialog] = useState<"create" | "accounts" | null>(null);
  const [conversationCreate, setConversationCreate] = useState(false);
  const [returnToCreate, setReturnToCreate] = useState(false);
  const closeDialog = () => {
    if (saving) return;
    if (dialog === 'accounts' && returnToCreate) { setReturnToCreate(false); setDialog('create'); }
    else setDialog(null);
  };
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [referenceOverlayOpen, setReferenceOverlayOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const [saving, setSaving] = useState(false);
  const [managedOpen, setManagedOpen] = useState(page === 'adsManaged');
  const planNavigation = useAdPlanNavigation(previewMode);
  const [selectedDraft, setSelectedDraftState] = useState<Draft | null>(null);
  const setSelectedDraft = (value: Draft | null) => { setSelectedDraftState(value); planNavigation.select(value?.id || ''); };
  useEffect(() => {
    if (previewMode) return;
    const task = planNavigation.task; setSelectedDraftState(task ? taskToDraft(task) : null);
    if (task) setDrafts(items => [taskToDraft(task), ...items.filter(item => item.id !== task.id)]);
  }, [planNavigation.task, previewMode]);
  const taskList = useAdPlanTasks(planNavigation.identity, previewMode);
  const loadingTasks = taskList.loading, taskLoadError = taskList.error;
  const [executionLockedIds, setExecutionLockedIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState("全部渠道");
  const [mode, setMode] = useState("建议模式");
  const [notice, setNotice] = useState("");
  const [entry, setEntry] = useState<'manual' | 'ai_assisted' | 'ai_managed'>('ai_assisted');
  const [reportsOpen, setReportsOpen] = useState(false);
  const [budgetTask, setBudgetTask] = useState<PlatformAdTask | null>(null);
  const savingRef = useRef(false);
  const identityRef = useRef(planNavigation.identity);
  identityRef.current = planNavigation.identity;
  const [form, setForm] = useState({
    name: "",
    video: "",
    goal: "提升有效视频观看",
    market: "",
    budget: "",
    currency: 'USD' as PlatformAdTask['currency'],
    channels: ["Facebook", "Instagram"],
    configuration: { ...emptyAdPlanConfiguration },
  });
  const marketSummary = adMarketSummary(form.configuration.countries || [], form.configuration.metaTargeting?.locales);
  const isPlanPage = page !== 'adsCreatives';
  const isCreativePage = page === 'adsCreatives';
  useEffect(() => {
    if (page !== 'adsManaged') return;
    setManagedOpen(true);
    onNavigate('adsPlans');
  }, [page, onNavigate]);
  const openTask = (id: string) => { setSelectedDraftState(drafts.find(task => task.id === id) || null); planNavigation.select(id); onNavigate('adsPlans'); };
  const openCreativeTab = () => {
    onNavigate("adsCreatives");
  };
  useEffect(() => { if (taskList.items) setDrafts(withLocalMockAdTasks(planNavigation.task && !taskList.items.some(task => task.id === planNavigation.task?.id) ? [planNavigation.task, ...taskList.items] : taskList.items).map(taskToDraft)); }, [taskList.items]);
  useEffect(() => { setDrafts([]); setSelectedDraftState(null); setDialog(null); setBudgetTask(null); setNotice(''); }, [planNavigation.identity]);
  useEffect(() => {
    const consume = () => {
      try {
        const raw = sessionStorage.getItem('digitalEmployee.businessDeepLink');
        if (!raw) return;
        const link = JSON.parse(raw);
        if (!['adsPlans', 'adsManaged'].includes(link.page)) return;
        const item = drafts.find(d => d.id === link.businessRef?.entityId);
        if (item) { setSelectedDraft(item); sessionStorage.removeItem('digitalEmployee.businessDeepLink'); }
      } catch { /* optional navigation context */ }
    };
    consume();
    window.addEventListener('lingshu:navigate', consume);
    return () => window.removeEventListener('lingshu:navigate', consume);
  }, [drafts]);
  const managedTasks = useMemo(() => drafts
    .filter(task => !isForeignTradeMockId(task.id))
    .map(task => ({ ...task, budget: Number(task.budget), createdAt: task.createdAt || '', updatedAt: '' })), [drafts]);
  const replaceTask = (task: PlatformAdTask) => {
    setDrafts(items => items.map(item => item.id === task.id ? taskToDraft(task) : item));
    setSelectedDraftState(current => current?.id === task.id ? taskToDraft(task) : current);
  };
  const openCreate = () => {
    if (savingRef.current) return;
    setEntry('ai_assisted');
    setConversationCreate(false);
    setNotice('');
    setSelectedDraft(null);
    setStep(0);
    setForm({
      name: "",
      video: "",
      goal: "提升有效视频观看",
      market: "",
      budget: "",
      currency: 'USD' as PlatformAdTask['currency'],
      channels: ["Facebook", "Instagram"],
      configuration: { ...emptyAdPlanConfiguration },
    });
    setDialog("create");
  };
  useEffect(() => {
    if (previewMode || !window.location?.href) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('create') !== 'conversation') return;
    openCreate(); setConversationCreate(true);
    url.searchParams.delete('create'); window.history.replaceState(window.history.state, '', url);
  }, [previewMode, planNavigation.identity]);
  const openBudget = (task: PlatformAdTask) => {
    if (!previewMode) { setBudgetTask(task); return; }
    setSelectedDraft(taskToDraft(task)); setEntry('manual'); setForm({ ...task, budget: String(task.budget), configuration: { ...task.configuration, startsAt: toLocalDateTime(task.configuration.startsAt), endsAt: toLocalDateTime(task.configuration.endsAt) } }); setStep(1); setDialog('create');
  };
  const continueAfterConnection = (connection: AdConnection) => {
    if (returnToCreate) {
      const samePlatform = connection.provider === 'meta' ? form.channels.some(c => c === 'Facebook' || c === 'Instagram') : connection.provider === 'tiktok' ? form.channels.includes('TikTok') : form.channels.includes('YouTube');
      if (connection.currency === form.currency && samePlatform) setForm(current => ({ ...current, configuration: { ...current.configuration, accountConnectionId: connection.id, ...(current.configuration.accountConnectionId !== connection.id ? { metaMessage: undefined } : {}), ...(current.configuration.metaTargeting && current.configuration.accountConnectionId !== connection.id ? { metaTargeting: { ...current.configuration.metaTargeting, customAudiences: [] } } : {}) } }));
      else setNotice('账户已连接，但与当前草稿币种或平台不同；请在草稿中确认账户、渠道与预算，不会自动换算或覆盖。');
      setReturnToCreate(false);
      setDialog('create');
      return;
    }
    openCreate();
    setForm(current => ({
      ...current,
      channels: connection.provider === 'google' ? ['YouTube'] : connection.provider === 'tiktok' ? ['TikTok'] : ['Facebook', 'Instagram'],
      goal: connection.provider === 'google' ? '获取线索或转化' : '提升有效视频观看',
      ...(connection.currency === 'USD' || connection.currency === 'CNY' ? { currency: connection.currency } : {}),
      configuration: { ...current.configuration, accountConnectionId: connection.id, ...(current.configuration.accountConnectionId !== connection.id ? { metaMessage: undefined } : {}), ...(current.configuration.metaTargeting && current.configuration.accountConnectionId !== connection.id ? { metaTargeting: { ...current.configuration.metaTargeting, customAudiences: [] } } : {}) },
    }));
  };
  const next = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (step < 2) {
      if (step === 0 && !form.configuration.countries?.length) { setNotice('投放地区确认失败：请选择投放国家或地区'); return; }
      if (step === 1 && form.channels.length && form.channels.every(c => ['Facebook', 'Instagram'].includes(c))) {
        try { normalizeMetaTargeting(form.configuration.metaTargeting || emptyMetaTargeting, form.channels); }
        catch (e) { setNotice(`定向配置检查失败：${(e as Error).message}`); return; }
      }
      setStep(step + 1);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNotice('');
    const requestIdentity = planNavigation.identity;
    try {
      if (previewMode && entry !== 'manual') throw new Error('独立预览不调用 AI；请在已登录的完整工作台生成真实方案。');
      const isMeta = form.channels.every(c => ['Facebook', 'Instagram'].includes(c));
      const metaTargeting = isMeta ? normalizeMetaTargeting(form.configuration.metaTargeting || emptyMetaTargeting, form.channels) : undefined;
      const input = { name: form.name.trim() || `${form.goal} · ${marketSummary}`.slice(0, 80), video: form.video, goal: form.goal, market: marketSummary, budget: form.budget, currency: form.currency, channels: form.channels, configuration: { ...form.configuration, ...(form.goal !== '获取消息会话' ? { metaMessage: undefined } : {}), metaTargeting, landingPageUrl: metaNeedsWebsite(form.goal) ? form.configuration.landingPageUrl : '', startsAt: form.configuration.startsAt ? new Date(form.configuration.startsAt).toISOString() : '', endsAt: form.configuration.endsAt ? new Date(form.configuration.endsAt).toISOString() : '' } };
      const task = previewMode
        ? ({ ...input, creationSource: selectedDraft?.creationSource || 'manual', managementMode: 'manual', id: selectedDraft?.id || crypto.randomUUID(), budget: Number(form.budget), status: 'draft', createdAt: selectedDraft?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() } as PlatformAdTask)
        : selectedDraft
        ? await platformAdsApi.updateTask(selectedDraft.id, { ...input, expectedVersion: selectedDraft.version })
        : entry === 'manual' ? await platformAdsApi.createTask(input)
        : await platformAdsApi.generatePlan({ ...input, entry });
      if (identityRef.current !== requestIdentity) return;
      setDrafts((items) => selectedDraft
        ? items.map(item => item.id === task.id ? taskToDraft(task) : item)
        : [taskToDraft(task), ...items]);
      setSelectedDraft(taskToDraft(task));
      setReportsOpen(false);
      setDialog(null);
      onNavigate("adsPlans");
      setNotice(previewMode
        ? "预览草稿已保存在当前页面会话中，刷新后会清空。"
        : `${selectedDraft ? "方案已更新" : "方案已保存"}；本次保存不会执行平台操作，已进入计划管理，可核对方案并执行。`);
    } catch (error) {
      if (identityRef.current !== requestIdentity) return;
      setNotice(`草稿保存失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const accountPicker = !previewMode && <AdPlanAccountPicker currency={form.currency} value={form.configuration.accountConnectionId} onCurrencyChange={selectedDraft ? undefined : currency => setForm(current => ({ ...current, currency }))} onChange={accountConnectionId => setForm(current => ({ ...current, configuration: { ...current.configuration, accountConnectionId, ...(current.configuration.accountConnectionId !== accountConnectionId ? { metaMessage: undefined } : {}), ...(current.configuration.metaTargeting && current.configuration.accountConnectionId !== accountConnectionId ? { metaTargeting: { ...current.configuration.metaTargeting, customAudiences: [] } } : {}) } }))}/>;
  return (
    <div className={`ads-workspace${isCreativePage ? ' ads-creative-workspace' : ''}`}>
      <main className="ads-main">
        <Tabs className="ads-workspace-tabs" aria-label="投放管理功能区" activeKey={isCreativePage ? 'adsCreatives' : 'adsPlans'}
          onChange={key => { if (key === 'adsPlans' || key === 'adsCreatives') onNavigate(key); }}
          items={[{ key: 'adsPlans', label: '计划管理' }, { key: 'adsCreatives', label: '素材投放表现' }]}/>
        {isLocalForeignTradeMockEnabled() && <Alert className="mb-4" type="info" showIcon title="本地模拟 · 外贸工厂投放" description="展示中东、欧洲和拉美市场的跨平台计划与近 7 天效果，不会触发真实广告操作。" />}
        <LsPageHeader
          title={isCreativePage ? '素材投放表现' : '计划管理'}
          description={isCreativePage ? '按素材版本查看关联计划与真实广告表现。' : '查看计划、投放效果与执行回执。'}
          extra={<>
            <Button icon={<Link2 size={15} />} onClick={() => { setReturnToCreate(false); setDialog("accounts"); }}>广告账户</Button>
            <Button type="primary" icon={<Sparkles size={16} />} disabled={saving} onClick={openCreate}>智能创编</Button>
          </>}
        >
        </LsPageHeader>
        {taskLoadError && <Alert className="mb-4" type="error" showIcon title={taskLoadError} action={<Button loading={loadingTasks} onClick={taskList.retry}>重试读取计划</Button>}/>}
        {planNavigation.loading && <p role="status">正在核对所选计划…</p>}
        {planNavigation.error && <Alert className="mb-4" type="error" showIcon title={planNavigation.error} action={<Button onClick={planNavigation.retry}>重试读取所选计划</Button>}/>}
        {notice && <Alert className="mb-4" type={notice.includes('失败') ? 'error' : 'success'} showIcon title={notice} closable onClose={() => setNotice('')} />}

        {isPlanPage &&
          (planNavigation.taskId && (!selectedDraft || planNavigation.task?.id !== planNavigation.taskId || !!planNavigation.error) && !previewMode ? <p role="status">所选计划尚未读取，暂不展示其他计划详情。<Button onClick={() => setSelectedDraft(null)}>返回计划列表</Button></p> : selectedDraft ? (
            <section className="ads-task-detail">
              <button
                className="ads-text-button"
                onClick={() => setSelectedDraft(null)}
              >
                ← 返回计划列表
              </button>
              <div className="ads-task-title">
                <div>
                  <span className="ads-pill neutral">{adTaskStatusLabels[selectedDraft.status] || '状态待核对'} · 平台状态见执行回执</span>
                  <h2>{selectedDraft.name}{isForeignTradeMockId(selectedDraft.id) && <span className="ads-pill neutral">本地示例</span>}</h2>
                  {isForeignTradeMockId(selectedDraft.id) && <p>示例不计入经营报告</p>}
                  <p>
                    {selectedDraft.video} · {selectedDraft.goal} ·{" "}
                    {selectedDraft.market}
                  </p>
                </div>
                <button
                  className="ads-button"
                  disabled={selectedDraft.creationSource === 'platform_import' || selectedDraft.status !== 'draft' || executionLockedIds.has(selectedDraft.id)}
                  title={selectedDraft.status !== 'draft' || executionLockedIds.has(selectedDraft.id) ? '已有平台动作，请使用平台操作或创建新方案' : undefined}
                  onClick={() => {
                    setForm({ ...selectedDraft, configuration: { ...selectedDraft.configuration, startsAt: toLocalDateTime(selectedDraft.configuration.startsAt), endsAt: toLocalDateTime(selectedDraft.configuration.endsAt) } });
                    setStep(2);
                    setDialog("create");
                  }}
                >
                  编辑方案
                </button>
                <Button onClick={() => openBudget({ ...selectedDraft, budget: Number(selectedDraft.budget), createdAt: selectedDraft.createdAt || '', updatedAt: '' })}>预算管理</Button>
              </div>
              <div className="ads-detail-metrics">
                {[
                  [
                    "计划预算",
                    selectedDraft.creationSource === 'platform_import' && Number(selectedDraft.budget) === 0 ? '平台总预算未同步' : `${selectedDraft.currency} ${Number(selectedDraft.budget).toLocaleString()}`,
                  ],
                  ["创建来源", creationSourceLabels[selectedDraft.creationSource]],
                  ["管理方式", managementModeLabels[selectedDraft.managementMode]],
                  ["方案版本", String(selectedDraft.version || 1)],
                ].map(([label, value]) => (
                  <div className="ads-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {!previewMode && <Collapse items={[{ key: 'snapshots', label: '已保存指标历史与快照同步', children: <AdPlanMetricHistory key={selectedDraft.id} taskId={selectedDraft.id}/> }]}/>}
              {!previewMode && selectedDraft.channels.every(c => ['Facebook', 'Instagram'].includes(c)) && <MetaPlanAuditPanel taskId={selectedDraft.id} version={selectedDraft.version || 1} onData={() => setReportsOpen(true)} onCreatives={() => onNavigate('adsCreatives')}/>}
              {!previewMode && <AdTaskControls key={selectedDraft.id} task={{ ...selectedDraft, budget: Number(selectedDraft.budget), createdAt: selectedDraft.createdAt || '', updatedAt: '' }} onUpdate={replaceTask} onExecution={() => setExecutionLockedIds(ids => new Set(ids).add(selectedDraft.id))} />}
              <button className="ads-text-button" onClick={() => onNavigate('digitalEmployees')}>返回智能经营</button>
              <div className="ads-overview-grid">
                <section className="ads-card">
                  <div className="ads-section-title">
                    <h2>平台计划</h2>
                    <span className="ads-muted">
                      {selectedDraft.channels.length} 个配置渠道
                    </span>
                  </div>
                  {selectedDraft.channels.map((name) => (
                    <div className="ads-channel-row" key={name}>
                      <span className="ads-channel-logo"><PlatformLogoGroup value={name}/></span>
                      <div>
                        <strong className="sr-only">{name}</strong>
                        <small>平台资源与状态请查看执行记录</small>
                      </div>
                      <span className="ads-pill neutral">方案渠道</span>
                    </div>
                  ))}
                </section>
                <section className="ads-card ads-next-actions">
                  <div className="ads-section-title">
                    <h2>下一步</h2>
                  </div>
                  <button onClick={openCreativeTab}>
                    <Layers3 size={17} />
                    <span>
                      <strong>检查视频素材</strong>
                      <small>查看平台适配与素材诊断</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  <button onClick={() => setManagedOpen(true)}>
                    <Bot size={17} />
                    <span>
                      <strong>了解 AI 建议</strong>
                      <small>按计划选择建议、审批或授权托管</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                </section>
              </div>
            </section>
          ) : (
            <AdPlanManagement tasks={drafts.map(d => ({ ...d, budget: Number(d.budget), createdAt: d.createdAt || '', updatedAt: '' }))} loading={loadingTasks} error={taskLoadError} onOpen={openTask} onUpdate={replaceTask} onOpenAccounts={() => { setReturnToCreate(false); setDialog('accounts'); }} previewMode={previewMode} onAI={id => { openTask(id); setManagedOpen(true); }}/>
          ))}

        {isCreativePage && (
          <AdMaterialPerformance onClearTask={() => setSelectedDraft(null)} onOpenTask={openTask} onCreate={materialSource => { openCreate(); setForm(current => ({ ...current, video: materialSource.name.slice(0, 120), configuration: { ...current.configuration, materialSource } })); }} initialTaskId={planNavigation.taskId || selectedDraft?.id} />
        )}

        {budgetTask && <AdPlanBudgetDialog key={budgetTask.id} task={budgetTask} onClose={() => setBudgetTask(null)} onUpdate={task => { replaceTask(task); setBudgetTask(task); }}/>}
        <Drawer title="计划投放效果" placement="right" size={1080} open={reportsOpen} onClose={() => setReportsOpen(false)} destroyOnHidden>
          {reportsOpen && (!previewMode ? <AdPerformanceOverview initialTaskId={planNavigation.taskId || selectedDraft?.id} tasks={drafts} loading={loadingTasks} onOpen={id => { setReportsOpen(false); openTask(id); }} /> : <PlatformAdsPerformancePreview channels={channels} onOpenAccounts={() => setDialog('accounts')} onOpenManaged={() => setManagedOpen(true)} />)}
        </Drawer>
        <Drawer title="AI 投手" placement="right" size={720} open={managedOpen} onClose={() => setManagedOpen(false)} destroyOnHidden={false}>
          {managedOpen && (!previewMode ? <AdManagedWorkspace selectedTaskId={selectedDraft?.id} tasks={managedTasks} loading={loadingTasks} onUpdate={replaceTask} onPlans={() => { setManagedOpen(false); onNavigate('adsPlans'); }} /> : <PlatformAdsManagedPreview mode={mode} onModeChange={setMode} />)}
        </Drawer>
        {!isCreativePage && <footer className="ads-footer">
          <ShieldCheck size={13} />{" "}
          {previewMode
            ? "当前为独立界面预览，没有真实观看、消耗或自动执行；草稿只保留在当前页面会话。"
            : "计划创建来源与管理方式独立；真实平台状态、消耗及执行结果以服务回执为准。"}
        </footer>}
      </main>

      <Modal open={dialog !== null} title={dialog === 'accounts' ? '广告账户' : selectedDraft ? '编辑投放计划' : entry === 'manual' ? '手动创建投放计划' : 'AI 创编投放计划'}
        width={dialog === 'accounts' ? 640 : 1120} footer={null} onCancel={closeDialog}
        closable={!saving} keyboard={!saving && !materialPickerOpen && !referenceOverlayOpen} mask={{ closable: false }}
        className="ads-plan-dialog" styles={{ body: { maxHeight: '76vh', overflowY: 'auto' } }}>
        {dialog === 'accounts' && notice.includes('失败') && <Alert type="error" showIcon title={notice} className="mb-4"/>}
            {dialog === "accounts" ? (
              !previewMode ? <AdAccountConnections initialProvider={(returnToCreate ? form.channels.includes('TikTok') : selected === 'TikTok') ? 'tiktok' : (returnToCreate ? form.channels.includes('YouTube') : selected === 'YouTube') ? 'google' : 'meta'} continueLabel={returnToCreate ? '返回并继续创建' : '继续创建投放计划'} onContinue={continueAfterConnection} onTaskImported={task => { setReturnToCreate(false); setDrafts(items => [taskToDraft(task), ...items.filter(item => item.id !== task.id)]); setSelectedDraft(taskToDraft(task)); setDialog(null); onNavigate('adsPlans'); }} /> : <>
                <p className="ads-muted">
                  四个渠道，通过三套广告系统连接。社媒发布授权与广告管理授权需分别确认。
                </p>
                {[
                  { title: "Meta Ads", subtitle: "Facebook · Instagram" },
                  { title: "TikTok for Business", subtitle: "TikTok" },
                  { title: "Google Ads", subtitle: "YouTube" },
                ].map((c) => (
                  <div className="ads-account-option" key={c.title}>
                    <Link2 size={20} />
                    <div>
                      <strong>{c.title}</strong>
                      <small>{c.subtitle}</small>
                    </div>
                    <span className="ads-pill neutral">待接入</span>
                  </div>
                ))}
                <div className="ads-context-banner">
                  <CircleHelp size={18} />
                  <p>
                    广告授权接口尚未接入，当前不会跳转授权或读取真实账户。你可以先体验计划草稿流程。
                  </p>
                </div>
                <button className="ads-button primary" onClick={openCreate}>
                  先创建一份草稿 <ArrowRight size={15} />
                </button>
              </>
            ) : conversationCreate && !previewMode ? (
              <div className="ads-create-layout"><AdPlanConversationCreate value={form} onChange={setForm}
                onBusy={busy => { savingRef.current = busy; setSaving(busy); }} onManual={() => { setConversationCreate(false); setEntry('manual'); }}
                onSaved={task => setDrafts(items => [taskToDraft(task), ...items.filter(item => item.id !== task.id)])}
                onDone={(task, queued) => { setSelectedDraft(taskToDraft(task)); setDialog(null); setConversationCreate(false); onNavigate('adsPlans'); setNotice(queued ? '计划已保存并加入执行队列，请在计划管理查看真实执行状态。' : '计划草稿已保存，尚未加入执行队列。'); }}/><AdGoalExamples goal={form.goal} onOverlayOpenChange={setReferenceOverlayOpen}/></div>
            ) : (
              <div className="ads-create-layout"><form onSubmit={next}>
                {!selectedDraft && <div className="ads-creation-method"><span>{entry === 'manual' ? '手动填写计划' : '默认由 AI 生成可编辑方案'}</span><Button type="link" disabled={saving} onClick={() => setEntry(entry === 'manual' ? 'ai_assisted' : 'manual')}>{entry === 'manual' ? '切换为 AI 创编' : '改为手动填写'}</Button></div>}
                {!previewMode && <div className="ads-context-banner"><Link2 size={17} /><p>需要连接广告账户？当前填写内容会保留。</p><button type="button" className="ads-text-button" disabled={saving} onClick={() => { setReturnToCreate(true); setDialog('accounts'); }}>连接账户</button></div>}
                <fieldset className="ads-create-fields" disabled={saving}>
                <div className="ads-steps">
                  {["视频与目标", "渠道与预算", "预览方案"].map((s, i) => (
                    <span className={i === step ? "active" : ""} key={s}>
                      {i + 1} · {s}
                    </span>
                  ))}
                </div>
                {step === 0 && (
                  <div className="ads-form-fields">
                    {form.goal !== '获取消息会话' && accountPicker}
                    {!previewMode && <AdMaterialPicker onOpenChange={setMaterialPickerOpen} value={form.configuration.materialSource} disabled={saving} blockedReason={form.channels.every(c => ['Facebook', 'Instagram'].includes(c)) ? undefined : '当前选择器用于 Meta 视频计划，请先选择 Facebook / Instagram 渠道。'} onChange={materialSource => setForm(current => ({ ...current, video: materialSource?.name.slice(0, 120) || '', configuration: { ...current.configuration, materialSource } }))}/>}
                    <label>
                      投放视频
                      <input
                        required
                        maxLength={120}
                        value={form.video}
                        readOnly={!!form.configuration.materialSource}
                        onChange={(e) =>
                          setForm({ ...form, video: e.target.value })
                        }
                        placeholder="仅草稿规划时可填写视频名称"
                      />
                    </label>
                    <label>
                      视频投流任务名称
                      <input
                        maxLength={80}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="可选，系统按目标和市场自动命名"
                      />
                    </label>
                    <label>
                      推广目标
                      <select
                        value={form.goal}
                        onChange={(e) =>
                          setForm({ ...form, goal: e.target.value, configuration: { ...form.configuration, ...(e.target.value !== '获取消息会话' ? { metaMessage: undefined } : {}) } })
                        }
                      >
                        {PLATFORM_AD_GOALS.map(goal => <option key={goal} value={goal}>{goal}{getAdPlanCapability({ ...form, goal }).supportsCreate ? ' · 已实现创建流程' : ' · 仅草稿规划'}</option>)}
                      </select>
                    </label>
                    {META_LEAD_DESCRIPTIONS[form.goal] ? <Alert type="info" showIcon title={form.goal} description={META_LEAD_DESCRIPTIONS[form.goal]}/> : null}
                    <AdCountrySelect value={form.configuration.countries || []} onChange={countries => setForm(current => ({ ...current, configuration: { ...current.configuration, countries } }))}/>
                    {form.goal === '获取消息会话' && <AdDraftMessageChannels accountPicker={accountPicker} key={form.configuration.accountConnectionId || 'no-account'} connectionId={form.configuration.accountConnectionId} value={form.configuration.metaMessage} onChange={metaMessage => setForm(current => ({ ...current, configuration: { ...current.configuration, metaMessage } }))} onAuthorize={() => { setReturnToCreate(true); setDialog('accounts'); }}/>}
                  </div>
                )}
                {step === 1 && (
                  <div className="ads-form-fields">
                    <label>投放渠道</label>
                    <div className="ads-channel-picks">
                      {channels.map((c) => (
                        <label key={c.name}>
                          <input
                            type="checkbox"
                            checked={form.channels.includes(c.name)}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                channels: e.target.checked
                                  ? [...form.channels, c.name]
                                  : form.channels.filter((n) => n !== c.name),
                              })
                            }
                          />
                          <PlatformLogoGroup value={c.name} size={22}/><span className="sr-only">{c.name}</span>
                        </label>
                      ))}
                    </div>
                    <label>预算币种<select aria-label="预算币种" disabled={!!selectedDraft} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value as PlatformAdTask['currency'] })}><option value="USD">USD · 美元</option><option value="CNY">CNY · 人民币</option></select></label>
                    <p className="ads-muted">预算币种必须与广告账户一致；切换币种不会自动换算已填写金额。CNY 当前仅支持 Meta（Facebook / Instagram）。已保存方案更换币种需新建方案。</p>
                    <label>
                      计划总预算上限（{form.currency}）
                      <input
                        required
                        type="number"
                        min="1"
                        max="1000000"
                        step="0.01"
                        value={form.budget}
                        onChange={(e) =>
                          setForm({ ...form, budget: e.target.value })
                        }
                        placeholder="输入预算金额"
                      />
                    </label>
                    <label>广告文案<textarea maxLength={2000} value={form.configuration.adMessage || ''} onChange={e => setForm(current => ({ ...current, configuration: { ...current.configuration, adMessage: e.target.value } }))} placeholder="确认产品承诺与目标市场语言；保存后直接带入创建，不再重复填写"/></label>
                    {metaNeedsWebsite(form.goal) && <label>{form.goal === '获取独立站询盘' ? '询盘页面' : '推广网站'}<input type="url" pattern="https://.*" value={form.configuration.landingPageUrl || ''} onChange={e => setForm(current => ({ ...current, configuration: { ...current.configuration, landingPageUrl: e.target.value } }))} placeholder="https:// 你的企业页面"/></label>}
                    {form.channels.length > 0 && form.channels.every(c => ['Facebook', 'Instagram'].includes(c)) && <MetaTargetingFields value={form.configuration.metaTargeting} connectionId={form.configuration.accountConnectionId} channels={form.channels} onChange={metaTargeting => setForm(current => ({ ...current, configuration: { ...current.configuration, metaTargeting } }))}/>}

                    <label>日预算（{form.currency}，可选）<input type="number" min="1" max={Number(form.budget) || 1000000} step="0.01" value={form.configuration.dailyBudget ?? ''} onChange={e => setForm({ ...form, configuration: { ...form.configuration, dailyBudget: e.target.value === '' ? null : Number(e.target.value) } })} /></label>
                    <label>开始时间<input type="datetime-local" value={form.configuration.startsAt} onChange={e => setForm({ ...form, configuration: { ...form.configuration, startsAt: e.target.value } })} /></label>
                    <p className="ads-muted">排期使用当前时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}，保存时转换为统一时间。</p>
                    <label>结束时间<input type="datetime-local" min={form.configuration.startsAt} value={form.configuration.endsAt} onChange={e => setForm({ ...form, configuration: { ...form.configuration, endsAt: e.target.value } })} /></label>
                    <p className="ads-muted">
                      预算用于草稿讨论，尚未分配到平台账户。正式创编还需确认视频版本、广告账户、受众和投放时间。
                    </p>
                  </div>
                )}
                {step === 2 && (
                  <div className="ads-review">
                    <h3>{form.name}</h3>
                    {[
                      ["推广目标", form.goal],
                      ["投放视频", form.video],
                      ...(form.goal === '获取消息会话' ? [["聊天渠道", form.configuration.metaMessage?.destination === 'WHATSAPP' ? `WhatsApp · ${form.configuration.metaMessage.recipientId}` : form.configuration.metaMessage?.destination === 'INSTAGRAM_DIRECT' ? 'Instagram 私信（已关联专业账户）' : form.configuration.metaMessage?.destination === 'MESSENGER' ? 'Messenger · 所选 Facebook 主页' : '尚未确认；创建广告前需选择']] : []),
                      ["投放国家或地区", (form.configuration.countries || []).map(adCountryName).join('、') || '尚未确认，创建前需补充'],
                      ...(form.channels.every(c => ['Facebook', 'Instagram'].includes(c)) ? [["人群与版位", `${(form.configuration.metaTargeting || emptyMetaTargeting).ageMin}—${(form.configuration.metaTargeting || emptyMetaTargeting).ageMax}${(form.configuration.metaTargeting || emptyMetaTargeting).ageMax === 65 ? '+' : ''} 岁 · ${({ all: '性别不限', male: '男性', female: '女性' })[(form.configuration.metaTargeting || emptyMetaTargeting).gender]} · ${(form.configuration.metaTargeting || emptyMetaTargeting).placementMode === 'manual' ? [...(form.configuration.metaTargeting?.facebookPositions || []), ...(form.configuration.metaTargeting?.instagramPositions || [])].join(' / ') : '所选渠道内自动版位'}`], ["语言／兴趣／受众", [...(form.configuration.metaTargeting?.locales || []), ...(form.configuration.metaTargeting?.interests || []), ...(form.configuration.metaTargeting?.customAudiences || [])].map(o => o.name).join(' / ') || '不限']] : []),
                      ["广告文案", form.configuration.adMessage || '尚未确认，创建前需补充'],
                      ...(metaNeedsWebsite(form.goal) ? [["推广页面", form.configuration.landingPageUrl || '尚未确认，创建前需补充']] : []),
                      [
                        "总预算上限",
                        `${form.currency} ${Number(form.budget).toLocaleString()}`,
                      ],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                    <div><span>投放渠道</span><strong className="inline-flex items-center gap-1.5">{form.channels.map(name => <span key={name} title={name}><PlatformLogoGroup value={name} size={20}/></span>)}</strong></div>
                    <p>
                      <CircleHelp size={15} />
                      {entry === 'manual' || selectedDraft ? '保存配置不会创建平台广告或产生消耗。' : 'AI 将根据这些信息生成可编辑的方案及依据；生成后请在任务详情检查方案并选择管理方式。生成方案不会自动启用广告。'}
                    </p>
                  </div>
                )}
                </fieldset>
                {notice.includes('失败') && <Alert type="error" showIcon title={notice} description="填写内容已保留。可以重试；也可以先手动保存配置，再继续完善方案。" action={!selectedDraft && entry !== 'manual' ? <Button disabled={saving} onClick={() => { setEntry('manual'); setNotice(''); }}>保留内容，改为手动保存</Button> : undefined}/>}
                <div className="ads-modal-footer">
                  <button
                    type="button"
                    className="ads-button"
                    disabled={saving}
                    onClick={() => (step ? setStep(step - 1) : closeDialog())}
                  >
                    {step ? "上一步" : "取消"}
                  </button>
                  <button
                    className="ads-button primary"
                    type="submit"
                    disabled={saving || (step >= 1 && (!form.channels.length || (form.currency === 'CNY' && form.channels.some(channel => !['Facebook', 'Instagram'].includes(channel)))))}
                  >
                    {saving ? "正在处理…" : step === 2 ? entry === 'manual' || selectedDraft ? "保存草稿" : '生成 AI 方案' : "下一步"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form><AdGoalExamples goal={form.goal} onOverlayOpenChange={setReferenceOverlayOpen}/></div>
            )}
      </Modal>
    </div>
  );
}
