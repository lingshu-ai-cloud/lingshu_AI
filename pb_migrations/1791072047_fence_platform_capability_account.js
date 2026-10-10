/// <reference path="../pb_data/types.d.ts" />
// Forward-only credential/native identity fence. Existing unfenced probes remain unknown for G6.
migrate(app=>{const c=app.findCollectionByNameOrId('social_platform_capability_evidence');c.fields.add(new Field({name:'account_identity_hash',type:'text'}));app.save(c);},app=>{const c=app.findCollectionByNameOrId('social_platform_capability_evidence');const f=c.fields.getByName('account_identity_hash');if(f)c.fields.removeById(f.id);app.save(c);});
