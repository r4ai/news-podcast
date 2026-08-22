import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Provider as JotaiProvider } from "jotai"

import "@workspace/ui/globals.css"
import { App } from "@/app/app"
import { appStore } from "@/app/query-client"
import { ThemeProvider } from "@/features/theme"
import { startBrowserObservability } from "@/shared/observability/browser"

startBrowserObservability()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <JotaiProvider store={appStore}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </JotaiProvider>
  </StrictMode>
)
