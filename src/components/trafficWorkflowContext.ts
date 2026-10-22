export function contentCreationAspectRatio(aspectRatio?: number, width?: number, height?: number): '9:16' | '1:1' | '16:9' | undefined {
  const measured = Number(aspectRatio) > 0
    ? Number(aspectRatio)
    : Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : 0;
  if (!Number.isFinite(measured) || measured <= 0) return undefined;
  if (measured > 1.12) return '16:9';
  if (measured < 0.89) return '9:16';
  return '1:1';
}

export type DigitalEmployeeWorkflowContext = {
  runId: string;
  taskId: string;
  taskKey: string;
  entityId?: string;
  preview?: boolean;
};

const DIGITAL_EMPLOYEE_CONTEXT_TTL = 15 * 60 * 1000;

export function parseDigitalEmployeeWorkflowContext(
  raw: string,
  now = Date.now(),
): DigitalEmployeeWorkflowContext | null {
  try {
    const parsed = JSON.parse(raw) as {
      page?: string;
      runId?: string;
      taskId?: string;
      workflowRunId?: string;
      workflowTaskId?: string;
      issuedAt?: number;
      businessRef?: { taskKey?: string; preview?: boolean; entityId?: string };
    };
    const runId = String(parsed.workflowRunId || parsed.runId || '').trim();
    const taskId = String(parsed.workflowTaskId || parsed.taskId || '').trim();
    const preview = parsed.businessRef?.preview === true;
    if (
      parsed.page !== 'smartAssets' ||
      (!preview && (!runId || !taskId)) ||
      (preview && !String(parsed.businessRef?.taskKey || '').trim()) ||
      !Number.isFinite(parsed.issuedAt) ||
      now - Number(parsed.issuedAt) > DIGITAL_EMPLOYEE_CONTEXT_TTL
    ) return null;
    return {
      runId,
      taskId,
      taskKey: String(parsed.businessRef?.taskKey || ''),
      ...(parsed.businessRef?.entityId ? { entityId: parsed.businessRef.entityId } : {}),
      ...(preview ? { preview: true } : {}),
    };
  } catch {
    return null;
  }
}

export function consumeDigitalEmployeeWorkflowContext(): DigitalEmployeeWorkflowContext | null {
  try {
    const raw = sessionStorage.getItem('digitalEmployee.businessDeepLink');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { page?: string };
    if (parsed.page !== 'smartAssets') return null;
    sessionStorage.removeItem('digitalEmployee.businessDeepLink');
    return parseDigitalEmployeeWorkflowContext(raw);
  } catch {
    return null;
  }
}
