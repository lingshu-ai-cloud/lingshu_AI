import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apifyMonthlyLimitRefusal} from './providerFailure.js';
const receipt={phase:'actor_submit',httpStatus:403,responseBody:JSON.stringify({error:{type:'platform-feature-disabled',message:'Monthly usage hard limit exceeded'}})};
test('only explicit no-run monthly-limit refusal qualifies, not auth errors or unknown responses',()=>{
 assert.equal(apifyMonthlyLimitRefusal([receipt],undefined),true);
 for(const r of [{...receipt,httpStatus:500},{...receipt,phase:'actor_poll'},{...receipt,responseBody:'invalid'}, {...receipt,responseBody:JSON.stringify({error:{type:'invalid-token',message:'Monthly usage hard limit exceeded'}})}, {...receipt,responseBody:JSON.stringify({error:{type:'platform-feature-disabled',message:'other account error'}})}])assert.equal(apifyMonthlyLimitRefusal([r],undefined),false);
 assert.equal(apifyMonthlyLimitRefusal([receipt],'known-run'),false);
});

test('completed process with zero successful search queries is distinct from an empty successful search', async () => {
 const {apifySearchUncompleted} = await import('./providerFailure.js');
 const receipt=(message:string)=>({phase:'actor_poll',httpStatus:200,runId:'run1',responseBody:JSON.stringify({data:{id:'run1',status:'SUCCEEDED',statusMessage:message}})});
 assert.equal(apifySearchUncompleted([receipt('Scraped 0/1 search queries')], 'run1'),true);
 assert.equal(apifySearchUncompleted([receipt('Scraped 1/1 search queries')], 'run1'),false);
 assert.equal(apifySearchUncompleted([receipt('Scraped 0/1 search queries')], 'run2'),false);
});
