import {callLLM} from '../agents/llm.js';
/** Shared by the existing translation HTTP route and the local customer preview. */
export async function translateCustomerText(text:string,source:string,target:string){
 const translated=await callLLM(text,{backend:'qwen',systemPrompt:`Translate from ${source} to ${target}. Return only the translation, without explanation or quotation marks. Preserve names, numbers and formatting.`});
 if(!translated.trim())throw Error('translation_service_empty');return translated.trim();
}
