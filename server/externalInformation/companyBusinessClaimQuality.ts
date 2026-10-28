/** Validate the meaning of business claims against the cited material, not unrelated search hits. */
export function assertCompanyBusinessClaim(prose: string, source: string): void {
  const text = prose.replace(/\s+/gu, '');
  const evidence = source.replace(/\s+/gu, '');
  // A fall in cash received is not, by itself, evidence that customer payments slowed.
  if (/回款(?:放缓|变慢|延迟|周期(?:延长|拉长))/u.test(text)
    && !/回款(?:放缓|变慢|延迟|周期(?:延长|拉长))|(?:回款|收款)(?:周期|速度)[^。；！？]{0,12}(?:延长|拉长|变慢|放缓)/u.test(evidence)) {
    throw Error('payment_delay_unsupported');
  }
  if (/研发(?:投入|费用率)[^。；！？]{0,12}(?:偏低|不足|低于行业)|(?:偏低|不足)[^。；！？]{0,8}研发(?:投入|费用率)/u.test(text)
    && !/(?:同行|行业|可比公司)[^。；！？]{0,40}(?:平均|中位|基准|研发)|研发[^。；！？]{0,40}(?:同行|行业平均|中位|可比公司)/u.test(evidence)) {
    throw Error('research_benchmark_missing');
  }
  const technologies = text.match(/次抛(?:剂型)?|微珠包裹(?:工艺)?|双形态喷雾|微囊包裹(?:工艺)?|冻干(?:剂型|工艺)|脂质体(?:包裹|递送)/gu) ?? [];
  const conditionalSelfCapability = /(?:若|如果|如已|如自身|若自身)[^。；！？]{0,22}(?:具备|拥有|掌握)|可评估是否具备/u.test(text);
  const supported = (term: string) => evidence.includes(term.replace(/剂型$|工艺$/u, ''))
    || (term === '双形态喷雾' && /(?:双态[^。；！？]{0,12}喷雾|喷雾[^。；！？]{0,35}双形态)/u.test(evidence));
  if (!conditionalSelfCapability && technologies.some(term => !supported(term))) throw Error('specific_technology_unsupported');
}

/** A promotional measurement article is a public claim, not evidence of independent testing. */
export function attributeCompanyPublicReview(prose: string, source: string): string {
  if (!/(?:测评|实测|评分)/u.test(source) || !/(?:限时|加赠|购.{0,6}送|赠品|下单|购买链接)/u.test(source)) return prose;
  return prose.replace(/独立第三方测评|独立测评|第三方测评/gu, '公开测评文章');
}
