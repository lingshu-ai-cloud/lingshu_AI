export interface EnterpriseProductOption {
  id: string;
  name: string;
}

export function resolveReplicationProductMappings(
  slots: Array<{ shotId: string; sourceLabel: string }>,
  products: EnterpriseProductOption[],
  primaryProductId: string,
  assignments: Record<string, string>,
) {
  return slots.map(slot => {
    const selectedId = Object.prototype.hasOwnProperty.call(assignments, slot.shotId)
      ? assignments[slot.shotId] : primaryProductId;
    const product = products.find(item => item.id === selectedId);
    return { sourceTerm: slot.sourceLabel, productId: product?.id || '', productName: product?.name || '' };
  });
}

export function assignReplicationDefaultProduct(
  slots: Array<{ shotId: string }>,
  productId: string,
): Record<string, string> {
  return Object.fromEntries(slots.map(slot => [slot.shotId, productId]));
}

export interface FreeCreationLine {
  id: string;
  time: string;
  speech: string;
  visual: string;
  shotType: '真人口播' | '工厂' | '产品' | 'D to C';
  silent: boolean;
  hook: boolean;
}

export function parseFreeCreationScript(script: string): FreeCreationLine[] {
  const normalized = String(script || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  const timestampLine = /^\s*\[?(?:\d+:)?\d+(?:\.\d+)?\s*[–—-]\s*(?:\d+:)?\d+(?:\.\d+)?s?\]?/;
  const grouped: string[] = [];
  for (const line of normalized.split('\n')) {
    if (timestampLine.test(line) && grouped.length && grouped[grouped.length - 1]!.trim()) grouped.push(line);
    else if (!grouped.length) grouped.push(line);
    else grouped[grouped.length - 1] += `\n${line}`;
  }
  const blocks = grouped.length > 1 ? grouped.map(item => item.trim()).filter(Boolean) : normalized.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const time = block.match(/\[?((?:\d+:)?\d+(?:\.\d+)?\s*[–—-]\s*(?:\d+:)?\d+(?:\.\d+)?s?)\]?/)?.[1] || `${index * 4}–${(index + 1) * 4}s`;
    const speechMatch = block.match(/(?:台词|口播|旁白|Dialogue|Voiceover)\s*[：:]\s*([^\n]+)/i);
    const visualMatch = block.match(/(?:画面|镜头|Visual)\s*[：:]\s*([^\n]+)/i);
    const speech = (speechMatch?.[1] || (!visualMatch ? block.replace(/^\[?[^\]\n]+\]?\s*/, '').trim() : '')).trim();
    const visual = (visualMatch?.[1] || '根据口播生成对应画面').trim();
    const explicitShotType = block.match(/镜头类型\s*[：:]\s*([^\n]+)/)?.[1] || '';
    const hinted = `${explicitShotType} ${visual}`;
    const shotType: FreeCreationLine['shotType'] = /工厂|车间|生产线|实验室/.test(hinted) ? '工厂'
      : /真人|口播|主播|人物对镜/.test(hinted) ? '真人口播'
        : /消费者|顾客|用户|模特|达人|使用场景|使用效果|效果展示|效果演示|使用前后|涂抹|上脸|试用|开箱|种草|D\s*(?:to|2)\s*C/i.test(hinted) ? 'D to C' : '产品';
    return { id: `free-line-${Date.now()}-${index}`, time, speech, visual, shotType, silent: !speech || /无口播|纯画面/.test(block), hook: index === 0 };
  });
}

export function serializeFreeCreationLines(lines: FreeCreationLine[]): string {
  return lines.map(line => `[${line.time}]\n画面：${line.visual.trim() || '待补充画面'}\n镜头类型：${line.shotType}\n台词：${line.silent ? '（无口播）' : line.speech.trim()}`).join('\n\n');
}
