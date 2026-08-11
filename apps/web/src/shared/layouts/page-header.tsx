import { cn } from "@workspace/ui/lib/utils"

type PageHeaderProps = {
  readonly title: string
  readonly description?: string
  /** 見た目調整用。glass化や余白の調整などに使う。 */
  readonly className?: string
  /** コンパクト表示 (記事ページの固定ヘッダーなど)。 */
  readonly compact?: boolean
}

export function PageHeader({
  className,
  compact = false,
  description,
  title,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2",
        compact && "gap-0.5 py-1",
        className
      )}
    >
      <h1
        className={cn(
          "text-2xl font-semibold tracking-tight sm:text-3xl",
          compact && "text-lg sm:text-xl"
        )}
      >
        {title}
      </h1>
      {description ? (
        <p
          className={cn(
            "max-w-2xl text-sm leading-6 text-muted-foreground",
            compact && "line-clamp-1 text-xs"
          )}
        >
          {description}
        </p>
      ) : null}
    </header>
  )
}
