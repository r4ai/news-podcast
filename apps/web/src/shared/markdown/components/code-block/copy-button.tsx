import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

const COPIED_LABEL_DURATION_MS = 1500

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** コードブロックの生テキストをクリップボードへコピーするボタン。 */
export function CopyButton({
  className,
  text,
}: {
  readonly className?: string
  readonly text: string
}) {
  const [copied, setCopied] = useState(false)

  const handleClick = () => {
    void copyToClipboard(text).then((succeeded) => {
      if (!succeeded) {
        return
      }
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_LABEL_DURATION_MS)
    })
  }

  return (
    <Button
      aria-label={copied ? "コピーしました" : "コードをコピー"}
      className={cn("text-muted-foreground", className)}
      onClick={handleClick}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      {copied ? (
        <Check aria-hidden="true" className="text-foreground" />
      ) : (
        <Copy aria-hidden="true" />
      )}
    </Button>
  )
}
