import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {tenantCatalogImageFile} from './enterpriseMediaImage.js';
test('catalog images are scoped to the tenant, including encoded traversal and symlink targets',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tenant-catalog-'));
 try{
  for(const tenant of ['a','b']){fs.mkdirSync(path.join(root,'tenants',tenant,'catalog'),{recursive:true});fs.writeFileSync(path.join(root,'tenants',tenant,'catalog','product.png'),'image');}
  const own=path.join(root,'tenants/a/catalog/product.png');
  assert.equal(tenantCatalogImageFile('/media/tenants/a/catalog/product.png','a',root),fs.realpathSync(own));
  assert.equal(tenantCatalogImageFile('/media/tenants/b/catalog/product.png','a',root),null);
  assert.equal(tenantCatalogImageFile('/media/tenants/a/%2e%2e%2fb/catalog/product.png','a',root),null);
  fs.symlinkSync(path.join(root,'tenants/b/catalog/product.png'),path.join(root,'tenants/a/catalog/link.png'));
  assert.equal(tenantCatalogImageFile('/media/tenants/a/catalog/link.png','a',root),null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
