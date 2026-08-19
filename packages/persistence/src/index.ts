export {
  IN_MEMORY_DATABASE_PATH,
  openDatabaseClientUnsafe,
  type DatabaseClientOptions,
} from "./client.js"
export {
  attemptDatabase,
  databaseOperation,
  scopedDatabaseClient,
} from "./effect.js"
export {
  classifyDatabaseFailure,
  databaseError,
  isDatabaseError,
  type DatabaseError,
  type DatabaseFailureReason,
} from "./errors.js"
export { decodePersistedJson, decodePersistedJsonSync } from "./json.js"
export { databaseSpanOptions, type DatabaseSpanOptions } from "./span.js"
