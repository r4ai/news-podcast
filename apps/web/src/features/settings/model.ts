import type { components } from "@news-podcast/contracts/openapi"

export type UserSettings = components["schemas"]["UserSettings"]
export type GenerationSchedule = UserSettings["generationSchedule"]
