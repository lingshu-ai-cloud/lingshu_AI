import { useEffect, useRef, useState } from 'react';
import type { WeeklyExecutionTask, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import type { WeeklyReviewEvidenceView } from '../../../shared/contracts/weeklyReviewEvidence';
import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { executeWeeklyReviewApi,loadWeeklyReviewEvidenceForScope } from '../../lib/weeklyReviewEvidenceApi';
import { weeklyReviewPanelId } from './reviewCalendarNavigation';
import {Button,Alert} from 'antd';
import {getToken,AUTH_TOKEN_CHANGED_EVENT} from '../../lib/auth';
import WeeklyGoalAuditPanel from './WeeklyGoalAuditPanel';
import {productionNavigationIdentity} from '../../lib/productionNavigation';

const observed = (value: number | null | undefined) => value === null || value === undefined ? '未观测' : String(value);

export default function WeeklyReviewEvidencePanel({
  pkg,
  tasks,
  taskId,
}: {
  pkg: WeeklyOperatingPackage;
  tasks: WeeklyExecutionTask[];
  taskId?: string;
}) {
  const scoped = tasks.filter(task => task.programId === pkg.programId && task.packageId === pkg.packageId && task.packageVersion === pkg.version);
  const chosen = taskId
    ?? scoped.find(task => task.schedule.stepKind === 'weekly_review')?.taskId
    ?? scoped.find(task => task.schedule.stepKind === 'performance_monitoring')?.taskId;
  const matches = scoped.filter(task => task.taskId === chosen && ['weekly_review', 'performance_monitoring'].includes(task.schedule.stepKind));
  const task = matches.length === 1 && new Set(scoped.map(item => item.tenantId)).size === 1 ? matches[0] : null;
  const [token,setToken]=useState(()=>typeof localStorage==='undefined'?'':getToken());
  useEffect(()=>{const changed=()=>setToken(getToken());window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  const identity = JSON.stringify([productionNavigationIdentity(),pkg.programId, pkg.packageId, pkg.version, chosen]);
  const current = useRef(identity);
  current.current = identity;
  const section = useRef<HTMLElement>(null);
  const [state, setState] = useState<{ identity: string; item: WeeklyReviewEvidenceView } | null>(null);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [operation,setOperation]=useState<{identity:string;busy:boolean;uncertain:boolean;message:string}|null>(null);
  useEffect(()=>{current.current=identity;return()=>{current.current='unmounted';};},[identity]);
  const taskEvidence = JSON.stringify(task ? [task.status, task.resultRefs, task.lastError?.message, task.ownBlockingReasons] : null);

  useEffect(() => {
    let active = true;
    if (!task) return;
    setError(null);
    const captured = identity;
    void loadWeeklyReviewEvidenceForScope({
      scope: { programId: pkg.programId, packageId: pkg.packageId, packageVersion: pkg.version, taskId: task.taskId },
      isCurrent: () => active && current.current === captured,
      onLoaded: item => setState({ identity: captured, item }),
    }).catch(cause => {
      if (active && current.current === captured) {
        setError({ identity: captured, message: cause instanceof Error ? cause.message : '真实复盘证据读取失败' });
      }
    });
    return () => { active = false; };
  }, [identity, refresh, Boolean(task), taskEvidence]);

  useEffect(() => {
    if (!taskId || !task || !section.current) return;
    let parent = section.current.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
      parent = parent.parentElement;
    }
    section.current.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
    section.current.focus({ preventScroll: true });
  }, [identity]);

  const item = state?.identity === identity ? state.item : null;
  const message = error?.identity === identity ? error.message : null;
  const operating=operation?.identity===identity?operation:null;
  const weekly=task?.schedule.stepKind==='weekly_review';
  const pendingDependencies=task?.dependsOnTaskIds?.filter(id=>!scoped.some(source=>source.taskId===id&&source.status==='succeeded'&&source.resultRefs.length))??[];
  const operationBlockers=[...(pkg.status!=='active'?['周包仍未启用，不能执行周复盘']:[]),...(!item?.window.closed?['本周统计窗口尚未结束']:[]),...(pendingDependencies.length?[`${pendingDependencies.length} 项真实上游交付尚未完成`]:[]),...(task&&!['queued','succeeded'].includes(task.status)?[`复盘任务状态为 ${task.status}，尚未就绪`]:[]),...(task?.ownBlockingReasons??[]),...(task?.lease?['真实执行器正在处理该任务']:[])];
  async function executeReview(){
    if(!task||!weekly||operationBlockers.length||operating?.busy||operating?.uncertain||getToken()!==token)return;
    const captured=identity;setOperation({identity:captured,busy:true,uncertain:false,message:''});
    try{const evidence=await executeWeeklyReviewApi({programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version,taskId:task.taskId},task.updatedAt);if(current.current!==captured||getToken()!==token)return;setState({identity:captured,item:evidence});setOperation({identity:captured,busy:false,uncertain:false,message:'真实周报已冻结，可查看报告凭据。任务完成状态仍由执行器核验，不代替目标人工验收。'});}
    catch(cause){if(current.current===captured&&getToken()===token)setOperation({identity:captured,busy:false,uncertain:true,message:cause instanceof Error?cause.message:'复盘结果未知，请只读刷新核验。'});}
  }

  return (
    <section
      ref={section}
      id={weeklyReviewPanelId(pkg)}
      tabIndex={-1}
      data-review-task={task?.taskId}
      data-review-program={pkg.programId}
      data-review-package={pkg.packageId}
      data-review-version={String(pkg.version)}
      className="scroll-mt-6 space-y-3 rounded-lg border border-border bg-white p-4 text-xs"
    >
      <h4 className="text-sm font-bold">{weekly?'周目标验收与数据复盘':'本周真实社媒指标与冻结复盘'}</h4>
      {weekly&&<WeeklyGoalAuditPanel pkg={pkg} tasks={scoped} mode="acceptance"/>}
      <p>周包 v{pkg.version} · {pkg.weekStart} — {pkg.weekEnd}。读取实际执行证据；刷新仅查询，不触发复盘扫描或生成报告。</p>
      {!task && <p className="text-amber-800">当前周版本没有匹配的真实指标或复盘任务，请刷新任务图。</p>}
      {task && <p>执行任务：{task.taskId} · {task.schedule.stepKind === 'weekly_review' ? '周复盘' : '效果指标监测'} · 后台状态 {task.status}</p>}
      {message && <p role="alert" className="text-red-700">{message}</p>}
      {task && !item && !message && <p role="status">正在读取这条任务的真实复盘证据…</p>}
      {item && <>
        <p>报告窗口（北京时间经营周，以下为 UTC 存储时刻）：{item.window.startsAt} — {item.window.endsAt} · {item.window.closed ? '已结束' : '尚未结束'}</p>
        <p>读取状态：{{ report_frozen: '报告已冻结', monitoring_evidence: '已有指标证据', waiting_window: '等待窗口结束', waiting_evidence: '等待真实证据', blocked: '证据或执行受阻' }[item.state]}</p>
        {item.gaps.map((gap, index) => <p key={index} className="text-amber-800">{gap}</p>)}
        {item.task.blockingReasons.map((reason, index) => <p key={index} className="text-amber-800">{reason}</p>)}
        {item.task.lastError && <p className="text-red-700">实际执行错误：{item.task.lastError}</p>}
        {item.metrics.map(metric => <article key={metric.ref.id} className="rounded-lg border border-border p-2">
          <p>实际指标 {metric.ref.id} · 账号 {metric.accountId} · 内容 {metric.contentId ?? '账号级观测'} · {metric.capturedAt}</p>
          <p>播放 {observed(metric.values.views)} · 赞 {observed(metric.values.likes)} · 转 {observed(metric.values.shares)} · 评 {observed(metric.values.comments)}</p>
        </article>)}
        {item.report && <div className="space-y-2">
          <p className="font-semibold">冻结报告 {item.report.snapshotId} · v{item.report.version} · {item.report.window.frozenAt}</p>
          <p>样本状态：{item.report.sampleSufficiency.status} · 自有内容 {item.report.sampleSufficiency.ownedContentCount} · 可归因 {item.report.sampleSufficiency.attributableContentCount}</p>
          {item.report.sampleSufficiency.reasons.map((reason, index) => <p key={index} className="text-amber-800">{reason}</p>)}
          <p className="text-stone-500">外部参考不是客户自身经营成果；未观测指标不补零，播放与互动不等同成交。</p>
          {item.report.contents.map(content => <article key={`${content.platform}:${content.accountId}:${content.contentId}`} className="rounded-lg border border-border p-2">
            <p>{content.businessDirection} · {content.platform} · {content.accountId} · {content.contentId} · {content.evidenceKind === 'owned_content_result' ? '自有内容成果' : '外部参考'}</p>
            <p>播放 {observed(content.metrics.views?.value)} · 赞 {observed(content.metrics.likes?.value)} · 转 {observed(content.metrics.shares?.value)} · 评 {observed(content.metrics.comments?.value)}</p>
            <p>归因状态 {content.attributionStatus ?? 'unknown'} · 指标证据 {content.metricSnapshotRefs.join('、') || '暂无'}</p>
          </article>)}
        </div>}
      </>}
      {weekly&&<section aria-label="执行真实周复盘" className="space-y-3"><h4 className="text-sm font-semibold">生成本周冻结报告</h4><p className="text-sm">复用现有周复盘执行器，核验已发布内容、指标、询盘归因及下周配额。只执行当前周版本的复盘，不启动生产、发布或发送消息。</p>{operationBlockers.length>0&&<Alert type="warning" showIcon title="周复盘暂不可执行" description={<ul className="list-disc pl-4">{operationBlockers.map((reason,index)=><li key={index}>{reason}</li>)}</ul>}/>}<Button type="primary" loading={Boolean(operating?.busy)} disabled={!item||operationBlockers.length>0||Boolean(operating?.uncertain)||Boolean(item.report)} onClick={()=>void executeReview()}>{item?.report?'本周报告已冻结':'执行本周复盘并冻结报告'}</Button>{operating?.message&&<Alert type={operating.uncertain?'warning':'success'} title={operating.message} showIcon/>}</section>}
      <Button disabled={!task||Boolean(operating?.busy)} onClick={() => {setOperation(null);setRefresh(value => value + 1);}}>刷新真实只读证据</Button>
    </section>
  );
}
