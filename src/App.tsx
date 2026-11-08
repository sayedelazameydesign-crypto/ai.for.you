import { useState } from 'react'
import { WorkspaceProvider } from './context'
import { useWorkspace } from './hooks'
import { Layout } from './components/Layout'
import { Toast } from './components/ui'
import { Dashboard } from './pages/Dashboard'
import { Saved } from './pages/Saved'
import { Settings } from './pages/Settings'
import { Guide } from './pages/Guide'
import { tools, toolById } from './tools/index'
import type { ToolId } from '../shared/tools'

const counters = () => Object.fromEntries(tools.map((tool) => [tool.id, 0])) as Record<ToolId, number>

function Workspace() {
  const { route, navigate } = useWorkspace()
  const [examples, setExamples] = useState<Record<ToolId, number>>(counters)
  const loadExample = (tool: ToolId) => {
    setExamples((previous) => ({ ...previous, [tool]: previous[tool] + 1 }))
    navigate(tool)
  }
  const active = toolById.get(route as ToolId)
  return <><Layout>{active
    ? <active.Page key={examples[active.id]} exampleSignal={examples[active.id]} />
    : route === 'saved' ? <Saved /> : route === 'settings' ? <Settings /> : route === 'guide' ? <Guide /> : <Dashboard onExample={loadExample} />}</Layout><Toast /></>
}
export default function App() { return <WorkspaceProvider><Workspace /></WorkspaceProvider> }
