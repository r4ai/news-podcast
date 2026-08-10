import { describe, expect, it, vi } from "vitest"

import { OpenAiAgentsEngine } from "./openai-agents-engine.js"

const config = {
  name: "Podcast Editor",
  model: "test-model",
  instructions: "Use only observed sources.",
  maxTurns: 8,
}

describe("OpenAiAgentsEngine", () => {
  it("runs a goal and emits only the project event contract", async () => {
    const execute = vi.fn().mockResolvedValue({
      finalOutput: { title: "Episode" },
      interruptions: [],
      state: { toString: () => "serialized-run-state" },
    })
    const engine = new OpenAiAgentsEngine(
      config,
      execute,
      vi.fn(),
      () => new Date("2026-08-10T00:00:00.000Z")
    )

    await expect(
      engine.run({ runId: "run-1", goal: "Create an episode" })
    ).resolves.toEqual({
      events: [
        {
          schemaVersion: 1,
          runId: "run-1",
          sequence: 0,
          type: "run.completed",
          occurredAt: new Date("2026-08-10T00:00:00.000Z"),
          payload: {
            output: { title: "Episode" },
            checkpoint: {
              engine: "openai-agents-js@0.14",
              serializedState: "serialized-run-state",
            },
          },
        },
      ],
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Podcast Editor", model: "test-model" }),
      "Create an episode",
      { maxTurns: 8 }
    )
  })

  it("restores a matching checkpoint and preserves an abort signal", async () => {
    const restoredState = { restored: true }
    const restore = vi.fn().mockResolvedValue(restoredState)
    const execute = vi.fn().mockResolvedValue({
      finalOutput: undefined,
      interruptions: [{}],
      state: { toString: () => "next-state" },
    })
    const signal = new AbortController().signal
    const engine = new OpenAiAgentsEngine(config, execute, restore)

    const result = await engine.run({
      runId: "run-1",
      goal: "ignored on resume",
      checkpoint: {
        schemaVersion: 1,
        engine: "openai-agents-js@0.14",
        payload: { serializedState: "prior-state" },
      },
      signal,
    })

    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Podcast Editor" }),
      "prior-state"
    )
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      restoredState,
      { maxTurns: 8, signal }
    )
    expect(result.events[0]).toMatchObject({
      type: "run.waiting_approval",
      payload: {
        interruptionCount: 1,
        checkpoint: { serializedState: "next-state" },
      },
    })
  })

  it("rejects foreign and malformed checkpoints before model execution", async () => {
    const execute = vi.fn()
    const engine = new OpenAiAgentsEngine(config, execute)

    await expect(
      engine.run({
        runId: "run-1",
        goal: "resume",
        checkpoint: { schemaVersion: 1, engine: "other", payload: {} },
      })
    ).rejects.toThrow("Unsupported Agent Engine checkpoint")
    await expect(
      engine.run({
        runId: "run-1",
        goal: "resume",
        checkpoint: {
          schemaVersion: 1,
          engine: "openai-agents-js@0.14",
          payload: {},
        },
      })
    ).rejects.toThrow("checkpoint has no serializedState")
    expect(execute).not.toHaveBeenCalled()
  })
})

