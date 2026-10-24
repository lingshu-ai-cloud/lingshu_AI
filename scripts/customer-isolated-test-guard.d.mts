export function assertCustomerIsolationInstalled():void;
export function customerIsolationStatus():{installed:boolean;version:number;pid:number;defaultPolicy:string;allowedLocalPorts:string[];blocked:Array<{at:string;transport:string;decision:string;targetClass:string;purpose:string}>};
export function runCustomerIsolationSelfCheck():Promise<ReturnType<typeof customerIsolationStatus>&{checkedAt:string;checks:Array<{name:string;result:string;code:string}>}>;
