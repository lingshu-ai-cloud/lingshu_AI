import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MetaLeadFields, { emptyMetaLeadFields } from './MetaLeadFields';
const render = (goal: string, extra = {}) => renderToStaticMarkup(createElement(MetaLeadFields, { goal, value: { ...emptyMetaLeadFields, ...extra }, onChange: () => {} }));
for (const goal of ['获取消息会话', '获取Meta表单线索', '获取独立站询盘']) {
  assert.match(render(goal), /系统自动匹配/);
  assert.doesNotMatch(render(goal), /<input|即时表单 ID|专业账户 ID|Pixel.*ID/);
}
assert.equal(render('提升网站访问'), '');
console.log('Meta lead fields render all three destinations without mixing fields.');
