# TanStack Query v5 with Async React

Use Query as the authoritative server-state/Suspense layer and React for priority, reveal, optimistic presentation, and recovery.

## Contents

- [Responsibility split](#responsibility-split)
- [Queries and prefetching](#queries-and-prefetching)
- [Actions and mutations](#actions-and-mutations)
- [Choose one optimistic owner](#choose-one-optimistic-owner)
- [Errors, cancellation, and concurrency](#errors-cancellation-and-concurrency)
- [SSR and production defaults](#ssr-and-production-defaults)

## Responsibility split

| Concern | Owner |
| --- | --- |
| identity, deduplication, freshness, cache, invalidation | TanStack Query |
| transport cancellation where supported | query function consuming `AbortSignal` |
| mutation lifecycle and cross-component status | `useMutation` / `useMutationState` |
| urgent versus non-urgent render | React state / Transition |
| initial reveal and retained content | Suspense + Transition |
| temporary intent projection | exactly one optimism strategy |
| unexpected query recovery | Error Boundary + `QueryErrorResetBoundary` |

Keep only draft/input state locally. Do not mirror query data into state or synchronize it with an Effect.

## Queries and prefetching

Centralize the complete resource contract with `queryOptions`:

```tsx
export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: ["projects", "detail", id] as const,
    queryFn: ({ signal }) => getProject(id, { signal }),
    staleTime: 30_000,
  })

function Project({ id }: { id: string }) {
  const { data } = useSuspenseQuery(projectQuery(id))
  return <ProjectView project={data} />
}
```

- Include every resource-defining input in the key. Use identical options for loaders, prefetch, components, and cache writes.
- `useSuspenseQuery` provides defined data; the boundary owns initial loading/error UI. It does not offer `enabled` or `placeholderData`; render dependencies structurally or preload them.
- Multiple `useSuspenseQuery` calls in one component start serially. Use route prefetch, `useSuspenseQueries`, or sibling boundaries according to desired reveal order.
- Change a suspending query key inside a router Transition or `startTransition` so prior data remains visible.
- Prefer route loaders. Await `ensureQueryData` for route-critical data; start unawaited `prefetchQuery` for secondary data behind a boundary. Launch independent critical queries with `Promise.all`.
- Otherwise prefetch from router intent or pointer/focus/touch intent, or use `usePrefetchQuery` above the boundary. Do not prefetch in an Effect.

## Actions and mutations

Let a reusable component invoke a product Action; let `useMutation` own transport and authoritative cache effects:

```tsx
const rename = useMutation({
  mutationKey: ["projects", "rename"],
  mutationFn: renameProject,
  onSuccess: (project) =>
    queryClient.setQueryData(projectQuery(project.id).queryKey, project),
  onSettled: () =>
    queryClient.invalidateQueries({ queryKey: ["projects", "list"] }),
})

async function renameAction(name: string) {
  await rename.mutateAsync({ id: project.id, name })
}

return <RenameForm project={project} renameAction={renameAction} />
```

The form owns pending/disabled/a11y presentation. The product component owns the expected-error and duplicate policy. The mutation owns retries, metadata, and exact cache reconciliation. Prefer returned server data for immediate exact writes; invalidate affected aggregates after settlement.

## Choose one optimistic owner

| Strategy | Use when |
| --- | --- |
| `useOptimistic` | projection is local to one interaction/view |
| mutation variables / `useMutationState` | pending item must appear in one or several views without cache mutation |
| `onMutate` + `setQueryData` | many existing query consumers must see the speculative value |

For cache optimism:

1. Cancel/refuse competing refetch writes where supported.
2. Snapshot every exact affected key in `onMutate`.
3. update immutably.
4. Roll back from the snapshot in `onError`.
5. Invalidate targeted detail/list/aggregate keys in `onSettled`.

Use stable client IDs, mutation `submittedAt`, and deterministic ordering for concurrent inserts. Use mutation `scope.id`, idempotency keys, or domain versions when same-resource operations must serialize or deduplicate. Never layer `useOptimistic`, mutation-variable optimism, and cache optimism over the same projection without an explicit reconciliation design.

## Errors, cancellation, and concurrency

Pair query reset and UI recovery at the same boundary:

```tsx
<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary onReset={reset} fallbackRender={RetryFallback}>
      <Suspense fallback={<ProjectSkeleton />}>
        <Project />
      </Suspense>
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```

- Retry resets both Query and React boundaries while preserving unaffected UI and focus.
- By default, a Suspense query throws only when no cached data exists. A background refetch error may leave stale data visible; expose it when it can mislead the user. Explicitly throw settled refetch errors only when product policy requires boundary replacement.
- Retry transient failures, not validation, auth, permission, conflict, or not-found errors.
- Consume the provided `AbortSignal` in reusable query functions. TanStack Query v5 does not support cancellation for its Suspense hooks, so correctness must not depend on abort.
- For latest-wins search/navigation, put the latest input in the key and transition the key update. A late response may fill only its old key; it must not overwrite the current view.
- Cancellation cannot undo a server mutation. Use idempotency, versions, serial mutation scopes, or an explicit duplicate policy.

## SSR and production defaults

- Create one `QueryClient` per server request and reuse one stable browser client. Never construct it in a suspending render path.
- Prefetch/dehydrate and hydrate through the framework integration. Choose nonzero SSR `staleTime` when an immediate client refetch would duplicate work.
- Await critical queries; stream secondary groups behind coherent Suspense boundaries.
- Treat `useQuery().promise` with React `use()` and `experimental_prefetchInRender` as experimental; prefer stable `useSuspenseQuery` unless approved.
- Choose `staleTime`, retry, focus/reconnect refetch, and `gcTime` per resource instead of accepting broad defaults accidentally.
- Preserve structural sharing and tracked properties. Use pure `select` transforms and React Compiler; do not memoize query callbacks/options by habit.
- Instrument non-sensitive operation names, duration, cache state, retries, invalidation-to-fresh time, rollback, boundary reset, and fallback exposure.

## TanStack-specific checks

- Exact keys own reads, writes, cancellation, and invalidation.
- Query-key changes that may suspend are transitioned.
- One optimistic owner has deterministic rollback and overlap behavior.
- Suspense correctness does not rely on cancellation.
- Query and React boundary reset are tested together.
