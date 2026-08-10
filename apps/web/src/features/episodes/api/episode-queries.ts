import { api } from "@/shared/api"

/** `/`（生成）と `/library` の両方が読む。 */
export const episodesQueryOptions = api.queryOptions("get", "/v1/episodes")
