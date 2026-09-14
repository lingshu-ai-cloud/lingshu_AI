import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Layers3,
  Link2,
  Megaphone,
  Plus,
  Target,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type { Page } from "../App";
import { useModalFocus } from "../hooks/useModalFocus";
import { platformAdsApi, type PlatformAdTask } from "../lib/platformAds";
import { emptyAdPlanConfiguration, creationSourceLabels, managementModeLabels, type AdManagement } from '../lib/platformAdsDomain';
import "./platformAds.css";
import type { AdConnection } from './AdAccountConnections';
import { AdAccountConnections, AdTaskControls, AdTaskMetrics } from './PlatformAdsOperations';
import AdPerformanceOverview from './AdPerformanceOverview';
import AdManagedWorkspace from './AdManagedWorkspace';

const channels = [
  {
    name: "Facebook",
    mark: "f",
    color: "#1877f2",
    description: "放大视频触达，积累品牌关注",
  },
  {
    name: "Instagram",
    mark: "◎",
    color: "#c94f88",
    description: "用 Reels 提升观看与互动",
  },
  {
    name: "TikTok",
    mark: "♪",
    color: "#182e2b",
    description: "通过短视频获得更多有效观看",
  },
  {
    name: "YouTube",
    mark: "▶",
    color: "#e45148",
    description: "覆盖 Shorts 与多种视频版位",
  },
];
const tabs: { id: Page; title: string }[] = [
  { id: "adsOverview", title: "投放总览" },
  { id: "adsPlans", title: "投放计划" },
  { id: "adsManaged", title: "AI 托管" },
];
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
const toLocalDateTime = (value: string) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export default function PlatformAdsPage({
  page,
  onNavigate,
  previewMode = false,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  previewMode?: boolean;
}) {
  const [dialog, setDialog] = useState<"create" | "accounts" | null>(null);
  const [returnToCreate, setReturnToCreate] = useState(false);
  const closeDialog = () => {
    if (dialog === 'accounts' && returnToCreate) { setReturnToCreate(false); setDialog('create'); }
    else setDialog(null);
  };
  const modalRef = useModalFocus<HTMLDivElement>({
    open: dialog !== null,
    onClose: closeDialog,
  });
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overviewTab, setOverviewTab] = useState<"performance" | "creatives">(
    page === "adsCreatives" ? "creatives" : "performance",
  );
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [executionLockedIds, setExecutionLockedIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState("全部渠道");
  const [mode, setMode] = useState("建议模式");
  const [notice, setNotice] = useState("");
  const [entry, setEntry] = useState<'manual' | 'ai_assisted' | 'ai_managed'>('manual');
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
  const isOverviewPage = page === "adsOverview" || page === "adsCreatives";
  const title = isOverviewPage
    ? "投放总览"
    : tabs.find((tab) => tab.id === page)?.title || "投放总览";
  useEffect(() => {
    if (page === "adsCreatives") setOverviewTab("creatives");
  }, [page]);
  const openCreativeTab = () => {
    setOverviewTab("creatives");
    onNavigate("adsOverview");
  };
  useEffect(() => {
    if (previewMode) { setLoadingTasks(false); return; }
    let active = true;
    platformAdsApi.listTasks()
      .then((items) => { if (active) setDrafts(items.map(taskToDraft)); })
      .catch((error: Error) => { if (active) setNotice(`草稿加载失败：${error.message}`); })
      .finally(() => { if (active) setLoadingTasks(false); });
    return () => { active = false; };
  }, [previewMode]);
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
  const managedTasks = useMemo(() => drafts.map(task => ({ ...task, budget: Number(task.budget), createdAt: task.createdAt || '', updatedAt: '' })), [drafts]);
  const replaceTask = (task: PlatformAdTask) => {
    setDrafts(items => items.map(item => item.id === task.id ? taskToDraft(task) : item));
    setSelectedDraft(current => current?.id === task.id ? taskToDraft(task) : current);
  };
  const openCreate = () => {
    setEntry('manual');
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
  const continueAfterConnection = (connection: AdConnection) => {
    if (returnToCreate) {
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
    }));
  };
  const next = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setSaving(true);
    try {
      if (previewMode && entry !== 'manual') throw new Error('独立预览不调用 AI；请在已登录的完整工作台生成真实方案。');
      const input = { name: form.name, video: form.video, goal: form.goal, market: form.market, budget: form.budget, currency: form.currency, channels: form.channels, configuration: { ...form.configuration, startsAt: form.configuration.startsAt ? new Date(form.configuration.startsAt).toISOString() : '', endsAt: form.configuration.endsAt ? new Date(form.configuration.endsAt).toISOString() : '' } };
      const task = previewMode
        ? ({ ...input, creationSource: selectedDraft?.creationSource || 'manual', managementMode: 'manual', id: selectedDraft?.id || crypto.randomUUID(), budget: Number(form.budget), status: 'draft', createdAt: selectedDraft?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() } as PlatformAdTask)
        : selectedDraft
        ? await platformAdsApi.updateTask(selectedDraft.id, { ...input, expectedVersion: selectedDraft.version })
        : entry === 'manual' ? await platformAdsApi.createTask(input)
        : await platformAdsApi.generatePlan({ ...input, entry });
      setDrafts((items) => selectedDraft
        ? items.map(item => item.id === task.id ? taskToDraft(task) : item)
        : [taskToDraft(task), ...items]);
      setSelectedDraft(selectedDraft ? taskToDraft(task) : null);
      setDialog(null);
      onNavigate("adsPlans");
      setNotice(previewMode
        ? "预览草稿已保存在当前页面会话中，刷新后会清空。"
        : `${selectedDraft ? "方案已更新" : "方案已保存"}；本次保存不会执行平台操作，可在任务详情继续创编与管理。`);
    } catch (error) {
      setNotice(`草稿保存失败：${error instanceof Error ? error.message : "请稍后重试"}`);
    } finally {
      setSaving(false);
    }
  };
  const filtered = drafts.filter(
    (draft) => selected === "全部渠道" || draft.channels.includes(selected),
  );

  return (
    <div className="ads-workspace">
      <header className="ads-topbar">
        <div className="ads-topbar-title">
          <span className="ads-topbar-icon" aria-hidden="true">
            <Megaphone size={13} />
          </span>
          <h1>{title}</h1>
        </div>
      </header>
      <main className="ads-main">
        <div className={isOverviewPage ? "ads-overview-toolbar" : "ads-page-toolbar"}>
          {isOverviewPage && (
            <nav className="ads-overview-tabs" aria-label="投放总览视图">
              <button
                type="button"
                className={overviewTab === "performance" ? "active" : ""}
                aria-current={overviewTab === "performance" ? "page" : undefined}
                onClick={() => setOverviewTab("performance")}
              >
                <BarChart3 size={16} />整体表现
              </button>
              <button
                type="button"
                className={overviewTab === "creatives" ? "active" : ""}
                aria-current={overviewTab === "creatives" ? "page" : undefined}
                onClick={() => setOverviewTab("creatives")}
              >
                <Layers3 size={16} />素材效果
              </button>
            </nav>
          )}
          <div className="ads-actions">
            <button
              className="ads-button"
              onClick={() => setDialog("accounts")}
            >
              <Link2 size={15} />
              连接广告账户
            </button>
            {page !== 'adsManaged' && <><button className="ads-button primary" onClick={openCreate}>
              <Plus size={16} />
              手动创建投放
            </button>
            <button className="ads-button" onClick={() => { openCreate(); setEntry('ai_assisted'); }}><Sparkles size={16} />AI 辅助创编</button>
            <button className="ads-button" onClick={() => { openCreate(); setEntry('ai_managed'); }}><Bot size={16} />AI 托管创编</button></>}
            {page === 'adsManaged' && <button className="ads-button" onClick={() => onNavigate('adsPlans')}>管理投放计划</button>}
          </div>
        </div>
        {notice && (
          <div className="ads-notice" role="status">
            <Check size={16} />
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {isOverviewPage && overviewTab === 'performance' && !previewMode && <AdPerformanceOverview tasks={drafts} loading={loadingTasks} onOpen={id => { const task = drafts.find(item => item.id === id); if (task) { setSelectedDraft(task); onNavigate('adsPlans'); } }} />}
        {isOverviewPage && overviewTab === "performance" && previewMode && (
          <>
            <section className="ads-goal-bar">
              <div className="ads-goal-icon">
                <Target size={18} />
              </div>
              <div>
                <span>当前优化目标</span>
                <strong>有效视频观看</strong>
                <small>以合理观看成本，让更多目标用户真正看到内容</small>
              </div>
              <div className="ads-inline">
                <span className="ads-pill neutral">目标待配置</span>
                <select aria-label="表现日期范围">
                  <option>近 7 天</option>
                  <option>近 30 天</option>
                  <option>今天</option>
                </select>
              </div>
            </section>
            <div className="ads-north-star-note">
              <div>
                <Sparkles size={15} />
                <span>默认北极星指标</span>
                <strong>目标成本内的有效视频观看量</strong>
              </div>
              <p>
                各平台观看定义不同，统一用于决策时保留 TikTok、Meta 与 YouTube
                的原始观看口径。
              </p>
            </div>
            <div className="ads-metrics ads-metrics-north-star">
              {[
                {
                  title: "有效视频观看",
                  sub: "平台有效观看 · 尚未接入",
                  icon: Megaphone,
                  tone: "primary",
                },
                {
                  title: "单次有效观看成本",
                  sub: "实际 CPV / 目标 CPV",
                  icon: BarChart3,
                },
                {
                  title: "有效观看率",
                  sub: "有效观看 / 视频展示",
                  icon: BarChart3,
                },
                {
                  title: "广告消耗",
                  sub: "实际消耗 / 计划预算",
                  icon: Wallet,
                },
                {
                  title: "预算进度",
                  sub: "时间进度 / 消耗进度",
                  icon: Clock3,
                },
              ].map(({ title: t, sub, icon: Icon, tone }) => (
                <section
                  className={`ads-card ads-metric ${tone ? `ads-metric-${tone}` : ""}`}
                  key={t}
                >
                  <div>
                    {t}
                    <Icon size={17} />
                  </div>
                  <strong>—</strong>
                  <small>{sub}</small>
                </section>
              ))}
            </div>
            <section className="ads-hero ads-hero-compact">
              <div className="ads-hero-copy">
                <span className="ads-pill">
                  <Sparkles size={13} />
                  完成数据准备
                </span>
                <h2>连接账户，开始衡量视频放量效果。</h2>
                <p>
                  同步视频计划、有效观看、消耗与互动数据，灵枢才能判断放量效率并给出素材建议。
                </p>
                <button onClick={() => setDialog("accounts")}>
                  开始连接账户 <ArrowRight size={16} />
                </button>
              </div>
              <div className="ads-readiness">
                {[
                  ["1", "广告账户", "Meta · TikTok · Google"],
                  ["2", "视频与主页", "确认投放身份和素材"],
                  ["3", "观看成本目标", "用于判断放量效率"],
                ].map(([n, t, d]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <p>
                      <strong>{t}</strong>
                      <small>{d}</small>
                    </p>
                  </div>
                ))}
              </div>
            </section>
            <div className="ads-overview-grid">
              <section className="ads-card">
                <div className="ads-section-title">
                  <h2>
                    投放渠道 <span className="ads-count">0 / 4</span>
                  </h2>
                  <button
                    className="ads-text-button"
                    onClick={() => setDialog("accounts")}
                  >
                    管理连接 <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className="ads-channel-list">
                  {channels.map((c) => (
                    <div className="ads-channel-row" key={c.name}>
                      <span
                        className="ads-channel-logo"
                        style={{ color: c.color }}
                      >
                        {c.mark}
                      </span>
                      <div>
                        <strong>{c.name}</strong>
                        <small>{c.description}</small>
                      </div>
                      <span className="ads-muted">未连接</span>
                      <button
                        className="ads-button small"
                        onClick={() => setDialog("accounts")}
                      >
                        连接
                      </button>
                    </div>
                  ))}
                </div>
                <div className="ads-footnote">
                  <CircleHelp size={14} />
                  Facebook 与 Instagram 使用 Meta 广告账户，可统一连接。
                </div>
              </section>
              <section className="ads-card ads-assistant">
                <div className="ads-section-title">
                  <h2>
                    <Sparkles size={18} />
                    AI 优化建议
                  </h2>
                  <span className="ads-pill neutral">等待数据</span>
                </div>
                <div className="ads-assistant-symbol">
                  <Bot size={32} />
                </div>
                <h3>先连接，再发现增长机会</h3>
                <p>
                  有了真实投放数据，AI
                  才能为你分析预算节奏、观看质量和视频素材表现。
                </p>
                <div className="ads-check-item">
                  <Check size={14} />
                  每条建议附带数据依据
                </div>
                <div className="ads-check-item">
                  <Check size={14} />
                  关键调整由你确认
                </div>
                <button
                  className="ads-text-button"
                  onClick={() => onNavigate("adsManaged")}
                >
                  了解 AI 托管 <ArrowRight size={15} />
                </button>
              </section>
            </div>
            <section className="ads-start">
              <div>
                <h2>三步，开启第一轮投放</h2>
                <p>从已有内容出发，让创作与投放形成闭环。</p>
              </div>
              {[
                ["01", "连接账户", "授权渠道与投放身份"],
                ["02", "创建计划", "选择目标、素材和预算"],
                ["03", "持续优化", "看数、获得建议、迭代内容"],
              ].map(([n, t, d]) => (
                <div className="ads-start-step" key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <small>{d}</small>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}

        {page === "adsPlans" &&
          (selectedDraft ? (
            <section className="ads-task-detail">
              <button
                className="ads-text-button"
                onClick={() => setSelectedDraft(null)}
              >
                ← 返回营销任务
              </button>
              <div className="ads-task-title">
                <div>
                  <span className="ads-pill neutral">方案已保存 · 平台状态见执行回执</span>
                  <h2>{selectedDraft.name}</h2>
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
                      <span
                        className="ads-channel-logo"
                        style={{
                          color: channels.find(
                            (channel) => channel.name === name,
                          )?.color,
                        }}
                      >
                        {
                          channels.find((channel) => channel.name === name)
                            ?.mark
                        }
                      </span>
                      <div>
                        <strong>{name}</strong>
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
                  <button onClick={() => onNavigate("adsManaged")}>
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
            <section className="ads-card">
              <div className="ads-section-title">
                <div>
                  <h2>
                    营销任务{" "}
                    <span className="ads-count">{filtered.length}</span>
                  </h2>
                  <p className="ads-muted">
                    一份营销任务，关联多个渠道的投放计划。
                  </p>
                </div>
                <select
                  aria-label="筛选渠道"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {["全部渠道", ...channels.map((c) => c.name)].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              {loadingTasks ? (
                <div className="ads-empty" role="status"><Clock3 size={30} /><h3>正在加载投放草稿</h3></div>
              ) : filtered.length ? (
                <div className="ads-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>营销任务</th>
                        <th>渠道</th>
                        <th>目标市场</th>
                        <th>预算上限</th>
                        <th>状态</th>
                        <th>创建来源 / 管理方式</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((d) => (
                        <tr key={d.id}>
                          <td>
                            <strong>{d.name}</strong>
                            <small>
                              {d.video} · {d.goal}
                            </small>
                          </td>
                          <td>{d.channels.join(" / ")}</td>
                          <td>{d.market}</td>
                          <td>{d.creationSource === 'platform_import' && Number(d.budget) === 0 ? '平台总预算未同步' : `${d.currency} ${Number(d.budget).toLocaleString()}`}</td>
                          <td>
                            <span className="ads-pill neutral">方案已保存</span>
                          </td>
                          <td>{creationSourceLabels[d.creationSource || 'manual']}<small>{managementModeLabels[d.managementMode || 'manual']}</small></td>
                          <td>
                            <button
                              className="ads-text-button"
                              onClick={() => setSelectedDraft(d)}
                            >
                              查看任务
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ads-empty">
                  <FileText size={38} />
                  <h3>
                    {drafts.length
                      ? "该渠道暂无计划"
                      : "创建你的第一份视频投流计划"}
                  </h3>
                  <p>
                    选择视频、推广目标、渠道与预算，先准备一份可审阅的草稿。
                  </p>
                  <button className="ads-button primary" onClick={openCreate}>
                    <Plus size={15} />
                    创建投放
                  </button>
                </div>
              )}
            </section>
          ))}

        {isOverviewPage && overviewTab === "creatives" && (
          <>
            <div className="ads-context-banner">
              <Layers3 size={22} />
              <div>
                <strong>把投放结果，带回内容创作</strong>
                <p>关联素材版本与广告计划，发现值得继续测试的创意。</p>
              </div>
            </div>
            <div className="ads-creative-actions">
              <button
                className="ads-card"
                onClick={() => onNavigate("adsPlans")}
              >
                <BarChart3 size={21} />
                <span>
                  <strong>继续放量</strong>
                  <small>回到投放计划调整视频预算</small>
                </span>
                <ArrowRight size={15} />
              </button>
              <button className="ads-card" onClick={openCreate}>
                <Plus size={21} />
                <span>
                  <strong>创建素材测试</strong>
                  <small>用新渠道、受众或版本验证表现</small>
                </span>
                <ArrowRight size={15} />
              </button>
              <button
                className="ads-card"
                onClick={() => onNavigate("smartAssets")}
              >
                <Sparkles size={21} />
                <span>
                  <strong>生成视频改版</strong>
                  <small>带着诊断结果回到内容创作</small>
                </span>
                <ArrowRight size={15} />
              </button>
            </div>
            <section className="ads-card ads-empty">
              <Layers3 size={40} />
              <h3>还没有关联投放的素材</h3>
              <p>
                广告素材及效果接口尚未接入。接入后，这里将按渠道展示素材表现，
                <br />
                并支持将优化建议转为内容改版任务。
              </p>
              <button
                className="ads-button"
                onClick={() => onNavigate("smartAssets")}
              >
                前往内容创作 <ArrowRight size={15} />
              </button>
            </section>
          </>
        )}

        {page === 'adsManaged' && !previewMode && <AdManagedWorkspace selectedTaskId={selectedDraft?.id} tasks={managedTasks} loading={loadingTasks} onUpdate={replaceTask} onPlans={() => onNavigate('adsPlans')} />}
        {page === "adsManaged" && previewMode && (
          <>
            <section className="ads-managed-hero">
              <span className="ads-pill">
                <Bot size={14} />
                你的数字投流员工
              </span>
              <h2>你定目标和边界，AI 持续关注投放。</h2>
              <p>从建议开始，逐步授权。每一次预算调整，都有依据、有记录。</p>
            </section>
            <div className="ads-autonomy-path" aria-label="AI 托管启用路径">
              {[
                ["1", "数据就绪", "连接账户并积累样本"],
                ["2", "建议模式", "AI 只分析不执行"],
                ["3", "审批模式", "用户确认后执行"],
                ["4", "有限托管", "仅在授权范围内执行"],
              ].map(([n, label, desc], index) => (
                <div key={n} className={index === 0 ? "current" : ""}>
                  <span>{n}</span>
                  <p>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </p>
                </div>
              ))}
            </div>
            <div className="ads-mode-grid">
              {[
                {
                  name: "建议模式",
                  label: "先了解，再决策",
                  desc: "AI 分析表现、提出优化方案，由你决定如何操作。",
                  icon: Sparkles,
                },
                {
                  name: "审批模式",
                  label: "你确认，AI 执行",
                  desc: "每项调整先展示影响范围，批准后才交给平台执行。",
                  icon: ShieldCheck,
                },
                {
                  name: "托管模式",
                  label: "在授权范围内执行",
                  desc: "按预算上限和允许动作持续优化，越界时请求审批。",
                  icon: Bot,
                },
              ].map(({ name, label, desc, icon: Icon }) => (
                <button
                  className={`ads-card ads-mode ${mode === name ? "selected" : ""}`}
                  key={name}
                  onClick={() => setMode(name)}
                  aria-pressed={mode === name}
                >
                  <div>
                    <Icon size={23} />
                    <span className="ads-radio">
                      {mode === name && <Check size={12} />}
                    </span>
                  </div>
                  <h3>{name}</h3>
                  <strong>{label}</strong>
                  <p>{desc}</p>
                </button>
              ))}
            </div>
            <section className="ads-card ads-guardrails">
              <div className="ads-section-title">
                <h2>
                  <ShieldCheck size={18} />
                  {mode} · 运行边界
                </h2>
                <span className="ads-pill neutral">尚未启用</span>
              </div>
              <div className="ads-guard-grid">
                {[
                  ["预算控制", "总额与日限额、币种、单次调整幅度"],
                  ["操作权限", "指定账户、允许动作与授权有效期"],
                  ["观察与审批", "样本要求、观察期和越界审批"],
                  ["执行可追溯", "调整原因、前后值与平台执行结果"],
                ].map(([t, d]) => (
                  <div key={t}>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
              <div className="ads-footnote">
                <Clock3 size={15} />
                当前仅预览模式说明；账户、预算规则和执行服务接入后才能启用托管。
              </div>
            </section>
            <div className="ads-managed-grid">
              <section className="ads-card">
                <div className="ads-section-title">
                  <h2>待审批</h2>
                  <span className="ads-count">0</span>
                </div>
                <div className="ads-mini-empty">
                  <ShieldCheck size={24} />
                  <strong>暂无待审批动作</strong>
                  <p>
                    建议达到执行条件后，会显示原因、影响对象、修改前后值和有效期。
                  </p>
                </div>
              </section>
              <section className="ads-card">
                <div className="ads-section-title">
                  <h2>执行记录</h2>
                  <button className="ads-text-button">查看全部</button>
                </div>
                <div className="ads-mini-empty">
                  <Clock3 size={24} />
                  <strong>尚无执行记录</strong>
                  <p>
                    账户接入后记录发现、决策、审批、平台回执和后续观察结果。
                  </p>
                </div>
              </section>
            </div>
          </>
        )}
        <footer className="ads-footer">
          <ShieldCheck size={13} />{" "}
          {previewMode
            ? "当前为独立界面预览，没有真实观看、消耗或自动执行；草稿只保留在当前页面会话。"
            : "计划创建来源与管理方式独立；真实平台状态、消耗及执行结果以服务回执为准。"}
        </footer>
      </main>

      {dialog && (
        <div
          className="ads-overlay"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.stopPropagation(); closeDialog(); }
          }}
        >
          <div
            ref={modalRef}
            className="ads-modal"
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "accounts" ? "连接广告账户" : "创建投放"}
          >
            <div className="ads-modal-heading">
              <div>
                <span className="ads-eyebrow">PLATFORM ADS</span>
                <h2>
                  {dialog === "accounts" ? "连接广告账户" : selectedDraft ? "编辑投放计划" : entry === 'manual' ? "手动创建投放计划" : entry === 'ai_assisted' ? 'AI 辅助创编' : 'AI 托管创编'}
                </h2>
              </div>
              <button
                className="ads-icon-button"
                aria-label={returnToCreate && dialog === 'accounts' ? "返回创建投放" : "关闭弹窗"}
                onClick={closeDialog}
                autoFocus
              >
                <X size={20} />
              </button>
            </div>
            {dialog === "accounts" ? (
              !previewMode ? <AdAccountConnections initialProvider={(returnToCreate ? form.channels.includes('TikTok') : selected === 'TikTok') ? 'tiktok' : (returnToCreate ? form.channels.includes('YouTube') : selected === 'YouTube') ? 'google' : 'meta'} continueLabel={returnToCreate ? '返回并继续创建' : '继续创建投放计划'} onContinue={continueAfterConnection} onTaskImported={task => { setDrafts(items => [taskToDraft(task), ...items.filter(item => item.id !== task.id)]); setSelectedDraft(taskToDraft(task)); setDialog(null); onNavigate('adsPlans'); }} /> : <>
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
            ) : (
              <form onSubmit={next}>
                {!previewMode && <div className="ads-context-banner"><Link2 size={17} /><p>需要连接广告账户？当前填写内容会保留。</p><button type="button" className="ads-text-button" disabled={saving} onClick={() => { setReturnToCreate(true); setDialog('accounts'); }}>连接账户</button></div>}
                <div className="ads-steps">
                  {["视频与目标", "渠道与预算", "预览方案"].map((s, i) => (
                    <span className={i === step ? "active" : ""} key={s}>
                      {i + 1} · {s}
                    </span>
                  ))}
                </div>
                {step === 0 && (
                  <div className="ads-form-fields">
                    <label>
                      投放视频
                      <input
                        required
                        maxLength={120}
                        value={form.video}
                        onChange={(e) =>
                          setForm({ ...form, video: e.target.value })
                        }
                        placeholder="输入视频名称或素材编号"
                      />
                    </label>
                    <label>
                      视频投流任务名称
                      <input
                        required
                        maxLength={80}
                        value={form.name}
                        onChange={(e) =>
                          setForm({ ...form, name: e.target.value })
                        }
                        placeholder="例如：秋季新品视频 · 美国放量"
                      />
                    </label>
                    <label>
                      推广目标
                      <select
                        value={form.goal}
                        onChange={(e) =>
                          setForm({ ...form, goal: e.target.value })
                        }
                      >
                        <option>提升网站访问</option>
                        <option>提升有效视频观看</option>
                        <option>提升互动与主页增长</option>
                        <option>扩大目标人群覆盖</option>
                        <option>获取线索或转化</option>
                      </select>
                    </label>
                    <label>
                      目标市场
                      <input
                        required
                        maxLength={80}
                        value={form.market}
                        onChange={(e) =>
                          setForm({ ...form, market: e.target.value })
                        }
                        placeholder="例如：美国，英语"
                      />
                    </label>
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
                          {c.name}
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
                    <label>目标人群说明<textarea value={form.configuration.audience} onChange={e => setForm({ ...form, configuration: { ...form.configuration, audience: e.target.value } })} placeholder="描述受众；发布前需转换并校验为平台支持的定向" /></label>
                    <label>版位偏好<input value={form.configuration.placements} onChange={e => setForm({ ...form, configuration: { ...form.configuration, placements: e.target.value } })} placeholder="例如 Reels、Shorts；以平台支持范围为准" /></label>
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
                      ["目标市场", form.market],
                      ["投放渠道", form.channels.join(" / ")],
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
                    <p>
                      <CircleHelp size={15} />
                      {entry === 'manual' || selectedDraft ? '保存配置不会创建平台广告或产生消耗。' : 'AI 将根据这些信息生成可编辑的方案及依据；生成后请在任务详情检查方案并选择管理方式。生成方案不会自动启用广告。'}
                    </p>
                  </div>
                )}
                <div className="ads-modal-footer">
                  <button
                    type="button"
                    className="ads-button"
                    onClick={() => (step ? setStep(step - 1) : setDialog(null))}
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
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
