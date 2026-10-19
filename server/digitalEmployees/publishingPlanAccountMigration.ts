import type { ConnectedPublishingAccount } from './publishingTargets.js';

type JsonRecord = Record<string, any>;

const text = (value: unknown): string => String(value ?? '').trim();
const legacyAccountId = (value: unknown): boolean => /^local-(facebook|instagram|tiktok|youtube)-/.test(text(value));
const unique = <T>(values: T[]): T[] => [...new Set(values)];

export type PublishingAccountBindingMigration = {
  changed: boolean;
  plan: JsonRecord;
  replacements: Array<{
    platform: string;
    previousAccountId: string;
    accountId: string;
    accountLabel: string;
  }>;
  reason?: 'not_legacy' | 'ambiguous_or_missing_connection';
};

/**
 * Rebinds only old local-preview placeholders and only when every affected
 * platform has exactly one real connected account. This never guesses between
 * accounts and never expands the set of active publishing platforms.
 */
export function migrateLegacyPublishingPlanAccountBindings(
  source: JsonRecord,
  connectedAccounts: ConnectedPublishingAccount[],
  now = new Date().toISOString(),
): PublishingAccountBindingMigration {
  const plan = structuredClone(source);
  const pack = plan.businessPackage && typeof plan.businessPackage === 'object' ? plan.businessPackage as JsonRecord : null;
  const matrix = Array.isArray(pack?.matrixPlan) ? pack!.matrixPlan as JsonRecord[] : [];
  const config = plan.configSnapshot && typeof plan.configSnapshot === 'object' ? plan.configSnapshot as JsonRecord : null;
  const targets = Array.isArray(config?.publishingTargets) ? config!.publishingTargets as JsonRecord[] : [];
  const activePlatforms = unique([
    ...matrix.filter(row => Number(row.weeklyCount || 0) > 0).map(row => text(row.platform)),
    ...targets.filter(target => Number(target.weeklyCount || 0) > 0).map(target => text(target.platform)),
  ].filter(Boolean));
  const affected = activePlatforms.flatMap(platform => unique([
    ...matrix.filter(row => text(row.platform) === platform).map(row => text(row.accountId)),
    ...targets.filter(target => text(target.platform) === platform && Number(target.weeklyCount || 0) > 0).map(target => text(target.accountId)),
  ].filter(legacyAccountId)).map(previousAccountId => ({ platform, previousAccountId })));
  if (!affected.length) return { changed: false, plan: source, replacements: [], reason: 'not_legacy' };

  const replacements = affected.map(binding => {
    const matches = connectedAccounts.filter(account => account.platform === binding.platform && !legacyAccountId(account.accountId));
    if (matches.length !== 1) return null;
    return {
      ...binding,
      accountId: matches[0]!.accountId,
      accountLabel: matches[0]!.accountLabel,
    };
  });
  if (replacements.some(item => !item)) {
    return { changed: false, plan: source, replacements: [], reason: 'ambiguous_or_missing_connection' };
  }
  const resolved = replacements as PublishingAccountBindingMigration['replacements'];
  const byId = new Map(resolved.map(item => [item.previousAccountId, item]));
  const replaceId = (value: unknown): string => byId.get(text(value))?.accountId || text(value);
  const replaceLabel = (accountId: unknown, label: unknown): string => byId.get(text(accountId))?.accountLabel || text(label);

  config!.publishingTargets = targets.map(target => {
    const replacement = byId.get(text(target.accountId));
    return replacement ? { ...target, accountId: replacement.accountId, accountLabel: replacement.accountLabel } : target;
  });
  pack!.matrixPlan = matrix.map(row => {
    const replacement = byId.get(text(row.accountId));
    return replacement ? { ...row, accountId: replacement.accountId, connected: true } : row;
  });
  const activeAccountIds = new Set((pack!.matrixPlan as JsonRecord[]).map(row => text(row.accountId)).filter(Boolean));
  const authorization = pack!.authorization && typeof pack!.authorization === 'object' ? pack!.authorization as JsonRecord : {};
  authorization.accountIds = unique((Array.isArray(authorization.accountIds) ? authorization.accountIds : [])
    .map(replaceId)
    .filter(accountId => !legacyAccountId(accountId) && activeAccountIds.has(accountId)));
  pack!.authorization = authorization;

  const operatingContext = pack!.operatingContext && typeof pack!.operatingContext === 'object' ? pack!.operatingContext as JsonRecord : null;
  if (operatingContext) {
    if (Array.isArray(operatingContext.accounts)) {
      operatingContext.accounts = operatingContext.accounts.map((account: JsonRecord) => ({
        ...account,
        accountLabel: replaceLabel(account.accountId, account.accountLabel),
        accountId: replaceId(account.accountId),
      }));
    }
    if (operatingContext.authorization && typeof operatingContext.authorization === 'object') {
      operatingContext.authorization.accountIds = [...authorization.accountIds];
    }
  }

  if (Array.isArray(pack!.tasks)) {
    pack!.tasks = pack!.tasks.map((task: JsonRecord) => {
      if (!Array.isArray(task.videoPlans)) return task;
      return { ...task, videoPlans: task.videoPlans.map((video: JsonRecord) => ({
        ...video,
        ...(video.matrix && typeof video.matrix === 'object' ? { matrix: { ...video.matrix, accountId: replaceId(video.matrix.accountId) } } : {}),
        ...(video.planningEvidence && typeof video.planningEvidence === 'object'
          ? { planningEvidence: { ...video.planningEvidence, matrixAccountId: replaceId(video.planningEvidence.matrixAccountId) } }
          : {}),
        ...(Array.isArray(video.deliveryVariants) ? { deliveryVariants: video.deliveryVariants.map((variant: JsonRecord) => ({
          ...variant,
          accountLabel: replaceLabel(variant.accountId, variant.accountLabel),
          accountId: replaceId(variant.accountId),
        })) } : {}),
      })) };
    });
  }

  pack!.revision = Math.max(1, Number(pack!.revision || 1)) + 1;
  plan.businessPackage = pack;
  plan.configSnapshot = config;
  plan.packageGrantInvalidatedAt = now;
  plan.packageGrantInvalidatedReason = 'legacy_publishing_account_binding_migrated';
  plan.managedPublishingGrantId = '';
  plan.publishingAccountBindingsMigratedAt = now;
  plan.publishingAccountBindingMigration = {
    version: 1,
    replacements: resolved,
  };
  return { changed: true, plan, replacements: resolved };
}

export function packageGrantWasInvalidatedAfterApproval(plan: JsonRecord): boolean {
  const approvedAt = Date.parse(text(plan.packageApprovedAt));
  const invalidatedAt = Date.parse(text(plan.packageGrantInvalidatedAt));
  return Number.isFinite(invalidatedAt) && (!Number.isFinite(approvedAt) || invalidatedAt > approvedAt);
}
