import http from "k6/http"
import { check } from "k6"

import { articleIdsFor, baseUrl, sessionForVu } from "../fixtures.js"
import { apiError, apiLatency, ownerMismatch } from "../metrics.js"
import { runOwnerIsolation } from "./owner-isolation.js"

const request = (session, method, path, body, route) => {
  const response = http.request(
    method,
    `${baseUrl}${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        Cookie: session.cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      tags: { route },
    }
  )
  apiLatency.add(response.timings.duration, { route })
  return response
}

const json = (response) => {
  try {
    return response.json()
  } catch {
    return undefined
  }
}

const checkResponse = (response, name, expectedStatus = 200) => {
  const ok = check(response, {
    [`${name} status`]: (value) => value.status === expectedStatus,
  })
  apiError.add(!ok)
  return ok
}

export const runApiMix = () => {
  const session = sessionForVu()
  if ((__ITER + __VU) % 10 === 0) runOwnerIsolation()
  const articlesResponse = request(
    session,
    "GET",
    "/v1/me/articles?limit=100&sort=newest",
    undefined,
    "listArticles"
  )
  if (!checkResponse(articlesResponse, "listArticles")) return

  const articles = json(articlesResponse)?.items ?? []
  const articleIds = articleIdsFor(
    session,
    articles.map((article) => article.id)
  )
  const articleId = articleIds[__ITER % articleIds.length]

  const operation = (__ITER + __VU) % 8
  if (operation === 0) {
    checkResponse(
      request(
        session,
        "GET",
        "/v1/me/articles/facets",
        undefined,
        "articleFacets"
      ),
      "articleFacets"
    )
  } else if (operation === 1) {
    checkResponse(
      request(
        session,
        "GET",
        "/v1/me/feed-subscriptions",
        undefined,
        "listSubscriptions"
      ),
      "listSubscriptions"
    )
  } else if (operation === 2) {
    checkResponse(
      request(session, "GET", "/v1/feeds?q=news", undefined, "listFeeds"),
      "listFeeds"
    )
  } else if (operation === 3) {
    checkResponse(
      request(session, "GET", "/v1/me/settings", undefined, "getSettings"),
      "getSettings"
    )
  } else if (operation === 4) {
    checkResponse(
      request(
        session,
        "GET",
        "/v1/episode-jobs?limit=20",
        undefined,
        "listEpisodeJobs"
      ),
      "listEpisodeJobs"
    )
  } else if (operation === 5) {
    checkResponse(
      request(session, "GET", "/v1/episodes", undefined, "listEpisodes"),
      "listEpisodes"
    )
  } else if (operation === 6 && articleId !== undefined) {
    const response = request(
      session,
      "PATCH",
      `/v1/me/articles/${articleId}`,
      { read: (__ITER + __VU) % 2 === 0 },
      "patchArticle"
    )
    checkResponse(response, "patchArticle")
    const returned = json(response)
    ownerMismatch.add(returned?.id !== undefined && returned.id !== articleId)
  } else if (articleId !== undefined) {
    checkResponse(
      request(
        session,
        "GET",
        `/v1/me/articles/${articleId}`,
        undefined,
        "getArticle"
      ),
      "getArticle"
    )
  }
}
