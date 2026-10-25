import { creationAdmissionMessage } from './creationAdmissionMessage';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { contentProgressNodes, type ContentProgressNodeState } from './contentProductionExperience';

export interface CreationProductionNode {id:string;label:string;owner:string;state:ContentProgressNodeState;result:string}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const stages:Array<[string,string,string,string]>=[
  ['submitted','创作任务确认','经营 Agent','记录对标、产品、内容方向与预计发布时间'],
  ['dispatch','执行调度','调度服务','等待领取这条创作任务'],
  ['script','口播与脚本定稿','编导 Agent','根据对标结构与产品事实确定口播内容'],
  ['storyboard','逐镜拆解','编导 Agent','拆解镜头、画面要求、时长与口播对应关系'],
  ['materials','匹配产品与现有素材','内容 Agent','为各镜头匹配产品图、视频和可用素材'],
  ['visuals','生成与制作镜头素材','内容 Agent','按各镜头路线补齐需要生成或加工的画面'],
  ['voice','配音制作','内容 Agent','生成或处理口播音轨'],
  ['captions','字幕与音画对齐','内容 Agent','按口播时间轴对齐字幕和镜头'],
  ['edit','剪辑与成片合成','内容 Agent','组合画面、配音、字幕与背景音乐'],
  ['quality','成片质检','质检与编导 Agent','检查画面、声音、字幕及产品表达'],
  ['acceptance','成片验收','用户','有需要确认的成片时，在此展示验收项'],
  ['export','成片导出与交付','内容 Agent','整理通过验收的内容和交付文件'],
];
/** Display the existing pipeline before dispatch; completion requires persisted evidence. */
export function creationProductionNodes(task:SocialContentTaskDetail):CreationProductionNode[] {
  const nodes=stages.map(([id,label,owner,result])=>({id,label,owner,result,state:'pending' as ContentProgressNodeState}));
  const set=(id:string,state:ContentProgressNodeState,result?:string)=>{const node=nodes.find(item=>item.id===id)!;node.state=state;if(result)node.result=result;};
  set('submitted','complete','创作需求已保存');
  if(!task.runId){
    const admission=task.executionAdmission;
    if(admission?.state==='blocked')set('dispatch','blocked',creationAdmissionMessage(admission.reason));
    if(admission?.state==='preparing')set('dispatch','active','等待参考分析与后台恢复调度');
    if(admission?.state==='queued')set('dispatch','active','已有持久化入队回执，等待执行领取');
    if(['cancelled','cancelling'].includes(task.status))set('dispatch','blocked','任务已取消，后续节点不再执行');return nodes;}
  set('dispatch','complete','已关联原生产运行');
  const coarse=contentProgressNodes(task),workflow=task.agentWorkflow;
  if(task.directorPlan?.status==='ready'){
    set('script','complete','原任务的口播与脚本方案已保存');
    set('storyboard','complete',`已保存 ${task.directorPlan.sceneCount} 个镜头的分解方案`);
  }
  const current=({编导方案:'script',口播校准:'script',素材匹配:'materials',内容制作:'visuals',剪辑合成:'edit',成片质检:'quality',复刻评估:'quality',编导复核:'quality',等待审核:'acceptance'} as Record<string,string>)[task.productionProgress?.step||''];
  if(current)set(current,'active',task.productionProgress?.activity);
  if(task.productionProgress?.waitingForScheduledAssets)set('materials','blocked','等待对应素材核验与资产任务领取');
  const sceneResults=workflow?.productionResult?.sceneResults||[];
  const readyScenes=sceneResults.filter(scene=>Boolean(scene.mediaArtifact?.resourceRef)).length;
  const totalScenes=workflow?.executionPlan.scenes.length||task.directorPlan?.sceneCount||sceneResults.length;
  if(readyScenes){const state=readyScenes>=totalScenes?'complete':'active';set('materials',state,`${readyScenes}/${totalScenes} 个镜头已取得实际素材`);set('visuals',state,`${readyScenes}/${totalScenes} 个镜头已有画面产物`);}
  const artifacts=task.artifacts.filter(artifact=>artifact.status!=='superseded'&&artifact.kind==='short_video');
  const artifact=[...artifacts].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0];
  const content=object(artifact?.content),narration=object(content.narration),media=object(content.mediaStorage);
  if(Number(narration.duration)>0&&narration.source&&narration.source!=='unknown')set('voice','complete','已有实际配音及音轨时长回执');
  if(Number(narration.cueCount)>0)set('captions','complete',`已生成 ${narration.cueCount} 条字幕时间轴`);
  if(artifact?.resourceRef&&object(media.video).fileId)set('edit','complete','成片视频文件已合成并归档');
  const quality=coarse.find(node=>node.id==='quality');
  if(quality&&['failed','blocked'].includes(quality.state))set('quality',quality.state,quality.result);
  else if(workflow?.productionResult?.technicalReview.approved&&workflow.productionResult.creativeReview.approved)set('quality','complete','实际成片的技术与编导检查通过');
  if(artifacts.some(item=>item.status==='review_required'))set('acceptance','active','已有成片候选，等待验收或提出修改');
  if(artifacts.length&&artifacts.every(item=>item.status==='approved'))set('acceptance','complete','当前成片已确认');
  if(artifact&&task.deliveryPackages.some(item=>['ready','confirmed'].includes(item.status)&&item.downloadHref&&item.artifactIds.includes(artifact.artifactId)))set('export','complete','当前成片的交付包已准备好，可在下方下载');
  return nodes;
}
