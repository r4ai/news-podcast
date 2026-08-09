const ASCII_VISIBLE = /^[\x20-\x7e]+$/

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key must contain 1 to 255 visible ASCII characters")
    this.name = "InvalidIdempotencyKeyError"
  }
}

export function validateIdempotencyKey(value: string): string {
  if (value.length === 0 || value.length > 255 || !ASCII_VISIBLE.test(value)) {
    throw new InvalidIdempotencyKeyError()
  }

  return value
}
