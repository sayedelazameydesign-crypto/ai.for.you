import type { ToolId } from '../../shared/tools.ts'

/**
 * Server-side contract for one tool. The core proxy knows nothing about individual
 * tools: it validates, rate limits, calls the provider, then delegates parsing and
 * post-processing to the registered module.
 *
 * `validateInput` and `validateResult` always run before `prompt` / `finalize`, so
 * those two may assume the declared shape.
 */
export interface ServerTool<I = never, R = never> {
  id: ToolId
  validateInput(input: Record<string, unknown>): boolean
  prompt(input: I): string
  validateResult(value: Record<string, unknown>): boolean
  finalize(result: R, input: I): Promise<Record<string, unknown>> | Record<string, unknown>
}

export interface AnyServerTool {
  id: ToolId
  validateInput(input: Record<string, unknown>): boolean
  prompt(input: unknown): string
  validateResult(value: Record<string, unknown>): boolean
  finalize(result: unknown, input: unknown): Promise<Record<string, unknown>> | Record<string, unknown>
}

/** Erase the concrete types once, at the registration boundary. */
export function defineTool<I, R>(tool: ServerTool<I, R>): AnyServerTool {
  return tool as unknown as AnyServerTool
}

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const string = (value: unknown, max: number, min = 0): value is string => typeof value === 'string' && value.trim().length >= min && value.length <= max
export const oneOf = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value)
