import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Boxes,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Download,
  Edit3,
  FileCode2,
  FileText,
  KanbanSquare,
  ListChecks,
  Plus,
  ScrollText,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  StartupApiEndpoint,
  StartupDevelopmentTask,
  StartupHubSnapshot,
  StartupIssue,
  StartupLogSource,
  StartupProduct,
  StartupProductDocument,
  StartupProductReview,
} from '../../shared/startupHub';
import type { StartupHubActions } from '../lib/startupHubUi';

interface Props {
  snapshot: StartupHubSnapshot;
  actions: StartupHubActions;
  saving: boolean;
}

type View = 'workflow' | 'products' | 'prds' | 'reviews' | 'tasks' | 'issues' | 'apis' | 'logs';
type EditorKind = 'product' | 'document' | 'review' | 'task' | 'issue' | 'api' | 'log';
type EditorState = { kind: EditorKind; id?: string } | null;

const TABS: Array<{ id: View; label: string; icon: LucideIcon }> = [
  { id: 'workflow', label: '研发总览', icon: ListChecks },
  { id: 'products', label: '产品', icon: Boxes },
  { id: 'prds', label: 'PRD 文档', icon: FileText },
  { id: 'reviews', label: '需求 / 技术评审', icon: ClipboardCheck },
  { id: 'tasks', label: '开发分工', icon: KanbanSquare },
  { id: 'issues', label: 'Bug 排障', icon: Bug },
  { id: 'apis', label: '统一 API', icon: Code2 },
  { id: 'logs', label: '日志接入', icon: ScrollText },
];

const PRODUCT_STATUS: Record<StartupProduct['status'], string> = {
  planning: '规划中', active: '研发中', paused: '已暂停', archived: '已归档',
};
const DOCUMENT_STATUS: Record<StartupProductDocument['status'], string> = {
  draft: '草稿', review: '评审中', approved: '已通过', archived: '已归档',
};
const REVIEW_STATUS: Record<StartupProductReview['status'], string> = {
  pending: '待安排', in_review: '评审中', approved: '已通过', changes_requested: '需修改',
};
const TASK_STATUS: Record<StartupDevelopmentTask['status'], string> = {
  backlog: '需求池', ready: '待开发', in_progress: '开发中', in_review: '待验收', blocked: '已阻塞', done: '已完成',
};
const ISSUE_STATUS: Record<StartupIssue['status'], string> = {
  open: '待定位', investigating: '排查中', fixing: '修复中', verifying: '待验证', closed: '已关闭',
};
const PRIORITY: Record<StartupDevelopmentTask['priority'], string> = {
  critical: '紧急', high: '高', medium: '中', low: '低',
};
const TASK_TYPES: Record<StartupDevelopmentTask['type'], string> = {
  frontend: '前端', backend: '后端', fullstack: '全栈', design: '设计', qa: '测试', devops: '运维', other: '其他',
};
const REVIEW_CHECKLIST = {
  requirements: ['目标用户与真实问题明确', '范围与非目标明确', '主流程和异常流程明确', '验收标准可测试', '数据指标与上线边界明确'],
  technical: ['技术方案与模块边界明确', '数据结构和 API 变更明确', '权限、安全与隐私已评估', '迁移、回滚与监控方案明确', '测试策略和开发分工明确'],
};
const PRD_TEMPLATE = `# 产品需求文档

## 1. 背景与目标

## 2. 用户与使用场景

## 3. 问题定义

## 4. 范围

### 本期包含

### 本期不包含

## 5. 用户流程与功能需求

## 6. 数据与权限

## 7. 验收标准

## 8. 成功指标

## 9. 风险与待确认事项
`;

const TASK_COLUMNS: StartupDevelopmentTask['status'][] = ['backlog', 'ready', 'in_progress', 'in_review', 'blocked', 'done'];
const ISSUE_COLUMNS: StartupIssue['status'][] = ['open', 'investigating', 'fixing', 'verifying', 'closed'];

