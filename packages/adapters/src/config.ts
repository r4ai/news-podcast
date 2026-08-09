export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"
export const DEFAULT_VOICEVOX_CHARACTER = "ずんだもん"

export class ConfigurationError extends Error {
  constructor(readonly missingKeys: readonly string[]) {
    super(`Missing required configuration: ${missingKeys.join(", ")}`)
    this.name = "ConfigurationError"
  }
}

export interface OpenAiConfig {
  readonly apiKey: string
  readonly model: string
}

export interface VoicevoxConfig {
  readonly baseUrl: URL
  readonly characterName: string
  readonly styleName?: string
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string
): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new ConfigurationError([key])
  }
  return value
}

export function readOpenAiConfig(
  env: Readonly<Record<string, string | undefined>>
): OpenAiConfig {
  return {
    apiKey: required(env, "OPENAI_API_KEY"),
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
  }
}

export function readVoicevoxConfig(
  env: Readonly<Record<string, string | undefined>>
): VoicevoxConfig {
  const styleName = env.VOICEVOX_STYLE_NAME?.trim()
  return {
    baseUrl: new URL(required(env, "VOICEVOX_BASE_URL")),
    characterName:
      env.VOICEVOX_CHARACTER_NAME?.trim() || DEFAULT_VOICEVOX_CHARACTER,
    ...(styleName ? { styleName } : {}),
  }
}

export interface LocalAuthConfig {
  readonly secret: string
  readonly baseUrl: string
  readonly googleClientId: string
  readonly googleClientSecret: string
  readonly databasePath: string
}

export function readLocalAuthConfig(
  env: Readonly<Record<string, string | undefined>>
): LocalAuthConfig {
  const keys = [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "DATABASE_PATH",
  ] as const
  const missing = keys.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    throw new ConfigurationError(missing)
  }

  return {
    secret: env.BETTER_AUTH_SECRET!.trim(),
    baseUrl: env.BETTER_AUTH_URL!.trim(),
    googleClientId: env.GOOGLE_CLIENT_ID!.trim(),
    googleClientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
    databasePath: env.DATABASE_PATH!.trim(),
  }
}
