---
name: commit-small-changes
description: Keep implementation work in small, single-responsibility Git commits. Use when implementing, fixing, refactoring, configuring, documenting, or testing code that will be committed.
---

# Commit Small Changes

1. Inspect `git status`; preserve unrelated changes.
2. Implement and validate one responsibility at a time.
3. Stage only that slice and review `git diff --cached`.
4. Commit it immediately with an imperative message. Split it if it has more than one purpose.
