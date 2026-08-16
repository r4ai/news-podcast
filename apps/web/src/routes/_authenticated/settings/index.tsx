import { createFileRoute } from "@tanstack/react-router"

import { settingsQueryOptions } from "@/features/settings"
import { Panel } from "@/shared/components/panel"
import { PageHeader } from "@/shared/layouts/page-header"
import { AiEnrichPanel } from "./-components/ai-enrich-panel"
import { InterestProfileForm } from "./-components/interest-profile-form"
import { ReadingDictionaryManager } from "./-components/reading-dictionary-manager"
import { SettingsNav } from "./-components/settings-nav"
import { TagVocabularyManager } from "./-components/tag-vocabulary-manager"
import { validateSettingsSearch, type SettingsSection } from "./-model"

export const Route = createFileRoute("/_authenticated/settings/")({
  validateSearch: validateSettingsSearch,
  // awaitしない先読み。未達ならPanelのfallbackが出る。
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(settingsQueryOptions)
  },
  component: SettingsRoute,
})

function SectionContent({ section }: { readonly section: SettingsSection }) {
  if (section === "tags") {
    return (
      <Panel name="tag-vocabulary-manager">
        <TagVocabularyManager />
      </Panel>
    )
  }
  if (section === "dictionary") {
    return (
      <Panel name="reading-dictionary-manager">
        <ReadingDictionaryManager />
      </Panel>
    )
  }
  return (
    // 興味プロフィールと再処理は一続きの作業。プロフィールを直した後の
    // 「では既存の記事はどうなるのか」に、同じ画面の中で答えられるよう隣へ置く。
    <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel name="interest-profile-form">
        <InterestProfileForm />
      </Panel>
      <Panel name="ai-enrich">
        <AiEnrichPanel />
      </Panel>
    </div>
  )
}

function SettingsRoute() {
  const { section } = Route.useSearch()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="AIの適合度スコアとタグ付けに使う興味プロフィール、タグ語彙、読み辞書を管理します。"
        title="設定"
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <SettingsNav current={section} />
        {/*
          `min-w-0`が要る。flexの子は既定で内容より縮まないので、
          これが無いと中の一覧が主領域を押し広げて横スクロールが出る。
        */}
        <div className="min-w-0 flex-1">
          <SectionContent section={section} />
        </div>
      </div>
    </div>
  )
}
