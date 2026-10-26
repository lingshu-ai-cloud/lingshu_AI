/** Observation pool, not a ranking. Identity is checked against the publisher before every discovery. */
export const REPORT_COMPANIES = [
  { id: 'bloomage', legalName: '华熙生物科技股份有限公司', name: '华熙生物', code: '688363', aliases: ['华熙', 'Bloomage'], segment: '生物活性原料与终端' },
  { id: 'proya', legalName: '珀莱雅化妆品股份有限公司', name: '珀莱雅', code: '603605', aliases: ['Proya'], segment: '美妆品牌' },
  { id: 'botanee', legalName: '云南贝泰妮生物科技集团股份有限公司', name: '贝泰妮', code: '300957', aliases: ['Botanee'], segment: '功效护肤品牌' },
  { id: 'freda', legalName: '鲁商福瑞达医药股份有限公司', name: '福瑞达', code: '600223', aliases: ['Freda'], segment: '原料与护肤品牌' },
  { id: 'cosmos', legalName: '南京科思化学股份有限公司', name: '科思股份', code: '300856', aliases: ['科思'], segment: '化妆品原料' },
  { id: 'jahen', legalName: '嘉亨家化股份有限公司', name: '嘉亨家化', code: '300955', aliases: ['嘉亨'], segment: '代工与包材' },
  { id: 'jahwa', legalName: '上海家化联合股份有限公司', name: '上海家化', code: '600315', aliases: ['家化'], segment: '美妆与个护品牌' },
  { id: 'marubi', legalName: '广东丸美生物技术股份有限公司', name: '丸美生物', code: '603983', aliases: ['丸美股份', '丸美'], segment: '美妆品牌' },
] as const;
export type ReportCompany = typeof REPORT_COMPANIES[number];
export function reportCompaniesIn(question: string): ReportCompany[] {
  return REPORT_COMPANIES.filter(company => [company.name, company.code, ...company.aliases]
    .some(name => question.toLowerCase().includes(name.toLowerCase())));
}

/** Legal names are publisher-verified; short conversational aliases cannot prove PDF identity. */
export function companyCoverIdentityMatches(companyId: string, fallbackName: string, compactCover: string): boolean {
  const company = REPORT_COMPANIES.find(item => item.id === companyId);
  return compactCover.includes(company?.legalName ?? fallbackName);
}
