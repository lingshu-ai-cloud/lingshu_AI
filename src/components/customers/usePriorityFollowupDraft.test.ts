import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function fixture(text = '') {
  let resolve!: (result: any) => void, scope = 'tenant-a';
  const requests: unknown[][] = [], fills: string[] = [], notices: string[] = [], dialogs: any[] = [];
  const effects: Array<() => (() => void) | void> = [], exports: any = {};
  const response = new Promise<any>(r => { resolve = r; });
  const input: any = { customer: { id: 'owned', timeline: [] }, buyerId: 'buyer-message', text, setText: (v: string) => fills.push(v), setMeta() {}, save() {}, notice: (v: string) => notices.push(v) };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./usePriorityFollowupDraft.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, URLSearchParams, window: { location: { search: '?customer=owned&followupDraft=1', href: 'https://local.test/?customer=owned&followupDraft=1' }, history: { replaceState() {} } },
    require(name: string) {
      if (name === 'react') return { useRef: (value: unknown) => ({ current: value }), useEffect: (fn: any) => effects.push(fn) };
      if (name === 'antd') return { App: { useApp: () => ({ modal: { confirm: (config: unknown) => dialogs.push(config) } }) } };
      if (name.includes('/auth')) return { authHeader: () => ({ Authorization: scope }) };
      if (name.includes('customerReplyPreparation')) return { requestDraft: (...args: unknown[]) => { requests.push(args); return response; } };
      throw Error(name);
    },
  });
  exports.usePriorityFollowupDraft(input); const cleanup = effects[0]();
  return { input, requests, fills, notices, dialogs, cleanup, scope: (s: string) => { scope = s; },
    async resolve(value: any = { draft: 'Recommended reply' }) { resolve(value); for (let i = 0; i < 10; i++) await Promise.resolve(); } };
}

test('explicit followup prepares one existing reply request and fills the editable composer without sending', async () => {
  const f = fixture(); await f.resolve();
  assert.equal(f.requests.length, 1); assert.equal((f.requests[0][0] as any).id, 'owned');
  assert.equal(f.requests[0][4], true, 'the explicit followup is a manual draft request, independent of automatic-reply settings');
  assert.deepEqual(f.fills, ['Recommended reply']); assert.equal(f.dialogs.length, 0);
});

test('existing drafts and edits made while generation runs are never silently overwritten', async () => {
  for (const initial of ['Existing draft', '']) {
    const f = fixture(initial); if (!initial) f.input.text = 'Typed while waiting';
    await f.resolve(); assert.equal(f.fills.length, 0); assert.equal(f.dialogs.length, 1);
    f.dialogs[0].onOk(); assert.deepEqual(f.fills, ['Recommended reply']);
  }
});

test('account switches, customer switches, new buyer turns and unmounts reject late suggestions', async () => {
  for (const kind of ['scope', 'customer', 'buyer', 'unmount']) {
    const f = fixture();
    if (kind === 'scope') f.scope('tenant-b');
    if (kind === 'customer') f.input.customer = { id: 'other' };
    if (kind === 'buyer') f.input.buyerId = 'new-buyer-message';
    if (kind === 'unmount') f.cleanup?.();
    await f.resolve(); assert.equal(f.fills.length, 0, kind); assert.equal(f.dialogs.length, 0, kind);
  }
});

test('unsafe handoff responses and unavailable drafts remain visibly blocked', async () => {
  for (const result of [{ draft: 'Unsafe commercial promise', handoffRequired: true, safeToSendBeforeHandoff: false }, { draft: '', handlingReason: '原请求仍在处理中' }]) {
    const f = fixture(); await f.resolve(result); assert.equal(f.fills.length, 0); assert.equal(f.notices.length, 2);
  }
});
