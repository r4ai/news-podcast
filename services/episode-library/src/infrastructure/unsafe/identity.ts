export const randomMessageIdUnsafe = (): string => crypto.randomUUID()
export const currentUtcInstantUnsafe = (): string => new Date().toISOString()
export const currentEpochMillisUnsafe = (): number => Date.now()
