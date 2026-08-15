import type { FeatureRule, RuleContext } from "../core/contracts.js"
import { calloutRule } from "./callout/rule.js"
import { createCodeRule } from "./code/rule.js"
import { embedRule } from "./embed/rule.js"
import { mathRule } from "./math.js"
import { safeUrlShapeRule } from "./safe-url-shape.js"

export const createFeatureRules = (): readonly FeatureRule[] =>
  Object.freeze([
    safeUrlShapeRule,
    calloutRule,
    embedRule,
    mathRule,
    createCodeRule(),
  ])

export const applyFeatureRules = async (
  rules: readonly FeatureRule[],
  context: RuleContext,
  root: ParentNode
): Promise<readonly string[]> => {
  const applied: string[] = []
  for (const rule of rules) {
    const count = await rule.transform(context, root)
    if (count > 0) applied.push(rule.id)
  }
  return Object.freeze(applied)
}
