import { describe, expect, it } from "vitest"

import {
  ConfigurationError,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_VOICEVOX_CHARACTER,
  readLocalAuthConfig,
  readOpenAiConfig,
  readS3Config,
  readVoicevoxConfig,
} from "./config.js"

describe("runtime configuration", () => {
  it("uses the confirmed OpenAI model default without requiring it in tests", () => {
    expect(readOpenAiConfig({ OPENAI_API_KEY: "test-key" })).toEqual({
      apiKey: "test-key",
      model: DEFAULT_OPENAI_MODEL,
    })
  })

  it("fails only when an OpenAI adapter is configured without a key", () => {
    expect(() => readOpenAiConfig({})).toThrow(ConfigurationError)
  })

  it("reads the self-hosted S3 endpoint with a stable default region", () => {
    expect(
      readS3Config({
        S3_ENDPOINT: "http://seaweedfs:8333",
        S3_BUCKET: "news-podcast",
        S3_ACCESS_KEY_ID: "test-access",
        S3_SECRET_ACCESS_KEY: "test-secret",
      })
    ).toEqual({
      endpoint: new URL("http://seaweedfs:8333"),
      region: "us-east-1",
      bucket: "news-podcast",
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
    })
  })

  it("resolves the VOICEVOX character by name and leaves style unresolved", () => {
    expect(
      readVoicevoxConfig({ VOICEVOX_BASE_URL: "http://voicevox:50021" })
    ).toEqual({
      baseUrl: new URL("http://voicevox:50021"),
      characterName: DEFAULT_VOICEVOX_CHARACTER,
    })
  })

  it("reports every missing local auth setting together", () => {
    try {
      readLocalAuthConfig({ BETTER_AUTH_SECRET: "secret" })
      expect.fail("expected configuration failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect((error as ConfigurationError).missingKeys).toEqual([
        "BETTER_AUTH_URL",
        "DATABASE_PATH",
      ])
    }
  })
})
