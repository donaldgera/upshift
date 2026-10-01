import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {absorbSubmissions,compareHistories,validateSelection,filterProblems,recommendationPool,recommend} from '../lib/comparison.mjs';
import {createCodeforcesService,createMemoryCache} from '../server/codeforces.mjs';
import {createWorker} from '../server/worker.mjs';
import {reserveCodeforcesSlot,RESERVE_SQL} from '../server/rate-limit.mjs';
const sub=(id,index='A',time=id,verdict='OK')=>({id,verdict,creationTimeSeconds:time,problem:{contestId:1,index,name:`Problem ${index}`,rating:index==='C'?undefined:1200,tags:['math']}});
const history=(handle,submissions)=>{const accepted=new Map();absorbSubmissions(accepted,submissions);return{handle,accepted:[...accepted.values()],fetchedAt:'2026-09-20T00:00:00Z',submissionCount:submissions.length};};
const selection={learner:'learner',sources:['one','two'],mode:'any'};
const fixtures=[history('learner',[sub(100,'B')]),history('one',[sub(20,'A'),sub(10,'A'),sub(15,'B'),sub(40,'C'),sub(7,'D',7,'WRONG_ANSWER')]),history('two',[sub(9,'A'),sub(30,'D')])];
test('union, intersection, earliest acceptance and links stay consistent across source order',()=>{
  const any=compareHistories(selection,fixtures);assert.deepEqual(any.queue.map(p=>p.id),['1A','1D','1C']);assert.equal(any.completed[0].id,'1B');assert.equal(any.queue[0].sourceHandle,'two');assert.equal(any.queue[0].firstSubmissionId,9);assert.match(any.queue[0].firstSubmissionUrl,/submission\/9$/);
  const reverse=compareHistories({...selection,sources:['two','one']},fixtures);assert.deepEqual(reverse.queue,any.queue);
  const all=compareHistories({...selection,mode:'all'},fixtures);assert.deepEqual(all.queue.map(p=>p.id),['1A']);assert.equal(all.completed.length,0);
});
test('learner refresh moves solves to completed and new source solve is chronological',()=>{
  const data=compareHistories(selection,[history('learner',[sub(100,'B'),sub(101,'A')]),history('one',[sub(20,'A'),sub(1,'E')]),fixtures[2]]);assert.deepEqual(data.queue.map(p=>p.id),['1E','1D']);assert.equal(data.completed[0].id,'1A');
});
test('selection validation is case-insensitive; filtering and random bounds are inclusive',()=>{
  assert.throws(()=>validateSelection({...selection,sources:[' one ','ONE']}),/unique/);assert.throws(()=>validateSelection({...selection,sources:['LEARNER']}),/cannot/);assert.equal(validateSelection({...selection,learner:' learner '}).learner,'learner');
  const data=compareHistories(selection,fixtures);assert.equal(filterProblems(data.queue,{min:1200,max:1200}).length,2);assert.equal(filterProblems(data.queue).length,3);assert.equal(recommend(data.queue,0,1199),null);assert.equal(recommend(data.queue,0,1200,'1:A',()=>0).key,'1:D');
});
test('random range includes both endpoints, excludes unrated, and permits exact-rating practice',()=>{
  const problems=[{key:'low',rating:800},{key:'min',rating:1200},{key:'max',rating:1600},{key:'high',rating:1700},{key:'unrated',rating:null}];
  assert.deepEqual(recommendationPool(problems,1200,1600).map(p=>p.key),['min','max']);
  assert.equal(recommend(problems,1200,1600,'min',()=>0).key,'max');
  assert.equal(recommend(problems,1200,1200,'min',()=>0).key,'min');
  assert.equal(recommend(problems,1300,1500),null);
});
test('random range rejects incomplete, reversed, negative and fractional bounds',()=>{
  const problems=[{key:'p',rating:1200}];
  for(const [min,max]of [[1600,1200],[-1,1600],[0,NaN],[NaN,1600],[0,Infinity],[0,1200.5],[0,Number.MAX_SAFE_INTEGER+1],[undefined,1600]]){
    assert.deepEqual(recommendationPool(problems,min,max),[]);assert.equal(recommend(problems,min,max),null);
  }
});
function upstream({failPage=false}={}){const calls=[];return{calls,async fetch(url){const u=new URL(url),method=u.pathname.split('/').at(-1);calls.push(`${method}:${u.searchParams.get('handle')}:${u.searchParams.get('from')}`);let result;if(method==='user.info')result=u.searchParams.get('handles').split(';').map(handle=>({handle}));if(method==='user.status'){const h=u.searchParams.get('handle'),from=Number(u.searchParams.get('from'));if(failPage&&from>1)return new Response('bad',{status:502});result=from===1?h==='learner'?[]:h==='one'?[sub(2,'A'),sub(3,'B')]:[sub(1,'A')]:[];}if(method==='problemset.problems')result={problems:[]};if(method==='contest.list')result=[];return Response.json({status:'OK',result});}};}
test('cached profiles preserve newly selected mode; Generate preserves timestamp; Refresh bypasses caches',async()=>{
  const api=upstream();let time=100000000;const service=createCodeforcesService({fetchImpl:api.fetch,now:()=>time,sleep:async()=>{},interval:0});const first=await service.compare(selection);time+=1000;const all=await service.compare({...selection,mode:'all'});assert.equal(all.selection.mode,'all');assert.equal(all.queue.length,1);assert.equal(first.lastSuccessfulRefresh,all.lastSuccessfulRefresh);const calls=api.calls.length;const forced=await service.compare(selection,{force:true});assert.ok(api.calls.length>calls);assert.notEqual(forced.lastSuccessfulRefresh,first.lastSuccessfulRefresh);
});
test('history requests coalesce and a later-page failure cannot replace a complete cache',async()=>{
  const api=upstream(),cache=createMemoryCache(),service=createCodeforcesService({fetchImpl:api.fetch,cache,sleep:async()=>{},interval:0});const [a,b]=await Promise.all([service.history('one',true),service.history('one',true)]);assert.deepEqual(a,b);assert.equal(api.calls.length,2);
  const failed=upstream({failPage:true});const next=createCodeforcesService({fetchImpl:failed.fetch,cache,sleep:async()=>{},interval:0});await assert.rejects(next.history('one',true));assert.deepEqual(await cache.get('history:one'),a);
});
test('terminal empty page does not count against supported history page limit',async()=>{
  let calls=0;const service=createCodeforcesService({fetchImpl:async()=>Response.json({status:'OK',result:calls++<2?[sub(calls)]:[]}),sleep:async()=>{},interval:0,pageSize:1,maxPages:2});assert.equal((await service.history('one',true)).submissionCount,2);
});
test('cancelling a comparison returns promptly while shared cache work finishes',async()=>{
  let release,started;const waiting=new Promise(r=>{started=r;});const pending=new Promise(r=>{release=r;});const api=upstream();const service=createCodeforcesService({sleep:async()=>{},interval:0,fetchImpl:async url=>{if(new URL(url).pathname.endsWith('user.status')){started();await pending;}return api.fetch(url);}});const abort=new AbortController(),run=service.compare(selection,{signal:abort.signal});await waiting;abort.abort();await assert.rejects(run,{name:'AbortError'});release();
});
test('worker validates requests and streams progress/result with force option',async()=>{
  let options;const worker=createWorker({assets:{'/index.html':{body:'ok',type:'text/html'}},comparisonService:{async compare(s,o){options=o;o.onProgress({message:'Ready',completed:1,total:1});return{selection:s};}}});
  const request=body=>new Request('https://example.test/api/compare',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.test'},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(request({...selection,sources:[]}))).status,400);const r=await worker.fetch(request({...selection,force:true}));const events=(await r.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.type),['progress','result']);assert.equal(options.force,true);assert.equal((await worker.fetch(new Request('https://example.test/'))).status,200);
});
test('database gate atomically reserves shared slots and bounds the queue',async()=>{
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE api_gate (name TEXT PRIMARY KEY, next_at INTEGER NOT NULL)');const db={prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args);}};}};}};const sleeps=[];const opts={now:()=>100000,sleep:async ms=>sleeps.push(ms)};
  await Promise.all([reserveCodeforcesSlot(db,opts),reserveCodeforcesSlot(db,opts)]);assert.deepEqual(sleeps,[0,2400]);for(let i=0;i<17;i++)await reserveCodeforcesSlot(db,opts);await assert.rejects(reserveCodeforcesSlot(db,opts),/busy/);assert.ok(sqlite.prepare('EXPLAIN QUERY PLAN SELECT * FROM api_gate WHERE name=?').all('codeforces')[0].detail.includes('INDEX'));sqlite.close();
});
