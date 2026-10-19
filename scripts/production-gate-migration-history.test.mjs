import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const name='1791072008_create_content_execution_queue.js',migration=`pb_migrations/${name}`,manifest='scripts/pb-migration-checksums.json';
const introduced='1f36cf356d5c2f95a2f3494f81a3d35b263bd48d',correction='fd03ac17a395adcb792eb7f8c854f0e9302faf5e';
const from='17082ecdb5a6228182507d1d2a01f55c6aac48922cd376c489fecce8c8fb2f07',to='2aed450a4c83a5f6133817f47eef9c1f08ecde5e65f22427aa7480c2c96f67f8';
const git=(...args)=>execFileSync('git',args,{maxBuffer:16*1024*1024,timeout:15000});
const text=(...args)=>git(...args).toString('utf8').trim();const hash=b=>createHash('sha256').update(b).digest('hex');const entry=ref=>JSON.parse(git('show',`${ref}:${manifest}`)).migrations[name];
test('content queue migration provenance is immutable; initial mismatch was manifest defect, not bytes drift',()=>{
 const parent=text('rev-parse',introduced+'^'),head=text('rev-parse','HEAD');
 assert.equal(text('ls-tree','--name-only',parent,'--',migration),'');assert.equal(entry(parent),undefined);
 assert.equal(entry(introduced),from);assert.equal(hash(git('show',`${introduced}:${migration}`)),to);
 assert.equal(entry(correction+'^'),from);assert.equal(entry(correction),to);
 const commits=text('log','--all','--format=%H','--',migration).split('\n').filter(Boolean),canonical=b=>b.toString('utf8').trimEnd();
 assert.ok(commits.includes(introduced),'the reviewed introduction must remain reachable');
 for(const commit of commits){const bytes=git('show',`${commit}:${migration}`),fingerprint=hash(bytes);assert.ok(fingerprint===from||fingerprint===to,'reachable history must contain only the two reviewed newline variants');assert.equal(canonical(bytes),canonical(git('show',`${introduced}:${migration}`)),'reviewed variants may differ only in trailing whitespace');}
 for(const ref of [introduced,correction,head])assert.equal(hash(git('show',`${ref}:${migration}`)),to);
 assert.equal(hash(readFileSync(migration)),to);assert.equal(entry('HEAD'),to);assert.equal(JSON.parse(readFileSync(manifest,'utf8')).migrations[name],to);
 assert.equal(text('diff',correction+'^',correction,'--',migration),'','correction did not rewrite migration bytes');
 const blobs={introduced:text('rev-parse',`${introduced}:${migration}`),head:text('rev-parse',`HEAD:${migration}`),index:text('rev-parse',`:${migration}`)};assert.equal(blobs.introduced,blobs.head);assert.equal(blobs.head,blobs.index);
 const evidence={name,head,introduced,introducedParent:parent,correction,originalManifestEntry:from,immutableFileSha256:to,currentManifestEntry:entry('HEAD'),currentWorktreeSha256:hash(readFileSync(migration)),gitBlobs:blobs,reachableFileChangeCommits:commits,noMigrationExecuted:true,scope:'read_only_repository_provenance'};
 console.log(JSON.stringify(evidence));
});
