import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/StartupTaxCalendar.tsx', 'utf8');
const file = ts.createSourceFile('StartupTaxCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'records' && node.initializer) expression = node.initializer.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(expression);
const taxRecords = [
  { id: 'later', dueDate: '2026-11-15' },
  { id: 'null', dueDate: null },
  { id: 'unset' },
  { id: 'malformed', dueDate: 'not-a-date' },
  { id: 'invalid-month', dueDate: '2026-99-15' },
  { id: 'timestamp', dueDate: '2026-10-15T00:00:00Z' },
  { id: 'earlier', dueDate: '2026-10-15' },
];
const context = vm.createContext({ Date, snapshot: { taxRecords }, useMemo: (read: () => unknown) => read() });
const compiled = ts.transpileModule(`globalThis.records = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInContext(compiled, context);
assert.deepEqual(Array.from(context.records, (record: any) => record.id), ['earlier', 'later']);
assert.equal(taxRecords[0].id, 'later', 'calendar sorting must not mutate the source snapshot');
console.log('Startup tax calendar nullable and malformed deadline tests passed');
