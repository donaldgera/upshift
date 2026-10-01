import {mkdir,writeFile,rename} from 'node:fs/promises';
const endpoint=process.env.PRACTICE_URL||'https://upshift.upshift-practice.workers.dev';
const selection={learner:process.env.PRACTICE_LEARNER||'donaldgera',sources:(process.env.PRACTICE_SOURCES||'catgirl').split(',').map(s=>s.trim()),mode:process.env.PRACTICE_MODE||'any',force:true};
const response=await fetch(new URL('/api/compare',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection),signal:AbortSignal.timeout(9*60*1000)});
if(!response.ok)throw new Error(`Refresh failed (${response.status}): ${await response.text()}`);
let pending='',result;
const decoder=new TextDecoder();
function event(line){if(!line.trim())return;const e=JSON.parse(line);if(e.type==='error')throw new Error(e.error);if(e.type==='progress')console.log(e.message);if(e.type==='result')result=e.data;}
for await(const bytes of response.body){pending+=decoder.decode(bytes,{stream:true});let at;while((at=pending.indexOf('\n'))>=0){event(pending.slice(0,at));pending=pending.slice(at+1);}}
pending+=decoder.decode();event(pending);if(!result)throw new Error('Refresh ended without a complete comparison.');
await mkdir(new URL('../.cache/',import.meta.url),{recursive:true});
const out=new URL('../.cache/latest-comparison.json',import.meta.url),temp=new URL('../.cache/latest-comparison.json.tmp',import.meta.url);
await writeFile(temp,JSON.stringify(result,null,2));await rename(temp,out);
console.log(JSON.stringify({lastSuccessfulRefresh:result.lastSuccessfulRefresh,selection:result.selection,...result.stats}));
