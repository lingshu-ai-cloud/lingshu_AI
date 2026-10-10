import assert from 'node:assert/strict';
import test from 'node:test';
import React, {type ReactElement, type ReactNode} from 'react';
import Calendar, {type AgentCalendarTask} from './AgentWeeklyCalendar';

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children as ReactNode)];
}
// Exercise the actual component's rendered button handlers without a browser or
// production services. State setters rerender immediately, as flushSync does.
function mount(props: Parameters<typeof Calendar>[0]) {
  const internals = (React as unknown as {__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {H: unknown}}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const values: unknown[] = [];
  let cursor = 0;
  let tree: ReactNode;
  const render = () => {
    const previous = internals.H;
    cursor = 0;
    internals.H = {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], (next: unknown) => {
          values[index] = typeof next === 'function' ? next(values[index]) : next;
          render();
        }];
      },
      useEffect() {},
      useRef(value: unknown) { return {current:value}; },
      useMemo(factory: () => unknown) { return factory(); },
    };
    try { tree = Calendar(props); } finally { internals.H = previous; }
  };
  render();
  return {
    nodes: () => elements(tree),
    click(predicate: (element: Element) => boolean) {
      const button = elements(tree).find(predicate);
      assert(button, 'expected rendered button');
      (button.props.onClick as () => void)();
    },
  };
}
const base: AgentCalendarTask = {id:'task', date:'2026-10-06', time:'12:00', agent:'content', title:'真实任务', output:'交付', context:'原周包', minutes:10, status:'planned'};
const identity = {tenantId:'tenant', programId:'program', packageId:'package', packageVersion:2, taskId:'task'};
const cases: Array<{name:string; patch:Partial<AgentCalendarTask>; callback:string; demo?:boolean}> = [
  {name:'production',patch:{productionTaskId:'content-object'},callback:'onOpenProduction'},
  {name:'account binding',patch:{accountBindingTarget:{platform:'instagram',accountId:null,consumerIds:['consumer']}},callback:'onBindAccount'},
  {name:'customer execution',patch:{customerExecutionTarget:{} as AgentCalendarTask['customerExecutionTarget']},callback:'onOpenCustomerExecution'},
  {name:'supplement',patch:{supplementTarget:{} as AgentCalendarTask['supplementTarget']},callback:'onOpenSupplement'},
  {name:'template',patch:{templateTarget:{...identity,stepKind:'template_extraction'}},callback:'onOpenTemplate'},
  {name:'review',patch:{reviewTarget:{...identity,stepKind:'weekly_review'}},callback:'onOpenReview'},
  {name:'planning',patch:{planningTarget:{...identity,stepKind:'business_schedule'}},callback:'onOpenPlanning'},
  {name:'demo production',patch:{},callback:'onOpenProduction',demo:true},
];
for (const entry of cases) test(`${entry.name} dismisses details before opening its destination and does not reopen on remount`, () => {
  const task = {...base,...entry.patch};
  let calls = 0;
  let ui: ReturnType<typeof mount>;
  let closed = false;
  const props = {startsAt:'2026-10-05',tasks:[task],scopeKey:`navigation-${entry.name}`,demo:entry.demo,
    [entry.callback]: (opened: AgentCalendarTask) => {
      calls++;
      assert.equal(opened.id,task.id);
      assert.equal(closed,true,'destination must see the modal already dismissed');
    }};
  ui = mount(props);
  const calendar = ui.nodes().find(node => typeof node.props.renderDetails === 'function');
  assert(calendar, 'calendar provides actual task detail actions');
  const renderDetails = calendar.props.renderDetails as (event: unknown, close: () => void) => ReactNode;
  const details = renderDetails({data:task}, () => {closed=true;});
  const action = elements(details).find(node => node.type !== 'span' && typeof node.props.onClick === 'function');
  assert(action, 'task detail exposes its destination action');
  (action.props.onClick as () => void)();
  assert.equal(closed,true,'navigation dismisses the calendar detail');
  assert.equal(calls,1);
  const returned = mount(props);
  assert.equal(returned.nodes().some(node => node.props.role === 'dialog'),false);

});
