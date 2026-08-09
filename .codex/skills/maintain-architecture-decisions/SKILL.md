---
name: maintain-architecture-decisions
description: Record and maintain this project's architecture decisions as ADRs, including change rationale, rejected alternatives, consequences, reconsideration conditions, and synchronization with design documents, OpenAPI, code, and tests. Use when introducing, changing, reversing, reviewing, or deferring a material architectural or cross-cutting design decision.
---

# Maintain Architecture Decisions

1. Inspect `docs/design.md`, existing ADRs, OpenAPI, code, configuration, and tests before writing.
2. Create an ADR for a material cross-module, contract, infrastructure, authentication, data, or quality-policy decision. Do not create one for a local implementation detail.
3. Copy `assets/adr-template.md`, choose the next collision-free number, and record one decision per ADR.
4. Keep user-unconfirmed choices `Proposed`. Do not infer an unresolved functional use case or mark it `Accepted`.
5. Record the change trigger, drivers, rejected alternatives, consequences, affected artifacts, and observable reconsideration conditions.
6. Do not silently rewrite an accepted decision. Create a successor ADR and link both records with `Supersedes` and `Superseded by`.
7. Synchronize affected design documents, OpenAPI, code, configuration, and tests in the same change. Mark an unaffected surface `N/A` with a reason.
8. Validate links, status consistency, contradictions, and the final diff. Run relevant contract, build, and test checks.
9. Report incomplete synchronization and acceptance gates explicitly.

## Completion checklist

- ADR status matches the actual approval state.
- Change reason, rejected alternatives, and negative consequences are concrete.
- Reconsideration conditions are observable.
- Every affected artifact has a change or a justified `N/A`.
- OpenAPI, code, and tests agree where an external contract changed.
- Superseded decisions are linked in both directions.
- Unresolved functional choices remain visible as confirmation gates.
