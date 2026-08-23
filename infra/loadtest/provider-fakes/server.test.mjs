import { test } from "node:test"
import assert from "node:assert/strict"

import {
  authorizeControlRequest,
  chooseFault,
  createProviderState,
  createWav,
  openAiResponse,
  profileSnapshot,
  setProviderProfile,
} from "./server.mjs"

const structuredRequest = (objectName) => ({
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            sources: [{ source_id: "source-1", title: "負荷テスト記事" }],
          }),
        },
      ],
    },
  ],
  text: { format: { type: "json_schema", name: objectName } },
})

const structuredPayload = (response) =>
  JSON.parse(JSON.parse(response).output[0].content[0].text)

test("fake OpenAI returns the requested script and quality schemas", () => {
  assert.deepEqual(
    structuredPayload(openAiResponse(structuredRequest("episode_script_v1"), "normal")),
    {
      title: "負荷テストニュース",
      script: "負荷テスト用Fake OpenAIが負荷テスト記事を要約しました。",
      source_ids: ["source-1"],
    }
  )
  assert.deepEqual(
    structuredPayload(
      openAiResponse(structuredRequest("episode_script_quality_v1"), "normal")
    ),
    { verdict: "pass", reason_code: "none" }
  )
})

test("control profile requires the admin token", () => {
  const state = createProviderState({ controlToken: "secret" })

  assert.equal(
    authorizeControlRequest(state, { headers: {} }),
    false
  )
  assert.equal(
    authorizeControlRequest(state, {
      headers: { "x-loadtest-admin-token": "wrong" },
    }),
    false
  )
  assert.equal(
    authorizeControlRequest(state, {
      headers: { "x-loadtest-admin-token": "secret" },
    }),
    true
  )
  assert.equal(
    authorizeControlRequest(createProviderState(), {
      headers: { "x-loadtest-admin-token": "secret" },
    }),
    false
  )
})

test("normal provider state is deterministic", () => {
  const state = createProviderState({ kind: "openai", profile: "normal" })

  assert.deepEqual(profileSnapshot(state), {
    kind: "openai",
    profile: "normal",
    faultRate: 0.1,
    delayMs: 750,
    timeoutMs: 4_000,
    seed: 1,
  })
  assert.equal(chooseFault(state), "normal")
})

test("mixed faults are reproducible for a fixed seed", () => {
  const first = createProviderState({
    profile: "mixed",
    faultRate: 1,
    seed: 42,
  })
  const second = createProviderState({
    profile: "mixed",
    faultRate: 1,
    seed: 42,
  })

  const firstSequence = Array.from({ length: 8 }, () => chooseFault(first))
  const secondSequence = Array.from({ length: 8 }, () => chooseFault(second))
  assert.deepEqual(firstSequence, secondSequence)
  assert.ok(firstSequence.every((fault) => fault !== "normal"))
})

test("profile control changes delay and seed", () => {
  const state = createProviderState({ profile: "normal" })
  const snapshot = setProviderProfile(state, {
    profile: "slow",
    delayMs: 123,
    timeoutMs: 456,
    faultRate: 0.5,
    seed: 99,
  })

  assert.deepEqual(snapshot, {
    kind: "openai",
    profile: "slow",
    faultRate: 0.5,
    delayMs: 123,
    timeoutMs: 456,
    seed: 99,
  })
})

test("generated wav has a valid RIFF container", () => {
  const wav = createWav()
  assert.equal(wav.toString("ascii", 0, 4), "RIFF")
  assert.equal(wav.toString("ascii", 8, 12), "WAVE")
  assert.equal(wav.readUInt32LE(4) + 8, wav.byteLength)
})
