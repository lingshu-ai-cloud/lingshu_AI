import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Panel from './StudioOperationalEvidencePanel';
const contract = { tenantId:'tenant',taskId:'task',taskVersion:65,runId:'run',jobId:'job',planHash:'plan',inputHash:'input',scriptVersion:'0003' };
test('same-scope retained receipts display rejection and unknown actual costs without approving final handoff', () => {
 const html=renderToStaticMarkup(<Panel contract={{...contract,operationalEvidence:{schemaVersion:'social-studio-operational.v1',...contract,budget:{poolAuthorizedCny:14.3,retainedReservedCny:12.9,actualCostCny:null},providerOperations:[{shotId:'S04',operationId:'current:repair-1',providerTaskId:'vendor-original',providerStatus:'completed_rejected',qualityStatus:'failed',adoptionStatus:'rejected',receiptRef:'real-receipt',reservedCostCny:4,actualCostCny:null}],audio:[{role:'body',durationSeconds:13.844917,receiptRef:'speech-receipt'}]}}}/>);
 assert.match(html,/completed_rejected/);assert.match(html,/返工尝试/);assert.match(html,/已分配预算池额度/);assert.match(html,/质检拒绝/);assert.match(html,/拒绝采用/);assert.match(html,/failed/);assert.match(html,/实际费用 待核账/);assert.match(html,/实际 待核账/);assert.match(html,/整片尚未完成/);assert.match(html,/真人批准/);assert.match(html,/speech-receipt/);assert.doesNotMatch(html,/实际 ¥0\.00/);
});
test('wrong tenant or version evidence is withheld rather than represented as current execution', () => {
 for(const patch of [{tenantId:'other'},{taskVersion:61}]){const html=renderToStaticMarkup(<Panel contract={{...contract,operationalEvidence:{schemaVersion:'social-studio-operational.v1',...contract,...patch,providerOperations:[{receiptRef:'wrong-evidence'}]}}}/>);assert.doesNotMatch(html,/wrong-evidence/);assert.match(html,/来源待接入/);}
});
