import type { SocialSceneVisualContract } from './sceneVisualContract.js';

/** Positive evidence for the current shot; adjacent states and negative prompts are excluded. */
export function currentMaterialDescription(description = ''): string {
  return description.split(/须避免[:：]?|负面提示[:：]?|negative\s*prompt[:：]?|\bavoid[:：]?/i, 1)[0]!
    .split(/[；;。,.，\n]/).filter(part => !/禁止|不得|不能|没有|未见|不出现|\b(?:no|not|without|never)\b/i.test(part)).join('；');
}

export function enterpriseScenePurpose(visual: SocialSceneVisualContract, description = ''): 'design' | 'shopping' | 'meeting' | null {
  const text = currentMaterialDescription([description, visual.interaction.description, visual.action.path,
    visual.environment.description, ...visual.subjects.map(subject => subject.description)].join('；'));
  if (visual.environment.kind === 'factory' || ['factory_process', 'person_factory_interaction', 'person_holding_product', 'apply_product_to_face'].includes(visual.interaction.kind)
    || ['apply_to_face', 'apply_to_hand', 'result_display'].includes(visual.productUsage.kind)
    || /涂抹|上脸|卸妆|擦拭|使用后|效果对比|before.?and.?after|apply.{0,20}(?:face|skin)/i.test(text)) return null;
  if (/设计图|设计稿|包装设计|绘制.{0,30}(?:瓶|包装|设计)|(?:sketch|draw).{0,30}(?:design|packag)/i.test(text)) return 'design';
  if (/顾客.{0,40}(?:挑选|选购|浏览)|(?:挑选|选购|浏览).{0,20}(?:商品|产品)|customer.{0,30}(?:shop|browse)/i.test(text)) return 'shopping';
  if (/商务洽谈|商务交流|商务会谈|围坐.{0,30}(?:品茶|交谈|洽谈)|(?:男士|女士|多人|一群人).{0,35}交谈|business.{0,20}(?:meeting|discussion|negotiation)/i.test(text)) return 'meeting';
  return null;
}

export function isContactGraphicScene(visual: SocialSceneVisualContract, description = ''): boolean {
  const text = currentMaterialDescription(description);
  return /contact\s*(?:me|us)|联系我|联系方式|联系我们/i.test(text)
    && /头像|图标|二维码|爱心|飞机|黑色背景|品牌收尾|avatar|icon|logo|end.?card/i.test(text)
    && !visual.subjects.some(subject => subject.kind === 'product')
    && !['person_talking', 'person_using_product', 'person_holding_product', 'apply_product_to_face'].includes(visual.interaction.kind);
}
