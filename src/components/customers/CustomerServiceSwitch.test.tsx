import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import CustomerServiceSwitch from './CustomerServiceSwitch';

test('activation exposes confirmed on/off state and disables unknown or saving state without mutation', () => {
  let writes = 0;
  const render = (enabled: boolean, unavailable = false, saving = false) => renderToStaticMarkup(
    <CustomerServiceSwitch enabled={enabled} unavailable={unavailable} saving={saving}
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
