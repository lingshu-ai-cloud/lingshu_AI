export interface InformationSource { title: string; uri: string; citationIndex?: number }

export function hasOverallConclusion(text: string): boolean {
  const clean = text.replace(/\*\*/gu, '').replace(/^#{1,6}\s*/gmu, '');
  const sections = clean.split(/(?:^|\n)\s*总体结论[：:]/u);
  return sections.length === 2 && sections[1].trim().length >= 12 && !/\n\s*(?:参考来源|信息来源|建议|下一步)[：:]/u.test(sections[1]);
}

/** Rendered into the saved answer itself, independently of the existing sources event/UI. */
export function appendInformationSources(text: string, sources: readonly InformationSource[], now = new Date()): string {
  if (!sources.length) return text;
  const links = sources.map(source => {
    const title = source.title.replace(/[\[\]\\\r\n<>]/gu, ' ').slice(0, 240);
    return `- ${source.citationIndex ? `[${source.citationIndex}] ` : ''}[${title}](${source.uri.replace(/[()]/gu, char => char === '(' ? '%28' : '%29')})`;
  });
  const body = text.trimEnd();
  let fence = '';
  for (const line of body.split('\n')) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = '';
  }
  const closeFence = fence ? `\n${fence}` : '';
  return `${body}${closeFence}\n\n信息来源（查询时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}，北京时间）：\n${links.join('\n')}`;
}
