import {
  Bug,
  CheckCircle2,
  CircleHelp,
  CircleX,
  FileText,
  Info,
  Lightbulb,
  type LucideIcon,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { isCalloutType, type CalloutType } from "../lib/callout"

type CalloutMeta = Readonly<{
  readonly icon: LucideIcon
  readonly className: string
}>

const CALLOUT_META = {
  neutral: {
    icon: Info,
    className: "border-l-foreground/30 bg-muted/60 text-foreground",
  },
  tip: {
    icon: Lightbulb,
    className: "border-l-accent-foreground/40 bg-accent text-accent-foreground",
  },
  important: {
    icon: MessageSquareWarning,
    className:
      "border-l-secondary-foreground/40 bg-secondary text-secondary-foreground",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-l-destructive/60 bg-destructive/10 text-destructive",
  },
  danger: {
    icon: OctagonAlert,
    className: "border-l-destructive bg-destructive/15 text-destructive",
  },
  success: {
    icon: CheckCircle2,
    className: "border-l-accent-foreground/40 bg-accent text-accent-foreground",
  },
  question: {
    icon: CircleHelp,
    className:
      "border-l-secondary-foreground/40 bg-secondary text-secondary-foreground",
  },
  failure: {
    icon: CircleX,
    className: "border-l-destructive/60 bg-destructive/10 text-destructive",
  },
  bug: {
    icon: Bug,
    className: "border-l-destructive bg-destructive/15 text-destructive",
  },
  example: {
    icon: FileText,
    className: "border-l-foreground/30 bg-muted/60 text-foreground",
  },
} satisfies Record<string, CalloutMeta>

const metaOf = (type: CalloutType): CalloutMeta => {
  if (["tip", "hint"].includes(type)) return CALLOUT_META.tip
  if (["important", "todo"].includes(type)) return CALLOUT_META.important
  if (["warning", "caution", "attention"].includes(type))
    return CALLOUT_META.warning
  if (["danger", "error"].includes(type)) return CALLOUT_META.danger
  if (["success", "check", "done"].includes(type)) return CALLOUT_META.success
  if (["question", "help", "faq"].includes(type)) return CALLOUT_META.question
  if (["failure", "fail", "missing"].includes(type)) return CALLOUT_META.failure
  if (type === "bug") return CALLOUT_META.bug
  if (["example", "quote", "cite"].includes(type)) return CALLOUT_META.example
  return CALLOUT_META.neutral
}

export function Callout({
  "data-callout-type": type,
  "data-callout-folded": folded,
  children,
}: {
  readonly "data-callout-type"?: string
  readonly "data-callout-folded"?: boolean | string
  readonly children?: ReactNode
}) {
  const resolved = type && isCalloutType(type) ? type : "note"
  const meta = metaOf(resolved)
  const Icon = meta.icon
  const content = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 [&_[data-callout-title]]:font-semibold [&_p]:my-0 [&_p:not(:last-child)]:mb-2">
        {children}
      </div>
    </>
  )
  const className = cn(
    "my-4 gap-3 rounded-md border-l-4 px-4 py-3 text-sm",
    meta.className
  )
  return folded === undefined ? (
    <div className={cn("flex", className)} role="note">
      {content}
    </div>
  ) : (
    <details
      className={cn(
        className,
        "[&>[data-callout-body]]:mt-2 [&>[data-callout-body]]:pl-1 [&>summary]:cursor-pointer [&>summary]:font-semibold"
      )}
      open={folded === false || folded === "false"}
      role="note"
    >
      {children}
    </details>
  )
}
