import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Clapperboard,
  Eye,
  FileCheck2,
  Lightbulb,
  PackageCheck,
  PauseCircle,
  ReceiptText,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Page } from '../../App';
import type {
  StarterAgentRole,
  StarterProductionSiteId,
  StarterWorkspace,
} from '../../lib/starterWorkspace';

type WorkflowNodeId = 'orchestrate' | 'director' | 'content' | 'human' | 'traffic' | 'sales' | 'summary';
type WorkflowNodeState = 'active' | 'waiting_user' | 'completed' | 'blocked' | 'paused' | 'idle' | 'optional' | 'unknown';

interface WorkflowSpotlight {
  currentTitle: string;
  currentDetail: string;
  nextTitle: string;
  nextDetail: string;
  currentNodeIds: WorkflowNodeId[];
}

interface WorkflowNode {
  id: WorkflowNodeId;
  eyebrow: string;
  title: string;
  description: string;
  state: WorkflowNodeState;
  icon: LucideIcon;
  links: Array<{ label: string; target: StarterProductionSiteId | 'decisions' | 'results' }>;
}

const SITE_PAGE: Record<StarterProductionSiteId, Page> = {
  inspiration: 'socialInspiration',
  content: 'smartAssets',
  traffic: 'traffic',
  sales: 'conversion',
};

const ROLE_NAME: Record<StarterAgentRole, string> = {
  orchestrator: '灵小枢',
  content: '灵小图',
  traffic: '灵小量',
  sales: '灵小售',
};

const ROLE_NODE: Record<StarterAgentRole, WorkflowNodeId> = {
  orchestrator: 'orchestrate',
  content: 'content',
  traffic: 'traffic',
  sales: 'sales',
};

const STATE_META: Record<WorkflowNodeState, { label: string; badge: string; border: string }> = {
  active: { label: '运行中', badge: 'bg-emerald-50 text-emerald-800', border: 'border-emerald-300' },
  waiting_user: { label: '等你处理', badge: 'bg-amber-50 text-amber-900', border: 'border-amber-300' },
  completed: { label: '本轮已结束', badge: 'bg-blue-50 text-blue-800', border: 'border-blue-200' },
  blocked: { label: '需要处理', badge: 'bg-red-50 text-red-800', border: 'border-red-200' },
  paused: { label: '已暂停', badge: 'bg-slate-100 text-slate-700', border: 'border-slate-300' },
  idle: { label: '等待前序', badge: 'bg-surface-2 text-text-muted', border: 'border-border' },
  optional: { label: '按需出现', badge: 'bg-violet-50 text-violet-800', border: 'border-violet-200' },
  unknown: { label: '待同步', badge: 'bg-surface-2 text-text-muted', border: 'border-border' },
};

