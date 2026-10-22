import { Button } from 'antd';
import { ExternalLink, Loader2, MessageSquare, Send } from 'lucide-react';
import type { BusinessDestination, DataAvailability, DigitalEmployeeOverview } from '../../lib/digitalEmployees';

export type OpenBusinessLink = (
  page: BusinessDestination,
  view?: 'create' | 'publish',
  businessRef?: Record<string, unknown>,
) => void;

const availabilityLabel: Record<DataAvailability, string> = {
  available: "已取得",
  pending: "等待回流",
  unavailable: "暂不可用",
};
const availabilityTone: Record<DataAvailability, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  unavailable: "border-slate-200 bg-slate-100 text-slate-500",
};

function AvailabilityBadge({ status }: { status: DataAvailability }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${availabilityTone[status]}`}
    >
      {availabilityLabel[status]}
    </span>
  );
}

export function BatchFollowupTruthPanel({
  data,
  onOpen,
  onDispatch,
  busy,
  statusLabel,
}: {
  data: DigitalEmployeeOverview;
  onOpen: OpenBusinessLink;
  onDispatch?: (batchId: string) => void;
  busy?: boolean;
  statusLabel: Record<string, string>;
}) {
  const byKey = (key: string) =>
    data.tasks.find((task) => task.task_key === key);
  const draft = byKey("followup_batch_draft");
  const approval = byKey("followup_batch_approval");
  const dispatch = byKey("followup_dispatch");
  const workerStatus = String(
    dispatch?.output?.bulkWorkerStatus || "manual_or_scheduled",
  );
  const workerScheduled = workerStatus === "scheduled";
  const messagingAuthorization =
    dispatch?.output?.messagingAuthorization &&
    typeof dispatch.output.messagingAuthorization === "object"
      ? (dispatch.output.messagingAuthorization as Record<string, unknown>)
      : {};
  const manualSendAllowed =
    messagingAuthorization.manualFollowupSendAllowed === true;
  const dispatchBlockedReason = String(dispatch?.blocked_reason || "").trim();
  const refs = [
    ...(draft?.business_refs || []),
    ...(Array.isArray(draft?.output?.businessRefs)
      ? (draft.output.businessRefs as Array<Record<string, unknown>>)
      : []),
  ];
  const batchId = String(
    refs.find((ref) => ref.type === "followup_batch")?.id || "",
  );
  const steps: Array<{
    title: string;
    detail: string;
    status: DataAvailability;
  }> = [
    {
      title: "1. 逐客生成草稿",
      detail: draft
        ? statusLabel[draft.status] || "状态待确认"
        : "等待创建真实客群与逐客草稿",
      status: draft?.status === "succeeded" ? "available" : "pending",
    },
    {
      title: "2. 整批人工批准",
      detail: approval
        ? statusLabel[approval.status] || "状态待确认"
        : "草稿完成后才能进入整批批准",
      status: approval?.status === "succeeded" ? "available" : "pending",
    },
    {
      title: dispatch?.output?.messagesSent
        ? "3. 真实发送回执"
        : "3. 真实发送预检",
      detail: dispatch?.output?.messagesSent
        ? `已有 ${String(dispatch.output.messagesSent)} 位客户取得真实发送回执`
        : dispatchBlockedReason
          ? dispatchBlockedReason
          : workerScheduled
          ? "发送执行服务（Worker）已启用定时扫描，将按逐客时区发送并回写渠道回执"
          : "发送执行服务当前为手动触发模式，发送前仍会执行授权与安全复核",
      status: dispatch?.status === "succeeded" ? "available" : "pending",
    },
  ];
  return (
    <section className="insight-note rounded-lg border border-insight/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-text-primary">
            <MessageSquare size={18} />
            <h2 className="font-semibold">批量跟进执行边界</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            批准的是逐客草稿批次，不等于消息已经发出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            htmlType="button"
            onClick={() =>
              onOpen("conversion", undefined, {
                capabilityKey: "customer.followup_drafts",
                stage: "batch_followup",
              })
            }
            className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-accent-dim"
          >
            进入客户工作台 <ExternalLink size={12} />
          </Button>
          {onDispatch &&
            batchId &&
            approval?.status === "succeeded" &&
            dispatch?.status !== "succeeded" && (
              <Button
                htmlType="button"
                disabled={!manualSendAllowed || busy}
                onClick={() => onDispatch(batchId)}
                title={
                  manualSendAllowed
                    ? "发送当前已到期且通过预检的客户"
                    : dispatchBlockedReason || "租户真实发送授权或 Messenger 渠道尚未就绪"
                }
                className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                {manualSendAllowed ? "发送已到期客户" : "真实发送未就绪"}
              </Button>
            )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.title}
            className="rounded-lg border border-white bg-white/80 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800">{step.title}</p>
              <AvailabilityBadge status={step.status} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
