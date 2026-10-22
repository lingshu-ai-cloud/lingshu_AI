import type { RequestHandler } from 'express';
import { parseCustomerCriteria } from '../../shared/contracts/customerSegmentation.js';
/** Legacy route shares the new schema instead of silently discarding unknown predicates. */
export const validateCustomerCriteria:RequestHandler=(req,res,next)=>{
  if(req.method!=='POST'){next();return;}
  try{parseCustomerCriteria(req.body?.criteria??{});next();}catch(error){res.status(400).json({error:'customer_criteria_invalid',code:'customer_criteria_invalid',issues:error&&typeof error==='object'&&'issues'in error?error.issues:undefined});}
};
