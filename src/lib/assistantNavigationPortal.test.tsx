import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {confirmedAssistantNavigation,navigationPortalForAnswer} from './assistantNavigationPortal';
import AssistantNavigationPortalCard from '../components/assistant/AssistantNavigationPortalCard';
import {parseMessages} from '../../server/routes/assistantThreadMessageInput';
import {sanitizeAssistantThreadForJournal} from './assistantThreadJournal';
import {useAssistantStore} from '../stores/assistantStore';
import type {Message} from '../appSession';

const offer={role:'assistant' as const,content:'先核对授权。\n确认前往投流页检查授权状态？'};
test('confirmation reveals the correct internal destination, including existing persisted exchanges',()=>{
 for(const text of ['确认','好','好的。','是','可以','确认前往智能投流'])assert.equal(confirmedAssistantNavigation(text,offer)?.page,'adsPlans',text);
 const messages=[offer,{role:'user' as const,content:'确认'},{role:'assistant' as const,content:'已确认前往投流页检查授权状态。'}];
 assert.equal(navigationPortalForAnswer(messages,0),null);
 assert.equal(navigationPortalForAnswer(messages,2)?.page,'adsPlans');
 const parsed=parseMessages(messages) as Message[];
 const journal=sanitizeAssistantThreadForJournal({...useAssistantStore.getState().threads.business,messages:parsed});
 assert.deepEqual(navigationPortalForAnswer(journal.messages,2),navigationPortalForAnswer(messages,2));
 const html=renderToStaticMarkup(createElement(AssistantNavigationPortalCard,{portal:confirmedAssistantNavigation('确认',offer)!}));
 assert.match(html,/智能投流门户/);assert.match(html,/前往智能投流/);assert.match(html,/ant-btn-color-blue/);
});
test('cancellation, unrelated questions, stale offers, arbitrary destinations and existing task flows are not intercepted',()=>{
 for(const text of ['不用','暂时不去','稍后','确认，但是先别去','确认创建投流计划','好的分析一下','确认前往智能客服'])assert.equal(confirmedAssistantNavigation(text,offer),null,text);
 assert.equal(confirmedAssistantNavigation('确认',{role:'assistant',content:'投放分析已完成。'}),null);
 assert.equal(confirmedAssistantNavigation('确认',{role:'user',content:offer.content}),null);
 assert.equal(confirmedAssistantNavigation('确认',{role:'assistant',content:'确认前往 https://example.com 页面？'}),null);
 assert.equal(confirmedAssistantNavigation('确认',{role:'assistant',content:'确认前往智能投流或智能客服？'}),null);
 assert.equal(confirmedAssistantNavigation('确认',{...offer,taskPortal:{phase:'offered'}}),null);
 assert.equal(navigationPortalForAnswer([offer,{role:'user',content:'其他问题'},{role:'assistant',content:'回复'},{role:'user',content:'确认'},{role:'assistant',content:'回复'}],4),null);
});
