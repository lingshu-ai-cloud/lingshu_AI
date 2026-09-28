import '../server/loadEnvironment.js';
import fs from 'node:fs';
import { mapNarrationCues } from '../src/lib/narrationAlignment.js';
import { synthesizeStudioVoiceForAutomation } from '../server/routes/studio.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
await runWithDataAuthority('local', async () => {
  const source = JSON.parse(fs.readFileSync('output/narration-quality-20260928/corrected-narration.json','utf8'));
  const lines = source.sentences.map((s: {text:string}) => s.text);
  const result = await synthesizeStudioVoiceForAutomation({tenantId:'local_tenant_customer_1b2913131e2c46deab66172228c4df0a',text:lines.join(' '),sentenceLines:lines,language:'en',voice:'v1',style:{preset:'authentic_review',speed:1.15,pauseStyle:'natural'}});
  if (result.source !== 'minimax') throw new Error('MiniMax was not used; no success is claimed. '+(result.error || 'Provider fell back.'));
  if (result.alignmentSource !== 'minimax_native' || !result.cues?.length || result.cues.every(cue => cue.start === 0)) throw new Error('MiniMax audio lacks valid measured timing.');
  const groups = lines.flatMap((line: string) => line.startsWith('Hello, boss!') ? ['Hello, boss!', line.slice('Hello, boss!'.length).trim()] : [line]);
  const timedGroups = mapNarrationCues(groups, result.cues!, result.duration!, result.alignmentSource);
  if (timedGroups.length !== 7 || timedGroups.some(group => !group)) throw new Error('口播组未获得独立实测边界');
  fs.writeFileSync('output/narration-quality-20260928/minimax-female-fast-result.json',JSON.stringify(result,null,2));
  if (result.localPath && fs.existsSync(result.localPath)) fs.copyFileSync(result.localPath,'output/narration-quality-20260928/MiniMax女声快节奏试听.wav');
  console.log(JSON.stringify({ok:result.ok,source:result.source,duration:result.duration,alignmentSource:result.alignmentSource,cues:result.cues?.length}));
});
