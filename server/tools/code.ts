import type { CodeInput, CodeResult } from '../../shared/types.ts'
import { defineTool, isRecord, oneOf, string } from './types.ts'

export const code = defineTool<CodeInput, CodeResult>({
  id: 'code',
  validateInput: (input) => string(input.code, 12000, 1) && oneOf(input.language, ['javascript', 'typescript', 'json']),
  prompt: (input) => `Review this ${input.language} code statically. Explain findings in ${/[\u0600-\u06FF]/.test(input.code) ? 'Arabic' : 'English'}. Do not claim to execute code or perform a complete security audit. For TypeScript distinguish syntax from type checking. Only offer JSON formatting or trailing-whitespace cleanup as formatted output, never semantic rewrites. Input: ${JSON.stringify(input.code)}. Schema: {"diagnostics":[{"line":1,"column":1,"severity":"error|warning|info","message":"finding","rule":"short-rule-id"}],"suggestions":["actionable advice"],"note":"scope and limitations"}. Omit formatted unless certain it is behavior-preserving.`,
  validateResult: (value) => Array.isArray(value.diagnostics) && value.diagnostics.length <= 100
    && value.diagnostics.every((item) => isRecord(item) && Number.isInteger(item.line) && Number(item.line) >= 1
      && Number.isInteger(item.column) && Number(item.column) >= 1 && oneOf(item.severity, ['error', 'warning', 'info'])
      && string(item.message, 2000, 1) && string(item.rule, 100, 1))
    && Array.isArray(value.suggestions) && value.suggestions.length <= 30 && value.suggestions.every((item) => string(item, 2000, 1))
    && string(value.note, 3000, 1) && (value.formatted === undefined || string(value.formatted, 20000, 1)),
  // Only the local formatter may offer a behavior-preserving rewrite.
  finalize: (result) => {
    const review: Record<string, unknown> = { ...result, mode: 'ai' }
    delete review.formatted
    return review
  },
})
