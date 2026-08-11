import type { components } from "@news-podcast/contracts/openapi"

export type UserSettings = components["schemas"]["UserSettings"]
export type GenerationSchedule = UserSettings["generationSchedule"]
export type InterestProfile = UserSettings["interestProfile"]
export type Tag = components["schemas"]["Tag"]
export type TagSuggestion = components["schemas"]["TagSuggestion"]
