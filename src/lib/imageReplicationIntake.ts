import type { AssistantCatalogProduct } from './assistantProductCatalog';
import type { ImageReplicationDraft } from './imageReplicationDraft';
import type { AssistantCreationPortal } from '../../shared/contracts/assistantCreationPortal';

export type ImageReplicationIntake = NonNullable<NonNullable<AssistantCreationPortal['imageReplication']>['intake']>;
export type ImageReplicationReferenceIdentity = NonNullable<NonNullable<AssistantCreationPortal['imageReplication']>['reference']>;

/** Recommendations are planning instructions; never invent product facts or an audience identity. */
export function resolveImageReplicationIntake(product: AssistantCatalogProduct, input: {
  objective: string; audience: string; callToAction: string;
}) {
  return {
    objective: input.objective.trim() || product.highlights?.trim().slice(0, 1000) || '',
    audience: input.audience.trim() || '依据已确认的企业资料匹配目标客户；资料不足时采用通用产品介绍，不假设客户画像',
    callToAction: input.callToAction.trim() || '咨询产品详情',
  } satisfies Pick<ImageReplicationDraft, 'objective' | 'audience' | 'callToAction'>;
}
