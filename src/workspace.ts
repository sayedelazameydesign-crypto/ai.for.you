import { createContext } from 'react'
import type { EngineMode, SavedItem, ToolId, ToolResult } from '../shared/types'
import { TOOL_IDS } from '../shared/tools'

export type StaticRoute = 'home' | 'space' | 'saved' | 'settings' | 'guide'
export type Route = StaticRoute | ToolId
export const staticRoutes: StaticRoute[] = ['home', 'space', 'saved', 'settings', 'guide']
// Tool routes come from the shared id list, so a new tool is routable on registration.
export const routes: Route[] = ['home', 'space', ...TOOL_IDS, 'saved', 'settings', 'guide']
export function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  return routes.includes(hash as Route) ? hash as Route : 'home'
}
export interface Workspace {
  route: Route
  navigate: (route: Route) => void
  saved: SavedItem[]
  saveResult: (tool: ToolId, title: string, result: ToolResult) => void
  deleteSaved: (id: string) => void
  clearSaved: () => boolean
  notify: (message: string, kind?: 'success' | 'error') => void
  toast: { message: string; kind: 'success' | 'error' } | null
  dismissToast: () => void
  aiAvailable: boolean
  aiChecking: boolean
  accessCode: string
  setAccessCode: (code: string) => void
  mode: EngineMode
  setMode: (mode: EngineMode) => void
}
export const WorkspaceContext = createContext<Workspace | null>(null)
