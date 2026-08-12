/** Throwing JSON APIs are kept outside domain/application/adapters logic. */
export const parseJsonUnsafe = (input: string): unknown => JSON.parse(input)

export const stringifyJsonUnsafe = (input: unknown): string =>
  JSON.stringify(input)
