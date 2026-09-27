import type { AddSocialTaskSourceInput, CreateSocialContentTaskInput, SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import type { OwnedSocialAccount, SocialProgram } from '../../shared/contracts/socialProgram';
import { socialContentApi } from './socialContentApi';

export interface InspirationTaskCandidate {
  id: string;
  title: string;
  sourceUrl?: string;
  crawledAt?: string;
  sourceVersion?: string;
  objective?: string;
  /** Existing, verified task context only; never inferred from the reference. */
  context?: Pick<CreateSocialContentTaskInput, 'productRef' | 'audience' | 'markets' | 'languages' | 'platforms' | 'programRef' | 'targetAccountRef' | 'accountPlaybookRef' | 'brandNotes' | 'restrictions' | 'callToAction'>;
}
export type InspirationTaskPort = Pick<typeof socialContentApi, 'createTask' | 'getTask' | 'addSource' | 'startTask'>;

export function inspirationTaskInput(candidate: InspirationTaskCandidate, program?: SocialProgram): CreateSocialContentTaskInput {
  return {
    title: `爆款复刻 · ${candidate.title}`.slice(0, 120),
    objective: candidate.objective || '分析所选参考的有效表达，结合企业真实产品与受众制作原创内容；不复制参考中的企业事实、人物身份或商务承诺。',
    creationMode: 'viral_replication', referenceMode: 'single_source_fidelity', managementMode: 'one_click_managed',
    productionMode: 'social_ready', mode: 'instant', requestedOutputCount: 1, assetAvailability: 'none',
    ...(program ? {
      programRef: { objectType: 'social_program', id: program.programId, version: String(program.version) },
      audience: program.targetAudience, markets: [program.market], platforms: program.candidatePlatforms,
    } : {}),
    ...candidate.context,
  };
}

export function inspirationTaskSource(candidate: InspirationTaskCandidate): AddSocialTaskSourceInput {
  const url = candidate.sourceUrl?.trim() || '';
  if (!/^https?:\/\//i.test(url)) throw new Error('该候选缺少可追溯的原始链接，请补充链接后发起复刻。');
  return { kind: 'reference_link', sourceRef: url, sourceVersion: candidate.sourceVersion || candidate.crawledAt || null,
    label: candidate.title.slice(0, 160), purpose: '仅用于参考分析；参考内容不构成企业事实或素材使用授权。' };
}

async function operationKey(candidate: InspirationTaskCandidate, program?: SocialProgram): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([candidate.id, candidate.sourceUrl, candidate.sourceVersion || candidate.crawledAt || null, program?.programId || null, program?.version || null, candidate.context || null, candidate.objective || null]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `inspiration:${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Stable server idempotency makes refreshes and repeated clicks resume the same task. */
export async function resumeOrCreateInspirationTask(
  candidate: InspirationTaskCandidate,
  program?: SocialProgram,
  port: InspirationTaskPort = socialContentApi,
): Promise<{ task: SocialContentTaskDetail; warning?: string }> {
  const source = inspirationTaskSource(candidate);
  const key = await operationKey(candidate, program);
  const created = await port.createTask(inspirationTaskInput(candidate, program), `${key}:create`);
  let task = await port.getTask(created.taskId);
  if (!task.sources.some(item => item.status === 'active' && item.kind === source.kind && item.sourceRef === source.sourceRef)) {
    try { task = (await port.addSource(task.taskId, source, `${key}:reference`)).task; }
    catch (error) { return { task, warning: error instanceof Error ? error.message : '参考关联失败，请在原任务中恢复。' }; }
  }
  if (['draft', 'needs_input', 'plan_review'].includes(task.status)) {
    try { task = await port.startTask(task.taskId, task.version, `${key}:start:${task.version}`); }
    catch (error) { return { task, warning: error instanceof Error ? error.message : '制作未启动，请查看任务中的缺失条件。' }; }
  }
  return { task };
}

/** A sole active connection is unambiguous; multiple accounts require an explicit choice. */
export function soleInspirationCreationAccount(accounts: OwnedSocialAccount[], programId?: string): string {
  const eligible = accounts.filter(account => account.programId === programId && account.status === 'active' && account.connectionId);
  return eligible.length === 1 ? eligible[0].accountId : '';
}
