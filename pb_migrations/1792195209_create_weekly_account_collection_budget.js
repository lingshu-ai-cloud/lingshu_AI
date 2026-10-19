/// <reference path="../pb_data/types.d.ts" />
migrate(app=>{
  for(const [name,fields,index] of [
    ['social_weekly_account_collection_budget_authorizations',['tenant_id','program_id','package_id','scope_id','status','record_hash'],'CREATE UNIQUE INDEX idx_weekly_account_collection_budget_scope ON social_weekly_account_collection_budget_authorizations (tenant_id, program_id, package_id, package_version)'],
    ['social_weekly_account_collection_budget_revocations',['tenant_id','authorization_id','record_hash'],'CREATE UNIQUE INDEX idx_weekly_account_collection_budget_revocation ON social_weekly_account_collection_budget_revocations (tenant_id, authorization_id)'],
  ])app.save(new Collection({name,type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}'},...fields.map(field=>({name:field,type:'text',required:true})),...(name==='social_weekly_account_collection_budget_authorizations'?[{name:'package_version',type:'number',required:true}]:[]),{name:'payload',type:'json',required:true}],indexes:[index]}));
},app=>{
  app.delete(app.findCollectionByNameOrId('social_weekly_account_collection_budget_revocations'));
  app.delete(app.findCollectionByNameOrId('social_weekly_account_collection_budget_authorizations'));
});
