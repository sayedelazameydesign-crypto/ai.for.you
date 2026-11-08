import type { SummaryInput, SummaryResult } from '../../shared/types.ts'

export const MAX_TEXT_LENGTH = 20000
const stopwords = new Set('من في على إلى عن أن إن هذا هذه ذلك التي الذي كان كانت يكون كما ثم أو و قد لا ما مع بين كل بعض بعد قبل عند حتى إذا لكن خلال هو هي هم نحن أنا أنت يمكن يقوم لدى بها به لها له فيها فيه بشكل عبر حيث وقد وهل لأن كي ذات نفس أكثر this that with from have has been were are will would could should into your our their they them themselves for and the aber une des pour dans that its it as at by be is of to a an on or not'.split(' '))

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length : 0
}

export function splitSentences(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text.replace(/\s+/g, ' ')), (part) => part.segment.trim()).filter(Boolean)
  }
  return text.split(/(?<=[.!?؟۔])\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean)
}

function tokenize(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !stopwords.has(word))
}

export function summarize(input: SummaryInput): SummaryResult {
  const text = input.text.trim()
  if (text.length < 80) throw new Error('أضف 80 حرفاً على الأقل لنتمكن من استخراج ملخص مفيد.')
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`الحد الأقصى ${MAX_TEXT_LENGTH.toLocaleString('en')} حرف.`)
  const sentences = splitSentences(text)
  const frequencies = new Map<string, number>()
  for (const word of tokenize(text)) frequencies.set(word, (frequencies.get(word) ?? 0) + 1)
  const scored = sentences.map((sentence, index) => {
    const words = tokenize(sentence)
    const frequency = words.reduce((sum, word) => sum + (frequencies.get(word) ?? 0), 0) / Math.sqrt(words.length || 1)
    const position = index === 0 ? 2.5 : index === sentences.length - 1 ? 0.7 : 0
    const usefulLength = words.length >= 5 && words.length <= 45 ? 0.8 : 0
    return { sentence, index, score: frequency + position + usefulLength }
  })
  const target = input.length === 'short' ? 2 : input.length === 'detailed' ? 6 : 4
  const selected = scored.sort((a, b) => b.score - a.score).slice(0, Math.min(target, sentences.length)).sort((a, b) => a.index - b.index)
  const keyPoints = selected.map((item) => item.sentence)
  const summary = keyPoints.join('\n\n')
  const words = countWords(text)
  const keywords = [...frequencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([word]) => word)
  return {
    mode: 'local', summary, keyPoints, keywords,
    stats: {
      words,
      sentences: sentences.length,
      readingMinutes: Math.max(1, Math.ceil(words / 200)),
      reduction: Math.max(0, Math.round((1 - countWords(summary) / Math.max(words, 1)) * 100)),
    },
  }
}

export const summaryExample = `تعمل الفرق الصغيرة غالباً بموارد محدودة، مما يجعل تنظيم الوقت عاملاً أساسياً في نجاح المشاريع. بدلاً من توزيع الجهد على مهام كثيرة في اليوم نفسه، يساعد تحديد ثلاث أولويات واضحة على توجيه الانتباه إلى العمل الأكثر تأثيراً.

تبدأ العملية بمراجعة الأهداف الأسبوعية وتقسيمها إلى خطوات قابلة للتنفيذ. يمنح هذا الأسلوب الفريق صورة مشتركة عن التقدم، ويقلل الوقت الضائع في الاجتماعات المتكررة. كما أن توثيق القرارات في مكان واحد يسهل عودة الأعضاء إلى السياق دون الحاجة إلى إعادة شرح العمل.

لا يعني الإنتاجية إنجاز المزيد من المهام طوال الوقت. فالراحة المنتظمة وفترات التركيز دون مقاطعات تحافظ على جودة التفكير وتقلل الأخطاء. يمكن قياس أثر هذه العادات عبر مراجعة قصيرة في نهاية الأسبوع تبحث عما اكتمل وما تعطّل وما يستحق التغيير.

الخطوة الأولى ليست شراء أداة جديدة، بل الاتفاق على أولويات واضحة ومسؤوليات مفهومة. بعد ذلك يمكن اختيار أدوات بسيطة تدعم هذا الاتفاق. الاستمرار في تحسين طريقة العمل تدريجياً أكثر استدامة من تغيير النظام بالكامل كل أسبوع.`
