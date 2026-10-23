import path from 'node:path';
import ts from 'typescript';

/** Follow only initialized chunk imports; lazy panels are intentionally excluded. */
export function studioEntryImportPath({ chunks, from, entry, readSource }) {
  const known = new Set(chunks);
  const visited = new Set();
  const queue = [[from]];
  for (let index = 0; index < queue.length; index++) {
    const chain = queue[index];
    const current = chain.at(-1);
    if (current === entry) return chain;
    if (visited.has(current)) continue;
    visited.add(current);
    const parsed = ts.createSourceFile(current, readSource(current), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('./')) continue;
      const target = path.posix.basename(specifier.text);
      if (known.has(target)) queue.push([...chain, target]);
    }
  }
  return null;
}
