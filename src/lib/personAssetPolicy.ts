export const personSetupLabels: Record<string, string> = {
  submitting: '正在提交', consent_required: '待本人授权', consent_review: '人物准备中 · 授权审核', consent_submission_unknown: '授权提交待核实', training: '人物准备中', ready: '可生成口播', failed: '创建失败',
};
export function personIsReady(asset: {productionReady?: boolean; personSetup?: {state: string}; cloudPersonReady?: boolean}) {
  return asset.productionReady === true && (!asset.personSetup || asset.personSetup.state === 'ready')
    && asset.cloudPersonReady === true;
}

/** A saved identity is a promise to the user, not a hint for fallback routing. */
export function selectPerson<T extends {id: string; sourceType?: string}>(items: T[], selectedId: string | undefined, preferredId: string | undefined, eligible: (item: T) => boolean): T | undefined {
  const lockedId = selectedId || preferredId;
  if (lockedId) return items.find(item => item.id === lockedId && eligible(item));
  return items.find(item => item.sourceType === 'platform-person' && eligible(item)) || items.find(eligible);
}
