import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
dotenv.config({path:path.resolve('../local-preview-1002/.env'),quiet:true});
dotenv.config({path:path.resolve('../local-preview-1002/.env.local'),override:true,quiet:true});
const {requireScopedAsset}=await import('../server/lib/assetAccess.js');
const app=express();
app.use('/media', requireScopedAsset, express.static(path.resolve('data/media'), {fallthrough:false,setHeaders:res=>res.setHeader('Cache-Control','private, no-store')}));
app.listen(8791,'127.0.0.1',()=>console.log('Tenant-scoped acceptance media on 8791'));
