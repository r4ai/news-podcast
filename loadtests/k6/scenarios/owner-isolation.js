import http from "k6/http"
import { check } from "k6"

import {
  articleIdsFor,
  baseUrl,
  episodeIdsFor,
  hasOwnerIsolationFixtures,
  jobIdsFor,
  ownerSessionFor,
  sessionForVu,
} from "../fixtures.js"
import { apiLatency, ownerIsolationChecks, ownerMismatch } from "../metrics.js"

const isInaccessible = (response) =>
  response.status === 403 || response.status === 404

const recordProbe = (response, route) => {
  const isolated = isInaccessible(response)
  ownerIsolationChecks.add(1)
  ownerMismatch.add(!isolated)
  check(response, { [`${route} owner isolation`]: () => isolated })
}

const probe = (session, path, route) => {
  const response = http.get(`${baseUrl}${path}`, {
    headers: { Cookie: session.cookie },
    tags: { route },
  })
  apiLatency.add(response.timings.duration, { route })
  recordProbe(response, route)
}

export const runOwnerIsolation = () => {
  if (!hasOwnerIsolationFixtures) return

  const ownerSession = sessionForVu()
  const foreignSession = ownerSessionFor(ownerSession)
  if (foreignSession === undefined) return

  const articleId = articleIdsFor(ownerSession)[0]
  if (articleId !== undefined)
    probe(
      foreignSession,
      `/v1/me/articles/${articleId}`,
      "ownerIsolationArticle"
    )

  const jobId = jobIdsFor(ownerSession)[0]
  if (jobId !== undefined)
    probe(foreignSession, `/v1/episode-jobs/${jobId}`, "ownerIsolationJob")

  const episodeId = episodeIdsFor(ownerSession)[0]
  if (episodeId !== undefined) {
    probe(foreignSession, `/v1/episodes/${episodeId}`, "ownerIsolationEpisode")
    probe(
      foreignSession,
      `/v1/episodes/${episodeId}/audio`,
      "ownerIsolationAudio"
    )
  }
}
