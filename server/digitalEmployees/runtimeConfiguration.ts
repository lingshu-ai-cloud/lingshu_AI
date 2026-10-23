import { packageConfig } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { type PublishingReadinessSnapshot } from './publishingOAuthReadiness.js';
import { readTenantPublishingReadiness } from './publishingRuntimeReadiness.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseProfileFromKnowledgeBinding, resolveKnowledgeBinding, resolveDigitalEmployeeConfiguration, type ResolvedDigitalEmployeeConfiguration } from './configuration.js';
import { listConnectedPublishingAccounts, localPublishingAccountMocksEnabled } from './publishingTargets.js';
import { configSnapshotForPlan, publicConfig } from './overviewProjection.js';
import { type DigitalEmployeeConfig } from './domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ConfigRecord, type PlanRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createDigitalEmployeeRuntimeConfiguration(deps: Pick<DigitalEmployeeApplicationPorts, 'first'>) {
  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  async function resolveCurrentConfiguration(
    tenantId: string,
    record?: ConfigRecord | null,
  ): Promise<ResolvedDigitalEmployeeConfiguration | null> {
    const configRecord = record === undefined ? await configForTenant(tenantId) : record;
    const config = publicConfig(configRecord);
    if (!config || !configRecord) return null;
    const enterpriseProfile = await readTenantEnterpriseProfile(tenantId);
    if (localPublishingAccountMocksEnabled()) {
      const accounts = await listConnectedPublishingAccounts(tenantId, enterpriseProfile.company.name);
      const connectedById = new Map(accounts.map(account => [account.accountId, account]));
      // Local preview exposes mock accounts through /publishing-accounts, but it
      // must never replace the user's saved platform selection or weekly quota.
      config.publishingTargets = config.publishingTargets.flatMap(target => {
        const connected = connectedById.get(target.accountId);
        return connected && connected.platform === target.platform
          ? [{ ...target, accountLabel: connected.accountLabel }]
          : [];
      });
    }
    return resolveDigitalEmployeeConfiguration({
      config,
      enterpriseProfile,
      configVersion: Number(configRecord.config_version || 1),
    });
  }

  async function publishingReadinessForOverview(
    tenantId: string,
    required: boolean,
    targetPlatforms: string[],
  ): Promise<PublishingReadinessSnapshot> {
    return (await readTenantPublishingReadiness(tenantId, required, targetPlatforms)).snapshot;
  }

  function executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig {
    const config = configSnapshotForPlan(plan, fallback);
    const body = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
    return body.businessPackage ? packageConfig(body.businessPackage as WeeklyPackage, config) : config;
  }

  function frozenEnterpriseProfileForPlan(plan: PlanRecord | null, allowLegacy = true): EnterpriseProfile | null {
    if (!plan) return null;
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    const profile = enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding, { allowLegacy });
    return profile as EnterpriseProfile | null;
  }

  async function ensureFrozenEnterpriseProfileForRun(
    tenantId: string,
    plan: PlanRecord | null,
    fallbackConfig: DigitalEmployeeConfig,
    boundAt: string,
  ): Promise<EnterpriseProfile> {
    if (!plan) throw new Error('run_fact_snapshot_missing');
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    const binding = jsonObject<Record<string, unknown>>(body.knowledgeBinding, {});
    const existing = frozenEnterpriseProfileForPlan(plan, true);
    if (existing) return existing;
    if (String(binding.factsVersion || '').trim()) throw new Error('run_fact_snapshot_mismatch');
    const current = await readTenantEnterpriseProfile(tenantId);
    const knowledgeBinding = resolveKnowledgeBinding(current, fallbackConfig, boundAt);
    const nextBody = { ...body, knowledgeBinding };
    if (!await store.update(COLLECTION.plans, plan.id, { plan: nextBody })) throw new Error('run_fact_snapshot_storage_unavailable');
    plan.plan = nextBody;
    const frozen = enterpriseProfileFromKnowledgeBinding(knowledgeBinding);
    if (!frozen) throw new Error('run_fact_snapshot_missing');
    return frozen as EnterpriseProfile;
  }

  async function configForTenant(tenantId: string): Promise<ConfigRecord | null> {
    return first<ConfigRecord>(COLLECTION.config, { tenant_id: tenantId }, '-updated_at');
  }

  return { resolveCurrentConfiguration, publishingReadinessForOverview, executionConfigForPlan, frozenEnterpriseProfileForPlan, ensureFrozenEnterpriseProfileForRun, configForTenant };
}
