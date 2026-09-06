import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { FollowupTemplateForm, needsFollowupTemplate, saveFollowupTemplate, templatePreview, type FollowupTemplate } from './FollowupTemplateEditor';

const template: FollowupTemplate = { id: 'fixture-approved', name: 'order_update', language: 'en_US', status: 'APPROVED', body: 'Hello {{1}}, your order {{2}} is ready.', variableCount: 2 };
const base = { templates: [template], loading: false, busy: false, error: '', selected: template.id, variables: ['Maya', 'A123'], onSelect() {}, onVariables() {}, onRetry() {}, onSave() {} };
assert.equal(needsFollowupTemplate({ send_mode: 'template_required' }), true);
assert.equal(needsFollowupTemplate({ template_status: 'not_configured' }), true);
assert.equal(needsFollowupTemplate({ send_mode: 'session_message', template_status: 'not_required' }), false);
assert.equal(needsFollowupTemplate({ send_mode: 'template', template_status: 'approved' }), false);
assert.equal(templatePreview(template, ['Maya', 'A123']), 'Hello Maya, your order A123 is ready.');
const html = renderToStaticMarkup(<FollowupTemplateForm {...base} />);
assert.match(html, /Hello Maya, your order A123 is ready/);
assert.match(html, /需要重新审批才能发送/);
assert.match(html, /模板内容 2/);
assert.doesNotMatch(html, /立即发送/);
assert.match(renderToStaticMarkup(<FollowupTemplateForm {...base} loading />), /正在加载模板/);
assert.match(renderToStaticMarkup(<FollowupTemplateForm {...base} templates={[]} />), /暂无可用的获批模板/);
assert.match(renderToStaticMarkup(<FollowupTemplateForm {...base} error="暂时无法读取模板目录" />), /role="alert"/);
assert.match(renderToStaticMarkup(<FollowupTemplateForm {...base} variables={['', '']} />), /disabled=""[^>]*>保存模板/);
assert.doesNotMatch(renderToStaticMarkup(<FollowupTemplateForm {...base} templates={[{ ...template, status: 'PENDING' }]} />), /value="fixture-approved"/);

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const requests: Array<{ url: string; init?: RequestInit }> = [];
const request: typeof fetch = async (url, init) => {
  requests.push({ url: String(url), init });
  return new Response(JSON.stringify({ batch: { id: 'batch', status: 'draft', approved_version: 0 }, items: [] }), { status: 200 });
};
try {
  const result = await saveFollowupTemplate('batch', 'item', template, [' Maya ', 'A123'], request);
  assert.equal(result.batch.approved_version, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/overseas/digital-employees/followup/batches/batch/items/item/template');
  assert.equal(requests[0].init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { templateName: 'order_update', language: 'en_US', variables: ['Maya', 'A123'] });
  await assert.rejects(saveFollowupTemplate('batch', 'item', template, ['Maya'], request), /完整填写/);
  await assert.rejects(saveFollowupTemplate('batch', 'item', { ...template, status: 'PENDING' }, ['Maya', 'A123'], request), /已获批/);
  assert.equal(requests.length, 1, 'invalid form never submits');
  const rejected: typeof fetch = async () => new Response(JSON.stringify({ error: 'approved_whatsapp_template_required' }), { status: 409 });
  await assert.rejects(saveFollowupTemplate('batch', 'item', template, ['Maya', 'A123'], rejected), /刷新目录后重新选择/);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}
console.log('followup template UI fixtures passed');
