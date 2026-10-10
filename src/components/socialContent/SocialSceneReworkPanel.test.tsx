import React from 'react';import {test} from 'node:test';import assert from 'node:assert/strict';import {renderToStaticMarkup} from 'react-dom/server';import {SocialSceneReworkPanel,SceneReworkFailureReasons} from './SocialSceneReworkPanel';import type {SocialContentTaskDetail} from '../../../shared/contracts/socialContentWorkflow';
test('no parent cache means no paid submission or assumed approval',()=>{const task={taskId:'task',runId:'run',artifacts:[{taskId:'task',artifactId:'a',kind:'short_video',origin:'agent',platform:'tiktok',version:'v1',status:'review_required'},{taskId:'other',artifactId:'b',kind:'short_video',origin:'agent',version:'v1',status:'approved'}]} as unknown as SocialContentTaskDetail;const html=renderToStaticMarkup(<SocialSceneReworkPanel task={task}/>);assert.match(html,/读取逐镜核验凭据/);assert.match(html,/disabled/);assert.doesNotMatch(html,/value="b"/);assert.doesNotMatch(html,/创建并开始返工作业/);assert.match(html,/先核验真实路线并生成报价/);assert.doesNotMatch(html,/自动批准/);});

test('scene failure reasons show actual failed checks with escaped text and explicit evidence gaps',()=>{
 const scene={sceneId:'real-scene',shotId:'shot',referenceShotId:null,sourceTiming:null,status:'failed' as const,technicalReceiptId:'receipt',checks:[{code:'visual',passed:false,message:'真实画面不符 <script>unsafe</script>'},{code:'timing',passed:true,message:'通过时长'}]};
 const html=renderToStaticMarkup(<SceneReworkFailureReasons scene={scene}/>);
 assert.match(html,/真实画面不符 &lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(html,/通过时长/);
 assert.match(renderToStaticMarkup(<SceneReworkFailureReasons scene={{...scene,checks:undefined}}/>),/缺少真实逐镜核验明细/);
 assert.match(renderToStaticMarkup(<SceneReworkFailureReasons scene={{...scene,checks:[scene.checks[1]]}}/>),/核验明细未包含失败原因/);
 assert.equal(renderToStaticMarkup(<SceneReworkFailureReasons scene={{...scene,status:'passed'}}/>),'');
});
