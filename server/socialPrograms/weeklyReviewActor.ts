import type { DataStore, Record_ } from '../storage/datastore.js';
import { localTenantMember } from '../lib/organizationRole.js';

/** Scope-only identity lookup; it must not initialize review, allocation or production modules. */
export async function readWeeklyReviewActor(store:DataStore,tenantId:string,userId:string):Promise<Record_|null>{const local=localTenantMember(tenantId,userId);return local!==undefined?local?{...local}:null:store.getById<Record_>('users',userId);}
