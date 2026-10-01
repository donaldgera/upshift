export const MAX_SOURCES = 5;
export function normalizeHandle(value) {
  const handle = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) throw new Error('Enter a handle using letters, numbers, dots, underscores, or hyphens (up to 64 characters).');
  return handle;
}
export function validateSelection(input) {
  if (!input || !Array.isArray(input.sources)) throw new Error('Choose your handle and at least one source handle.');
  const learner = normalizeHandle(input.learner);
  if (input.sources.length < 1 || input.sources.length > MAX_SOURCES) throw new Error(`Choose between 1 and ${MAX_SOURCES} source handles.`);
  const sources = input.sources.map(normalizeHandle);
  const keys = sources.map(h => h.toLowerCase());
  if (new Set(keys).size !== sources.length) throw new Error('Each source handle must be unique.');
  if (keys.includes(learner.toLowerCase())) throw new Error('Your handle cannot also be a source handle.');
  const mode = input.mode || 'any';
  if (!['any','all'].includes(mode)) throw new Error('Choose “Any source” or “All sources”.');
  return {learner,sources,mode};
}
export function selectionKey(input) {
  const s = validateSelection(input);
  return `${s.learner.toLowerCase()}|${s.sources.map(h=>h.toLowerCase()).sort().join(',')}|${s.mode}`;
}
export function identity(p) {
  if (!p || typeof p.index !== 'string') throw new Error('Codeforces returned an incomplete problem.');
  if (Number.isInteger(p.contestId)) return `${p.contestId}:${p.index}`;
  if (p.problemsetName) return `set:${p.problemsetName}:${p.index}`;
  throw new Error('Codeforces returned a problem without an identifier.');
}
export function earlier(a,b) {
  return a.time-b.time || a.submissionId-b.submissionId || (a.handle || '').toLowerCase().localeCompare((b.handle || '').toLowerCase());
}
export function absorbSubmissions(accepted, page) {
  for (const s of page) {
    if (!Number.isSafeInteger(s.id) || !s.problem || !Number.isFinite(s.creationTimeSeconds)) throw new Error('Codeforces returned an incomplete submission record.');
    if (s.verdict !== 'OK') continue;
    const key=identity(s.problem);
    const record={key,submissionId:s.id,time:s.creationTimeSeconds,problem:{contestId:s.problem.contestId,index:s.problem.index,problemsetName:s.problem.problemsetName,name:s.problem.name,rating:s.problem.rating ?? null,tags:s.problem.tags || []}};
    if (!accepted.has(key) || earlier(record,accepted.get(key))<0) accepted.set(key,record);
  }
}
export function problemUrls(p,submissionId,gymIds=new Set()) {
  if (p.contestId != null) {
    const root=`https://codeforces.com/${gymIds.has(p.contestId)?'gym':'contest'}/${p.contestId}`;
    return {url:`${root}/problem/${encodeURIComponent(p.index)}`,submissionUrl:`${root}/submission/${submissionId}`};
  }
  const root=`https://codeforces.com/problemsets/${encodeURIComponent(p.problemsetName)}`;
  return {url:`${root}/problem/99999/${encodeURIComponent(p.index)}`,submissionUrl:`${root}/submission/99999/${submissionId}`};
}
export function compareHistories(selection,histories,catalog={problems:[],gymIds:[]},generatedAt=new Date().toISOString()) {
  const s=validateSelection(selection);
  const byHandle=new Map(histories.map(h=>[h.handle.toLowerCase(),h]));
  const learner=byHandle.get(s.learner.toLowerCase());
  const sourceHistories=s.sources.map(h=>byHandle.get(h.toLowerCase()));
  if (!learner || sourceHistories.some(h=>!h)) throw new Error('A complete history is required for every selected handle.');
  const target=new Map(learner.accepted.map(p=>[p.key,p]));
  const metadata=new Map((catalog.problems||[]).map(p=>[identity(p),p]));
  const gyms=new Set(catalog.gymIds || []);
  const union=new Map();
  for (const history of sourceHistories) for (const record of history.accepted) {
    let entry=union.get(record.key);
    if (!entry) { entry=[];union.set(record.key,entry); }
    // Histories are already deduplicated, but enforce unique sources at this boundary too.
    const existing=entry.findIndex(r=>r.handle.toLowerCase()===history.handle.toLowerCase());
    const withHandle={...record,handle:history.handle};
    if(existing<0) entry.push(withHandle); else if(earlier(withHandle,entry[existing])<0)entry[existing]=withHandle;
  }
  const queue=[],completed=[];
  for (const [key,records] of union) {
    if (s.mode==='all' && records.length!==sourceHistories.length) continue;
    records.sort(earlier);
    const first=records[0];
    const p={...first.problem,...metadata.get(key)};
    const links=problemUrls(p,first.submissionId,gyms);
    const learnerRecord=target.get(key);
    const entry={key,id:p.contestId!=null?`${p.contestId}${p.index}`:`${p.problemsetName}/${p.index}`,title:p.name || key,rating:Number.isFinite(p.rating)?p.rating:null,tags:p.tags||[],url:links.url,firstSolvedAt:new Date(first.time*1000).toISOString(),firstSolvedSeconds:first.time,sourceHandle:first.handle,firstSubmissionId:first.submissionId,firstSubmissionUrl:links.submissionUrl,
      solvedBy:records.map(r=>({handle:r.handle,firstSolvedAt:new Date(r.time*1000).toISOString(),submissionUrl:problemUrls(r.problem,r.submissionId,gyms).submissionUrl})),
      learnerSolvedAt:learnerRecord?new Date(learnerRecord.time*1000).toISOString():null,
      learnerSubmissionUrl:learnerRecord?problemUrls(learnerRecord.problem,learnerRecord.submissionId,gyms).submissionUrl:null};
    (learnerRecord?completed:queue).push(entry);
  }
  const order=(a,b)=>a.firstSolvedSeconds-b.firstSolvedSeconds||a.key.localeCompare(b.key,'en',{numeric:true});
  queue.sort(order);completed.sort(order);
  const stamps=histories.map(h=>Date.parse(h.fetchedAt));
  if(stamps.some(n=>!Number.isFinite(n)))throw new Error('Missing history freshness information.');
  return {schemaVersion:2,selection:{learner:learner.handle,sources:sourceHistories.map(h=>h.handle),mode:s.mode},generatedAt,
    lastSuccessfulRefresh:new Date(Math.min(...stamps)).toISOString(),
    histories:histories.map(h=>({handle:h.handle,solved:h.accepted.length,submissions:h.submissionCount,fetchedAt:h.fetchedAt})),
    stats:{queue:queue.length,completed:completed.length,sourceTotal:queue.length+completed.length,learnerSolved:learner.accepted.length,unrated:queue.filter(p=>p.rating===null).length},
    sourceStats:sourceHistories.map(h=>({handle:h.handle,solved:h.accepted.length,shared:h.accepted.filter(p=>target.has(p.key)).length,remaining:h.accepted.filter(p=>!target.has(p.key)).length})),queue,completed};
}
export function filterProblems(problems,{search='',min=null,max=null,tag='',sort='oldest'}={}) {
  const term=search.trim().toLowerCase();
  const result=problems.filter(p=>(!term||`${p.id} ${p.title}`.toLowerCase().includes(term))&&(!tag||p.tags.includes(tag))&&(min===null||p.rating!==null&&p.rating>=min)&&(max===null||p.rating!==null&&p.rating<=max));
  const chronological=(a,b)=>a.firstSolvedSeconds-b.firstSolvedSeconds||a.key.localeCompare(b.key,'en',{numeric:true});
  result.sort(sort==='newest'?(a,b)=>chronological(b,a):sort==='rating-asc'?(a,b)=>(a.rating??Infinity)-(b.rating??Infinity)||chronological(a,b):sort==='rating-desc'?(a,b)=>(b.rating??-Infinity)-(a.rating??-Infinity)||chronological(a,b):chronological);
  return result;
}
export function validRatingRange(minRating,maxRating) {
  return Number.isSafeInteger(minRating)&&Number.isSafeInteger(maxRating)&&minRating>=0&&maxRating>=minRating;
}
export function recommendationPool(problems,minRating,maxRating) {
  return validRatingRange(minRating,maxRating)?problems.filter(p=>Number.isFinite(p.rating)&&p.rating>=minRating&&p.rating<=maxRating):[];
}
export function recommend(problems,minRating,maxRating,previousKey=null,random=Math.random) {
  const eligible=recommendationPool(problems,minRating,maxRating);
  const choices=eligible.length>1?eligible.filter(p=>p.key!==previousKey):eligible;
  return choices.length?choices[Math.floor(random()*choices.length)]:null;
}
