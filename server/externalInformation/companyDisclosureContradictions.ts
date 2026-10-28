import { ExternalInformationError } from './http.js';

const compact = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '');
/** Recognize disclosed entity income rows only in an income table with an explicit monetary unit. */
export function companyDisclosedIncomeEntities(source: string): string[] {
 const text = source.normalize('NFKC');
 const joined = compact(text);
 if (!/(?:收入|营收|营业额)/u.test(joined) || !/(?:金额.{0,6}(?:亿元|万元|人民币|元)|单位[:：]?(?:亿元|万元|人民币|元))/u.test(joined)) return [];
 const result: string[] = [];
 for (const line of text.split(/\r?\n/u)) {
  const row = line.trim().match(/^([^%：:\n]{2,60}?)\s+(-?\d[\d,]*\.\d{1,2})(?=\s|$)([^]*)$/u);
  if (!row || !/^[\d\s.,%+−–—-]*$/u.test(row[3]) || !/\d/u.test(row[3])) continue;
  const name = compact(row[1]);
  if (name.length < 2 || /^(?:合计|总计|单位|指标|类别|金额|本期|上期|上年|其中|同期)/u.test(name)) continue;
  result.push(name);
 }
 return [...new Set(result)];
}

/** An explicit entity income row contradicts a claim that its income amount was never disclosed. */
export function assertCompanyIncomeDisclosure(prose: string, source: string): void {
 const entities = companyDisclosedIncomeEntities(source);
 if (!entities.length) return;
 const currentYear = compact(source).match(/(20\d{2})H1/iu)?.[1];
 for (const sentence of prose.normalize('NFKC').split(/[。；;！？]/u)) {
  const text = compact(sentence);
  const negative = text.match(/(?:未披露|未公开|没有披露|未提供|未列示|暂无)[^。；;！？]{0,24}(?:营业收入|收入|营收|营业额)(?:[^。；;！？]{0,8}(?:金额|绝对值|数额|规模)|(?=[，,]|$))|(?:营业收入|收入|营收|营业额)(?:金额|绝对值|数额|规模)?[^。；;！？]{0,8}(?:未披露|没有披露|未提供|未列示)/u);
  if (!negative) continue;
  const before = text.slice(Math.max(0, (negative.index ?? 0) - 20), negative.index);
  if (/(?:是否|能否|核对|核查|确认|若|如果|假如)[^。；;！？]{0,12}$/u.test(before)) continue;
  // A current-period amount does not establish another year's undisclosed income.
  if (/单季|季度|Q[1-4]|单月|月度|海外|境外|出口|线上|线下|渠道/iu.test(text)) continue;
  if (/上年度|上年同期|去年/u.test(text) || (currentYear && [...text.matchAll(/20\d{2}/gu)].some(match => match[0] !== currentYear))) continue;
  if (entities.some(name => text.includes(name))) throw new ExternalInformationError('company_report_claim_unsupported', '所引原文已列示该品牌或业务的收入金额，本次未采用未披露的相反判断。');
 }
}
