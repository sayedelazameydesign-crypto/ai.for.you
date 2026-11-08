export type ToolId = 'marketing' | 'summary' | 'code'
export type Language = 'ar' | 'en'
export type EngineMode = 'local' | 'ai'
export type Platform = 'instagram' | 'linkedin' | 'x'
export type Tone = 'friendly' | 'professional' | 'bold'

export interface MarketingInput {
  product: string
  audience: string
  benefit: string
  platform: Platform
  tone: Tone
  language: Language
}

export interface CopyVariant {
  id: string
  label: string
  text: string
}

export interface MarketingResult {
  mode: EngineMode
  variants: CopyVariant[]
}

export interface SummaryInput {
  text: string
  language: Language
  length: 'short' | 'medium' | 'detailed'
}

export interface SummaryResult {
  mode: EngineMode
  summary: string
  keyPoints: string[]
  keywords: string[]
  stats: { words: number; sentences: number; readingMinutes: number; reduction: number }
}

export type CodeLanguage = 'javascript' | 'typescript' | 'json'
export interface CodeInput {
  code: string
  language: CodeLanguage
}
export interface Diagnostic {
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  rule: string
}
export interface CodeResult {
  mode: EngineMode
  diagnostics: Diagnostic[]
  suggestions: string[]
  formatted?: string
  note: string
}

export type ToolInput = MarketingInput | SummaryInput | CodeInput
export type ToolResult = MarketingResult | SummaryResult | CodeResult
export interface AIRequest {
  tool: ToolId
  input: ToolInput
  consent: true
}

export interface SavedItem {
  id: string
  tool: ToolId
  title: string
  content: string
  createdAt: string
  mode: EngineMode
}
