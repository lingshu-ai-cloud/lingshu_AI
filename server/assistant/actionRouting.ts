import type {
  AssistantActionId,
  AssistantActionIntent,
  AssistantActionRequest,
  AssistantActionResponse,
  AssistantActionTarget,
  AssistantCompactCard,
  AssistantNotification,
  AssistantWorkspaceLink,
} from '../../shared/contracts/assistantActions.js';
import { isAssistantActionId } from '../../shared/contracts/assistantActions.js';

const MAX_TEXT_LENGTH = 4_000;
const SAFE_ID = /^[a-z0-9:_-]{1,200}$/i;
const SAFE_REQUEST_ID = /^[a-z0-9:_-]{8,200}$/i;
const SAFE_PAGE = /^[a-z][a-z0-9_-]{0,79}$/i;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const CHOICE_ACTIONS = new Set<AssistantActionId>([
  'confirm_choice', 'accept_result', 'request_revision',
]);

const MUTATION_ACTIONS = new Set<AssistantActionId>([
  'prepare_schedule_change',
  'confirm_schedule_change',
  'start_task',
  'pause_task',
  'resume_task',
  'confirm_choice',
  'accept_result',
  'request_revision',
]);

const CHOICE_VALUES: Record<'confirm_choice' | 'accept_result' | 'request_revision', Readonly<Record<string, string>>> = {
  confirm_choice: { approve: 'approved', request_revision: 'revision_requested' },
  accept_result: { accept_result: 'accepted' },
  request_revision: { request_revision: 'revision_requested' },
};

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}

function invalidParameters(): never {
  throw new AssistantActionError('assistant_action_parameters_invalid', 400, '操作参数无效。');
}

/**
 * Validate the executable parameter surface independently from the UI. The
 * nested `parameters` object is intentionally tiny; it is decision metadata,
 * never a free-form command envelope.
 */
export function normalizeAssistantActionParameters(
  actionId: AssistantActionId,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const source = value ?? {};
  if (CHOICE_ACTIONS.has(actionId)) {
    if (!exactKeys(source, ['option', 'value', 'parameters'])) invalidParameters();
    const option = text(source.option);
    const selectedValue = text(source.value);
    if (!option && !selectedValue && source.parameters === undefined) return {};
    const choiceParameters = source.parameters === undefined ? {} : record(source.parameters);
    if (!choiceParameters || !exactKeys(choiceParameters, ['note'])) invalidParameters();
    const note = text(choiceParameters.note);
    if (note.length > 2_000 || (choiceParameters.note !== undefined && !note)) invalidParameters();
    const allowed = CHOICE_VALUES[actionId as keyof typeof CHOICE_VALUES];
    if (!option || allowed[option] !== selectedValue) invalidParameters();
    return {
      option,
      value: selectedValue,
      parameters: note ? { note } : {},
    };
  }

  const allowed: Record<Exclude<AssistantActionId, 'confirm_choice' | 'accept_result' | 'request_revision'>, readonly string[]> = {
    open_workspace: ['page'],
    view_status: [],
    search: ['query', 'page'],
    prepare_schedule_change: ['platform', 'sourceWeekday', 'targetWeekday', 'count'],
    confirm_schedule_change: [],
    start_task: ['goal'],
    pause_task: ['reason'],
    resume_task: [],
  };
  if (!exactKeys(source, allowed[actionId as keyof typeof allowed] ?? [])) invalidParameters();
  if (actionId === 'open_workspace') {
    const page = text(source.page);
    if (page && !SAFE_PAGE.test(page)) invalidParameters();
    return page ? { page } : {};
  }
  if (actionId === 'search') {
    const query = text(source.query);
    const page = text(source.page);
    if (!query || query.length > MAX_TEXT_LENGTH || (page && !SAFE_PAGE.test(page))) invalidParameters();
    return { query, ...(page ? { page } : {}) };
  }
  if (actionId === 'prepare_schedule_change') {
    const platform = text(source.platform).toLowerCase();
    const sourceWeekday = Number(source.sourceWeekday);
    const targetWeekday = Number(source.targetWeekday);
    const count = Number(source.count);
    if (!['tiktok', 'youtube', 'instagram', 'facebook'].includes(platform)
      || !Number.isInteger(sourceWeekday) || sourceWeekday < 0 || sourceWeekday > 6
      || !Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6
      || !Number.isInteger(count) || count < 1 || count > 20) invalidParameters();
    return { platform, sourceWeekday, targetWeekday, count };
  }
  if (actionId === 'start_task') {
    const goal = text(source.goal);
    if (!goal || goal.length > MAX_TEXT_LENGTH) invalidParameters();
    return { goal };
  }
  if (actionId === 'pause_task') {
    const reason = text(source.reason);
    if (reason.length > 500) invalidParameters();
    return reason ? { reason } : {};
  }
  return {};
}

export class AssistantActionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'AssistantActionError';
  }
}

