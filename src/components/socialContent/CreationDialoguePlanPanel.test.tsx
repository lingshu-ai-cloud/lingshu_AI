import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import SocialCreationWorkbench from './SocialCreationWorkbench';
import { contentCreationTurn } from '../../../server/assistantContext/contentCreationDialogue';
import { creationDialogueFixture } from '../../../scripts/fixtures/contentCreationDialogue';

test('production workbench receives editable original narration and keeps missing evidence visible', async () => {
  const f = creationDialogueFixture();
  const run = (action: string, selection: unknown) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
  const shots = await run('products', { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] });
  const narration = await run('shots', shots.selection);
  const plan = await run('avatar', { ...narration.selection, narrationId: 'visual', avatar: true });
  const html = renderToStaticMarkup(<SocialCreationWorkbench mode="material_processing" seed={{ creationDialoguePlan: plan }} onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => assert.fail('render cannot start generation')}/>);
  assert.match(html, /内容创作交接方案/);
  assert.match(html, /交接口播草稿/);
  assert.ok(html.includes(plan.narrations[0]!.text));
  assert.match(html, /声音.*授权/);
  assert.match(html, /仅结构参考/);
  assert.match(html, /返回内容创作方案/);
  assert.doesNotMatch(html, /选择开场方式/);
});
