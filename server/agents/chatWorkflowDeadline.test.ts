import assert from 'node:assert/strict';import {test} from 'node:test';import {chatWorkflowDeadlines as deadlines} from './chatWorkflowDeadline';
test('source-first research has time for discovery, supplement, page reads and one synthesis without widening any provider call',()=>{
 assert.deepEqual(deadlines({backend:'qwen',requireSources:true,searchEvidenceFirst:true,timeoutMs:120000}),{requestMs:120000,workflowMs:420000});
 assert.deepEqual(deadlines({backend:'qwen',requireSources:true,searchEvidenceFirst:true,timeoutMs:90000}),{requestMs:90000,workflowMs:330000});
});
test('ordinary chat and other providers retain their existing request deadline and all values are bounded',()=>{
 for(const backend of ['qwen','gemini'])assert.equal(deadlines({backend,timeoutMs:120000}).workflowMs,120000);
 assert.equal(deadlines({backend:'gemini',requireSources:true,searchEvidenceFirst:true,timeoutMs:120000}).workflowMs,120000);
 assert.equal(deadlines({backend:'qwen',timeoutMs:999999}).requestMs,120000);
 assert.equal(deadlines({backend:'qwen',timeoutMs:NaN}).workflowMs,90000);
});
