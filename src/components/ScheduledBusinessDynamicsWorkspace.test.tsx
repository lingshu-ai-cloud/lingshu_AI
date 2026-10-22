import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScheduledBusinessDynamicsWorkspace, { type BusinessDynamicsPayload } from './ScheduledBusinessDynamicsWorkspace.js';

function render(data: BusinessDynamicsPayload | null, loading = false, error = ''): string {
  return renderToStaticMarkup(createElement(ScheduledBusinessDynamicsWorkspace, {
    businessDynamics: data,
    businessDynamicsLoading: loading,
    businessDynamicsError: error,
    formatTime: value => value || '无时间',
    onRefresh: () => undefined,
    renderAutomationTemplates: () => createElement('span', null, '自动化模板占位'),
  }));
}

const ready = render({
  generatedAt: '2026-10-22',
  profile: { markets: ['德国'], completion: 6, completionTotal: 6 },
  quote: { sourceDate: '2026-10-22', rates: [{ code: 'EUR', rate: 0.92, market: '德国' }] },
  intelligence: {
    status: 'ready', summary: '市场信息已核实',
    signals: [{ market: '德国', title: '行业动态', impact: '需求变化', action: '复核报价', risk: 'medium' }],
    sources: [{ title: '公开来源', url: 'https://example.com/source' }],
  },
});
for (const text of ['外部检索已接入', 'EUR', '德国', '市场信息已核实', '公开来源', '自动化模板占位']) {
  assert.ok(ready.includes(text), `${text} must remain visible`);
}
assert.match(ready, /rel="noreferrer"/, 'external evidence links must retain their safety attribute');

const incomplete = render({ profile: { missingFields: ['行业'] }, intelligence: { status: 'profile_incomplete', summary: '缺少资料' } });
assert.match(incomplete, /等待企业资料/);
assert.match(incomplete, /缺少 行业/);
assert.match(incomplete, /去补充资料/);

const loading = render(null, true, '');
assert.match(loading, /正在生成经营动态/);
assert.match(loading, /正在读取汇率和报价规则/);

const failed = render({ intelligence: { status: 'unavailable', summary: '检索失败' } }, false, '服务暂不可用');
assert.match(failed, /服务暂不可用/);
assert.match(failed, /检索失败/);

console.log('scheduled business dynamics workspace states passed');
