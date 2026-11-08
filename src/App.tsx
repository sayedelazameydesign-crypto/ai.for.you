import { useState } from 'react'
import { WorkspaceProvider } from './context'
import { useWorkspace } from './hooks'
import { Layout } from './components/Layout'
import { Toast } from './components/ui'
import { Dashboard } from './pages/Dashboard'
import { Marketing } from './pages/Marketing'
import { Summary } from './pages/Summary'
import { Code } from './pages/Code'
import { Saved } from './pages/Saved'
import { Settings } from './pages/Settings'
import { Guide } from './pages/Guide'

function Workspace() {
  const { route, navigate } = useWorkspace()
  const [examples, setExamples] = useState({ marketing: 0, summary: 0, code: 0 })
  const loadExample = (tool: 'marketing' | 'summary' | 'code') => {
    setExamples((previous) => ({ ...previous, [tool]: previous[tool] + 1 }))
    navigate(tool)
  }
  return <><Layout>{route === 'home' ? <Dashboard onExample={loadExample} /> : route === 'marketing' ? <Marketing key={examples.marketing} exampleSignal={examples.marketing} /> : route === 'summary' ? <Summary key={examples.summary} exampleSignal={examples.summary} /> : route === 'code' ? <Code key={examples.code} exampleSignal={examples.code} /> : route === 'saved' ? <Saved /> : route === 'settings' ? <Settings /> : <Guide />}</Layout><Toast /></>
}
export default function App() { return <WorkspaceProvider><Workspace /></WorkspaceProvider> }
