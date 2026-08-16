import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

type SettingsSectionProps = {
  readonly title: string
  readonly description: string
  readonly icon: LucideIcon
  /** 見出しの右に置く補助表示 (件数など)。操作は置かない。 */
  readonly action?: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
  readonly contentClassName?: string
  readonly children: ReactNode
}

/**
 * 設定画面の1区画。4枚のカードで見出し・説明・区切りの扱いを揃える。
 *
 * `border-b`をheaderへ付けるのは装飾ではなく、説明文と操作の境目を作るため。
 * Cardの`--card-spacing`分の余白だけだと、説明の最終行と最初の入力欄が同じ
 * 段落のように続いて見える (実測でheader下端とcontent上端の差は16px、
 * `興味プロフィール`に至っては0pxだった)。
 *
 * その0pxは`<Card>`の内側に`<form>`を挟んだことが原因で、Card自身の
 * `flex flex-col gap-(--card-spacing)`が子1つにしか掛からずgapが消えていた。
 * ここでは`<form>`をCardの外側に置く形にしか組めないようにして、同じ潰れ方が
 * 再発しないようにする (schedule-formと同じ約束)。
 */
export function SettingsSection({
  action,
  children,
  className,
  contentClassName,
  description,
  footer,
  icon: Icon,
  title,
}: SettingsSectionProps) {
  return (
    /*
      高さは中身に任せる。`h-full`で隣のカードへ揃えると、背の低い方は
      footerの下に何も無い余白が伸びる。
    */
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription className="text-pretty">{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-5", contentClassName)}>
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className="justify-end">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}
