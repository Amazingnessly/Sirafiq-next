import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const TARGET_REPO = 'Amazingnessly/Sirafiq-next';

export function evaluateFoundationPr(pr) {
  const violations = [];
  if (pr.number !== 1) violations.push('Expected PR #1');
  if (pr.state !== 'open' || pr.merged_at) violations.push('PR #1 must remain open and unmerged');
  if (pr.draft !== true) violations.push('PR #1 must remain DRAFT');
  if (pr.base?.ref !== 'main') violations.push('PR #1 must target main');
  if (pr.head?.ref !== 'feat/v0.1-foundation') violations.push('PR #1 must originate from feat/v0.1-foundation');
  return violations;
}

export function summarizeExactHeadCI(runs, headSha) {
  const found = runs
    .filter((run) => run.head_sha === headSha && run.name === 'CI')
    .sort((a, b) => (b.run_number ?? 0) - (a.run_number ?? 0));
  const latest = found[0];
  if (!latest) return { status: 'unknown', reason: 'No exact-head CI run found' };
  if (latest.status !== 'completed') return { status: 'pending', runId: latest.id };
  return {
    status: latest.conclusion === 'success' ? 'success' : 'failed',
    runId: latest.id,
    conclusion: latest.conclusion ?? 'unknown',
    url: latest.html_url ?? null
  };
}

async function githubJson(path, token) {
  const url = 'https://api.github.com/repos/' + TARGET_REPO + path;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (response.ok) return response.json();
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error('GitHub API request failed: ' + response.status + ' for ' + path);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error('Unreachable GitHub retry state');
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== TARGET_REPO) {
    throw new Error('Refusing to run outside ' + TARGET_REPO);
  }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is required (read-only Actions token)');
  const pr = await githubJson('/pulls/1', token);
  const violations = evaluateFoundationPr(pr);
  const [foundationRef, integrationRef] = await Promise.all([
    githubJson('/git/ref/heads/feat/v0.1-foundation', token),
    githubJson('/git/ref/heads/integration/sirafiq-autonomous', token)
  ]);
  const foundationSha = foundationRef.object.sha;
  if (pr.head.sha !== foundationSha) violations.push('PR #1 head SHA differs from foundation ref');
  const runList = await githubJson('/actions/runs?head_sha=' + encodeURIComponent(foundationSha) + '&per_page=50', token);
  const foundationCI = summarizeExactHeadCI(runList.workflow_runs ?? [], foundationSha);
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    repository: TARGET_REPO,
    mode: 'read-only-guard',
    v01: {
      pr: 1,
      draft: pr.draft,
      state: pr.state,
      merged: Boolean(pr.merged_at),
      head: foundationSha,
      physicalIpadValidated: false
    },
    integration: { branch: 'integration/sirafiq-autonomous', head: integrationRef.object.sha },
    foundationCI,
    guard: violations.length ? 'failed' : 'passed',
    violations,
    codexMutationsEnabled: false,
    automatedMergeEnabled: false
  };
  await mkdir('orchestration', { recursive: true });
  await writeFile('orchestration/report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '### Sirāfiq read-only guard\n' +
      '- PR #1 draft/open: ' + (violations.length ? 'FAIL' : 'PASS') + '\n' +
      '- Foundation SHA: ' + foundationSha + '\n' +
      '- Exact-head CI: ' + foundationCI.status + '\n' +
      '- Integration SHA: ' + integrationRef.object.sha + '\n' +
      '- Physical iPad test: NOT VERIFIED\n' +
      '- Autonomous Codex development: NOT ENABLED\n'
    );
  }
  if (violations.length) throw new Error(violations.join('; '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
