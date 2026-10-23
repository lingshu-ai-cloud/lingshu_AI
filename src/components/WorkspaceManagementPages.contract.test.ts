import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/WorkspaceManagementPages.tsx', 'utf8');
const file = ts.createSourceFile('WorkspaceManagementPages.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
    handlers.set(node.name.text, node.initializer.getText(file));
  }
  ts.forEachChild(node, visit);
}
visit(file);

function handler(name: string, bindings: Record<string, unknown>) {
  const expression = handlers.get(name);
  assert.ok(expression, `${name} must remain an explicit tested handler`);
  const output = ts.transpileModule(`globalThis.run = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ Error, ...bindings });
  vm.runInContext(output, context);
  return context.run as (...args: any[]) => Promise<unknown> | void;
}

assert.match(source, /export function ScriptLibraryPage/);
assert.doesNotMatch(source, /export function AgentMemoryPage|export function OrganizationPermissionsPage/);
assert.match(source, /<Drawer open size=\{760\}/);
assert.match(source, /<Drawer open size=\{640\}/);
assert.doesNotMatch(source, /<button\b|<select\b|<textarea\b|<input\b|window\.confirm/);

let confirmation: any;
const state = { deleted: 0, selected: true, drafts: [{ id: 'draft-1', title: '草稿' }] };
const remove = handler('deleteDraft', {
  modal: { confirm: (options: unknown) => { confirmation = options; } },
  studioApi: { deleteProject: async () => { state.deleted++; } },
  setDraftBusyId() {}, setActionError() {},
  setDrafts: (update: (items: typeof state.drafts) => typeof state.drafts) => { state.drafts = update(state.drafts); },
  setSelectedDraft: () => { state.selected = false; },
});
await remove(state.drafts[0]);
assert.equal(state.deleted, 0, 'opening a confirmation cannot delete a draft');
assert.equal(confirmation.okButtonProps.danger, true);
assert.ok(confirmation.zIndex > 1000, 'confirmation must render above the details Drawer');
await confirmation.onOk();
assert.equal(state.deleted, 1);
assert.equal(state.drafts.length, 0);
assert.equal(state.selected, false);

console.log('Script library contract tests passed');
