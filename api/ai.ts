import type { ServerResponse } from 'node:http'
import { serve, type PlatformRequest } from '../server/node-adapter'

export default async function handler(req: PlatformRequest, res: ServerResponse): Promise<void> {
  await serve(req, res, process.env, '/api/v1/ai')
}
