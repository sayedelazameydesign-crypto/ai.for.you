import type { Provider } from './types.ts'
import { groq } from './groq.ts'

/**
 * Provider registry. Swapping the model vendor is a server-only change: the
 * frontend talks to the versioned /api/v1 contract and never sees provider details.
 */
const registered: Provider[] = [groq]
export const providers: ReadonlyMap<string, Provider> = new Map(registered.map((provider) => [provider.id, provider]))
export const defaultProvider = groq
