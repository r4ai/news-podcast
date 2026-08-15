import { describe, expect, it, vi } from "vitest"

import { watchdogTargets } from "./config.js"
import { checkWatchdog, exportedPoints } from "./watchdog.js"

const targets = [{ name: "api", url: "http://api/health" }]

describe("independent watchdog", () => {
  it("alerts immediately, renotifies after 30 minutes, and sends recovery", async () => {
    let exported = 0
    const failingFetch = vi.fn<typeof fetch>().mockImplementation((url) => {
      const metrics = String(url).includes("metrics")
      if (metrics) exported += 10
      return Promise.resolve(
        new Response(
          metrics ? `otelcol_exporter_sent_metric_points ${exported}` : "down",
          {
            status: metrics ? 200 : 503,
          }
        )
      )
    })
    const first = await checkWatchdog({
      state: { failures: {} },
      targets,
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:00:00Z"),
      fetcher: failingFetch,
    })
    expect(first.notification?.kind).toBe("firing")

    const quiet = await checkWatchdog({
      state: first.state,
      targets,
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:29:00Z"),
      fetcher: failingFetch,
    })
    expect(quiet.notification).toBeUndefined()
    const repeated = await checkWatchdog({
      state: quiet.state,
      targets,
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:30:00Z"),
      fetcher: failingFetch,
    })
    expect(repeated.notification?.kind).toBe("firing")

    const recovered = await checkWatchdog({
      state: repeated.state,
      targets,
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:31:00Z"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("otelcol_exporter_sent_metric_points 20")
        ),
    })
    expect(recovered.notification?.kind).toBe("resolved")
  })

  it("detects telemetry that has stopped advancing for two minutes", async () => {
    const result = await checkWatchdog({
      state: {
        failures: {},
        telemetryValue: 10,
        telemetryChangedAt: "2026-08-10T00:00:00Z",
      },
      targets: [],
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:02:00Z"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("otelcol_exporter_sent_metric_points 10")
        ),
    })
    expect(result.state.failures.telemetry).toContain("two minutes")
    expect(result.notification?.kind).toBe("firing")
  })

  it("reports a partial recovery while the remaining target stays firing", async () => {
    const previous = await checkWatchdog({
      state: { failures: {} },
      targets: [
        { name: "api", url: "http://api/health" },
        { name: "storage", url: "http://storage/health" },
      ],
      now: new Date("2026-08-10T00:00:00Z"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("down", { status: 503 })),
    })
    const partial = await checkWatchdog({
      state: previous.state,
      targets: [
        { name: "api", url: "http://api/health" },
        { name: "storage", url: "http://storage/health" },
      ],
      now: new Date("2026-08-10T00:01:00Z"),
      fetcher: vi.fn<typeof fetch>().mockImplementation((url) =>
        Promise.resolve(
          new Response(String(url).includes("api") ? "ok" : "down", {
            status: String(url).includes("api") ? 200 : 503,
          })
        )
      ),
    })

    expect(partial.notification).toMatchObject({ kind: "firing" })
    expect(partial.notification?.text).toContain(
      "Recovered in the same check: api"
    )
    expect(partial.state.targets).toMatchObject({
      api: { up: true, consecutiveFailures: 0 },
      storage: { up: false, consecutiveFailures: 2 },
    })
  })

  it("treats a reset exporter counter as fresh collector progress", async () => {
    const result = await checkWatchdog({
      state: {
        failures: {},
        telemetryValue: 100,
        telemetryChangedAt: "2026-08-10T00:00:00Z",
      },
      targets: [],
      collectorMetricsUrl: "http://collector/metrics",
      now: new Date("2026-08-10T00:03:00Z"),
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("otelcol_exporter_sent_metric_points 2")
        ),
    })

    expect(result.state.failures.telemetry).toBeUndefined()
    expect(result.state.telemetryValue).toBe(2)
    expect(result.state.telemetryChangedAt).toBe("2026-08-10T00:03:00.000Z")
  })

  it("monitors every current context readiness endpoint by default", () => {
    expect(watchdogTargets({})).toEqual([
      {
        name: "gateway",
        url: "http://gateway:4101/health/ready",
      },
      {
        name: "identity-access",
        url: "http://identity-access:4102/health/ready",
      },
      {
        name: "content-knowledge",
        url: "http://content-knowledge:4103/health/ready",
      },
      {
        name: "episode-production",
        url: "http://episode-production:4104/health/ready",
      },
      {
        name: "episode-library",
        url: "http://episode-library:4105/health/ready",
      },
      {
        name: "web",
        url: "http://web:4173/",
      },
      {
        name: "nats-jetstream",
        url: "http://nats:8222/healthz?js-enabled-only=true",
      },
      {
        name: "seaweedfs",
        url: "http://seaweedfs:9333/cluster/status",
      },
      {
        name: "voicevox",
        url: "http://voicevox:50021/version",
      },
    ])
  })

  it("sums all successful exporter counters", () => {
    expect(
      exportedPoints(
        'otelcol_exporter_sent_metric_points{a="b"} 2\notelcol_exporter_sent_log_records 3\nother 10'
      )
    ).toBe(5)
  })
})
