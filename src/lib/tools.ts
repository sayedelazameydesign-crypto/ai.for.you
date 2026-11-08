import { Code2, FileText, WandSparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const toolMeta: Record<'marketing' | 'summary' | 'code', { title: string; short: string; description: string; icon: LucideIcon; color: string; category: string }> = {
  marketing: { title: 'مولّد المحتوى التسويقي', short: 'مولّد المحتوى', description: 'حوّل فكرتك إلى كلمات تلفت الانتباه، وتترك أثراً.', icon: WandSparkles, color: 'purple', category: 'كتابة وتسويق' },
  summary: { title: 'ملخّص النصوص', short: 'ملخّص النصوص', description: 'من صفحات طويلة إلى أفكار واضحة. خذ معها الخلاصة.', icon: FileText, color: 'green', category: 'قراءة وفهم' },
  code: { title: 'فاحص الأكواد', short: 'فاحص الأكواد', description: 'عين ثانية على كودك، لتكتشف التحسين قبل الخطأ.', icon: Code2, color: 'orange', category: 'برمجة وتطوير' },
}
