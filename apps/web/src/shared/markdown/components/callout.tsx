import {
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

const CALLOUT_META: Record<
  CalloutType,
  {
    readonly label: string
    readonly icon: LucideIcon
    readonly className: string
  }
> = {
  note: {
    label: "Note",
    icon: Info,
    className: "border-l-foreground/30 bg-muted/60 text-foreground",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    className: "border-l-accent-foreground/40 bg-accent text-accent-foreground",
  },
  important: {
    label: "Important",
    icon: MessageSquareWarning,
    className:
      "border-l-secondary-foreground/40 bg-secondary text-secondary-foreground",
  },
  warning: {
    label: "Warning",
    icon: TriangleAlert,
    className: "border-l-destructive/60 bg-destructive/10 text-destructive",
  },
  caution: {
    label: "Caution",
    icon: OctagonAlert,
    className: "border-l-destructive bg-destructive/15 text-destructive",
  },
}

export function Callout({
  "data-callout-type": type,
  children,
}: {
  readonly "data-callout-type"?: string
  readonly children?: ReactNode
}) {
  const resolved = type && isCalloutType(type) ? type : "note"
  const meta = CALLOUT_META[resolved]
  const Icon = meta.icon
  return (
    <div
      className={cn(
        "my-4 flex gap-3 rounded-md border-l-4 px-4 py-3 text-sm",
        meta.className
      )}
      role="note"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 [&>p]:my-0 [&>p:not(:last-child)]:mb-2">
        <p className="mb-1 font-semibold">{meta.label}</p>
        {children}
      </div>
    </div>
  )
}
