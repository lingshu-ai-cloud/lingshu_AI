/// <reference path="../pb_data/types.d.ts" />
// Private signed evidence. Tenants cannot write or delete approval/revocation rows.
const collection = (name, extra, indexes) => new Collection({
  name, type:'base', system:false, listRule:null, viewRule:null,
  createRule:null, updateRule:null, deleteRule:null,
  fields:[
    {name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},
    ...['tenant_id','material_id','content_hash'].map(name=>({name,type:'text',required:true})),
    ...extra,
    {name:'payload',type:'json',required:true,maxSize:1048576},
  ], indexes,
});
migrate(app=>{
  app.save(collection('social_product_footage_reviews',
    [{name:'product_id',type:'text',required:true}],
    ['CREATE INDEX idx_product_footage_review_scope ON social_product_footage_reviews (tenant_id,material_id)',
     'CREATE INDEX idx_product_footage_review_product ON social_product_footage_reviews (tenant_id,product_id)']));
  app.save(collection('social_product_footage_revocations',
    [{name:'approval_id',type:'text',required:true}],
    ['CREATE UNIQUE INDEX idx_product_footage_revoke_approval ON social_product_footage_revocations (approval_id)',
     'CREATE INDEX idx_product_footage_revoke_scope ON social_product_footage_revocations (tenant_id,material_id)']));
},app=>{
  app.delete(app.findCollectionByNameOrId('social_product_footage_revocations'));
  app.delete(app.findCollectionByNameOrId('social_product_footage_reviews'));
});
