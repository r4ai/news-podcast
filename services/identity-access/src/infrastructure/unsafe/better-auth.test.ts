import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { describe, expect, it, vi } from "vitest"

import {
  createIdentityAuthUnsafe,
  makeIdentitySessionApi,
} from "./better-auth.js"

describe("Identity session API composition", () => {
  it("resolves the exact development Bearer token without consulting Better Auth", async () => {
    const getSession = vi.fn()
    const api = makeIdentitySessionApi(
      { getSession },
      {
        enabled: true,
        token: "hermetic-bearer-token",
        userId: "better-auth-dev_user",
      }
    )

    const result = await api.getSession({
      headers: new Headers({
        authorization: "Bearer hermetic-bearer-token",
      }),
    })

    expect(result).toEqual({ user: { id: "better-auth-dev_user" } })
    expect(getSession).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", undefined],
    ["wrong scheme", "Basic hermetic-bearer-token"],
    ["wrong token", "Bearer another-token"],
    ["extra whitespace", "Bearer  hermetic-bearer-token"],
  ])("delegates %s Authorization to Better Auth", async (_case, header) => {
    const getSession = vi.fn().mockResolvedValue(null)
    const api = makeIdentitySessionApi(
      { getSession },
      {
        enabled: true,
        token: "hermetic-bearer-token",
        userId: "better-auth-dev_user",
      }
    )
    const headers = new Headers()
    if (header !== undefined) headers.set("authorization", header)

    expect(await api.getSession({ headers })).toBeNull()
    expect(getSession).toHaveBeenCalledOnce()
  })

  it("never accepts the dev token when disabled", async () => {
    const getSession = vi.fn().mockResolvedValue(null)
    const api = makeIdentitySessionApi({ getSession }, { enabled: false })

    expect(
      await api.getSession({
        headers: new Headers({
          authorization: "Bearer hermetic-bearer-token",
        }),
      })
    ).toBeNull()
    expect(getSession).toHaveBeenCalledOnce()
  })

  it("migrates and closes the Identity-owned Better Auth database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "identity-auth-"))
    const databasePath = join(directory, "identity.sqlite")
    try {
      const auth = await createIdentityAuthUnsafe({
        databasePath,
        secret: "s".repeat(32),
        baseUrl: "http://localhost:4173",
        devAuth: { enabled: false },
      })

      expect(await auth.api.getSession({ headers: new Headers() })).toBeNull()
      auth.close()

      const database = new DatabaseSync(databasePath)
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => row.name)
      database.close()
      expect(tables).toEqual(
        expect.arrayContaining(["account", "session", "user", "verification"])
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
