/** Read-only display projection. Raw reports and task states remain unchanged. */
export function isHiddenReportPresentationLine(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  // These are real workflow outcomes/actions, not confidence labels on report content.
  if (/(?:支付|付款|扣款|充值)(?:操作|请求)?(?:结果|状态).{0,8}(?:未知|待确认|待核验|失败)|(?:订单|任务|发布)(?:状态|审批).{0,8}(?:待确认|待审批|失败|阻塞)|(?:账号|账户|登录|调用|请求).{0,8}(?:未授权|无权限|授权失败)|(?:等待|需要|尚未|未获|请先|未完成).{0,12}(?:用户确认|用户授权|用户审批|审批授权|支付|付款)|(?:授权|审批)(?:结果|状态|操作|请求)?(?:为|：|:)?\s*(?:失败|阻塞|未完成|待确认)/u.test(text)) return false;
  // A required task input is a real workflow state, unlike an ungrounded report interpretation.
  if (/^(?:任务|生产|制作|发布)(?:状态|输入|所需材料|必要资料|必要输入)?[：:]?\s*(?:等待补充|待补充|缺少必要|缺少输入)/u.test(text)) return false;
  const explicit = /候选.{0,6}待确认|低(?:置信|可信)(?:度)?|(?:置信|可信)(?:度)?(?:较|偏)?低|(?:置信|可信)度\s*[:：]\s*低|(?:尚|有)?待(?:进一步)?(?:确认|复核|核验|验证)|(?:尚未|未经|未作|未完成)(?:核验|确认|复核|验证)|(?:需|需要)(?:进一步)?(?:复核|核验|验证)|研究草稿/u.test(text);
  const insufficient = /(?:信号|线索|判断依据|分析依据|信息|语境)(?:不足|较少|不充分|缺失)|(?:证据|资料|信息|依据).{0,8}(?:尚存|仍存|存在|留有|仍有|尚有)缺口|(?:暂|尚)?(?:无法|不能)(?:据此)?(?:指导内容制作|指导制作|确定选题|形成经营判断|给出制作建议)|待补充.{0,16}(?:后|再|才能|以便).{0,16}(?:判断|确定|选题|指导|解读|分析|评估)|待补充(?:配文|文字语境|内容说明|分析依据|证据|来源)(?:[，。、；]|$|后|再)/u.test(text);
  return explicit || insufficient;
}

export function reportPresentationLine(value: string): string {
  return isHiddenReportPresentationLine(value) ? '' : value;
}

export function reportPresentationText(value: string): string {
  return value.split('\n').map(line => (line.match(/[^。！？]+[。！？]?/gu) || []).map(reportPresentationLine).filter(Boolean).join('')).filter(line => line.trim()).join('\n');
}