export class AssistantActionConflictError extends AssistantActionError {
  constructor(message = '这个操作基于旧版本，请刷新后再试。') {
    super('assistant_action_stale', 409, message);
    this.name = 'AssistantActionConflictError';
  }
}

export type AssistantActionContext = {
  tenantId: string;
  userId: string;
  authorization?: string;
  page?: string;
};

export type AssistantBusinessCommand = {
  actionId: AssistantActionId;
  requestId: string;
  target?: AssistantActionTarget;
  parameters: Record<string, unknown>;
};

export type AssistantBusinessResult = {
  status?: 'completed' | 'accepted' | 'approval_required' | 'missing_required_input' | 'not_handled' | 'failed';
  title?: string;
  summary: string;
  details?: string[];
  items?: AssistantCompactCard['items'];
  version?: string;
  workspace?: AssistantWorkspaceLink;
  primaryAction?: import('../../shared/contracts/assistantActions.js').AssistantCardAction;
  secondaryActions?: import('../../shared/contracts/assistantActions.js').AssistantCardAction[];
};

export interface AssistantBusinessCommandBus {
  execute(command: AssistantBusinessCommand, context: AssistantActionContext): Promise<AssistantBusinessResult>;
}

export type AssistantActionSupportProbe = (
  command: AssistantBusinessCommand,
  context: AssistantActionContext,
) => Promise<boolean>;

export interface AssistantAgentDelegator {
  delegate(input: {
    text: string;
    requestId: string;
    context: AssistantActionContext;
  }): Promise<{ title?: string; summary: string; workspace?: AssistantWorkspaceLink }>;
}

export type AssistantActionService = {
  route(input: unknown, context: AssistantActionContext): Promise<AssistantActionResponse>;
};

function boundedParameters(value: unknown): Record<string, unknown> {
  const parsed = value === undefined ? {} : record(value);
  let encoded = '';
  try { encoded = parsed ? JSON.stringify(parsed) : ''; }
  catch { encoded = ''; }
  if (!parsed || !encoded || Buffer.byteLength(encoded, 'utf8') > 16 * 1024) {
    throw new AssistantActionError('assistant_action_parameters_invalid', 400, '操作参数无效。');
  }
  return parsed;
}

function parseTarget(value: unknown): AssistantActionTarget | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source || !exactKeys(source, ['objectType', 'objectId', 'expectedVersion'])) {
    throw new AssistantActionError('assistant_action_target_invalid', 400, '操作对象无效。');
  }
  const objectType = text(source.objectType);
  if (!['workspace', 'run', 'approval', 'result', 'search', 'schedule_change'].includes(objectType)) {
    throw new AssistantActionError('assistant_action_target_invalid', 400, '操作对象无效。');
  }
  const objectId = text(source.objectId);
  const expectedVersion = text(source.expectedVersion);
  if ((objectId && !SAFE_ID.test(objectId))
    || expectedVersion.length > 200
    || /[\u0000-\u001f\u007f]/u.test(expectedVersion)) {
    throw new AssistantActionError('assistant_action_target_invalid', 400, '操作对象无效。');
  }
  return {
    objectType: objectType as AssistantActionTarget['objectType'],
    ...(objectId ? { objectId } : {}),
    ...(expectedVersion ? { expectedVersion } : {}),
  };
}

export function parseAssistantActionRequest(value: unknown): AssistantActionRequest {
  const source = record(value);
  if (!source) throw new AssistantActionError('assistant_action_invalid', 400, '操作请求无效。');
  if (!['button', 'natural_language'].includes(text(source.source))) {
    throw new AssistantActionError('assistant_action_source_invalid', 400, '操作来源无效。');
  }
  const requestId = text(source.requestId);
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new AssistantActionError('assistant_action_request_id_invalid', 400, '操作请求编号无效。');
  }
  const actionId = source.actionId === undefined ? undefined : source.actionId;
  if (actionId !== undefined && !isAssistantActionId(actionId)) {
    throw new AssistantActionError('assistant_action_unknown', 400, '无法识别这个操作。');
  }
  const requestText = text(source.text);
  if (requestText.length > MAX_TEXT_LENGTH) {
    throw new AssistantActionError('assistant_action_text_too_large', 413, '输入内容过长。');
  }
  if (source.source === 'button' && !actionId) {
    throw new AssistantActionError('assistant_action_required', 400, '按钮操作缺少动作编号。');
  }
  if (source.source === 'natural_language' && !requestText) {
    throw new AssistantActionError('assistant_action_text_required', 400, '请输入要完成的工作。');
  }
  const page = text(source.page);
  if (page && !SAFE_PAGE.test(page)) {
    throw new AssistantActionError('assistant_action_page_invalid', 400, '工作区页面无效。');
  }
  return {
    source: source.source as AssistantActionRequest['source'],
    requestId,
    ...(actionId ? { actionId } : {}),
    ...(requestText ? { text: requestText } : {}),
    ...(page ? { page } : {}),
    ...(source.target === undefined ? {} : { target: parseTarget(source.target) }),
    parameters: boundedParameters(source.parameters),
  };
}

