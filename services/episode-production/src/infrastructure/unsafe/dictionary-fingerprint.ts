import { createHash } from "node:crypto"

/** Node crypto interop for the canonical dictionary snapshot document. */
export const dictionaryFingerprintUnsafe = (canonical: string): string =>
  createHash("sha256").update(canonical, "utf8").digest("hex")
