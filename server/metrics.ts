/**
 * Operational metrics for the optional AI proxy.
 *
 * This is deliberately NOT analytics and NOT telemetry: it emits one JSON line
 * per request to the server log, containing only machine-readable facts that an
 * operator needs to notice quota exhaustion or an abuse spike:
 *
 *   outcome, error code, tool id, HTTP status, upstream status, latency bucket.
 *
 * It never records prompt text, user input, the access code, the provider key,
 * model names, origins, IP addresses or any user identifier. There is no client
 * for this data and nothing is sent anywhere: the hosting provider's own log
 * collector is the only consumer, which the operator already controls.
 *
 * Counters are in-process, like the rate limiter they describe. They reset on
 * restart and do not aggregate across serverless instances; this is a smoke
 * detector, not a billing system.
 */
import type { ErrorCode } from '../shared/contract.ts'

export type Outcome = 'ok' | 'rejected' | 'failed'

export interface MetricEvent {
  outcome: Outcome
  /** Stable contract error code; never a provider message. */
  code?: ErrorCode | 'ok'
  tool?: string
  status: number
  /** Upstream HTTP status, when a provider call was attempted. */
  upstream?: number
  startedAt: number
}

export interface MetricsSink {
  (line: string): void
}

const BUCKETS = [250, 500, 1000, 2500, 5000, 10000, 30000] as const

/** Coarse latency bucket: exact timings of a public endpoint are noise. */
export const latencyBucket = (ms: number): string => {
  const bound = BUCKETS.find((limit) => ms <= limit)
  return bound ? `le_${bound}` : 'gt_30000'
}

const SAFE_TOOL = /^[a-z][a-z0-9-]{0,31}$/

/** Escape nothing: the payload is built from an allowlist, never from user text. */
export function metricLine(event: MetricEvent): string {
  const payload: Record<string, string | number> = {
    event: 'ai_request',
    outcome: event.outcome,
    status: event.status,
    latency: latencyBucket(Date.now() - event.startedAt),
  }
  if (event.code) payload.code = event.code
  if (event.upstream) payload.upstream = event.upstream
  if (event.tool && SAFE_TOOL.test(event.tool)) payload.tool = event.tool
  return JSON.stringify(payload)
}

export const defaultSink: MetricsSink = (line) => console.log(line)

export function recordMetric(event: MetricEvent, sink: MetricsSink = defaultSink): void {
  try {
    sink(metricLine(event))
  } catch {
    // A metric must never break a response.
  }
}
