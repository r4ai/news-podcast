import { loadTargetConfiguration } from "./main.mjs"
import { describeTarget } from "./target-identity.mjs"

const configuration = loadTargetConfiguration(process.env)
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      ...Object.fromEntries(
        ["source", "archive"].map((role) => [
          role,
          {
            ...describeTarget(configuration[role]),
            provider: "",
            accountId: "",
            backendId: "",
            failureDomain: "",
            administrativeDomain: "",
          },
        ])
      ),
      approval: {
        reviewedBy: "",
        reviewedAt: "",
        expiresAt: "",
        identityEvidence: "",
        permissionEvidence: "",
        independentFailureDomains: false,
        separateAdministrators: false,
        archiveCannotModifySource: false,
        sourceCannotModifyArchive: false,
      },
    },
    null,
    2
  )
)
