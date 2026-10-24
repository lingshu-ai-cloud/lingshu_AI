// Represents an adapter imported alongside bootstrap, rather than after awaiting it.
if(Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationGuard'))!==true)throw Error('adapter_evaluated_before_customer_isolation');
console.log('adapter-observed-default-deny');
