import { drizzle } from "drizzle-orm/node-sqlite"
import { expect, it } from "vitest"

import { openEpisodeLibraryDatabaseUnsafe } from "../../../infrastructure/unsafe/drizzle/open.js"
import { selectEpisodePage } from "./reader.js"

it("selects only owner-scoped metadata in one SQL query", () => {
  const handle = openEpisodeLibraryDatabaseUnsafe(":memory:")
  const queries: string[] = []
  const database = drizzle({
    client: handle.client,
    logger: {
      logQuery: (sql) => {
        queries.push(sql)
      },
    },
  })
  try {
    selectEpisodePage(database, "owner" as never, { limit: 21 })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatch(
      /select "id", "owner_id", "title", "created_at" from "episodes"/
    )
    expect(queries[0]).not.toMatch(/script|audio|episode_sources/)
    expect(queries[0]).toContain('where "episodes"."owner_id" = ?')
  } finally {
    handle.close()
  }
})
