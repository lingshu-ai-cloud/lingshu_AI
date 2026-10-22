import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {resolveSocialProductionReferenceVideoPath} from './socialContentProductionReplicationEvaluation.js';

test('reference-only media requires tenant path, source, and exact bytes before evaluation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'social-reference-evidence-'));
  const previous=process.env.SOCIAL_CONTENT_MEDIA_ROOT;
  process.env.SOCIAL_CONTENT_MEDIA_ROOT=root;
  try{
    const recordId='reference1',tenantId='tenant',relative=`tenants/${tenantId}/reference-videos/${recordId}.mp4`;
    const localPath=path.join(root,relative),bytes=Buffer.from('reviewed tenant reference bytes');
    await mkdir(path.dirname(localPath),{recursive:true});
    await writeFile(localPath,bytes);
    const sha=createHash('sha256').update(bytes).digest('hex');
    const record={id:recordId,tenantId,videoFileId:relative,sourceUrl:'https://example.test/video',aiAnalysis:{analysisRunId:'analysis-1'}};
    const repository={dataStore:{getById:async()=>record}} as any;
    const detail={brief:{referenceReuse:{recordId,contentSha256:sha}},
      referenceVideoAnalysis:{referenceRecordId:recordId,referenceSourceId:'reference-source'},
      sources:[{kind:'reference_link',status:'active',sourceRef:record.sourceUrl}]} as any;
    const input={repository,tenantId,detail,rawAssets:[]};
    assert.equal(await resolveSocialProductionReferenceVideoPath(input),localPath);
    assert.equal(await resolveSocialProductionReferenceVideoPath({...input,detail:{...detail,sources:[{...detail.sources[0],sourceRef:'https://example.test/other'}]}}),null);
    assert.equal(await resolveSocialProductionReferenceVideoPath({...input,repository:{dataStore:{getById:async()=>({...record,tenantId:'other'})}} as any}),null);
    assert.equal(await resolveSocialProductionReferenceVideoPath({...input,repository:{dataStore:{getById:async()=>({...record,videoFileId:'tenants/other/reference-videos/reference1.mp4'})}} as any}),null);
    await writeFile(localPath,Buffer.from('modified reference bytes'));
    assert.equal(await resolveSocialProductionReferenceVideoPath(input),null);
  }finally{
    if(previous===undefined)delete process.env.SOCIAL_CONTENT_MEDIA_ROOT;
    else process.env.SOCIAL_CONTENT_MEDIA_ROOT=previous;
    await rm(root,{recursive:true,force:true});
  }
});
