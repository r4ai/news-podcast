import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@workspace/ui/globals.css"
import { App } from "@/app/app"
import { ThemeProvider } from "@/features/theme"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { startBrowserObservability } from "@/shared/observability/browser"

startBrowserObservability()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
