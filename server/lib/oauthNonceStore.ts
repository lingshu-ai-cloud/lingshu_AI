import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { store } from '../storage/index.js';

export type OAuthNonceBinding = {tenantId:string;userId:string;platform:string;expiresAt:number;clientHash:string;redirectUri?:string};
type Options = {dataStore?:DataStore;directory?:string;production?:boolean;now?:number};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const oauthClientIdentityHash = digest;
const collection='durable_operation_leases';
const bindingHash=(binding:OAuthNonceBinding)=>digest(binding);
async function backend(options:Options){const dataStore=options.dataStore??store;if(await dataStore.supportsAtomicOperationLease?.())return {dataStore};if(options.production??process.env.NODE_ENV==='production')throw Error('oauth_nonce_atomic_storage_required');return {directory:options.directory??path.resolve('data/oauth-nonces')};}
async function writeExclusive(file:string,value:unknown){const descriptor=await fs.open(file,'wx',0o600);try{await descriptor.writeFile(JSON.stringify(value));await descriptor.sync();}finally{await descriptor.close();}const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
function validate(binding:OAuthNonceBinding,now:number){if(!binding.tenantId||!binding.userId||!binding.platform||!binding.clientHash||!Number.isFinite(binding.expiresAt)||binding.expiresAt<=now||binding.expiresAt>now+10*60*1000)throw Error('oauth_nonce_binding_invalid');}
/** Persist issuance before returning an authorization URL. */
export async function issueOAuthNonce(state:string,binding:OAuthNonceBinding,options:Options={}){
 validate(binding,options.now??Date.now());const key=digest(state);const storage=await backend(options);
 if(storage.dataStore){const row=await storage.dataStore.create(collection,{tenant_id:binding.tenantId,lease_scope:'oauth_nonce_issued',subject_id:key,lease_token:bindingHash(binding),owner_id:binding.userId,acquired_at:new Date(options.now??Date.now()).toISOString(),expires_at:new Date(binding.expiresAt).toISOString()});if(!row)throw Error('oauth_nonce_issue_failed');}
 else {await fs.mkdir(storage.directory!,{recursive:true,mode:0o700});await writeExclusive(path.join(storage.directory!,`${key}.issued`),binding);}
}
/** The consumed tombstone is permanent: provider failures never make a code replayable. */
export async function consumeOAuthNonce(state:string,binding:OAuthNonceBinding,options:Options={}):Promise<boolean>{
 try{validate(binding,options.now??Date.now());const key=digest(state);const storage=await backend(options);
  if(storage.dataStore){const issued=await storage.dataStore.list<Record_>(collection,{where:{tenant_id:binding.tenantId,lease_scope:'oauth_nonce_issued',subject_id:key},perPage:2});if(issued.totalItems!==1||issued.items.length!==1||issued.items[0]?.lease_token!==bindingHash(binding)||issued.items[0]?.owner_id!==binding.userId||issued.items[0]?.expires_at!==new Date(binding.expiresAt).toISOString())return false;
   const consumed=await storage.dataStore.create(collection,{tenant_id:binding.tenantId,lease_scope:'oauth_nonce_consumed',subject_id:key,lease_token:randomUUID(),owner_id:binding.userId,acquired_at:new Date(options.now??Date.now()).toISOString(),expires_at:'9999-12-31T23:59:59.999Z'});return Boolean(consumed);
  }
  const issued=JSON.parse(await fs.readFile(path.join(storage.directory!,`${key}.issued`),'utf8')) as unknown;if(digest(issued)!==bindingHash(binding))return false;await writeExclusive(path.join(storage.directory!,`${key}.consumed`),{bindingHash:bindingHash(binding)});return true;
 }catch{return false;}
}
