import { Code2, FileText, WandSparkles } from 'lucide-react'
import type { ToolId } from '../../shared/tools'
import { Marketing } from '../pages/Marketing'
import { Summary } from '../pages/Summary'
import { Code } from '../pages/Code'
import type { ToolModule } from './types'

/**
 * Tool registry — the single place a new tool is registered in the UI.
 *
 * To add a tool:
 *   1. add its id to shared/tools.ts
 *   2. create the page under src/pages/ and a server module under server/tools/
 *   3. add one entry below and one entry in server/tools/index.ts
 *
 * Navigation, search, routing, the dashboard cards and the library filters are
 * all derived from this array, so no core component needs editing.
 */
export const tools: readonly ToolModule[] = [
  {
    id: 'marketing',
    title: 'مولّد المحتوى التسويقي',
    short: 'مولّد المحتوى',
    description: 'حوّل فكرتك إلى كلمات تلفت الانتباه، وتترك أثراً.',
    icon: WandSparkles,
    color: 'purple',
    category: 'كتابة وتسويق',
    action: 'جرّب مولّد المحتوى',
    notice: 'قوالب تحريرية',
    example: { title: 'مشروع صغير، حضور كبير', hint: 'اكتب منشوراً لمتجر نباتات يُدعى «نبتة»' },
    Page: Marketing,
  },
  {
    id: 'summary',
    title: 'ملخّص النصوص',
    short: 'ملخّص النصوص',
    description: 'من صفحات طويلة إلى أفكار واضحة. خذ معها الخلاصة.',
    icon: FileText,
    color: 'green',
    category: 'قراءة وفهم',
    action: 'جرّب التلخيص',
    notice: 'تلخيصاً استخلاصياً',
    example: { title: 'خذ فكرة من مقال طويل', hint: 'لخّص نصاً عن الإنتاجية في العمل' },
    Page: Summary,
  },
  {
    id: 'code',
    title: 'فاحص الأكواد',
    short: 'فاحص الأكواد',
    description: 'عين ثانية على كودك، لتكتشف التحسين قبل الخطأ.',
    icon: Code2,
    color: 'orange',
    category: 'برمجة وتطوير',
    action: 'جرّب فحص الكود',
    notice: 'قواعد فحص محلية',
    example: { title: 'امنح كودك مراجعة ثانية', hint: 'اكتشف ملاحظات تحسين في دالة JavaScript' },
    Page: Code,
  },
]

export const toolIds: readonly ToolId[] = tools.map((tool) => tool.id)
export const toolById = new Map<ToolId, ToolModule>(tools.map((tool) => [tool.id, tool]))
export const isToolRoute = (value: string): value is ToolId => toolById.has(value as ToolId)
