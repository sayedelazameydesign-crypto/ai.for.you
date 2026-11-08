/**
 * Single source of truth for tool identity, shared by the browser and the server.
 * Adding a tool: add its id here, add a module under src/tools/ and server/tools/,
 * then register it in both registries. No core file needs editing.
 */
export const TOOL_IDS = ['marketing', 'summary', 'code'] as const
export type ToolId = typeof TOOL_IDS[number]
export const isToolId = (value: unknown): value is ToolId => typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value)
