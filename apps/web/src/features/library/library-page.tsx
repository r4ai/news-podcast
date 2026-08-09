import { useState, useTransition } from "react"

import { api } from "@/api/client"

export function LibraryPage() {
  const episodes = api.useSuspenseQuery("get", "/v1/episodes")
  const access = api.useMutation(
    "post",
    "/v1/episodes/{episodeId}/audio-access"
  )
  const [audioUrl, setAudioUrl] = useState<string>()
  const [pending, startTransition] = useTransition()

  function play(episodeId: string) {
    startTransition(async () => {
      const result = await access.mutateAsync({
        params: { path: { episodeId } },
      })
      setAudioUrl(result.url)
    })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">ライブラリ</h1>
        <p className="mt-2 text-muted-foreground">
          音声と、台本の根拠になった記事を確認できます。
        </p>
      </header>
      {audioUrl && (
        <audio autoPlay className="w-full" controls src={audioUrl} />
      )}
      {episodes.data.items.map((episode) => (
        <article className="rounded-2xl border bg-card p-6" key={episode.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{episode.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {new Date(episode.createdAt).toLocaleString("ja-JP")}
              </p>
            </div>
            <button
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
              disabled={pending}
              onClick={() => play(episode.id)}
              type="button"
            >
              再生
            </button>
          </div>
          <details className="mt-5">
            <summary className="cursor-pointer font-medium">
              出典 {episode.sources.length}件
            </summary>
            <ul className="mt-3 space-y-2">
              {episode.sources.map((source) => (
                <li key={source.url}>
                  <a
                    className="text-sm text-primary underline"
                    href={source.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
      {episodes.data.items.length === 0 && (
        <p className="rounded-2xl border bg-card p-6 text-muted-foreground">
          完成した番組はまだありません。
        </p>
      )}
    </div>
  )
}
