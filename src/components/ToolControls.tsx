import { Cloud, Cpu, ShieldCheck, Sparkles, ArrowLeft, Info } from 'lucide-react'
import { useWorkspace } from '../hooks'
import { toolById } from '../tools/index'
import type { ToolId } from '../../shared/tools'

export function ModeControl() {
  const { mode, setMode } = useWorkspace()
  return <div className="mode-control" role="group" aria-label="طريقة المعالجة"><button className={mode === 'local' ? 'selected' : ''} onClick={() => setMode('local')} aria-pressed={mode === 'local'}><Cpu size={16} /><span>محلي ومجاني</span></button><button className={mode === 'ai' ? 'selected' : ''} onClick={() => setMode('ai')} aria-pressed={mode === 'ai'}><Sparkles size={16} /><span>ذكاء اصطناعي</span><span className="mode-beta">اختياري</span></button></div>
}
export function EngineNotice({ consent, onConsent }: { consent: boolean; onConsent: (value: boolean) => void }) {
  const { mode, aiAvailable, aiChecking, navigate, route } = useWorkspace()
  if (mode === 'local') return <div className="engine-notice"><ShieldCheck size={18} /><p><strong>على جهازك، وبخصوصية.</strong> هذه الأداة تستخدم {toolById.get(route as ToolId)?.notice ?? 'معالجة محلية'}، ولا ترسل بياناتك إلى الإنترنت.</p></div>
  return <div className="cloud-notice"><div className="flex items-start gap-2"><Cloud size={18} /><p>{aiChecking ? 'نتحقق من اتصال الخادم…' : aiAvailable ? 'وضع Groq السحابي متاح. تتم المعالجة باستخدام مفتاح موجود على الخادم فقط.' : 'هذا النشر لا يوفّر اتصال الذكاء الاصطناعي حالياً. يمكنك استخدام كل الأدوات في الوضع المحلي، أو إعداد الخادم لاحقاً.'}</p>{!aiAvailable && !aiChecking && <button className="text-button shrink-0" onClick={() => navigate('settings')}>الإعدادات <ArrowLeft size={14} /></button>}</div>{aiAvailable && <label className="consent-label"><input type="checkbox" checked={consent} onChange={(event) => onConsent(event.target.checked)} /><span>أوافق على إرسال مدخلات هذه الأداة إلى Groq لمعالجتها. لن تُرسل قبل ضغط زر التوليد. <a href="#/settings">تفاصيل الخصوصية</a></span></label>}<div className="cloud-footnote"><Info size={13} />النتائج المولّدة قد تخطئ. راجعها قبل الاستخدام.</div></div>
}
