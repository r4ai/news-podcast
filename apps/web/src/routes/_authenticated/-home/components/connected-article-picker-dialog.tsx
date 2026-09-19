import { usePickerSources } from "../hooks/use-picker-sources"
import {
  ArticlePickerDialog,
  type ArticlePickerDialogProps,
} from "./article-picker-dialog"

/** Keep source-cache updates inside the picker, independent of generation status. */
export function ConnectedArticlePickerDialog(props: ArticlePickerDialogProps) {
  const sources = usePickerSources(
    props.open &&
      !props.isLoading &&
      !props.isError &&
      props.articles.length === 0 &&
      !props.hasSearchQuery &&
      !props.hasNextPage
  )
  return (
    <ArticlePickerDialog
      {...props}
      emptyState={sources.state}
      isRefreshing={props.isRefreshing || sources.isFetching}
      onRetry={() => {
        props.onRetry()
        sources.onRetry()
      }}
    />
  )
}
