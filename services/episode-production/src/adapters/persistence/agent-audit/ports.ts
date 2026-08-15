/**
 * エージェント監査・記憶の永続化操作の型。
 * 実装は adapters/persistence/agent-audit/handle.ts にある。
 */

export type AgentInstanceRow = Readonly<{
  id: string
  ownerId: string
  agentKey: string
  createdAt: string
  updatedAt: string
}>
export type AgentRunRow = Readonly<{
  id: string
  jobId: string
  ownerId: string
  agentInstanceId: string | null
  model: string
  status: string
  policyHash: string
  createdAt: string
  finishedAt: string | null
  failureCode: string | null
}>
export type AgentEventRow = Readonly<{
  runId: string
  sequence: number
  eventType: string
  payloadJson: string
  occurredAt: string
}>
export type AgentMemoryRow = Readonly<{
  id: string
  ownerId: string
  agentInstanceId: string
  kind: string
  status: string
  currentVersion: number
  contentJson: string
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}>

export type UnsafeAgentAuditMemoryHandle = Readonly<{
  ensureInstance: (row: AgentInstanceRow) => AgentInstanceRow
  listInstances: (ownerId: string) => readonly AgentInstanceRow[]
  recordRun: (
    row: AgentRunRow
  ) =>
    | { readonly _tag: "Created" }
    | { readonly _tag: "Existing"; readonly row: AgentRunRow }
    | { readonly _tag: "ScopeConflict" }
  findOwnedRun: (ownerId: string, runId: string) => AgentRunRow | undefined
  replayOwnedEvents: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly afterSequence: number
    readonly limit: number
  }) => readonly AgentEventRow[] | undefined
  appendOwnedEvent: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly eventType: string
    readonly payloadJson: string
    readonly occurredAt: string
  }) => AgentEventRow | undefined
  transitionOwnedRun: (input: {
    readonly ownerId: string
    readonly runId: string
    readonly expected: string
    readonly next: string
    readonly finishedAt: string | null
    readonly failureCode: string | null
    readonly eventType: string
    readonly payloadJson: string
    readonly occurredAt: string
  }) =>
    | {
        readonly _tag: "Transitioned"
        readonly run: AgentRunRow
        readonly event: AgentEventRow
      }
    | { readonly _tag: "NotFound" }
    | { readonly _tag: "StateConflict"; readonly current: string }
  proposeMemory: (row: AgentMemoryRow) => boolean
  listOwnedMemories: (
    ownerId: string,
    instanceId: string
  ) => readonly AgentMemoryRow[] | undefined
  decideOwnedMemory: (input: {
    readonly ownerId: string
    readonly instanceId: string
    readonly memoryId: string
    readonly nextStatus: string
    readonly updatedAt: string
  }) =>
    | { readonly _tag: "Updated"; readonly row: AgentMemoryRow }
    | { readonly _tag: "NotFound" }
    | { readonly _tag: "StateConflict" }
  softDeleteOwnedMemory: (input: {
    readonly ownerId: string
    readonly instanceId: string
    readonly memoryId: string
    readonly updatedAt: string
  }) => "Deleted" | "NotFound" | "StateConflict"
  close: () => void
}>
