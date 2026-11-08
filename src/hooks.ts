import { useContext } from 'react'
import { WorkspaceContext } from './workspace'
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('WorkspaceProvider is required')
  return context
}
