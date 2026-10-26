import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guidedCreationFixture } from '../../scripts/fixtures/guidedCreation.js';
import { assistantScenarioIntake } from './assistantScenarioIntake.js';
import { sanitizeAssistantThreadForJournal } from './assistantThreadJournal.js';
import { useAssistantStore } from '../stores/assistantStore.js';

test('confirmed scene evidence and spoken-line edits survive journal sanitization', async () => {
  const fixture=guidedCreationFixture();
  const initial={...fixture.initial,productIds:['fixture-product'],guided:{...fixture.initial.guided!,languages:['en'],scene:{kind:'campaign' as const,groupId:'scene-journal',plannedPublishAt:'2099-01-05T08:00:00+08:00',deliverBy:'2099-01-04T08:00:00+08:00',campaign:{name:'活动',offer:'满千减百',sellingPoints:'卖点',materialIds:[]},narrationEdits:[],narrationConfirmed:false}}};
  let reply=await fixture.run('guided_products',initial);
  reply=await fixture.run('guided_structure',{...reply.selection,guided:{...reply.selection.guided!,structureId:'reference:fixture-video'}});
  reply=await fixture.run('guided_production',{...reply.selection,guided:{...reply.selection.guided!,productionMode:'auto',presenterMode:'none'}});
  const lines=reply.guided!.narration.lines!;
  reply=await fixture.run('guided_review',{...reply.selection,guided:{...reply.selection.guided!,scene:{...initial.guided.scene,narrationConfirmed:true,narrationEdits:lines.map(row=>({lineId:row.lineId,text:`活动：${row.text}`}))}}});
  const portal={...assistantScenarioIntake('为活动准备内容')!,scenePlan:reply};
  const thread={...useAssistantStore.getState().threads.business,messages:[{role:'assistant' as const,content:'确认口播',creationPortal:portal}]};
  const saved=sanitizeAssistantThreadForJournal(thread).messages[0]?.creationPortal;
  assert.equal(saved?.scenePlan?.guided?.fingerprint,reply.guided!.fingerprint);
  assert.match(saved?.scenePlan?.guided?.narration.lines?.[0]?.text||'',/活动/);
});
