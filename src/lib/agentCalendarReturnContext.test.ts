import assert from 'node:assert/strict';
import test from 'node:test';
import {captureAgentCalendarReturnContext,readAgentCalendarReturnContext,registerAgentCalendarReturnState,restoreAgentCalendarReturnContext} from './agentCalendarReturnContext';

test('history Back restores the original package, filters, view, nested scroll and card identity', () => {
  const globals = globalThis as unknown as Record<string,unknown>;
  const originals = {window:globals.window,document:globals.document,HTMLElement:globals.HTMLElement};
  class Node {
    children: Node[]=[];
    parentElement: Node|null=null;
    scrollLeft=0;
    scrollTop=0;
    closest() { return null; }
    dataset={agentCalendarPositionKey:'program:original-week:3'};
    getClientRects(){return calendarReady ? [{}] : [];}
  }
  let calendarReady=false;
  const body=new Node(), panel=new Node();
  body.children=[panel];panel.parentElement=body;panel.scrollLeft=180;panel.scrollTop=640;
  const frames:Array<()=>void>=[];
  let state:Record<string,unknown>={page:'digital-employee',detail:{programId:'program'}};
  let windowPosition=[10,1200];
  globals.HTMLElement=Node;
  globals.document={body,querySelectorAll:()=>[panel]};
  globals.window={history:{get state(){return state;},replaceState(next:Record<string,unknown>){state=next;}},scrollX:10,scrollY:1200,
    requestAnimationFrame(callback:()=>void){frames.push(callback);},scrollTo(left:number,top:number){windowPosition=[left,top];}};
  let selection={packageId:'original-week',packageVersion:3,agentFilter:'human',statusFilter:'blocked',view:'calendar'};
  let dispose=registerAgentCalendarReturnState('weekly-panel',{read:()=>({...selection}),restore:value=>{selection=value as typeof selection;}});
  try {
    const calendar={positionKey:'program:original-week:3',offset:-2,cardId:'production-task-42'};
    captureAgentCalendarReturnContext(calendar);
    const sourceEntry=state;
    const saved=readAgentCalendarReturnContext();
    assert(saved);
    assert.deepEqual(saved.calendar,calendar);
    assert.equal(state.page,'digital-employee');
    assert.deepEqual(state.detail,{programId:'program'});
    // Visiting another production page and unmounting the original panel.
    dispose();state={page:'content-production'};
    selection={packageId:'different-week',packageVersion:8,agentFilter:'all',statusFilter:'all',view:'list'};
    panel.scrollLeft=0;panel.scrollTop=0;windowPosition=[0,0];
    // Back restores its own history snapshot, including a newly mounted provider.
    state=sourceEntry;
    dispose=registerAgentCalendarReturnState('weekly-panel',{read:()=>({...selection}),restore:value=>{selection=value as typeof selection;}});
    restoreAgentCalendarReturnContext();
    frames.shift()!();frames.shift()!();
    assert.deepEqual([panel.scrollLeft,panel.scrollTop],[0,0],'wait for the original calendar to load');
    assert.equal(frames.length,1);
    calendarReady=true;
    while(frames.length)frames.shift()!();
    assert.deepEqual(selection,{packageId:'original-week',packageVersion:3,agentFilter:'human',statusFilter:'blocked',view:'calendar'});
    assert.deepEqual([panel.scrollLeft,panel.scrollTop],[180,640]);
    assert.deepEqual(windowPosition,[10,1200]);
    assert.deepEqual(readAgentCalendarReturnContext()?.calendar,calendar);
    restoreAgentCalendarReturnContext(saved);
    state={page:'different-history-entry'};
    panel.scrollTop=25;windowPosition=[1,2];
    while(frames.length)frames.shift()!();
    assert.equal(panel.scrollTop,25,'a later history entry cancels pending scroll restoration');
    assert.deepEqual(windowPosition,[1,2]);
  } finally {
    dispose();
    for(const [key,value] of Object.entries(originals)){
      if(value===undefined)delete globals[key];else globals[key]=value;
    }
  }
});
