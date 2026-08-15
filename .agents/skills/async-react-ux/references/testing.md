# Async UX testing

Derive tests from the interaction contract. Assert what users see and can do, not scheduler internals or render counts.

## Essential matrix

| Scenario | Required assertion |
| --- | --- |
| fast success | no indicator/fallback flash; result commits |
| slow initial reveal | shaped fallback appears only in its region |
| slow transitioned update | prior content remains; local pending/stale cue appears |
| optimistic success/failure | intent appears immediately; result converges or rolls back without duplication; input/retry remains |
| expected/unexpected failure | actionable result or nearest boundary; unaffected UI stays usable; telemetry fires once |
| rapid, interrupted, reordered work | declared concurrency policy wins and urgent input stays responsive |
| keyboard/assistive tech | focus, name, role, state, announcement, and retry work |
| reduced motion/layout | nonessential motion is reduced and no avoidable layout shift occurs |
| pending unmount/navigation | no stale commit, duplicate effect, or unhandled rejection |
| allowed Effect under Strict Mode | external setup cleans up and safely reconnects |
| Compiler production build | target compiles and behaves without speculative manual memoization |
| TanStack key change/refetch | transition retains content; stale response cannot overwrite current key; background-error policy is visible |
| TanStack optimistic overlap | exact cache keys, ordering, rollback, and targeted invalidation hold |
| Query boundary retry | Query and React errors reset together and focus recovery works |

## Test layers

### Unit

Test pure optimistic reducers, typed Action results, cache keys, concurrency/version rules, and latency state. Use a fresh `QueryClient` per test and disable retries unless retry behavior is under test.

### Component/integration

Use controllable Promises and real router/query/Suspense/error providers when their contract matters. Trigger intent through accessible roles and labels. Use fake timers only for delayed feedback and the framework's supported `act` integration.

### E2E

Inject browser-level latency, reordering, and failure. Verify initial versus update fallbacks, prefetch/hydration/streaming, focus and scroll restoration, double-click/Enter/retry behavior, real cache invalidation, layout stability, and reduced motion. Capture trace/video only when needed to diagnose timing-sensitive regressions.

## Observability

Record non-sensitive interaction name/ID, outcome (`success`, expected/unexpected error, cancelled, superseded), duration, pending/fallback exposure, stale-content duration, optimism/rollback, retry count, hashed resource key, and route. Correlate with server traces where available and inspect distributions rather than averages.

## Completion gate

- Fast, slow, failure, interruption, duplicate, and stale-result paths pass.
- Accessibility, reduced motion, typecheck, focused tests, and production build pass.
- No unhandled rejection, console error, duplicate mutation, or stale commit remains.
- Every Effect/ref or manual memoization exception names its external contract or evidence.
