export type ParsedWave = Readonly<{
  readonly header: Uint8Array
  readonly format: Uint8Array
  readonly data: Uint8Array
}>

const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + 4))

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const uint16At = (bytes: Uint8Array, offset: number): number =>
  view(bytes).getUint16(offset, true)

const uint32At = (bytes: Uint8Array, offset: number): number =>
  view(bytes).getUint32(offset, true)

/** Validates the bounded PCM RIFF/WAVE shape accepted by the application. */
export const parsePlayableWave = (
  bytes: Uint8Array
): ParsedWave | undefined => {
  if (
    bytes.byteLength < 44 ||
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
  const audioFormat = uint16At(format, 0)
  const channels = uint16At(format, 2)
  const sampleRate = uint32At(format, 4)
  const byteRate = uint32At(format, 8)
  const blockAlign = uint16At(format, 12)
  const bitsPerSample = uint16At(format, 14)
  if (
    audioFormat !== 1 ||
    channels < 1 ||
    sampleRate < 1 ||
    byteRate < 1 ||
    blockAlign < 1 ||
    bitsPerSample < 1 ||
    bitsPerSample % 8 !== 0 ||
    blockAlign !== channels * (bitsPerSample / 8) ||
    data.byteLength < 1 ||
    data.byteLength % blockAlign !== 0 ||
    byteRate !== sampleRate * blockAlign
  ) {
    return undefined
  }
  return { header, format, data }
}
