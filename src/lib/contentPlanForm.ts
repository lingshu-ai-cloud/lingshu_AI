import { scenarioTaskInputs } from './assistantScenarioIntake';
import type { CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow';

export interface ContentPlanFormValues { title:string; productIds:string[]; direction:string; publishAt:string }
/** Manual form and home intake share task validation, product selection and calendar time semantics. */
export function contentPlanFormInput(values:ContentPlanFormValues,products:Array<{id:string;name:string}>,draftId:string):CreateSocialContentTaskInput {
  const title=values.title.trim();
  if(!title||title.length>120)throw Error('请填写不超过120字的任务名称。');
  const selected=products.filter(product=>values.productIds.includes(product.id));
  if(selected.length!==new Set(values.productIds).size)throw Error('所选产品已变更，请重新选择。');
  const [{input}]=scenarioTaskInputs({kind:'content_creation',id:draftId,title,objective:values.direction,
    scenario:'content_task',requestedOutputCount:1,outputType:'video',platforms:[],aspectRatio:null,targetDurationSeconds:null,
    direction:values.direction.trim(),selectedProducts:selected,plannedPublishAt:values.publishAt});
  const requirements=JSON.stringify({...JSON.parse(input.specialRequirements!),channel:'workspace_form'});
  if(requirements.length>2000)throw Error('创作信息过多，请缩短方向描述或减少产品数量。');
  return {...input,title,specialRequirements:requirements};
}
