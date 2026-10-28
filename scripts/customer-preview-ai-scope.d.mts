export interface PreviewAiAudit {startedAt:string;endpoint:string;status:number|null;requestId:string|null;completionId:string|null;model:string|null;usage:Record<string,number>|null}
export function withCustomerPreviewAi<T>(callback:()=>Promise<T>):Promise<{value:T;audit:PreviewAiAudit[]}>;
export function withAssistantPreviewInformation<T>(callback:()=>Promise<T>):Promise<{value:T;audit:PreviewAiAudit[]}>;
export function customerPreviewAiRequestAllowed(input:unknown,init?:Record<string,unknown>):boolean;
export function auditedCustomerPreviewAiFetch(originalFetch:typeof fetch,input:Parameters<typeof fetch>[0],init?:RequestInit):Promise<Response>;

export function customerPreviewAiTransportAllowed(host:unknown,port:unknown):boolean;

export function withSocialInsightPreviewInformation<T>(config:{actorId:string;maxUsd:number;datasetReadMaxUsd:number}, callback:()=>Promise<T>):Promise<{value:T;audit:unknown[]}>;

export function withAssistantPreviewPublicRead<T>(config:{url:string;pinnedAddress:string;kind:'article'|'dns'}, callback:(lookup:import('node:net').LookupFunction)=>Promise<T>):Promise<T>;
export function customerPreviewPublicReadRequestAllowed(input:unknown,options?:Record<string,unknown>):boolean;

export function customerPreviewPublicReadLease(onClose:()=>void):()=>boolean;
