import type { CustomerProfile } from '../../types/customer';
import { applyTagCorrections, readTagCorrections, type CustomerTagDimension } from '../../../shared/contracts/customerTags';
import { STAGE_LABEL } from './conversionPresentation';
import { isWaitingForHumanQuote } from './customerReplyPreparation';

const statuses = new Set(['潜客', '询盘中', '询价中', '待报价', '已报价', '已成交', '沉默客户', '待样品', '待跟进']);
const channels = /^(?:whatsapp|messenger|instagram|facebook|youtube|tiktok)(?:_from_.*)?$/i;
export type ProfileTag = {
  key: string; label: string; dimension: CustomerTagDimension; source: 'ai' | 'human' | 'existing';
  evidence?: CustomerProfile['contextTagEvidence']; updatedAt?: string; reason?: string;
};
export function customerFollowupStatus(customer: CustomerProfile) {
  if (customer.stage === 'inquiry' && (isWaitingForHumanQuote(customer) || customer.tags.includes('待报价') || customer.estimatedValue === '待报价')) return '待报价';
  return STAGE_LABEL[customer.stage];
}
export function tagDimension(tag: string): CustomerTagDimension {
  if (/风险|预警|敏感|异议|投诉|黑名单|退订|拒收|勿扰|价格|比价|拖欠/.test(tag)) return 'risk';
  if (/需求|定制|产品|设备|材料|型号|图纸|包装|视觉|治具|CNC|OEM|ODM|CE|FAT/i.test(tag)) return 'need';
  if (/采购|预算|交期|样品|补货|复购|会议|决策|试单|集团|意向/.test(tag)) return 'signal';
  return 'profile';
}
export function customerProfileTags(customer: CustomerProfile): ProfileTag[] {
  const corrections = readTagCorrections(customer.contextTagCorrections);
  return applyTagCorrections(customer.tags, corrections).filter(tag => !statuses.has(tag) && !channels.test(tag)).map(label => {
    const correction = corrections.find(c => c.replacement === label);
    const key = correction?.tag || label;
    const evidence = correction?.evidence?.length ? correction.evidence.map(e => ({...e,tag:key})) : customer.contextTagEvidence?.filter(e => e.tag === key);
    return { key, label, dimension: correction?.dimension || tagDimension(label), source: correction ? 'human' : evidence?.length ? 'ai' : 'existing',
      evidence, updatedAt: correction?.updatedAt || (evidence?.length ? customer.contextTagsUpdatedAt : undefined), reason: correction?.reason };
  });
}
