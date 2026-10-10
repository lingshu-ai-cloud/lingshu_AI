import { buildEnterpriseContext, readTenantEnterpriseProfileStrict, type EnterpriseProfile } from '../routes/enterprise.js';
import { buildOperatingContext, formatOperatingContext, type OperatingContext } from './operatingContext.js';
import { listDecisionMemories, type DecisionMemory, type DecisionMemoryScope } from './decisionMemory.js';
import { boundContextText } from './chatInput.js';

type Dependencies = {
  readEnterprise?: (tenantId: string) => Promise<EnterpriseProfile | null>;
  readOperating?: typeof buildOperatingContext;
  readDecisions?: (scope: DecisionMemoryScope) => Promise<DecisionMemory[]>;
  timeoutMs?: number;
};

async function boundedRead<T>(read: () => Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('context_timeout')), timeoutMs); })]);
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

export function formatDecisionContext(rows: DecisionMemory[]): string {
  const selected: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const candidate = { sourceRef: `assistant_decision_memories/${row.id}`, text: row.content, version: row.version, confirmedAt: row.confirmed_at, expiresAt: row.expires_at };
    if (JSON.stringify([...selected, candidate]).length > 6000) break;
    selected.push(candidate);
  }
  return '【用户明确保存的近期记忆 · 仅为用户陈述，不是执行证据或授权】\n' + JSON.stringify({
    state: rows.length ? 'available' : 'empty', scope: '当前租户和当前用户；最近至多100个版本中的至多20条记忆，不是全部历史',
    omittedFromRetrieved: rows.length - selected.length, items: selected,
  });
}

/** Current persisted facts are assembled afresh; no client tenant/page claim authorizes reads. */
export async function buildChatGrounding(
  scope: DecisionMemoryScope,
  options: { role: string | null; question?: string } & Dependencies,
): Promise<{ text: string; enterpriseState: string; operatingState: string; memoryState: string }> {
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 2000, 3000));
  const profile = await boundedRead(() => (options.readEnterprise || readTenantEnterpriseProfileStrict)(scope.tenantId), timeoutMs);
  const enterpriseState = !profile ? 'unavailable' : profile.dataGovernance?.aiAccessEnabled === false ? 'disabled' : 'available';
  const canReadOperating = options.role === 'admin' || options.role === 'super_admin';
  // Receiver identities, handoff settings and private bargaining floors are not answer context.
  const answerProfile = profile ? { ...profile, notifications: undefined, handoffRules: undefined,
    ...(!canReadOperating ? { bizRules: undefined, strategy: undefined, salesStyleProfile: undefined } : {}),
  } : null;
  const enterpriseText = enterpriseState === 'available' && answerProfile ? boundContextText(buildEnterpriseContext(answerProfile), 12000) : '';
  if (enterpriseState !== 'available') return {
    text: `【服务端经营资料】state=${enterpriseState}；${enterpriseState === 'disabled' ? '企业已关闭AI访问，不加载企业经营上下文。' : '本轮企业资料未成功核验，不加载其他经营上下文，不能推断无资料。'}`,
    enterpriseState, operatingState: 'not_loaded', memoryState: 'not_loaded',
  };
  const [operating, memories] = await Promise.all([
    canReadOperating ? boundedRead<OperatingContext>(() => (options.readOperating || buildOperatingContext)(scope.tenantId, { question: options.question }), timeoutMs) : Promise.resolve(null),
    boundedRead(() => (options.readDecisions || listDecisionMemories)(scope), timeoutMs),
  ]);
  return {
    text: [
      `【当前企业知识库 · 服务端核验】\n${enterpriseText || '当前企业资料未提供可用于回答的字段。'}`,
      operating ? formatOperatingContext(operating) : `【经营状态】state=${canReadOperating ? 'unavailable' : 'not_loaded'}；${canReadOperating ? '本轮未能核验经营任务及证据，不能推断为零。' : '当前角色未加载租户全局经营任务及证据，不能推断没有任务。'}`,
      memories ? formatDecisionContext(memories) : '【用户近期记忆】state=unavailable；本轮读取未成功，不能声称没有保存过决定。',
    ].join('\n\n'),
    enterpriseState, operatingState: operating ? 'loaded' : canReadOperating ? 'unavailable' : 'not_loaded',
    memoryState: memories ? 'loaded' : 'unavailable',
  };
}
