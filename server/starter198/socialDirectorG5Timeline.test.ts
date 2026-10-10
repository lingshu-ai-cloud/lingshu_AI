import test from 'node:test';
import assert from 'node:assert/strict';
import {directorG5TimelineVerified} from './socialDirectorG5Timeline.js';
const valid = [{startSeconds:0,endSeconds:3},{startSeconds:3,endSeconds:6}];
test('continuous frozen edit has a reviewable opening and every scene',()=>{
 assert.equal(directorG5TimelineVerified(valid),true);
 assert.equal(directorG5TimelineVerified([{startSeconds:0,endSeconds:3},{startSeconds:3.0005,endSeconds:6}]),true);
});
for (const [name,scenes] of Object.entries({empty:[],missingOpening:[{startSeconds:1,endSeconds:6}],negative:[{startSeconds:-1,endSeconds:3}],overlap:[valid[0],{startSeconds:2,endSeconds:6}],gap:[valid[0],{startSeconds:4,endSeconds:6}],reversed:[{startSeconds:3,endSeconds:0}],notFinite:[{startSeconds:0,endSeconds:Infinity}],nan:[{startSeconds:NaN,endSeconds:6}],zero:[{startSeconds:0,endSeconds:0}]})) {
 test(`G5 fails closed on ${name} timeline`,()=>assert.equal(directorG5TimelineVerified(scenes),false));
}
