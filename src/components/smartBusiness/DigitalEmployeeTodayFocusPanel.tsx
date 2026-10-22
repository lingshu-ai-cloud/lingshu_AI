import { Button } from 'antd';
import { ChevronRight } from 'lucide-react';
import { taskNeedsAttention } from '../../lib/taskExecutionState';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';

export function TodayFocusPanel({ data, onOpenExecution, onReviewPlan, runStatusLabel }: {
  data: DigitalEmployeeOverview;
  onOpenExecution: (taskId?: string) => void;
  onReviewPlan: () => void;
  runStatusLabel: (status: string) => string;
}) {
  const blockedTask = data.tasks.find(
    (task) => taskNeedsAttention(task),
  );
  const pendingApprovals = data.approvals.filter((item) => item.status === "pending");
  const completed = data.tasks.filter((task) => task.status === "succeeded").length;
  const progress = data.tasks.length
    ? Math.round((completed / data.tasks.length) * 100)
    : 0;
  const isDraft = data.goal?.status === "draft";
  const attentionItems = [
    isDraft && data.plan ? {
      title: "本周计划待确认",
      detail: `已编排 ${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 项任务，查看计划并确认后启动。`,
      action: onReviewPlan,
      tone: "bg-slate-50 text-slate-800",
    } : null,
    ...pendingApprovals.map((approval) => {
      const task = data.tasks.find((item) => item.id === approval.task_id);
      return task
        ? {
            title: task.title,
            detail: "等待你的审核",
            action: () => onOpenExecution(task.id),
            tone: "bg-amber-50 text-amber-800",
          }
        : null;
    }),
    blockedTask && !pendingApprovals.some((approval) => approval.task_id === blockedTask.id)
      ? {
          title: blockedTask.title,
          detail: blockedTask.blocked_reason || "需要选择下一步",
          action: () => onOpenExecution(blockedTask.id),
          tone: "bg-red-50 text-red-800",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visibleAttentionItems = attentionItems.slice(0, 3);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">本周进度</h2>
            <p className="mt-1 text-xs text-slate-500">
              {data.goal
                ? `${data.goal.title} · ${data.goal.startsAt} 至 ${data.goal.endsAt}`
                : "还没有开始本周目标"}
            </p>
          </div>
          {data.run && (
            <Button
              htmlType="button"
              onClick={() => onOpenExecution()}
              className="!h-auto min-h-9 !whitespace-normal text-xs font-bold text-slate-600 hover:text-slate-950"
            >
              查看任务执行 →
            </Button>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">计划状态</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {isDraft
                ? data.plan ? "待确认" : "计划生成中"
                : data.run
                  ? runStatusLabel(data.run.status)
                  : "尚未制定"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">{isDraft ? "计划任务" : "已完成任务"}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {isDraft ? (data.plan ? `${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 项` : "生成中") : `${completed} / ${data.tasks.length}`}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">{isDraft ? "执行状态" : "当前完成度"}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{isDraft ? "尚未启动" : data.tasks.length ? `${progress}%` : "—"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">需要你处理</h2>
            <p className="mt-1 text-xs text-slate-500">只显示会阻塞计划或需要你确认的事项。</p>
          </div>
          {attentionItems.length > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{attentionItems.length} 项</span>}
        </div>
        {attentionItems.length ? (
          <div className="mt-4 space-y-2">
            {visibleAttentionItems.map((item) => (
              <Button
                key={item.title}
                htmlType="button"
                onClick={item.action}
                className={`!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between gap-4 rounded-lg px-4 py-3 text-left ${item.tone}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{item.title}</span>
                  <span className="mt-1 block truncate text-xs opacity-70">{item.detail}</span>
                </span>
                <ChevronRight size={17} className="shrink-0" />
              </Button>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-5 text-sm font-semibold text-emerald-800">
            暂时没有需要你处理的事项。
          </div>
        )}
      </section>
    </div>
  );
}
