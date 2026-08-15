import nodemailer from "nodemailer"

import type { WatchdogResult } from "./watchdog.js"

type Notification = NonNullable<WatchdogResult["notification"]>
type Environment = Readonly<Record<string, string | undefined>>

export type WatchdogNotifier = Readonly<{
  send: (notification: Notification) => Promise<void>
  close: () => void
  mode: "log" | "smtp"
}>

const smtpKeys = [
  "WATCHDOG_SMTP_HOST",
  "WATCHDOG_SMTP_USERNAME",
  "WATCHDOG_SMTP_PASSWORD",
  "WATCHDOG_SMTP_FROM",
  "WATCHDOG_SMTP_TO",
] as const

export const createWatchdogNotifier = (
  environment: Environment,
  write: (line: string) => void = (line) => process.stderr.write(line)
): WatchdogNotifier => {
  const configured = smtpKeys.filter((key) => environment[key]?.trim())
  if (configured.length === 0) {
    return {
      mode: "log",
      send: async (notification) =>
        write(
          `${JSON.stringify({ event: "watchdog.notification", ...notification })}\n`
        ),
      close: () => undefined,
    }
  }
  const missing = smtpKeys.filter((key) => !environment[key]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `Partial SMTP configuration; missing: ${missing.join(", ")}`
    )
  }
  const port = readPositiveNumber(environment.WATCHDOG_SMTP_PORT, 587)
  const transport = nodemailer.createTransport({
    host: environment.WATCHDOG_SMTP_HOST!,
    port,
    secure: environment.WATCHDOG_SMTP_SECURE === "true",
    requireTLS: environment.WATCHDOG_SMTP_SECURE !== "true",
    auth: {
      user: environment.WATCHDOG_SMTP_USERNAME!,
      pass: environment.WATCHDOG_SMTP_PASSWORD!,
    },
  })
  return {
    mode: "smtp",
    send: async (notification) => {
      await transport.sendMail({
        from: environment.WATCHDOG_SMTP_FROM!,
        to: environment.WATCHDOG_SMTP_TO!,
        subject: notification.subject,
        text: notification.text,
      })
    },
    close: () => transport.close(),
  }
}

const readPositiveNumber = (input: string | undefined, fallback: number) => {
  const value = Number(input ?? fallback)
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("WATCHDOG_SMTP_PORT must be positive")
  return value
}
