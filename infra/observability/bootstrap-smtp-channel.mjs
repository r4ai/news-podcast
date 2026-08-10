const endpoint = required("SIGNOZ_ENDPOINT").replace(/\/$/, "")
const token = required("SIGNOZ_ACCESS_TOKEN")
const recipient = required("SIGNOZ_SMTP_TO")
const name = process.env.SIGNOZ_SMTP_CHANNEL_NAME ?? "news-podcast-smtp"
const headers = {
  "SIGNOZ-API-KEY": token,
  "Content-Type": "application/json",
}

const listResponse = await fetch(`${endpoint}/api/v1/channels`, { headers })
if (!listResponse.ok) fail("Unable to list SigNoz notification channels")
const payload = await listResponse.json()
const channels = Array.isArray(payload)
  ? payload
  : Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.receivers)
      ? payload.receivers
      : []

if (channels.some((channel) => channel?.name === name)) {
  process.stdout.write(`SMTP channel '${name}' already exists.\n`)
  process.exit(0)
}

const createResponse = await fetch(`${endpoint}/api/v1/channels`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    name,
    email_configs: [
      {
        send_resolved: true,
        to: recipient,
        html: "<h2>{{ template \"__subject\" . }}</h2><p>Status: {{ .Status }}</p><p>{{ range .Alerts }}{{ .Annotations.description }}{{ end }}</p>",
      },
    ],
  }),
})
if (!createResponse.ok) fail("Unable to create SigNoz SMTP channel")
process.stdout.write(`Created SMTP channel '${name}' with resolved notices.\n`)

function required(key) {
  const value = process.env[key]?.trim()
  if (!value) fail(`Missing required environment variable: ${key}`)
  return value
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
