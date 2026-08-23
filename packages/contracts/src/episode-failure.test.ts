import { describe, expect, it } from "vitest"

import {
  episodeFailureCodes,
  episodeFailureFamilyByCode,
  isEpisodeFailureCode,
} from "./episode-failure.js"

describe("episode failure contract", () => {
  it("keeps every public code unique and classified", () => {
    expect(new Set(episodeFailureCodes).size).toBe(episodeFailureCodes.length)
    expect(Object.keys(episodeFailureFamilyByCode).sort()).toEqual(
      [...episodeFailureCodes].sort()
    )
  })

  it("recognizes known codes without accepting forward unknown values", () => {
    expect(isEpisodeFailureCode("job_deadline_exceeded")).toBe(true)
    expect(isEpisodeFailureCode("script_timeout")).toBe(true)
    expect(isEpisodeFailureCode("sqlite_load_checkpoint_corrupt_record")).toBe(
      true
    )
    expect(isEpisodeFailureCode("provider-timeout")).toBe(false)
    expect(isEpisodeFailureCode("secret_internal_adapter_42")).toBe(false)
  })
})
