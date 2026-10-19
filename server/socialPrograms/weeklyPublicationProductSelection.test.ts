import assert from 'node:assert/strict';
import test from 'node:test';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import type {BusinessContentGoal} from '../../shared/contracts/socialOperatingDecision.js';
import type {SocialWeeklyPublicationTask} from '../../shared/contracts/socialProgram.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {readWeeklyPublicationProductSelection,requireWeeklyPublicationProductSelection,WEEKLY_PUBLICATION_PRODUCT_SELECTIONS,weeklyPublicationProductSelectionId,weeklyPublicationProductSubjectHash} from './weeklyPublicationProductSelection.js';

const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7};
const publication={publicationTaskId:'publication',motherContentId:'mother',adaptationOfPublicationTaskId:null,platform:'tiktok',accountId:'account',accountPositioning:null,businessProposition:null,cta:null,factRefs:[{type:'enterprise_fact',id:'enterprise-snapshot',version:24}],metricTargets:[],publishWindow:null,status:'planned'} as SocialWeeklyPublicationTask;
const goal=(products:string[])=>({goalId:'goal',programId:'program',version:1,status:'ready',products,markets:[],audiences:[],languages:[],publicFactRefs:publication.factRefs,prohibitedClaims:[],weeklyBudgetCny:10,blockers:[],inputRefs:[],conversionRouteIds:[],accountBoundaries:[],evidence:[]} as unknown as BusinessContentGoal);
function memory(rows:Record_[]=[]){let writes=0;const store:DataStore={
  async getById<T>(){return null as T|null;},
  async list<T>(collection:string,query:ListQuery={}){const found=collection===WEEKLY_PUBLICATION_PRODUCT_SELECTIONS?rows.filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value)):[];return {items:found as T[],totalItems:found.length,totalPages:1,page:1,perPage:query.perPage??30};},
  async create<T>(){writes++;return null as T|null;},async update(){writes++;return false;},async delete(){writes++;return false;},
 };return{store,writes:()=>writes};}

test('neither a 21-product catalogue nor a single-product goal is a publication selection',async()=>{
  const f=memory();
  for(const products of [['first product','selected discovery product',...Array.from({length:19},(_,i)=>`product-${i}`)],['only product']]){
    assert.equal(await readWeeklyPublicationProductSelection({...scope,store:f.store,publication,goal:goal(products)}),null);
    await assert.rejects(requireWeeklyPublicationProductSelection({...scope,store:f.store,publication,goal:goal(products)}),/weekly_production_product_selection_required/);
  }
  assert.equal(f.writes(),0);
});

test('a forged or ambiguous publication receipt cannot select a product',async()=>{
  const productScope={...scope,publicationTaskId:publication.publicationTaskId};
  const payload={schemaVersion:'weekly-publication-product-selection.v1',...productScope,publicationHash:weeklyPublicationProductSubjectHash(publication),productId:'catalogue-id',productName:'only product',productSku:null,motherContentId:'mother',groupPublicationTaskIds:['publication'],enterpriseFactRef:publication.factRefs[0],enterpriseFactContentHash:'a'.repeat(64),selectedBy:'owner',selectedAt:'2026-10-18T00:00:00.000Z',issuerOperationId:'issueoperation1',authorizesPublishing:false,authorizesCustomerMessages:false};
  const id=weeklyPublicationProductSelectionId(productScope);
  const forged={id,...{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,publication_task_id:publication.publicationTaskId},payload:{...payload,publicationHash:'wrong'},content_hash:socialRequestHash(payload)};
  const f=memory([forged]);
  await assert.rejects(readWeeklyPublicationProductSelection({...scope,store:f.store,publication,goal:goal(['only product'])}),/weekly_product_selection_invalid/);
  const ambiguous=memory([forged,{...forged,id:'other'}]);
  await assert.rejects(readWeeklyPublicationProductSelection({...scope,store:ambiguous.store,publication,goal:goal(['only product'])}),/weekly_product_selection_ambiguous/);
  assert.equal(f.writes()+ambiguous.writes(),0);
  const selfHashed=memory([{...forged,payload,content_hash:socialRequestHash(payload)}]);
  await assert.rejects(readWeeklyPublicationProductSelection({...scope,store:selfHashed.store,publication,goal:goal(['only product'])}),/weekly_product_selection_issuer_unverified/);
  assert.equal(selfHashed.writes(),0);
});

test('publication status transition alone does not invalidate the selection subject',()=>{
  assert.equal(weeklyPublicationProductSubjectHash(publication),weeklyPublicationProductSubjectHash({...publication,status:'ready'}));
  assert.notEqual(weeklyPublicationProductSubjectHash(publication),weeklyPublicationProductSubjectHash({...publication,accountId:'other-account'}));
});
