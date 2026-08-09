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

export interface S3Config {
  readonly endpoint: URL
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

export function readS3Config(
  env: Readonly<Record<string, string | undefined>>
): S3Config {
  return {
    endpoint: new URL(required(env, "S3_ENDPOINT")),
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket: required(env, "S3_BUCKET"),
    accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
  }
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
  readonly googleClientId?: string
  readonly googleClientSecret?: string
  readonly databasePath: string
}

export function readLocalAuthConfig(
  env: Readonly<Record<string, string | undefined>>
): LocalAuthConfig {
  const keys = [
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "DATABASE_PATH",
  ] as const
  const missing = keys.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    throw new ConfigurationError(missing)
  }

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim()
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new ConfigurationError([
      googleClientId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID",
    ])
  }
  return {
    secret: env.BETTER_AUTH_SECRET!.trim(),
    baseUrl: env.BETTER_AUTH_URL!.trim(),
    databasePath: env.DATABASE_PATH!.trim(),
    ...(googleClientId && googleClientSecret
      ? { googleClientId, googleClientSecret }
      : {}),
  }
}
