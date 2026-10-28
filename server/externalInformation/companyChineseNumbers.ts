const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function decimal(value: string): string | undefined {
 const [integer, fractional] = value.split('点');
 if ([...integer].every(character => character in digits)) return [...integer].map(character => digits[character]).join('') + (fractional === undefined ? '' : '.' + [...fractional].map(character => digits[character]).join(''));
 let total = 0, section = 0, pending = 0;
 for (const character of integer) {
  if (character in digits) { pending = digits[character]; continue; }
  const unit = ({ 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 } as Record<string, number>)[character];
  if (!unit) return;
  if (unit >= 10000) { total += (section + pending) * unit; section = 0; } else section += (pending || 1) * unit;
  pending = 0;
 }
 const after = fractional === undefined ? '' : '.' + [...fractional].map(character => digits[character]).join('');
 return String(total + section + pending) + after;
}
/** Normalize explicit numeric claims only; ordinary Chinese prose is never rewritten or treated as evidence. */
export function normalizeCompanyChineseNumbers(text: string): string {
 const numeral = '[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二三四五六七八九]+)?';
 return text.replace(new RegExp('百分之(' + numeral + ')', 'gu'), (literal, value: string) => { const number = decimal(value); return number === undefined ? literal : number + '%'; })
  .replace(new RegExp(numeral + '(?:亿元|万元|亿美元|万美元|元|美元)', 'gu'), literal => { const unit = literal.match(/(?:亿元|万元|亿美元|万美元|元|美元)$/u)![0]; const value = decimal(literal.slice(0, -unit.length)); return value === undefined ? literal : value + unit; })
  .replace(/[零〇一二三四五六七八九]+点[零〇一二三四五六七八九]+/gu, literal => decimal(literal) ?? literal);
}
