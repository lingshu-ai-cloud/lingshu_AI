/** Restore editable fields from the persisted cadence strings, including older formats. */
export function agentRuleFields(config: { socialCadence?: string; followupCadence?: string; reviewSchedule?: string }) {
  const social = config.socialCadence || '';
  const parts = social.split('；');
  const followup = (config.followupCadence || '').split('；');
  const review = config.reviewSchedule || '';
  const number = (pattern: RegExp, fallback: number) => {
    const match = social.match(pattern);
    return match ? Number(match[1]) : fallback;
  };
  return {
    collectionPlatforms: parts[0] || 'YouTube、TikTok、Instagram、Facebook',
    collectionSources: parts[1] || '公开行业关键词、已确认的对标账号',
    collectionKeywords: social.match(/关键词[：:]([^；]*)/)?.[1] || '',
    collectionLanguage: social.match(/关键词语言[：:]([^；]*)/)?.[1] || '',
    collectionLookback: number(/近\s*(\d+)\s*天/, 7),
    collectionLimit: number(/每次最多\s*(\d+)\s*条/, 20),
    collectionTime: social.match(/；近\s*\d+\s*天；([^；]*)；每次最多/)?.[1] || parts.find(item => /^(每天|每周|工作日)/.test(item) && !item.startsWith('每周生成')) || '每天 09:00',
    publishCount: number(/每周生成\s*(\d+)\s*条/, 5),
    followupGenerateAt: followup[0]?.replace(/\s*生成分层跟进草稿$/, '') || '每周五 09:00',
    followupApproveBy: followup[1]?.replace(/审批$/, '').trim() || '周五 17:00 前',
    followupWindow: followup[2]?.replace(/\s*发送$/, '') || '客户当地工作日 09:00–18:00',
    followupFrequency: followup[3] || '同一客户 7 天最多 1 次',
    reviewTimezone: review.match(/^周五 17:30（(.*)）；数据截止/)?.[1] || 'Asia/Shanghai（北京时间）',
    reviewCutoff: review.match(/数据截止\s*([^；]+)/)?.[1] || '周五 17:00',
  };
}
