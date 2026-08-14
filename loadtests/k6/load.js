import execution from "k6/execution"

import { hasOwnerIsolationFixtures } from "./fixtures.js"
import { runApiMix } from "./scenarios/api-mix.js"
import { runChaos } from "./scenarios/chaos.js"
import { runEpisodeJourney } from "./scenarios/episode-journey.js"
import {
  chaosThresholds,
  invalidProviderThresholds,
  normalThresholds,
} from "./thresholds.js"

const mode = __ENV.LOADTEST_MODE || "capacity"
const duration = __ENV.STAGE_DURATION || "180s"
const apiRate = Number(__ENV.API_RATE || "2")
const jobRate = Number(__ENV.JOB_RATE || "0.1")
const chaosProfile = __ENV.CHAOS_PROFILE || ""
const invalidProviderProfile = new Set([
  "malformed",
  "incomplete",
  "invalid-audio",
]).has(chaosProfile)
const jobRatePerMinute = Math.max(1, Math.round(jobRate * 60))
const apiVus = Math.max(10, Math.ceil(apiRate * 3))
const jobVus = Math.max(5, Math.ceil(jobRate * 30))
const ownerThresholds = hasOwnerIsolationFixtures
  ? {
      loadtest_owner_isolation_checks: ["count>0"],
      loadtest_owner_mismatch: ["rate<0.001"],
    }
  : {}

export const options = {
  scenarios: {
    api_mix: {
      executor: "constant-arrival-rate",
      rate: apiRate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: apiVus,
      maxVUs: apiVus * 4,
      exec: "apiMix",
    },
    episode_journey: {
      executor: "constant-arrival-rate",
      rate: jobRatePerMinute,
      timeUnit: "1m",
      duration,
      preAllocatedVUs: jobVus,
      maxVUs: jobVus * 4,
      exec: mode === "chaos" ? "chaos" : "episodeJourney",
    },
  },
  thresholds: {
    ...(mode === "chaos" ? chaosThresholds : normalThresholds),
    ...(mode === "chaos" && invalidProviderProfile
      ? invalidProviderThresholds
      : {}),
    ...ownerThresholds,
  },
}

export const apiMix = () => runApiMix()
export const episodeJourney = () => runEpisodeJourney()
export const chaos = () => runChaos()

export default function () {
  if (execution.scenario.name === "api_mix") runApiMix()
  else if (mode === "chaos") runChaos()
  else runEpisodeJourney()
}
