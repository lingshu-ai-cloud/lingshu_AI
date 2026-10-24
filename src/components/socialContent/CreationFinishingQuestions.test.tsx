import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import CreationFinishingQuestions from './CreationFinishingQuestions';
import { contentCreationTurn } from '../../../server/assistantContext/contentCreationDialogue';
import { creationDialogueFixture } from '../../../scripts/fixtures/contentCreationDialogue';

test('finishing questions retain editable text while an unbound project has no fake audio, aligned captions or video player', async () => {
  const f = creationDialogueFixture();
  const run = (action: string, selection: unknown) => contentCreationTurn('fixture', { action, selection, instruction: '测试' }, f.ports);
  const shots = await run('products', { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] });
  const narration = await run('shots', shots.selection);
  let reply = await run('production_voice', { ...narration.selection, avatar: false, narrationId: 'visual', productionDraft: { materialChoice: 'candidate', narrationDraft: '已确认口播文字。' } });
  const render = () => renderToStaticMarkup(<CreationFinishingQuestions reply={reply} busy={false} run={async () => assert.fail('render cannot generate')}/>);
  assert.match(render(), /保留配音需求，暂不生成/);
  reply = await run('production_subtitles', { ...reply.selection, productionDraft: { ...reply.selection.productionDraft, voiceChoice: 'none' } });
  assert.match(render(), /字幕问答回复/); assert.match(render(), /没有音频对齐证据/);
  reply = await run('production_preview', { ...reply.selection, productionDraft: { ...reply.selection.productionDraft, subtitleChoice: 'draft', subtitleDraft: '字幕文字草稿' } });
  assert.match(render(), /没有可核验并播放的本方案成片/);
  assert.doesNotMatch(render(), /<video|<audio|\.srt|00:00:|src="/);
});
