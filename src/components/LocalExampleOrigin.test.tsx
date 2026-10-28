import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLocalExampleAd, isLocalExampleCustomer } from '../lib/localExampleOrigin';
import { createForeignTradeMockAdTasks } from '../mocks/foreignTradeOperations';
import { createForeignTradeMockCustomers } from '../mocks/foreignTradeCustomerProfiles';
import { AdAccountDirectoryContext, type DirectoryContext } from '../lib/adAccountDirectoryContext';
registerHooks({ load(url,context,next) { return url.endsWith('.css') ? {format:'module',source:'export {};',shortCircuit:true} : next(url,context); } });
const {default: AdPlanManagement} = await import('./AdPlanManagement');
const {CompactCustomerList} = await import('./customers/ConversionCustomerList');
const directory: DirectoryContext = { items:[],loading:false,error:'',warnings:[],adId:'',select(){},refresh(){},openCreative(){} };
const noop = () => undefined;

test('only reserved local namespaces are labeled; real provider records remain ordinary records', () => {
  assert.ok(isLocalExampleAd('mock-ft-ad-test')); assert.ok(isLocalExampleCustomer('mock-export-buyer-test'));
  for(const id of ['provider-ad-1','customer-1','mock-lookalike','customer-mock-export-name']) { assert.equal(isLocalExampleAd(id),false);assert.equal(isLocalExampleCustomer(id),false); }
});
test('advertising examples have a row badge and a concise report exclusion note, with source records untouched', () => {
  const task = createForeignTradeMockAdTasks()[0]; const snapshot = JSON.stringify(task);
  const render = (id: string) => renderToStaticMarkup(<AdAccountDirectoryContext.Provider value={directory}><AdPlanManagement tasks={[{...task,id}]} loading={false} previewMode onOpen={noop} onUpdate={noop} onAI={noop}/></AdAccountDirectoryContext.Provider>);
  const example = render(task.id); assert.match(example,/本地示例/); assert.match(example,/示例不计入经营报告/);
  const real = render('provider-real-plan'); assert.doesNotMatch(real,/本地示例|示例不计入经营报告/);
  assert.equal(JSON.stringify(task),snapshot);
});
test('customer examples are clearly labeled within the actual customer list and do not create inquiry records', () => {
  const customer = {...createForeignTradeMockCustomers()[0],stage:'inquiry' as const}; const snapshot = JSON.stringify(customer);
  const render = (id: string) => renderToStaticMarkup(<CompactCustomerList view="leads" selectedId={id} customers={[{...customer,id}]} onOpen={noop} onViewChange={noop} onVisibleSelectionChange={noop}/>);
  const example = render(customer.id); assert.match(example,/本地示例/); assert.match(example,/示例不计入经营报告/);
  const real = render('provider-real-customer'); assert.doesNotMatch(real,/本地示例|示例不计入经营报告/);
  assert.equal(JSON.stringify(customer),snapshot);
});
