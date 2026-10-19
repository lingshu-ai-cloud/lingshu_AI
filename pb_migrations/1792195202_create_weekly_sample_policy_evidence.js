/// <reference path="../pb_data/types.d.ts" />
const baseFields = [
  ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(name => ({name,type:'text',required:true})),
  {name:'package_version',type:'number',required:true,onlyInt:true,min:1},
  {name:'payload',type:'json',required:true,maxSize:1048576},
];
const collection = (name, extraFields, indexes) => new Collection({
  name,type:'base',system:false,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
  fields:[
    {name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},
    ...baseFields,...extraFields,
  ],indexes,
});
migrate(app => {
  app.save(collection('social_weekly_sample_policy_candidates',[],[]));
},app => {
  app.delete(app.findCollectionByNameOrId('social_weekly_sample_policy_candidates'));
});
