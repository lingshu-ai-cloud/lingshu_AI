import type { SocialInsightReport } from './socialInsightReport.js';

// A public caption and one snapshot do not establish audience geography, a
// market-wide trend, demand stability, sales, or company capabilities.
const unsupported = /(?:全球|全世界|全网|整个市场|普遍需求|市场趋势|市场规模|行业趋势|用户需求(?:强劲|旺盛|增长|稳定)|采购(?:商)?(?:的)?(?:备货|采购)?需求(?:稳定|强劲|增长|旺盛)|(?:美国|英国|欧洲|中国|日本|韩国|海外|国内)(?:的)?(?:消费者|受众|用户|客户|市场)(?:群体)?|面向(?:美国|英国|欧洲|中国|日本|韩国|海外|国内)|销量(?:增长|上升|领先)|(?:销售|营收|询盘)(?:增长|提升|增加)|(?:供应链|供应|产能|交付)(?:稳定|充足|可靠)|(?:已具备|拥有|通过)(?:相关|国际|行业)?(?:认证|资质|认证资质))/u;
/** Drop unsupported sentences instead of inventing a substitute finding. */
export function filterSocialInsightEvidence(value: string): string {
  return value.split(/(?<=[。！？；\n])/u).filter(part => !unsupported.test(part)).join('').trim();
}
/** Non-mutating projection protects both newly generated and historical reports. */
export function evidenceSafeSocialInsightReport(report: SocialInsightReport): SocialInsightReport {
  const materials = report.materials && {...report.materials,
    assignments: report.materials.assignments.map(item => {
      const reason = filterSocialInsightEvidence(item.reason);
      return {...item, confidence: reason === item.reason ? item.confidence : 'low' as const,
        reason: reason || '分类依据待核验', merchantHelp: filterSocialInsightEvidence(item.merchantHelp) || '内容帮助待核验',
        contentAngle: filterSocialInsightEvidence(item.contentAngle) || '选题待核验',
        evidenceNeeded: item.evidenceNeeded.map(filterSocialInsightEvidence).filter(Boolean)};
    }),
    groups: report.materials.groups.map(group => ({...group, summary: filterSocialInsightEvidence(group.summary),
      recommendations: group.recommendations.map(filterSocialInsightEvidence).filter(Boolean)})),
  };
  return {...report, analysisMarkdown: filterSocialInsightEvidence(report.analysisMarkdown), ...(materials ? {materials} : {})};
}
