/// <reference path="../pb_data/types.d.ts" />
// Private documentary audit only. These rows never confer production,
// publication or customer-message authority.
const scopeFields = [
  ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(name=>({name,type:'text',required:true})),
  {name:'package_version',type:'number',required:true,onlyInt:true,min:1},
  {name:'payload',type:'json',required:true,maxSize:1048576},
];
const collection = (name,extra,indexes) => new Collection({
  name,type:'base',system:false,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
  fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},...scopeFields,...extra],
  indexes,
});
migrate(app=>{
  app.save(collection('social_weekly_sample_policy_review_operations',
    [{name:'candidate_id',type:'text',required:true}],
    ['CREATE INDEX idx_weekly_sample_review_operation_scope ON social_weekly_sample_policy_review_operations (tenant_id,program_id,package_id,package_version,publication_task_id,candidate_id)']));
  app.save(collection('social_weekly_sample_policy_review_decisions',
    [{name:'candidate_id',type:'text',required:true},{name:'operation_id',type:'text',required:true}],
    ['CREATE UNIQUE INDEX idx_weekly_sample_review_decision_operation ON social_weekly_sample_policy_review_decisions (operation_id)',
     'CREATE INDEX idx_weekly_sample_review_decision_scope ON social_weekly_sample_policy_review_decisions (tenant_id,program_id,package_id,package_version,publication_task_id,candidate_id)']));
  app.save(collection('social_weekly_sample_policy_review_revocations',
    [{name:'decision_id',type:'text',required:true}],
    ['CREATE UNIQUE INDEX idx_weekly_sample_review_revocation_decision ON social_weekly_sample_policy_review_revocations (decision_id)',
     'CREATE INDEX idx_weekly_sample_review_revocation_scope ON social_weekly_sample_policy_review_revocations (tenant_id,program_id,package_id,package_version,publication_task_id)']));
},app=>{
  app.delete(app.findCollectionByNameOrId('social_weekly_sample_policy_review_revocations'));
  app.delete(app.findCollectionByNameOrId('social_weekly_sample_policy_review_decisions'));
  app.delete(app.findCollectionByNameOrId('social_weekly_sample_policy_review_operations'));
});
