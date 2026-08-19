import { scriptParagraphs } from "../-model"

/**
 * 読み上げた原稿そのもの。
 *
 * 台本はMarkdownではなく地の文なので、Markdownの描画器へは通さない。
 * 音を追いながら目でも追えるよう、行間を広く取って段落で区切る。
 */
export function EpisodeScript({ script }: { readonly script: string }) {
  const paragraphs = scriptParagraphs(script)

  return (
    <section
      aria-labelledby="episode-script-heading"
      className="flex flex-col gap-3"
    >
      <h3
        className="text-xs font-semibold tracking-wide text-foreground/80 uppercase"
        id="episode-script-heading"
      >
        原稿
      </h3>
      <div className="flex flex-col gap-4">
        {paragraphs.map((paragraph, index) => (
          <p
            className="text-[0.9375rem] leading-8 text-foreground/90"
            // 台本の段落に識別子は無く、並びが唯一の同一性。
            key={`${index}-${paragraph.slice(0, 16)}`}
          >
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  )
}
