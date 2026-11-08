import { useCallback, useRef, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { EngineMode, SavedItem, ToolId, ToolResult } from '../shared/types'
import { MAX_SAVED_ITEMS, persistSaved, readSaved, resultToText } from './lib/storage'
import { currentRoute, WorkspaceContext } from './workspace'
import type { Route, Workspace } from './workspace'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(currentRoute)
  const [saved, setSaved] = useState<SavedItem[]>(readSaved)
  const [toast, setToast] = useState<Workspace['toast']>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiChecking, setAiChecking] = useState(true)
  const [accessCode, setAccessCode] = useState('')
  const [mode, setMode] = useState<EngineMode>('local')
  useEffect(() => {
    const update = () => {
      setRoute(currentRoute())
      window.scrollTo({ top: 0, behavior: 'instant' })
      requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    fetch(new URL('api/status', document.baseURI), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { configured: false }
        return await response.json() as { configured?: boolean }
      })
      .then((data) => { if (active) setAiAvailable(data.configured === true) })
      .catch(() => setAiAvailable(false))
      .finally(() => { clearTimeout(timeout); if (active) setAiChecking(false) })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ message, kind })
    timer.current = setTimeout(() => setToast(null), 5000)
  }, [])
  const navigate = useCallback((next: Route) => {
    window.location.hash = next === 'home' ? '/' : `/${next}`
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])
  const saveResult = (tool: ToolId, title: string, result: ToolResult) => {
    const content = resultToText(result)
    if (saved.some((item) => item.tool === tool && item.content === content)) { notify('هذه النتيجة محفوظة بالفعل.'); return }
    if (saved.length >= MAX_SAVED_ITEMS) { notify('المكتبة تتسع لـ 50 نتيجة. احذف عنصراً قبل حفظ نتيجة جديد.', 'error'); return }
    const item: SavedItem = { id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`, tool, title: title.slice(0, 100), content, createdAt: new Date().toISOString(), mode: result.mode }
    const next = [item, ...saved]
    try { persistSaved(next); setSaved(next); notify('حُفظت النتيجة في مكتبتك على هذا الجهاز.') }
    catch (error) { notify(error instanceof Error ? error.message : 'تعذّر الحفظ.', 'error') }
  }
  const deleteSaved = (id: string) => {
    const next = saved.filter((item) => item.id !== id)
    try { persistSaved(next); setSaved(next); notify('حُذفت النتيجة من هذا الجهاز.') }
    catch (error) { notify(error instanceof Error ? error.message : 'تعذّر الحذف.', 'error') }
  }
  const clearSaved = () => {
    try { persistSaved([]); setSaved([]); notify('أُفرغت المكتبة المحلية.'); return true }
    catch (error) { notify(error instanceof Error ? error.message : 'تعذّر الحذف.', 'error'); return false }
  }
  return <WorkspaceContext.Provider value={{ route, navigate, saved, saveResult, deleteSaved, clearSaved, notify, toast, dismissToast: () => setToast(null), aiAvailable, aiChecking, accessCode, setAccessCode, mode, setMode }}>{children}</WorkspaceContext.Provider>
}
