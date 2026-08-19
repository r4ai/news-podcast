/** Throwing JSON serialization is kept outside domain/application logic. */
export const stringifyJsonUnsafe = (input: unknown): string =>
  JSON.stringify(input)
