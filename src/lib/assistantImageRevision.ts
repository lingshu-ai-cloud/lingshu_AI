import type { Message } from '../appSession';

/** Only route an explicit edit request when the latest reply is the image task. */
export function assistantImageRevisionTarget(messages: Message[], instruction: string): string | null {
  let index = messages.length - 1;
  while (index >= 1 && messages[index]?.role === 'assistant' && messages[index]?.content === '已收到修改意见。'
    && messages[index - 1]?.role === 'user') index -= 2;
  const id = messages[index]?.creationPortal?.imageReplication?.intake?.imageTaskId;
  if (!id || !instruction.trim() || /(?:怎么|如何|能否|可以吗|为什么|吗[？?]?$)/u.test(instruction)) return null;
  return /(?:修改|调整|改成|改为|换成|换个|移|挪|放大|缩小|亮一点|暗一点|加上|去掉|删除|把.+(?:改|换|移|调))/u.test(instruction) ? id : null;
}

export const ASSISTANT_IMAGE_REVISION_EVENT = 'lingshu:assistant-image-revision';
