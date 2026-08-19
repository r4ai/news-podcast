import { useSetAtom } from "jotai"

import { playEpisodeAtom } from "@/features/player"
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
    onGenerate,
    onPickerOpenChange,
    onConfirmGenerate,
    onRetry,
    submitError,
    ...generation
  } = useGeneration()
  // 候補の取得はダイアログを開くまで走らせない。
  const picker = useArticlePicker(pickerOpen, pickerInitialArticleIds)
  // 完成した番組をその場で鳴らす。音を出すのは下端のバー (`PlayerHost`) で、
  // ここは「どれを載せるか」を渡すだけ。
  const play = useSetAtom(playEpisodeAtom)
  const latest = generation.episode

  return (
    <>
      <PodcastDashboard
        {...generation}
        onGenerate={() => {
          picker.onSearchChange("")
          onGenerate()
        }}
        onPlayEpisode={
          latest &&
          (() =>
            play({
              episodeId: latest.id,
              title: latest.title,
              createdAt: latest.createdAt,
            }))
        }
        onRetry={() => {
          picker.onSearchChange("")
          onRetry()
        }}
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
        hasSearchQuery={picker.hasSearchQuery}
        isError={picker.isError}
        isFetchingNextPage={picker.isFetchingNextPage}
        isLoading={picker.isLoading}
        isSearching={picker.isSearching}
        onClear={picker.onClear}
        onConfirm={() => onConfirmGenerate(picker.selectedIds)}
        onLoadMore={picker.onLoadMore}
        onOpenChange={onPickerOpenChange}
        onRetry={picker.onRetry}
        onSearchChange={picker.onSearchChange}
        onSelectTop={picker.onSelectTop}
        onToggle={picker.onToggle}
        open={pickerOpen}
        pending={generation.pending}
        searchQuery={picker.searchQuery}
        selected={picker.selected}
        selectedCount={picker.selectedIds.length}
        submitError={submitError}
      />
    </>
  )
}
