import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
test('removed footer workflows are task-scoped drawers, not lost navigation destinations',()=>{
 const source=readFileSync(new URL('./ConnectedAgentCalendar.tsx',import.meta.url),'utf8');
 assert.match(source,/import \{Drawer\} from 'antd'/);
 assert.match(source,/auxiliaryPanel\.selection===currentSelection\.current&&auxiliaryPanel\.token===getToken\(\)/);
 assert.match(source,/observer\.disconnect\(\)/);
 for(const kind of ['material','sales','sendRecovery','customerException','publicationRecovery','nativeRecovery','crossWeek','inventory','supplement']){
  assert.ok(source.includes(`auxiliaryPanel?.kind==='${kind}'`)||source.includes(`auxiliaryPanel.kind==='${kind}'`),kind);
 }
 const calendar=source.lastIndexOf('<WeeklyCustomerCalendar ');
 assert.ok(calendar>0);
 for(const panel of ['WeeklyMaterialRequestsPanel','AgentOperatingControls','WeeklySalesHandoffPanel','WeeklySupplementRequestsPanel'])assert.ok(source.lastIndexOf('<'+panel+' ')<calendar,panel+' must not render below the calendar');
 assert.doesNotMatch(source,/fixed inset-0 z-\[240\]/,'task drawers use shared Ant focus and escape handling');
 for(const line of source.split('\n').filter(line=>/currentSelection\.current\s*=\s*JSON\.stringify|expected=JSON\.stringify|let operationIdentity=JSON\.stringify/.test(line)))assert.match(line,/JSON\.stringify\(\[authIdentity,/,'revision and material binding must use the same authenticated selection as the calendar');
});
