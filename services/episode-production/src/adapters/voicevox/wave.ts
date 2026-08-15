/**
 * RIFF/WAVEコンテナの最小限の読み書き。
 * 分割合成した音声を、1本の再生可能なWAVへ継ぎ直すためだけに使う。
 */

type ParsedWave = Readonly<{
  readonly header: Uint8Array
  readonly format: Uint8Array
  readonly data: Uint8Array
}>

const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + 4))

const uint32At = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true
  )

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value,
    true
  )

// 宣言長と実長が食い違う入力は、部分的に読めても丸ごと拒む。
const parseWave = (bytes: Uint8Array): ParsedWave | undefined => {
  if (
    bytes.byteLength < 12 ||
    ascii(bytes, 0) !== "RIFF" ||
    ascii(bytes, 8) !== "WAVE" ||
    uint32At(bytes, 4) + 8 !== bytes.byteLength
  ) {
    return undefined
  }
  let format: Uint8Array | undefined
  let header: Uint8Array | undefined
  let data: Uint8Array | undefined
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) return undefined
    const name = ascii(bytes, offset)
    const length = uint32At(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const paddedEnd = dataEnd + (length % 2)
    if (dataEnd < dataStart || paddedEnd > bytes.byteLength) return undefined
    if (name === "fmt ") format = bytes.slice(dataStart, dataEnd)
    if (name === "data") {
      if (data !== undefined || paddedEnd !== bytes.byteLength) return undefined
      header = bytes.slice(0, dataStart)
      data = bytes.slice(dataStart, dataEnd)
    }
    offset = paddedEnd
  }
  if (!format || format.byteLength < 16 || !header || !data) return undefined
  return { header, format, data }
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index])

/** 形式が完全に一致する断片だけを連結し、上限を超えるなら諦める。 */
export const mergeWaves = (
  waves: readonly Uint8Array[],
  maximumBytes: number
): Uint8Array | undefined => {
  const parsed = waves.map(parseWave)
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
