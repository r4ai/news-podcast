import { Check, Laptop, Moon, Sun, SunMoon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { TelemetryPreference } from "@/shared/observability/telemetry-preference"

import { useSetTheme, useThemeValue } from "../hooks/use-theme"
import type { Theme } from "../model"

const themes = [
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
  { value: "system", label: "システム", icon: Laptop },
] as const satisfies ReadonlyArray<{
  value: Theme
  label: string
  icon: typeof Sun
}>

export function ThemeToggle() {
  const theme = useThemeValue()
  const setTheme = useSetTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button aria-label="表示テーマを変更" size="icon" variant="ghost" />
        }
      >
        <SunMoon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>表示テーマ</DropdownMenuLabel>
          {themes.map(({ icon: Icon, label, value }) => (
            <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
              <Icon aria-hidden="true" />
              {label}
              {theme === value ? (
                <Check aria-hidden="true" className="ml-auto" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>プライバシー</DropdownMenuLabel>
          <TelemetryPreference />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
