/// <reference path="../pb_data/types.d.ts" />
migrate(app => {
  app.save(new Collection({name:'customer_classifications',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},...['tenant_id','customer_id'].map(name=>({name,type:'text',required:true})),{name:'payload',type:'json',required:true,maxSize:524288}]}));
  app.save(new Collection({name:'customer_reply_requests',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
    fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},
      ...['tenant_id','actor_user_id','request_id','input_hash','status'].map(name=>({name,type:'text',required:true})),
      {name:'payload',type:'json',required:true,maxSize:1048576}],
    indexes:['CREATE UNIQUE INDEX idx_customer_reply_request_identity ON customer_reply_requests (tenant_id,actor_user_id,request_id)']}));
},app=>{app.delete(app.findCollectionByNameOrId('customer_reply_requests'));app.delete(app.findCollectionByNameOrId('customer_classifications'));});
