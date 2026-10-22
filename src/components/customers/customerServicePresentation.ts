import type { CustomerServiceStatus } from '../../lib/customerService';

export function customerServicePresentation(
  customerServiceStatus: CustomerServiceStatus | null,
  customerServiceStatusLoadFailed: boolean,
  partialAutoReplyActive: boolean,
): { label: string; summary: string } {
  const customerServiceLabel = !customerServiceStatus
    ? (customerServiceStatusLoadFailed ? '读取失败' : '正在读取')
    : !customerServiceStatus.enabled
      ? '已关闭'
      : partialAutoReplyActive
        ? '部分直回'
        : `只给建议 · 第 ${customerServiceStatus.observationDay}/3 天`;
  const customerServiceSummary = !customerServiceStatus
    ? (customerServiceStatusLoadFailed
      ? '暂时没读到客服状态，点一下开关可重新尝试。'
      : '正在读取智能客服状态…')
    : !customerServiceStatus.enabled
      ? '账号消息只进入收件箱，灵小枢不会自行处理。'
    : partialAutoReplyActive
      ? '仅高置信命中已审批常见问答时直回；其余内容仍等你确认。'
      : customerServiceStatus.partialAutoReplyEnabled
        ? '已开放权限，但已审批问答不足 5 条，目前仍只给建议。'
        : customerServiceStatus.eligibleForPartialAutoReply
          ? '建议模式已运行满 3 天，是否开放部分直接回复由你决定。'
          : '灵小枢只生成建议回复，所有消息都要由你确认后发送。';


  return { label: customerServiceLabel, summary: customerServiceSummary };
}
