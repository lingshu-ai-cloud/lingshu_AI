/** Copy for the local generation pane; persisted outputs outrank a stale wizard step. */
export function socialImageGenerationPresentation(input: {
  busy: boolean; hasImage: boolean; hasPendingRepair: boolean; unresolvedJob: boolean;
}) {
  if (input.busy) return { title: '正在生成', description: '图片请求已提交，等待结果写入任务。', action: 'none' as const, button: '正在生成' };
  if (input.unresolvedJob) return { title: '生成回执待核对', description: '已有付费请求尚未确认结果，请先核对回执和素材。', action: 'none' as const, button: '等待核对' };
  if (input.hasPendingRepair) return { title: '修改要求待提交', description: '旧版本已保存；只有你确认后才会提交新的付费生成。', action: 'generate' as const, button: '确认生成修改版' };
  if (input.hasImage) return { title: '首版已生成', description: '成片已保存，请返回审阅图片与配文。', action: 'review' as const, button: '返回审阅图片与配文' };
  return { title: '首版待提交', description: '提交后才会调用图片服务生成首版。', action: 'generate' as const, button: '确认生成首版' };
}
