/**
 * Versioned wire contract between the frontend and any compliant proxy.
 * The provider behind the proxy can change without touching the frontend as long
 * as this contract holds. See docs/API.md.
 */
export const API_VERSION = 'v1'
export const API_VERSION_HEADER = 'X-API-Version'

export type ApiEndpoint = 'status' | 'ai'
export const apiPath = (endpoint: ApiEndpoint): string => `api/${API_VERSION}/${endpoint}`

/** Stable, machine-readable error codes. Messages are human Arabic and may change. */
export const ERROR_CODES = [
  'method', 'origin', 'content-type', 'not-configured', 'access', 'rate-limit',
  'body', 'input', 'model', 'provider-limit', 'provider-auth', 'provider-request',
  'provider', 'output', 'timeout',
] as const
export type ErrorCode = typeof ERROR_CODES[number]

export interface StatusResponse { configured: boolean; provider: string }
export interface ApiErrorEnvelope { error: { code: ErrorCode | string; message: string } }
export interface AiSuccessEnvelope<T> { result: T }
export type AiResponse<T> = AiSuccessEnvelope<T> | ApiErrorEnvelope

export const ACCESS_HEADER = 'x-lek-access'
