import type {DataStore,Record_} from '../storage/datastore.js';
import {organizationRoleOrNull,localTenantMember} from '../lib/organizationRole.js';
import {SocialProgramError} from './service.js';
export async function assertWeeklyScheduleActor(store:DataStore,scope:{tenantId:string;actorUserId:string;packageVersion:number}){
 const local=await localTenantMember(scope.tenantId,scope.actorUserId);
 const user:Record_|null=local===undefined?await store.getById<Record_>('users',scope.actorUserId):local;
 if(!scope.tenantId||!scope.actorUserId||!user||user.tenantId!==scope.tenantId||!organizationRoleOrNull(user.role)||user.disabled===true||user.active===false||['disabled','suspended'].includes(String(user.status)))throw new SocialProgramError('weekly_schedule_user_forbidden',403,'当前用户无权确认此经营排期。');
 if(!Number.isSafeInteger(scope.packageVersion)||scope.packageVersion<1)throw new SocialProgramError('weekly_schedule_version_invalid',400,'排期版本无效。');
}
