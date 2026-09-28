/** Picture cuts stay independent even when several cuts share one spoken sentence. */
export type SpeechGroup = { id: string; source: string; draft: string; time: string; sourcePrecision?: string; productTerms?: string[]; words?: Array<{start: number; end: number; text: string}>; excludedShotIds?: string[] };
export type PictureShot = { shotId?: string; time: string; visual?: string; firstFrameRef?: string; firstFrameSeconds?: number };
export const timeRange = (time: string) => {
  const values = time.match(/[\d.]+/g)?.map(Number) || [];
  return values.length >= 2 && values.every(Number.isFinite) && values[1] > values[0] ? { start: values[0], end: values[1] } : null;
};

function spokenUnits(line: SpeechGroup) {
  const words = line.words || [], normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const terms = new Set((line.productTerms || []).map(normalize).filter(Boolean));
  const units: typeof words = [];
  for (let index = 0; index < words.length; index++) {
    let last = index, combined = '', found = -1;
    for (let end = index; end < Math.min(words.length,index + 12); end++) {
      combined += normalize(words[end].text);
      if (terms.has(combined)) found = end;
    }
    if (found >= index) last = found;
    units.push({start:words[index].start,end:words[last].end,text:words.slice(index,last+1).map(word=>word.text).join(' ')});
    index = last;
  }
  return units;
}

export function groupSpeechShots(lines: SpeechGroup[], shots: PictureShot[], excludedShotIds: string[] = []) {
  const cuts = shots.flatMap((shot, index) => {
    const range = timeRange(shot.time), id = shot.shotId || `shot-${index + 1}`;
    return range && !excludedShotIds.includes(id) ? [{ ...shot, ...range, id }] : [];
  }).sort((a, b) => a.start - b.start);
  return lines.map(line => {
    const range = timeRange(line.time);
    return { ...line, shots: range ? cuts.filter(cut => cut.start < range.end && cut.end > range.start).map(cut => ({...cut, spokenFragment: line.sourcePrecision === 'phrase' ? spokenUnits(line).filter(word => (word.start + word.end) / 2 >= cut.start && (word.start + word.end) / 2 < cut.end).map(word => word.text).join(' ').replace(/\s+([,.!?;:])/g, '$1') : ''})) : [] };
  });
}
