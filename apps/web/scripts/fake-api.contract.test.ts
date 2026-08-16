import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { createFakeApi, fakeApiIdentifiers } from "./fake-api"

/**
 * 偽Gatewayが実契約(OpenAPI)からずれていないことを検査する。
 *
 * 本文Markdownで実際に起きたのは「Webが`parseAs: "text"`で生JSON文字列を
 * 受け取る」バグだったが、偽Gatewayが`text/markdown`で本文を返していたため
 * 単体・Storybook・視覚回帰・e2eの全てが通り続けた。テストダブルが実契約では
 * なく実装のバグに合わせると、どの層も嘘を検知できなくなる。ここが最後の砦。
 */

type MediaType = { readonly schema?: JsonSchema }
type JsonSchema = {
  readonly type?: string
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | JsonSchema
  readonly items?: JsonSchema
  readonly anyOf?: readonly JsonSchema[]
  readonly allOf?: readonly JsonSchema[]
  readonly $ref?: string
}

// jsdom環境では`import.meta.url`がhttp originになるのでfile URLは使えない。
// vitestのrootは`apps/web`なので、そこからの相対で解決する。
const openapi = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../packages/contracts/openapi/openapi.json"),
    "utf8"
  )
) as {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content?: Record<string, MediaType> }> }
    >
  >
  components?: { schemas?: Record<string, JsonSchema> }
}

function resolveRef(schema: JsonSchema): JsonSchema {
  if (schema.$ref === undefined) return schema
  const name = schema.$ref.replace("#/components/schemas/", "")
  const resolved = openapi.components?.schemas?.[name]
  if (resolved === undefined) throw new Error(`unknown $ref: ${schema.$ref}`)
  return resolveRef(resolved)
}

/**
 * 完全なJSON Schema検証はしない(validatorを新規依存にしたくない)。
 * 「必須プロパティが揃っているか」と「宣言されていないプロパティを足して
 * いないか」だけを見る。契約ずれはこの2つでほぼ捕まる。
 */
function assertMatches(
  value: unknown,
  rawSchema: JsonSchema,
  path: string
): void {
  const schema = resolveRef(rawSchema)

  if (schema.anyOf !== undefined) {
    const matched = schema.anyOf.some((candidate) => {
      try {
        assertMatches(value, candidate, path)
        return true
      } catch {
        return false
      }
    })
    expect(matched, `${path} matches none of anyOf`).toBe(true)
    return
  }
  for (const part of schema.allOf ?? []) assertMatches(value, part, path)

  if (schema.type === "array") {
    expect(Array.isArray(value), `${path} should be an array`).toBe(true)
    if (schema.items !== undefined) {
      for (const [index, item] of (value as unknown[]).entries()) {
        assertMatches(item, schema.items, `${path}[${index}]`)
      }
    }
    return
  }
  if (schema.type !== "object" && schema.properties === undefined) return

  expect(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} should be an object, got ${JSON.stringify(value)}`
  ).toBe(true)
  const record = value as Record<string, unknown>

  for (const key of schema.required ?? []) {
    expect(record, `${path} is missing required "${key}"`).toHaveProperty(key)
  }
  if (
    schema.additionalProperties === false &&
    schema.properties !== undefined
  ) {
    const declared = new Set(Object.keys(schema.properties))
    const extra = Object.keys(record).filter((key) => !declared.has(key))
    expect(extra, `${path} has undeclared properties`).toEqual([])
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (record[key] !== undefined && record[key] !== null) {
      assertMatches(record[key], child, `${path}.${key}`)
    }
  }
}

function successMediaTypes(template: string, method: string) {
  const operation = openapi.paths[template]?.[method.toLowerCase()]
  if (operation === undefined) {
    throw new Error(`${method} ${template} is not in the OpenAPI document`)
  }
  const success = Object.entries(operation.responses).find(([status]) =>
    status.startsWith("2")
  )
  if (success === undefined) {
    throw new Error(`${method} ${template} has no 2xx response`)
  }
  return success[1].content ?? {}
}

const articleId = "00000000-0000-4000-8000-000000000010"

/** 偽Gatewayが実装していて、OpenAPIにも定義があるGETの組。 */
const cases = [
  { template: "/v1/me/articles", path: "/v1/me/articles" },
  {
    template: "/v1/me/articles/{articleId}",
    path: `/v1/me/articles/${articleId}`,
  },
  {
    template: "/v1/me/articles/{articleId}/markdown",
    path: `/v1/me/articles/${articleId}/markdown`,
  },
  { template: "/v1/me/articles/facets", path: "/v1/me/articles/facets" },
  { template: "/v1/me/feed-subscriptions", path: "/v1/me/feed-subscriptions" },
  { template: "/v1/me/feed-sync-jobs", path: "/v1/me/feed-sync-jobs" },
  { template: "/v1/me/settings", path: "/v1/me/settings" },
  { template: "/v1/episodes", path: "/v1/episodes" },
  { template: "/v1/episode-jobs", path: "/v1/episode-jobs" },
] as const

async function get(path: string): Promise<Response> {
  const api = createFakeApi({ webPort: 4173 })
  return api.fetch(
    new Request(`http://127.0.0.1:4000${path}`, {
      headers: { cookie: fakeApiIdentifiers.sessionCookie },
    })
  )
}

describe("fake gateway conforms to the OpenAPI contract", () => {
  it.each(cases)("GET $template", async ({ template, path }) => {
    const media = successMediaTypes(template, "GET")
    const declaredType = Object.keys(media)[0]
    const response = await get(path)

    expect(response.status).toBe(200)
    expect(
      response.headers.get("content-type"),
      `GET ${template} must answer with ${declaredType}`
    ).toContain(declaredType)

    const schema = media[declaredType!]?.schema
    if (schema !== undefined) {
      assertMatches(await response.json(), schema, template)
    }
  })

  // 回帰の本体。本文はJSONに包まれて返るのであって、生Markdownではない。
  it("returns the article body as JSON rather than raw markdown", async () => {
    const response = await get(`/v1/me/articles/${articleId}/markdown`)

    expect(response.headers.get("content-type")).toContain("application/json")
    const body = (await response.json()) as { markdown: string }
    expect(typeof body.markdown).toBe("string")
    expect(body.markdown.startsWith("#")).toBe(true)
  })
})
