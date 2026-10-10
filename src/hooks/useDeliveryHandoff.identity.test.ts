import test from 'node:test';
import assert from 'node:assert/strict';
import {readDeliveryHandoff} from './useDeliveryHandoff';
import {productionNavigationIdentity} from '../lib/productionNavigation';

test('all customer channels retain only same-session fresh handoffs after reload',t=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let token='original';
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>token}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');});
 for(const channel of ['whatsapp','messenger','instagram']){
  const detail={page:'conversion',runId:'run',taskId:'task',issuedAt:100,navigationIdentity:productionNavigationIdentity(),businessRef:{taskKey:'followup_dispatch',followupItemId:'item',customerNavigation:{channel,tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1}}};
  const raw=JSON.stringify(detail);assert.equal(readDeliveryHandoff(raw,'conversion',101)?.businessRef.followupItemId,'item');
  assert.equal(readDeliveryHandoff(raw,'conversion',100+15*60_000),null);
  assert.equal(readDeliveryHandoff(raw,'digitalEmployees',101),null);
  token='other-account';assert.equal(readDeliveryHandoff(raw,'conversion',101),null);token='original';
  assert.equal(readDeliveryHandoff(JSON.stringify({...detail,navigationIdentity:undefined}),'conversion',101),null);
 }
});
