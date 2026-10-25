import type { AssistantCreationPortal } from '../../shared/contracts/assistantCreationPortal';
export function replicationStepReply(portal: AssistantCreationPortal): string {
  if (portal.confirmedTaskId) return '内容任务已创建。';
  if (portal.replicationStep === 'product') return '已选定对标视频，请选择本次推广的产品。';
  if (portal.replicationStep === 'schedule') return '产品已选好，请确认预计发布时间。';
  if (portal.replicationStep === 'summary') return '信息已填写，请确认本条创作任务。';
  return '先选一条想借鉴的对标视频，再确定产品和周发布安排。';
}
