/**
 * RIFF/WAVEコンテナの最小限の読み書き。
 * 分割合成した音声を、1本の再生可能なWAVへ継ぎ直すためだけに使う。
 */

import {
  parsePlayableWave,
  type ParsedWave,
} from "../../../application/wave.js"

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    true
  )

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index])

/** 形式が完全に一致する断片だけを連結し、上限を超えるなら諦める。 */
export const mergeWaves = (
  waves: readonly Uint8Array[],
  maximumBytes: number
): Uint8Array | undefined => {
  const parsed = waves.map(parsePlayableWave)
  if (parsed.some((wave) => wave === undefined)) return undefined
  const complete = parsed as readonly ParsedWave[]
  const first = complete[0]
  if (
    !first ||
    complete.some((wave) => !equalBytes(wave.format, first.format))
  ) {
    return undefined
  }
  const dataLength = complete.reduce(
    (total, wave) => total + wave.data.byteLength,
    0
  )
  const outputLength = first.header.byteLength + dataLength
  if (!Number.isSafeInteger(outputLength) || outputLength > maximumBytes) {
    return undefined
  }
  const output = new Uint8Array(outputLength)
  output.set(first.header)
  let offset = first.header.byteLength
  for (const wave of complete) {
    output.set(wave.data, offset)
    offset += wave.data.byteLength
  }
  writeUint32(output, 4, output.byteLength - 8)
  writeUint32(output, first.header.byteLength - 4, dataLength)
  return output
}
