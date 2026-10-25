import type { AssistantCreationPortal } from '../../shared/contracts/assistantCreationPortal';
import type { CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow';

/** Save the confirmed intake on the original task; never infer a weekly authority or queue receipt. */
export function replicationConfirmationInput(portal: AssistantCreationPortal): CreateSocialContentTaskInput {
  const products = portal.selectedProducts?.length ? portal.selectedProducts
    : portal.selectedProductId && portal.selectedProductName ? [{ id: portal.selectedProductId, name: portal.selectedProductName }] : [];
  if (!portal.selectedReferenceId || !products.length || !portal.plannedPublishAt) throw new Error('请先确认对标视频、产品和预计发布时间。');
  const publishAt = new Date(`${portal.plannedPublishAt}+08:00`);
  if (!Number.isFinite(publishAt.getTime()) || publishAt.getTime() <= Date.now()) throw new Error('预计发布时间已过期，请重新选择。');
  const requirements = JSON.stringify({ source: 'assistant_replication_confirmation', referenceId: portal.selectedReferenceId,
    products, plannedPublishAt: publishAt.toISOString(), timezone: 'Asia/Shanghai' });
  if (requirements.length > 2000) throw new Error('所选产品信息过多，请减少产品数量后确认。');
  return { title: `爆款复刻 · ${products.map(product => product.name).join('、')}`.slice(0, 120),
    objective: portal.objective, creationMode: 'viral_replication', referenceMode: 'single_source_fidelity',
    managementMode: 'one_click_managed', mode: 'instant', themeId: 'product_value', requestedOutputCount: 1,
    ...(products.length === 1 ? { productId: products[0].id, productRef: products[0].name } : {}),
    specialRequirements: requirements,
  };
}

export async function replicationConfirmationKey(portalId: string, input: CreateSocialContentTaskInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([portalId, input])));
  return `assistant-replication:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
}
