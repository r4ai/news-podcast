# Repository agent guidance

## Architecture decisions

- Architecture or execution-model changes must be recorded in an ADR before implementation.
- ADRs must state **when**, **where**, and **how** each runtime component executes.
- Use a compact deployment/trigger table plus the smallest useful Mermaid flow, sequence, or state diagram.
- Show trust boundaries, ownership, lifecycle/terminal cleanup, failure recovery, and durable-state boundaries when relevant.
- Keep ADRs concise and synchronize their impact table with design docs, OpenAPI, migrations, code, tests, and deployment artifacts as implementation progresses.
