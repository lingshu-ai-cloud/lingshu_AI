import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPlainAssCueBinding} from './socialCaptionAssCueAudit.js';

const header='[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
const cue={start:0,end:1,text:'HELLO'};
test('plain ASS exactly binds frozen cue text and centisecond window, not rendered pixels',()=>{
 const ass=header+'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,HELLO\n';
 assert.equal(auditPlainAssCueBinding({ass,cues:[cue]}).status,'matched');
 assert.equal(auditPlainAssCueBinding({ass:ass.replace('HELLO','HELL'),cues:[cue]}).status,'mismatch');
 assert.equal(auditPlainAssCueBinding({ass:ass.replace('0:00:01.00','0:00:00.90'),cues:[cue]}).status,'mismatch');
 assert.equal(auditPlainAssCueBinding({ass:ass+'Dialogue: 1,0:00:00.00,0:00:01.00,WordHighlight,,0,0,0,,HELLO\n',cues:[cue]}).status,'unknown');
 assert.equal(auditPlainAssCueBinding({ass,cues:[{...cue,text:'{\\b1}HELLO'}]}).status,'unknown');
});
