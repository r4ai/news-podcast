import { Panel } from "@/shared/components/panel"
import { useArticlePicker } from "../hooks/use-article-picker"
import { useGeneration } from "../hooks/use-generation"
import { ArticlePickerDialog } from "./article-picker-dialog"
import { ConnectedGenerationTimeline } from "./connected-generation-timeline"
import {
  ConnectedGenerationSettingsSummary,
  GenerationSettingsSummarySkeleton,
} from "./generation-settings-summary"
import { PodcastDashboard } from "./podcast-dashboard"

/**
 * データ接続: hookを呼び、presentationalな `PodcastDashboard` へ渡すだけ。
 * `PodcastDashboard` 側はpropsのみなのでStorybookでそのまま検証できる。
 *
 * 作業実況と設定要約はslotとして差し込む。どちらも自分の情報源を自分で購読
 * するので、SSEのフレームや購読フィードの更新が生成ステータスまで届かない。
 * 設定要約は独自の`Panel`を持ち、設定・購読・フィードの3つが揃うのを待たずに
 * 生成ステータスを先に見せる (ADR-0060)。
 */
export function GenerationDashboard() {
  const {
    pickerInitialArticleIds,
    pickerOpen,
    onPickerOpenChange,
    onConfirmGenerate,
    submitError,
    ...generation
  } = useGeneration()
  // 候補の取得はダイアログを開くまで走らせない。
  const picker = useArticlePicker(pickerOpen, pickerInitialArticleIds)

  return (
    <>
      <PodcastDashboard
        {...generation}
        settingsSlot={
          <Panel
            fallback={<GenerationSettingsSummarySkeleton />}
            name="generation-settings"
          >
            <ConnectedGenerationSettingsSummary />
          </Panel>
        }
        timelineSlot={<ConnectedGenerationTimeline />}
      />
      <ArticlePickerDialog
        articles={picker.articles}
        atLimit={picker.atLimit}
        hasNextPage={picker.hasNextPage}
        isError={picker.isError}
        isFetchingNextPage={picker.isFetchingNextPage}
        isLoading={picker.isLoading}
        onClear={picker.onClear}
        onConfirm={() => onConfirmGenerate(picker.selectedIds)}
        onLoadMore={picker.onLoadMore}
        onOpenChange={onPickerOpenChange}
        onRetry={picker.onRetry}
        onSelectTop={picker.onSelectTop}
        onToggle={picker.onToggle}
        open={pickerOpen}
        pending={generation.pending}
        selected={picker.selected}
        selectedCount={picker.selectedIds.length}
        submitError={submitError}
      />
    </>
  )
}
