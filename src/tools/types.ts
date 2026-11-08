import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ToolId } from '../../shared/tools'

export interface ToolExample {
  title: string
  hint: string
}

/**
 * Everything the shell needs to render a tool: metadata, an icon, a dashboard
 * example and the page component. The shell reads the registry and never imports
 * a tool page directly, so adding a tool does not touch navigation or routing.
 */
export interface ToolModule {
  id: ToolId
  title: string
  short: string
  description: string
  icon: LucideIcon
  color: 'purple' | 'green' | 'orange'
  category: string
  action: string
  notice: string
  example: ToolExample
  Page: ComponentType<{ exampleSignal: number }>
}
