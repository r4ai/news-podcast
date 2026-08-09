import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { AudioStore, StoredAudio } from "@news-podcast/application"

export class LocalAudioStore implements AudioStore {
  constructor(private readonly directory: string) {}

  async put(
    ownerId: string,
    episodeId: string,
    audio: Uint8Array
  ): Promise<StoredAudio> {
    const key = join(ownerId, `${episodeId}.wav`)
    const destination = join(this.directory, key)
    const temporary = `${destination}.tmp`
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(temporary, audio)
    await rename(temporary, destination)
    return { key, byteLength: audio.byteLength }
  }

  createAccessUrl(): Promise<URL> {
    throw new Error("Audio access URLs are issued by the HTTP boundary")
  }

  resolve(key: string): string {
    const root = resolve(this.directory)
    const target = resolve(root, key)
    const pathFromRoot = relative(root, target)
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
      throw new Error("invalid-audio-key")
    }
    return target
  }
}
