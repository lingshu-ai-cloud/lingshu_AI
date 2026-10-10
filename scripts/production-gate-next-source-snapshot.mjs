import{execFileSync}from'node:child_process';
import{readFileSync}from'node:fs';
import{createHash}from'node:crypto';
// Include untracked source/fixtures; exclude binaries and prose. No source contents are emitted.
export function sourceHashes(){const files=execFileSync('rg',['--files','server','src','shared','scripts'],{encoding:'utf8'}).trim().split('\n').filter(file=>/\.[cm]?[jt]sx?$/.test(file)||/^scripts\/fixtures\/.*\.json$/.test(file)).sort();return Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));}
export function sourceDrift(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(file=>before[file]!==after[file]);}
