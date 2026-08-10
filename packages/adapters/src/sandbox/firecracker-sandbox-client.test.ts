import { describe, expect, it, vi } from "vitest"

import { FirecrackerSandboxClient } from "./firecracker-sandbox-client.js"

describe("FirecrackerSandboxClient", () => {
  it("maps the project sandbox contract to the versioned runner API", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "session-1", state: "ready" }))
      .mockResolvedValueOnce(
        Response.json({
          exit_code: 0,
          stdout: "ok\n",
          stderr: "",
          truncated: false,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ object_key: "checkpoints/run-1.tar.zst" })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new FirecrackerSandboxClient(
      {
        baseUrl: new URL("http://sandbox-runner.internal:8080"),
        bearerToken: "short-lived-run-token",
      },
      fetcher as unknown as typeof fetch
    )
    const session = await client.create({
      runId: "run-1",
      profile: "podcast-text-v1",
      limits: {
        vcpuCount: 1,
        memoryMib: 256,
        diskMib: 512,
        wallTimeSeconds: 120,
        outputBytes: 1_000_000,
      },
    })
    const result = await client.exec({
      sessionId: session.id,
      command: ["python3", "analyze.py"],
      workingDirectory: "/workspace",
      timeoutSeconds: 30,
    })
    const checkpoint = await client.checkpoint(session.id)
    await client.destroy(session.id)

    expect(session).toEqual({ id: "session-1", state: "ready" })
    expect(result).toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      truncated: false,
    })
    expect(checkpoint).toEqual({
      objectKey: "checkpoints/run-1.tar.zst",
    })
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://sandbox-runner.internal:8080/v1/sessions",
      "http://sandbox-runner.internal:8080/v1/sessions/session-1/exec",
      "http://sandbox-runner.internal:8080/v1/sessions/session-1/checkpoint",
      "http://sandbox-runner.internal:8080/v1/sessions/session-1",
    ])
    const firstRequest = fetcher.mock.calls[0]
    expect(firstRequest).toBeDefined()
    const createBody = JSON.parse(
      String((firstRequest?.[1] as RequestInit | undefined)?.body)
    )
    expect(createBody).toMatchObject({
      protocol_version: "v1",
      run_id: "run-1",
      limits: { vcpu_count: 1, memory_mib: 256 },
    })
  })

  it("does not expose runner response bodies or credentials in errors", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: "internal path /srv/jailer", token: "secret" },
          { status: 500 }
        )
      )
    const client = new FirecrackerSandboxClient(
      {
        baseUrl: new URL("http://runner.internal"),
        bearerToken: "secret",
      },
      fetcher as unknown as typeof fetch
    )

    await expect(
      client.create({
        runId: "run-1",
        profile: "default",
        limits: {
          vcpuCount: 1,
          memoryMib: 128,
          diskMib: 128,
          wallTimeSeconds: 10,
          outputBytes: 1000,
        },
      })
    ).rejects.toThrow("Sandbox runner request failed with 500")
  })
})
