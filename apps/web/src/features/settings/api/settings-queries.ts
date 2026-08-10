import { api } from "@/shared/api"

/** `/`（生成）と `/schedule` の両方が読む。 */
export const settingsQueryOptions = api.queryOptions("get", "/v1/me/settings")
