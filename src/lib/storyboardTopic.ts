export type StoryboardTopic = 'presenter' | 'factory' | 'product' | 'general';

export const STORYBOARD_TOPIC_LABELS: Record<StoryboardTopic, string> = {
  presenter: '人物口播',
  factory: '工厂场景',
  product: '产品实拍',
  general: '通用画面',
};

/** Classify the visible shot, excluding narration and the wider product list. */
export function inferStoryboardTopic(input: { title: string; visual: string; presenterConfirmed?: boolean }): StoryboardTopic {
  const visual = `${input.title} ${input.visual}`;
  if (input.presenterConfirmed || /人物口播|销售口播|主讲人|对镜头讲述|speaking to camera|talking head/i.test(visual)) return 'presenter';
  if (/工厂|车间|设备|生产线|流水线|工人|厂房|灌装|质检|factory|workshop|production line|conveyor/i.test(visual)) return 'factory';
  if (/产品|瓶身|瓶罐|包装|精华|面霜|乳液|滴管|膏体|面膜|瓶盖|盒装|logo|product|bottle|packag|serum|cream|lotion|jar|dropper|mask/i.test(visual)) return 'product';
  return 'general';
}
