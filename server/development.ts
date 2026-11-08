import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { Readable } from 'node:stream'
import { handleRequest, type AIEnvironment } from './ai.ts'
import { toHeaders } from './node-adapter.ts'

const API_ROUTE = /^\/api\/(?:v1\/)?(?:ai|status)\/?$/

export function developmentApi(env: AIEnvironment): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = req.url?.split('?')[0] ?? ''
    if (!API_ROUTE.test(path)) { next(); return }
    const host = req.headers.host ?? 'localhost:5173'
    const request = new Request(`http://${host}${req.url}`, {
      method: req.method,
      headers: toHeaders(req.headers),
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    } as RequestInit)
    void handleRequest(request, { env }).then(async (response) => {
      res.statusCode = response.status
      response.headers.forEach((value, key) => res.setHeader(key, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    }).catch(() => { if (!res.headersSent) res.statusCode = 500; res.end(JSON.stringify({ error: { message: 'حدث خطأ في الخادم.' } })) })
  }
}
