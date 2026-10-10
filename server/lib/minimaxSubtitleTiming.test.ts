import assert from 'node:assert/strict';
import { parseMiniMaxSubtitleTiming } from './minimaxSubtitleTiming.js';
assert.deepEqual(parseMiniMaxSubtitleTiming([{text:'Hello,',time_begin:120,time_end:580},{text:'boss!',time_begin:590,time_end:1080}],2),[{text:'Hello,',start:.12,end:.58},{text:'boss!',start:.59,end:1.08}]);
assert.deepEqual(parseMiniMaxSubtitleTiming([{text:'missing timings'}],2),[]);
assert.deepEqual(parseMiniMaxSubtitleTiming([{text:'bad',time_begin:500,time_end:400}],2),[]);
assert.deepEqual(parseMiniMaxSubtitleTiming([{text:'bad',time_begin:0,time_end:4000}],2),[]);
console.log('MiniMax real subtitle timestamp regression passed');
