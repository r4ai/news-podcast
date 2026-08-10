import { Agent, RunState, run } from "@openai/agents"

import type {
  AgentEngine,
  AgentEngineCheckpoint,
  AgentEvent,
} from "@news-podcast/application"

const ENGINE_ID = "openai-agents-js@0.14"

interface SdkRunResult {
  readonly finalOutput: unknown
  readonly interruptions: readonly unknown[]
  readonly state: { toString(): string }
}

type ExecuteSdkRun = (
  agent: Agent,
  input: string | RunState<unknown, Agent>,
  options: { readonly maxTurns: number; readonly signal?: AbortSignal }
) => Promise<SdkRunResult>

type RestoreSdkState = (
  agent: Agent,
  serialized: string
) => Promise<RunState<unknown, Agent>>

export interface OpenAiAgentsEngineConfig {
  readonly name: string
  readonly model: string
  readonly instructions: string
  readonly maxTurns: number
}

export class OpenAiAgentsEngine implements AgentEngine {
  constructor(
    private readonly config: OpenAiAgentsEngineConfig,
    private readonly execute: ExecuteSdkRun = executeSdkRun,
    private readonly restore: RestoreSdkState = restoreSdkState,
    private readonly now: () => Date = () => new Date()
  ) {}

  async run(input: {
    readonly runId: string
    readonly goal: string
    readonly checkpoint?: AgentEngineCheckpoint
    readonly signal?: AbortSignal
  }): Promise<{ readonly events: readonly AgentEvent[] }> {
    const agent = new Agent({
      name: this.config.name,
      model: this.config.model,
      instructions: this.config.instructions,
    })
    const sdkInput = input.checkpoint
      ? await this.restoreCheckpoint(agent, input.checkpoint)
      : input.goal
    const result = await this.execute(agent, sdkInput, {
      maxTurns: this.config.maxTurns,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    const serializedState = result.state.toString()
    const waitingForApproval = result.interruptions.length > 0
    return {
      events: [
        {
          schemaVersion: 1,
          runId: input.runId,
          sequence: 0,
          type: waitingForApproval
            ? "run.waiting_approval"
            : "run.completed",
          occurredAt: this.now(),
          payload: waitingForApproval
            ? {
                interruptionCount: result.interruptions.length,
                checkpoint: { engine: ENGINE_ID, serializedState },
              }
            : {
                output: result.finalOutput,
                checkpoint: { engine: ENGINE_ID, serializedState },
              },
        },
      ],
    }
  }

  private restoreCheckpoint(
    agent: Agent,
    checkpoint: AgentEngineCheckpoint
  ): Promise<RunState<unknown, Agent>> {
    if (checkpoint.engine !== ENGINE_ID) {
      throw new Error(`Unsupported Agent Engine checkpoint: ${checkpoint.engine}`)
    }
    const serializedState = checkpoint.payload.serializedState
    if (typeof serializedState !== "string") {
      throw new Error("Agent Engine checkpoint has no serializedState")
    }
    return this.restore(agent, serializedState)
  }
}

async function executeSdkRun(
  agent: Agent,
  input: string | RunState<unknown, Agent>,
  options: { readonly maxTurns: number; readonly signal?: AbortSignal }
): Promise<SdkRunResult> {
  return run(agent, input, options)
}

function restoreSdkState(
  agent: Agent,
  serialized: string
): Promise<RunState<unknown, Agent>> {
  return RunState.fromString(agent, serialized)
}

