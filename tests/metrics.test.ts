import { describe, expect, it } from 'vitest'
import { handleRequest } from '../server/ai'
import { latencyBucket, metricLine, recordMetric } from '../server/metrics'

const SECRET_CODE = 'access-code-for-tests-1234'
const USER_TEXT = 'نص خاص جداً للمستخدم لا يجب أن يظهر في أي سجل ' + 'x'.repeat(120)

const env = {
  GROQ_API_KEY: 'gsk_test_key_do_not_log_0123456789',
  AI_ACCESS_CODE: SECRET_CODE,
}

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://example.test/api/v1/ai', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-lek-access': SECRET_CODE,
    ...headers,
  },
  body: JSON.stringify(body),
})

/** Collect every metric line a request emits. */
async function collect(request: Request) {
  const lines: string[] = []
  await handleRequest(request, { env, metrics: (line) => lines.push(line) })
  return lines
}

describe('operational metrics', () => {
  it('emits exactly one line per AI request', async () => {
    const lines = await collect(post({ tool: 'summary', consent: true, input: { text: USER_TEXT, language: 'ar', length: 'short' } }))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'ai_request', tool: 'summary' })
  })

  it('records the outcome without recording the input, the access code or the key', async () => {
    const lines = await collect(post({ tool: 'summary', consent: true, input: { text: USER_TEXT, language: 'ar', length: 'short' } }))
    const joined = lines.join('\n')
    expect(joined).not.toContain('نص خاص')
    expect(joined).not.toContain('xxxx')
    expect(joined).not.toContain(SECRET_CODE)
    expect(joined).not.toContain('gsk_')
  })

  it('marks a rejected request as rejected, not as an upstream failure', async () => {
    const lines = await collect(post({ tool: 'summary', consent: false, input: {} }))
    expect(JSON.parse(lines[0])).toMatchObject({ outcome: 'rejected', code: 'input', status: 400 })
  })

  it('marks an unconfigured server as a failure the operator must act on', async () => {
    const lines: string[] = []
    await handleRequest(post({ tool: 'summary', consent: true, input: {} }), { env: {}, metrics: (line) => lines.push(line) })
    expect(JSON.parse(lines[0])).toMatchObject({ outcome: 'failed', code: 'not-configured', status: 503 })
  })

  it('stays silent for the status probe so uptime polling does not bury the signal', async () => {
    const lines = await collect(new Request('https://example.test/api/v1/status'))
    expect(lines).toHaveLength(0)
  })

  it('never lets a broken sink break the response', async () => {
    const response = await handleRequest(
      post({ tool: 'summary', consent: true, input: { text: USER_TEXT, language: 'ar', length: 'short' } }),
      { env, metrics: () => { throw new Error('sink down') } },
    )
    expect(response.status).toBeGreaterThanOrEqual(200)
  })
})

describe('metric line shape', () => {
  it('buckets latency coarsely instead of publishing exact timings', () => {
    expect(latencyBucket(120)).toBe('le_250')
    expect(latencyBucket(900)).toBe('le_1000')
    expect(latencyBucket(60000)).toBe('gt_30000')
  })

  it('drops a tool name that is not a plain identifier', () => {
    const line = metricLine({ outcome: 'ok', code: 'ok', status: 200, startedAt: Date.now(), tool: 'a b<script>' })
    expect(JSON.parse(line).tool).toBeUndefined()
  })

  it('swallows a failing sink', () => {
    expect(() => recordMetric({ outcome: 'ok', status: 200, startedAt: Date.now() }, () => { throw new Error('no') })).not.toThrow()
  })
})
