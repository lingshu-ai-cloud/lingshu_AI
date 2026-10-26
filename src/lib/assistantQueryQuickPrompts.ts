export type AssistantQueryKind = 'industry' | 'rates' | 'trade';
export function assistantQueryKind(id: string): AssistantQueryKind | null {
  return id === 'OP-09' ? 'industry' : id === 'OP-RATES' ? 'rates' : id === 'OP-TRADE' ? 'trade' : null;
}
export function homeQuickPrompt(kind: AssistantQueryKind, values: { industry?: string; base?: string; quote?: string; country?: string; year?: number; flow?: string; hs?: string } = {}) {
  if (kind === 'industry') {
    const industry = values.industry?.trim();
    if (!industry || industry.length > 60) throw Error('请填写关注的行业。');
    return `查询${industry}行业最近30天的外贸资讯，说明对中国出口商的影响，并附信息来源。`;
  }
  if (kind === 'rates') {
    if (!values.base || !values.quote || values.base === values.quote) throw Error('请选择两个不同的币种。');
    return `查询${values.base}兑${values.quote}的最新参考汇率，并标注数据日期。`;
  }
  if (!values.country?.trim() || !Number.isInteger(values.year) || values.year! < 2000 || values.year! > new Date().getFullYear()
    || !/^(?:\d{2}|\d{4}|\d{6})$/u.test(values.hs || '') || !['进口', '出口'].includes(values.flow || '')) throw Error('请补齐统计国家、年份、进出口方向和2、4或6位HS编码。');
  return `查询${values.year}年${values.country.trim()}HS ${values.hs}${values.flow}金额，注明数据来源。`;
}
