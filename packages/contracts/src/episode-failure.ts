export const episodeFailureFamilies = [
  "deadline",
  "planning_transient",
  "content_transient",
  "script_timeout",
  "script_transient",
  "script_terminal",
  "speech_timeout",
  "speech_transient",
  "speech_terminal",
  "input_invalid",
  "no_candidates",
  "storage_transient",
  "checkpoint_invalid",
  "publication_transient",
  "internal_invariant",
] as const

export type EpisodeFailureFamily = (typeof episodeFailureFamilies)[number]

const directFailureDefinitions = [
  ["job_deadline_exceeded", "deadline"],
  ["generation_planning_canceled", "planning_transient"],
  ["generation_planning_unavailable", "planning_transient"],
  ["generation_planning_invalid_reply", "planning_transient"],
  ["generation_planning_correlation_mismatch", "planning_transient"],
  ["generation_planning_invalid_request", "input_invalid"],
  ["generation_planning_unauthenticated", "internal_invariant"],
  ["generation_planning_not_found", "input_invalid"],
  ["generation_planning_storage_failure", "storage_transient"],
  ["generation_planning_object_failure", "storage_transient"],
  ["generation_planning_internal_error", "planning_transient"],
  ["no_generation_candidates", "no_candidates"],
  ["generation_plan_owner_mismatch", "internal_invariant"],
  ["invalid_generation_plan", "internal_invariant"],
  ["content_materialization_canceled", "content_transient"],
  ["content_materialization_unavailable", "content_transient"],
  ["content_materialization_invalid", "input_invalid"],
  ["content_materialization_empty", "input_invalid"],
  ["missing_materialized_articles", "internal_invariant"],
  ["invalid_script_sources", "input_invalid"],
  ["script_quality_rejected", "input_invalid"],
  ["dictionary_snapshot_owner_mismatch", "internal_invariant"],
  ["audio_store_canceled", "storage_transient"],
  ["audio_store_unavailable", "storage_transient"],
  ["audio_delete_unavailable", "storage_transient"],
  ["invalid_audio", "input_invalid"],
  ["invalid_job_transition", "internal_invariant"],
  ["invalid_completion_transition", "internal_invariant"],
  ["invalid_completion_outbox", "internal_invariant"],
  ["completion_outbox_missing", "internal_invariant"],
  ["nats_completion_publish", "publication_transient"],
  ["sqlite_dictionary_prepare", "storage_transient"],
  ["sqlite_dictionary_snapshot_conflict", "checkpoint_invalid"],
  ["sqlite_checkpoint_missing_script", "checkpoint_invalid"],
] as const satisfies readonly (readonly [string, EpisodeFailureFamily])[]

export const sqliteFailureOperations = [
  "open_database",
  "lease_next",
  "mark_step",
  "report_stage_progress",
  "record_selected_articles",
  "renew_lease",
  "assert_lease",
  "load_checkpoint",
  "decode_checkpoint",
  "load_generation_plan",
  "decode_generation_plan",
  "list_used_automatic_articles",
  "save_generation_plan",
  "load_dictionary_snapshot",
  "decode_dictionary_snapshot",
  "save_dictionary_snapshot",
  "save_script_checkpoint",
  "save_audio_checkpoint",
  "transition",
  "complete_with_outbox",
  "check_cancellation",
  "find_job",
  "find_completion_outbox",
  "list_completion_outbox",
  "mark_completion_published",
] as const

export type SqliteFailureOperation = (typeof sqliteFailureOperations)[number]

const providerFailureReasons = [
  "rate_limited",
  "unavailable",
  "timeout",
  "incomplete",
  "client_error",
  "malformed_response",
  "refusal",
  "unexpected_status",
] as const

type ProviderFailureReason = (typeof providerFailureReasons)[number]
type ProviderStage = "script" | "speech"
type StagedProviderFailureCode = `${ProviderStage}_${ProviderFailureReason}`
type SqliteFailureCode =
  | `sqlite_${SqliteFailureOperation}`
  | `sqlite_${SqliteFailureOperation}_corrupt_record`
type DirectFailureCode = (typeof directFailureDefinitions)[number][0]

export type EpisodeFailureCode =
  | DirectFailureCode
  | StagedProviderFailureCode
  | SqliteFailureCode

const providerFamily = (
  stage: ProviderStage,
  reason: ProviderFailureReason
): EpisodeFailureFamily => {
  if (reason === "timeout") return `${stage}_timeout`
  if (
    reason === "rate_limited" ||
    reason === "unavailable" ||
    reason === "incomplete"
  )
    return `${stage}_transient`
  return `${stage}_terminal`
}

const generatedFailureDefinitions = [
  ...(["script", "speech"] as const).flatMap((stage) =>
    providerFailureReasons.map(
      (reason) => [`${stage}_${reason}`, providerFamily(stage, reason)] as const
    )
  ),
  ...sqliteFailureOperations.flatMap((operation) => [
    [`sqlite_${operation}`, "storage_transient"] as const,
    [`sqlite_${operation}_corrupt_record`, "checkpoint_invalid"] as const,
  ]),
] satisfies readonly (readonly [EpisodeFailureCode, EpisodeFailureFamily])[]

const failureDefinitions = [
  ...directFailureDefinitions,
  ...generatedFailureDefinitions,
] satisfies readonly (readonly [EpisodeFailureCode, EpisodeFailureFamily])[]

export const episodeFailureCodes = Object.freeze(
  failureDefinitions.map(([code]) => code)
) as readonly EpisodeFailureCode[]

export const episodeFailureFamilyByCode = Object.freeze(
  Object.fromEntries(failureDefinitions)
) as Readonly<Record<EpisodeFailureCode, EpisodeFailureFamily>>

const episodeFailureCodeSet: ReadonlySet<string> = new Set(episodeFailureCodes)

export const isEpisodeFailureCode = (
  value: string
): value is EpisodeFailureCode => episodeFailureCodeSet.has(value)
