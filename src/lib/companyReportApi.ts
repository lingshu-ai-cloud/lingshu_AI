import { companyReportOptionsSchema, type CompanyReportOptions } from '../../shared/contracts/companyFilings';
import { authHeader } from './auth';

export async function fetchCompanyReportOptions(signal?: AbortSignal): Promise<CompanyReportOptions> {
  const response = await fetch('/api/overseas/strategy/company-report-options', { headers: authHeader(), signal });
  if (!response.ok) throw Error('企业财报目录暂时无法读取，请稍后重试。');
  const parsed = companyReportOptionsSchema.safeParse(await response.json());
  if (!parsed.success) throw Error('企业财报目录不完整，请重新加载。');
  return parsed.data;
}

/** Confirmation uses an explicit company and available report period from the authenticated options response. */
export function companyReportSceneRequest(options: CompanyReportOptions, companyId: string, year: number) {
  const company = options.companies.find(item => item.id === companyId);
  const report = company?.reports.find(item => item.year === year);
  if (!company || !report || report.status !== 'available') throw Error('请选择已取得原文且无需核对版本的报告期间。');
  return { companyId, year, text: `请解读${company.name}${report.period}报告，拆解整体经营、主要业务、技术产品和海外布局，区分公司披露与分析推断，说明对美妆品牌、原料企业与代工厂的含义，并列出后续验证点。财务数字引用原表，不补造季度数据或市场预期。` };
}
