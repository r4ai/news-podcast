import { createRouter } from "@tanstack/react-router"

import { queryClient } from "./query-client"
import { routeTree } from "../routeTree.gen"

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 10_000,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
