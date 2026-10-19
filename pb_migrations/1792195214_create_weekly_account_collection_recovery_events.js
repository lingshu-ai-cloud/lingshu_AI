/// <reference path="../pb_data/types.d.ts" />
// Server-only append-only observations; original prepaid job and operation stay immutable.
migrate(app => {
  app.save(new Collection({
    name: 'social_weekly_account_collection_recovery_events', type: 'base', system: false,
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      {name:'id',type:'text',system:true,required:true,primaryKey:true,autogeneratePattern:'[a-z0-9]{15}',min:15,max:15,pattern:'^[a-z0-9]+$'},
      {name:'tenant_id',type:'text',required:true},
      {name:'program_id',type:'text',required:true},
      {name:'package_id',type:'text',required:true},
      {name:'package_version',type:'number',required:true,onlyInt:true,min:1},
      {name:'task_id',type:'text',required:true},
      {name:'job_id',type:'text',required:true},
      {name:'job_record_hash',type:'text',required:true},
      {name:'operation_identity',type:'text',required:true},
      {name:'request_hash',type:'text',required:true},
      {name:'state',type:'text',required:true},
      {name:'record_hash',type:'text',required:true},
      {name:'payload',type:'json',required:true,maxSize:1048576},
    ],
    indexes:['CREATE INDEX idx_weekly_account_recovery_job ON social_weekly_account_collection_recovery_events (tenant_id,job_id,job_record_hash)'],
  }));
}, app => app.delete(app.findCollectionByNameOrId('social_weekly_account_collection_recovery_events')));
