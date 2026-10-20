import {Router} from 'express';
import type {DataStore} from '../storage/datastore.js';
import type {AuthLocals} from '../middleware/auth.js';
import {createWeeklyDeliveryAcceptanceService} from '../socialPrograms/weeklyDeliveryAcceptance.js';
import {SocialProgramError} from '../socialPrograms/service.js';

const route=(handler:(req:any,res:any)=>Promise<void>)=>(req:any,res:any,next:any)=>void handler(req,res).catch(next);
export function createSocialWeeklyDeliveryAcceptanceRouter(store:DataStore,servicePorts:Parameters<typeof createWeeklyDeliveryAcceptanceService>[1]={}){
 const router=Router({mergeParams:true}),service=createWeeklyDeliveryAcceptanceService(store,servicePorts);
 const scope=(req:any,res:any)=>{const {tenantId}=res.locals as AuthLocals,packageVersion=Number(req.query.version??req.body?.expectedPackageVersion);if(!Number.isSafeInteger(packageVersion)||packageVersion<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');return{tenantId,programId:String(req.params.programId||''),packageId:String(req.params.packageId||''),packageVersion};};
 router.get('/',route(async(req,res)=>{const target=scope(req,res),receipt=await service.read(target);res.setHeader('Cache-Control','private, no-store');res.json({preview:receipt??await service.preview(target),receipt});}));
 router.post('/',route(async(req,res)=>{const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedPackageVersion','expectedEvidenceHash'].includes(key))||typeof body.expectedEvidenceHash!=='string')throw new SocialProgramError('weekly_delivery_acceptance_input_invalid',400,'整周验收参数无效。');const target=scope(req,res),{userId}=res.locals as AuthLocals;res.status(201).json({item:await service.accept(target,userId,{expectedEvidenceHash:body.expectedEvidenceHash})});}));
 return router;
}
