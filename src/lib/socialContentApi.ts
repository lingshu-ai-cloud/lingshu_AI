import type {
  AddSocialTaskSourceInput,
  CreateSocialArtifactInput,
  CreateSocialContentTaskInput,
  CreateSocialDeliveryPackageInput,
  CreateSocialWeeklyPlanInput,
  DecideSocialArtifactInput,
  DecideSocialArtifactBatchInput,
  RegisterSocialPublicationInput,
  SelectSocialWorkPackagesInput,
  SocialContentArtifact,
  SocialContentFile,
  SocialContentSourceOption,
  SocialContentSourceOptionPage,
  SocialContentTaskDetail,
  SocialContentTaskPage,
  SocialContentWorkspace,
  SocialDeliveryPackage,
  SocialMetricSubmission,
  SocialPublicationRecord,
  SocialTaskSource,
  SocialWeeklyPlan,
  SubmitSocialMetricsInput,
  UpdateSocialContentTaskInput,
} from '../../shared/contracts/socialContentWorkflow';
import { authHeader } from './auth';
import { SOCIAL_CONTENT_MAX_FILE_BYTES, socialContentMimeForFileName } from './socialContentFiles';
import { normalizeSocialContentSourceQuery } from './socialContentSourcePicker';
import {
  socialMutationEnvelope,
  socialSourceOptionPage,
  socialTaskEnvelope,
  socialTaskPage,
  socialWorkspaceResponse,
  socialWeeklyPlanEnvelope,
} from './socialContentResponse';
import { safeArtifactHref } from './starterWorkspace';
import {
  notifySocialContentTaskChanged,
  socialContentTaskIdFromApiPath,
} from './socialContentTaskRefresh';

const BASE_PATH = '/api/overseas/starter-198/social-content';
const JSON_REQUEST_TIMEOUT_MS = 30_000;
const FILE_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_STATUSES = new Set([429, 503, 504]);

