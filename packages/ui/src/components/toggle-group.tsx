import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

// ADR-0018で新規primitiveは慎重に増やす方針。主タブ(未読/あとで/保存/すべて)は
// 常時1つが選択された排他ボタン群で、buttonの手組みでは選択状態の管理とkeyboard操作を
// 個別実装することになるため、Base UIのToggleGroupを追加する。
const toggleGroupItemVariants = cva(
  "group/toggle-group-item inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground transition-all outline-none select-none first:rounded-s-lg last:rounded-e-lg focus-visible:z-10 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-pressed:bg-secondary data-pressed:text-secondary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function ToggleGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "inline-flex w-fit items-center divide-x divide-input rounded-lg border border-input",
        className
      )}
      {...props}
    />
  )
}

function ToggleGroupItem<Value extends string>({
  className,
  size = "default",
  ...props
}: TogglePrimitive.Props<Value> &
  VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
