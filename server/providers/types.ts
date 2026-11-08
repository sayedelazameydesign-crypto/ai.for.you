export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  maxTokens: number
}

export interface ProviderResponse {
  ok: boolean
  status: number
  retryAfter: string | null
  /** Parsed JSON body, or null when the body was not JSON. Never logged. */
  payload: unknown
}

export interface Provider {
  id: string
  label: string
  /** Env var holding the credential. Server-only, never bundled into the client. */
  keyEnv: string
  defaultModel: string
  /** Extra request fields this provider needs for the given model. */
  modelFields(model: string, maxTokens: number): Record<string, unknown>
  complete(request: CompletionRequest, apiKey: string, signal: AbortSignal, fetcher: typeof fetch): Promise<ProviderResponse>
  /** Extract assistant text from a successful payload. */
  content(payload: unknown): unknown
}
