import {Router,type RequestHandler,type ErrorRequestHandler} from 'express';
import type {AuthLocals} from '../middleware/auth.js';
import type {WeeklyProfileUpgradeScope,WeeklyProfileUpgradeBasis} from '../../shared/contracts/weeklyProfileUpgrade.js';
import {SocialProgramError} from '../socialPrograms/service.js';
export interface WeeklyProfileUpgradePort{
 evidence(s:WeeklyProfileUpgradeScope,actor:string):Promise<unknown>;
 list(s:WeeklyProfileUpgradeScope,actor:string):Promise<unknown>;
 get(s:WeeklyProfileUpgradeScope,actor:string,id:string):Promise<unknown>;
 propose(s:WeeklyProfileUpgradeScope,actor:string,input:{targetWeekStart:string;basis:WeeklyProfileUpgradeBasis;reason:string;selectedEvidenceRefs:string[]}):Promise<unknown>;
 confirm(s:WeeklyProfileUpgradeScope,actor:string,id:string,input:{expectedVersion:number;evidenceHash:string}):Promise<unknown>;
}
const fail=():never=>{throw new SocialProgramError('weekly_profile_upgrade_input_invalid',400,'请提供真实来源周版本、下一周日期及明确的画像判断依据。');};
const text=(v:unknown):string=>typeof v==='string'&&v.trim()&&v.length<=2000&&!/[\u0000-\u001f\u007f]/.test(v)?v.trim():fail();
const version=(v:unknown):number=>{const n=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:fail();};
const body=(v:unknown,keys:string[]):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))?v as Record<string,unknown>:fail();
const route=(f:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
export function createSocialWeeklyProfileUpgradeRouter(service:WeeklyProfileUpgradePort){
 const router=Router({mergeParams:true});
 const scope=(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1],v:unknown)=>{const a=res.locals as AuthLocals;if(!a.tenantId||!a.userId)throw new SocialProgramError('weekly_profile_upgrade_auth_required',401,'请先登录。');return {s:{tenantId:a.tenantId,programId:text(req.params.programId),packageId:text(req.params.packageId),packageVersion:version(v)},actor:a.userId};};
 router.get('/evidence',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json({item:await service.evidence(a.s,a.actor)});}));
 router.get('/',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json({items:await service.list(a.s,a.actor)});}));
 router.get('/:id',route(async(req,res)=>{const a=scope(req,res,req.query.version);res.json({item:await service.get(a.s,a.actor,text(req.params.id))});}));
 router.post('/',route(async(req,res)=>{const b=body(req.body,['packageVersion','targetWeekStart','basis','reason','selectedEvidenceRefs']),a=scope(req,res,b.packageVersion);const targetWeekStart=text(b.targetWeekStart);if(!/^\d{4}-\d{2}-\d{2}$/.test(targetWeekStart)||!['tone_clear_growth_stalled','history_material_or_engagement_insufficient'].includes(String(b.basis))||!Array.isArray(b.selectedEvidenceRefs)||!b.selectedEvidenceRefs.length||b.selectedEvidenceRefs.length>100)return fail();const refs=b.selectedEvidenceRefs.map(text);if(new Set(refs).size!==refs.length)return fail();res.status(201).json({item:await service.propose(a.s,a.actor,{targetWeekStart,basis:b.basis as WeeklyProfileUpgradeBasis,reason:text(b.reason),selectedEvidenceRefs:refs})});}));
 router.post('/:id/confirm',route(async(req,res)=>{const b=body(req.body,['packageVersion','expectedVersion','evidenceHash']),a=scope(req,res,b.packageVersion),hash=text(b.evidenceHash);if(!/^[a-f0-9]{64}$/.test(hash))return fail();res.json({item:await service.confirm(a.s,a.actor,text(req.params.id),{expectedVersion:version(b.expectedVersion),evidenceHash:hash})});}));
 const errors:ErrorRequestHandler=(e,_req,res,next)=>{if(e instanceof SocialProgramError){res.status(e.status).json({error:e.message,code:e.code});return;}next(e);};router.use(errors);return router;
}
