import { randomUUID } from "node:crypto"

/** Nondeterministic platform values stay outside the functional runtime. */
export const randomMessageIdUnsafe = (): string => randomUUID()
export const currentUtcInstantUnsafe = (): string => new Date().toISOString()
