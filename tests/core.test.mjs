import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, fetchHistory, chooseProblem, eligibleProblems, filterCompletedProblems } from '../scripts/core.mjs';
const s = (id, contestId, index, time, verdict = 'OK', rating = 1200) => ({ id, verdict, creationTimeSeconds: time, problem: { contestId, index, name: `Problem ${index}`, rating } });
test('first acceptance, unique identity, complete target exclusion, and chronological order', () => {
  const cat = [s(5, 12, 'A', 500), s(1, 12, 'A', 100), s(2, 12, 'B', 200), s(3, 13, 'A', 300), s(4, 12, 'C', 50, 'WRONG_ANSWER')];
  const don = [s(10, 12, 'B', 900), s(11, 13, 'A', 400, 'WRONG_ANSWER')];
  const result = buildSnapshot(cat, don, [{contestId:12,index:'A',name:'Current title',rating:1700}], new Set());
  assert.deepEqual(result.problems.map(p => p.id), ['12A','13A']);
  assert.equal(result.problems[0].firstSolvedSeconds,100);
  assert.equal(result.problems[0].rating,1700);
  assert.equal(result.problems[0].title,'Current title');
  assert.equal(result.problems[0].firstSubmissionUrl,'https://codeforces.com/contest/12/submission/1');
  assert.equal(result.stats.sharedSolved,1);
  assert.deepEqual(result.completedProblems.map(p => p.id), ['12B']);
  assert.equal(result.completedProblems[0].targetFirstSolvedAt, new Date(900000).toISOString());
  assert.equal(result.completedProblems[0].firstSubmissionUrl,'https://codeforces.com/contest/12/submission/2');
});
test('gym links and missing ratings are preserved', () => {
  const result = buildSnapshot([s(1, 100001, 'A', 10, 'OK', null)], [], [], new Set([100001]));
  assert.equal(result.problems[0].url,'https://codeforces.com/gym/100001/problem/A');
  assert.equal(result.problems[0].firstSubmissionUrl,'https://codeforces.com/gym/100001/submission/1');
  assert.equal(result.problems[0].rating,null);
  assert.equal(result.stats.unrated,1);
});
test('a newly solved target problem disappears and a new source solve is inserted by date', () => {
  const result = buildSnapshot([s(1,1,'A',100),s(2,2,'B',200),s(3,3,'C',300)], [s(4,1,'A',400)], [], new Set());
  assert.deepEqual(result.problems.map(p=>p.id),['2B','3C']);
  assert.deepEqual(result.completedProblems.map(p=>p.id),['1A']);
});
test('completed list is a unique accepted intersection with each user’s first acceptance', () => {
  const cat = [s(1,1,'A',30),s(2,1,'A',10),s(3,2,'B',20),s(4,3,'C',40,'WRONG_ANSWER')];
  const don = [s(5,1,'A',60),s(6,1,'A',50),s(7,2,'B',45),s(8,3,'C',55),s(9,4,'D',60)];
  const result = buildSnapshot(cat,don,[],new Set());
  assert.deepEqual(result.completedProblems.map(p=>p.id),['1A','2B']);
  assert.equal(result.completedProblems[0].firstSolvedSeconds,10);
  assert.equal(result.completedProblems[0].targetFirstSubmissionId,6);
  assert.equal(result.stats.remaining,0);
  assert.equal(result.stats.sharedSolved,2);
});
test('completed minimum rating is inclusive and clearing it restores unrated problems', () => {
  const problems=[{key:'a',rating:1500},{key:'b',rating:1600},{key:'c',rating:2000},{key:'d',rating:null}];
  assert.deepEqual(filterCompletedProblems(problems,1600).map(p=>p.key),['b','c']);
  assert.deepEqual(filterCompletedProblems(problems,null),problems);
  assert.deepEqual(filterCompletedProblems(problems,0).map(p=>p.key),['a','b','c']);
  assert.deepEqual(filterCompletedProblems(problems,9999),[]);
  assert.deepEqual(filterCompletedProblems(problems,-1),[]);
});
test('pagination reads through empty page, including overlaps and short intermediate pages', async () => {
  const calls=[];
  const pages=[[s(4,1,'A',40),s(3,1,'B',30)],[s(3,1,'B',30),s(2,1,'C',20)],[s(1,1,'D',10)],[]];
  const result=await fetchHistory(async (_,params)=>{calls.push(params.from);return pages.shift();},'catgirl',2);
  assert.deepEqual(calls,[1,3,5,6]);
  assert.equal(result.length,4);
});
test('a failed or non-advancing history fails instead of publishing a partial list', async () => {
  await assert.rejects(fetchHistory(async()=>({}), 'catgirl'), /Invalid/);
  await assert.rejects(fetchHistory(async()=>[s(1,1,'A',10)], 'catgirl'), /stopped advancing/);
});
test('random limit is inclusive, unrated excluded, repeat avoided when possible', () => {
  const problems=[{key:'a',rating:800},{key:'b',rating:1600},{key:'c',rating:1700},{key:'d',rating:null}];
  assert.deepEqual(eligibleProblems(problems,1600).map(p=>p.key),['a','b']);
  assert.equal(chooseProblem(problems,1600,'a',()=>0).key,'b');
  assert.equal(chooseProblem(problems,800,'a',()=>0).key,'a');
  assert.equal(chooseProblem(problems,700),null);
  assert.equal(chooseProblem(problems,NaN),null);
});
