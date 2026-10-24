import { creationReplySchema, type CreationReply, type CreationSelection } from '../../../shared/contracts/contentCreationDialogue';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';
import { authHeader } from '../../lib/auth';

/** Fresh evidence is a planning snapshot, never an execution permit or presenter authorization. */
export async function readCreationHandoff(selection: CreationSelection): Promise<CreationReply> {
  const response = await fetch('/api/overseas/strategy/creation-dialogue', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ action: 'avatar', selection, instruction: '进入生产工作台前重新核验当前创作方案；不启动生成' }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || '方案核验失败，请刷新推荐。');
  const reply = creationReplySchema.parse(body);
  if (reply.stage !== 'review') throw new Error('方案尚未完成选择。');
  return reply;
}
export function creationHandoffRequest(reply: CreationReply, requestId = Date.now()): SocialContentCreateRequest {
  const plan = creationReplySchema.parse(reply);
  const products = plan.products.filter(row => plan.selection.productIds.includes(row.id));
  const narration = plan.narrations.find(row => row.id === plan.selection.narrationId);
  if (plan.stage !== 'review' || !products.length || !narration || plan.selection.avatar === undefined) throw new Error('请先完成产品、分镜、口播及数字人选择。');
  return {
    requestId, themeId: 'product_value', mode: 'instant', creationPath: 'material_processing', materialInput: 'limited', managedMode: 'one_click_managed',
    prefill: { title: `${products.map(row => row.name).join('、')} · 创作草稿`, productId: products[0]!.id, productName: products[0]!.name, topic: narration.text },
    identityMappings: { selectedProductIds: products.map(row => row.id), selectedProductNames: products.map(row => row.name), products: products.map(row => ({ sourceTerm: row.name, productId: row.id, productName: row.name })) },
    sourceContext: { originLabel: '来自内容创作对话', referenceTitle: plan.referenceTitle, referenceContentType: 'video', referenceThumbnail: plan.selection.referenceThumbnail },
    creationDialoguePlan: plan,
    specialRequirements: ['所选参考仅作结构借鉴，素材使用权和产品归属仍待生产校验。', ...plan.gaps].join('\n'),
  };
}
