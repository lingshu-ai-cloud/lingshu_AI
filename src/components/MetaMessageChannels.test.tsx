import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const nodes = (v: any): any[] => Array.isArray(v) ? v.flatMap(nodes) : v?.props ? [v, ...nodes(v.props.children)] : [];
const text = (v: any): string => Array.isArray(v) ? v.map(text).join('') : v?.props ? text(v.props.children) : typeof v === 'string' ? v : '';
function renderFixture(result: any, destination = '', onAuthorize = () => {}) {
  const effects: any[] = [], changes: any[] = [], readiness: boolean[] = [], exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./MetaLeadFields.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, console, JSON,
    require(name: string) {
      if (name === 'react') return { useRef: (v: any) => ({ current: v }), useEffect: (fn: any) => effects.push(fn) };
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name === 'antd') return Object.fromEntries(['Alert', 'Button', 'Select', 'Space', 'Spin'].map(k => [k, k]));
      return { useMetaDestinationAssets: () => ({ ...result, refresh() {} }) };
    },
  });
  const tree = exports.default({ goal: '获取消息会话', connectionId: 'account-a', pageId: '1', value: { ...exports.emptyMetaLeadFields, messageDestination: destination }, onChange: (v: any) => changes.push(v), onAvailability: (v: boolean) => readiness.push(v), onAuthorize });
  effects.forEach(fn => fn()); return { tree, changes, readiness };
}
const data = { kind: 'messages', forms: [], pixels: [], termsAccepted: null, whatsappPhoneNumber: '+8613800138000', instagram: { id: '7', username: 'factory' } };
test('creation channel selector shows actual recipient labels and leaves multiple choices for the user', () => {
  const h = renderFixture({ data }); const select = nodes(h.tree).find(n => n.type === 'Select');
  assert.ok(select.props.options.find((o: any) => o.value === 'WHATSAPP').label.includes('+8613800138000'));
  assert.ok(select.props.options.find((o: any) => o.value === 'INSTAGRAM_DIRECT').label.includes('@factory'));
  assert.ok(h.changes.every(v => v.messageDestination === ''));
  select.props.onChange('INSTAGRAM_DIRECT'); assert.equal(h.changes.at(-1).messageDestination, 'INSTAGRAM_DIRECT');
});
test('missing bindings expose Meta setup links; existing unavailable choice never silently switches', () => {
  const h = renderFixture({ data: { ...data, whatsappPhoneNumber: '', instagram: null } }, 'WHATSAPP');
  assert.ok(h.changes.every(v => v.messageDestination === 'WHATSAPP')); assert.equal(h.readiness.at(-1), false);
  const options = nodes(h.tree).find(n => n.type === 'Select').props.options;
  assert.equal(options.find((o: any) => o.value === 'WHATSAPP').disabled, true);
  assert.ok(nodes(h.tree).some(n => n.type === 'Button' && n.props.href === 'https://business.facebook.com/latest/settings' && text(n).includes('WhatsApp')));
  const single = renderFixture({ data: { ...data, whatsappPhoneNumber: '', instagram: null } }); assert.equal(single.changes.at(-1).messageDestination, 'MESSENGER');
});
test('authorization failure has its own status and actionable authorization entry', () => {
  let clicked = false;
  const h = renderFixture({ error: 'Permission denied', errorCode: '200' }, '', () => { clicked = true; });
  assert.ok(nodes(h.tree).some(n => n.type === 'Alert' && n.props.title === '当前授权不足或已失效'));
  const alert = nodes(h.tree).find(n => n.type === 'Alert'); nodes(alert.props.description).find(n => n.type === 'Button').props.onClick();
  assert.equal(clicked, true); assert.equal(h.readiness.at(-1), false); assert.equal(nodes(h.tree).filter(n => n.type === 'Select').length, 0);
});
test('missing account renders the local account picker; OAuth is an explicitly separate action', () => {
  const exports: any = {}; let authorizations = 0, selections = 0;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdDraftMessageChannels.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, JSON, require(name: string) {
      if (name === 'react') return { useState: (v: any) => [v, () => {}], useEffect() {} };
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name === 'antd') return { Alert: 'Alert', Button: 'Button' };
      return { default: 'MetaLeadFields', emptyMetaLeadFields: {}, MetaPageSelect: 'MetaPageSelect' };
    },
  });
  const picker = { type: 'AccountPicker', props: { onChange() { selections++; } } };
  const tree = exports.default({ accountPicker: picker, onChange() {}, onAuthorize() { authorizations++; } });
  const all = nodes(tree);
  assert.equal(all.filter(n => n === picker).length, 1);
  all.find(n => n.type === 'AccountPicker').props.onChange('existing-connection');
  assert.equal(selections, 1); assert.equal(authorizations, 0);
  assert.equal(all.some(n => text(n) === '选择或连接账户'), false);
  const auth = all.find(n => n.type === 'Button' && text(n) === '连接新的广告账户 / 补充 Meta 授权');
  assert.ok(auth); auth.props.onClick(); assert.equal(authorizations, 1);
  const connected = exports.default({ connectionId: 'existing-connection', accountPicker: picker, onChange() {}, onAuthorize() {} });
  assert.ok(nodes(connected).some(n => n.type === 'MetaPageSelect'));
  assert.ok(nodes(connected).some(n => n.type === 'MetaLeadFields' && n.props.connectionId === 'existing-connection'));
});
