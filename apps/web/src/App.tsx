import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { Toaster } from "@workspace/ui/components/sonner"

import { queryClient } from "@/app/query-client"
import { router } from "@/app/router"
import { useTheme } from "@/components/theme-provider"

export function App() {
  const { theme } = useTheme()

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ queryClient }} />
      <Toaster theme={theme} />
    </QueryClientProvider>
  )
}
