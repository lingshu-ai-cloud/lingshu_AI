/// <reference path="../pb_data/types.d.ts" />
// Explicit, per-week candidate semantic spending is independent of collection
// and publication budgets. Only server-side admin storage may write policies.
migrate(app=>{
  const id={name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'};
  const text=name=>({name,type:'text',required:true});
  app.save(new Collection({name:'social_weekly_candidate_semantic_budget_authorizations',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[id,...['tenant_id','program_id','package_id','status','record_hash'].map(text),{name:'package_version',type:'number',required:true},{name:'payload',type:'json',required:true,maxSize:1048576}],
    indexes:['CREATE UNIQUE INDEX idx_weekly_candidate_semantic_budget_scope ON social_weekly_candidate_semantic_budget_authorizations (tenant_id, program_id, package_id, package_version)']}));
  app.save(new Collection({name:'social_weekly_candidate_semantic_budget_revocations',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[id,...['tenant_id','authorization_id','record_hash'].map(text),{name:'payload',type:'json',required:true,maxSize:1048576}],
    indexes:['CREATE UNIQUE INDEX idx_weekly_candidate_semantic_budget_revoke ON social_weekly_candidate_semantic_budget_revocations (tenant_id, authorization_id)']}));
},app=>{
  for(const name of ['social_weekly_candidate_semantic_budget_revocations','social_weekly_candidate_semantic_budget_authorizations'])app.delete(app.findCollectionByNameOrId(name));
});
