import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Bookmark, Check, CheckCircle2, Copy, Download, LoaderCircle, Sparkles, X, AlertCircle, WandSparkles } from 'lucide-react'
import { useWorkspace } from '../hooks'
import type { ToolId, ToolResult } from '../../shared/types'
import { copyText, downloadText, resultToText } from '../lib/storage'
import { site } from '../lib/site'

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-symbol"><Sparkles size={23} strokeWidth={1.7} /></span><span className="brand-name">{site.brandAr}<span className="brand-dot">.</span><span className="brand-english" dir="ltr">{site.brandLatin}</span></span></span>
}
export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></div>
    {children}
  </dialog>
}
export function Toast() {
  const { toast, dismissToast } = useWorkspace()
  return <div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className={`toast toast-${toast.kind}`}>{toast.kind === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}<span>{toast.message}</span><button onClick={dismissToast} aria-label="إغلاق التنبيه"><X size={17} /></button></div>}</div>
}
export function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const { notify } = useWorkspace()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = async () => {
    try { await copyText(text); setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2000) }
    catch (error) { notify(error instanceof Error ? error.message : 'تعذّر النسخ.', 'error') }
  }
  return <button className={small ? 'icon-button' : 'button button-secondary button-small'} onClick={() => void copy()} aria-label={copied ? 'تم النسخ' : 'نسخ النتيجة'} title={copied ? 'تم النسخ' : 'نسخ'}>{copied ? <Check size={16} /> : <Copy size={16} />}{!small && (copied ? 'تم النسخ' : 'نسخ')}</button>
}
export function SaveButton({ tool, title, result, small = false }: { tool: ToolId; title: string; result: ToolResult; small?: boolean }) {
  const { saveResult, saved } = useWorkspace()
  const isSaved = saved.some((item) => item.tool === tool && item.content === resultToText(result))
  return <button className={small ? 'icon-button' : 'button button-secondary button-small'} onClick={() => saveResult(tool, title, result)} aria-label={isSaved ? 'النتيجة محفوظة' : 'حفظ في المكتبة'} title={isSaved ? 'محفوظ في مكتبتك' : 'حفظ في المكتبة'} disabled={isSaved}>{isSaved ? <Check size={16} /> : <Bookmark size={16} />}{!small && (isSaved ? 'محفوظ' : 'حفظ')}</button>
}
export function DownloadButton({ content, filename }: { content: string; filename: string }) {
  return <button className="icon-button" onClick={() => downloadText(content, filename)} aria-label="تنزيل كملف نصي" title="تنزيل TXT"><Download size={17} /></button>
}
export function ErrorMessage({ message }: { message: string }) {
  return <div className="error-message" role="alert"><AlertCircle size={18} /><span>{message}</span></div>
}
export function SubmitButton({ busy, children, ai = false }: { busy: boolean; children: ReactNode; ai?: boolean }) {
  return <button type="submit" className="button button-primary generate-button" disabled={busy}>{busy ? <LoaderCircle size={19} className="animate-spin" /> : ai ? <Sparkles size={19} /> : <WandSparkles size={19} />}{busy ? 'نجهّز نتيجتك…' : children}<ArrowLeft size={17} className="submit-arrow" /></button>
}
export function EmptyResult({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="empty-result"><div className="empty-result-icon">{icon}<span className="empty-sparkle"><Sparkles size={16} /></span></div><h3>{title}</h3><p>{description}</p><span className="tiny-label">فكرتك + أداة لك = بداية جميلة</span></div>
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow"><span className="little-line" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}
export function LocalNotice({ children }: { children?: ReactNode }) {
  return <div className="local-notice"><CheckCircle2 size={15} /><span>{children ?? 'يعمل على جهازك. لا يُرسل نصك إلى أي خدمة خارجية.'}</span></div>
}
