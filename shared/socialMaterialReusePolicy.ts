import {normalizeSceneVisualContract, type SocialSceneVisualContract} from './sceneVisualContract.js';

/** Frozen planning evidence; a task-level product selection is not a shot SKU lock. */
export interface SocialMaterialReusePolicy {
  version: 'local-reuse.v1';
  skuMode: 'single_sku' | 'unrestricted';
  basis: 'reference_single_sku' | 'reference_unrestricted' | 'explicit_shot' | 'unrestricted';
  referenceShotId: string | null;
  requestedProductRef: string | null;
}

export function socialMaterialReusePolicy(input:{referenceShotId?:string|null;referenceVisual?:SocialSceneVisualContract;shotVisual?:SocialSceneVisualContract;taskProductRef?:string|null}):SocialMaterialReusePolicy {
  const reference=Boolean(input.referenceShotId),visual=input.referenceVisual??(!reference?input.shotVisual:undefined);
  const ids=new Set(visual?.subjects.filter(s=>s.kind==='product').map(s=>s.identityRef).filter(Boolean));
  const explicit=Boolean(visual&&visual.product.policy==='locked'
    &&(visual.product.requestedProductId||visual.product.requestedProductRef)&&ids.size<=1
    &&(reference||visual.product.source==='user_explicit'));
  return {version:'local-reuse.v1',skuMode:explicit?'single_sku':'unrestricted',
    basis:explicit?reference?'reference_single_sku':'explicit_shot':reference?'reference_unrestricted':'unrestricted',
    referenceShotId:input.referenceShotId??null,
    requestedProductRef:explicit?(input.taskProductRef||visual!.product.requestedProductId||visual!.product.requestedProductRef):null};
}

/** Remove inherited task SKU only for matching; never edit the source observation. */
export function materialVisualWithoutSku(visual:SocialSceneVisualContract):SocialSceneVisualContract {
  return normalizeSceneVisualContract({...visual,
    product:{policy:'open',requestedProductId:null,requestedProductRef:null,source:'inventory_open'},
    productUsage:{...visual.productUsage,productId:null,productRef:null}});
}

/** Display-only b-roll may change set dressing or use a hand-held package.
 * Application/results and evidence-bearing shots are deliberately excluded. */
export function isFunctionalProductDisplay(input:{expected:SocialSceneVisualContract;candidate:SocialSceneVisualContract;roles:string[];truthSubject?:string;function:string;skuMode:string}):boolean {
  const {expected,candidate,roles}=input;
  if(input.skuMode!=='unrestricted'||input.truthSubject&&input.truthSubject!=='none'
    ||!['value','hook','transition','demonstration'].includes(input.function)
    ||!roles.includes('product')||roles.some(r=>['factory','presenter','customer_case'].includes(r)))return false;
  if(!['product_only_display','person_holding_product'].includes(expected.interaction.kind)
    ||!['product_only_display','person_holding_product'].includes(candidate.interaction.kind)
    ||['apply_to_face','apply_to_hand','dispense','result_display','open_close'].includes(candidate.productUsage.kind))return false;
  // An inherited person_usage role alone is not observed consumer use. Require
  // explicit holding evidence before accepting that role in a display shot.
  if(roles.includes('person_usage')&&!isObservedHandheldDisplay({interactionKind:candidate.interaction.kind,
    observedActionTags:[candidate.action.path,candidate.interaction.description]}))return false;
  return candidate.subjects.some(s=>s.kind==='product');
}

export function isObservedHandheldDisplay(input:{interactionKind:string;observedActionTags:string[]}):boolean {
  return input.interactionKind==='person_holding_product'
    && /手持|手握|握持|持管|持瓶|拿着|握住|\b(?:hold|holding|held|grip)\b/i.test(input.observedActionTags.join(' '));
}

/** Correct stale display labels only from positive, source-observed use. */
export function isObservedConsumerApplication(visual:SocialSceneVisualContract,description:string):boolean {
  return ['person_using_product','apply_product_to_face'].includes(visual.interaction.kind)
    || /(?:睫毛刷|睫毛膏|刷头).{0,24}(?:刷动|涂刷|刷睫毛)|(?:涂抹|上妆|擦拭).{0,12}(?:面部|脸部|皮肤)|(?:apply|applying).{0,24}(?:face|skin|eyelash)/i.test([description,visual.action.path,visual.interaction.description].join('；'));
}
