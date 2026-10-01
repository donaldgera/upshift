import {absorbSubmissions,validateSelection,compareHistories} from '../lib/comparison.mjs';

export class ServiceError extends Error {
  constructor(message,code='UPSTREAM_ERROR',status=502){super(message);this.code=code;this.status=status;}
}
export const HISTORY_TTL=15*60*1000;
export const CATALOG_TTL=6*60*60*1000;
export function createMemoryCache(maxEntries=80) {
  const entries=new Map();
  return {async get(key){return entries.get(key)||null;},async put(key,value){entries.delete(key);entries.set(key,value);while(entries.size>maxEntries)entries.delete(entries.keys().next().value);}};
}
export function abortable(promise,signal) {
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason||new DOMException('Refresh cancelled.','AbortError'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function createCodeforcesService({fetchImpl=fetch,cache=createMemoryCache(),reserveSlot=null,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=2200,pageSize=5000,maxPages=50}={}) {
  let tail=Promise.resolve(),lastStart=0,waiting=0;
  const historiesInFlight=new Map();
  let catalogInFlight=null;
  async function api(method,params={}) {
    let lastError;
    for(let attempt=0;attempt<3;attempt++) {
      if(waiting>=24)throw new ServiceError('The refresh service is busy. Please try again in a minute.','BUSY',503);
      waiting++;
      const previous=tail;
      let release;
      tail=new Promise(resolve=>{release=resolve;});
      try {
        await previous;
        await sleep(Math.max(0,interval-(now()-lastStart)));
        if(reserveSlot)await reserveSlot();
        lastStart=now();
        const url=new URL(`https://codeforces.com/api/${method}`);
        url.search=new URLSearchParams(params).toString();
        const response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'UpsolveAtlas/2.1'},signal:AbortSignal.timeout(45000)});
        if(!response.ok)throw new ServiceError(response.status===403?'Codeforces is temporarily blocking requests from the hosting service. Try again later.':response.status===429?'Codeforces is busy or rate-limiting requests. Try again shortly.':`Codeforces returned HTTP ${response.status}. Try again shortly.`,response.status===429?'RATE_LIMITED':'UPSTREAM_ERROR');
        const text=await response.text();
        let data;try{data=JSON.parse(text);}catch{throw new ServiceError('Codeforces returned an unexpected response. Your previous results are safe.');}
        if(data.status!=='OK') {
          const message=String(data.comment||'Codeforces request failed.').slice(0,250);
          if(/not found|invalid handle|not valid|handles:|handle:/i.test(message)&&!/limit/i.test(message))throw new ServiceError(message,'INVALID_HANDLE',400);
          throw new ServiceError(message,/limit/i.test(message)?'RATE_LIMITED':'UPSTREAM_ERROR');
        }
        return data.result;
      } catch(error) {
        lastError=error instanceof ServiceError?error:new ServiceError(error.name==='TimeoutError'?'Codeforces took too long to respond. Try again shortly.':'Could not reach Codeforces. Check back shortly.');
        if(lastError.code==='INVALID_HANDLE')throw lastError;
      } finally {waiting--;release();}
      if(attempt<2)await sleep(3000*2**attempt);
    }
    throw lastError;
  }
  async function readCache(key){try{return await cache.get(key);}catch{return null;}}
  async function saveCache(key,value){try{await cache.put(key,value);}catch{/* A cache outage must not discard a complete refresh. */}}
  async function profiles(selection,force) {
    const handles=[selection.learner,...selection.sources];
    const key=`profiles:${handles.map(h=>h.toLowerCase()).join(';')}`;
    const cached=await readCache(key);
    if(!force&&cached&&now()-cached.storedAt<HISTORY_TTL)return {...cached.value,mode:selection.mode};
    const result=await api('user.info',{handles:handles.join(';'),checkHistoricHandles:'false'});
    if(!Array.isArray(result)||result.length!==handles.length||result.some(p=>typeof p.handle!=='string'))throw new ServiceError('Codeforces could not validate all selected handles.');
    const canonical=validateSelection({learner:result[0].handle,sources:result.slice(1).map(p=>p.handle),mode:selection.mode});
    await saveCache(key,{storedAt:now(),value:canonical});
    return canonical;
  }
  async function history(handle,force,onProgress=()=>{}) {
    const key=`history:${handle.toLowerCase()}`;
    const cached=await readCache(key);
    if(!force&&cached&&now()-Date.parse(cached.fetchedAt)<HISTORY_TTL){onProgress({message:`Using a recent history for ${handle}.`,handle,cached:true,submissions:cached.submissionCount});return cached;}
    const current=historiesInFlight.get(key);
    if(current){onProgress({message:`Waiting for the refresh already running for ${handle}.`,handle});return current;}
    const promise=(async()=>{
      const accepted=new Map(),seen=new Set();let from=1,count=0,exhausted=false;
      for(let pageNumber=0;pageNumber<=maxPages;pageNumber++) {
        onProgress({message:`Reading ${handle} · ${count.toLocaleString('en-GB')} submissions checked`,handle,submissions:count});
        const page=await api('user.status',{handle,from,count:pageSize});
        if(!Array.isArray(page))throw new ServiceError(`Incomplete submission history for ${handle}.`);
        if(!page.length){exhausted=true;break;}
        if(pageNumber===maxPages)break;
        let added=0;
        for(const s of page){if(!seen.has(s.id)){seen.add(s.id);added++;}}
        if(!added)throw new ServiceError(`Codeforces stopped paging through ${handle}'s history. Please retry.`);
        absorbSubmissions(accepted,page);
        count=seen.size;from+=page.length;
        if(accepted.size>30000)throw new ServiceError(`${handle}'s history is too large for this service (30,000 solved problems). No partial queue was generated.`,'HISTORY_TOO_LARGE',422);
      }
      if(!exhausted)throw new ServiceError(`${handle}'s history exceeds the supported ${maxPages*pageSize} submissions. No partial queue was generated.`,'HISTORY_TOO_LARGE',422);
      const result={handle,accepted:[...accepted.values()],submissionCount:count,fetchedAt:new Date(now()).toISOString()};
      await saveCache(key,result);return result;
    })();
    historiesInFlight.set(key,promise);
    try{return await promise;}finally{historiesInFlight.delete(key);}
  }
  async function catalog(force=false) {
    const cached=await readCache('catalog');
    if(!force&&cached&&now()-cached.storedAt<CATALOG_TTL)return cached;
    if(catalogInFlight)return catalogInFlight;
    catalogInFlight=(async()=>{
      const p=await api('problemset.problems');
      const gyms=await api('contest.list',{gym:'true'});
      if(!Array.isArray(p?.problems)||!Array.isArray(gyms))throw new ServiceError('Codeforces returned an incomplete problem catalog.');
      const result={storedAt:now(),problems:p.problems.map(p=>({contestId:p.contestId,index:p.index,name:p.name,rating:p.rating??null,tags:p.tags||[]})),gymIds:gyms.map(g=>g.id)};
      await saveCache('catalog',result);return result;
    })();
    try{return await catalogInFlight;}finally{catalogInFlight=null;}
  }
  async function compare(input,{force=false,onProgress=()=>{},signal}={}) {
    let selection;
    try{selection=validateSelection(input);}catch(e){throw new ServiceError(e.message,'INVALID_SELECTION',400);}
    const total=selection.sources.length+3;
    let completed=0;
    const emit=details=>onProgress({completed,total,...details});
    signal?.throwIfAborted();emit({message:'Checking Codeforces handles…'});
    selection=await abortable(profiles(selection,force),signal);completed++;
    const histories=[];
    for(const handle of [selection.learner,...selection.sources]) {
      signal?.throwIfAborted();
      histories.push(await abortable(history(handle,force,emit),signal));completed++;
      emit({message:`${handle}: ${histories.at(-1).accepted.length.toLocaleString('en-GB')} solved problems`,handle});
    }
    signal?.throwIfAborted();emit({message:'Loading ratings and problem information…'});
    const metadata=await abortable(catalog(force),signal);completed++;
    const unique=new Set(histories.slice(1).flatMap(h=>h.accepted.map(p=>p.key)));
    if(unique.size>60000)throw new ServiceError('This selection contains more than 60,000 source problems. Choose fewer sources.','SELECTION_TOO_LARGE',422);
    const result=compareHistories(selection,histories,metadata,new Date(now()).toISOString());
    emit({message:'Comparison complete.',completed:total});
    return result;
  }
  return {compare,history,catalog,api};
}
