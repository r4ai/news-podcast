import type {
  SandboxClient,
  SandboxLimits,
  SandboxSession,
} from "@news-podcast/application"

const PROTOCOL_VERSION = "v1"

export interface FirecrackerSandboxClientConfig {
  readonly baseUrl: URL
  readonly bearerToken: string
  readonly requestTimeoutMs?: number
}

export class FirecrackerSandboxClient implements SandboxClient {
  constructor(
    private readonly config: FirecrackerSandboxClientConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async create(input: {
    readonly runId: string
    readonly profile: string
    readonly limits: SandboxLimits
  }): Promise<SandboxSession> {
    const value = await this.request("/v1/sessions", {
      method: "POST",
      body: {
        protocol_version: PROTOCOL_VERSION,
        run_id: input.runId,
        profile: input.profile,
        limits: {
          vcpu_count: input.limits.vcpuCount,
          memory_mib: input.limits.memoryMib,
          disk_mib: input.limits.diskMib,
          wall_time_seconds: input.limits.wallTimeSeconds,
          output_bytes: input.limits.outputBytes,
        },
      },
    })
    const session = value as Record<string, unknown>
    return {
      id: String(session.id),
      state: session.state === "stopped" ? "stopped" : "ready",
    }
  }

  exec(input: {
    readonly sessionId: string
    readonly command: readonly string[]
    readonly workingDirectory: string
    readonly timeoutSeconds: number
  }): Promise<{
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly truncated: boolean
  }> {
    return this.request(
      `/v1/sessions/${encodeURIComponent(input.sessionId)}/exec`,
      {
        method: "POST",
        body: {
          protocol_version: PROTOCOL_VERSION,
          command: input.command,
          working_directory: input.workingDirectory,
          timeout_seconds: input.timeoutSeconds,
        },
      }
    ).then((value) => {
      const result = value as Record<string, unknown>
      return {
        exitCode: Number(result.exit_code),
        stdout: String(result.stdout ?? ""),
        stderr: String(result.stderr ?? ""),
        truncated: Boolean(result.truncated),
      }
    })
  }

  checkpoint(sessionId: string): Promise<{ readonly objectKey: string }> {
    return this.request(
      `/v1/sessions/${encodeURIComponent(sessionId)}/checkpoint`,
      { method: "POST", body: { protocol_version: PROTOCOL_VERSION } }
    ).then((value) => ({
      objectKey: String((value as Record<string, unknown>).object_key),
    }))
  }

  async destroy(sessionId: string): Promise<void> {
    await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    })
  }

  private async request(
    path: string,
    input: { readonly method: "POST" | "DELETE"; readonly body?: unknown }
  ): Promise<unknown> {
    const url = new URL(path, this.config.baseUrl)
    const response = await this.fetcher(url, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${this.config.bearerToken}`,
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 30_000),
    })
    if (!response.ok) {
      throw new Error(`Sandbox runner request failed with ${response.status}`)
    }
    if (response.status === 204) return undefined
    return response.json()
  }
}
