import { useArticlePicker } from "../hooks/use-article-picker"
import { useGeneration } from "../hooks/use-generation"
import { ArticlePickerDialog } from "./article-picker-dialog"
import { PodcastDashboard } from "./podcast-dashboard"

/**
 * データ接続: hookを呼び、presentationalな `PodcastDashboard` へ渡すだけ。
 * `PodcastDashboard` 側はpropsのみなのでStorybookでそのまま検証できる。
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
      <PodcastDashboard {...generation} />
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
