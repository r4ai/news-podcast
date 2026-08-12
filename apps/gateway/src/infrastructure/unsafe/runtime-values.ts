export const randomUuidUnsafe = (): string => crypto.randomUUID()

export const currentUtcInstantUnsafe = (): string => new Date().toISOString()