const GENERIC_GOAL = /^(?:(?:这个|该|当前|this|the|current)\s*)?(?:任务|工作|计划|内容|制作|执行|task|job|work|plan|content)$/iu;
const EXPLANATORY_GOAL = /^(?:制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化)\s*(?:是|意味着|指的是|属于)/u;
const CONTROL_ONLY_GOAL = /^(?:(?:to\s+)?(?:pause|stop|resume|continue|confirm|accept|approve|revise|redo|start|begin)(?:\s+(?:this|the|current))?(?:\s+(?:task|run|job|execution|result|plan|option|quote))?|(?:暂停|停止|继续(?:执行|运行)?|恢复|确认|批准|采用|验收|接受|修改|退回|重做|重新做|开始|启动)(?:这个|该|当前|这份)?(?:任务|工作|计划|内容|制作|执行|运行|结果|方案|选项|报价)?(?:一下)?)$/iu;
const CONTROL_DECLARATION_PREFIX = /^(?:(?:(?:first|now|immediately|right\s+now)\s+)*(?:to\s+)?(?:pause|stop|resume|continue|confirm|accept|approve|revise|redo)\b|(?:(?:先|现在|立即|马上)\s*)*(?:暂停|停止|继续(?:执行|运行)?|恢复|确认|批准|采用|验收|接受|修改|退回|重做|重新做))/iu;
const QUESTION_OR_NEGATION = /(?:[?？]|为什么|为何|怎么|如何|能否|可否|可以吗|是不是|是否|是什么|什么|多少|多久|何时|哪里|哪儿|谁|哪(?:个|些)|不要|别|先别|无需|不必|why|how|can\s+(?:you|we)|could\s+(?:you|we)|should\s+(?:you|we)|do\s+(?:you|we)|don't|do\s+not)/iu;
// This list is intentionally broader than the executable natural-language
// grammar below. Its job is not to infer an operation, but to prevent an
// unbound write request from falling through to a model that could mutate the
// wrong task. Only an exact deterministic grammar or a signed card action may
// execute a write.
const MUTATION_KEYWORD = /(?:暂停|停止|继续|恢复|确认|批准|采用|选择|验收|接受|修改|编辑|调整|退回|重做|重新做|开始|启动|执行|删除|移除|发布|排期|移(?:动)?(?:到|至)|改(?:期)?(?:到|至)|调(?:整)?(?:到|至)|挪(?:到|至)|下线|撤下|换掉|替换|重排|取消(?:发布|排期)?|清空|上传|提交|保存|绑(?:定|上)|解绑|发送|导入|导出|归档|新建|创建|添加|复制|重命名|置顶|收藏|邀请|安装|卸载|授权|撤回|拒绝|审批|支付|购买|充值|退款|连接|断开|同步|合并|覆盖|重置|撤销|移交|转移|分配|指派|启用|禁用|关闭|开启|分享|转发|点赞|评论|关注|取关|取消关注|订阅|退订|屏蔽|拉黑|静音|举报|投放|投喂|灌入|喂给|推送|派发|\b(?:pause|stop|resume|continue|confirm|accept|approve|choose|select|revise|redo|start|begin|execute|change|edit|update|delete|remove|publish|schedule|move|reschedule|shift|postpone|unpublish|replace|swap|reorder|clear|upload|submit|save|bind|unbind|send|import|export|archive|create|add|copy|rename|pin|favorite|invite|install|uninstall|authorize|revoke|reject|pay|purchase|refund|connect|disconnect|sync|merge|overwrite|reset|undo|transfer|assign|enable|disable|close|open|share|like|comment|follow|unfollow|subscribe|unsubscribe|block|mute|report|route|feed|inject|dispatch)\b|\btake\s+(?:(?:it|this|that|the)\s+)?(?:(?:video|post|content|asset|item|clip)\s+)?down\b|\bcancel(?:\s+(?:the|this|that))?\s+(?:publication|publishing|post|schedule)\b)/iu;
// Chinese 把/将 constructions are explicit operation requests even when the
// verb is product-specific and has not been added to the vocabulary yet.
// Fail closed here: an unrecognized write must become a signed choice, never
// a free-form Agent/model instruction that can claim a mutation succeeded.
const MUTATION_IMPERATIVE_STRUCTURE = /^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:(?:我|我们)\s*(?:想|要|希望)\s*)?(?:把|将)\s*\S+/u;
const MUTATION_QUESTION = /(?:[?？]\s*$|(?:吗|么|呢)(?:\s*)$|(?:要|需|需要)?(?:多少|多久|多长时间|何时|什么时候|哪里|哪儿|哪(?:个|些))\s*$|^(?:(?:我|我们)\s*)?(?:(?:想知道|想问|请问)\s*)?(?:为什么|为何|怎么|如何|能否|能不能|可否|可以吗|是不是|是否|要不要|该不该|应不应该|有没有必要|是什么|什么|多少|多久|何时|哪里|哪儿|谁|哪(?:个|些)|还是)(?:\s|要|会|能|可|应|该|是|有|做|发|删|改|移|上|下|绑|存|传|取|退|停|开|关|分|举|列|$)|^(?:why|how|can|could|should|would|will|do|does|did|is|are|am|may|might|must|what|when|where|who|which)\b|^(?:i|we)\s+(?:want\s+to\s+know|wonder|would\s+like\s+to\s+know)(?:\s+(?:if|whether))?\s+(?:(?:i|we|you|it|they)\s+)?(?:can|could|should|would|will|do|does|did|is|are|am|may|might|must)\b)/iu;
// Explanation markers must describe the sentence itself. Unanchored words such
// as “已经/目前” are often object modifiers in a real imperative (for example
// “删除已经过期的视频”) and must not make that write fall through to a model.
const MUTATION_EXPLANATION = /(?:^(?:(?:这个|该|当前)\s*)?(?:任务|工作|计划|内容|制作|执行|运行|结果|方案|选项|报价)\s*(?:已经|目前|当前状态)|^(?:(?:this|the\s+current)\s+)?(?:task|job|work|plan|content|execution|result|option|quote)\s+(?:has\s+already|is\s+currently)|(?:的(?:流程|方法|原因|含义|定义|规则|区别|示例))\s*$|(?:是(?:项目|流程|工作)?的?第一步|意味着|指的是|属于|is\s+the\s+first\s+step|means|refers\s+to))/iu;
const NEGATED_MUTATION_EXPLANATION = /(?:^(?:(?:我|我们)?\s*(?:不是|并非)(?:要|想|打算)).*(?:只是|只想|仅仅是?).*(?:了解|询问|讨论|解释|问)|^(?:(?:i|we)\s+(?:do\s+not|don't)\s+(?:want|intend|plan)\s+to).*(?:just|only).*(?:understand|ask|discuss|explain))/iu;
const READ_ONLY_DELEGATION = /^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:查看|看看|分析|解释|说明|总结|比较|评估|检查|告诉|展示|预览|推荐|建议|介绍|列出|梳理|复盘|计算|查询|了解|讨论|describe|explain|analyze|review|summarize|compare|evaluate|inspect|show|recommend|suggest|tell|list|discuss)/iu;
const SAFE_CONVERSATION = /^(?:你好|您好|嗨|谢谢|感谢|hi|hello|hey|thanks?\b)|^(?:我|我们|这个|该|当前|产品|公司|品牌|账号|视频|计划|任务|结果|系统).*(?:觉得|认为|发现|看到|遇到|是|有|没有|很|比较|表现|效果|状态|问题|情况)|^(?:i|we)\s+(?:think|believe|found|noticed|have|see)|^(?:this|the\s+current)\s+(?:product|company|brand|account|video|plan|task|result|system)\s+(?:is|has|seems)/iu;
const DIRECTIVE_SIGNAL = /(?:应该|应当|需要|必须|务必|要求|请求|打算|准备|接下来要|please|\bshould\b|\bmust\b|\bneed\s+to\b|\bought\s+to\b|\bintend\s+to\b|\bplan\s+to\b)/iu;
const BUSINESS_OBJECTIVE_VERB = /^(?:制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化|适配|改编|剪辑|分析|produce|create|generate|plan|build|prepare|improve|increase|grow|adapt|analyze)\s*.+$/iu;
const BUSINESS_OBJECTIVE_PREFIX = /^(?:根据|围绕|面向|针对|为).+(?:制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化|适配|改编|剪辑|分析).+$/u;
const COMPOUND_GOAL_BOUNDARY = /(?:以及|及(?=\s*(?:再|同时|制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化|适配|改编|剪辑|分析|[A-Za-z]))|并且|并(?!行)|然后|之后(?:再)?|接着|随后|继而|进而|随即|同时|而且|另外|此外|再(?!次)|[，,；;。！!：:]|\band\s+(?:then\s+)?|\bthen\b|\bafter(?:wards)?\b|\bwhile\b|\bplus\b|\balso\b|\bas\s+well\s+as\b)/giu;

function appearsToRequestMutation(value: string): boolean {
  if (MUTATION_QUESTION.test(value) || MUTATION_EXPLANATION.test(value)
    || NEGATED_MUTATION_EXPLANATION.test(value)) return false;
  return MUTATION_KEYWORD.test(value) || MUTATION_IMPERATIVE_STRUCTURE.test(value);
}

function safeForReadOnlyDelegation(value: string): boolean {
  return MUTATION_QUESTION.test(value)
    || MUTATION_EXPLANATION.test(value)
    || NEGATED_MUTATION_EXPLANATION.test(value)
    || READ_ONLY_DELEGATION.test(value)
    || (SAFE_CONVERSATION.test(value) && !DIRECTIVE_SIGNAL.test(value));
}

function isBusinessObjectiveClause(value: string): boolean {
  const clause = value.trim().replace(/^(?:(?:同时|继续|再)\s*)+/u, '');
  return BUSINESS_OBJECTIVE_VERB.test(clause) || BUSINESS_OBJECTIVE_PREFIX.test(clause);
}

function substantiveGoal(value: string): string | null {
  const goal = value.trim().replace(/[。.！!]+$/u, '').replace(/\s+/gu, ' ');
  const withoutTimePrefix = goal.replace(/^(?:(?:本周|这周|本轮|今天|近期|this\s+week|current\s+cycle)\s*)/iu, '');
  const startsWithBusinessObjective = isBusinessObjectiveClause(withoutTimePrefix);
  const nonObjectiveRemainder = goal.replace(/(?:制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化|produce|create|generate|plan|build|prepare|improve|increase|grow)/giu, ' ');
  const compoundClauses = withoutTimePrefix.split(COMPOUND_GOAL_BOUNDARY).map((clause) => clause.trim()).filter(Boolean);
  const hasUnsafeCompoundOperation = compoundClauses.slice(1).some((clause) => !isBusinessObjectiveClause(clause))
    || MUTATION_KEYWORD.test(nonObjectiveRemainder)
    || /(?:并|然后|之后|后|，|,|；|;)\s*(?:把|将)\s*\S+/u.test(nonObjectiveRemainder);
  if (goal.length < 4 || goal.length > MAX_TEXT_LENGTH || GENERIC_GOAL.test(goal)
    || EXPLANATORY_GOAL.test(goal) || CONTROL_ONLY_GOAL.test(goal) || CONTROL_DECLARATION_PREFIX.test(goal)
    || !startsWithBusinessObjective
    || hasUnsafeCompoundOperation
    || /(?:的流程|的方法|的原因|要多久|多少钱)$/u.test(goal)) return null;
  return goal;
}

/**
 * Recognize an explicit business objective, not a bare UI command. The
 * returned text deliberately removes only courtesy/start-control words, so
 * `开始制作` can never itself become the persisted weekly-goal objective.
 */
export function extractAssistantBusinessGoal(value: string): string | null {
  const normalized = value.trim().replace(/[。.！!]+$/u, '').replace(/\s+/gu, ' ');
  if (!normalized || QUESTION_OR_NEGATION.test(normalized)) return null;

  const chinese = normalized
    .replace(/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)/u, '')
    .replace(/^(?:(?:现在|立即|马上)\s*)/u, '');
  const declaredGoal = chinese.match(/^(?:我(?:想|希望|要)|我们(?:想|希望|要)|(?:本周|这周|本轮|当前)?目标是)\s*(.+)$/u);
  if (declaredGoal) return substantiveGoal(declaredGoal[1]);
  if (/^(?:本周|这周|本轮|今天|近期)\s*.+(?:制作|生成|创建|规划|完成|推进|提升|增加|获取|获得|拓展|优化|做)\s*.+$/u.test(chinese)) {
    return substantiveGoal(chinese);
  }
  const direct = chinese.match(/^(?:开始|着手)\s*(制作|生成|创建|规划|完成|推进|准备|做)\s*(.+)$/u);
  if (direct) return substantiveGoal(`${direct[1]} ${direct[2]}`);
  if (/^(?:制作|生成|创建|规划|完成|推进|准备|做|提升|增加|获取|获得|拓展|优化)\s*.+$/u.test(chinese)) {
    return substantiveGoal(chinese);
  }
  if (/^(?:根据|围绕|面向|针对|为).+(?:制作|生成|创建|规划|完成|推进|提升|增加|获取|获得|拓展|优化).+$/u.test(chinese)) {
    return substantiveGoal(chinese);
  }

  const english = normalized.replace(/^please\s+/i, '').replace(/^(?:now\s+|right\s+now\s+)/i, '');
  const declaredEnglishGoal = english.match(/^(?:i|we)\s+(?:want|need|hope)\s+(?:to\s+)?(.+)$/i)
    ?? english.match(/^(?:(?:this\s+week|current\s+cycle)\s+)?(?:my|our)\s+goal\s+is\s+(?:to\s+)?(.+)$/i);
  if (declaredEnglishGoal) return substantiveGoal(declaredEnglishGoal[1]);
  const englishDirect = english.match(/^(?:start|begin)\s+(producing|creating|generating|planning|building|preparing)\s+(.+)$/i);
  if (englishDirect) return substantiveGoal(`${englishDirect[1]} ${englishDirect[2]}`);
  if (/^(?:produce|create|generate|plan|build|prepare|improve|increase|grow)\s+.+$/i.test(english)) {
    return substantiveGoal(english);
  }
  return null;
}

/**
 * Deliberately small and deterministic. It extracts the operation only; it
 * never invents business data. The extracted action is dispatched through the
 * exact same command bus as a button action.
 */
export function extractAssistantIntent(request: AssistantActionRequest): AssistantActionIntent {
  if (request.source === 'button') {
    return {
      actionId: request.actionId!,
      confidence: 1,
      target: request.target,
      parameters: request.parameters ?? {},
    };
  }
  // The UI may resolve free-form wording to one and only one server-authored
  // card action. Treat that as the same deterministic operation as a button;
  // the target/version and parameters are still validated below and by the
  // command bus. A plain natural-language request never receives actionId.
  if (request.actionId) {
    return {
      actionId: request.actionId,
      confidence: 1,
      target: request.target,
      parameters: request.parameters ?? {},
    };
  }
  const input = request.text ?? '';
  const delegate = (): AssistantActionIntent => ({
    actionId: 'delegate_to_agent',
    confidence: 1,
    target: request.target,
    parameters: { text: input },
  });
  const normalized = input.trim().replace(/[。.！!]+$/u, '').replace(/\s+/gu, ' ');
  const scheduleChange = normalized.match(/^(?:请(?:你)?|麻烦(?:你)?|请?帮我)?\s*把\s*周([一二三四五六日天])\s*(TikTok|YouTube|Instagram|Facebook)\s*(?:的)?\s*([一二两三四五六七八九十\d]+)\s*条(?:待发布)?视频\s*(?:(?:改(?:期)?|移(?:动)?|调整|调|挪|重排)(?:到|至))\s*周([一二三四五六日天])(?:发布)?$/iu);
  if (scheduleChange) {
    const weekdays: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const chineseCounts: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const weekday = (value: string) => weekdays[value] ?? -1;
    const count = (value: string) => {
      if (/^\d+$/u.test(value)) return Number(value);
      return chineseCounts[value] ?? 0;
    };
    return {
      actionId: 'prepare_schedule_change',
      confidence: 1,
      parameters: {
        platform: scheduleChange[2].toLowerCase(),
        sourceWeekday: weekday(scheduleChange[1]),
        targetWeekday: weekday(scheduleChange[4]),
        count: count(scheduleChange[3]),
      },
    };
  }
  const explicitSearch = normalized.match(/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:搜索|查找|找出|找一下|查一下|搜一下|search(?:\s+for)?|find|look\s+for)\s*(.+)$/iu);
  if (explicitSearch) {
    return {
      actionId: 'search',
      confidence: 0.99,
      parameters: {
        query: explicitSearch[1].trim(),
        ...(request.page ? { page: request.page } : {}),
      },
    };
  }
  const strictMutationRules: Array<[RegExp, AssistantActionId]> = [
    [/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:(?:现在|立即|马上|先)\s*)?(?:暂停|停止)(?:这个|该|当前)?(?:任务|运行|执行)?(?:一下|吧|一下吧)?$/iu, 'pause_task'],
    [/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:(?:现在|立即|马上)\s*)?(?:继续(?:执行|运行)?|恢复|重新开始)(?:这个|该|当前)?(?:任务|运行|执行)?(?:一下|吧|一下吧)?$/iu, 'resume_task'],
    [/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:确认(?:这个|该|当前)?(?:选择|方案|选项)|采用(?:这个|该|当前)?(?:选择|方案|选项)|选择(?:这个|该|当前)?(?:选择|方案|选项)|就选(?:这个|该|当前)?(?:选择|方案|选项)|(?:批准|确认)(?:这个|该|当前|这份)?报价)(?:吧)?$/iu, 'confirm_choice'],
    [/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:验收通过|接受(?:这个|该|当前)?结果|确认(?:这个|该|当前)?结果(?:通过)?|结果通过)(?:吧)?$/iu, 'accept_result'],
    [/^(?:(?:请(?:你)?|麻烦(?:你)?|请?帮我)\s*)?(?:要求修改|退回(?:这个|该|当前)?(?:结果)?(?:修改|重做)|重新做(?:这个|该|当前)?(?:结果)?|再改(?:这个|该|当前)?(?:结果)?)(?:一次|一下|吧|一下吧)?$/iu, 'request_revision'],
    [/^(?:please\s+)?(?:pause|stop)(?:\s+(?:this|the|current))?(?:\s+(?:task|run|job|execution))?(?:\s+now)?$/i, 'pause_task'],
    [/^(?:please\s+)?(?:resume|continue)(?:\s+(?:this|the|current))?(?:\s+(?:task|run|job|execution))?(?:\s+now)?$/i, 'resume_task'],
    [/^(?:please\s+)?(?:confirm|use|choose)(?:\s+(?:this|the|current))?(?:\s+(?:choice|option|plan))?$/i, 'confirm_choice'],
    [/^(?:please\s+)?(?:accept|approve)(?:\s+(?:this|the|current))?(?:\s+(?:result|output))?$/i, 'accept_result'],
    [/^(?:please\s+)?(?:revise|redo|request\s+(?:a\s+)?revision)(?:\s+(?:this|the|current))?(?:\s+(?:result|output))?$/i, 'request_revision'],
  ];
  const strictMutationMatches = strictMutationRules.filter(([pattern]) => pattern.test(normalized));
  if (strictMutationMatches.length === 1) {
    const actionId = strictMutationMatches[0][1];
    const supplied = request.parameters ?? {};
    const generatedChoice = Object.keys(supplied).length > 0
      ? supplied
      : actionId === 'accept_result'
        ? { option: 'accept_result', value: 'accepted', parameters: {} }
        : actionId === 'request_revision'
          ? { option: 'request_revision', value: 'revision_requested', parameters: {} }
          : supplied;
    return {
      actionId,
      confidence: 0.99,
      target: request.target,
      parameters: generatedChoice,
    };
  }

  const businessGoal = extractAssistantBusinessGoal(input);
  if (businessGoal) {
    return {
      actionId: 'start_task',
      confidence: 0.99,
      target: request.target,
      parameters: { goal: businessGoal },
    };
  }

  // A mutation keyword outside the deliberately narrow imperative grammar is
  // explanatory, interrogative, negated, or otherwise ambiguous. Never let a
  // secondary read-only keyword turn such text into a state-changing command.
  if (MUTATION_KEYWORD.test(normalized) || MUTATION_IMPERATIVE_STRUCTURE.test(normalized)) {
    return {
      ...delegate(),
      requiresSignedAction: appearsToRequestMutation(normalized),
    };
  }

  const rules: Array<[RegExp, AssistantActionId]> = [
    [/(进度|状态|做到哪|还要多久|status)/i, 'view_status'],
    [/(打开|前往|进入).*(工作台|日历|详情|列表|页面)/i, 'open_workspace'],
  ];
  const matches = rules.filter(([pattern]) => pattern.test(input));
  if (matches.length !== 1) {
    return safeForReadOnlyDelegation(normalized)
      ? delegate()
      : { ...delegate(), requiresSignedAction: true };
  }
  return {
    actionId: matches[0][1],
    confidence: 0.98,
    target: request.target,
    parameters: matches[0][1] === 'open_workspace'
      ? normalizeAssistantActionParameters('open_workspace', request.parameters ?? {})
      : {},
  };
}

