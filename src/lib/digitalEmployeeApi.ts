import { authHeader } from './auth';
import type { ReviewTodoBoard } from './reviewTodos';
import type { WeeklyPackage } from './weeklyPackage';
import type { DirectorDecision, DirectorDecisionReason } from './directorDecision';
import type { DigitalEmployeeConfig, DigitalEmployeeOverview, FollowupDispatchResponse, PublishingTarget, RunEvent, WeeklyGoal } from './digitalEmployees';

const BASE = "/api/overseas/digital-employees";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    missing?: string[];
    effects?: Array<Record<string, unknown>>;
  };
  if (!response.ok) {
    const detail = body.missing?.length ? `：${body.missing.join("、")}` : "";
    const effectDetail = body.effects?.length
      ? `（检测到 ${body.effects.length} 条真实外部回执，未覆盖执行）`
      : "";
    const friendlyErrors: Record<string, string> = {
      active_goal_exists: "已有一轮目标正在执行，请先完成或取消当前运行",
      task_not_blocked: "当前任务不需要恢复操作",
      task_not_retryable: "当前任务不能重试，请先纠偏或人工处理",
      manual_completion_not_allowed:
        "该任务涉及真实对外动作，不能直接标记完成人工执行",
      skip_not_allowed: "该任务会影响后续真实业务动作，不能直接跳过",
      missing_required_resources: "启动前仍有必需业务资产未就绪",
    };
    throw new Error(
      `${body.message || friendlyErrors[body.error || ""] || body.error || "请求失败"}${detail}${effectDetail}`,
    );
  }
  return body;
}

export const digitalEmployeeApi = {
  publishingAccounts: () =>
    request<{ items: Array<PublishingTarget & { status: "connected" }> }>(
      "/publishing-accounts",
    ),
  agentUsageCosts: () => request<{ roles: Record<'business' | 'director' | 'content' | 'customer', { settledCny: number; entryCount: number; updatedAt: string | null; source: string } | null> }>("/agent-usage-costs"),
  overview: (goalId = "", range?: { startsAt: string; endsAt: string }) =>
    request<DigitalEmployeeOverview>(
      `/overview?${new URLSearchParams({ ...(goalId ? { goalId } : {}), ...(range || {}) }).toString()}`,
    ),
  completeOnboarding: (config: DigitalEmployeeConfig) =>
    request<DigitalEmployeeOverview>("/onboarding/complete", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  reviewTodos: (week: string) => request<ReviewTodoBoard>(`/review-todos?week=${encodeURIComponent(week)}`),
  saveReviewTodos: (board: ReviewTodoBoard) => request<ReviewTodoBoard>('/review-todos', { method: 'PUT', body: JSON.stringify(board) }),
  dispatchReviewTodos: (week: string, revision: number) => request<ReviewTodoBoard>('/review-todos/dispatch', { method: 'POST', body: JSON.stringify({ week, revision }) }),
  createGoal: (
    goal: Omit<
      WeeklyGoal,
      "id" | "status" | "version" | "createdAt" | "updatedAt"
    >,
  ) =>
    request<DigitalEmployeeOverview>("/goals", {
      method: "POST",
      body: JSON.stringify(goal),
    }),
  recommendPackage: (goalId: string) => request<WeeklyPackage>(`/goals/${encodeURIComponent(goalId)}/package/recommend`, { method: "POST" }),
  savePackage: (goalId: string, pack: WeeklyPackage) => request<DigitalEmployeeOverview>(`/goals/${encodeURIComponent(goalId)}/package`, { method: "PUT", body: JSON.stringify(pack) }),
  linkTaskProject: (runId: string, taskId: string, projectId: string) => request<DigitalEmployeeOverview>(`/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/link-project`, { method: "POST", body: JSON.stringify({ projectId }) }),
  packageOptions: () => request<{ members: Array<{ id: string; name: string }>; projects: Array<{ id: string; title: string }>; customers: Array<{ id: string; name: string }> }>("/package-options"),
  approveGoal: (goalId: string, packageRevision?: number) =>
    request<DigitalEmployeeOverview>(
      `/goals/${encodeURIComponent(goalId)}/approve`,
      { method: "POST", body: JSON.stringify({ packageRevision }) },
    ),
  decideApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    note = "",
  ) =>
    request<DigitalEmployeeOverview>(
      `/approvals/${encodeURIComponent(approvalId)}/decide`,
      { method: "POST", body: JSON.stringify({ decision, note }) },
    ),
  handoffTask: (taskId: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/handoff`,
      { method: "POST" },
    ),
  returnTask: (taskId: string, note = "") =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/return-to-agent`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  pauseRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/pause`,
      { method: "POST", body: JSON.stringify({ reason: "人工暂停" }) },
    ),
  resumeRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/resume`,
      { method: "POST" },
    ),
  cancelRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  reconcileRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/reconcile`,
      { method: "POST" },
    ),
  correctTask: (
    taskId: string,
    input: {
      instruction: string;
      scope: "one_off" | "rule_candidate";
      rerunDownstream: boolean;
    },
  ) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/corrections`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  directorDecision: (taskId: string, input: { contentId: string; decision: DirectorDecision; reason?: DirectorDecisionReason; applyToSimilar?: boolean }) =>
    request<DigitalEmployeeOverview>(`/tasks/${encodeURIComponent(taskId)}/director-decision`, { method: 'POST', body: JSON.stringify(input) }),
  retryTask: (taskId: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: "POST" },
    ),
  skipTask: (taskId: string, note: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/skip`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  completeTask: (
    taskId: string,
    note: string,
    output?: Record<string, unknown>,
  ) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ note, ...(output ? { output } : {}) }),
      },
    ),
  dispatchFollowupBatch: async (batchId: string) =>
    (
      await request<FollowupDispatchResponse>(
        `/followup-batches/${encodeURIComponent(batchId)}/dispatch`,
        { method: "POST" },
      )
    ).overview,
};

export async function streamRunEvents(
  runId: string,
  afterSequence: number,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  onConnected?: () => void,
): Promise<void> {
  const response = await fetch(
    `${BASE}/runs/${encodeURIComponent(runId)}/stream?after=${afterSequence}`,
    {
      headers: { ...authHeader(), Accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok || !response.body) throw new Error("实时生产现场连接失败");
  onConnected?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const seen = new Set<string>();
  const consumePacket = (packet: string) => {
    if (!packet.trim() || signal.aborted) return;
    const dataLines: string[] = [];
    let eventId = "";
    for (const line of packet.split(/\r\n|\n|\r/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const rawValue = separator < 0 ? "" : line.slice(separator + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "id") eventId = value;
      if (field === "data") dataLines.push(value);
    }
    if (!dataLines.length) return;
    try {
      const event = JSON.parse(dataLines.join("\n")) as RunEvent;
      const sequence = Number(event.sequence || 0);
      if (sequence && sequence <= afterSequence) return;
      const identity =
        eventId || event.id || (sequence ? `${runId}:${sequence}` : "");
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      onEvent(event);
    } catch {
      /* one malformed SSE packet must not poison later packets */
    }
  };
  const drain = (flush = false) => {
    while (buffer) {
      const boundary = buffer.match(/(?:\r\n|\n|\r){2}/);
      if (!boundary || boundary.index === undefined) break;
      consumePacket(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (flush && buffer.trim()) {
      consumePacket(buffer);
      buffer = "";
    }
  };
  const abortReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abortReader, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    if (!signal.aborted) {
      buffer += decoder.decode();
      drain(true);
    }
  } finally {
    signal.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}
