import { useEffect, useRef, useState } from 'react'
import type { ToolId, ToolInput, ToolResult } from '../../shared/types'
import { useWorkspace } from '../hooks'
import { apiUrl } from '../lib/site'
import { ACCESS_HEADER } from '../../shared/contract'

export function useGeneration<T extends ToolResult>(tool: ToolId, local: () => Promise<T> | T) {
  const { mode, aiAvailable, accessCode } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<T | null>(null)
  const [consent, setConsent] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controllerRef.current?.abort() }
  }, [])
  const generate = async (input: ToolInput) => {
    if (busy) return
    setError('')
    if (mode === 'ai' && (!aiAvailable || !consent)) {
      setError(!aiAvailable ? 'الاتصال السحابي غير مهيّأ. اختر الوضع المحلي للمتابعة دون مفتاح.' : 'وافق أولاً على إرسال النص إلى مزوّد الذكاء الاصطناعي.')
      return
    }
    if (mode === 'ai' && !accessCode.trim()) {
      setError('أدخل رمز وصول الخادم في الإعدادات أولاً. مفتاح المزوّد يبقى على الخادم ولا يُطلب هنا.')
      return
    }
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    const timeout = setTimeout(() => controller.abort(), 32000)
    try {
      if (mode === 'local') {
        const next = await local()
        if (mounted.current) setResult(next)
      } else {
        const response = await fetch(apiUrl('ai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [ACCESS_HEADER]: accessCode.trim() },
          body: JSON.stringify({ tool, input, consent }),
          signal: controller.signal,
        })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('وضع الذكاء الاصطناعي يحتاج خادماً يدعم API. النشر الثابت يدعم الأدوات المحلية؛ راجع دليل النشر.')
        const data = await response.json() as { result?: T; error?: { message: string } }
        if (!response.ok || !data.result) throw new Error(data.error?.message ?? 'تعذّر إكمال الطلب. حاول مجدداً.')
        if (mounted.current) setResult(data.result)
      }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? controller.signal.aborted ? 'انتهت مهلة الطلب. جرّب نصاً أقصر أو تابع بالوضع المحلي.' : caught.message : 'حدث خطأ غير متوقع.')
    } finally {
      clearTimeout(timeout)
      if (mounted.current) setBusy(false)
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }
  return { busy, error, result: result?.mode === mode ? result : null, setResult, consent, setConsent, generate, mode, aiAvailable }
}
