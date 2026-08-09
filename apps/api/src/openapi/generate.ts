import { writeFile } from "node:fs/promises"

import { createApp, documentConfig } from "../app.js"

const output = new URL(
  "../../../../packages/contracts/openapi/openapi.json",
  import.meta.url
)
const document = createApp().getOpenAPIDocument(documentConfig)
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)
