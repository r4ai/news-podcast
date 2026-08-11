import { createFileRoute } from "@tanstack/react-router"

import { settingsQueryOptions } from "@/features/settings"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { InterestProfileForm } from "./-components/interest-profile-form"
import { TagVocabularyManager } from "./-components/tag-vocabulary-manager"

export const Route = createFileRoute("/_authenticated/settings/")({
  // awaitしない先読み。未達ならPanelのfallbackが出る。
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(settingsQueryOptions)
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <PageHeader
        description="AIの適合度スコアとタグ付けに使う興味プロフィールと、タグ語彙を管理します。"
        title="設定"
      />
      <Panel name="interest-profile-form">
        <InterestProfileForm />
      </Panel>
      <Panel name="tag-vocabulary-manager">
        <TagVocabularyManager />
      </Panel>
    </div>
  )
}
