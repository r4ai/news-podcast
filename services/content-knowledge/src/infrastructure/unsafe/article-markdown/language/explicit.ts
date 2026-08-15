const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = Object.freeze({
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "js",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "sh",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
})

const normalizeLanguage = (value: string | undefined): string | undefined => {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^language-/, "")
  return normalized || undefined
}

export const languageFromClassName = (
  className: string | undefined
): string | undefined => {
  const token = className
    ?.split(/\s+/)
    .find((entry) => entry.startsWith("language-") || entry.startsWith("lang-"))
  return normalizeLanguage(token?.replace(/^lang-/, ""))
}

export const languageFromFilename = (
  filename: string | undefined
): string | undefined => {
  const extension = filename?.split(".").pop()?.toLowerCase()
  return extension ? EXTENSION_LANGUAGES[extension] : undefined
}

export const languageFromSourceHint = (source: string): string | undefined => {
  const firstLine = source.split(/\r?\n/, 1)[0]!.trim()
  if (firstLine.startsWith("#!")) {
    if (firstLine.includes("python")) return "python"
    if (firstLine.includes("ruby")) return "ruby"
    if (firstLine.includes("node")) return "js"
    if (firstLine.includes("bash")) return "bash"
    if (firstLine.includes("sh")) return "sh"
  }
  const modeline = source.slice(0, 256).match(/(?:mode:\s*|ft=)([a-z0-9+#-]+)/i)
  return modeline ? normalizeLanguage(modeline[1]) : undefined
}

export const firstExplicitLanguage = (
  values: readonly (string | undefined)[]
): string | undefined => {
  for (const value of values) {
    const normalized = normalizeLanguage(value)
    if (normalized) return normalized
  }
  return undefined
}
