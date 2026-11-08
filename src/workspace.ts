import { createContext } from 'react'
import type { EngineMode, SavedItem, ToolId, ToolResult } from '../shared/types'

export type Route = 'home' | 'marketing' | 'summary' | 'code' | 'saved' | 'settings' | 'guide'
export const routes: Route[] = ['home', 'marketing', 'summary', 'code', 'saved', 'settings', 'guide']
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
