// Isolated test fixture. Never imported by the application or used as tenant evidence.
export function workspaceNavigationFixture({tenantId,taskId,runId,artifactId,projectId,sceneIds}:{tenantId:string;taskId:string;runId:string;artifactId:string;projectId:string;sceneIds:string[]}){
 const sceneMappings=sceneIds.map((sceneId,index)=>({sceneId,slotId:sceneId,mediaFileRef:`socialfile:file${index}`,mediaSha256:String(index+1).repeat(64)}));
 const binding={type:'social_production_workspace' as const,version:1 as const,tenantId,taskId,runId,artifactId,projectId,projectVersion:1 as const,specHash:'a'.repeat(64),baselineHash:'b'.repeat(64),artifactContentHash:'c'.repeat(64),recordHash:'d'.repeat(64),sceneMappings};
 const spec:Record<string,unknown>={socialContentTaskId:taskId,sourceWorkflowRunId:runId,automation:{managedBy:'social_content_output'},socialProductionWorkspace:binding,analysisResults:{storyboard:{slots:sceneIds.map((id,i)=>({id,sourceSceneId:id,time:`${i*2}s-${i*2+2}s`,start:i*2,end:i*2+2,title:id,detail:'真实快照脚本'}))}},shootingSlots:sceneIds.map(id=>({id,slotId:id})),storyboardAssignments:Object.fromEntries(sceneIds.map((id,i)=>[id,`file${i}`])),materialSnapshots:sceneIds.map((id,i)=>({id:`file${i}`,contentHash:sceneMappings[i].mediaSha256,taskId,tenantId,sourceType:'social-production-output'}))};
 return {binding,project:{id:projectId,spec}};
}
