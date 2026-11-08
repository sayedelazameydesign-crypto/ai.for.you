import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { Readable } from 'node:stream'
import { handleRequest, type AIEnvironment } from './ai.ts'

export function developmentApi(env: AIEnvironment): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/ai' && path !== '/api/status') { next(); return }
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    const host = req.headers.host ?? 'localhost:5173'
    const request = new Request(`http://${host}${req.url}`, {
      method: req.method,
      headers,
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    } as RequestInit)
    void handleRequest(request, { env }, req.socket.remoteAddress ?? 'local').then(async (response) => {
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    }).catch(() => { if (!res.headersSent) res.statusCode = 500; res.end(JSON.stringify({ error: { message: 'حدث خطأ في الخادم.' } })) })
  }
}
