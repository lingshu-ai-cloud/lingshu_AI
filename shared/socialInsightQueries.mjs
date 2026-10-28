/** Expand only the confirmed keyword; never truncate or accept control characters. */
export function socialInsightQueries(keyword) {
 if (typeof keyword !== 'string' || keyword !== keyword.trim() || !keyword || keyword.length > 80 || /[\u0000-\u001f\u007f]/u.test(keyword)) throw Error('social_insight_keyword_invalid');
 return [keyword, `${keyword} OEM`, `${keyword} private label`, `${keyword} manufacturer`];
}
