type PageHeaderProps = {
  readonly title: string
  readonly description?: string
}

export function PageHeader({ description, title }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  )
}
