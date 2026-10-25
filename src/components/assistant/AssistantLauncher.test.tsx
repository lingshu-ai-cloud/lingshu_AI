import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantLauncher from './AssistantLauncher';

const noOp = () => {};
const launcherButtonRef = createRef<HTMLAnchorElement | HTMLButtonElement>();
const edgeLauncherButtonRef = createRef<HTMLAnchorElement | HTMLButtonElement>();

function render(retracted: boolean, chatOpen: boolean) {
  return renderToStaticMarkup(
    <AssistantLauncher
      retracted={retracted}
      chatOpen={chatOpen}
      badgeCount={3}
      reduceMotion={false}
      launcherButtonRef={launcherButtonRef}
      edgeLauncherButtonRef={edgeLauncherButtonRef}
      onLauncherClick={noOp}
      onRetract={noOp}
      onRestore={noOp}
    />,
  );
}

test('expanded launcher retains the dialog relationship and manual retract control', () => {
  const html = render(false, false);
  assert.match(html, /data-global-assistant="launcher"/);
  assert.match(html, /data-assistant-mascot="hub-seed"/);
  assert.match(html, /aria-controls="global-assistant-panel"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-global-assistant="retract-control"/);
  assert.doesNotMatch(html, /data-global-assistant="edge-launcher"/);
});

test('retracted launcher retains the badge and keyboard-accessible restore control', () => {
  const html = render(true, false);
  assert.match(html, /data-global-assistant="edge-launcher"/);
  assert.match(html, /data-assistant-mascot="hub-seed"/);
  assert.match(html, /aria-label="展开灵小枢入口"/);
  assert.match(html, /3/);
  assert.doesNotMatch(html, /data-global-assistant="launcher"/);
});

test('open chat shows the full launcher even when the stored preference is retracted', () => {
  const html = render(true, true);
  assert.match(html, /data-global-assistant="launcher"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="收起灵小枢对话"/);
  assert.doesNotMatch(html, /data-global-assistant="retract-control"/);
});
