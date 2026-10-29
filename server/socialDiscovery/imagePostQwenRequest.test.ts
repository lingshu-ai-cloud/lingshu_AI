import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { analyzeImagePostEvidenceWithQwen } from '../agents/qwen.js';

test('image evidence sends the supported default model and original selected index without supplier retries', async () => {
  const keys = ['DASHSCOPE_BASE_URL','DASHSCOPE_API_KEY','QWEN_VL_MODEL','QWEN_IMAGE_POST_VL_MODEL','QWEN_EXACT_VL_MODEL'] as const;
  const saved = keys.map(key => process.env[key]);
  let calls = 0, reject = false;
  const server = createServer(async (req, res) => {
    calls++;
    let text = '';for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    assert.equal(body.model,'qwen3-vl-plus');
    const content = body.messages[1].content;
    assert.equal(content.filter((item: {type:string}) => item.type === 'image_url').length,1);
    assert.ok(content.some((item: {text?:string}) => item.text?.includes('imageIndex=4')));
    res.setHeader('Content-Type','application/json');
    if(reject){res.statusCode=500;res.end(JSON.stringify({error:{message:'test rejection'}}));return;}
    res.end(JSON.stringify({id:'vision-fixture',choices:[{message:{content:JSON.stringify({
      observedFacts:[{imageIndex:4,subjects:['气垫产品'],scene:'海报',composition:'中心',colors:[],visibleText:[],confidence:.99}],
      productionLabels:[{imageIndex:4,kind:'product_only',productPresence:'present',confidence:.99,evidence:'可见气垫产品'}],
    })}}]}));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('fixture binding');
    Object.assign(process.env,{DASHSCOPE_BASE_URL:`http://127.0.0.1:${address.port}`,DASHSCOPE_API_KEY:'fixture-key'});
    for(const key of ['QWEN_VL_MODEL','QWEN_IMAGE_POST_VL_MODEL','QWEN_EXACT_VL_MODEL'])delete process.env[key];
    const input={images:[{base64:'AQID',mimeType:'image/png',imageIndex:4}]};
    const result=await analyzeImagePostEvidenceWithQwen(input);
    assert.equal(result.productionLabels?.[0].imageIndex,4);
    reject=true;
    await assert.rejects(analyzeImagePostEvidenceWithQwen(input),/test rejection/);
    assert.equal(calls,2,'each explicit analysis sends exactly one request, including an error response');
  }finally{
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});
  }
});
