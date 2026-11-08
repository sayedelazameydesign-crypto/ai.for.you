import type { MarketingInput, MarketingResult } from '../../shared/types.ts'
import { defineTool, isRecord, oneOf, string } from './types.ts'

export const X_CHAR_LIMIT = 280

export const marketing = defineTool<MarketingInput, MarketingResult>({
  id: 'marketing',
  validateInput: (input) => string(input.product, 80, 1) && string(input.audience, 160, 1) && string(input.benefit, 400, 1)
    && oneOf(input.platform, ['instagram', 'linkedin', 'x']) && oneOf(input.tone, ['friendly', 'professional', 'bold']) && oneOf(input.language, ['ar', 'en']),
  prompt: (input) => `Write 3 distinct short social posts for ${input.platform}, tone ${input.tone}, in ${input.language === 'ar' ? 'Arabic' : 'English'}. Do not invent prices, guarantees, discounts, testimonials or product capabilities. Input: ${JSON.stringify(input)}. Schema: {"variants":[{"id":"v1","label":"short descriptive label in output language","text":"post including appropriate hashtags"}]}. For x each complete text must be <=280 characters.`,
  validateResult: (value, input) => {
    const maxText = input?.platform === 'x' ? X_CHAR_LIMIT : 4000
    return Array.isArray(value.variants) && value.variants.length > 0 && value.variants.length <= 5
      && value.variants.every((item) => isRecord(item) && string(item.id, 80, 1) && string(item.label, 100, 1) && string(item.text, maxText, 1))
  },
  finalize: (result) => ({ ...result, mode: 'ai' }),
})
