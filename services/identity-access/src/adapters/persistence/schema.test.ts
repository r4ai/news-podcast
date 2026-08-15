import { describe, expect, it } from "vitest"

import { openIdentityDatabaseUnsafe } from "../../infrastructure/unsafe/drizzle/open.js"

const userSettingsSql = (): string => {
  const handle = openIdentityDatabaseUnsafe(":memory:")
  try {
    const row = handle.client
      .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
      .get("user_settings")
    return String(row?.sql ?? "")
  } finally {
    handle.close()
  }
}

/**
 * STRICTはdrizzle-kitが生成できずマイグレーションSQLへ手で追記している。
 * 併せて、Identityが所有しないBetter Authのテーブルを取り込んでいないことも固定する。
 */
describe("identity-access migrated schema", () => {
  it("declares user_settings as STRICT", () => {
    expect(userSettingsSql()).toContain("STRICT")
  })

  it("rejects a schedule flag outside the boolean encoding", () => {
    expect(userSettingsSql()).toContain(`CHECK("schedule_enabled" IN (0, 1))`)
  })

  it("does not claim ownership of the Better Auth tables", () => {
    const handle = openIdentityDatabaseUnsafe(":memory:")
    try {
      const tables = handle.client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name))

      expect(tables).toContain("user_settings")
      expect(tables).not.toContain("user")
      expect(tables).not.toContain("session")
    } finally {
      handle.close()
    }
  })
})
