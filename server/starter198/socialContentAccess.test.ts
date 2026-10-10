import assert from 'node:assert/strict';
import { STARTER_198_CAPABILITIES, type Starter198ResourceLimits } from '../../shared/contracts/starter198.js';
import type { Subscription } from '../middleware/subscription.js';
import {
  createSocialContentAccessResolver,
  SocialContentAccessError,
} from './socialContentAccess.js';
import { assertSocialTaskChildCapacity, SOCIAL_CONTENT_HARD_LIMITS } from './socialContentLimits.js';
import type { Starter198AccessSnapshot } from './profile.js';
import {
  Starter198RepositoryError,
  type Starter198Repository,
} from './repository.js';

const NOW = new Date('2026-09-20T08:00:00.000Z');
const limits: Starter198ResourceLimits = {
  workspaceCount: 1,
  brandCount: 1,
  memberCount: 3,
  agentTeamCount: 1,
  productCount: 1,
  marketCount: 1,
  buyerPersonaCount: 2,
  languageCount: 2,
  primaryPlatformCount: 2,
  concurrentRunCount: 1,
  contentArtifactCountPerCycle: 7,
  contentRevisionCountPerCycle: 3,
  publicationPackageCountPerContent: 2,
  assistedSessionCount: 5,
  inquiryAiCountPerCycle: 100,
  quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0,
  budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

function starterAccess(disabledCapability?: typeof STARTER_198_CAPABILITIES[number]): Starter198AccessSnapshot {
  return {
    recordId: 'starter-access-1',
    tenantId: 'tenant-1',
    productProfile: 'starter_198',
    profileVersion: 'starter_198.v1',
    entitlementSnapshotId: 'starter-snapshot-1',
    entitlements: STARTER_198_CAPABILITIES.map(capability => ({
      capability,
      enabled: capability !== disabledCapability,
    })),
    resourceLimits: limits,
    status: 'active',
    cycleStartedAt: '2026-09-01T00:00:00.000Z',
    cycleEndsAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

function repository(input: {
  access: () => Promise<Starter198AccessSnapshot>;
  count?: number;
}): Starter198Repository {
  return {
    access: async () => input.access(),
    list: async (_collection, _tenantId, query = {}) => ({
      items: [],
      totalItems: input.count ?? 0,
      totalPages: input.count ? 1 : 0,
      page: query.page ?? 1,
      perPage: query.perPage ?? 20,
    }),
    get: async () => null,
    create: async () => { throw new Error('not used'); },
    update: async () => { throw new Error('not used'); },
  };
}

const activeSubscription: Subscription = { status: 'active', plan: 'customer', expiresAt: null };

{
  let subscriptionReads = 0;
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async () => {
      subscriptionReads += 1;
      return activeSubscription;
    },
  });
  const result = await resolver.resolve({
    repository: repository({ access: async () => starterAccess() }),
    tenantId: 'tenant-1',
    requiredCapabilities: ['orchestrator.command.submit', 'workflow.standard.run'],
    requireOpenCycle: true,
    now: NOW,
  });
  assert.equal(result.kind, 'starter_198');
  assert.equal(subscriptionReads, 0, 'a provisioned starter tenant never consults the normal subscription');
}

{
  let subscriptionReads = 0;
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async () => {
      subscriptionReads += 1;
      return activeSubscription;
    },
  });
  await assert.rejects(
    resolver.resolve({
      repository: repository({ access: async () => starterAccess('workflow.standard.run') }),
      tenantId: 'tenant-1',
      requiredCapabilities: ['workflow.standard.run'],
      now: NOW,
    }),
    (error: unknown) => error instanceof SocialContentAccessError
      && error.code === 'social_content_not_entitled'
      && error.status === 403,
  );
  assert.equal(subscriptionReads, 0, 'starter capability denial must fail closed instead of falling back');
}

{
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async tenantId => {
      assert.equal(tenantId, 'tenant-1');
      return activeSubscription;
    },
    subscriptionEntitled: subscription => subscription.status === 'active',
  });
  const result = await resolver.resolve({
    repository: repository({
      access: async () => { throw new Starter198RepositoryError('starter_198_not_provisioned'); },
    }),
    tenantId: 'tenant-1',
    requiredCapabilities: ['workspace.read', 'production_site.read'],
    now: NOW,
  });
  assert.deepEqual(result, { kind: 'subscription', subscription: activeSubscription });
}

{
  const unavailable = new Starter198RepositoryError('starter_198_storage_unavailable');
  let subscriptionReads = 0;
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async () => {
      subscriptionReads += 1;
      return activeSubscription;
    },
  });
  await assert.rejects(
    resolver.resolve({
      repository: repository({ access: async () => { throw unavailable; } }),
      tenantId: 'tenant-1',
      requiredCapabilities: ['workspace.read'],
      now: NOW,
    }),
    error => error === unavailable,
  );
  assert.equal(subscriptionReads, 0, 'all starter access errors except not-provisioned fail closed');
}

{
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async () => ({ status: 'past_due', plan: 'customer', expiresAt: null }),
    subscriptionEntitled: subscription => subscription.status === 'active',
  });
  await assert.rejects(
    resolver.resolve({
      repository: repository({
        access: async () => { throw new Starter198RepositoryError('starter_198_not_provisioned'); },
      }),
      tenantId: 'tenant-1',
      requiredCapabilities: ['workspace.read'],
      now: NOW,
    }),
    (error: unknown) => error instanceof SocialContentAccessError
      && error.code === 'social_content_not_entitled',
  );
}

{
  const subscribedRepository = repository({
    access: async () => { throw new Starter198RepositoryError('starter_198_not_provisioned'); },
    count: SOCIAL_CONTENT_HARD_LIMITS.artifactsPerTask - 1,
  });
  const resolver = createSocialContentAccessResolver({
    loadSubscription: async () => activeSubscription,
    subscriptionEntitled: () => true,
  });
  await assertSocialTaskChildCapacity({
    repository: subscribedRepository,
    accessResolver: resolver,
    tenantId: 'tenant-1',
    taskId: 'task-1',
    kind: 'artifact',
    now: NOW,
  });

  await assert.rejects(
    assertSocialTaskChildCapacity({
      repository: repository({
        access: async () => { throw new Starter198RepositoryError('starter_198_not_provisioned'); },
        count: SOCIAL_CONTENT_HARD_LIMITS.deliveryPackagesPerTask,
      }),
      accessResolver: resolver,
      tenantId: 'tenant-1',
      taskId: 'task-1',
      kind: 'delivery_package',
      now: NOW,
    }),
    (error: any) => error?.code === 'social_content_delivery_package_limit_reached',
  );
}

console.log('Social-content access resolver strict fallback and subscription hard-limit tests passed');
