import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { queryClient } from "@/app/query-client"
import { router } from "@/app/router"
import { ToastHost } from "@/shared/ui/toast-host"

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ queryClient }} />
      <ToastHost />
    </QueryClientProvider>
  )
}
