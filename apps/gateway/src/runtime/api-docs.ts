import { renderApiReference } from "@scalar/client-side-rendering"

import { generateOpenApi } from "../contract.js"

const scalarCdn = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1"
const responseHeaders = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
})
const openApiDocument = JSON.stringify(generateOpenApi())
const scalarReference = renderApiReference({
  pageTitle: "News Podcast API Reference",
  cdn: scalarCdn,
  config: {
    url: "/openapi.json",
    theme: "purple",
  },
})

const bodyFor = (method: string, body: string) =>
  method === "HEAD" ? null : body

/** Serves public, read-only API documentation without coupling it to HttpApi. */
export const routeApiDocs = (request: Request): Response | undefined => {
  const { pathname } = new URL(request.url)
  if (pathname !== "/openapi.json" && pathname !== "/docs") return undefined

  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD", ...responseHeaders },
    })

  const isDocument = pathname === "/openapi.json"
  const body = isDocument ? openApiDocument : scalarReference
  return new Response(bodyFor(request.method, body), {
    headers: {
      ...responseHeaders,
      "content-type": isDocument
        ? "application/json; charset=utf-8"
        : "text/html; charset=utf-8",
    },
  })
}
