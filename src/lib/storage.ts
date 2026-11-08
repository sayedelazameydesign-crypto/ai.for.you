import type { SavedItem } from '../../shared/types'

export const STORAGE_KEY = 'lek.saved.v1'
export const MAX_SAVED_ITEMS = 50

export function parseSaved(raw: string | null): SavedItem[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SavedItem => Boolean(item) && typeof item === 'object' &&
      typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string' &&
      typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) &&
      ['marketing', 'summary', 'code'].includes(item.tool) && ['local', 'ai'].includes(item.mode)).slice(0, MAX_SAVED_ITEMS)
  } catch { return [] }
}

export function readSaved(): SavedItem[] {
  try { return parseSaved(localStorage.getItem(STORAGE_KEY)) } catch { return [] }
}

export function persistSaved(items: SavedItem[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_SAVED_ITEMS))) }
  catch { throw new Error('تعذّر الحفظ على هذا الجهاز. قد تكون مساحة المتصفح ممتلئة أو التخزين محظوراً. انسخ النتيجة للاحتفاظ بها.') }
}

export function downloadText(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(content: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('النسخ غير متاح في هذا المتصفح. حدّد النص وانسخه يدوياً.')
  try { await navigator.clipboard.writeText(content) }
  catch { throw new Error('لم يسمح المتصفح بالنسخ. حدّد النص وانسخه يدوياً.') }
}

export function resultToText(result: import('../../shared/types').ToolResult): string {
  if ('variants' in result) return result.variants.map((variant) => `${variant.label}\n${variant.text}`).join('\n\n———\n\n')
  if ('keyPoints' in result) return `${result.summary}\n\nالكلمات المفتاحية: ${result.keywords.join('، ')}`
  return [result.note, ...result.diagnostics.map((item) => `[${item.severity}] السطر ${item.line}:${item.column} — ${item.message}`), ...result.suggestions, result.formatted ? `\nالكود المنسّق:\n${result.formatted}` : ''].filter(Boolean).join('\n\n')
}
