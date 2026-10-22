import type {CustomerProfile, CustomerStage} from '../../types/customer';

export const STAGE_LABEL: Record<CustomerStage, string> = {
  lead: '潜客',
  inquiry: '询盘中',
  quoted: '已报价',
  won: '已成交',
  silent30: '沉默30天',
  silent60: '沉默60天',
};

export function customerDisplayName(customer: Pick<CustomerProfile, 'name'>): string {
  return customer.name.replace(/模拟客户/g, '客户').replace(/模拟/g, '').replace(/\s{2,}/g, ' ').trim();
}
