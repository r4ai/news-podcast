import { createFileRoute } from "@tanstack/react-router"

import { settingsQueryOptions } from "@/features/settings"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { AiEnrichPanel } from "./-components/ai-enrich-panel"
import { InterestProfileForm } from "./-components/interest-profile-form"
import { ReadingDictionaryManager } from "./-components/reading-dictionary-manager"
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
        description="AIの適合度スコアとタグ付けに使う興味プロフィール、タグ語彙、読み辞書を管理します。"
        title="設定"
      />
      <Panel name="interest-profile-form">
        <InterestProfileForm />
      </Panel>
      <Panel name="ai-enrich">
        <AiEnrichPanel />
      </Panel>
      <Panel name="tag-vocabulary-manager">
        <TagVocabularyManager />
      </Panel>
      <Panel name="reading-dictionary-manager">
        <ReadingDictionaryManager />
      </Panel>
    </div>
  )
}