function compactCard(input: {
  kind?: AssistantCompactCard['kind'];
  title: string;
  summary: string;
  details?: string[];
  items?: AssistantCompactCard['items'];
  workspace?: AssistantWorkspaceLink;
  primaryAction?: import('../../shared/contracts/assistantActions.js').AssistantCardAction;
  secondaryActions?: import('../../shared/contracts/assistantActions.js').AssistantCardAction[];
}): AssistantCompactCard {
  return {
    kind: input.kind ?? 'operation_result',
    title: input.title,
    summary: input.summary,
    details: (input.details ?? []).filter(Boolean).slice(0, 3),
    ...(input.items?.length ? { items: input.items.slice(0, 20) } : {}),
    ...(input.primaryAction ? { primaryAction: input.primaryAction } : input.workspace ? {
      primaryAction: { id: 'open-workspace', label: input.workspace.label, href: input.workspace.href },
    } : {}),
    secondaryActions: (input.secondaryActions ?? []).slice(0, 2),
  };
}

function notification(reason: AssistantNotification['reason'], message: string): AssistantNotification {
  return { reason, message };
}

function requiredTarget(actionId: AssistantActionId): AssistantActionTarget['objectType'] | null {
  if (actionId === 'pause_task' || actionId === 'resume_task') return 'run';
  if (actionId === 'confirm_choice' || actionId === 'accept_result' || actionId === 'request_revision') return 'approval';
  if (actionId === 'confirm_schedule_change') return 'schedule_change';
  return null;
}

