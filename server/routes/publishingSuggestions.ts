export function fallbackQueueSuggestion(input: {
  currentTitle: string;
  feedback: string;
  festival: string;
}): { title: string; brief: string; tags: string[] } {
  const variants = [
    { title: '主推产品：3 个采购决策点', brief: '用买家视角拆解用途、采购关注点和询盘入口，不补写未确认参数。', tags: ['主推品', '采购决策'] },
    { title: '工厂能力：从打样到交付', brief: '展示流程与交付节点，企业资料缺失的部分保持待确认。', tags: ['工厂实力', '交付'] },
    { title: '采购 FAQ：MOQ、定制与样品', brief: '围绕高频询盘组织短内容，引导买家索取目录和报价。', tags: ['采购FAQ', '询盘'] },
    { title: '质量证明：细节、包装与检验', brief: '用可拍摄的细节建立信任，只引用企业中心已有事实。', tags: ['质量', '信任'] },
    { title: '应用场景：买家如何使用这款产品', brief: '从真实使用场景切入，结尾保留清晰的 WhatsApp 询盘动作。', tags: ['场景', '转化'] },
  ];
  const currentIndex = variants.findIndex(item => item.title === input.currentTitle);
  const selected = variants[(currentIndex + 1 + variants.length) % variants.length];
  if (input.feedback) return { title: selected.title, brief: `${selected.brief} 修改要求：${input.feedback.slice(0, 120)}`, tags: selected.tags };
  if (input.festival) return { title: `${input.festival}：采购准备清单`, brief: '围绕节庆采购窗口组织备货、交付与询盘内容，不虚构折扣或库存。', tags: ['节庆', '备货'] };
  return selected;
}

export type PostingSchedulePreset = 'light' | 'standard' | 'high';
export function normalizeScheduleSlots(value: unknown, preset: PostingSchedulePreset): Array<{ weekday: number; time: string }> {
  const weekdays = preset === 'light' ? [1, 3, 5] : preset === 'high' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const fallback = weekdays.map(weekday => ({ weekday, time: '20:00' }));
  if (!Array.isArray(value)) return fallback;
  const slots = value.map(slot => ({ weekday: Math.max(0, Math.min(6, Number(slot?.weekday) || 0)), time: /^\d{2}:\d{2}$/.test(String(slot?.time || '').trim()) ? String(slot.time).trim() : '20:00' }))
    .filter((slot, index, list) => list.findIndex(item => item.weekday === slot.weekday && item.time === slot.time) === index)
    .sort((left, right) => left.weekday - right.weekday || left.time.localeCompare(right.time));
  return slots.length ? slots : fallback;
}
