export type DailyNewsWindow = { day: string; cutoff: string; timeZone: 'Asia/Shanghai' };
/** Use today's evidence when sufficient; otherwise allow the already-verified 24-hour set. */
export function selectDailyNewsOriginals<T extends { publicationDay?: string; source: { uri: string } }>(originals: T[], day: string): T[] | undefined {
 const enough = (items: T[]) => items.length >= 3 && new Set(items.map(item => new URL(item.source.uri).hostname.replace(/^www\./u, ''))).size >= 2;
 const today = originals.filter(original => original.publicationDay === day);
 return enough(today) ? today : originals.length ? originals : undefined;
}
export function dailyNewsWindow(question: string, now = Date.now()): DailyNewsWindow | undefined {
 if (!/今日资讯/u.test(question)) return undefined;
 return { day: new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now), cutoff:new Date(now).toISOString(),timeZone:'Asia/Shanghai' };
}
/** A timestamp's timezone determines the Shanghai date; date-only disclosures are never given invented times. */
export function publicationMatchesDay(article:{published:string[];publishedTimes?:string[]},day:string,now=Date.now()):boolean {
 if(article.publishedTimes?.length)return article.publishedTimes.some(value=>{
  const instant=Date.parse(value);return Number.isFinite(instant)&&instant<=now&&new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant)===day;
 });
 return article.published.includes(day);
}