export interface SocialContentUploadResult {
  file: SocialContentFile;
  material: null | {
    id: string;
    sourceRef: string;
    sourceVersion: string;
  };
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `social-content-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function friendlyFailure(status: number, code = ''): string {
  if (code.includes('source_option_version_conflict')) return '资料已更新，请重新选择';
  if (code.includes('not_startable') || code.includes('not_editable')) return '当前阶段无法进行这项操作，请刷新任务状态';
  if (code.includes('orchestrator_not_configured') || code.includes('queue_unavailable')) return '内容制作服务正在准备中，请稍后重试';
  if (code.includes('social_content_reference_analysis_pending')) return '编导 Agent 正在逐镜分析参考视频，原任务已保留，可查看分析与制作进度';
  if (code.includes('social_content_reference_review_required')) return '逐镜复刻方案已准备好，原任务需要检查执行模式后继续制作';
  if (code.includes('social_content_execution_facts_required')) return '缺少最少必要事实。请补充企业资料、产品资料或已确认参数；无需补拍图片和视频';
  if (code.includes('social_content_execution_rights_required')) return '参考视频或素材的使用权尚未确认，请先补充授权信息';
  if (code.includes('social_content_execution_budget_required')) return '当前制作方案超过预算，请调整预算或选择更轻量的制作路线';
  if (code.includes('social_content_execution_goal_degraded')) return '当前素材只能完成降级版本，请先确认是否接受目标调整';
  if (code.includes('social_content_execution_director_review_required')) return '内容 Agent 的执行方案未通过编导审核，系统正在重新规划';
  if (code.includes('package') && (code.includes('inactive') || code.includes('unavailable'))) return '所选作业方案已更新，请重新选择';
  if (code.includes('social_content_task_inputs_incomplete')) return '请确认任务目标和必要事实；没有图片或视频也可以使用系统托管方案继续制作';
  if (code.includes('readiness') || code.includes('required') || code.includes('incomplete')) return '请确认内容目标、必要事实或授权信息；没有图片和视频也可以继续托管制作';
  if (code.includes('file_limit') || code.includes('file_capacity')) return '当前任务的文件数量或容量已达上限';
  if (code.includes('artifact_media_required')) return '请先生成并保存完整成品';
  if (code.includes('artifact_media') || code.includes('delivery_media')) return '成品文件校验失败，请重新生成后提交';
  if (code.includes('limit_reached')) return '当前任务的内容数量已达上限';
  if (status === 400 || status === 422) return '请检查填写内容后重试';
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '当前账号无法完成此操作';
  if (status === 404) return '这项内容不存在或已被移除';
  if (status === 409 || status === 412) return '任务已有更新，请刷新后重试';
  if (status === 413) return '文件过大，请压缩后重新上传';
  if (status === 415) return '暂不支持这种文件格式';
  if (status === 429) return '当前请求较多，请稍后重试';
  if (status >= 500) return '服务暂时不可用，请稍后重试';
  return '操作未完成，请重试';
}

export class SocialContentRequestError extends Error {
  constructor(readonly status: number, code = '') {
    super(friendlyFailure(status, code));
    this.name = 'SocialContentRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function errorCode(response: Response): Promise<string> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) && typeof value.error === 'string' ? value.error : '';
  } catch {
    return '';
  } finally {
    releaseResponse(response);
  }
}

type TransportFailureReason = 'cancelled' | 'timeout' | 'network';

class SocialContentTransportError extends Error {
  constructor(readonly reason: TransportFailureReason) {
    super(reason);
    this.name = 'SocialContentTransportError';
  }
}

type ResponseControl = {
  controller: AbortController;
  callerSignal?: AbortSignal | null;
  abort: () => void;
  timer: ReturnType<typeof setTimeout>;
};
const responseControls = new WeakMap<Response, ResponseControl>();

function releaseResponse(response: Response): void {
  const control = responseControls.get(response);
  if (!control) return;
  clearTimeout(control.timer);
  control.callerSignal?.removeEventListener('abort', control.abort);
  responseControls.delete(response);
}

function responseTransportFailure(response: Response): SocialContentTransportError | null {
  const control = responseControls.get(response);
  if (!control?.controller.signal.aborted) return null;
  return new SocialContentTransportError(control.callerSignal?.aborted ? 'cancelled' : 'timeout');
}

function readableTransportError(error: unknown, kind: 'read' | 'write' | 'upload'): Error {
  if (!(error instanceof SocialContentTransportError)) {
    return error instanceof Error ? error : new Error('网络连接不稳定，请检查网络后重试');
  }
  if (error.reason === 'cancelled') return new Error('操作已取消');
  if (kind === 'write') return new Error('网络响应中断，操作可能已提交；请先刷新任务状态，确认后再重试');
  if (kind === 'upload') {
    return new Error(error.reason === 'timeout'
      ? '文件上传等待时间过长，已停止上传，请检查网络后重试'
      : '文件上传连接中断，请检查网络后重试');
  }
  return new Error(error.reason === 'timeout'
    ? '内容读取等待时间过长，已停止等待，请稍后重试'
    : '内容读取连接中断，请检查网络后重试');
}

async function safeFetch(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) throw new SocialContentTransportError('cancelled');
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    responseControls.set(response, { controller, callerSignal: init.signal, abort, timer });
    return response;
  } catch {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
    if (init.signal?.aborted) throw new SocialContentTransportError('cancelled');
    if (controller.signal.aborted) throw new SocialContentTransportError('timeout');
    throw new SocialContentTransportError('network');
  }
}

export function socialContentReadRetryDelay(
  retryAfter: string | null,
  retryNumber: number,
  now = Date.now(),
  jitter = Math.floor(Math.random() * 251),
): number {
  const raw = String(retryAfter || '').trim();
  if (raw) {
    const seconds = Number(raw);
    const milliseconds = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1_000
      : Math.max(0, Date.parse(raw) - now);
    if (Number.isFinite(milliseconds)) return Math.min(15_000, Math.max(0, milliseconds));
  }
  const backoff = 500 * (2 ** Math.max(0, retryNumber - 1));
  return Math.min(15_000, backoff + Math.max(0, Math.min(250, jitter)));
}

async function wait(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw new SocialContentTransportError('cancelled');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => done(new SocialContentTransportError('cancelled'));
    function done(error?: Error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchReadWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await safeFetch(input, init, timeoutMs);
    } catch (error) {
      throw readableTransportError(error, 'read');
    }
    if (!READ_RETRY_STATUSES.has(response.status) || attempt === READ_RETRY_ATTEMPTS) return response;
    const delay = socialContentReadRetryDelay(response.headers.get('Retry-After'), attempt);
    await response.body?.cancel().catch(() => {});
    releaseResponse(response);
    try { await wait(delay, init.signal); }
    catch (error) { throw readableTransportError(error, 'read'); }
  }
  throw new Error('内容读取暂时不可用，请稍后重试');
}

async function responseJson<T>(response: Response, kind: 'read' | 'write' | 'upload'): Promise<T> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) throw new Error();
    return value as T;
  } catch (error) {
    const transport = responseTransportFailure(response);
    if (transport) throw readableTransportError(transport, kind);
    if (error instanceof SocialContentTransportError) throw readableTransportError(error, kind);
    throw new Error('内容服务响应异常，请稍后重试');
  } finally {
    releaseResponse(response);
  }
}

async function requestJson<T>(path: string, options?: RequestInit, operationKey?: string): Promise<T> {
  const method = String(options?.method || 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';
  const init: RequestInit = {
    ...options,
    cache: 'no-store',
    headers: {
      ...authHeader(),
      Accept: 'application/json',
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!readOnly ? { 'Idempotency-Key': operationKey || idempotencyKey() } : {}),
      ...(options?.headers || {}),
    },
  };
  let response: Response;
  try {
    response = readOnly
      ? await fetchReadWithRetry(`${BASE_PATH}${path}`, init, JSON_REQUEST_TIMEOUT_MS)
      : await safeFetch(`${BASE_PATH}${path}`, init, JSON_REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw readOnly ? readableTransportError(error, 'read') : readableTransportError(error, 'write');
  }
  if (!response.ok) throw new SocialContentRequestError(response.status, await errorCode(response));
  const result = await responseJson<T>(response, readOnly ? 'read' : 'write');
  if (!readOnly) {
    notifySocialContentTaskChanged(socialContentTaskIdFromApiPath(path));
  }
  return result;
}

async function uploadContentFile(taskId: string, file: Blob, name: string, usage: SocialContentFile['usage'], operationKey?: string): Promise<SocialContentUploadResult> {
  const query = new URLSearchParams({ usage, name });
  const init: RequestInit = {
    method: 'POST',
    cache: 'no-store',
    headers: {
      ...authHeader(),
      Accept: 'application/json',
      'Content-Type': socialContentMimeForFileName(name, file.type),
      'Idempotency-Key': operationKey || idempotencyKey(),
    },
    body: file,
  };
  let response: Response;
  try {
    response = await safeFetch(`${BASE_PATH}/tasks/${encodeURIComponent(taskId)}/files?${query}`, init, FILE_UPLOAD_TIMEOUT_MS);
  } catch (error) {
    throw readableTransportError(error, 'upload');
  }
  if (!response.ok) throw new SocialContentRequestError(response.status, await errorCode(response));
  const result = await responseJson<{ file: SocialContentFile; material?: unknown }>(response, 'upload');
  if (!isRecord(result.file) || typeof result.file.fileRef !== 'string' || typeof result.file.sha256 !== 'string') {
    throw new Error('文件上传结果异常，请重试');
  }
  const rawMaterial = isRecord(result.material) ? result.material : null;
  const material = rawMaterial
    && typeof rawMaterial.id === 'string'
    && typeof rawMaterial.sourceRef === 'string'
    && /^socialmaterial:[a-zA-Z0-9_-]+$/.test(rawMaterial.sourceRef)
    && typeof rawMaterial.sourceVersion === 'string'
    && rawMaterial.sourceVersion.length > 0
    ? {
      id: rawMaterial.id,
      sourceRef: rawMaterial.sourceRef,
      sourceVersion: rawMaterial.sourceVersion,
    }
    : null;
  notifySocialContentTaskChanged(taskId);
  return { file: result.file, material };
}

const PREVIEW_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

function responseFilename(response: Response): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let value = encoded ? decodeURIComponent(encoded) : plain || '内容成品';
  value = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  return value || '内容成品';
}

async function responseBlob(response: Response): Promise<Blob> {
  try {
    return await response.blob();
  } catch (error) {
    const transport = responseTransportFailure(response);
    if (transport) throw readableTransportError(transport, 'read');
    throw error instanceof Error ? error : new Error('文件读取失败，请稍后重试');
  } finally {
    releaseResponse(response);
  }
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
  releaseResponse(response);
}

async function fetchArtifactMedia(taskId: string, artifactId: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const path = `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/media`;
  const response = await fetchReadWithRetry(`${BASE_PATH}${path}`, {
    cache: 'no-store',
    signal,
    headers: { ...authHeader(), Accept: 'image/*,video/*' },
  }, MEDIA_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new SocialContentRequestError(response.status, await errorCode(response));
  const mediaType = (response.headers.get('Content-Type') || '').toLowerCase().split(';', 1)[0];
  const declaredSize = Number(response.headers.get('Content-Length'));
  if (!PREVIEW_MEDIA_TYPES.has(mediaType)) {
    await discardResponse(response);
    throw new Error('此成品暂不支持在线预览');
  }
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > SOCIAL_CONTENT_MAX_FILE_BYTES) {
    await discardResponse(response);
    throw new Error('成品文件校验失败，请重新生成后提交');
  }
  const blob = await responseBlob(response);
  if (blob.size !== declaredSize || blob.type.toLowerCase().split(';', 1)[0] !== mediaType) {
    throw new Error('成品文件校验失败，请重新生成后提交');
  }
  return { blob, filename: responseFilename(response) };
}

export function safeSocialDeliveryPackageHref(value: string): string | null {
  const safeHref = safeArtifactHref(value);
  if (!safeHref || typeof window === 'undefined') return null;
  const url = new URL(safeHref);
  if (url.origin !== window.location.origin) return null;
  return /^\/api\/overseas\/starter-198\/social-content\/delivery-packages\/[^/]+\/download\/?$/.test(url.pathname)
    ? url.href
    : null;
}

async function fetchDeliveryPackage(href: string): Promise<{ blob: Blob; filename: string }> {
  const safeHref = safeSocialDeliveryPackageHref(href);
  if (!safeHref) throw new Error('交付包下载地址无效，请刷新任务后重试');
  const response = await fetchReadWithRetry(safeHref, {
    cache: 'no-store',
    headers: { ...authHeader(), Accept: 'application/zip,application/octet-stream' },
  }, MEDIA_DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new SocialContentRequestError(response.status, await errorCode(response));
  return { blob: await responseBlob(response), filename: responseFilename(response) };
}

export const socialContentApi = {
  getWorkspace: async (): Promise<SocialContentWorkspace> => socialWorkspaceResponse(await requestJson<unknown>('')),
  listTasks: async (page = 1, perPage = 50): Promise<SocialContentTaskPage> => {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new Error('任务列表页码无效，请重新加载');
    }
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
    return socialTaskPage(await requestJson<unknown>(`/tasks?${params}`));
  },
  getSourceOptions: async (kind: SocialContentSourceOption['kind'], query = '', page = 1, perPage = 24): Promise<SocialContentSourceOptionPage> => {
    const params = new URLSearchParams({ kind, page: String(page), perPage: String(perPage) });
    const normalizedQuery = normalizeSocialContentSourceQuery(query);
    if (normalizedQuery) params.set('query', normalizedQuery);
    return socialSourceOptionPage(await requestJson<unknown>(`/source-options?${params}`));
  },
  getTask: async (taskId: string, signal?: AbortSignal): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}`, { signal })),
  refreshReference: async (taskId: string, expectedVersion: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/refresh-reference`, { method: 'POST', body: JSON.stringify({ expectedVersion }) }, idempotencyKey())),
  createTask: async (input: CreateSocialContentTaskInput, operationKey?: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>('/tasks', { method: 'POST', body: JSON.stringify(input) }, operationKey)),
  createWeeklyPlan: async (input: CreateSocialWeeklyPlanInput, operationKey?: string): Promise<{ weeklyPlan: SocialWeeklyPlan; tasks: SocialContentTaskDetail[] }> => (
    socialWeeklyPlanEnvelope(await requestJson<unknown>('/weekly-plans', { method: 'POST', body: JSON.stringify(input) }, operationKey))
  ),
  updateTask: async (taskId: string, input: UpdateSocialContentTaskInput, operationKey?: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(input) }, operationKey)),
  addSource: async (taskId: string, input: AddSocialTaskSourceInput, operationKey?: string): Promise<{ source: SocialTaskSource; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/sources`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'source') as unknown as { source: SocialTaskSource; task: SocialContentTaskDetail }
  ),
  removeSource: async (taskId: string, sourceId: string, expectedTaskVersion: string, operationKey?: string): Promise<{ source: SocialTaskSource; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE', body: JSON.stringify({ expectedTaskVersion }) }, operationKey), 'source') as unknown as { source: SocialTaskSource; task: SocialContentTaskDetail }
  ),
  uploadFile: (taskId: string, file: File, usage: Extract<SocialContentFile['usage'], 'source' | 'metric_evidence'>, operationKey?: string) => (
    uploadContentFile(taskId, file, file.name, usage, operationKey)
  ),
  uploadArtifactMedia: async (taskId: string, file: Blob, name: string, operationKey?: string) => (
    (await uploadContentFile(taskId, file, name, 'artifact_media', operationKey)).file
  ),
  fetchArtifactMedia,
  selectPackages: async (taskId: string, input: SelectSocialWorkPackagesInput, operationKey?: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/package-selection`, { method: 'PUT', body: JSON.stringify(input) }, operationKey)),
  startTask: async (taskId: string, expectedVersion: string, operationKey?: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/start`, { method: 'POST', body: JSON.stringify({ expectedVersion }) }, operationKey)),
  createArtifact: async (taskId: string, input: CreateSocialArtifactInput, operationKey?: string): Promise<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/artifacts`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'artifact') as unknown as { artifact: SocialContentArtifact; task: SocialContentTaskDetail }
  ),
  decideArtifact: async (taskId: string, artifactId: string, input: DecideSocialArtifactInput, operationKey?: string): Promise<{ artifact: SocialContentArtifact; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/decision`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'artifact') as unknown as { artifact: SocialContentArtifact; task: SocialContentTaskDetail }
  ),
  decideArtifactBatch: async (taskId: string, input: DecideSocialArtifactBatchInput, operationKey?: string): Promise<SocialContentTaskDetail> => socialTaskEnvelope(
    await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/artifacts/batch-decision`, { method: 'POST', body: JSON.stringify(input) }, operationKey),
  ),
  createDeliveryPackage: async (taskId: string, input: CreateSocialDeliveryPackageInput, operationKey?: string): Promise<{ deliveryPackage: SocialDeliveryPackage; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/delivery-packages`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'deliveryPackage') as unknown as { deliveryPackage: SocialDeliveryPackage; task: SocialContentTaskDetail }
  ),
  registerPublication: async (taskId: string, input: RegisterSocialPublicationInput, operationKey?: string): Promise<{ publication: SocialPublicationRecord; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/tasks/${encodeURIComponent(taskId)}/publications`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'publication') as unknown as { publication: SocialPublicationRecord; task: SocialContentTaskDetail }
  ),
  submitMetrics: async (publicationId: string, input: SubmitSocialMetricsInput, operationKey?: string): Promise<{ metricSubmission: SocialMetricSubmission; task: SocialContentTaskDetail }> => (
    socialMutationEnvelope(await requestJson<unknown>(`/publications/${encodeURIComponent(publicationId)}/metrics`, { method: 'POST', body: JSON.stringify(input) }, operationKey), 'metricSubmission') as unknown as { metricSubmission: SocialMetricSubmission; task: SocialContentTaskDetail }
  ),
  downloadPackage: async (href: string): Promise<void> => {
    const result = await fetchDeliveryPackage(href);
    const objectUrl = URL.createObjectURL(result.blob);
    try {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = result.filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  },
};
