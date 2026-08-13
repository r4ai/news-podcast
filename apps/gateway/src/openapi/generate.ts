import { writeFile } from "node:fs/promises"

import { generateOpenApi } from "../contract.js"

const output = new URL(
  "../../../../packages/contracts/openapi/openapi.json",
  import.meta.url
)

await writeFile(output, `${JSON.stringify(generateOpenApi(), null, 2)}\n`)