function agentNodeState(workspace: StarterWorkspace, role: StarterAgentRole): WorkflowNodeState {
  const status = workspace.agents.find(agent => agent.role === role)?.status ?? 'unknown';
  if (status === 'running') return 'active';
  if (status === 'waiting_user') return 'waiting_user';
  if (status === 'completed') return 'completed';
  if (status === 'blocked' || status === 'error') return 'blocked';
  if (status === 'paused') return 'paused';
  if (status === 'idle') return 'idle';
  return 'unknown';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function decisionNextDetail(workspace: StarterWorkspace): string {
  const decision = workspace.decisions[0];
  if (!decision) return '处理完成后，灵小枢会继续安排后续工作。';
  if (decision.type === 'content_release_approval') {
    return '确认冻结内容后，灵小量才会生成发布包；这不会授权平台自动发布。';
  }
  if (decision.type === 'quotation') {
    return '确认报价后仍不会自动发给客户；灵小枢只汇总已经留存的发送证据。';
  }
  return '处理完成后，灵小枢会继续安排后续工作。';
}

/**
 * Uses only the sanitized workspace projection. It never guesses task progress
 * from elapsed time, page visits or a client-side workflow simulation.
 */
export function deriveStarterWorkflowSpotlight(workspace: StarterWorkspace): WorkflowSpotlight {
  const runStatus = workspace.run.status;
  const inProgress = workspace.today.inProgress;
  const pendingDecision = workspace.decisions[0] ?? null;
  const actionableArtifact = workspace.results.artifacts.find(artifact => (
    artifact.actions.some(action => action.kind === 'primary' && !action.disabledReason)
  )) ?? null;
  const artifactAction = actionableArtifact?.actions.find(action => action.kind === 'primary' && !action.disabledReason) ?? null;

  if (runStatus === 'error') {
    return {
      currentTitle: '工作流出现异常',
      currentDetail: '当前快照没有把异常节点当成已完成，请在下方“正在进行／阻塞”查看已回流信息。',
      nextTitle: '等待异常被核对后再继续',
      nextDetail: inProgress[0]?.next || '灵小枢尚未收到可安全展示的下一节点。',
      currentNodeIds: unique(inProgress.map(item => ROLE_NODE[item.ownerAgent]).filter(Boolean)),
    };
  }
  if (runStatus === 'blocked') {
    return {
      currentTitle: '工作流停在尚未接通的能力',
      currentDetail: inProgress[0]?.what || '当前没有执行中的节点，系统不会用模拟结果补齐。',
      nextTitle: '先由交付团队接通或核对',
      nextDetail: inProgress[0]?.next || '能力恢复后，灵小枢才会继续调度后续节点。',
      currentNodeIds: unique(inProgress.map(item => ROLE_NODE[item.ownerAgent]).filter(Boolean)),
    };
  }
  if (runStatus === 'paused') {
    return {
      currentTitle: '本轮工作流已暂停',
      currentDetail: '各专业 Agent 不会在暂停期间继续推进本轮任务。',
      nextTitle: '需要时从“运行控制”恢复',
      nextDetail: '恢复后会从已保存的进度继续。',
      currentNodeIds: ['orchestrate'],
    };
  }
  if (pendingDecision || runStatus === 'waiting_user') {
    const count = workspace.decisions.length;
    return {
      currentTitle: pendingDecision
        ? `需要你处理：${pendingDecision.title}`
        : actionableArtifact ? `需要你处理：${actionableArtifact.title}` : '当前需要你的必要操作',
      currentDetail: count > 1
        ? `共有 ${count} 项待处理；其他可自动运行的节点仍由灵小枢协调。`
        : actionableArtifact?.evidence || '这里只出现无法由 Agent 代替你的确认、授权或证据回填。',
      nextTitle: pendingDecision?.type === 'content_release_approval'
        ? '下一步：灵小量准备发布包'
        : artifactAction ? `下一步：${artifactAction.label}` : '下一步由确认结果决定',
      nextDetail: pendingDecision
        ? decisionNextDetail(workspace)
        : artifactAction ? '请到“成果”处理；完成前系统不会把外部动作记为成功。' : decisionNextDetail(workspace),
      currentNodeIds: ['human'],
    };
  }
  if (runStatus === 'completed') {
    return {
      currentTitle: '本轮工作流已结束',
      currentDetail: '灵小枢只汇总已确认的成果、证据、Token 和成本。',
      nextTitle: '查看本轮成果与证据',
      nextDetail: '可从“成果”进入完整证据链，也可下钻各基础页面查看生产过程。',
      currentNodeIds: ['summary'],
    };
  }
  if (inProgress.length > 0) {
    const ownerNames = unique(inProgress.map(item => ROLE_NAME[item.ownerAgent]));
    const currentNodeIds = unique(inProgress.map(item => ROLE_NODE[item.ownerAgent]));
    const first = inProgress[0];
    const nextItem = workspace.today.nextSteps[0];
    return {
      currentTitle: `${ownerNames.join('、')}正在推进${inProgress.length > 1 ? ` ${inProgress.length} 项任务` : ''}`,
      currentDetail: first.what,
      nextTitle: first.next || nextItem?.what || '下一步正在确认',
      nextDetail: first.next
        ? '当前节点满足条件后，灵小枢会读取最新状态再决定是否继续。'
        : nextItem?.why || '没有可靠的下一节点时，页面不会推测进度。',
      currentNodeIds,
    };
  }
  if (runStatus === 'idle') {
    const nextItem = workspace.today.nextSteps[0];
    return {
      currentTitle: workspace.run.id ? '本轮尚未进入执行节点' : '还没有运行中的经营任务',
      currentDetail: nextItem?.why || '灵小枢会先确认经营目标和必要资料，再安排后续工作。',
      nextTitle: nextItem?.what || '等待你向灵小枢补充经营目标',
      nextDetail: nextItem?.next || '目标确认前，各专业 Agent 不会自行开始。',
      currentNodeIds: ['orchestrate'],
    };
  }
  return {
    currentTitle: '运行状态正在同步',
    currentDetail: '当前快照不足以判断执行节点，页面不会推测进度。',
    nextTitle: '等待下一步安排',
    nextDetail: '你可以刷新状态；已经开始的任务不会因此中断。',
    currentNodeIds: [],
  };
}

function workflowNodes(workspace: StarterWorkspace): WorkflowNode[] {
  const humanState: WorkflowNodeState = workspace.decisions.length > 0 || workspace.run.status === 'waiting_user'
    ? 'waiting_user'
    : workspace.run.status === 'completed' ? 'completed' : 'optional';
  const summaryState: WorkflowNodeState = workspace.run.status === 'completed'
    ? 'completed'
    : workspace.run.status === 'error' ? 'blocked'
      : workspace.run.status === 'paused' ? 'paused' : 'idle';
  return [
    {
      id: 'orchestrate', eyebrow: '主 Agent', title: '灵小枢统筹', icon: Bot,
      description: '理解目标，锁定事实与预算，并把任务分给各专业 Agent。',
      state: agentNodeState(workspace, 'orchestrator'), links: [],
    },
    {
      id: 'director', eyebrow: '编导 Agent', title: '编导方案', icon: Clapperboard,
      description: '从爆款参考、企业事实和真实素材中锁定脚本、口播、字幕、镜头与节奏。',
      state: agentNodeState(workspace, 'content'),
      links: [{ label: '灵感大屏', target: 'inspiration' }],
    },
    {
      id: 'content', eyebrow: '内容 Agent', title: '灵小图生产', icon: Lightbulb,
      description: '只按锁定导演方案完成素材编排、配音、字幕、配乐、渲染与技术质检。',
      state: agentNodeState(workspace, 'content'),
      links: [{ label: '内容制作', target: 'content' }],
    },
    {
      id: 'human', eyebrow: '必要检查点', title: '你只做确认', icon: UserCheck,
      description: '只处理内容放行、发布回填、报价审批等不能由 AI 代替的事项。',
      state: humanState,
      links: [
        { label: `待决策${workspace.decisions.length ? ` ${workspace.decisions.length}` : ''}`, target: 'decisions' },
        { label: '发布／发送回填', target: 'results' },
      ],
    },
    {
      id: 'traffic', eyebrow: '发布 Agent', title: '灵小量发布', icon: PackageCheck,
      description: '根据确认版本整理发布包，并等待用户回传真实发布结果。',
      state: agentNodeState(workspace, 'traffic'), links: [{ label: '投流／发布', target: 'traffic' }],
    },
    {
      id: 'sales', eyebrow: '销售 Agent', title: '灵小售报价', icon: ReceiptText,
      description: '真实询盘到达后提取关键信息，并按照已确认的报价规则生成可靠结果。',
      state: agentNodeState(workspace, 'sales'), links: [{ label: '销售／客户', target: 'sales' }],
    },
    {
      id: 'summary', eyebrow: '主 Agent 验收', title: '灵小枢汇总', icon: FileCheck2,
      description: '把可验证成果、数据缺口、Token 和成本汇总回工作台。',
      state: summaryState, links: [{ label: '成果与证据', target: 'results' }],
    },
  ];
}

function StateIcon({ state }: { state: WorkflowNodeState }) {
  if (state === 'active') return <Clock3 size={12} aria-hidden="true" />;
  if (state === 'waiting_user') return <UserCheck size={12} aria-hidden="true" />;
  if (state === 'completed') return <CheckCircle2 size={12} aria-hidden="true" />;
  if (state === 'blocked') return <AlertCircle size={12} aria-hidden="true" />;
  if (state === 'paused') return <PauseCircle size={12} aria-hidden="true" />;
  return <CircleDashed size={12} aria-hidden="true" />;
}

export default function StarterWorkflowOverview({
  workspace,
  onNavigate,
  onOpenDecisions,
  onOpenResults,
}: {
  workspace: StarterWorkspace;
  onNavigate: (page: Page) => void;
  onOpenDecisions: () => void;
  onOpenResults: () => void;
}) {
  const spotlight = deriveStarterWorkflowSpotlight(workspace);
  const nodes = workflowNodes(workspace);

  const openTarget = (target: WorkflowNode['links'][number]['target']) => {
    if (target === 'decisions') return onOpenDecisions();
    if (target === 'results') return onOpenResults();
    onNavigate(SITE_PAGE[target]);
  };

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-[0_10px_35px_rgba(23,61,49,0.06)]" aria-labelledby="starter-workflow-heading">
      <div className="border-b border-emerald-100 bg-gradient-to-r from-[#edf7f1] via-white to-[#f4f1fb] px-4 py-5 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-4xl">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-accent"><Bot size={14} aria-hidden="true" />一眼看懂 AI 怎么工作</p>
            <h2 id="starter-workflow-heading" className="mt-1.5 text-lg font-bold text-text-primary">灵小枢统筹，编导与内容 Agent 接力完成视频</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">灵小枢先拆解经营目标；编导 Agent 根据爆款参考、企业事实和真实素材锁定完整导演方案；内容 Agent 只按方案生成视频；需要内容放行等关键决定时才请你确认；发布与销售 Agent 继续承接后续工作，最后由灵小枢汇总结果。</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-emerald-800"><Eye size={12} aria-hidden="true" />基础页面保留，可随时查看过程</span>
        </div>

        <div className="mt-4 grid gap-2 lg:grid-cols-2" aria-label="当前节点与下一步">
          <div className="rounded-xl border border-emerald-200 bg-white/90 p-3.5">
            <div className="flex items-center gap-2 text-[10px] font-bold text-accent"><span className="h-2 w-2 rounded-full bg-emerald-500" />当前节点</div>
            <p className="mt-1.5 text-sm font-bold text-text-primary">{spotlight.currentTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{spotlight.currentDetail}</p>
          </div>
          <div className="rounded-xl border border-violet-200 bg-white/90 p-3.5">
            <div className="flex items-center gap-2 text-[10px] font-bold text-violet-700"><ArrowRight size={12} aria-hidden="true" />下一步</div>
            <p className="mt-1.5 text-sm font-bold text-text-primary">{spotlight.nextTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{spotlight.nextDetail}</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6" aria-label="AI 工作流与基础页面图谱">
          {nodes.map((node, index) => {
            const Icon = node.icon;
            const state = STATE_META[node.state];
            const isCurrent = spotlight.currentNodeIds.includes(node.id);
            return (
              <div key={node.id} className="relative min-w-0">
                <article className={`flex h-full min-h-52 flex-col rounded-xl border bg-white p-3.5 transition ${state.border} ${isCurrent ? 'ring-2 ring-emerald-400/30' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Icon size={16} aria-hidden="true" /></span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${state.badge}`}><StateIcon state={node.state} />{state.label}</span>
                  </div>
                  <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-text-muted">{String(index + 1).padStart(2, '0')} · {node.eyebrow}</p>
                  <h3 className="mt-1 text-sm font-bold text-text-primary">{node.title}</h3>
                  <p className="mt-1.5 flex-1 text-[11px] leading-relaxed text-text-muted">{node.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {node.links.length === 0 ? <span className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-muted">当前工作台</span> : node.links.map(link => (
                      <button key={link.target} type="button" onClick={() => openTarget(link.target)} className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-accent">
                        {link.label}<ArrowRight size={10} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </article>
                {index < nodes.length - 1 && <span className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-white text-text-muted xl:flex"><ArrowRight size={11} aria-hidden="true" /></span>}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-text-muted">内容准备、发布与询盘承接可按实际情况并行，灵小枢会在可靠结果齐备后统一汇总。</p>
      </div>
    </section>
  );
}
