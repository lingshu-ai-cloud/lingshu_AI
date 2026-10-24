import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdAuthorizationHealth.tsx', import.meta.url), 'utf8');
const exports: any = {};
const jsx = (_type: unknown, props: any) => props.children;
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports, module: { exports }, Date, Number,
  require: (name: string) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
});
const content = (value: any): string => Array.isArray(value) ? value.map(content).join('') : typeof value === 'string' ? value : '';
assert.match(content(exports.default({})), /授权状态待检查/);
assert.match(content(exports.default({ authorization: { status: 'expired', reasonCode: 'TOKEN_EXPIRED', expiresAt: '2026-10-24T01:00:00.000Z' } })), /授权已到期，请重新授权.*凭证到期/);
assert.match(content(exports.default({ authorization: { status: 'revoked', reasonCode: 'TOKEN_REVOKED' } })), /已撤销/);
assert.match(content(exports.default({ authorization: { status: 'missing_permissions', reasonCode: 'MISSING_SCOPES' } })), /权限不足/);
assert.doesNotMatch(content(exports.default({ authorization: { status: 'healthy', reasonCode: 'VERIFIED', expiresAt: 'invalid' } })), /Invalid|凭证到期/);
console.log('Ad authorization health: unknown, expired, revoked, insufficient permissions and invalid dates passed');
