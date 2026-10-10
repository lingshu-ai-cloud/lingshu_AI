export function enterpriseBuyerText(roles?: string[]): string {
  return (roles || []).map(item => item.trim()).filter(Boolean).join('、');
}
type TimelineValidationItem = { type: string; url?: string; trimStart: number; trimEnd: number; speed: number; targetDuration: number };
export function validateStudioTimeline(items: TimelineValidationItem[]): string[] {
  const issues: string[] = [];
  if (!items.length) return ['没有可用素材，无法继续生成。'];
  items.forEach((item, index) => {
    if (!item.url || item.type === 'audio') issues.push(`分镜 ${index + 1} 缺少可播放画面素材。`);
    const sourceDuration = Math.max(0, item.trimEnd - item.trimStart);
    const playableDuration = sourceDuration / Math.max(0.01, item.speed || 1);
    if (sourceDuration <= 0) issues.push(`分镜 ${index + 1} 的素材入点/出点无效。`);
    if (item.targetDuration > playableDuration + 0.05) issues.push(`分镜 ${index + 1} 需要 ${item.targetDuration.toFixed(1)}s，但实际素材仅可覆盖 ${playableDuration.toFixed(1)}s。`);
  });
  return issues;
}
export function pendingClaimLocations(script: string, productInfo: string): string[] {
  const source = String(productInfo || '');
  const sourceLower = source.toLowerCase();
  const sourceComparable = sourceLower.replace(/\s+/g, ' ');
  const spokenField = /^(?:台词|字幕|口播|人物说|旁白|voiceover|vo|subtitle|caption|dialogue)\s*[：:]\s*(.+)$/i;
  const supportedByCategory = [
    { claim: /\bCE\b/i, evidence: /\bCE\b/i },
    { claim: /\bFDA\b/i, evidence: /\bFDA\b/i },
    { claim: /\bSGS\b/i, evidence: /\bSGS\b/i },
    { claim: /(?:起订|\bMOQ\b)/i, evidence: /(?:起订|最小订单|\bMOQ\b)/i },
    { claim: /(?:交期|delivery\s*(?:time|lead)|lead\s*time)/i, evidence: /(?:交期|delivery\s*(?:time|lead)|lead\s*time)/i },
    { claim: /(?:认证|certif(?:y|ied|ication))/i, evidence: /(?:认证|certif(?:y|ied|ication))/i },
    { claim: /(?:客户案例|合作案例|case\s*study)/i, evidence: /(?:客户案例|合作案例|case\s*study)/i },
    { claim: /(?:销量|sales\s*volume)/i, evidence: /(?:销量|sales\s*volume)/i },
    { claim: /(?:保证|guarantee)/i, evidence: /(?:保证|guarantee)/i },
  ];
  return script.split('\n').map(line => line.trim()).filter(line => {
    const speech = line.match(spokenField)?.[1]?.trim();
    // 环境、构图、画面、运镜等是制作指令，不是对外商业声明，不参与企业事实硬校验。
    if (!speech) return false;
    if (supportedByCategory.some(({ claim, evidence }) => claim.test(speech) && !evidence.test(source))) return true;
    // 数字交期和明确价格必须在企业资料中出现同一个值，避免凭空承诺。
    const exactClaims = [
      ...(speech.match(/\b\d+\s*(?:天|days?)\b/gi) || []),
      ...(speech.match(/(?:[$€£¥￥]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:USD|EUR|GBP|CNY|RMB))/gi) || []),
    ];
    return exactClaims.some(claim => !sourceComparable.includes(claim.toLowerCase().replace(/\s+/g, ' ')));
  }).slice(0, 4);
}
