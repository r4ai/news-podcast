import http from "k6/http"
import { check, sleep } from "k6"

import { articleIdsFor, baseUrl, sessionForVu } from "../fixtures.js"
import { runOwnerIsolation } from "./owner-isolation.js"
import {
  apiError,
  apiLatency,
  chaosExpectedTerminal,
  chaosPublicationChecks,
  chaosPublicationLeak,
  completedJobs,
  enqueueLatency,
  enqueueSuccess,
  jobCompletion,
  jobSuccess,
  jobTerminal,
  ownerMismatch,
} from "../metrics.js"

let previousIdempotencyKey

const request = (session, method, path, body, route, idempotencyKey) => {
  const response = http.request(
    method,
    `${baseUrl}${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        Cookie: session.cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": idempotencyKey }),
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

const terminal = new Set(["succeeded", "failed", "canceled"])
const chaosProfile = __ENV.CHAOS_PROFILE || ""
const invalidProviderProfile = new Set([
  "malformed",
  "incomplete",
  "invalid-audio",
]).has(chaosProfile)

const inaccessible = (response) =>
  response.status === 403 || response.status === 404

const episodeIdsFrom = (response) =>
  new Set(
    (json(response)?.items ?? [])
      .map((episode) => episode.id)
      .filter((id) => typeof id === "string")
  )

const recordCheck = (response, name, expectedStatus) => {
  const ok = check(response, {
    [`${name} status`]: (value) => value.status === expectedStatus,
  })
  apiError.add(!ok)
  return ok
}

const listEpisodeIds = (session, route) => {
  const response = request(
    session,
    "GET",
    "/v1/episodes?limit=100",
    undefined,
    route
  )
  return recordCheck(response, route, 200)
    ? episodeIdsFrom(response)
    : undefined
}

const checkNoPublication = (session, beforeIds, job) => {
  const afterIds = listEpisodeIds(session, "listEpisodesAfterChaos")
  if (beforeIds === undefined || afterIds === undefined) {
    chaosPublicationChecks.add(1, { profile: chaosProfile })
    chaosPublicationLeak.add(true, { profile: chaosProfile })
    return
  }

  const episodeIds = new Set(
    [...afterIds].filter((episodeId) => !beforeIds.has(episodeId))
  )
  if (typeof job?.episodeId === "string") episodeIds.add(job.episodeId)

  let leaked = false
  for (const episodeId of episodeIds) {
    const episodeResponse = request(
      session,
      "GET",
      `/v1/episodes/${episodeId}`,
      undefined,
      "chaosPublishedEpisode"
    )
    const episodeUnavailable = inaccessible(episodeResponse)
    check(episodeResponse, {
      chaosEpisodeUnavailable: () => episodeUnavailable,
    })
    leaked = leaked || !episodeUnavailable

    const audioResponse = request(
      session,
      "GET",
      `/v1/episodes/${episodeId}/audio`,
      undefined,
      "chaosPublishedAudio"
    )
    const audioUnavailable = inaccessible(audioResponse)
    check(audioResponse, { chaosAudioUnavailable: () => audioUnavailable })
    leaked = leaked || !audioUnavailable
  }

  chaosPublicationChecks.add(1, { profile: chaosProfile })
  chaosPublicationLeak.add(leaked, { profile: chaosProfile })
}

export const runEpisodeJourney = () => {
  const session = sessionForVu()
  if ((__ITER + __VU) % 10 === 0) runOwnerIsolation()
  const episodeIdsBeforeChaos = invalidProviderProfile
    ? listEpisodeIds(session, "listEpisodesBeforeChaos")
    : undefined
  const articleResponse = request(
    session,
    "GET",
    "/v1/me/articles?limit=20&state=unread",
    undefined,
    "listArticlesForJob"
  )
  if (!recordCheck(articleResponse, "listArticlesForJob", 200)) return

  const articleIds = articleIdsFor(
    session,
    (json(articleResponse)?.items ?? []).map((article) => article.id)
  ).slice(0, 3)
  if (articleIds.length === 0) return

  const duplicate = (__ITER + __VU) % 100 === 0 && previousIdempotencyKey
  const idempotencyKey = duplicate
    ? previousIdempotencyKey
    : `loadtest:${__VU}:${__ITER}:${Date.now()}`
  previousIdempotencyKey = idempotencyKey
  const enqueueStarted = Date.now()
  const enqueueResponse = request(
    session,
    "POST",
    "/v1/episode-jobs",
    { trigger: "manual", articleIds },
    "createEpisodeJob",
    idempotencyKey
  )
  enqueueLatency.add(Date.now() - enqueueStarted)
  const accepted = recordCheck(enqueueResponse, "createEpisodeJob", 202)
  enqueueSuccess.add(accepted)
  if (!accepted) return

  const receipt = json(enqueueResponse)
  const jobId = receipt?.id
  if (typeof jobId !== "string") return

  if (duplicate) {
    const duplicateResponse = request(
      session,
      "POST",
      "/v1/episode-jobs",
      { trigger: "manual", articleIds },
      "createEpisodeJobDuplicate",
      idempotencyKey
    )
    const duplicateBody = json(duplicateResponse)
    ownerMismatch.add(duplicateBody?.id !== jobId)
  }

  const eventResponse = request(
    session,
    "GET",
    `/v1/episode-jobs/${jobId}/events?lastEventId=0`,
    undefined,
    "streamEpisodeJobEvents"
  )
  recordCheck(eventResponse, "streamEpisodeJobEvents", 200)

  const startedAt = Date.now()
  let status
  let job
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = request(
      session,
      "GET",
      `/v1/episode-jobs/${jobId}`,
      undefined,
      "getEpisodeJob"
    )
    if (!recordCheck(response, "getEpisodeJob", 200)) return
    job = json(response)
    status = job?.status
    if (terminal.has(status)) break
    sleep(1)
  }

  const succeeded = status === "succeeded"
  jobTerminal.add(terminal.has(status))
  jobSuccess.add(succeeded)
  if (__ENV.LOADTEST_MODE === "chaos") {
    const expectedTerminal = invalidProviderProfile
      ? status === "failed"
      : terminal.has(status)
    chaosExpectedTerminal.add(expectedTerminal, { profile: chaosProfile })
    if (invalidProviderProfile)
      checkNoPublication(session, episodeIdsBeforeChaos, job)
  }
  if (!terminal.has(status)) return
  if (!succeeded) return

  jobCompletion.add(Date.now() - startedAt)
  completedJobs.add(1)
  const episodeId = job?.episodeId
  if (typeof episodeId !== "string") return

  const episodeResponse = request(
    session,
    "GET",
    `/v1/episodes/${episodeId}`,
    undefined,
    "getEpisode"
  )
  if (!recordCheck(episodeResponse, "getEpisode", 200)) return
  const episode = json(episodeResponse)
  const sourceUrls = new Set(
    (episode?.sources ?? []).map((source) => source.url)
  )
  ownerMismatch.add(sourceUrls.size === 0)

  // 音声は署名URLの発行ではなく、Gateway経由の同一originストリーム (ADR-0055)。
  const audioResponse = request(
    session,
    "GET",
    `/v1/episodes/${episodeId}/audio`,
    undefined,
    "streamEpisodeAudio"
  )
  recordCheck(audioResponse, "streamEpisodeAudio", 200)
}
