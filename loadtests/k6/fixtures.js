const sessionsFile = __ENV.LOADTEST_SESSIONS_FILE || "/data/sessions.json"
const rawSessions = JSON.parse(
  __ENV.LOADTEST_SESSIONS_JSON || open(sessionsFile)
)

export const sessions = Array.isArray(rawSessions)
  ? rawSessions
  : rawSessions.sessions

if (
  !Array.isArray(sessions) ||
  sessions.length === 0 ||
  sessions.some(
    (session) =>
      typeof session?.cookie !== "string" || session.cookie.trim() === ""
  )
) {
  throw new Error(`Invalid load-test sessions file: ${sessionsFile}`)
}

export const sessionForVu = () => sessions[(__VU - 1) % sessions.length]

export const hasOwnerIsolationFixtures =
  new Set(
    sessions
      .map((session) => session.ownerId)
      .filter((ownerId) => typeof ownerId === "string" && ownerId.length > 0)
  ).size >= 2

export const ownerSessionFor = (session) => {
  const index = sessions.indexOf(session)
  for (let offset = 1; offset <= sessions.length; offset += 1) {
    const candidate = sessions[(index + offset) % sessions.length]
    if (
      typeof session.ownerId === "string" &&
      typeof candidate.ownerId === "string" &&
      candidate.ownerId !== session.ownerId
    )
      return candidate
  }
  return undefined
}

export const articleIdsFor = (session, fallback = []) => {
  const ids = Array.isArray(session?.articleIds) ? session.articleIds : fallback
  return ids.filter((id) => typeof id === "string" && id.length > 0)
}

export const jobIdsFor = (session) =>
  (Array.isArray(session?.jobIds) ? session.jobIds : []).filter(
    (id) => typeof id === "string" && id.length > 0
  )

export const episodeIdsFor = (session) =>
  (Array.isArray(session?.episodeIds) ? session.episodeIds : []).filter(
    (id) => typeof id === "string" && id.length > 0
  )

export const baseUrl = (
  __ENV.LOADTEST_BASE_URL || "http://127.0.0.1:4001"
).replace(/\/$/, "")
