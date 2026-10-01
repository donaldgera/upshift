import {readFile,mkdir,writeFile,rm,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const assets={};
for(const [route,file,type] of [['/index.html','src/public.html','text/html; charset=utf-8'],['/app.js','src/app.js','text/javascript; charset=utf-8'],['/theme.js','src/theme.js','text/javascript; charset=utf-8'],['/style.css','src/style.css','text/css; charset=utf-8'],['/domain.js','lib/comparison.mjs','text/javascript; charset=utf-8'],['/favicon.svg','src/favicon.svg','image/svg+xml']])assets[route]={body:await read(file),type};
const sources=await Promise.all(['lib/comparison.mjs','server/codeforces.mjs','server/rate-limit.mjs','server/worker.mjs'].map(read));
const bundle=sources.map(s=>s.replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
await mkdir(new URL('dist/server/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),`const ASSETS=${JSON.stringify(assets)};\n${bundle}\nexport default createWorker({assets:ASSETS});\n`);
// Legacy hosting metadata is optional and remains local to its original checkout.
let legacyHosting;
try{legacyHosting=await read('.openai/hosting.json');}catch(error){if(error.code!=='ENOENT')throw error;}
if(legacyHosting){
  await mkdir(new URL('dist/.openai/',root),{recursive:true});
  await writeFile(new URL('dist/.openai/hosting.json',root),legacyHosting);
  await cp(new URL('drizzle/',root),new URL('dist/.openai/drizzle/',root),{recursive:true});
}
// These are the two known outputs of the retired snapshot publisher, never source files.
await rm(new URL('dist/index.html',root),{force:true});await rm(new URL('dist/data.json',root),{force:true});
console.log('Built public app and Worker API in dist/server/index.js.');
