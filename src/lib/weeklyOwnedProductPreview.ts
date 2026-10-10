/** Credentials stay on the authenticated app origin; remote owned files receive none. */
export function ownedProductPreviewHeaders(url:string,origin:string,authorization:Record<string,string>):Record<string,string>{
 if(url.startsWith('//'))throw Error('原图地址无效。');const parsed=new URL(url,origin);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.protocol==='http:'&&parsed.origin!==origin)throw Error('原图地址无效。');return parsed.origin===origin?authorization:{};
}
