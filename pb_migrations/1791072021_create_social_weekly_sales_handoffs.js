/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
 const text=name=>({name,type:'text',required:true});
 const base=(name,fields,indexes)=>new Collection({name,type:'base',system:false,listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null,fields:[{name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},...fields],indexes});
 app.save(base('social_weekly_sales_handoffs',[text('tenant_id'),text('program_id'),text('source_key'),{name:'payload',type:'json',required:true}],['CREATE UNIQUE INDEX idx_weekly_sales_source ON social_weekly_sales_handoffs (tenant_id, source_key)']));
 app.save(base('social_weekly_sales_events',[text('tenant_id'),text('handoff_id'),text('operation_id'),text('input_hash'),text('actor_id'),text('occurred_at'),{name:'version',type:'number',required:true,onlyInt:true,min:2},{name:'payload',type:'json',required:true}],['CREATE UNIQUE INDEX idx_weekly_sales_event_version ON social_weekly_sales_events (tenant_id,handoff_id,version)','CREATE UNIQUE INDEX idx_weekly_sales_event_operation ON social_weekly_sales_events (tenant_id,handoff_id,operation_id)']));
},app=>{app.delete(app.findCollectionByNameOrId('social_weekly_sales_events'));app.delete(app.findCollectionByNameOrId('social_weekly_sales_handoffs'));});
