/** Display-only Markdown table parsing. Optional edge pipes and blank lines are common in streamed replies. */
export interface AssistantMarkdownTable { header: string[]; rows: string[][]; end: number }
export function assistantTableCells(line: string): string[] | null {
  const input = line.trim();
  if (!input || /^```|^~~~|^>/u.test(input)) return null;
  const cells: string[] = []; let cell = '', escaped = false, code = false, delimiters = 0;
  for (const character of input) {
    if (escaped) { cell += character === '|' ? '|' : `\\${character}`; escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (character === '`') { code = !code; cell += character; continue; }
    if (character === '|' && !code) { cells.push(cell.trim()); cell = ''; delimiters++; }
    else cell += character;
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  if (!delimiters) return null;
  if (input.startsWith('|') && cells[0] === '') cells.shift();
  if (input.endsWith('|') && cells.at(-1) === '') cells.pop();
  return cells.length >= 2 ? cells : null;
}
const separator = (cells: string[]) => cells.every(cell => /^:?-{3,}:?$/u.test(cell));
const explicit = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
const nextLine = (lines: string[], start: number) => { let index = start; while (index < lines.length && !lines[index].trim()) index++; return index; };
export function readAssistantMarkdownTable(lines: string[], start: number): AssistantMarkdownTable | null {
  const header = assistantTableCells(lines[start] ?? '');
  if (!header || separator(header)) return null;
  let index = nextLine(lines,start+1);
  const second = assistantTableCells(lines[index] ?? '');
  if (!second || (!separator(second) && !(explicit(lines[start]) && explicit(lines[index]) && second.length === header.length))) return null;
  const rows: string[][] = [];
  if (separator(second)) { if (second.length !== header.length) return null; index++; }
  let end = index;
  while (index < lines.length) {
    const candidate = nextLine(lines,index);
    const cells = assistantTableCells(lines[candidate] ?? '');
    if (!cells || separator(cells) || cells.length > header.length) break;
    rows.push(cells.map(cell => cell.replace(/<br\s*\/?>/giu, '；')));
    end = candidate+1; index = candidate+1;
  }
  return { header, rows, end };
}
export function hasAssistantMarkdownTable(text: string): boolean {
  const lines = text.split('\n');
  return lines.some((_line,index) => readAssistantMarkdownTable(lines,index) !== null);
}
