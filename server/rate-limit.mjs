export const RESERVE_SQL="INSERT INTO api_gate(name,next_at) VALUES ('codeforces', ? + 2400) ON CONFLICT(name) DO UPDATE SET next_at = MAX(api_gate.next_at, ?) + 2400 WHERE api_gate.next_at < ? + 45000 RETURNING next_at";
export async function reserveCodeforcesSlot(db,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!db)throw new Error('Refresh storage is unavailable. Please try again shortly.');
  const started=now();
  let row;try{row=await db.prepare(RESERVE_SQL).bind(started,started,started).first();}catch{throw new Error('The refresh coordinator is temporarily unavailable. Please retry.');}
  if(!row)throw new Error('The refresh service is busy. Please try again in a minute.');
  await sleep(Math.max(0,row.next_at-2400-now()));
}