function missingTargetResponse(
  actionId: AssistantActionId,
  requestId: string,
  objectType: AssistantActionTarget['objectType'],
): AssistantActionResponse {
  const label = objectType === 'run' ? '任务' : objectType === 'approval' ? '待确认项' : '结果';
  const summary = `请先选择要操作的${label}。`;
  return {
    status: 'missing_required_input',
    actionId,
    requestId,
    notification: notification('missing_required_input', summary),
    card: compactCard({ kind: 'decision', title: '还差一个关键选择', summary }),
  };
}

function missingVersionResponse(actionId: AssistantActionId, requestId: string): AssistantActionResponse {
  const summary = '工作区内容已经变化，请刷新后再确认这次操作。';
  return {
    status: 'missing_required_input',
    actionId,
    requestId,
    notification: notification('missing_required_input', summary),
    card: compactCard({ kind: 'decision', title: '需要最新版本', summary }),
  };
}

function missingChoiceResponse(actionId: AssistantActionId, requestId: string): AssistantActionResponse {
  const summary = '请从当前决策卡选择一个明确选项后再确认。';
  return {
    status: 'missing_required_input',
    actionId,
    requestId,
    notification: notification('missing_required_input', summary),
    card: compactCard({ kind: 'decision', title: '还差一个明确选项', summary }),
  };
}

