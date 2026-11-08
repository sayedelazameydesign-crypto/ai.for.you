import type { ToolId } from '../../shared/tools.ts'
import type { AnyServerTool } from './types.ts'
import { marketing } from './marketing.ts'
import { summary } from './summary.ts'
import { code } from './code.ts'

/**
 * Tool registry. Registering a module here is the only core change a new tool
 * needs on the server; routing, validation and error mapping stay generic.
 */
const modules: AnyServerTool[] = [marketing, summary, code]

export const serverTools: ReadonlyMap<ToolId, AnyServerTool> = new Map(modules.map((tool) => [tool.id, tool]))
export const serverToolIds: readonly ToolId[] = modules.map((tool) => tool.id)
