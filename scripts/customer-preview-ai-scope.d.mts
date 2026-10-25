export interface PreviewAiAudit {startedAt:string;endpoint:string;status:number|null;requestId:string|null;completionId:string|null;model:string|null;usage:Record<string,number>|null}
export function withCustomerPreviewAi<T>(callback:()=>Promise<T>):Promise<{value:T;audit:PreviewAiAudit[]}>;
export function withAssistantPreviewInformation<T>(callback:()=>Promise<T>):Promise<{value:T;audit:PreviewAiAudit[]}>;
export function customerPreviewAiRequestAllowed(input:unknown,init?:Record<string,unknown>):boolean;
export function auditedCustomerPreviewAiFetch(originalFetch:typeof fetch,input:Parameters<typeof fetch>[0],init?:RequestInit):Promise<Response>;

export function customerPreviewAiTransportAllowed(host:unknown,port:unknown):boolean;
