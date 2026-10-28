import { reportCompaniesIn } from './companyRegistry.js';
export const COMPANY_REPORT_CATALOG = [
  { id: 'bloomage', name: '华熙生物', aliases: ['华熙', 'Bloomage'], code: '688363',
    url: 'https://static.cninfo.com.cn/finalpage/2026-08-28/1225522098.PDF',
    publishedAt: '2026-08-28', period: '2026年半年度', year: 2026,
    evidenceTerms: ['主要会计数据', '财务报表相关科目变动分析表', '原料业务实现收入', '医疗终端业务', '皮肤科学创新转化业务实现收入', '皮肤与营养科学材料', '国际市场原料', '销售渠道优势', '主要技术创新', '注册及临床试验进展'] },
  { id: 'proya', name: '珀莱雅', aliases: ['Proya'], code: '603605',
    url: 'https://static.cninfo.com.cn/finalpage/2026-08-25/1225496527.PDF',
    publishedAt: '2026-08-25', period: '2026年半年度', year: 2026,
    evidenceTerms: ['主要会计数据', '财务报表相关科目变动分析表', '主要品牌', '品牌收入', '销售渠道', '研发投入', '主要经营情况', '核心竞争力', '市场推广'] },
] as const;
export type CompanyReportTarget = { id: string; name: string; code: string; aliases: readonly string[];
  url: string; publishedAt: string; period: string; year: number; evidenceTerms: readonly string[] };

export function companyReportIntent(question: string): { target?: CompanyReportTarget; lookup?: { companyId: string; year: number }; error?: string } | null {
  if (/不(?:用|要|必)联网|无需联网|不(?:用|要)搜索/u.test(question)) return null;
  if (!/企业经营洞察|经营洞察|财报|年报|季报|半年报|半年度|企业.*解读|龙头.*(?:报告|解读|动向)/u.test(question)) return null;
  const companies = reportCompaniesIn(question);
  if (companies.length !== 1) return { error: companies.length > 1 ? '请一次选择一家企业，以便逐项核对报告期间和证据。' : '请指定观察池内企业。可先查询“美妆企业财报资料库”查看支持企业及官方原文目录。' };
  const company = companies[0];
  const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Shanghai' }).format(new Date()));
  const years = [...new Set([...question.matchAll(/20\d{2}/g)].map(match => Number(match[0])))];
  const year = years[0] ?? currentYear;
  if (years.length > 1 || year < currentYear - 3 || year > currentYear || /一季|二季|三季|四季|Q[1-4]|全年|年度报告|年报(?!.*半年)/iu.test(question.replace(/半年度报告|半年报/g, 'H1'))) {
    return { error: `当前深度解读适配${company.name}的半年报，统计期间为1—6月，不能替代单季或全年；年报、季报原文可先查询该企业历史财报目录。` };
  }
  if (/最新|最近|当前|这季/u.test(question) && !/20\d{2}.*(?:半年|半年度|H1)/iu.test(question)) return { error: '请先查询该企业最新财报目录；深度解读需明确半年报期间，不能把固定原文声称为最新。' };
  const fixed = COMPANY_REPORT_CATALOG.find(target => target.id === company.id && target.year === year);
  return fixed ? { target: fixed } : { lookup: { companyId: company.id, year } };
}
