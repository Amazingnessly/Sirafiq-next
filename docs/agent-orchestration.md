# Controlled agent orchestration

This repository may be developed by multiple coding agents, but product mutations stay
serial. Parallelism is reserved for read-only scouting and review so that the vertical
delivery rule in `AGENTS.md` remains true.

## Wave contract

A wave has four phases:

1. **Scout** — independent read-only audits may run in parallel (product/reliability,
   Worker/R2, IndexedDB/offline, tests/E2E).
2. **Select** — choose one high-impact, independently shippable change. Prefer reliability
   over surface area.
3. **Implement** — one implementation branch based on the current
   `feat/v0.1-foundation` HEAD. Do not run competing product mutations in parallel.
4. **Verify** — require the repository checks and iPad-sized E2E workflow on the exact
   implementation HEAD. Repair failures on the same branch. Merge only after all required
   checks succeed, then start the next wave from the new integration HEAD.

## Hard stops

- Never auto-merge PR #1. Its physical iPad and real D1/R2 validations are external.
- Never weaken, skip, delete, or retry-away a failing test merely to obtain green CI.
- Never report success from a stale SHA.
- Stop when a change requires credentials, real hardware, destructive production action,
  or a genuinely unresolved product decision.
- Stop a wave after three repair attempts and surface the concrete blocker.
- Keep one concern per implementation PR and avoid files already being mutated by another
  active implementation branch.

## Suggested roles

| Role | Mutation rights | Responsibility |
| --- | --- | --- |
| product-scout | read-only | Find incomplete or misleading user journeys. |
| reliability-scout | read-only | Inspect persistence, sync, retry and failure states. |
| worker-scout | read-only | Inspect Worker, D1, R2 and HTTP contracts. |
| test-scout | read-only | Find missing coverage and flaky/non-representative tests. |
| implementer | branch only | Implement the single selected vertical change. |
| reviewer | read-only | Review diff, exact-head CI and regression risk. |
| repairer | same branch | Fix a verified CI failure without weakening coverage. |
| integrator | merge only | Merge an exact-head green PR into the integration branch. |

## Orchestrator state

An external orchestrator should persist at least:

```json
{
  "wave": 1,
  "integrationBranch": "feat/v0.1-foundation",
  "integrationHead": "<sha>",
  "selectedTask": null,
  "implementationPr": null,
  "implementationHead": null,
  "repairAttempts": 0,
  "phase": "scout"
}
```

Allowed phases are `scout -> select -> implement -> verify -> repair|merge -> scout`.
Any external stop moves the wave to `blocked` instead of spawning another agent.

## GitHub boundary

GitHub Actions remains the source of truth for verification. Agent orchestration must not
grant a workflow permission to merge arbitrary PRs. The integrator should verify the PR
base is `feat/v0.1-foundation`, the PR number is not 1, the expected head SHA still
matches, and all required checks are successful immediately before merge.

The existing CI workflow is intentionally unchanged: orchestration coordinates work; it
does not redefine what passing means.
