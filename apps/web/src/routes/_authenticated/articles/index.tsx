import { createFileRoute } from "@tanstack/react-router"

import { api } from "@/shared/api"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { ArticleList } from "./-components/article-list"

export const Route = createFileRoute("/_authenticated/articles/")({
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(
      api.queryOptions("get", "/v1/me/articles")
    )
  },
  component: ArticlesRoute,
})

function ArticlesRoute() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="購読フィードの記事を読み、保存済みアーカイブを開けます。"
        title="記事"
      />
      <Panel name="article-list">
        <ArticleList />
      </Panel>
    </div>
  )
}
