# Primary sources and release-channel notes

Consult these sources when exact semantics matter. Re-check the installed versions and current documentation before adopting recently added APIs.

## Async React reference implementation

- [Async React Part I](https://www.youtube.com/watch?t=10907s&v=zyVRg2QR6LA) and [Part II](https://www.youtube.com/watch?t=29073s&v=p9OcztRyDl0) — Ricky Hanlon's React Conf 2025 talks.
- [React Conf 2025 recap](https://react.dev/blog/2025/10/16/react-conf-2025-recap) — official talk index and release context.
- [rickhanlonii/async-react](https://github.com/rickhanlonii/async-react) — React Conf 2025 final demo.
- [Demo README](https://github.com/rickhanlonii/async-react/blob/main/README.md) — router transitions, Suspense-enabled data, Action props, optimistic state, and fast/slow network goals.
- [Home example](https://github.com/rickhanlonii/async-react/blob/main/src/app/Home.jsx) — retained revealed content, optimistic search/tabs, mutation refresh, Suspense, and View Transitions.
- [Design components](https://github.com/rickhanlonii/async-react/tree/main/src/design) — Action prop and delayed pending-feedback patterns.
- [Router example](https://github.com/rickhanlonii/async-react/blob/main/src/router/index.jsx) — transition-aware navigation and focus/scroll integration. Treat as explanatory demo code, not production router guidance.
- [Data example](https://github.com/rickhanlonii/async-react/blob/main/src/data/index.js) — cached promises, invalidation, and bounded prefetch. Treat the module cache as a teaching example.

## Component-design perspectives

- [React 19の新機能まるわかり](https://zenn.dev/uhyo/books/react-19-new) — Actions, form Actions, `useOptimistic`, `use`, resources, and error handling.
- [React Concurrent Mode ハンズオン](https://zenn.dev/uhyo/books/react-concurrent-handson-2) — interruption, pending state, and Transitions as branched UI worlds.
- [小手先に見えるテクニックでも、実はReact的に考えられる](https://zenn.dev/uhyo/articles/react-key-techniques) — `key` as declarative component-instance identity rather than an Effect-driven reset.
- [過激派が教える！ useEffectの正しい使い方](https://zenn.dev/uhyo/articles/useeffect-taught-by-extremist) — restrict Effects to synchronization caused by the component's presence and clean up on unmount.
- [React Profession Bench #8](https://zenn.dev/uhyo/articles/react-profession-bench-8), [#12](https://zenn.dev/uhyo/articles/react-profession-bench-12), and [#14](https://zenn.dev/uhyo/articles/react-profession-bench-14) — component decomposition, Action props, modern async APIs, and avoiding pre-Compiler memoization habits.

## React stable documentation

- [`useTransition`](https://react.dev/reference/react/useTransition) and [`startTransition`](https://react.dev/reference/react/startTransition)
- [`<Suspense>`](https://react.dev/reference/react/Suspense), [`use`](https://react.dev/reference/react/use), and [`lazy`](https://react.dev/reference/react/lazy)
- [`useOptimistic`](https://react.dev/reference/react/useOptimistic)
- [`useActionState`](https://react.dev/reference/react/useActionState), [`<form action>`](https://react.dev/reference/react-dom/components/form), and [`useFormStatus`](https://react.dev/reference/react-dom/hooks/useFormStatus)
- [`useDeferredValue`](https://react.dev/reference/react/useDeferredValue)
- [`<Activity>`](https://react.dev/reference/react/Activity)
- [Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [React DOM resource hints](https://react.dev/reference/react-dom#resource-preloading-apis)
- [Escape Hatches](https://react.dev/learn/escape-hatches) and [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [React Hooks: refs and Effects](https://react.dev/reference/react/hooks)
- [React Compiler](https://react.dev/learn/react-compiler), [configuration](https://react.dev/reference/react-compiler/configuration), and [directives](https://react.dev/reference/react-compiler/directives)
- [`useMemo`](https://react.dev/reference/react/useMemo) and [`useCallback`](https://react.dev/reference/react/useCallback) — both document that React Compiler reduces manual memoization needs.
- [React 19.2 release](https://react.dev/blog/2025/10/01/react-19-2)

## Experimental/Canary documentation

- [`<ViewTransition>`](https://react.dev/reference/react/ViewTransition)
- [`addTransitionType`](https://react.dev/reference/react/addTransitionType)
- [View Transitions and Activity background](https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more)

## TanStack Query v5 documentation

- [Suspense](https://tanstack.com/query/latest/docs/framework/react/guides/suspense)
- [Prefetching and router integration](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [Optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)
- [Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) and [`useMutation`](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation)
- [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- [`queryOptions`](https://tanstack.com/query/latest/docs/framework/react/reference/queryOptions)
- [Server rendering and hydration](https://tanstack.com/query/latest/docs/framework/react/guides/ssr) and [advanced server rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Router Query integration](https://tanstack.com/router/latest/docs/integrations/query)
- [Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Render optimizations](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations)
- [Testing](https://tanstack.com/query/latest/docs/framework/react/guides/testing)

## Stability matrix

| Capability                               | React 19.2 status | Adoption rule                                                               |
| ---------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| Actions/Transitions                      | stable            | prefer framework integration; account for post-`await` transition semantics |
| Suspense for code/framework data/`use`   | stable            | use supported cached resources only                                         |
| `useOptimistic`                          | stable            | call setter inside Action/Transition                                        |
| `useActionState` and form Actions        | stable            | prefer for form state and progressive enhancement                           |
| `useDeferredValue`                       | stable            | defer slow consumers, not controlled values                                 |
| `<Activity>` visible/hidden              | stable in 19.2    | use for state preservation and background preparation                       |
| React Compiler                           | stable toolchain  | verify enabled/compiling; prefer purity over manual memoization             |
| `useEffectEvent`                         | stable in 19.2    | use only for non-reactive event logic fired from an Effect                  |
| `<ViewTransition>` / `addTransitionType` | Canary            | require explicit opt-in and graceful nonanimated fallback                   |

The Async React demo intentionally uses experimental React and browser integrations. Preserve its principles—transition-aware routing, cached Suspense resources, Action props, optimistic feedback, delayed indicators, prefetch, and coherent animated commits—while replacing demo infrastructure with maintained production integrations.
