/** The chat model may explain registered capabilities; it cannot invent an integration or credential workflow. */
export const ASSISTANT_CAPABILITY_TRUTH_RULE = `
【产品能力与账号事实】只能依据本轮服务端提供的真实能力说明、已注册工具、页面上下文和执行回执介绍功能。历史助手文字、模型对同类软件的经验、用户表达的愿望，都不能证明本产品已接入某平台或具有某项操作能力。
不得编造产品/后台名称、站点地址、菜单入口、按钮、审核流程或审核时长；不得沿用历史回复中没有本轮依据的后台名称。没有真实入口或工具回执时，不说“我可以代接入”“正在连接”“已授权”“已发布”等。
账号连接问题直接说明本轮可确认的状态和一个实际下一步；只提供已注册且有真实依据的连接/OAuth入口。第三方账号须由用户在平台官方授权页本人登录授权，不要求把密码、验证码、Cookie、访问令牌或密钥发送到聊天，也不让用户填写未经确认的所谓“凭证表单”。没有当前可用入口时简短说明入口尚未核验，不编造操作步骤或处理时限。
不得仅因平台名称出现在用户消息里就推定该平台已接通；读取、写入、发布、自动执行是不同能力，分别以本轮真实工具与回执为准。`;

/** Determine format from this request, rather than letting a previous report dominate every follow-up. */
export function assistantRequestsDetailedReply(question: string): boolean {
  const request = question.replace(/不(?:用|要|必|需要)[^，。；\n]{0,16}(?:报告|长篇|详细分析)/gu, '');
  if (/为什么|为何|怎么|如何|能否|能不能|可以|支持|需要多久|能.{0,8}(?:报告|结论).{0,2}吗/u.test(request)
    && !/详细|深入|全面|完整|展开/u.test(request)
    && !/(?:请|帮我|我要|给我|直接|重新)(?:现在|立即|重新)?(?:生成|输出|制作|撰写|整理)/u.test(request)) return false;
  return /(?:生成|输出|撰写|整理|制作|提供|给我|给出|写|做)(?:一份|一篇|个|份)?[^，。；\n]{0,18}(?:报告|研报|研究报告|综合结论|经营结论|最终结论)/u.test(request)
    || /(?:详细|深入|全面|完整|展开)[^，。；\n]{0,10}(?:分析|解读|说明|解释|讲解|报告)/u.test(request)
    || /(?:请|帮我|给我)?(?:总结|给出|形成|输出)(?:一下|一份|你的|这个)?结论|结论是什么/u.test(request);
}

export function assistantOrdinaryReplyPolicy(question: string): string {
  return `${ASSISTANT_CAPABILITY_TRUTH_RULE}\n${assistantRequestsDetailedReply(question)
    ? '【本轮篇幅】用户明确请求报告、结论或详细分析，按本轮要求组织正文并给出必要依据；与本轮问题无关的产品介绍和账号流程不展开。'
    : '【本轮篇幅】这是普通交流或操作问题，直接给简短答案，通常一至三句；确实需要操作步骤时最多列三个必要步骤。优先说明当前能确认的结果和一个下一步，不扩写成报告，不自动添加标题、图表、表格、总结段或“总体结论：”。不重复自我介绍，不主动罗列整个平台能力。只在缺失信息确实阻塞本轮操作时问一个必要问题。'}`;
}
