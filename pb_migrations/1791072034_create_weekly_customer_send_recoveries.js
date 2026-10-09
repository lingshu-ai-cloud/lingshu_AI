/// <reference path="../pb_data/types.d.ts" />
migrate(app => {
 app.save(new Collection({name:'social_weekly_customer_send_recoveries',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,
 fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},...['tenant_id','source_key','content_hash'].map(name=>({name,type:'text',required:true})),{name:'payload',type:'json',required:true,maxSize:1048576}],
 indexes:['CREATE UNIQUE INDEX idx_weekly_send_recovery_source ON social_weekly_customer_send_recoveries (tenant_id,source_key)']}));
},app=>{app.delete(app.findCollectionByNameOrId('social_weekly_customer_send_recoveries'));});