function Field({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <label className={`text-[10px] font-semibold text-text-secondary ${className}`}>{label}{children}</label>;
}

function Empty({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="grid min-h-[260px] place-items-center px-6 text-center"><div><Icon size={28} className="mx-auto text-text-muted" /><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 max-w-lg text-[10px] leading-5 text-text-muted">{detail}</p></div></div>;
}

function splitLines(value: string): string[] {
  return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
}

function joinLines(value: string[]): string {
  return value.join('\n');
}

function localDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dueLabel(value?: string): string {
  if (!value) return '未设日期';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : value;
}

function downloadMarkdown(document: StartupProductDocument) {
  const blob = new Blob([document.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `${document.title.replace(/[\\/:*?"<>|]/g, '-') || 'PRD'}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function StartupProductCenter({ snapshot, actions, saving }: Props) {
  const [view, setView] = useState<View>('workflow');
  const [selectedProductId, setSelectedProductId] = useState(snapshot.products[0]?.id || '');
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);

  const [productDraft, setProductDraft] = useState({ name: '', owner: '', status: 'planning' as StartupProduct['status'], version: '', description: '', customerProblem: '', successMetric: '', targetDate: '' });
  const [documentDraft, setDocumentDraft] = useState({ productId: '', title: '', owner: '', reviewers: '', status: 'draft' as StartupProductDocument['status'], version: 'v0.1', content: '' });
  const [reviewDraft, setReviewDraft] = useState({ productId: '', documentId: '', type: 'requirements' as StartupProductReview['type'], title: '', owner: '', reviewers: '', status: 'pending' as StartupProductReview['status'], scheduledAt: '', checklist: joinLines(REVIEW_CHECKLIST.requirements), decision: '', notes: '' });
  const [taskDraft, setTaskDraft] = useState({ productId: '', documentId: '', title: '', type: 'frontend' as StartupDevelopmentTask['type'], assignee: '', reviewer: '', status: 'backlog' as StartupDevelopmentTask['status'], priority: 'medium' as StartupDevelopmentTask['priority'], dueDate: '', estimatePoints: '', acceptanceCriteria: '', branch: '', blockedReason: '' });
  const [issueDraft, setIssueDraft] = useState({ title: '', severity: 'medium' as StartupIssue['severity'], status: 'open' as StartupIssue['status'], source: '内部发现', assignee: '', productId: '', apiEndpointId: '', resourceId: '', dueDate: '', reportedBy: '', environment: '测试', reproductionSteps: '', expectedBehavior: '', actualBehavior: '', rootCause: '', resolution: '', linkedTaskId: '' });
  const [apiDraft, setApiDraft] = useState({ name: '', method: 'GET', path: '', environment: '测试', owner: '', productId: '', status: 'designing' as StartupApiEndpoint['status'] });
  const [logDraft, setLogDraft] = useState({ name: '', provider: '', environment: '生产', owner: '', status: 'disconnected' as StartupLogSource['status'], queryUrl: '' });

  useEffect(() => {
    if (snapshot.products.some(item => item.id === selectedProductId)) return;
    setSelectedProductId(snapshot.products[0]?.id || '');
  }, [selectedProductId, snapshot.products]);

  const selectedProduct = snapshot.products.find(item => item.id === selectedProductId);
  const members = useMemo(() => {
    const names = new Set<string>();
    snapshot.members.filter(item => item.status !== 'disabled').forEach(item => names.add(item.name));
    snapshot.products.forEach(item => names.add(item.owner));
    snapshot.developmentTasks.forEach(item => { names.add(item.assignee); if (item.reviewer) names.add(item.reviewer); });
    snapshot.issues.forEach(item => names.add(item.assignee));
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [snapshot]);
  const documents = snapshot.productDocuments.filter(item => item.productId === selectedProductId);
  const reviews = snapshot.productReviews.filter(item => item.productId === selectedProductId);
  const productTasks = snapshot.developmentTasks.filter(item => item.productId === selectedProductId);
  const productIssues = snapshot.issues.filter(item => item.productId === selectedProductId);
  const tasks = productTasks.filter(item => !memberFilter || item.assignee === memberFilter || item.reviewer === memberFilter);
  const issues = productIssues.filter(item => !memberFilter || item.assignee === memberFilter || item.reportedBy === memberFilter);
  const apis = snapshot.apiEndpoints.filter(item => item.productId === selectedProductId);
  const selectedDocument = documents.find(item => item.id === selectedDocumentId) || documents[0];

  const readiness = selectedProduct ? [
    { label: 'PRD 已通过', passed: documents.some(item => item.status === 'approved'), detail: `${documents.filter(item => item.status === 'approved').length}/${documents.length} 份已通过` },
    { label: '需求评审完成', passed: reviews.some(item => item.type === 'requirements' && item.status === 'approved'), detail: `${reviews.filter(item => item.type === 'requirements' && item.status === 'approved').length} 次通过` },
    { label: '技术评审完成', passed: reviews.some(item => item.type === 'technical' && item.status === 'approved'), detail: `${reviews.filter(item => item.type === 'technical' && item.status === 'approved').length} 次通过` },
    { label: '开发任务完成', passed: productTasks.length > 0 && productTasks.every(item => item.status === 'done'), detail: `${productTasks.filter(item => item.status === 'done').length}/${productTasks.length} 项完成` },
    { label: '高风险 Bug 清零', passed: !productIssues.some(item => item.status !== 'closed' && ['critical', 'high'].includes(item.severity)), detail: `${productIssues.filter(item => item.status !== 'closed' && ['critical', 'high'].includes(item.severity)).length} 个未关闭` },
  ] : [];

  const openNew = (kind: EditorKind) => {
    const owner = selectedProduct?.owner || members[0] || '';
    if (kind === 'product') setProductDraft({ name: '', owner, status: 'planning', version: '', description: '', customerProblem: '', successMetric: '', targetDate: '' });
    if (kind === 'document') setDocumentDraft({ productId: selectedProductId, title: '', owner, reviewers: '', status: 'draft', version: 'v0.1', content: '' });
    if (kind === 'review') setReviewDraft({ productId: selectedProductId, documentId: selectedDocument?.id || '', type: 'requirements', title: '', owner, reviewers: '', status: 'pending', scheduledAt: '', checklist: joinLines(REVIEW_CHECKLIST.requirements), decision: '', notes: '' });
    if (kind === 'task') setTaskDraft({ productId: selectedProductId, documentId: selectedDocument?.id || '', title: '', type: 'frontend', assignee: owner, reviewer: '', status: 'backlog', priority: 'medium', dueDate: '', estimatePoints: '', acceptanceCriteria: '', branch: '', blockedReason: '' });
    if (kind === 'issue') setIssueDraft({ title: '', severity: 'medium', status: 'open', source: '内部发现', assignee: owner, productId: selectedProductId, apiEndpointId: '', resourceId: '', dueDate: '', reportedBy: '', environment: '测试', reproductionSteps: '', expectedBehavior: '', actualBehavior: '', rootCause: '', resolution: '', linkedTaskId: '' });
    if (kind === 'api') setApiDraft({ name: '', method: 'GET', path: '', environment: '测试', owner, productId: selectedProductId, status: 'designing' });
    if (kind === 'log') setLogDraft({ name: '', provider: '', environment: '生产', owner, status: 'disconnected', queryUrl: '' });
    setEditor({ kind });
  };

  const openEdit = (kind: EditorKind, id: string) => {
    if (kind === 'product') { const item = snapshot.products.find(value => value.id === id); if (!item) return; setProductDraft({ name: item.name, owner: item.owner, status: item.status, version: item.version || '', description: item.description || '', customerProblem: item.customerProblem || '', successMetric: item.successMetric || '', targetDate: item.targetDate?.slice(0, 10) || '' }); }
    if (kind === 'document') { const item = snapshot.productDocuments.find(value => value.id === id); if (!item) return; setDocumentDraft({ productId: item.productId, title: item.title, owner: item.owner, reviewers: joinLines(item.reviewers), status: item.status, version: item.version, content: item.content }); }
    if (kind === 'review') { const item = snapshot.productReviews.find(value => value.id === id); if (!item) return; setReviewDraft({ productId: item.productId, documentId: item.documentId || '', type: item.type, title: item.title, owner: item.owner, reviewers: joinLines(item.reviewers), status: item.status, scheduledAt: localDateTime(item.scheduledAt), checklist: joinLines(item.checklist), decision: item.decision || '', notes: item.notes || '' }); }
    if (kind === 'task') { const item = snapshot.developmentTasks.find(value => value.id === id); if (!item) return; setTaskDraft({ productId: item.productId, documentId: item.documentId || '', title: item.title, type: item.type, assignee: item.assignee, reviewer: item.reviewer || '', status: item.status, priority: item.priority, dueDate: item.dueDate?.slice(0, 10) || '', estimatePoints: item.estimatePoints?.toString() || '', acceptanceCriteria: item.acceptanceCriteria, branch: item.branch || '', blockedReason: item.blockedReason || '' }); }
    if (kind === 'issue') { const item = snapshot.issues.find(value => value.id === id); if (!item) return; setIssueDraft({ title: item.title, severity: item.severity, status: item.status, source: item.source, assignee: item.assignee, productId: item.productId || '', apiEndpointId: item.apiEndpointId || '', resourceId: item.resourceId || '', dueDate: item.dueDate?.slice(0, 10) || '', reportedBy: item.reportedBy || '', environment: item.environment || '', reproductionSteps: item.reproductionSteps || '', expectedBehavior: item.expectedBehavior || '', actualBehavior: item.actualBehavior || '', rootCause: item.rootCause || '', resolution: item.resolution || '', linkedTaskId: item.linkedTaskId || '' }); }
    if (kind === 'api') { const item = snapshot.apiEndpoints.find(value => value.id === id); if (!item) return; setApiDraft({ name: item.name, method: item.method, path: item.path, environment: item.environment, owner: item.owner, productId: item.productId || '', status: item.status }); }
    if (kind === 'log') { const item = snapshot.logSources.find(value => value.id === id); if (!item) return; setLogDraft({ name: item.name, provider: item.provider, environment: item.environment, owner: item.owner, status: item.status, queryUrl: item.queryUrl || '' }); }
    setEditor({ kind, id });
  };

  const saveEditor = async () => {
    if (!editor) return;
    const write = async <K extends Parameters<StartupHubActions['create']>[0]>(kind: K, payload: Parameters<StartupHubActions['create']>[1]) => {
      if (editor.id) await actions.update(kind, editor.id, payload as never);
      else await actions.create(kind, payload as never);
    };
    if (editor.kind === 'product') await write('products', { ...productDraft, version: productDraft.version || undefined, description: productDraft.description || undefined, customerProblem: productDraft.customerProblem || undefined, successMetric: productDraft.successMetric || undefined, targetDate: productDraft.targetDate || undefined });
    if (editor.kind === 'document') await write('productDocuments', { ...documentDraft, reviewers: splitLines(documentDraft.reviewers) });
    if (editor.kind === 'review') await write('productReviews', { ...reviewDraft, documentId: reviewDraft.documentId || undefined, reviewers: splitLines(reviewDraft.reviewers), scheduledAt: reviewDraft.scheduledAt || undefined, checklist: splitLines(reviewDraft.checklist), decision: reviewDraft.decision || undefined, notes: reviewDraft.notes || undefined });
    if (editor.kind === 'task') await write('developmentTasks', { ...taskDraft, documentId: taskDraft.documentId || undefined, reviewer: taskDraft.reviewer || undefined, dueDate: taskDraft.dueDate || undefined, estimatePoints: taskDraft.estimatePoints ? Number(taskDraft.estimatePoints) : undefined, branch: taskDraft.branch || undefined, blockedReason: taskDraft.blockedReason || undefined });
    if (editor.kind === 'issue') await write('issues', { ...issueDraft, productId: issueDraft.productId || undefined, apiEndpointId: issueDraft.apiEndpointId || undefined, resourceId: issueDraft.resourceId || undefined, dueDate: issueDraft.dueDate || undefined, reportedBy: issueDraft.reportedBy || undefined, environment: issueDraft.environment || undefined, reproductionSteps: issueDraft.reproductionSteps || undefined, expectedBehavior: issueDraft.expectedBehavior || undefined, actualBehavior: issueDraft.actualBehavior || undefined, rootCause: issueDraft.rootCause || undefined, resolution: issueDraft.resolution || undefined, linkedTaskId: issueDraft.linkedTaskId || undefined });
    if (editor.kind === 'api') await write('apiEndpoints', { ...apiDraft, productId: apiDraft.productId || undefined });
    if (editor.kind === 'log') await write('logSources', { ...logDraft, queryUrl: logDraft.queryUrl || undefined });
    setEditor(null);
  };

  const requiredProduct = !['workflow', 'products', 'logs'].includes(view);
  const primaryKind: Record<View, EditorKind> = { workflow: 'product', products: 'product', prds: 'document', reviews: 'review', tasks: 'task', issues: 'issue', apis: 'api', logs: 'log' };
  const primaryLabel: Record<View, string> = { workflow: '新建产品', products: '新建产品', prds: '新建 PRD', reviews: '新建评审', tasks: '拆分任务', issues: '登记 Bug', apis: '登记 API', logs: '接入日志源' };

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="section-panel p-4"><p className="text-[9px] text-text-muted">进行中产品</p><p className="mt-2 text-2xl font-semibold">{snapshot.products.filter(item => item.status === 'active').length}</p></div>
      <div className="section-panel p-4"><p className="text-[9px] text-text-muted">待推进开发任务</p><p className="mt-2 text-2xl font-semibold">{snapshot.developmentTasks.filter(item => item.status !== 'done').length}</p></div>
      <div className="section-panel p-4"><p className="text-[9px] text-text-muted">待完成评审</p><p className="mt-2 text-2xl font-semibold">{snapshot.productReviews.filter(item => item.status !== 'approved').length}</p></div>
      <div className="section-panel p-4"><p className="text-[9px] text-text-muted">未关闭 Bug</p><p className="mt-2 text-2xl font-semibold">{snapshot.issues.filter(item => item.status !== 'closed').length}</p></div>
    </section>

    <section className="section-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {TABS.map(tab => { const Icon = tab.icon; return <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold ${view === tab.id ? 'bg-blue-50 text-accent' : 'text-text-secondary hover:bg-zinc-50'}`}><Icon size={13} />{tab.label}</button>; })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {snapshot.products.length > 0 && view !== 'products' && view !== 'logs' && <select value={selectedProductId} onChange={event => setSelectedProductId(event.target.value)} className="ui-field ui-select min-w-44 py-2 text-[10px]">{snapshot.products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          {['workflow', 'tasks', 'issues'].includes(view) && members.length > 0 && <select value={memberFilter} onChange={event => setMemberFilter(event.target.value)} className="ui-field ui-select min-w-36 py-2 text-[10px]"><option value="">全部成员</option>{members.map(name => <option key={name} value={name}>{name}</option>)}</select>}
          <button type="button" onClick={() => openNew(primaryKind[view])} disabled={requiredProduct && !selectedProduct} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12} />{primaryLabel[view]}</button>
        </div>
      </div>

      {requiredProduct && !selectedProduct && <Empty icon={Boxes} title="先创建一个产品" detail="产品是 PRD、评审、开发任务、API 与 Bug 的共同主线。创建后即可开始协作，系统不会自动填充任何业务数据。" />}

      {view === 'workflow' && selectedProduct && <div className="grid xl:grid-cols-[1.1fr_.9fr]">
        <div className="border-b border-border p-5 xl:border-b-0 xl:border-r">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-accent">Delivery readiness</p><h3 className="mt-1 text-xl font-semibold">{selectedProduct.name}</h3><p className="mt-2 text-[10px] leading-5 text-text-secondary">{selectedProduct.customerProblem || '尚未写清要解决的用户问题。'}</p></div><button type="button" onClick={() => openEdit('product', selectedProduct.id)} className="btn-ghost flex items-center gap-1 px-3 py-2 text-[9px]"><Edit3 size={11} />编辑</button></div>
          <div className="mt-5 space-y-2">{readiness.map(item => <div key={item.label} className="flex items-center gap-3 rounded-xl border border-border bg-[#fbfcfa] p-3"><span className={`grid h-7 w-7 place-items-center rounded-full ${item.passed ? 'bg-blue-50 text-accent' : 'bg-[#fff4e8] text-[#a6572a]'}`}>{item.passed ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span><div><p className="text-[10px] font-semibold">{item.label}</p><p className="mt-1 text-[9px] text-text-muted">{item.detail}</p></div></div>)}</div>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-accent">Team workload</p><h3 className="mt-1 text-base font-semibold">4–5 人协作负载</h3></div><Users size={18} className="text-text-muted" /></div>
          <div className="mt-4 space-y-2">{members.length ? members.map(name => { const mine = snapshot.developmentTasks.filter(item => item.productId === selectedProductId && item.assignee === name && item.status !== 'done'); const blocked = mine.filter(item => item.status === 'blocked').length; return <button key={name} type="button" onClick={() => { setMemberFilter(name); setView('tasks'); }} className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-3 text-left hover:bg-[#f7f9f6]"><div><p className="text-[10px] font-semibold">{name}</p><p className="mt-1 text-[9px] text-text-muted">{mine.length} 项待推进{blocked ? ` · ${blocked} 项阻塞` : ''}</p></div><span className="text-xs font-semibold">{mine.reduce((sum, item) => sum + (item.estimatePoints || 0), 0)} pts</span></button>; }) : <p className="text-[10px] leading-5 text-text-muted">成员会从基础设置与实际任务负责人中自动汇总；无需维护重复名单。</p>}</div>
        </div>
      </div>}

      {view === 'products' && (snapshot.products.length ? <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{snapshot.products.map(item => <article key={item.id} className="rounded-xl border border-border bg-[#fbfcfa] p-4"><div className="flex items-start justify-between gap-3"><div><span className="status-badge">{PRODUCT_STATUS[item.status]}</span><h3 className="mt-3 text-sm font-semibold">{item.name}</h3><p className="mt-1 text-[9px] text-text-muted">{item.owner}{item.version ? ` · ${item.version}` : ''}</p></div><button type="button" onClick={() => openEdit('product', item.id)} className="btn-ghost p-2"><Edit3 size={12} /></button></div><p className="mt-3 min-h-10 text-[10px] leading-5 text-text-secondary">{item.customerProblem || item.description || '尚未补充产品问题定义。'}</p><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[9px] text-text-muted"><span>目标 {dueLabel(item.targetDate)}</span><button type="button" onClick={() => { setSelectedProductId(item.id); setView('workflow'); }} className="font-semibold text-accent">进入协作</button></div></article>)}</div> : <Empty icon={Boxes} title="还没有产品" detail="创建真实产品后，再把 PRD、评审、任务和 Bug 关联到同一条产品主线。" />)}

      {view === 'prds' && selectedProduct && (documents.length ? <div className="grid min-h-[480px] xl:grid-cols-[300px_minmax(0,1fr)]"><aside className="border-b border-border p-4 xl:border-b-0 xl:border-r"><p className="px-2 text-[9px] font-semibold text-text-muted">{documents.length} 份 Markdown 文档</p><div className="mt-2 space-y-1">{documents.map(item => <button key={item.id} type="button" onClick={() => setSelectedDocumentId(item.id)} className={`w-full rounded-xl px-3 py-3 text-left ${selectedDocument?.id === item.id ? 'bg-blue-50' : 'hover:bg-zinc-50'}`}><p className="text-[10px] font-semibold">{item.title}</p><p className="mt-1 text-[8px] text-text-muted">{item.version} · {DOCUMENT_STATUS[item.status]} · {item.owner}</p></button>)}</div></aside>{selectedDocument && <article className="min-w-0 p-5"><div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-start"><div><span className="status-badge">{DOCUMENT_STATUS[selectedDocument.status]}</span><h3 className="mt-3 text-lg font-semibold">{selectedDocument.title}</h3><p className="mt-1 text-[9px] text-text-muted">{selectedDocument.version} · 负责人 {selectedDocument.owner} · 评审人 {selectedDocument.reviewers.join('、') || '未指定'}</p></div><div className="flex gap-2"><button type="button" onClick={() => downloadMarkdown(selectedDocument)} className="btn-ghost flex items-center gap-1 px-3 py-2 text-[9px]"><Download size={11} />导出 .md</button><button type="button" onClick={() => openEdit('document', selectedDocument.id)} className="btn-primary flex items-center gap-1 px-3 py-2 text-[9px]"><Edit3 size={11} />编辑</button></div></div><pre className="mt-5 overflow-x-auto whitespace-pre-wrap font-sans text-[10px] leading-6 text-text-secondary">{selectedDocument.content}</pre></article>}</div> : <Empty icon={FileText} title="还没有 PRD" detail="一个产品可以保存多份 Markdown PRD。支持导入、在线修改、评审版本与导出，不再把文档散落在聊天记录里。" />)}

      {view === 'reviews' && selectedProduct && <div className="grid gap-4 p-5 xl:grid-cols-2">{(['requirements', 'technical'] as const).map(type => { const list = reviews.filter(item => item.type === type); return <section key={type} className="rounded-xl border border-border bg-[#fbfcfa] p-4"><div className="flex items-center justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[.15em] text-accent">{type === 'requirements' ? 'Requirement review' : 'Technical review'}</p><h3 className="mt-1 text-sm font-semibold">{type === 'requirements' ? '需求评审' : '技术评审'}</h3></div><span className="text-[9px] text-text-muted">{list.length} 次</span></div><div className="mt-4 space-y-3">{list.length ? list.map(item => <article key={item.id} className="rounded-xl border border-border bg-white p-3"><div className="flex items-start justify-between gap-3"><div><span className="status-badge">{REVIEW_STATUS[item.status]}</span><p className="mt-2 text-[10px] font-semibold">{item.title}</p><p className="mt-1 text-[9px] text-text-muted">主持 {item.owner} · 参与 {item.reviewers.join('、') || '未指定'} · {item.scheduledAt ? new Date(item.scheduledAt).toLocaleString('zh-CN') : '未定时间'}</p></div><button type="button" onClick={() => openEdit('review', item.id)} className="btn-ghost p-2"><Edit3 size={12} /></button></div><div className="mt-3 grid gap-1">{item.checklist.map(entry => <p key={entry} className="flex gap-2 text-[9px] leading-4 text-text-secondary"><CheckCircle2 size={11} className="mt-0.5 shrink-0 text-accent" />{entry}</p>)}</div>{item.decision && <p className="mt-3 rounded-lg bg-zinc-50 p-2 text-[9px] leading-4"><strong>结论：</strong>{item.decision}</p>}</article>) : <p className="rounded-xl border border-dashed border-border p-5 text-center text-[10px] text-text-muted">尚未创建{type === 'requirements' ? '需求' : '技术'}评审。</p>}</div></section>; })}</div>}

      {view === 'tasks' && selectedProduct && <div className="overflow-x-auto p-4"><div className="grid min-w-[1180px] grid-cols-6 gap-3">{TASK_COLUMNS.map(status => { const list = tasks.filter(item => item.status === status); return <section key={status} className="rounded-xl bg-zinc-50 p-2"><div className="flex items-center justify-between px-2 py-2"><p className="text-[10px] font-semibold">{TASK_STATUS[status]}</p><span className="text-[9px] text-text-muted">{list.length}</span></div><div className="space-y-2">{list.map(item => <article key={item.id} className="rounded-xl border border-border bg-white p-3"><div className="flex items-start justify-between gap-2"><span className="text-[8px] font-semibold uppercase text-accent">{PRIORITY[item.priority]} · {TASK_TYPES[item.type]}</span><button type="button" onClick={() => openEdit('task', item.id)} className="text-text-muted hover:text-accent"><Edit3 size={11} /></button></div><p className="mt-2 text-[10px] font-semibold leading-4">{item.title}</p><p className="mt-2 text-[9px] text-text-muted">{item.assignee}{item.reviewer ? ` → ${item.reviewer} 验收` : ''}</p><p className="mt-1 text-[9px] text-text-muted">{dueLabel(item.dueDate)}{item.estimatePoints !== undefined ? ` · ${item.estimatePoints} pts` : ''}</p>{item.blockedReason && <p className="mt-2 rounded-lg bg-[#fff0ef] p-2 text-[8px] leading-4 text-[#a53b37]">阻塞：{item.blockedReason}</p>}<select value={item.status} onChange={event => void actions.update('developmentTasks', item.id, { status: event.target.value as StartupDevelopmentTask['status'] })} className="ui-field ui-select mt-3 py-1.5 text-[9px]">{TASK_COLUMNS.map(value => <option key={value} value={value}>{TASK_STATUS[value]}</option>)}</select></article>)}</div></section>; })}</div></div>}

      {view === 'issues' && selectedProduct && <div className="overflow-x-auto p-4"><div className="grid min-w-[980px] grid-cols-5 gap-3">{ISSUE_COLUMNS.map(status => { const list = issues.filter(item => item.status === status); return <section key={status} className="rounded-xl bg-zinc-50 p-2"><div className="flex items-center justify-between px-2 py-2"><p className="text-[10px] font-semibold">{ISSUE_STATUS[status]}</p><span className="text-[9px] text-text-muted">{list.length}</span></div><div className="space-y-2">{list.map(item => <article key={item.id} className="rounded-xl border border-border bg-white p-3"><div className="flex items-start justify-between gap-2"><span className={`text-[8px] font-semibold uppercase ${['critical', 'high'].includes(item.severity) ? 'text-[#d14444]' : 'text-text-muted'}`}>{item.severity} · {item.source}</span><button type="button" onClick={() => openEdit('issue', item.id)} className="text-text-muted hover:text-accent"><Edit3 size={11} /></button></div><p className="mt-2 text-[10px] font-semibold leading-4">{item.title}</p><p className="mt-2 text-[9px] text-text-muted">{item.assignee} · {item.environment || '未注明环境'}</p>{item.rootCause && <p className="mt-2 line-clamp-3 text-[8px] leading-4 text-text-secondary"><strong>根因：</strong>{item.rootCause}</p>}<select value={item.status} onChange={event => void actions.update('issues', item.id, { status: event.target.value as StartupIssue['status'] })} className="ui-field ui-select mt-3 py-1.5 text-[9px]">{ISSUE_COLUMNS.map(value => <option key={value} value={value}>{ISSUE_STATUS[value]}</option>)}</select></article>)}</div></section>; })}</div></div>}

      {view === 'apis' && selectedProduct && (apis.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="bg-zinc-50 text-[9px] text-text-muted"><tr><th className="px-4 py-3">接口</th><th className="px-4 py-3">环境</th><th className="px-4 py-3">负责人</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{apis.map(item => <tr key={item.id} className="border-t border-border"><td className="px-4 py-3"><strong className="mr-2 text-accent">{item.method}</strong><span className="font-mono">{item.path}</span><p className="mt-1 text-[9px] text-text-muted">{item.name}</p></td><td className="px-4 py-3">{item.environment}</td><td className="px-4 py-3">{item.owner}</td><td className="px-4 py-3">{item.status}</td><td className="px-4 py-3"><button type="button" onClick={() => openEdit('api', item.id)} className="btn-ghost p-2"><Edit3 size={12} /></button></td></tr>)}</tbody></table></div> : <Empty icon={Code2} title="还没有关联 API" detail="登记接口方法、路径、环境、负责人和生命周期状态，供技术评审、联调与 Bug 排障引用。" />)}

      {view === 'logs' && (snapshot.logSources.length ? <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">{snapshot.logSources.map(item => <article key={item.id} className="rounded-xl border border-border bg-[#fbfcfa] p-4"><div className="flex items-start justify-between"><div><span className="status-badge">{item.status}</span><h3 className="mt-3 text-sm font-semibold">{item.name}</h3><p className="mt-1 text-[9px] text-text-muted">{item.provider} · {item.environment} · {item.owner}</p></div><button type="button" onClick={() => openEdit('log', item.id)} className="btn-ghost p-2"><Edit3 size={12} /></button></div>{item.queryUrl && <a href={item.queryUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-[9px] font-semibold text-accent">打开日志查询</a>}</article>)}</div> : <Empty icon={ScrollText} title="还没有日志源" detail="只保存日志平台和查询入口，不在系统中保存访问密钥。Bug 排障可据此找到真实日志。" />)}
    </section>

    <datalist id="product-team-members">{members.map(name => <option key={name} value={name} />)}</datalist>
    {editor && <div className="fixed inset-0 z-50 grid place-items-center bg-[#08141ccc] p-3" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-5 py-4"><div><p className="text-[9px] font-semibold uppercase tracking-[.16em] text-accent">{editor.id ? 'Edit record' : 'Create record'}</p><h2 className="mt-1 text-base font-semibold">{{ product: '产品', document: 'PRD 文档', review: '评审', task: '开发任务', issue: 'Bug 排障', api: 'API', log: '日志源' }[editor.kind]}</h2></div><button type="button" onClick={() => setEditor(null)} className="btn-ghost p-2"><X size={16} /></button></div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {editor.kind === 'product' && <>
            <Field label="产品名称"><input required value={productDraft.name} onChange={event => setProductDraft(value => ({ ...value, name: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="负责人"><input required list="product-team-members" value={productDraft.owner} onChange={event => setProductDraft(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="状态"><select value={productDraft.status} onChange={event => setProductDraft(value => ({ ...value, status: event.target.value as StartupProduct['status'] }))} className="ui-field ui-select mt-1.5">{Object.entries(PRODUCT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="当前版本"><input value={productDraft.version} onChange={event => setProductDraft(value => ({ ...value, version: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="目标日期"><input type="date" value={productDraft.targetDate} onChange={event => setProductDraft(value => ({ ...value, targetDate: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="补充说明"><input value={productDraft.description} onChange={event => setProductDraft(value => ({ ...value, description: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="要解决的客户问题" className="md:col-span-2"><textarea value={productDraft.customerProblem} onChange={event => setProductDraft(value => ({ ...value, customerProblem: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
            <Field label="成功指标" className="md:col-span-2"><textarea value={productDraft.successMetric} onChange={event => setProductDraft(value => ({ ...value, successMetric: event.target.value }))} className="ui-field mt-1.5 min-h-20" /></Field>
          </>}
          {editor.kind === 'document' && <>
            <Field label="所属产品"><select value={documentDraft.productId} onChange={event => setDocumentDraft(value => ({ ...value, productId: event.target.value }))} className="ui-field ui-select mt-1.5">{snapshot.products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="文档标题"><input value={documentDraft.title} onChange={event => setDocumentDraft(value => ({ ...value, title: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="负责人"><input list="product-team-members" value={documentDraft.owner} onChange={event => setDocumentDraft(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="评审人（逗号或换行分隔）"><input value={documentDraft.reviewers} onChange={event => setDocumentDraft(value => ({ ...value, reviewers: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="状态"><select value={documentDraft.status} onChange={event => setDocumentDraft(value => ({ ...value, status: event.target.value as StartupProductDocument['status'] }))} className="ui-field ui-select mt-1.5">{Object.entries(DOCUMENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="版本"><input value={documentDraft.version} onChange={event => setDocumentDraft(value => ({ ...value, version: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <div className="md:col-span-2"><div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-semibold text-text-secondary">Markdown 正文</span><div className="flex gap-2"><input ref={markdownInputRef} type="file" accept=".md,text/markdown,text/plain" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(content => setDocumentDraft(value => ({ ...value, title: value.title || file.name.replace(/\.md$/i, ''), content }))); event.currentTarget.value = ''; }} /><button type="button" onClick={() => markdownInputRef.current?.click()} className="btn-ghost flex items-center gap-1 px-3 py-2 text-[9px]"><Upload size={11} />导入 .md</button><button type="button" onClick={() => setDocumentDraft(value => ({ ...value, content: value.content || PRD_TEMPLATE }))} className="btn-ghost flex items-center gap-1 px-3 py-2 text-[9px]"><FileCode2 size={11} />插入模板</button></div></div><textarea value={documentDraft.content} onChange={event => setDocumentDraft(value => ({ ...value, content: event.target.value }))} className="ui-field min-h-[340px] font-mono text-[10px] leading-5" /></div>
          </>}
          {editor.kind === 'review' && <>
            <Field label="评审类型"><select value={reviewDraft.type} onChange={event => { const type = event.target.value as StartupProductReview['type']; setReviewDraft(value => ({ ...value, type, checklist: joinLines(REVIEW_CHECKLIST[type]) })); }} className="ui-field ui-select mt-1.5"><option value="requirements">需求评审</option><option value="technical">技术评审</option></select></Field>
            <Field label="评审标题"><input value={reviewDraft.title} onChange={event => setReviewDraft(value => ({ ...value, title: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="关联 PRD"><select value={reviewDraft.documentId} onChange={event => setReviewDraft(value => ({ ...value, documentId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.productDocuments.filter(item => item.productId === reviewDraft.productId).map(item => <option key={item.id} value={item.id}>{item.title} · {item.version}</option>)}</select></Field>
            <Field label="状态"><select value={reviewDraft.status} onChange={event => setReviewDraft(value => ({ ...value, status: event.target.value as StartupProductReview['status'] }))} className="ui-field ui-select mt-1.5">{Object.entries(REVIEW_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="主持人"><input list="product-team-members" value={reviewDraft.owner} onChange={event => setReviewDraft(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="参与人（逗号或换行分隔）"><input value={reviewDraft.reviewers} onChange={event => setReviewDraft(value => ({ ...value, reviewers: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="评审时间"><input type="datetime-local" value={reviewDraft.scheduledAt} onChange={event => setReviewDraft(value => ({ ...value, scheduledAt: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="检查项（每行一项）"><textarea value={reviewDraft.checklist} onChange={event => setReviewDraft(value => ({ ...value, checklist: event.target.value }))} className="ui-field mt-1.5 min-h-32" /></Field>
            <Field label="评审结论" className="md:col-span-2"><textarea value={reviewDraft.decision} onChange={event => setReviewDraft(value => ({ ...value, decision: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
            <Field label="待修改项 / 会议记录" className="md:col-span-2"><textarea value={reviewDraft.notes} onChange={event => setReviewDraft(value => ({ ...value, notes: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
          </>}
          {editor.kind === 'task' && <>
            <Field label="任务名称" className="md:col-span-2"><input value={taskDraft.title} onChange={event => setTaskDraft(value => ({ ...value, title: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="工作类型"><select value={taskDraft.type} onChange={event => setTaskDraft(value => ({ ...value, type: event.target.value as StartupDevelopmentTask['type'] }))} className="ui-field ui-select mt-1.5">{Object.entries(TASK_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="状态"><select value={taskDraft.status} onChange={event => setTaskDraft(value => ({ ...value, status: event.target.value as StartupDevelopmentTask['status'] }))} className="ui-field ui-select mt-1.5">{Object.entries(TASK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="开发负责人"><input list="product-team-members" value={taskDraft.assignee} onChange={event => setTaskDraft(value => ({ ...value, assignee: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="验收人"><input list="product-team-members" value={taskDraft.reviewer} onChange={event => setTaskDraft(value => ({ ...value, reviewer: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="优先级"><select value={taskDraft.priority} onChange={event => setTaskDraft(value => ({ ...value, priority: event.target.value as StartupDevelopmentTask['priority'] }))} className="ui-field ui-select mt-1.5">{Object.entries(PRIORITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="截止日期"><input type="date" value={taskDraft.dueDate} onChange={event => setTaskDraft(value => ({ ...value, dueDate: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="估算点数"><input type="number" min="0" value={taskDraft.estimatePoints} onChange={event => setTaskDraft(value => ({ ...value, estimatePoints: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="关联 PRD"><select value={taskDraft.documentId} onChange={event => setTaskDraft(value => ({ ...value, documentId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.productDocuments.filter(item => item.productId === taskDraft.productId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="分支 / PR 地址"><input value={taskDraft.branch} onChange={event => setTaskDraft(value => ({ ...value, branch: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="验收标准" className="md:col-span-2"><textarea value={taskDraft.acceptanceCriteria} onChange={event => setTaskDraft(value => ({ ...value, acceptanceCriteria: event.target.value }))} className="ui-field mt-1.5 min-h-28" placeholder="写成可验证的完成条件" /></Field>
            <Field label="阻塞原因" className="md:col-span-2"><textarea value={taskDraft.blockedReason} onChange={event => setTaskDraft(value => ({ ...value, blockedReason: event.target.value }))} className="ui-field mt-1.5 min-h-20" /></Field>
          </>}
          {editor.kind === 'issue' && <>
            <Field label="Bug 标题" className="md:col-span-2"><input value={issueDraft.title} onChange={event => setIssueDraft(value => ({ ...value, title: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="严重程度"><select value={issueDraft.severity} onChange={event => setIssueDraft(value => ({ ...value, severity: event.target.value as StartupIssue['severity'] }))} className="ui-field ui-select mt-1.5"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
            <Field label="状态"><select value={issueDraft.status} onChange={event => setIssueDraft(value => ({ ...value, status: event.target.value as StartupIssue['status'] }))} className="ui-field ui-select mt-1.5">{Object.entries(ISSUE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="来源"><select value={issueDraft.source} onChange={event => setIssueDraft(value => ({ ...value, source: event.target.value }))} className="ui-field ui-select mt-1.5"><option>内部发现</option><option>用户反馈</option><option>测试</option><option>日志告警</option><option>线上事故</option><option>安全扫描</option></select></Field>
            <Field label="环境"><select value={issueDraft.environment} onChange={event => setIssueDraft(value => ({ ...value, environment: event.target.value }))} className="ui-field ui-select mt-1.5"><option>开发</option><option>测试</option><option>预发布</option><option>生产</option></select></Field>
            <Field label="负责人"><input list="product-team-members" value={issueDraft.assignee} onChange={event => setIssueDraft(value => ({ ...value, assignee: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="报告人"><input list="product-team-members" value={issueDraft.reportedBy} onChange={event => setIssueDraft(value => ({ ...value, reportedBy: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="截止日期"><input type="date" value={issueDraft.dueDate} onChange={event => setIssueDraft(value => ({ ...value, dueDate: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="关联开发任务"><select value={issueDraft.linkedTaskId} onChange={event => setIssueDraft(value => ({ ...value, linkedTaskId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.developmentTasks.filter(item => item.productId === issueDraft.productId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            <Field label="关联 API"><select value={issueDraft.apiEndpointId} onChange={event => setIssueDraft(value => ({ ...value, apiEndpointId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.apiEndpoints.filter(item => item.productId === issueDraft.productId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="关联服务器 / 资源"><select value={issueDraft.resourceId} onChange={event => setIssueDraft(value => ({ ...value, resourceId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.resources.map(item => <option key={item.id} value={item.id}>{item.name} · {item.environment}</option>)}</select></Field>
            <Field label="复现步骤" className="md:col-span-2"><textarea value={issueDraft.reproductionSteps} onChange={event => setIssueDraft(value => ({ ...value, reproductionSteps: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
            <Field label="预期结果"><textarea value={issueDraft.expectedBehavior} onChange={event => setIssueDraft(value => ({ ...value, expectedBehavior: event.target.value }))} className="ui-field mt-1.5 min-h-20" /></Field>
            <Field label="实际结果"><textarea value={issueDraft.actualBehavior} onChange={event => setIssueDraft(value => ({ ...value, actualBehavior: event.target.value }))} className="ui-field mt-1.5 min-h-20" /></Field>
            <Field label="根因分析"><textarea value={issueDraft.rootCause} onChange={event => setIssueDraft(value => ({ ...value, rootCause: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
            <Field label="修复方案 / 验证结果"><textarea value={issueDraft.resolution} onChange={event => setIssueDraft(value => ({ ...value, resolution: event.target.value }))} className="ui-field mt-1.5 min-h-24" /></Field>
          </>}
          {editor.kind === 'api' && <>
            <Field label="接口名称"><input value={apiDraft.name} onChange={event => setApiDraft(value => ({ ...value, name: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="关联产品"><select value={apiDraft.productId} onChange={event => setApiDraft(value => ({ ...value, productId: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">不关联</option>{snapshot.products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="方法"><select value={apiDraft.method} onChange={event => setApiDraft(value => ({ ...value, method: event.target.value }))} className="ui-field ui-select mt-1.5"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></Field>
            <Field label="路径"><input value={apiDraft.path} onChange={event => setApiDraft(value => ({ ...value, path: event.target.value }))} className="ui-field mt-1.5 font-mono" /></Field>
            <Field label="环境"><select value={apiDraft.environment} onChange={event => setApiDraft(value => ({ ...value, environment: event.target.value }))} className="ui-field ui-select mt-1.5"><option>开发</option><option>测试</option><option>预发布</option><option>生产</option></select></Field>
            <Field label="负责人"><input list="product-team-members" value={apiDraft.owner} onChange={event => setApiDraft(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="状态"><select value={apiDraft.status} onChange={event => setApiDraft(value => ({ ...value, status: event.target.value as StartupApiEndpoint['status'] }))} className="ui-field ui-select mt-1.5"><option value="designing">设计中</option><option value="developing">开发中</option><option value="testing">联调测试</option><option value="production">生产</option><option value="deprecated">已废弃</option></select></Field>
          </>}
          {editor.kind === 'log' && <>
            <Field label="日志源名称"><input value={logDraft.name} onChange={event => setLogDraft(value => ({ ...value, name: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="平台"><select value={logDraft.provider} onChange={event => setLogDraft(value => ({ ...value, provider: event.target.value }))} className="ui-field ui-select mt-1.5"><option value="">请选择</option><option>Sentry</option><option>阿里云日志服务</option><option>腾讯云 CLS</option><option>CloudWatch</option><option>Grafana / Loki</option><option>自建日志平台</option><option>其他</option></select></Field>
            <Field label="环境"><select value={logDraft.environment} onChange={event => setLogDraft(value => ({ ...value, environment: event.target.value }))} className="ui-field ui-select mt-1.5"><option>开发</option><option>测试</option><option>生产</option></select></Field>
            <Field label="负责人"><input list="product-team-members" value={logDraft.owner} onChange={event => setLogDraft(value => ({ ...value, owner: event.target.value }))} className="ui-field mt-1.5" /></Field>
            <Field label="状态"><select value={logDraft.status} onChange={event => setLogDraft(value => ({ ...value, status: event.target.value as StartupLogSource['status'] }))} className="ui-field ui-select mt-1.5"><option value="connected">已连接</option><option value="disconnected">未连接</option><option value="error">异常</option></select></Field>
            <Field label="查询入口"><input type="url" value={logDraft.queryUrl} onChange={event => setLogDraft(value => ({ ...value, queryUrl: event.target.value }))} className="ui-field mt-1.5" placeholder="只保存地址，不保存密钥" /></Field>
          </>}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-white px-5 py-4"><button type="button" onClick={() => setEditor(null)} className="btn-ghost px-4 py-2 text-[10px]">取消</button><button type="button" onClick={() => void saveEditor()} disabled={saving} className="btn-primary px-5 py-2 text-[10px] disabled:opacity-45">{saving ? '保存中…' : '保存'}</button></div>
      </div>
    </div>}
  </div>;
}
