import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {canFingerprintThumbnailUrl,fingerprintVideoThumbnail,likelySameVideoThumbnail,loadKnownVideoThumbnailFingerprints} from './videoThumbnailDuplicate.js';

test('thumbnail fingerprint recognizes a high-confidence re-encode, but not a common poster with different content',async()=>{
 const pixels=Buffer.alloc(90*80*3);
 for(let y=0;y<80;y++)for(let x=0;x<90;x++){
  const offset=(y*90+x)*3;
  pixels[offset]=Math.round(x*255/89);
  pixels[offset+1]=Math.round(y*255/79);
  pixels[offset+2]=Math.round((x+y)*255/168);
 }
 const raw=await sharp(pixels,{raw:{width:90,height:80,channels:3}}).png().toBuffer();
 const jpeg=await sharp(raw).jpeg({quality:92}).toBuffer();
 const blue=await sharp({create:{width:90,height:80,channels:3,background:'#1765dc'}}).png().toBuffer();
 const a={fingerprint:await fingerprintVideoThumbnail(raw),title:'OEM factory cleansing foam production',duration:24};
 const b={fingerprint:await fingerprintVideoThumbnail(jpeg),title:'OEM factory cleansing foam production',duration:25};
 assert.equal(likelySameVideoThumbnail(a,b),true);
 assert.equal(likelySameVideoThumbnail(a,{...b,title:'Different product and different demonstration'}),false);
 assert.equal(likelySameVideoThumbnail(a,{...b,duration:40}),false);
 assert.equal(likelySameVideoThumbnail(a,{...b,fingerprint:await fingerprintVideoThumbnail(blue)}),false);
 const flat={fingerprint:await fingerprintVideoThumbnail(blue),title:a.title,duration:a.duration};
 assert.equal(likelySameVideoThumbnail(flat,flat),false,'shared flat poster is not proof of duplicate video');
});

test('fingerprinting only fetches expected HTTPS platform image hosts',()=>{
 assert.equal(canFingerprintThumbnailUrl('youtube','https://i.ytimg.com/vi/id/hqdefault.jpg'),true);
 assert.equal(canFingerprintThumbnailUrl('tiktok','https://p16-sign.tiktokcdn.com/image.jpeg'),true);
 assert.equal(canFingerprintThumbnailUrl('facebook','https://scontent.xx.fbcdn.net/image.jpg'),true);
 assert.equal(canFingerprintThumbnailUrl('youtube','http://127.0.0.1/secret'),false);
 assert.equal(canFingerprintThumbnailUrl('youtube','https://ytimg.com.evil.test/image.jpg'),false);
 assert.equal(canFingerprintThumbnailUrl('youtube','https://user@i.ytimg.com/image.jpg'),false);
});

test('existing fingerprint scan reaches later pages and stays tenant scoped',async()=>{
 const fp=await fingerprintVideoThumbnail(await sharp({create:{width:10,height:10,channels:3,background:'#ff0000'}}).png().toBuffer());
 const rows=Array.from({length:201},(_,i)=>({tenantId:'a',title:`video-${i}`,duration:10,aiAnalysis:JSON.stringify(i===200?{thumbnailFingerprint:fp}:{})}));
 rows.push({tenantId:'b',title:'other',duration:10,aiAnalysis:JSON.stringify({thumbnailFingerprint:fp})});
 const known=await loadKnownVideoThumbnailFingerprints({list:async<T>(_collection:string,query:any)=>{
  const selected=rows.filter(row=>row.tenantId===query.where.tenantId),page=query.page??1,perPage=query.perPage??200;
  return{items:selected.slice((page-1)*perPage,page*perPage) as T[],totalItems:selected.length,totalPages:Math.ceil(selected.length/perPage),page,perPage};
 }} as any,'a');
 assert.equal(known.length,1);
 assert.equal(known[0]!.title,'video-200');
});
