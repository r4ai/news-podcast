export type CodeMetadata = Readonly<{
  readonly language?: string
  readonly title?: string
  readonly showLineNumbers: boolean
  readonly startLine?: number
  readonly highlight: readonly number[]
  readonly diffAdd: readonly number[]
  readonly diffRemove: readonly number[]
}>

const quote = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

const list = (values: readonly number[]): string | undefined =>
  values.length > 0 ? values.join(",") : undefined

export const serializeCodeMetadata = (metadata: CodeMetadata): string =>
  [
    metadata.title ? `title=${quote(metadata.title)}` : undefined,
    `showLineNumbers=${String(metadata.showLineNumbers)}`,
    metadata.startLine === undefined
      ? undefined
      : `startLine=${metadata.startLine}`,
    list(metadata.highlight)
      ? `highlight=${quote(list(metadata.highlight)!)}`
      : undefined,
    list(metadata.diffAdd)
      ? `diffAdd=${quote(list(metadata.diffAdd)!)}`
      : undefined,
    list(metadata.diffRemove)
      ? `diffRemove=${quote(list(metadata.diffRemove)!)}`
      : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
