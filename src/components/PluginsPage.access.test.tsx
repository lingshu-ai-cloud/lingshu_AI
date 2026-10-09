import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/PluginsPage.tsx', 'utf8');

assert.match(source, /plugin\.managementAllowed === true && !plugin\.installed/, 'global install controls must require server-confirmed platform management access');
assert.match(source, /plugin\.managementAllowed === true && fields\.length > 0/, 'secret configuration controls must require platform management access');
assert.ok((source.match(/plugin\.managementAllowed === true && <Popconfirm/g) || []).length >= 2, 'global delete confirmations must require platform management access');
assert.match(source, /plugin\.managementAllowed === true \|\| plugin\.tenantUsable === true/, 'tenant utility capabilities must remain usable without exposing management actions');
assert.match(source, /plugin\.managementAllowed === true \? '测试' : '使用'/, 'customer utilities must be presented as use actions rather than internal connection tests');

console.log('plugin integration center access contract tests passed');
