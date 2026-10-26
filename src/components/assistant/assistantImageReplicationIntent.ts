import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import type { UploadedAssistantAttachment } from './assistantChatPrompt';

/** A navigation draft only. Reference bytes and product identity are resolved after opening it. */
export function assistantImageReplicationPortal(text: string, attachments: UploadedAssistantAttachment[] = []): AssistantCreationPortal | null {
  const value = text.trim();
  if (!value || /(?:不要|不想|先别|暂不|取消|如何|怎么|为什么|是否|假如|如果).{0,12}(?:复刻|裂变|仿照|参考|模仿)/u.test(value)
    || /^(?:分析|介绍|查询|查看|解释)/u.test(value)) return null;
  const images = attachments.filter(item => item.kind === 'image');
  if (!/(?:复刻|裂变|仿照|模仿|照着|参考.{0,30}(?:做|制作|创作|生成))/u.test(value)
    || (!/图文|海报|图片|参考图|这张图|单图/u.test(value) && images.length !== 1)
    || /视频|短片|分镜/u.test(value)) return null;
  const platforms = [
    [/Instagram|\bIG\b/iu, 'instagram'], [/Facebook|\bFB\b/iu, 'facebook'], [/LinkedIn|领英/iu, 'linkedin'],
  ].filter(([pattern]) => (pattern as RegExp).test(value)).map(([, platform]) => platform) as AssistantCreationPortal['platforms'];
  const ratio = value.match(/(?:^|[^\d])(1\s*[:：]\s*1|4\s*[:：]\s*5|9\s*[:：]\s*16|16\s*[:：]\s*9)(?!\d)/u)?.[1]?.replace(/\s/g, '').replace('：', ':');
  return {
    kind: 'content_creation', id: `image-replication-${crypto.randomUUID()}`,
    title: '图文爆款复刻', objective: value.slice(0, 1000), requestedOutputCount: 1,
    outputType: 'image', platforms, aspectRatio: (ratio || null) as AssistantCreationPortal['aspectRatio'], targetDurationSeconds: null,
    imageReplication: { ...(images.length === 1 ? { reference: { materialId: images[0].materialId, name: images[0].name.slice(0, 200) } } : {}) },
  };
}
