// Publication prerequisite shared by npm and Homebrew, including job-only retries.
import { appendFileSync } from 'node:fs';

const workflowPath = '.github/workflows/ci.yml';
const budget = 20 * 60 * 1000;
const started = performance.now();
const [mode] = process.argv.slice(2);
const { GITHUB_REPOSITORY: repository, GH_TOKEN: token, RELEASE_TAG: tag } = process.env;
const shaPattern = /^[a-f0-9]{40}$/;
const pending = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const remaining = () => budget - (performance.now() - started);
function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}

async function api(path) {
  requireValue(remaining() > 0, 'Main CI wait exceeded the 20-minute budget');
  // Bound every request, including JSON body consumption. Never log response bodies.
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(Math.max(1, Math.min(30000, Math.floor(remaining())))),
    redirect: 'error',
  });
  requireValue(response.ok, `GitHub API read failed (HTTP ${response.status})`);
  const data = await response.json();
  requireValue(remaining() > 0, 'Main CI wait exceeded the 20-minute budget');
  return data;
}

async function resolveTag() {
  const ref = await api(`git/ref/tags/${encodeURIComponent(tag)}`);
  requireValue(ref.ref === `refs/tags/${tag}`, 'Release tag reference mismatch');
  let object = ref.object;
  for (let depth = 0; depth <= 10; depth++) {
    requireValue(object && shaPattern.test(object.sha), 'Invalid release tag object');
    if (object.type === 'commit') return object.sha;
    requireValue(object.type === 'tag' && depth < 10, 'Release tag does not resolve to a commit within 10 tag objects');
    const annotated = await api(`git/tags/${object.sha}`);
    requireValue(annotated.sha === object.sha, 'Annotated tag identity mismatch');
    object = annotated.object;
  }
}

function matches(run, workflowId, sha) {
  return run?.workflow_id === workflowId && run.path === workflowPath &&
    run.event === 'push' && run.head_branch === 'main' && run.head_sha === sha &&
    run.repository?.full_name === repository && run.head_repository?.full_name === repository;
}
function validateRun(run) {
  requireValue(positiveInteger(run.id) && positiveInteger(run.run_attempt) &&
    Number.isFinite(Date.parse(run.created_at)), 'Malformed main CI run identity');
  requireValue(run.status === 'completed' || pending.has(run.status), 'Unknown main CI run status');
  requireValue(run.status === 'completed' ? typeof run.conclusion === 'string' : run.conclusion === null,
    'Malformed main CI run conclusion');
  return run;
}

async function newestRun(workflowId, sha) {
  const runs = [];
  let total;
  // GitHub caps filtered searches at 1000; reject overflow rather than guess.
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ branch: 'main', event: 'push', head_sha: sha, per_page: '100', page: String(page) });
    const data = await api(`actions/workflows/${workflowId}/runs?${query}`);
    requireValue(Number.isSafeInteger(data.total_count) && data.total_count >= 0 && data.total_count <= 1000 &&
      Array.isArray(data.workflow_runs) && data.workflow_runs.length <= 100, 'Incomplete main CI run listing');
    total ??= data.total_count;
    requireValue(total === data.total_count, 'Main CI run listing changed during pagination; retry Publish');
    runs.push(...data.workflow_runs);
    if (runs.length >= total) break;
    requireValue(data.workflow_runs.length === 100, 'Truncated main CI run listing');
  }
  requireValue(runs.length === total && new Set(runs.map((run) => run?.id)).size === total,
    'Incomplete or duplicate main CI run listing');
  return runs.filter((run) => matches(run, workflowId, sha)).map(validateRun)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
}

function successful(run) {
  if (!run) return false;
  console.log(`Main CI run ${run.id} attempt ${run.run_attempt}: ${run.status}/${run.conclusion ?? 'pending'}`);
  if (run.status !== 'completed') return false;
  requireValue(run.conclusion === 'success', `Main CI run ${run.id} attempt ${run.run_attempt} did not succeed (${run.conclusion})`);
  return true;
}

async function check(sha) {
  requireValue(shaPattern.test(sha), 'Missing or invalid immutable release commit');
  const workflow = await api('actions/workflows/ci.yml');
  requireValue(positiveInteger(workflow.id) && workflow.path === workflowPath && workflow.state === 'active',
    'Expected active main CI workflow is unavailable');
  while (remaining() > 0) {
    requireValue(await resolveTag() === sha, 'Release tag moved away from the immutable release commit');
    const selected = await newestRun(workflow.id, sha);
    if (successful(selected)) {
      // Read the current attempt directly; never ask for a prior successful attempt.
      const current = validateRun(await api(`actions/runs/${selected.id}`));
      requireValue(matches(current, workflow.id, sha) && current.id === selected.id &&
        current.created_at === selected.created_at && current.run_attempt >= selected.run_attempt, 'Main CI run identity changed');
      if (successful(current)) {
        // A new main push run or rerun must not be hidden by the first green read.
        const latest = await newestRun(workflow.id, sha);
        if (successful(latest) && latest.id === current.id && latest.run_attempt === current.run_attempt) {
          requireValue(await resolveTag() === sha, 'Release tag moved away from the immutable release commit');
          console.log(`Main CI qualified commit ${sha}: run ${latest.id}, attempt ${latest.run_attempt}`);
          return;
        }
      }
    } else if (!selected) {
      console.log(`No main-push CI run yet for commit ${sha}`);
    }
    requireValue(mode !== 'verify', 'Fresh main CI success is unavailable; retry after inspecting CI');
    const delay = Math.min(15000, remaining());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error('Main CI wait exceeded the 20-minute budget');
}

try {
  requireValue(['resolve', 'wait', 'verify'].includes(mode), 'Expected resolve, wait or verify');
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') && token, 'Missing repository or API token');
  requireValue(/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag ?? ''), 'Release tag must use vX.Y.Z format');
  if (mode === 'resolve') {
    const sha = await resolveTag();
    // Release GITHUB_SHA denotes the tagged commit; dispatch GITHUB_SHA does not.
    if (process.env.GITHUB_EVENT_NAME === 'release') {
      requireValue(sha === process.env.GITHUB_SHA, 'Release event commit does not match the resolved tag');
    }
    requireValue(process.env.GITHUB_OUTPUT, 'Missing Actions output file');
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
    console.log(`Resolved release commit ${sha}`);
  } else {
    await check(process.env.RELEASE_SHA);
  }
} catch (error) {
  // Do not print fetch errors, URLs or API bodies that could contain credentials.
  const message = error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError', 'SyntaxError'].includes(error.name)
    ? error.message : 'GitHub API read failed or timed out';
  console.error(`Main CI gate failed: ${message}`);
  process.exitCode = 1;
}
