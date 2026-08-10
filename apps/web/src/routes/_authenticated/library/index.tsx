import { createFileRoute } from "@tanstack/react-router"

import { episodesQueryOptions } from "@/features/episodes"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { EpisodeLibrary } from "./-components/episode-library"

export const Route = createFileRoute("/_authenticated/library/")({
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(episodesQueryOptions)
  },
  component: LibraryRoute,
})

function LibraryRoute() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="完成した音声と、台本の根拠になった記事を確認できます。"
        title="ライブラリ"
      />
      <Panel name="episode-library">
        <EpisodeLibrary />
      </Panel>
    </div>
  )
}
