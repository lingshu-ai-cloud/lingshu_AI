import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import CustomerServiceSwitch, { CustomerDirectory, CustomerServiceControl } from './CustomerServiceSwitch';
import type { CustomerProfile } from '../../types/customer';

test('activation exposes confirmed on/off state and disables unknown or saving state without mutation', () => {
  let writes = 0;
  const render = (enabled: boolean, unavailable = false, saving = false) => renderToStaticMarkup(
    <CustomerServiceControl enabled={enabled} unavailable={unavailable} saving={saving}
      summary="当前状态；开启后仅提供建议" onChange={() => { writes += 1; }} />,
  );
  assert.match(render(false), /role="switch"[^>]*aria-checked="false"/);
  assert.match(render(true), /role="switch"[^>]*aria-checked="true"/);
  for (const html of [render(false, true), render(true, false, true)]) {
    assert.match(html, /<button[^>]*disabled=""/);
    assert.match(html, /aria-label="智能客服总开关"/);
    assert.match(html, /aria-describedby=/);
    assert.match(html, /开启后仅提供建议/);
  }
  assert.equal(writes, 0, 'viewing or rendering the switch never changes activation');
});

const customer = {
  id: 'customer-1', name: 'Faisal Al-Harbi', avatar: 'F', countryName: '沙特阿拉伯', email: 'faisal@example.com',
  language: '阿拉伯语', source: 'whatsapp', product: '包装产线', outboundProduct: '自动包装产线', estimatedValue: '待评估',
  stage: 'inquiry', intentScore: 82, intentSignals: [], handlingMode: 'ai_draft', handlingReason: '', priority: 1,
  lastActive: '2 分钟前', localTime: '13:28', orders: [], tags: [], summary: '', nextStep: '', timeline: [], languageLocked: false,
} as CustomerProfile;

test('customer directory trigger replaces the persistent switch and reports the current customer count', () => {
  const html = renderToStaticMarkup(<CustomerServiceSwitch enabled={false} unavailable={false} saving={false}
    summary="已关闭" onChange={() => {}} customers={[customer]} onOpenCustomer={() => {}}/>);
  assert.match(html, /查看全部用户信息/);
  assert.match(html, />1<\/span>/);
  assert.doesNotMatch(html, /role="switch"/);
});

test('customer directory lists current customer facts without exposing internal ids', () => {
  const html = renderToStaticMarkup(<CustomerDirectory customers={[customer]} onOpenCustomer={() => {}}/>);
  for (const value of ['Faisal Al-Harbi', 'faisal@example.com', '沙特阿拉伯', '阿拉伯语', '自动包装产线', '询盘中', '82']) {
    assert.match(html, new RegExp(value));
  }
  assert.doesNotMatch(html, />customer-1</);
});
