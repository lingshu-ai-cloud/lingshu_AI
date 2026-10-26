import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {socialRequestHash,socialObject} from './socialContentValidation.js';
import type {SocialGraphApprovedContext} from './socialContentProductionExecution.js';
const root=()=>path.resolve('data/social-content-graph-contexts');
export function readGraphContextSnapshot(payload:Record<string,unknown>|null|undefined,snapshotRoot=root()):SocialGraphApprovedContext|null {
 if(!payload)return null;
 const inline=socialObject(payload.approvedContext);
 if(inline)return inline as unknown as SocialGraphApprovedContext;
 const hash=String(payload.approvedContextHash||'');if(!/^[a-f0-9]{64}$/.test(hash))return null;
 return readGraphEvidenceSnapshot<SocialGraphApprovedContext>(hash,snapshotRoot);
}
/** Shared content-addressed store for large immutable graph evidence. */
export function readGraphEvidenceSnapshot<T>(hash:string,snapshotRoot=root()):T {
 if(!/^[a-f0-9]{64}$/.test(hash))throw Error('graph_context_snapshot_missing');
 const value=JSON.parse(fs.readFileSync(path.join(snapshotRoot,hash+'.json'),'utf8'));
 if(socialRequestHash(value)!==hash)throw Error('graph_context_snapshot_changed');
 return value as T;
}
export function persistGraphEvidenceSnapshot(value:unknown,snapshotRoot=root()):string {
 const hash=socialRequestHash(value),dir=path.resolve(snapshotRoot),file=path.join(dir,hash+'.json');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(fs.existsSync(file))readGraphEvidenceSnapshot(hash,dir);
 else{const temp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
 return hash;
}
/** Snapshot bytes are durable before the compact job reference is published. */
export function compactGraphContextSnapshot(payload:Record<string,unknown>,snapshotRoot=root()):Record<string,unknown>{
 const context=readGraphContextSnapshot(payload,snapshotRoot);if(!context)throw Error('graph_context_snapshot_missing');
 const hash=persistGraphEvidenceSnapshot(context,snapshotRoot);
 const {approvedContext:_,...rest}=payload;return {...rest,approvedContextHash:hash};
}
