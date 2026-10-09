import assert from 'node:assert/strict';
import test from 'node:test';
import type {WeeklyOperatingPackage} from '../../../shared/contracts/socialProgram';
import {materialEvidenceConfigurationChoices} from './MaterialEvidenceConfigurationPanel';
function pkg():WeeklyOperatingPackage{return {programId:'program',packageId:'package',version:3,agentPlanning:{directorAnalyses:[{slotId:'slot',materialEvidenceRequirements:{scope:{packageId:'package',packageVersion:3,slotId:'slot'},handoffRef:{inspirationId:'real',version:'2',recordHash:'hash'},source:{requiredEvidence:['产品细节画面'],likelyAssetNeeds:[]},items:[{requirementId:'actual-id',classification:'unknown',sourceField:'requiredEvidence',sourceIndex:0,description:'产品细节画面'}]}}]}} as unknown as WeeklyOperatingPackage;}
test('unknown configuration selection comes only from the actual same-version source item',()=> {
 const value=pkg();assert.equal(materialEvidenceConfigurationChoices(value)[0].configurable,true);assert.equal(materialEvidenceConfigurationChoices(value)[0].item.requirementId,'actual-id');
 value.agentPlanning!.directorAnalyses[0].materialEvidenceRequirements!.items[0].description='另一段非来源说明';assert.equal(materialEvidenceConfigurationChoices(value)[0].configurable,false);
});
test('missing source and previous-week classifications remain visible gaps instead of configurable fake requirements',()=> {
 const value=pkg(),contract=value.agentPlanning!.directorAnalyses[0].materialEvidenceRequirements!;
 contract.scope.packageVersion=2;assert.equal(materialEvidenceConfigurationChoices(value)[0].configurable,false);
 contract.scope.packageVersion=3;contract.handoffRef=null;assert.equal(materialEvidenceConfigurationChoices(value)[0].configurable,false);
 contract.items[0].classification='human_irreplaceable';assert.deepEqual(materialEvidenceConfigurationChoices(value),[],'already human requirements use actual material tasks, not unknown configuration');
});
