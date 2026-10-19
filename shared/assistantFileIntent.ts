export type AssistantFileIntent = { format: 'pdf' | 'jpg'; diagram: boolean; needsMapScope: boolean };
export function assistantFileIntent(text: string): AssistantFileIntent | null {
  if (/(?:不要|无需|不用|不需要).{0,8}(?:PDF|JPG|JPEG|文件|图片)/iu.test(text)) return null;
  if (/^(?:如何|怎么|为什么|是否|能否|可以(?:怎么|如何))/u.test(text.trim())) return null;
  if (!/(?:生成|导出|制作|做一|给我|想要|转成|转换|下载|保存为|整理成)/u.test(text)) return null;
  if (/\bPDF\b/iu.test(text)) return { format: 'pdf', diagram: false, needsMapScope: false };
  const diagram = /(?:路线图|路线路径图|思维导图|流程图|关系图|业务地图|战略地图)/u.test(text);
  if (diagram || /(?:地图|\bJPE?G\b|图片文件)/iu.test(text)) return { format: 'jpg', diagram, needsMapScope: !diagram && /地图/u.test(text) };
  return null;
}

export const assistantFileMarker = (id: string) => `<!--assistant-file:${id}-->`;
export function extractAssistantFiles(content: string) {
  const ids: string[] = [];
  const text = content.replace(/<!--assistant-file:([a-f0-9]{64})-->/g, (_, id) => { if (!ids.includes(id)) ids.push(id); return ''; });
  return { ids: ids.slice(0, 5), text };
}
