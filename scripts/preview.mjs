import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readdir,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import worker from '../dist/server/index.js';
const sqlite=new DatabaseSync(':memory:');
for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(await readFile(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
const DB={prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)||null;}};}};}};
const server=http.createServer(async(req,res)=>{
  try{const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
    const response=await worker.fetch(request,{DB},{waitUntil:p=>p.catch(console.error)});res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){console.error(error);res.writeHead(500).end('Preview request failed.');}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
