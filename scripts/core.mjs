export function problemKey(problem) {
  if (problem.contestId != null) return `${problem.contestId}:${problem.index}`;
  if (problem.problemsetName) return `set:${problem.problemsetName}:${problem.index}`;
  throw new Error('A problem has no stable Codeforces identity.');
}

export function acceptedProblems(submissions) {
  const solved = new Map();
  for (const submission of submissions) {
    if (submission.verdict !== 'OK') continue;
    if (!Number.isFinite(submission.creationTimeSeconds)) throw new Error('Missing submission date.');
    const key = problemKey(submission.problem);
    const previous = solved.get(key);
    if (!previous || submission.creationTimeSeconds < previous.creationTimeSeconds) {
      solved.set(key, submission);
    }
  }
  return solved;
}

export function buildSnapshot(catgirl, donaldgera, metadata, gymIds, now = new Date()) {
  const source = acceptedProblems(catgirl);
  const target = acceptedProblems(donaldgera);
  const catalog = new Map(metadata.map(p => [problemKey(p), p]));
  const problems = [];
  const completedProblems = [];
  for (const [key, submission] of source) {
    const original = submission.problem;
    const problem = { ...original, ...catalog.get(key) };
    const contestId = original.contestId;
    const index = original.index;
    const url = contestId != null
      ? `https://codeforces.com/${gymIds.has(contestId) ? 'gym' : 'contest'}/${contestId}/problem/${encodeURIComponent(index)}`
      : `https://codeforces.com/problemsets/${encodeURIComponent(original.problemsetName)}/problem/99999/${encodeURIComponent(index)}`;
    const entry = {
      key, id: contestId != null ? `${contestId}${index}` : `${original.problemsetName}/${index}`,
      title: problem.name, rating: Number.isFinite(problem.rating) ? problem.rating : null,
      url, firstSolvedAt: new Date(submission.creationTimeSeconds * 1000).toISOString(),
      firstSolvedSeconds: submission.creationTimeSeconds, firstSubmissionId: submission.id,
      firstSubmissionUrl: contestId != null
        ? `https://codeforces.com/${gymIds.has(contestId) ? 'gym' : 'contest'}/${contestId}/submission/${submission.id}`
        : `https://codeforces.com/problemsets/${encodeURIComponent(original.problemsetName)}/submission/99999/${submission.id}`,
    };
    const targetSubmission = target.get(key);
    if (targetSubmission) {
      completedProblems.push({ ...entry,
        targetFirstSolvedAt: new Date(targetSubmission.creationTimeSeconds * 1000).toISOString(),
        targetFirstSubmissionId: targetSubmission.id,
      });
    } else {
      problems.push(entry);
    }
  }
  const chronological = (a, b) => a.firstSolvedSeconds - b.firstSolvedSeconds || a.key.localeCompare(b.key, 'en', { numeric: true });
  problems.sort(chronological);
  completedProblems.sort(chronological);
  return {
    schemaVersion: 1, source: 'catgirl', target: 'donaldgera', lastSuccessfulUpdate: now.toISOString(),
    stats: { catgirlSubmissions: catgirl.length, donaldgeraSubmissions: donaldgera.length,
      catgirlSolved: source.size, donaldgeraSolved: target.size, remaining: problems.length,
      sharedSolved: completedProblems.length,
      unrated: problems.filter(p => p.rating == null).length },
    problems, completedProblems,
  };
}

export function filterCompletedProblems(problems, minRating = null) {
  if (minRating === null) return problems;
  if (!Number.isSafeInteger(minRating) || minRating < 0) return [];
  return problems.filter(p => Number.isFinite(p.rating) && p.rating >= minRating);
}

export function eligibleProblems(problems, maxRating) {
  if (!Number.isInteger(maxRating) || maxRating < 0) return [];
  return problems.filter(p => Number.isFinite(p.rating) && p.rating <= maxRating);
}

export function chooseProblem(problems, maxRating, previousKey = null, random = Math.random) {
  const eligible = eligibleProblems(problems, maxRating);
  const pool = eligible.length > 1 ? eligible.filter(p => p.key !== previousKey) : eligible;
  return pool.length ? pool[Math.floor(random() * pool.length)] : null;
}

export async function fetchHistory(request, handle, pageSize = 5000) {
  const submissions = new Map();
  let from = 1;
  for (;;) {
    const page = await request('user.status', { handle, from, count: pageSize });
    if (!Array.isArray(page)) throw new Error(`Invalid submission history for ${handle}.`);
    if (page.length === 0) break;
    let added = 0;
    for (const submission of page) {
      if (!Number.isInteger(submission.id) || !submission.problem) throw new Error('Invalid submission record.');
      if (!submissions.has(submission.id)) added++;
      submissions.set(submission.id, submission);
    }
    if (!added) throw new Error(`Pagination stopped advancing for ${handle}.`);
    from += page.length;
  }
  return [...submissions.values()];
}
