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

// Exercise the actual async UI handlers with in-memory collaborators. These are
// not browser focus/visual tests and deliberately never call a live API.
function handler(name: string, bindings: Record<string, unknown>) {
  const expression = handlers.get(name);
  assert.ok(expression, `${name} must remain an explicit tested handler`);
  const output = ts.transpileModule(`globalThis.run = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ Error, ...bindings });
  vm.runInContext(output, context);
  return context.run as (...args: any[]) => Promise<unknown> | void;
}

assert.doesNotMatch(source, /<PageShell hideHeader/, 'all three workspaces must use the shared page title');
assert.doesNotMatch(source, /<button\b|<select\b|<textarea\b|<input\b|useModalFocus|window\.confirm/, 'controls and overlays must use the themed Ant behavior');
assert.match(source, /<Table<EmployeeAccount>/);
assert.match(source, /<Popconfirm title="移除成员？"/);
assert.match(source, /<Drawer open size=\{760\}/);
assert.match(source, /<Drawer open size=\{640\}/);
assert.match(source, /form="agent-memory-editor-form"/);
assert.match(source, /form="organization-member-form"/);
assert.match(source, /beforeUpload=\{file => \{ restoreMemoryBackup\(file\); return false; \}\}/, 'choosing a backup must not auto-upload or skip confirmation');
assert.match(source, /includeMockCustomers && import\.meta\.env\.DEV && !hasContentOpsData/);
assert.match(source, /createMockCustomers\(mockCustomerScope\)/);
assert.match(source, /策略记忆|审计记录/);
assert.doesNotMatch(source, /hover:-translate|shadow-sm|rounded-2xl/);

const member = { id: 'member-1', name: '运营', email: 'operator@example.test', role: 'social_operator', isCurrent: false };
function memberHarness(canManage = true, reject = false) {
  const state = { members: [member], busy: '', error: '', calls: [] as string[] };
  const bindings = {
    canManage, memberBusy: '',
    authApi: {
      updateEmployeeRole: async (id: string) => { state.calls.push(`role:${id}`); if (reject) throw new Error('角色更新被拒绝'); },
      deleteEmployee: async (id: string) => { state.calls.push(`delete:${id}`); if (reject) throw new Error('移除被拒绝'); },
    },
    setMemberBusy: (value: string) => { state.busy = value; },
    setError: (value: string) => { state.error = value; },
    setMembers: (update: (items: typeof state.members) => typeof state.members) => { state.members = update(state.members); },
  };
  return { state, update: handler('updateRole', bindings), remove: handler('removeMember', bindings) };
}
for (const canManage of [false, true]) {
  const h = memberHarness(canManage);
  const target = canManage ? { ...member, isCurrent: true } : member;
  await h.update(target, 'admin');
  await h.remove(target);
  assert.equal(h.state.calls.length, 0, 'read-only and current accounts cannot be mutated');
}
{
  const h = memberHarness();
  await h.update(member, 'admin');
  assert.equal(h.state.members[0].role, 'admin');
  await h.remove(member);
  assert.equal(h.state.members.length, 0);
  assert.equal(h.state.busy, '');
}
{
  const h = memberHarness(true, true);
  await h.update(member, 'admin');
  assert.equal(h.state.members[0].role, 'social_operator');
  await h.remove(member);
  assert.equal(h.state.members.length, 1, 'failed deletion must retain the authoritative member');
  assert.equal(h.state.error, '移除被拒绝');
  assert.equal(h.state.busy, '');
}

const customerEditor = { kind: 'customer-add', customerId: 'customer-1', customerName: '客户', key: 'preferred_tone', value: '  简洁  ', expiresAt: '2026-12-01', existingKeys: [] as string[] };
function memoryHarness(editor: Record<string, unknown> = customerEditor, canManage = true, succeed = true) {
  const state = { closed: false, notice: '', calls: [] as any[][] };
  const submit = handler('submitMemoryEditor', {
    memoryEditor: editor, memoryBusy: '', memoryOverview: { canManage },
    memoryMutation: async (...args: any[]) => { state.calls.push(args); return succeed ? { ok: true } : null; },
    setMemoryEditor: (value: unknown) => { state.closed = value === null; },
    setMemoryNotice: (value: string) => { state.notice = value; },
  });
  return { state, submit: () => submit({ preventDefault() {} }) };
}
{
  const h = memoryHarness();
  await h.submit();
  assert.equal(h.state.calls.length, 1);
  const [, endpoint, method, payload] = h.state.calls[0];
  assert.equal(endpoint, '/api/overseas/agent-memory/customer-memories');
  assert.equal(method, 'POST');
  assert.equal(payload.customerId, customerEditor.customerId);
  assert.equal(payload.value, '简洁');
  assert.equal(payload.sourceKind, 'human');
  assert.equal(payload.status, 'confirmed');
  assert.equal(payload.expiresAt, customerEditor.expiresAt);
  assert.equal(h.state.closed, true);
}
{
  const h = memoryHarness({ ...customerEditor, existingKeys: ['preferred_tone'] });
  await h.submit();
  assert.equal(h.state.calls.length, 0);
  assert.match(h.state.notice, /已经存在/);
  assert.equal(h.state.closed, false);
}
{
  const h = memoryHarness(customerEditor, false);
  await h.submit();
  assert.equal(h.state.calls.length, 0);
}
{
  const h = memoryHarness(customerEditor, true, false);
  await h.submit();
  assert.equal(h.state.closed, false, 'failed memory save must keep entered content available');
}
{
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
}

console.log('Workspace management UI, role protections, confirmation and memory preservation tests passed');
