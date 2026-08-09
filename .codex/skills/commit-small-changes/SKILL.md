---
name: commit-small-changes
description: Implement repository changes as a series of small, single-responsibility Git commits. Use whenever Codex is asked to implement, fix, refactor, configure, document, or test code and the work will be committed; use for one change or a larger task that needs deliberate commit boundaries.
---

# Commit Small Changes

Treat a commit as one independently understandable and reviewable behavior change. Do not batch unrelated work merely because it was completed in the same session.

## Workflow

1. Inspect the working tree before editing. Identify pre-existing or unrelated changes and leave them unstaged unless the user explicitly includes them.
2. State or maintain a short sequence of change slices. Each slice must have one purpose, such as one bug fix, one production behavior, one migration, one focused test addition, or one documentation update inseparable from its behavior change.
3. Complete only the current slice. Keep refactors separate from functional changes unless the refactor is indispensable and small enough to explain in the same commit.
4. Run the narrowest meaningful validation for that slice. Escalate to broader checks when repository policy or risk warrants it.
5. Review the staged diff and verify that its subject can be expressed as one imperative sentence. If it requires `and`, a semicolon, or multiple unrelated clauses, split it.
6. Stage explicit paths or hunks for only that slice. Never use broad staging that can capture another person's work.
7. Commit immediately after validation with an imperative, scope-appropriate message. Do not amend, squash, rebase, or rewrite existing commits unless the user asks.
8. Repeat for each remaining slice. At the end, report the commit hashes, their purpose, and validation performed.

## Commit-boundary rules

- Combine only changes that must land together to work or to keep tests and documentation truthful.
- Separate generated artifacts, dependency updates, mechanical formatting, migrations, and unrelated cleanup unless they are strictly required by the same change.
- Include tests in the production-behavior commit they demonstrate. Put test-only coverage in its own commit when no production behavior changes.
- Make a documentation-only commit when documentation is not required to explain or operate the paired behavior change.
- Preserve a clean boundary around user-owned changes in a dirty tree. Ask before proceeding when the requested slice cannot be isolated safely.

## Before committing

- Read `git diff --cached` and `git status --short`.
- Confirm no secrets, local configuration, build outputs, or unrelated files are staged.
- Confirm the commit message names the outcome, not the process.
- Record the validation command and result for the final handoff.

## Exceptions

- If the user explicitly requests one squashed commit, follow that instruction after still applying the same review and validation checks.
- If a commit is not authorized, retain the same slice and staging discipline, then report the proposed commit boundary instead of committing.
- If tests cannot run, do not conceal it. Commit only when the user accepts that limitation or the failure is clearly unrelated; state the reason and evidence.
