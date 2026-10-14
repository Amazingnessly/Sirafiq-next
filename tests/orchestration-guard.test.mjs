import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFoundationPr, summarizeExactHeadCI } from '../scripts/check-orchestration-state.mjs';

const valid = {
  number: 1, state: 'open', merged_at: null, draft: true,
  base: { ref: 'main' }, head: { ref: 'feat/v0.1-foundation' }
};

test('PR #1 is protected when draft and unmerged', () => {
  assert.deepEqual(evaluateFoundationPr(valid), []);
});

test('PR #1 merged or ready is a hard violation', () => {
  assert.ok(evaluateFoundationPr({ ...valid, draft: false }).length > 0);
  assert.ok(evaluateFoundationPr({ ...valid, merged_at: '2026-10-15T00:00:00Z' }).length > 0);
  assert.ok(evaluateFoundationPr({ ...valid, base: { ref: 'integration/sirafiq-autonomous' } }).length > 0);
});

test('CI green only with exact SHA and successful completion', () => {
  const runs = [
    { id: 1, name: 'CI', head_sha: 'old', status: 'completed', conclusion: 'success', run_number: 9 },
    { id: 2, name: 'CI', head_sha: 'new', status: 'completed', conclusion: 'failure', run_number: 10 }
  ];
  assert.equal(summarizeExactHeadCI(runs, 'new').status, 'failed');
  assert.equal(summarizeExactHeadCI(runs, 'missing').status, 'unknown');
  assert.equal(summarizeExactHeadCI([{ ...runs[1], conclusion: 'success' }], 'new').status, 'success');
});

test('unfinished checks are not mistaken for green', () => {
  assert.equal(summarizeExactHeadCI([{ name: 'CI', head_sha: 'abc', status: 'in_progress', run_number: 1 }], 'abc').status, 'pending');
});
