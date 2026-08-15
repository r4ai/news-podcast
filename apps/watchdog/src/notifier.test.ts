import { describe, expect, it, vi } from "vitest"

const mail = vi.hoisted(() => ({
  close: vi.fn(),
  sendMail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => mail) },
}))

import { createWatchdogNotifier } from "./notifier.js"

describe("watchdog notifier configuration", () => {
  it("uses structured stderr notifications when SMTP is absent", async () => {
    const write = vi.fn()
    const notifier = createWatchdogNotifier({}, write)
    await notifier.send({ kind: "firing", subject: "down", text: "api" })

    expect(notifier.mode).toBe("log")
    expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject({
      event: "watchdog.notification",
      kind: "firing",
    })
  })

  it("rejects partial SMTP configuration", () => {
    expect(() =>
      createWatchdogNotifier({ WATCHDOG_SMTP_HOST: "smtp.example.com" })
    ).toThrow("Partial SMTP configuration")
  })

  it("sends notifications through SMTP when every required field exists", async () => {
    const notifier = createWatchdogNotifier({
      WATCHDOG_SMTP_HOST: "smtp.example.com",
      WATCHDOG_SMTP_USERNAME: "watchdog",
      WATCHDOG_SMTP_PASSWORD: "secret",
      WATCHDOG_SMTP_FROM: "watchdog@example.com",
      WATCHDOG_SMTP_TO: "oncall@example.com",
    })

    await notifier.send({ kind: "resolved", subject: "recovered", text: "api" })
    notifier.close()

    expect(notifier.mode).toBe("smtp")
    expect(mail.sendMail).toHaveBeenCalledWith({
      from: "watchdog@example.com",
      to: "oncall@example.com",
      subject: "recovered",
      text: "api",
    })
    expect(mail.close).toHaveBeenCalledOnce()
  })
})
