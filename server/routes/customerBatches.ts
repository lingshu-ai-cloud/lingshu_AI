import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { Router, type RequestHandler, type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth, enforceSupportSessionReadOnly } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { createCustomerBatchService } from '../customerService/customerBatchService.js';
import { customerBatchCapabilities, customerCriteriaSchema, CustomerCriteriaError } from '../../shared/contracts/customerSegmentation.js';
export function createCustomerBatchesRouter(service= createCustomerBatchService(store), authenticate:RequestHandler=requireAuth) {
  const router=Router();router.use(authenticate,enforceSupportSessionReadOnly);
  router.use(async(req,res,next)=>{try{const role=res.locals.browserReadRole??await requestOrganizationRoleStrict(req.headers.authorization,res.locals.userId);if(!['admin','super_admin','customer_service'].includes(String(role))||isBrowserReadToken(req.headers.authorization)&&req.method!=='GET'&&!req.path.endsWith('/preview')){res.status(403).json({error:'customer_batch_forbidden'});return;}next();}catch{res.status(503).json({error:'customer_batch_authorization_unavailable'});}});
  const route=(f:RequestHandler):RequestHandler=>(req,res,next)=>{Promise.resolve(f(req,res,next)).catch(next);};
  router.get('/capabilities',(_req,res)=>{res.json(customerBatchCapabilities);});
  router.post('/runs/:runId/preview',route(async(req,res)=>{const body=z.strictObject({criteria:customerCriteriaSchema}).parse(req.body);res.json(await service.preview(res.locals.tenantId,String(req.params.runId),body.criteria));}));
  router.post('/runs/:runId/segments',route(async(req,res)=>{const b=z.strictObject({criteria:customerCriteriaSchema,expectedPreviewHash:z.string().min(32).max(128)}).parse(req.body);res.status(201).json(await service.freeze(res.locals.tenantId,res.locals.userId,String(req.params.runId),b.criteria,b.expectedPreviewHash));}));
  router.post('/runs/:runId/classify',route(async(req,res)=>{const b=z.strictObject({customerIds:z.array(z.string().min(1).max(200)).min(1).max(10)}).parse(req.body);res.json(await service.classify(res.locals.tenantId,String(req.params.runId),b.customerIds,res.locals.userId));}));
  router.post('/runs/:runId/customers/:customerId/profile',route(async(req,res)=>{const b=z.strictObject({expectedFingerprint:z.string().length(64),profile:z.strictObject({language:z.string().trim().min(1).max(100),timeZone:z.string().trim().min(1).max(100),countryName:z.string().trim().min(1).max(100).optional()})}).parse(req.body);res.json(await service.reviewProfile(res.locals.tenantId,res.locals.userId,String(req.params.runId),String(req.params.customerId),b.expectedFingerprint,b.profile));}));
  router.post('/runs/:runId/customers/:customerId/confirm-new-inquiry',route(async(req,res)=>{const b=z.strictObject({firstMessageId:z.string().min(1).max(200),expectedFingerprint:z.string().length(64),reason:z.string().trim().min(1).max(2000)}).parse(req.body);res.json(await service.confirmNewInquiry(res.locals.tenantId,res.locals.userId,String(req.params.runId),String(req.params.customerId),b));}));
  const errors:ErrorRequestHandler=(e,_req,res,_next)=>{const code=e instanceof CustomerCriteriaError?'customer_criteria_invalid':e instanceof z.ZodError?'customer_batch_input_invalid':e instanceof Error?e.message:'customer_batch_failed';res.status(e instanceof z.ZodError||e instanceof CustomerCriteriaError?400:e.status||409).json({error:code,code,retryable:false});};router.use(errors);return router;
}
