/// <reference path="../pb_data/types.d.ts" />
// Full semantic operation/assessment hashes are business keys, never PocketBase
// record ids (which are exactly 15 lowercase alphanumeric characters).
migrate(app => {
  const id = {name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'};
  const text = name => ({name,type:'text',required:true});
  const make = (name,fields,index) => app.save(new Collection({
    name,type:'base',system:false,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[id,...fields.map(text),{name:'payload',type:'json',required:true,maxSize:1048576}],indexes:[index]
  }));
  make('social_candidate_semantic_operations',['tenant_id','candidate_id','operation_id','record_hash'],
    'CREATE UNIQUE INDEX idx_candidate_semantic_operation_key ON social_candidate_semantic_operations (operation_id)');
  make('social_candidate_semantic_provider_receipts',['tenant_id','operation_id','record_hash'],
    'CREATE UNIQUE INDEX idx_candidate_semantic_receipt_key ON social_candidate_semantic_provider_receipts (operation_id)');
  make('social_candidate_semantic_assessments',['tenant_id','candidate_id','context_id','assessment_id','record_hash'],
    'CREATE UNIQUE INDEX idx_candidate_semantic_assessment_key ON social_candidate_semantic_assessments (assessment_id)');
}, app => {
  for(const name of ['social_candidate_semantic_assessments','social_candidate_semantic_provider_receipts','social_candidate_semantic_operations']) app.delete(app.findCollectionByNameOrId(name));
});
