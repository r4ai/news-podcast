import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { useState, type ReactNode } from "react"

/**
 * routeの外で組み立てたUIを、`<Link>`が実際に働く状態で立ち上げる足場。
 * テストとStorybookの両方が使う。testing-libraryへは依存させない
 * (Storybookのbundleへ持ち込まないため)。renderまで面倒を見るのは
 * `render.tsx`の`renderWithStubRouter`。
 *
 * 実の`routeTree`は読み込まない。確かめたいのは行き先のページの中身ではなく
 * 「押したらどこへ動くか」なので、行き先は空のページで足りる。実の木を繋ぐと、
 * 1つのリンクを確かめるためにloaderと認証まで動かすことになる。
 */
const DESTINATIONS = [
  "/",
  "/articles",
  "/library",
  "/schedule",
  "/settings",
  "/subscriptions",
] as const

export function createStubRouter(subject: ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet })
  const routes = DESTINATIONS.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      // 出発点だけが検査対象のUIを描く。行き先は着いたことが判れば足りる。
      component: path === "/" ? () => subject : () => <main>{path}</main>,
    })
  )

  return createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })
}

export type StubRouter = ReturnType<typeof createStubRouter>

/** Storybook用。routerの取り回しが要らない呼び出しはこちらを使う。 */
export function StubRouterProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const [router] = useState(() => createStubRouter(children))
  return <RouterProvider router={router} />
}
