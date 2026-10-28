import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { createQwenClient } from '../agents/qwenClient.js';
import { analyzeSocialInsight } from './model.js';
test('one bounded Qwen JSON call allows full classification output without retry, search or thinking',async()=>{
 let calls=0;let request:Record<string,unknown>|undefined;let options:Record<string,unknown>|undefined;
 const client={chat:{completions:{create:async(body:Record<string,unknown>,opts:Record<string,unknown>)=>{calls++;request=body;options=opts;return {choices:[{finish_reason:'stop',message:{content:'{"assignments":[]}'}}]};}}}} as unknown as ReturnType<typeof createQwenClient>;
 assert.equal(await analyzeSocialInsight('fixture prompt',client),'{"assignments":[]}');assert.equal(calls,1);
 assert.equal(request?.max_tokens,8192);assert.deepEqual(request?.response_format,{type:'json_object'});assert.equal(request?.enable_thinking,false);assert.equal(request?.enable_search,false);assert.equal(options?.maxRetries,0);assert.equal(options?.timeout,90000);
});
test('truncated completion fails explicitly and does not retry',async()=>{
 let calls=0;const client={chat:{completions:{create:async()=>{calls++;return {choices:[{finish_reason:'length',message:{content:'{"assignments":['}}]};}}}} as unknown as ReturnType<typeof createQwenClient>;
 await assert.rejects(analyzeSocialInsight('fixture',client),/model_incomplete/);assert.equal(calls,1);
});
