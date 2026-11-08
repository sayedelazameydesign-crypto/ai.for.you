import type { ToolId } from '../../shared/tools'
import { tools } from '../tools/index'
import type { ToolModule } from '../tools/types'

/** Metadata view of the registry, kept for components that only need labels and icons. */
export const toolMeta = Object.fromEntries(tools.map((tool) => [tool.id, tool])) as Record<ToolId, ToolModule>
