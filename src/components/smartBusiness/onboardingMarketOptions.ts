import { AD_COUNTRY_CODES, adCountryName } from '../../../shared/metaAdJourney';

export const ONBOARDING_MARKET_OPTIONS = [
  '全球', '北美', '欧洲', '东南亚', '中东', '拉丁美洲', '非洲', '大洋洲', '中国',
  ...AD_COUNTRY_CODES.map(adCountryName),
].map(value => ({ value, label: value }));

export const ONBOARDING_BUYER_OPTIONS = [
  '品牌商', '进口商', '经销商', '批发商', '零售商', '电商卖家', '采购负责人',
  '渠道负责人', '制造商 / OEM 客户', '专业服务机构', '终端消费者',
].map(value => ({ value, label: value }));

// Keep the existing string contract and preserve older free-form/AI suggestions.
export function onboardingSelections(value: string): string[] {
  return [...new Set(value.split(/[、，,；;\n]/u).map(item => item.trim()).filter(Boolean))];
}

export function onboardingSelectionText(values: string[]): string {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].join('、');
}
