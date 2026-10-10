import type { AgentCalendarTask } from '../components/smartBusiness/AgentWeeklyCalendar';

// B2B established-profile acceptance fixture. It mirrors the persisted H-chain
// vocabulary without pretending that these rows are production jobs.
type Row = [number, string, AgentCalendarTask['agent'], string, string, string, number, string[]?];
const rows: Row[] = [
  [0,'H-M1','business','确认增长停滞诊断与本周目标','5 条母版；自有 40% / 外部 60%；播放与赞转评基线','保留账号既有调性，同时引入外部增量方向',60],
  [0,'H-M2','director','复盘自有高表现视频 A/B','两条自有参考的钩子、证明顺序与可复用边界','按播放、点赞、转发、评论核验，不看广告消耗',100,['h-task-0']],
  [0,'H-S2','business','核对三渠道客服承接权限','WhatsApp、Messenger、Instagram 的真实账号与授权缺口','发布前必须完成渠道就绪核验',45,['h-task-0']],
  [0,'H-M7','customer','恢复老客上下文与新询盘知识','老客跟进范围、产品 FAQ 与新询盘回复边界','三渠道分别保留客户身份和审批版本',70,['h-task-2']],
  [1,'H-M2','director','分析外部增量参考 C/D/E','三条外部参考的结构、买家问题与采用依据','外部 60% · 不覆盖账号既有表达',120,['h-task-0']],
  [1,'H-M3','business','冻结混合来源排期与容量','5 条母版的来源、交付截止和发布窗口','2 条自有迭代 + 3 条外部探索',60,['h-task-1','h-task-4']],
  [1,'H-M4','content','盘点共享产品素材与数字人','五条视频共用素材、逐镜缺口和生成路线','共享素材须在首条成片生产前完成',75,['h-task-5']],
  [1,'H-S1','human','上传五条视频共用的产品实拍','产品转台、接口特写与可用授权','负责人：陈晨 · 影响本周全部母版',60,['h-task-6']],
  [2,'H-M4','director','交付自有迭代 A/B 脚本分镜','保留账号调性后的脚本、分镜和验收条件','自有历史视频只作已核验结构参考',120,['h-task-1','h-task-5']],
  [2,'H-M4','content','交付外部探索 C/D/E 执行方案','逐镜匹配、数字人选择、生成路线和成本','外部方向须替换为企业真实事实与素材',150,['h-task-4','h-task-6']],
  [2,'H-S1','content','核验共享实拍并绑定五条消费者','文件哈希、权利与五条任务的冻结绑定','上传缺失时所有消费者保持阻塞',35,['h-task-7']],
  [2,'H-M7','customer','生成三渠道跟进草稿','WhatsApp、Messenger、Instagram 分渠道草稿','每条发送仍需匹配真实客户与审批版本',75,['h-task-3']],
  [3,'H-M5','content','完成自有迭代 A/B 成片','2 条母版、字幕封面和技术质检','保留原账号调性并验证新的证明顺序',300,['h-task-8','h-task-10']],
  [3,'H-M5','director','审核自有迭代成片','逐镜事实、表达一致性和验收结论','用户最终验收另行记录',45,['h-task-12']],
  [3,'H-S3','content','处理自有视频技术返工','失败分镜重渲染、G4/G5 复检与原审批恢复','进入技术返工生产实况；保留原 job/run 血缘',60,['h-task-13']],
  [4,'H-M6','business','发布自有迭代平台版本','真实发布安排、平台 attempt 与未知回执对账','周四成片审核，周五发布；未知结果只核对原尝试，不重复发布',45,['h-task-13','h-task-2']],
  [4,'H-M5','content','完成外部探索 C/D/E 成片','3 条母版及对应平台版本','外部新方向转化为企业自己的表达',360,['h-task-9','h-task-10']],
  [4,'H-S3','director','发起外部探索创意返工','冻结反馈、容量报价与新子任务范围','收到具体反馈后按需触发创意返工；不覆盖原成片',45,['h-task-16']],
  [4,'H-S4','business','核验发布异常与原平台回执','原 publication、attempt 和可恢复结论','不创建第二次发布',30,['h-task-15']],
  [4,'H-M7','customer','处理 Messenger 与 Instagram 私信','按真实会话生成并审批回复','分别记录平台 message identity',75,['h-task-11','h-task-15']],
  [5,'H-M6','business','发布外部探索版本','真实平台发布回执和等待原因','周五成片审核，周六发布；全部发布依赖成片验收与客服渠道就绪',60,['h-task-28','h-task-2']],
  [5,'H-S5','business','追踪播放与赞转评','按母版/平台记录播放、点赞、转发、评论','判断 40/60 配比的新增方向与调性保持',45,['h-task-15','h-task-20']],
  [5,'H-S7','customer','转交 WhatsApp 特殊报价咨询','客户上下文、原审批草稿和待确认事项','交销售负责人处理，不自动承诺',30,['h-task-11']],
  [5,'H-S8','business','建立延期任务计划修订','受影响发布、保留成果与新截止建议','用户确认后才生成新版本',30,['h-task-18']],
  [6,'H-M8','business','交付有基础账号周经营复盘','自有/外部来源分别的播放、赞转评、询盘与成本','明确下周继续、停止和待验证方向',90,['h-task-21','h-task-23']],
  [6,'H-S6','director','沉淀账号调性与新模板候选','自有稳定结构和外部新增结构的候选证据','候选不自动视为验证成功',60,['h-task-21']],
  [6,'H-S9','content','跨周衔接未结返工与素材','原任务、子 job、已完成镜头和剩余证据','沿用原血缘，不重复计费或重建任务',40,['h-task-14','h-task-17']],
  [6,'H-M8','customer','汇总三渠道客户推进结果','WhatsApp、Messenger、Instagram 的发送与人工未结项','进入下周老客推进与新询盘准备',60,['h-task-19','h-task-22']],
  [4,'H-M5','director','审核外部探索 C/D/E 成片','逐镜事实、企业表达与验收结论','用户最终验收另行记录；未通过不得发布',45,['h-task-16']],
];

export const agentCalendarEstablishedDemo: AgentCalendarTask[] = rows.map(([day, chain, agent, title, output, context, minutes, dependsOn], index) => ({
  id:`h-task-${index}`,
  date:`2026-10-${String(5 + day).padStart(2,'0')}`,
  time:index===15?'11:00':index===17?'12:00':index===20?'12:00':index===23?'13:00':index===28?'11:00':`${String(9 + rows.slice(0,index).filter(row=>row[0]===day).length).padStart(2,'0')}:00`,
  agent,title,output,context,minutes,chain,dependsOn:dependsOn ?? [],status:index===7?'blocked':'planned',
  ...(index===7?{assignee:'陈晨',dueAt:'2026-10-06T17:00:00+08:00',deadlineTracked:true,availableForHuman:true,submission:'missing' as const,humanAction:'upload' as const,reason:'五条视频共用实拍尚未上传；所有母版生产保持阻塞',affectedPublicationIds:['H-video-A','H-video-B','H-video-C','H-video-D','H-video-E']}:{}),
}));
