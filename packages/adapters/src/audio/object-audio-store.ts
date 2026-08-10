import type {
  AudioStore,
  ObjectStore,
  StoredAudio,
} from "@news-podcast/application"

export class ObjectAudioStore implements AudioStore {
  constructor(private readonly objects: ObjectStore) {}

  async put(
    ownerId: string,
    episodeId: string,
    audio: Uint8Array,
    signal?: AbortSignal
  ): Promise<StoredAudio> {
    const key = `episodes/${ownerId}/${episodeId}.wav`
    const stored = await this.objects.put({
      key,
      body: audio,
      contentType: "audio/wav",
      ...(signal ? { signal } : {}),
    })
    return { key: stored.key, byteLength: stored.byteLength }
  }

  createAccessUrl(): Promise<URL> {
    throw new Error("Audio access URLs are issued by the HTTP boundary")
  }
}
