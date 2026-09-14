import { createHash } from 'node:crypto';
import type { Starter198InitialSetupInput } from '../../shared/contracts/starter198.js';
import {
  resolveDigitalEmployeeConfiguration,
  type EnterpriseFactsProfile,
} from '../digitalEmployees/configuration.js';
import { validateDigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { starter198Repository, type Starter198Repository } from './repository.js';
import { Starter198RuntimePortError, type Starter198InitialSetupPort } from './runtimePorts.js';

type Row = Record_ & Record<string, unknown>;
type JsonObject = Record<string, unknown>;

const ACTIVE_RUN_STATUSES = [
  'initializing', 'queued', 'planning', 'running', 'waiting_external',
  'waiting_approval', 'waiting_human', 'paused', 'cancelling',
] as const;
const PLATFORMS = new Set(['facebook', 'instagram', 'tiktok', 'youtube']);
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const text = (value: unknown, max = 500): string => typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Serializes initial-setup replacement per tenant across every port instance in
 * this process. Database uniqueness remains the final cross-process guard; a
 * datastore transaction/CAS is still required for cross-process serialization.
 */
const tenantSetupTails = new Map<string, Promise<void>>();

async function withTenantSetupLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  const previous = tenantSetupTails.get(tenantId) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  tenantSetupTails.set(tenantId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (tenantSetupTails.get(tenantId) === tail) tenantSetupTails.delete(tenantId);
  }
}

function object(value: unknown): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonObject;
    } catch {}
  }
  return {};
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as JsonObject;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeSetup(value: Starter198InitialSetupInput): Starter198InitialSetupInput {
  const setup = {
    companyName: text(value.companyName, 120),
    industry: text(value.industry, 120),
    primaryBusiness: text(value.primaryBusiness, 500),
    focusProducts: text(value.focusProducts, 500),
    targetMarkets: text(value.targetMarkets, 300),
    customerProfile: text(value.customerProfile, 500),
    primaryPlatform: text(value.primaryPlatform, 40).toLowerCase(),
    primaryLanguage: text(value.primaryLanguage, 20),
    constraints: Array.isArray(value.constraints)
      ? [...new Set(value.constraints.map(item => text(item, 240)).filter(Boolean))].slice(0, 10)
      : [],
  };
  if ([setup.companyName, setup.industry, setup.primaryBusiness, setup.focusProducts, setup.targetMarkets, setup.customerProfile]
    .some(item => !item)
    || !PLATFORMS.has(setup.primaryPlatform)
    || !LANGUAGE_PATTERN.test(setup.primaryLanguage)) {
    throw new Starter198RuntimePortError('starter_198_initial_setup_invalid', 400);
  }
  return setup as Starter198InitialSetupInput;
}

/** Canonical fingerprint shared by durable command recovery and configuration writes. */
export function starter198InitialSetupFingerprint(value: Starter198InitialSetupInput): string {
  return hash(normalizeSetup(value));
}

