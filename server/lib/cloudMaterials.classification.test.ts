import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudMaterialView,readCloudMaterialLibrary,type CloudMaterialRecord} from './cloudMaterials.js';
import {MATERIAL_SOURCE_CATEGORIES,MATERIAL_THEMES,materialSourceCategoryOf,materialThemeTagsOf,MATERIAL_THEME_LABELS} from '../../shared/materialTaxonomy.js';

test('cloud library read preserves stored classification and source instead of re-inferring labels',async()=>{
 const evidence=[{frameSha256:'a'.repeat(64),observation:'observed scene'},'human reviewed product footage'];
 const row:CloudMaterialRecord={id:'actual-stored-row',tenantId:'tenant',scope:'own',title:'factory product name must not override selected tag',sourceCategory:'official_import',sourceType:'ai-seedance',primaryTheme:'consumer_demo',themeTags:JSON.stringify(['consumer_demo','talking_head']),classificationStatus:'review_required',classificationSource:'user',classificationEvidence:JSON.stringify(evidence)};
 let requests=0;
 const result=await readCloudMaterialLibrary('tenant',async(path,options={})=>{requests++;assert.match(String(path),/^\/api\/collections\/materials\/records\?/);assert.equal(options.method,undefined);return Response.json({items:[row,{...row,id:'foreign',tenantId:'other'}],totalPages:1});});
 assert.equal(requests,1);assert.equal(result.source.state,'ready');assert.equal(result.items.length,1);
 const material=result.items[0]!;
 assert.equal(material.sourceCategory,row.sourceCategory);assert.equal(material.classificationStatus,'review_required');assert.equal(material.classificationSource,'user');assert.equal(material.primaryTheme,'consumer_demo');assert.deepEqual(material.themeTags,['consumer_demo','talking_head']);assert.deepEqual(material.classificationEvidence,evidence);
 assert.equal(materialSourceCategoryOf(material),'official_import');assert.deepEqual(materialThemeTagsOf(material),['consumer_demo','talking_head']);assert.equal(MATERIAL_THEME_LABELS.consumer_demo,'DtoC');
});

test('every existing theme and source survives projection without manufacturing completed status',()=>{
 for(const theme of MATERIAL_THEMES)for(const sourceCategory of MATERIAL_SOURCE_CATEGORIES){const row:CloudMaterialRecord={id:'record',sourceCategory,primaryTheme:theme,themeTags:[theme],classificationStatus:'pending',classificationSource:'model',classificationEvidence:['original observation']};const view=cloudMaterialView(row);assert.equal(view.primaryTheme,theme);assert.deepEqual(view.themeTags,[theme]);assert.equal(view.sourceCategory,sourceCategory);assert.equal(view.classificationStatus,'pending');}
 const missing=cloudMaterialView({id:'historic',title:'factory product'});assert.equal(missing.primaryTheme,undefined);assert.equal(missing.classificationStatus,undefined);assert.equal(missing.classificationSource,undefined);assert.equal(missing.sourceCategory,undefined);assert.deepEqual(missing.classificationEvidence,[]);
 const malformed=cloudMaterialView({id:'bad-json',themeTags:'{not an array}',classificationEvidence:'[broken'});assert.deepEqual(malformed.themeTags,[]);assert.deepEqual(malformed.classificationEvidence,[]);assert.equal(malformed.classificationStatus,undefined);
});
