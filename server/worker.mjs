import {createCodeforcesService,createMemoryCache,ServiceError} from './codeforces.mjs';
import {validateSelection} from '../lib/comparison.mjs';
import {reserveCodeforcesSlot} from './rate-limit.mjs';

const securityHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"};
const memoryCache=createMemoryCache(80);
const edgeCache={
  async get(key){if(typeof caches==='undefined')return memoryCache.get(key);const response=await caches.default.match(`https://practice-queue-cache.invalid/v2/${encodeURIComponent(key)}`);return response?response.json():null;},
  async put(key,value){if(typeof caches==='undefined')return memoryCache.put(key,value);await caches.default.put(`https://practice-queue-cache.invalid/v2/${encodeURIComponent(key)}`,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}}));}
};
const services=new WeakMap();
function hostedService(env){if(!env?.DB)throw new ServiceError('The refresh coordinator is unavailable. Please retry.','STORAGE_UNAVAILABLE',503);if(!services.has(env.DB))services.set(env.DB,createCodeforcesService({cache:edgeCache,reserveSlot:()=>reserveCodeforcesSlot(env.DB)}));return services.get(env.DB);}
const activeByClient=new Map();
let activeJobs=0;
function jsonResponse(value,status=200,extra={}){return new Response(JSON.stringify(value),{status,headers:{...securityHeaders,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});}
export function createWorker({assets,comparisonService}={}) {
  return {async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname==='/api/health')return jsonResponse({ok:true,version:2});
    if(url.pathname==='/api/compare') {
      if(request.method!=='POST')return jsonResponse({error:'Use POST to generate a comparison.'},405,{Allow:'POST'});
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return jsonResponse({error:'Please refresh from the application page.'},403);
      if(!request.headers.get('Content-Type')?.includes('application/json'))return jsonResponse({error:'Send a JSON selection.'},415);
      if(Number(request.headers.get('Content-Length')||0)>4096)return jsonResponse({error:'Selection is too large.'},413);
      let input,selection;
      try{const raw=await request.text();if(raw.length>4096)return jsonResponse({error:'Selection is too large.'},413);input=JSON.parse(raw);selection=validateSelection(input);}catch(error){return jsonResponse({error:error.message||'Invalid selection.',code:'INVALID_SELECTION'},400);}
      let selectedService;try{selectedService=comparisonService||hostedService(env);}catch(error){return jsonResponse({error:error.message},503);}
      const client=request.headers.get('CF-Connecting-IP')||'local';
      if(activeByClient.has(client))return jsonResponse({error:'A comparison is already running for your connection. Please wait for it to finish.',code:'BUSY'},429,{'Retry-After':'15'});
      if(activeJobs>=4)return jsonResponse({error:'The refresh service is busy. Please try again in a minute.',code:'BUSY'},503,{'Retry-After':'30'});
      activeByClient.set(client,Date.now());activeJobs++;
      const encoder=new TextEncoder();
      const abort=new AbortController();
      let ended=false;
      const stream=new ReadableStream({
        start(controller) {
          const send=event=>{if(!ended){try{controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));}catch{ended=true;abort.abort();}}};
          const heartbeat=setInterval(()=>send({type:'heartbeat'}),10000);
          const timeout=setTimeout(()=>abort.abort(new Error('This comparison took too long. Try fewer handles.')),8*60*1000);
          const work=(async()=>{
            try {
              const data=await selectedService.compare(selection,{force:input.force===true,signal:abort.signal,onProgress:progress=>send({type:'progress',...progress})});
              if(abort.signal.aborted)throw abort.signal.reason;
              send({type:'result',data});
            } catch(error) {
              send({type:'error',error:error instanceof ServiceError||error?.message?String(error.message).slice(0,300):'The comparison failed. Please try again.',code:error.code||'REFRESH_FAILED'});
            } finally {
              clearInterval(heartbeat);clearTimeout(timeout);activeJobs--;activeByClient.delete(client);
              if(!ended){ended=true;controller.close();}
            }
          })();
          ctx?.waitUntil?.(work);
        },
        cancel(){ended=true;abort.abort();}
      });
      return new Response(stream,{headers:{...securityHeaders,'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'}});
    }
    if(url.pathname.startsWith('/api/'))return jsonResponse({error:'Endpoint not found.'},404);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...securityHeaders,Allow:'GET, HEAD'}});
    const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
    if(!asset)return new Response('Not found',{status:404,headers:securityHeaders});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{...securityHeaders,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
  }};
}
