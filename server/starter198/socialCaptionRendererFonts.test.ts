import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {verifyCaptionRendererFontInventory,socialCaptionRendererFontIdentity} from './socialCaptionRendererFonts.js';

test('renderer font identity rejects missing and changed bytes even after a successful verification',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'caption-font-inventory-'));
 try{
  const file=path.join(dir,'font.ttf'),bytes='original bundled font';writeFileSync(file,bytes);
  const inventory=[{file:'font.ttf',sha256:createHash('sha256').update(bytes).digest('hex')}];
  assert.ok(verifyCaptionRendererFontInventory(dir,inventory));
  writeFileSync(file,'changed font');assert.equal(verifyCaptionRendererFontInventory(dir,inventory),null);
  unlinkSync(file);assert.equal(verifyCaptionRendererFontInventory(dir,inventory),null);
  assert.equal(verifyCaptionRendererFontInventory(dir,[]),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.ok(socialCaptionRendererFontIdentity(),'the real shared renderer inventory must verify');
});
