import { useGeneration } from "../hooks/use-generation"
import { PodcastDashboard } from "./podcast-dashboard"

/**
 * データ接続: hookを呼び、presentationalな `PodcastDashboard` へ渡すだけ。
 * `PodcastDashboard` 側はpropsのみなのでStorybookでそのまま検証できる。
 */
export function GenerationDashboard() {
  const generation = useGeneration()
  return <PodcastDashboard {...generation} />
}
