import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleRequest, type AIEnvironment } from './ai.ts'

export type PlatformRequest = IncomingMessage & { body?: unknown }

export function toHeaders(source: IncomingMessage['headers']): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  return headers
}

/**
 * Client identity is deliberately NOT extracted here.
 *
 * The socket address of a serverless invocation is the edge, not the visitor,
 * and forwarding headers are caller-controlled. `server/ai.ts` derives the
 * limiter key from the declared `AI_TRUSTED_PROXY`, so a spoofed header cannot
 * reset a bucket by construction rather than by sanitizing a string.
 */
export async function serve(req: PlatformRequest, res: ServerResponse, env: AIEnvironment, path: string): Promise<void> {
  const host = req.headers.host ?? 'localhost'
  const body = typeof req.body === 'string' ? req.body : req.body === undefined ? undefined : JSON.stringify(req.body)
  const request = new Request(`https://${host}${path}`, {
    method: req.method,
    headers: toHeaders(req.headers),
    ...(body !== undefined && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
  })
  const response = await handleRequest(request, { env })
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
