export type AssistantQueryKind = 'industry' | 'rates' | 'trade';
export function assistantQueryKind(id: string): AssistantQueryKind | null {
  return id === 'OP-09' ? 'industry' : id === 'OP-RATES' ? 'rates' : id === 'OP-TRADE' ? 'trade' : null;
}
export function homeQuickPrompt(kind: AssistantQueryKind, values: { industry?: string; market?: string; base?: string; quote?: string; country?: string; year?: number; flow?: string; hs?: string } = {}) {
  if (kind === 'industry') {
    const industry = values.industry?.trim();
    if (!industry || industry.length > 60) throw Error('请填写关注的行业。');
    const market = values.market?.trim();
    if (!market || market.length > 60) throw Error('请填写目标市场。');
    return `行业资讯：行业：${industry}，目标市场：${market}。查询最近30天与该行业及市场相关的市场变化、技术趋势、供应链和竞争动向；不限指定站点，从可访问且有发布日期的相关公开报道中整理可视化报告；跳过不可访问站点，保留来源链接，区分事实、推断与建议，不把发布计划当作销量或收益。`;
  }
  if (kind === 'rates') {
    if (!values.base || !values.quote || values.base === values.quote) throw Error('请选择两个不同的币种。');
    return `查询${values.base}兑${values.quote}的最新参考汇率，并标注数据日期。`;
  }
  if (!values.country?.trim() || !Number.isInteger(values.year) || values.year! < 2000 || values.year! > new Date().getFullYear()
    || !/^(?:\d{2}|\d{4}|\d{6})$/u.test(values.hs || '') || !['进口', '出口'].includes(values.flow || '')) throw Error('请补齐统计国家、年份、进出口方向和2、4或6位HS编码。');
  return `查询${values.year}年${values.country.trim()}HS ${values.hs}${values.flow}金额，注明数据来源。`;
}
