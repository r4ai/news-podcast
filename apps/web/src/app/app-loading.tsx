import { Headphones } from "lucide-react"

import { Spinner } from "@workspace/ui/components/spinner"

export function AppLoading() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4 text-foreground">
      <div className="flex items-center gap-3" role="status">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Headphones aria-hidden="true" />
        </span>
        <span className="font-semibold">News Podcast</span>
        <Spinner aria-label="読み込み中" />
      </div>
    </main>
  )
}
