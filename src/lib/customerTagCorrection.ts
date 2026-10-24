import { localCustomerPreviewEnabled } from './localCustomerSimulation';
import { authHeader } from './auth';
import type { CustomerProfile } from '../types/customer';
import { customerTagCorrectionInput, correctCustomerTag, readTagCorrections, type CustomerTagCorrectionInput } from '../../shared/contracts/customerTags';

export async function saveCustomerTagCorrection(customer: CustomerProfile, input: CustomerTagCorrectionInput): Promise<Partial<CustomerProfile>> {
  if (!customerTagCorrectionInput.safeParse(input).success) throw Error('请完整填写标签、维度和纠正理由');
  if (customer.isHistorical || customer.readOnly) throw Error('只读客户不能修改标签');
  if (customer.isMock && !localCustomerPreviewEnabled()) return correctCustomerTag(customer.tags, readTagCorrections(customer.contextTagCorrections), input, new Date().toISOString(), customer.contextTagEvidence);
  const authorization = authHeader().Authorization;
  const endpoint = customer.isMock ? '/api/overseas/customer-simulation/tag-corrections' : `/api/overseas/customers/${encodeURIComponent(customer.id)}`;
  const response = await fetch(endpoint, {
    method: customer.isMock ? 'POST' : 'PATCH', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(customer.isMock ? {customerId:customer.id,tags:customer.tags,tagCorrection:input,evidence:customer.contextTagEvidence||[]} : { tagCorrection: input }), signal: AbortSignal.timeout(15000),
  });
  if (authorization !== authHeader().Authorization) throw Error('登录身份已变化，请重新打开客户');
  const data = await response.json();
  if (!response.ok) throw Error(data.error === 'customer_tag_correction_conflict' ? '标签已被更新，请刷新客户后重试' : '标签纠正未保存，请刷新后重试');
  if (!Array.isArray(data.tags) || !data.tags.every((tag: unknown) => typeof tag === 'string') || !Array.isArray(data.contextTagCorrections)) throw Error('标签保存结果未确认，请刷新客户后核对');
  return { tags: data.tags, contextTagCorrections: readTagCorrections(data.contextTagCorrections) };
}
