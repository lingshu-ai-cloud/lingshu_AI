/// <reference path="../pb_data/types.d.ts" />
const scopeFields=[
  ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(name=>({name,type:'text',required:true})),
  {name:'package_version',type:'number',required:true,onlyInt:true,min:1},
  {name:'payload',type:'json',required:true,maxSize:1048576},
];
const base=(name,index)=>new Collection({
  name,type:'base',system:false,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
  fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},...scopeFields],
  indexes:[`CREATE UNIQUE INDEX ${index} ON ${name} (tenant_id,program_id,package_id,package_version,publication_task_id)`],
});
migrate(app=>{
  app.save(base('social_weekly_publication_product_selection_issuances','idx_weekly_product_issuance_scope'));
  app.save(base('social_weekly_publication_product_selections','idx_weekly_product_selection_scope'));
},app=>{
  app.delete(app.findCollectionByNameOrId('social_weekly_publication_product_selections'));
  app.delete(app.findCollectionByNameOrId('social_weekly_publication_product_selection_issuances'));
});
