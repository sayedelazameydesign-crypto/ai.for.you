import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleRequest } from '../server/ai'

// Structural types avoid importing the platform runtime into the application.
type PlatformRequest = IncomingMessage & { body?: unknown }
export default async function handler(req: PlatformRequest, res: ServerResponse): Promise<void> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const host = req.headers.host ?? 'localhost'
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null)
  const request = new Request(`https://${host}/api/ai`, { method: req.method, headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}) })
  const client = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  const response = await handleRequest(request, { env: process.env }, client)
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
}
