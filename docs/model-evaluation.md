# Manual model evaluation

Use this procedure when comparing how two models handle the same bounded Release Relay story. It
is an occasional diagnostic, not a required step in ordinary development.

## Before the run

1. Choose a safe, deterministic story with observable acceptance criteria. Do not use a task that
   requires credentials, provider calls, production access, deployment, or an external oracle
   comparison.
2. Pin one base commit for every candidate.
3. Write the shared task, allowed scope, required gates, and scoring rubric before either model
   starts. Prompts may differ only in the candidate workspace path.
4. Decide what evidence will prove the behavior. Prefer a small reversible mutation that should
   make the relevant gate fail.

## Prepare isolated candidates

- Create a fresh physical checkout for each candidate and confirm each starts clean at the pinned
  commit.
- Keep dependency trees physically separate. Never share `node_modules` through a symlink: an
  install or repair command can follow it and rewrite another candidate or the source checkout.
- If dependencies are copied from an existing checkout, copy them into each candidate and verify
  that the copies are not shared links. Do not run an install during the model task.
- Do not expose credentials to candidate environments. Keep network, GitHub, provider, deployment,
  and production operations outside the trial.

Record the base commit, initial status, task text, rubric, and candidate-to-model mapping. Keep the
mapping away from the reviewer.

## Run the candidates

- Give every candidate the same task and acceptance criteria.
- Do not let candidates inspect sibling workspaces or the scoring rubric.
- Do not coach one candidate through routine failures. If the environment itself is invalid,
  discard the affected run and restart every candidate from fresh equal conditions.
- Leave the candidate changes reviewable; a local comparison does not need commits, pushes, or
  pull requests.

## Verify independently

Treat model reports as claims, not proof.

1. Inspect the changed paths and diff against the frozen scope.
2. Run the same repository gates for every candidate and capture exact test counts and failures.
3. Apply the planned reversible mutation to each candidate. Confirm the intended gate fails for
   the intended reason, then restore the mutation.
4. Rerun the clean gates after restoration.
5. Give anonymous diffs and the frozen rubric to the reviewer. Score implementation correctness,
   verification, scope discipline, and reporting separately.

## Invalidate rather than explain away

Do not score a trial when candidates used different base commits or prompts, shared mutable
dependencies, received unequal implementation help, crossed a prohibited external boundary, or
cannot reproduce their claimed gates. Record why it was invalid and start again if the comparison
is still useful.

Keep the task, rubric, final diffs, gate output, mutation result, and anonymous review together as
the evaluation record.

This manual procedure is enough while comparisons are occasional. Build automation only after
repeated use makes the manual setup or evidence collection meaningfully costly.
