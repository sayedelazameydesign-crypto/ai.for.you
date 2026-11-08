import type { SummaryInput, SummaryResult } from '../../shared/types.ts'
import { defineTool, oneOf, string } from './types.ts'

export const summary = defineTool<SummaryInput, SummaryResult>({
  id: 'summary',
  validateInput: (input) => string(input.text, 12000, 80) && oneOf(input.language, ['ar', 'en']) && oneOf(input.length, ['short', 'medium', 'detailed']),
  prompt: (input) => `Summarize the supplied text in ${input.language === 'ar' ? 'Arabic' : 'English'}. Use ${input.length === 'short' ? 2 : input.length === 'detailed' ? 6 : 4} key points. Preserve facts and uncertainty, add no outside information. Keywords must be actual terms from the text. Input: ${JSON.stringify(input.text)}. Schema: {"summary":"a concise paragraph","keyPoints":["point"],"keywords":["term"]}.`,
  validateResult: (value) => string(value.summary, 12000, 1) && Array.isArray(value.keyPoints) && value.keyPoints.length <= 10
    && value.keyPoints.every((point) => string(point, 2000, 1)) && Array.isArray(value.keywords) && value.keywords.length <= 12
    && value.keywords.every((word) => string(word, 100, 1)),
  // Statistics are computed locally from the real text, never trusted from the model.
  finalize: async (result, input) => {
    const { countWords, splitSentences } = await import('../../src/lib/summary.ts')
    const words = countWords(input.text)
    const stats = {
      words,
      sentences: splitSentences(input.text).length,
      readingMinutes: Math.max(1, Math.ceil(words / 200)),
      reduction: Math.max(0, Math.round((1 - countWords(result.summary) / Math.max(words, 1)) * 100)),
    }
    return { ...result, stats, mode: 'ai' }
  },
})