function unsignedMutationResponse(requestId: string, unsupported = false): AssistantActionResponse {
  const summary = unsupported
    ? '当前工作区没有可执行这项操作的任务卡，因此没有修改任何内容。'
    : '这条指令无法安全绑定到唯一的任务和版本，因此没有执行。请在当前任务卡中选择对应操作。';
  return {
    status: 'missing_required_input',
    actionId: 'delegate_to_agent',
    requestId,
    notification: notification('missing_required_input', summary),
    card: compactCard({
      kind: 'decision',
      title: '这次操作尚未执行',
      summary,
      details: ['任务、已填写内容和当前执行状态均未改变。'],
    }),
    errorCode: unsupported
      ? 'assistant_mutation_not_supported'
      : 'assistant_mutation_requires_signed_action',
  };
}

export function createAssistantActionService(dependencies: {
  commandBus: AssistantBusinessCommandBus;
  delegator?: AssistantAgentDelegator;
  supportsExecution?: AssistantActionSupportProbe;
}): AssistantActionService {
  return {
    async route(rawInput, context) {
      const request = parseAssistantActionRequest(rawInput);
      const intent = extractAssistantIntent(request);

      const delegate = async (): Promise<AssistantActionResponse> => {
        if (!dependencies.delegator) {
          return {
            status: 'not_handled',
            actionId: 'delegate_to_agent',
            requestId: request.requestId,
            notification: null,
            card: compactCard({
              title: '继续使用通用对话',
              summary: '这条输入未由确定性操作路由处理。',
            }),
          };
        }
        const delegated = await dependencies.delegator.delegate({
          text: request.text!, requestId: request.requestId, context,
        });
        return {
          status: 'delegated',
          actionId: 'delegate_to_agent',
          requestId: request.requestId,
          notification: null,
          workspace: delegated.workspace,
          card: compactCard({
            title: delegated.title ?? '正在形成方案',
            summary: delegated.summary,
            workspace: delegated.workspace,
          }),
        };
      };

      if (intent.actionId === 'delegate_to_agent') {
        if (intent.requiresSignedAction) return unsignedMutationResponse(request.requestId);
        return delegate();
      }

      const candidate: AssistantBusinessCommand = {
        actionId: intent.actionId,
        requestId: request.requestId,
        target: intent.target,
        parameters: intent.parameters,
      };
      if (dependencies.supportsExecution && !await dependencies.supportsExecution(candidate, context)) {
        if (request.source === 'natural_language') {
          return MUTATION_ACTIONS.has(intent.actionId)
            ? unsignedMutationResponse(request.requestId, true)
            : delegate();
        }
        throw new AssistantActionError(
          'assistant_action_not_supported',
          403,
          '当前工作区不支持这个操作。',
        );
      }
      if (CHOICE_ACTIONS.has(intent.actionId)
        && (!text(intent.parameters.option) || !text(intent.parameters.value))) {
        return missingChoiceResponse(intent.actionId, request.requestId);
      }
      const command: AssistantBusinessCommand = {
        ...candidate,
        parameters: normalizeAssistantActionParameters(intent.actionId, intent.parameters),
      };

      const expectedObjectType = requiredTarget(intent.actionId);
      if (expectedObjectType && (!intent.target?.objectId || intent.target.objectType !== expectedObjectType)) {
        return missingTargetResponse(intent.actionId, request.requestId, expectedObjectType);
      }
      if (expectedObjectType && !intent.target?.expectedVersion) {
        return missingVersionResponse(intent.actionId, request.requestId);
      }

      try {
        const result = await dependencies.commandBus.execute(command, {
          ...context,
          page: request.page ?? context.page,
        });
        const status = result.status ?? 'completed';
        return {
          status,
          actionId: intent.actionId,
          requestId: request.requestId,
          version: result.version,
          workspace: result.workspace,
          notification: status === 'approval_required'
            ? notification('approval_required', result.summary)
            : status === 'missing_required_input'
              ? notification('missing_required_input', result.summary)
            : status === 'failed'
              ? notification('failure', result.summary)
              : null,
          card: compactCard({
            kind: status === 'approval_required' || status === 'missing_required_input'
              ? 'decision'
              : intent.actionId === 'view_status'
                ? 'status'
                : intent.actionId === 'search'
                  ? 'search_results'
                  : 'operation_result',
            title: result.title ?? '操作已完成',
            summary: result.summary,
            details: result.details,
            items: result.items,
            workspace: result.workspace,
            primaryAction: result.primaryAction,
            secondaryActions: result.secondaryActions,
          }),
        };
      } catch (error) {
        const stale = error instanceof AssistantActionConflictError;
        const known = error instanceof AssistantActionError;
        if (known && !stale) throw error;
        const message = known ? error.publicMessage : '操作没有完成，请稍后重试。';
        return {
          status: stale ? 'stale_action' : 'failed',
          actionId: intent.actionId,
          requestId: request.requestId,
          notification: notification('failure', message),
          errorCode: known ? error.code : 'assistant_action_failed',
          card: compactCard({ title: stale ? '页面信息已更新' : '操作未完成', summary: message }),
        };
      }
    },
  };
}
