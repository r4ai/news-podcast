// 署名済みトークンによる音声ストリーミング。/v1/* 認証ミドルウェアの対象外（トークン自体が認可を兼ねる）。
import type { RouteRegistrar } from "../../http/context.js"
import { registerAudioStream } from "./stream.js"

export const audioRegistrars: readonly RouteRegistrar[] = [registerAudioStream]
