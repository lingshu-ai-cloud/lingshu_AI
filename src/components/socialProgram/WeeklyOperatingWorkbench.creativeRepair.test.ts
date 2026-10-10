import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./WeeklyOperatingWorkbench.tsx',import.meta.url),'utf8');

test('creative repair card exposes the real server workflow without fabricating completion',()=>{
  for(const call of ['configureCreativeRepair','previewCreativeRepairCapacity','confirmCreativeRepairCapacity','startCreativeRepair','reconcileCreativeRepair','auditCreativeRepair']){
    assert.match(source,new RegExp(`socialProgramApi\\.${call}\\(`),`${call} must be wired to the card`);
  }
  assert.match(source,/item\.state==='awaiting_configuration'/);
  assert.match(source,/item\.state==='awaiting_capacity'/);
  assert.match(source,/item\.state==='ready'/);
  assert.match(source,/item\.state==='running'/);
  assert.match(source,/item\.state==='awaiting_audit'/);
  assert.doesNotMatch(source,/state\s*:\s*['"]resolved['"]/, 'the UI must not manufacture a resolved case');
});

test('creative repair mutations are scoped to the loaded package generation and explicit evidence',()=>{
  assert.match(source,/expectedCaseHash:item\.recordHash/);
  assert.match(source,/expectedConfigurationHash:preview\.configurationHash/);
  assert.match(source,/expectedPreviewHash:preview\.previewHash/);
  assert.match(source,/expectedAuthorityHash:preview\.authorityHash/);
  assert.match(source,/packageIdentityRef\.current!==identity/);
  assert.match(source,/creativePreviewExpired/);
  assert.match(source,/旧预览已过期，不能用于费用确认/);
  assert.match(source,/不会把未知结果当成成功/);
});
