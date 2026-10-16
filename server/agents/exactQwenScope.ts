import {AsyncLocalStorage} from 'node:async_hooks';
export interface ExactQwenProviderReceipt {provider:'qwen';responseId:string|null;model:string|null;usage:unknown;httpStatus:number;requestModel:string|null;requestHash:string;}
interface ExactScope {model:string;configurationHash:string;endpoint?:string;credentialDigest?:string;onProviderReceipt?:(receipt:ExactQwenProviderReceipt)=>Promise<void>;}
const scope=new AsyncLocalStorage<ExactScope>();
export const exactQwenScope=()=>scope.getStore();
/** Caller must first durably reserve a human-authorized revision operation. */
export const withExactQwenScope=<T>(binding:ExactScope,run:()=>Promise<T>)=>scope.run(binding,run);
