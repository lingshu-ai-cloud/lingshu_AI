import { createHash } from 'node:crypto';
import {
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingConfirmation,
} from '../../shared/contracts/enterpriseOnboarding.js';
import {
  EnterpriseFactVersionConflictError,
  readTenantEnterpriseProfile,
  readTenantEnterpriseProfileStrict,
  updateTenantEnterpriseProfile,
} from '../routes/enterpriseProfileStore.js';
import type { EnterpriseProfile } from '../routes/enterpriseProfileContracts.js';

export class EnterpriseOnboardingConfirmationError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

function confirmationDigest(confirmation: EnterpriseOnboardingConfirmation): string {
  return createHash('sha256').update(JSON.stringify(confirmation)).digest('hex');
}

function routeFor(confirmation: EnterpriseOnboardingConfirmation): 'oem_odm' | 'wholesale_distribution' | 'consumer_retail' {
  if (confirmation.contentStage === 'd2c_brand') return 'consumer_retail';
  return /oem|odm|贴牌|定制|代工|工厂/iu.test(`${confirmation.industry} ${confirmation.primaryBusiness}`)
    ? 'oem_odm'
    : 'wholesale_distribution';
}

export function parseEnterpriseOnboardingConfirmation(value: unknown): EnterpriseOnboardingConfirmation {
  const parsed = validateEnterpriseOnboardingConfirmation(value);
  if (!parsed.confirmation) throw new EnterpriseOnboardingConfirmationError(
    'enterprise_onboarding_confirmation_invalid', 400, '首次建档资料尚未完整确认。', { missing: parsed.missing },
  );
  return parsed.confirmation;
}

export async function applyEnterpriseOnboardingConfirmation(input: {
  tenantId: string;
  userId: string;
  confirmation: EnterpriseOnboardingConfirmation;
}): Promise<EnterpriseProfile> {
  const current = await readTenantEnterpriseProfile(input.tenantId);
  const digest = confirmationDigest(input.confirmation);
  const priorId = current.digitalEmployeeOnboarding?.confirmationId;
  if (priorId === input.confirmation.confirmationId) {
    if (current.digitalEmployeeOnboarding?.confirmationDigest !== digest) {
      throw new EnterpriseOnboardingConfirmationError(
        'enterprise_onboarding_confirmation_reused', 409,
        '这次确认请求已经用于另一版资料，请刷新后重新确认。',
      );
    }
    return current;
  }
  const expected = input.confirmation.baseFactVersion;
  if (expected !== current.factVersion?.id && expected !== current.factVersion?.contentHash) {
    throw new EnterpriseOnboardingConfirmationError(
      'enterprise_fact_version_conflict', 409, '企业资料已在其他窗口更新，请刷新后重新核对。',
      { factVersion: current.factVersion },
    );
  }
  const focusProducts = input.confirmation.focusProductIds
    .map(id => input.confirmation.products.find(product => product.id === id))
    .filter((product): product is EnterpriseOnboardingConfirmation['products'][number] => Boolean(product));
  const route = routeFor(input.confirmation);
  const now = new Date().toISOString();
  try {
    await updateTenantEnterpriseProfile(input.tenantId, {
      company: {
        ...current.company,
        name: input.confirmation.companyName,
        industry: input.confirmation.industry,
        primaryBusiness: input.confirmation.primaryBusiness,
        description: input.confirmation.companyIntro || current.company.description,
        mainMarkets: input.confirmation.targetMarket,
        primaryLanguages: input.confirmation.language,
      },
      brand: {
        ...current.brand,
        name: input.confirmation.brandName,
        tone: input.confirmation.brandTone || current.brand.tone,
      },
      products: input.confirmation.productsDeferred ? current.products : {
        ...current.products,
        items: input.confirmation.products,
        categories: [...new Set(focusProducts.map(product => product.category).filter(Boolean))].join('、'),
        highlights: focusProducts.map(product => product.highlights || product.description).filter(Boolean).join('；'),
      },
      strategy: {
        ...current.strategy,
        focusProducts: input.confirmation.productsDeferred ? current.strategy?.focusProducts : focusProducts.map(product => product.name).join('、'),
        focusMarkets: input.confirmation.targetMarket,
      },
      customers: {
        ...current.customers,
        targetProfiles: input.confirmation.targetBuyer,
      },
      socialStrategy: {
        ...current.socialStrategy,
        enabledRoutes: [...new Set([...(current.socialStrategy?.enabledRoutes || []), route])],
        routeStrategies: {
          ...(current.socialStrategy?.routeStrategies || {}),
          [route]: { targetBuyerRoles: [input.confirmation.targetBuyer], primaryCta: input.confirmation.primaryCta },
        },
        contentStage: input.confirmation.contentStage,
        primaryPlatforms: [input.confirmation.primaryPlatform],
      },
      digitalEmployeeOnboarding: {
        ...current.digitalEmployeeOnboarding,
        profileConfirmedAt: now,
        ...(input.confirmation.productsDeferred ? {} : { productSelectionConfirmedAt: now }),
        continuedWithoutProducts: input.confirmation.productsDeferred === true && !(current.products.items?.length),
        confirmationId: input.confirmation.confirmationId,
        confirmationDigest: digest,
        completedAt: now,
      },
      customerService: {
        ...current.customerService,
        enabled: false,
        disabledAt: now,
        partialAutoReplyEnabled: false,
        partialAutoReplyDecision: 'pending',
        partialAutoReplyDecisionAt: '',
      },
    }, input.userId, expected);
  } catch (error) {
    if (error instanceof EnterpriseFactVersionConflictError) throw new EnterpriseOnboardingConfirmationError(
      'enterprise_fact_version_conflict', 409, '企业资料已在其他窗口更新，请刷新后重新核对。',
      { factVersion: error.current },
    );
    throw error;
  }
  const confirmed = await readTenantEnterpriseProfileStrict(input.tenantId);
  if (!confirmed?.factVersion
    || confirmed.digitalEmployeeOnboarding?.confirmationId !== input.confirmation.confirmationId
    || confirmed.digitalEmployeeOnboarding?.confirmationDigest !== digest) {
    throw new EnterpriseOnboardingConfirmationError(
      'enterprise_onboarding_readback_failed', 503, '企业事实已提交，但暂时无法核验保存结果，请勿重复修改。',
    );
  }
  return confirmed;
}
