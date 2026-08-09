import { describe, expect, it } from "vitest"

import {
  ConfigurationError,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_VOICEVOX_CHARACTER,
  readLocalAuthConfig,
  readOpenAiConfig,
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

  it("resolves the VOICEVOX character by name and leaves style unresolved", () => {
    expect(
      readVoicevoxConfig({ VOICEVOX_BASE_URL: "http://voicevox:50021" }),
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
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "DATABASE_PATH",
      ])
    }
  })
})
