// Original, locally synthesized test music; not a commercial music-library asset.
const fs = require('node:fs');
const output = process.argv[2];
if (!output || !output.startsWith('/tmp/lingshu-e2e-')) throw new Error('Isolated output required');
const rate = 24000, seconds = 20;
const pcm = Buffer.alloc(rate * seconds * 2);
const chords = [[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]];
for (let i=0;i<rate*seconds;i++) {
  const t=i/rate, beat=Math.floor(t*2), local=t-beat/2;
  const notes=chords[Math.floor(t/4)%4];
  const note=notes[beat%3]*2;
  const pluck=Math.sin(2*Math.PI*note*t)*Math.exp(-local*7)*Math.min(1,local*80);
  const pad=notes.reduce((sum,hz)=>sum+Math.sin(2*Math.PI*hz*t),0)/3;
  const fade=Math.min(1,t/0.5,(seconds-t)/1.5);
  pcm.writeInt16LE(Math.round((0.10*pluck+0.045*pad)*fade*32767),i*2);
}
const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
fs.writeFileSync(output,Buffer.concat([h,pcm]));
console.log('Created 20-second original local test BGM');
