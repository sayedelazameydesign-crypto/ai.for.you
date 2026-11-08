import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleRequest } from '../server/ai'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = new Request(`https://${req.headers.host ?? 'localhost'}/api/status`, { method: req.method })
  const response = await handleRequest(request, { env: process.env })
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(await response.text())
}
