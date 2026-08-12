import { deepFreeze, parse } from "@news-podcast/kernel"
import { Schema } from "effect"

export const UserIdSchema = Schema.NonEmptyString.check(
  Schema.isPattern(/^\S+$/),
  Schema.isMaxLength(255)
).pipe(Schema.brand("IdentityUserId"))
export type UserId = Schema.Schema.Type<typeof UserIdSchema>

export const AnonymousActorSchema = Schema.TaggedStruct("Anonymous", {})
export type AnonymousActor = Schema.Schema.Type<typeof AnonymousActorSchema>

export const AuthenticatedActorSchema = Schema.TaggedStruct("Authenticated", {
  userId: UserIdSchema,
})
export type AuthenticatedActor = Schema.Schema.Type<
  typeof AuthenticatedActorSchema
>

export const ActorSchema = Schema.Union([
  AnonymousActorSchema,
  AuthenticatedActorSchema,
])
export type Actor = Schema.Schema.Type<typeof ActorSchema>

export const anonymousActor: AnonymousActor = deepFreeze({
  _tag: "Anonymous",
})

export const authenticatedActor = (userId: UserId): AuthenticatedActor =>
  deepFreeze({ _tag: "Authenticated", userId })

export const parseUserId = parse(UserIdSchema)
export const parseAuthenticatedActor = parse(AuthenticatedActorSchema)
export const parseActor = parse(ActorSchema)
