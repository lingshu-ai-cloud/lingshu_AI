import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_SCENES, defaultBusinessPeriod, businessScenePromptSchema, type BusinessSceneId } from './assistantBusinessScene.js';
test('every quick business scene defaults to the last seven Beijing calendar days',()=>{
 for(const sceneId of Object.keys(BUSINESS_SCENES) as BusinessSceneId[]){
  assert.deepEqual(defaultBusinessPeriod(sceneId,new Date('2026-10-26T17:00:00Z')),{from:'2026-10-21',to:'2026-10-27'});
 }
});
test('inline selectors accept only known scenes and bounded object identities',()=>{
 assert.equal(businessScenePromptSchema.safeParse({sceneId:'CS-02',preferredId:'customer-a'}).success,true);
 assert.equal(businessScenePromptSchema.safeParse({sceneId:'evil',tenantId:'other'}).success,false);
});
