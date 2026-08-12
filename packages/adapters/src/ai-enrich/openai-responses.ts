type StructuredInputMessage = {
  readonly role: "system" | "user"
  readonly content: string
}

type JsonSchemaFormat = {
  readonly type: "json_schema"
  readonly name: string
  readonly strict: true
  readonly schema: Readonly<Record<string, unknown>>
}

/**
 * AI補助が全モデルへ送ってよいResponses APIパラメータの共通部分。
 * モデル依存パラメータを追加する場合は、ここを広げず専用の契約を作る。
 */
export type PortableStructuredResponseRequest = {
  readonly model: string
  readonly input: readonly StructuredInputMessage[]
  readonly text: {
    readonly format: JsonSchemaFormat
  }
}

/** 型と実行時allow-listの両方で、モデル依存パラメータの混入を防ぐ。 */
export function createPortableStructuredResponseRequest(
  request: PortableStructuredResponseRequest
): PortableStructuredResponseRequest {
  return {
    model: request.model,
    input: request.input,
    text: request.text,
  }
}

/** OpenAIのエラー本文から、安全に診断へ残せるmessageだけを取り出す。 */
export async function readOpenAiErrorMessage(
  response: Response
): Promise<string | undefined> {
  try {
    const body = (await response.json()) as unknown
    if (!isRecord(body) || !isRecord(body.error)) return undefined
    return typeof body.error.message === "string"
      ? body.error.message
      : undefined
  } catch {
    return undefined
  }
}

export function isRetryableOpenAiStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

export function hasOpenAiRefusal(output: readonly unknown[] | undefined): boolean {
  return (output ?? []).some((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) return false
    return item.content.some(
      (content) => isRecord(content) && content.type === "refusal"
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