async function exactTenantRow(dataStore: DataStore, collection: string, tenantId: string): Promise<Row | null> {
  const result = await dataStore.list<Row>(collection, { where: { tenant_id: tenantId }, perPage: 2 });
  if (result.totalItems > 1 || result.items.length > 1
    || result.items.some(row => text(row.tenant_id, 200) !== tenantId)) {
    throw new Starter198RuntimePortError('starter_198_initial_setup_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

async function assertNoActiveRun(repository: Starter198Repository, tenantId: string): Promise<void> {
  const results = await Promise.all(ACTIVE_RUN_STATUSES.map(status => repository.list('workflow_runs', tenantId, {
    where: { status }, perPage: 2,
  })));
  if (results.some(result => result.totalItems > result.items.length)) {
    throw new Starter198RuntimePortError('starter_198_run_state_unavailable', 503);
  }
  if (results.some(result => result.totalItems > 0)) {
    throw new Starter198RuntimePortError('starter_198_initial_setup_run_active', 409);
  }
}

function enterprisePatch(current: JsonObject, setup: Starter198InitialSetupInput): EnterpriseFactsProfile & JsonObject {
  const company = object(current.company);
  const strategy = object(current.strategy);
  const customers = object(current.customers);
  const products = object(current.products);
  const items = Array.isArray(products.items)
    ? products.items.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as JsonObject[]
    : [];
  const focus = setup.focusProducts.toLowerCase();
  const matching = items.find(item => [text(item.name, 500), text(item.sku, 500)]
    .some(value => value.toLowerCase() === focus));
  if (items.length > 1) {
    throw new Starter198RuntimePortError('starter_198_initial_setup_product_limit_conflict', 409);
  }
  if (items.length === 1 && !matching) {
    throw new Starter198RuntimePortError('starter_198_initial_setup_product_mismatch', 409);
  }
  return {
    ...current,
    company: {
      ...company,
      name: setup.companyName,
      industry: setup.industry,
      mainMarkets: setup.targetMarkets,
      description: setup.primaryBusiness,
    },
    strategy: {
      ...strategy,
      focusProducts: setup.focusProducts,
      focusMarkets: setup.targetMarkets,
    },
    customers: {
      ...customers,
      targetProfiles: setup.customerProfile,
    },
    products: {
      ...products,
      items: matching ? items : [{ name: setup.focusProducts }],
    },
  } as EnterpriseFactsProfile & JsonObject;
}

async function saveRow(input: {
  dataStore: DataStore;
  collection: string;
  current: Row | null;
  payload: JsonObject;
  unavailableCode: string;
}): Promise<Row> {
  if (input.current) {
    if (!await input.dataStore.update(input.collection, input.current.id, input.payload)) {
      throw new Starter198RuntimePortError(input.unavailableCode, 503);
    }
    const updated = await input.dataStore.getById<Row>(input.collection, input.current.id);
    if (!updated) throw new Starter198RuntimePortError(input.unavailableCode, 503);
    return updated;
  }
  const created = await input.dataStore.create<Row>(input.collection, input.payload);
  if (!created) throw new Starter198RuntimePortError(input.unavailableCode, 503);
  return created;
}

export function createStarter198InitialSetupPort(dependencies: {
  dataStore?: DataStore;
  repository?: Starter198Repository;
  now?: () => Date;
} = {}): Starter198InitialSetupPort {
  const dataStore = dependencies.dataStore ?? store;
  const repository = dependencies.repository ?? starter198Repository;
  return {
    async configure(input) {
      return withTenantSetupLock(input.tenantId, async () => {
        const setup = normalizeSetup(input.setup);
        await assertNoActiveRun(repository, input.tenantId);
        const access = await repository.access(input.tenantId);
        const [profileRow, configRow] = await Promise.all([
          exactTenantRow(dataStore, 'tenant_profiles', input.tenantId),
          exactTenantRow(dataStore, 'digital_employee_configs', input.tenantId),
        ]);
        const now = dependencies.now?.() ?? new Date();
        const requestHash = starter198InitialSetupFingerprint(setup);
        const existingEffective = object(configRow?.effective_config);
        const priorSetup = object(existingEffective.initialSetup);
        if (text(priorSetup.idempotencyKey, 200) === input.idempotencyKey
          && text(priorSetup.requestHash, 200) !== requestHash) {
          throw new Starter198RuntimePortError('starter_198_initial_setup_idempotency_conflict', 409);
        }
        const repeated = text(priorSetup.idempotencyKey, 200) === input.idempotencyKey
          && text(priorSetup.requestHash, 200) === requestHash;
        const currentProfile = object(profileRow?.profile);
        const nextProfile = enterprisePatch(currentProfile, setup);
        const currentVersion = Number(configRow?.config_version);
        const configVersion = repeated && Number.isInteger(currentVersion) && currentVersion > 0
          ? currentVersion
          : Math.max(1, (Number.isInteger(currentVersion) ? currentVersion : 0) + 1);
        const resolved = resolveDigitalEmployeeConfiguration({
          config: {
            ...setup,
            videoDefaults: { platform: setup.primaryPlatform, language: setup.primaryLanguage },
            videoLanguages: [setup.primaryLanguage],
            approvalOwner: input.userId,
            autonomyMode: 'managed',
            primaryGoal: 'leads',
            enabledWorkflows: ['product_content', 'content_publish', 'customer_segmentation'],
            publishingTargets: [],
            allowRealPublishing: false,
            allowRealCustomerMessages: false,
            allowGeneratedVisuals: false,
          },
          enterpriseProfile: nextProfile,
          configVersion,
          boundAt: now.toISOString(),
        });
        const missing = validateDigitalEmployeeConfig(resolved.config);
        if (missing.length || resolved.knowledgeBinding.warnings.length) {
          throw new Starter198RuntimePortError('starter_198_initial_setup_incomplete', 400);
        }
        const effectiveConfig = {
          configVersion: resolved.configVersion,
          policyVersion: resolved.policyVersion,
          knowledgeBinding: resolved.knowledgeBinding,
          runtimePolicy: resolved.runtimePolicy,
          initialSetup: {
            schemaVersion: 'starter-198.initial-setup.v1',
            idempotencyKey: input.idempotencyKey,
            requestHash,
            confirmedBy: input.userId,
            confirmedAt: now.toISOString(),
            entitlementSnapshotId: access.entitlementSnapshotId,
          },
        };
        const versions = await dataStore.list<Row>('digital_employee_config_versions', {
          where: { tenant_id: input.tenantId, config_version: resolved.configVersion }, perPage: 2,
        });
        if (versions.totalItems > 1 || versions.items.length > 1) {
          throw new Starter198RuntimePortError('starter_198_initial_setup_integrity_violation', 503);
        }
        const versionPayload = {
          tenant_id: input.tenantId,
          config_version: resolved.configVersion,
          policy_version: resolved.policyVersion,
          facts_version: resolved.knowledgeBinding.factsVersion,
          config: resolved.config,
          knowledge_binding: resolved.knowledgeBinding,
          runtime_policy: resolved.runtimePolicy,
          status: 'active',
          created_by: input.userId,
          created_at: now.toISOString(),
        };
        if (versions.items[0]) {
          const version = versions.items[0];
          if (text(version.tenant_id, 200) !== input.tenantId
            || text(version.policy_version, 200) !== resolved.policyVersion
            || text(version.facts_version, 200) !== resolved.knowledgeBinding.factsVersion
            || hash(object(version.config)) !== hash(resolved.config)) {
            throw new Starter198RuntimePortError('starter_198_initial_setup_version_conflict', 409);
          }
        } else if (!await dataStore.create('digital_employee_config_versions', versionPayload)) {
          throw new Starter198RuntimePortError('starter_198_initial_setup_version_unavailable', 503);
        }
        // The immutable version must exist before either mutable projection is advanced.
        // If a later write fails, replaying the same request heals the projections;
        // a different payload fails closed against the already reserved version.
        if (!repeated) {
          await saveRow({
            dataStore,
            collection: 'tenant_profiles',
            current: profileRow,
            payload: {
              tenant_id: input.tenantId,
              profile: nextProfile,
              updated_by: input.userId,
            },
            unavailableCode: 'starter_198_initial_setup_profile_unavailable',
          });
          await saveRow({
            dataStore,
            collection: 'digital_employee_configs',
            current: configRow,
            payload: {
              tenant_id: input.tenantId,
              config: resolved.config,
              status: 'active',
              config_version: resolved.configVersion,
              policy_version: resolved.policyVersion,
              facts_version: resolved.knowledgeBinding.factsVersion,
              effective_config: effectiveConfig,
              activated_at: now.toISOString(),
              updated_by: input.userId,
              updated_at: now.toISOString(),
              ...(configRow ? {} : { created_at: now.toISOString() }),
            },
            unavailableCode: 'starter_198_initial_setup_config_unavailable',
          });
        }
        return {
          configVersion: resolved.configVersion,
          factsVersion: resolved.knowledgeBinding.factsVersion,
          repeated,
        };
      });
    },
  };
}
